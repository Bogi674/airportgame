import { AIRFIELD, SURFACE_SPEC, SURFACE_DATA } from '@data/index';
import {
  codeIndex,
  compassVector,
  type Apron,
  type AirfieldPayload,
  type CodeLetter,
  type Runway,
  type Stand,
  type StandType,
  type Surface,
  type Taxiway,
} from '@shared/airfield';
import { closestOnSegment, pointInPolygon, segmentIntersection, type Pt } from '@shared/geom';
import { checkPolygon, checkStrip, endpoint, polygonArea, stripGradingCost, type BuildContext, type Problem } from '@shared/validate';
import { excludedType, isPaved, polylineLength, surfaceAllowsCode, surfaceChange, surfaceRank, tierOf, worksTicks } from '@shared/surfaceRules';
import { snapPolyline, TAXI_TOOL, type SnapHit } from '@shared/pavement/snap';
import { foldU32 } from '../hash';
import type { Command } from '../commands';
import { rapidExitPoints, runwayFrame } from '@shared/airfieldGeom';
import { assignRunwayNames, assignTaxiNames, deriveNetwork } from './geometry';

type ObjType = 'runway' | 'taxiway' | 'apron' | 'stand';
interface Item {
  type: ObjType;
  obj: Runway | Taxiway | Apron | Stand;
}
interface Op {
  items: Item[];
  /** True when the operation added the items, false when it removed them. */
  added: boolean;
  /** Cash change when the operation was done: negative for spending. */
  cashDelta: number;
  /** Taxiways the operation changed in place, as copies before and after, so undo restores them exactly. */
  swaps?: { before: Taxiway; after: Taxiway }[];
}

export type BuildResult = { cashDelta: number } | Problem;

/** What a command needs to know about the rest of the game: the tick and the aircraft types airlines fly here. */
export interface BuildEnv {
  tick: number;
  assignedTypes: readonly number[];
}

const NO_ENV: BuildEnv = { tick: 0, assignedTypes: [] };
export const isProblem = (r: BuildResult): r is Problem => 'code' in r;

const TAXI_NAMES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MIN_RUNWAY_M = 300;
const MAX_RUNWAY_M = 5000;
const MIN_RUNWAY_SEP_M = 100;
const REFUND_SHARE = 0.25;
const APPROACH_FEE: Record<string, number> = { visual: 0, nonPrecision: 250_000, precision: 1_200_000 };
const round05 = (v: number): number => Math.round(v * 2) / 2;

function segSegDist(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  if (segmentIntersection(ax, ay, bx, by, cx, cy, dx, dy) >= 0) return 0;
  const c = { x: 0, y: 0, t: 0 };
  let best = Infinity;
  const test = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): void => {
    closestOnSegment(px, py, x1, y1, x2, y2, c);
    best = Math.min(best, Math.hypot(px - c.x, py - c.y));
  };
  test(ax, ay, cx, cy, dx, dy);
  test(bx, by, cx, cy, dx, dy);
  test(cx, cy, ax, ay, bx, by);
  test(dx, dy, ax, ay, bx, by);
  return best;
}

/** All built airfield objects, with undo and redo. State lives here, changes arrive as commands. */
export class Airfield {
  readonly data: AirfieldPayload = { version: 0, runways: [], taxiways: [], aprons: [], stands: [], holding: [], entries: [] };
  private nextId = 1;
  private nameIndex = 0;
  private standNumber = 0;
  private undoStack: Op[] = [];
  private redoStack: Op[] = [];

  get version(): number {
    return this.data.version;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private list(type: ObjType): { id: number }[] {
    switch (type) {
      case 'runway':
        return this.data.runways;
      case 'taxiway':
        return this.data.taxiways;
      case 'apron':
        return this.data.aprons;
      default:
        return this.data.stands;
    }
  }

  private nextTaxiName(): string {
    const i = this.nameIndex++;
    const letter = TAXI_NAMES[i % TAXI_NAMES.length];
    const round = Math.floor(i / TAXI_NAMES.length);
    return round === 0 ? letter : `${letter}${letter}`;
  }

  private refresh(): void {
    assignRunwayNames(this.data.runways);
    assignTaxiNames(this.data.taxiways);
    deriveNetwork(this.data);
    this.data.version++;
  }

  private addItems(items: Item[]): void {
    for (const it of items) this.list(it.type).push(it.obj);
    this.refresh();
  }

  private removeItems(items: Item[]): void {
    for (const it of items) {
      const l = this.list(it.type);
      const i = l.findIndex((o) => o.id === it.obj.id);
      if (i >= 0) l.splice(i, 1);
    }
    this.refresh();
  }

  private record(items: Item[], added: boolean, cashDelta: number): BuildResult {
    this.undoStack.push({ items, added, cashDelta });
    this.redoStack.length = 0;
    return { cashDelta };
  }

  /** Adds new objects, charging their summed cost. */
  private place(items: Item[], cash: number): BuildResult {
    let cost = 0;
    for (const it of items) cost += (it.obj as { cost: number }).cost;
    if (cost > cash) return { code: 'insufficientFunds', args: { cost } };
    this.addItems(items);
    return this.record(items, true, -cost);
  }

  /** Executes an airfield command. Returns the cash change or the reason it was refused. */
  execute(cmd: Command, ctx: BuildContext, cash: number, env: BuildEnv = NO_ENV): BuildResult | null {
    switch (cmd.type) {
      case 'buildRunway':
        return this.buildRunway(cmd, ctx, cash);
      case 'buildTaxiway':
        return this.buildTaxiway(cmd, ctx, cash);
      case 'buildRapidExit':
        return this.buildRapidExit(cmd, ctx, cash);
      case 'buildParallelTaxiway':
        return this.buildParallel(cmd, ctx, cash);
      case 'buildApron':
        return this.buildApron(cmd, ctx, cash);
      case 'buildStands':
        return this.buildStands(cmd, ctx, cash);
      case 'buildGaBlock':
        return this.buildGaBlock(cmd, ctx, cash);
      case 'demolish':
        return this.demolish(cmd.kind, cmd.id);
      case 'setTaxiwayProps':
        return this.setTaxiwayProps(cmd);
      case 'resurface':
        return this.resurface(cmd, cash, env);
      case 'reclassTaxiway':
        return this.reclassTaxiway(cmd, ctx, cash, env);
      case 'reverseTaxiway': {
        const t = this.data.taxiways.find((x) => x.id === cmd.id);
        if (!t) return { code: 'nothingThere' };
        t.points = t.points.slice().reverse();
        if (t.preferred) t.preferred = -t.preferred;
        this.refresh();
        return { cashDelta: 0 };
      }
      case 'setStandProps': {
        const s = this.data.stands.find((x) => x.id === cmd.id);
        if (!s) return { code: 'nothingThere' };
        if (cmd.closed !== undefined) s.closed = cmd.closed;
        if (cmd.usage !== undefined) s.usage = cmd.usage;
        this.refresh();
        return { cashDelta: 0 };
      }
      case 'resizeRunway':
        return this.resizeRunway(cmd, ctx, cash);
      case 'reclassRunway':
        return this.reclassRunway(cmd, ctx, cash);
      case 'editTaxiway':
        return this.editTaxiway(cmd, ctx, cash);
      case 'undo':
        return this.undo(cash);
      case 'redo':
        return this.redo(cash);
      default:
        return null;
    }
  }

  private buildRunway(cmd: Extract<Command, { type: 'buildRunway' }>, ctx: BuildContext, cash: number): BuildResult {
    const length = Math.round(cmd.lengthM);
    if (length < MIN_RUNWAY_M || length > MAX_RUNWAY_M) return { code: 'runwayLength', args: { min: MIN_RUNWAY_M, max: MAX_RUNWAY_M } };
    if (cmd.approach !== 'visual' && !isPaved(cmd.surface)) return { code: 'approachNeedsPaved' };
    const row = AIRFIELD.codes[cmd.code];
    const heading = ((Math.round(cmd.headingDeg) % 360) + 360) % 360;
    const a = { x: round05(cmd.x), y: round05(cmd.y) };
    const b = endpoint(a.x, a.y, heading, length);
    const shoulder = isPaved(cmd.surface) ? row.runwayShoulderM : 0;
    const width = row.runwayWidthM;
    const problem = checkStrip(ctx, [a, b], width + 2 * shoulder);
    if (problem) return problem;
    for (const r of this.data.runways) {
      if (segSegDist(a.x, a.y, b.x, b.y, r.x1, r.y1, r.x2, r.y2) < MIN_RUNWAY_SEP_M) return { code: 'runwayTooClose', args: { min: MIN_RUNWAY_SEP_M } };
    }
    const { pcr, factor } = tierOf(cmd.surface, cmd.tier);
    const area = length * (width + 2 * shoulder);
    const cost = Math.round(area * SURFACE_SPEC[cmd.surface].costPerM2 * factor) + stripGradingCost(ctx, [a, b], width + 2 * shoulder);
    const runway: Runway = {
      id: this.nextId++,
      cost,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      headingDeg: heading,
      lengthM: length,
      widthM: width,
      shoulderM: shoulder,
      code: cmd.code,
      approach: cmd.approach,
      surface: cmd.surface,
      pcr,
      condition: 100,
      nameA: '',
      nameB: '',
    };
    return this.place([{ type: 'runway', obj: runway }], cash);
  }

  private makeTaxiway(
    points: Pt[],
    code: CodeLetter,
    kind: Taxiway['kind'],
    surface: Surface,
    tier: number,
    name: string,
    ctx: BuildContext,
  ): Taxiway | Problem {
    if (!surfaceAllowsCode(surface, code)) return { code: 'surfaceCode', args: { code } };
    const width = AIRFIELD.codes[code].taxiwayWidthM;
    const problem = checkStrip(ctx, points, width);
    if (problem) return problem;
    const { pcr, factor } = tierOf(surface, tier);
    let len = 0;
    for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const cost = Math.round(len * width * SURFACE_SPEC[surface].costPerM2 * factor) + stripGradingCost(ctx, points, width);
    return {
      id: this.nextId++,
      cost,
      kind,
      points,
      code,
      widthM: width,
      surface,
      pcr,
      condition: 100,
      oneWay: false,
      preferred: 0,
      closed: false,
      userMaxCode: code,
      maxCode: code,
      speedKmh: kind === 'taxilane' ? 15 : kind === 'rapidExit' ? 60 : 30,
      name,
    };
  }

  /**
   * The taxiway tool (docs/DESIGN_REVISION_2.md section 2.2): points snap to existing nodes, open
   * ends and segments, a segment hit splits that taxiway, and an open end with the same class and
   * surface is continued instead of starting a new taxiway. Undo restores every changed taxiway.
   */
  private buildTaxiway(cmd: Extract<Command, { type: 'buildTaxiway' }>, ctx: BuildContext, cash: number): BuildResult {
    if (cmd.points.length < 2 || cmd.points.length > 60) return { code: 'taxiwayPoints' };
    const snapped = snapPolyline(
      this.data.taxiways,
      cmd.points.map((p) => ({ x: round05(p.x), y: round05(p.y) })),
    );
    if ('problem' in snapped) return { code: snapped.problem, args: { min: TAXI_TOOL.minNodeGapM } };
    const pts = snapped.points;
    if (polylineLength(pts) > 8000) return { code: 'taxiwayTooLong', args: { max: 8000 } };
    const t = this.makeTaxiway(pts, cmd.code, cmd.kind, cmd.surface, cmd.tier, this.nextTaxiName(), ctx);
    if (!('points' in t)) {
      this.nameIndex--;
      return t;
    }
    if (t.cost > cash) {
      this.nameIndex--;
      return { code: 'insufficientFunds', args: { cost: t.cost } };
    }
    const before = new Map<number, Taxiway>();
    const touch = (x: Taxiway): void => {
      if (!before.has(x.id)) before.set(x.id, structuredClone(x));
    };
    // Splits, last segment first so earlier indexes stay valid.
    const splits = snapped.hits.filter((h): h is SnapHit => h !== null && h.kind === 'segment');
    splits.sort((p, q) => p.taxiwayId - q.taxiwayId || q.index - p.index || q.along - p.along);
    for (const h of splits) {
      const other = this.data.taxiways.find((x) => x.id === h.taxiwayId);
      if (!other) continue;
      touch(other);
      other.points.splice(h.index + 1, 0, { x: h.p.x, y: h.p.y });
    }
    // Continue an open end of a taxiway of the same kind instead of starting a new one.
    let merged: Taxiway | null = null;
    for (const [hit, ownEnd] of [[snapped.hits[0], 0], [snapped.hits[snapped.hits.length - 1], 1]] as const) {
      if (merged || !hit || hit.kind !== 'end') continue;
      const o = this.data.taxiways.find((x) => x.id === hit.taxiwayId);
      if (!o || o.code !== t.code || o.kind !== t.kind || o.surface !== t.surface || o.pcr !== t.pcr || o.works) continue;
      const add = ownEnd === 0 ? t.points.slice(1) : t.points.slice(0, -1).reverse();
      if (o.points.length + add.length > 60) continue;
      touch(o);
      o.points = hit.index === 1 ? [...o.points, ...add] : [...add.reverse(), ...o.points];
      o.cost += t.cost;
      merged = o;
    }
    if (merged) this.nameIndex--;
    const items: Item[] = merged ? [] : [{ type: 'taxiway', obj: t }];
    for (const it of items) this.list(it.type).push(it.obj);
    this.refresh();
    const swaps = [...before.values()].map((b) => ({ before: b, after: structuredClone(this.data.taxiways.find((x) => x.id === b.id) as Taxiway) }));
    this.undoStack.push({ items, added: true, cashDelta: -t.cost, swaps });
    this.redoStack.length = 0;
    return { cashDelta: -t.cost };
  }

  private buildRapidExit(cmd: Extract<Command, { type: 'buildRapidExit' }>, ctx: BuildContext, cash: number): BuildResult {
    const r = this.data.runways.find((x) => x.id === cmd.runwayId);
    if (!r) return { code: 'noSuchRunway' };
    if (cmd.distM < 200 || cmd.distM > r.lengthM - 200) return { code: 'exitDistance', args: { min: 200, max: r.lengthM - 200 } };
    const pts = rapidExitPoints(r, cmd.distM, cmd.side, cmd.angleDeg);
    const t = this.makeTaxiway(pts, cmd.code, 'rapidExit', cmd.surface, cmd.tier, `${this.nextTaxiName()}`, ctx);
    if (!('points' in t)) {
      this.nameIndex--;
      return t;
    }
    return this.place([{ type: 'taxiway', obj: t }], cash);
  }

  private buildParallel(cmd: Extract<Command, { type: 'buildParallelTaxiway' }>, ctx: BuildContext, cash: number): BuildResult {
    const r = this.data.runways.find((x) => x.id === cmd.runwayId);
    if (!r) return { code: 'noSuchRunway' };
    const row = AIRFIELD.codes[cmd.code];
    const minOffset = r.widthM / 2 + r.shoulderM + row.taxiwayWidthM / 2 + 15;
    if (cmd.offsetM < minOffset) return { code: 'parallelTooClose', args: { min: Math.ceil(minOffset) } };
    const connectors = Math.max(1, Math.min(12, Math.floor(cmd.connectors)));
    const d = compassVector(r.headingDeg);
    const sideSign = cmd.side === 'left' ? 1 : -1;
    const n = { x: d.y * sideSign, y: -d.x * sideSign };
    const at = (s: number, off: number): Pt => ({ x: round05(r.x1 + d.x * s + n.x * off), y: round05(r.y1 + d.y * s + n.y * off) });
    const name = this.nextTaxiName();
    const main = this.makeTaxiway([at(0, cmd.offsetM), at(r.lengthM, cmd.offsetM)], cmd.code, 'taxiway', cmd.surface, cmd.tier, name, ctx);
    if (!('points' in main)) {
      this.nameIndex--;
      return main;
    }
    const items: Item[] = [{ type: 'taxiway', obj: main }];
    const edge = r.widthM / 2 + r.shoulderM;
    const inset = Math.min(60, r.lengthM / 4);
    for (let i = 0; i < connectors; i++) {
      const s = connectors === 1 ? r.lengthM / 2 : inset + (i * (r.lengthM - 2 * inset)) / (connectors - 1);
      const c = this.makeTaxiway([at(s, cmd.offsetM), at(s, edge)], cmd.code, 'taxiway', cmd.surface, cmd.tier, `${name}${i + 1}`, ctx);
      if (!('points' in c)) {
        this.nextId -= items.length;
        this.nameIndex--;
        return c;
      }
      items.push({ type: 'taxiway', obj: c });
    }
    return this.place(items, cash);
  }

  private buildApron(cmd: Extract<Command, { type: 'buildApron' }>, ctx: BuildContext, cash: number): BuildResult {
    const poly = cmd.polygon.map((p) => ({ x: round05(p.x), y: round05(p.y) }));
    if (poly.length < 3 || poly.length > 16) return { code: 'apronPoints' };
    const area = polygonArea(poly);
    if (area < 400) return { code: 'apronTooSmall', args: { min: 400 } };
    if (area > 600000) return { code: 'apronTooLarge' };
    const problem = checkPolygon(ctx, poly);
    if (problem) return problem;
    const { pcr, factor } = tierOf(cmd.surface, cmd.tier);
    const apron: Apron = {
      id: this.nextId++,
      cost: Math.round(area * SURFACE_SPEC[cmd.surface].costPerM2 * factor),
      polygon: poly,
      surface: cmd.surface,
      pcr,
      condition: 100,
    };
    return this.place([{ type: 'apron', obj: apron }], cash);
  }

  private surfaceAt(x: number, y: number): Surface | null {
    for (const a of this.data.aprons) if (pointInPolygon(x, y, a.polygon)) return a.surface;
    return null;
  }

  private makeStands(
    x: number,
    y: number,
    headingDeg: number,
    count: number,
    spacing: number,
    type: StandType,
    code: CodeLetter,
    ctx: BuildContext,
  ): Item[] | Problem {
    const n = Math.floor(count);
    if (n < 1 || n > 30) return { code: 'standCount', args: { max: 30 } };
    const d = compassVector(headingDeg);
    const perp = { x: -d.y, y: d.x };
    const items: Item[] = [];
    const span = AIRFIELD.codes[code].spanM;
    const minSpacing = span + 3;
    if (spacing < minSpacing) return { code: 'standSpacing', args: { min: Math.ceil(minSpacing) } };
    let number = this.standNumber;
    for (let i = 0; i < n; i++) {
      const sx = round05(x + perp.x * spacing * i);
      const sy = round05(y + perp.y * spacing * i);
      const p = checkStrip(ctx, [{ x: sx, y: sy }, { x: sx + d.x * 2, y: sy + d.y * 2 }], span * 0.5);
      if (p) return p;
      const apronSurface = this.surfaceAt(sx, sy);
      if (type !== 'gaTieDown' && !apronSurface) return { code: 'standNeedsApron' };
      const surface: Surface = apronSurface ?? 'grass';
      if (type !== 'gaTieDown' && !isPaved(surface)) return { code: 'standSurface' };
      for (const s of this.data.stands) {
        const min = (AIRFIELD.codes[s.code].spanM + span) / 2 + 3;
        if (Math.hypot(s.x - sx, s.y - sy) < min) return { code: 'standOverlap' };
      }
      for (const it of items) {
        const s = it.obj as Stand;
        if (Math.hypot(s.x - sx, s.y - sy) < span + 3) return { code: 'standOverlap' };
      }
      number++;
      items.push({
        type: 'stand',
        obj: {
          id: this.nextId++,
          number: String(number),
          cost: AIRFIELD.standCost[type],
          x: sx,
          y: sy,
          headingDeg: ((Math.round(headingDeg) % 360) + 360) % 360,
          type,
          code,
          surface,
          pushback: type === 'remoteThrough' || type === 'gaTieDown' ? 'none' : 'straight',
        },
      });
    }
    this.standNumber = number;
    return items;
  }

  private buildStands(cmd: Extract<Command, { type: 'buildStands' }>, ctx: BuildContext, cash: number): BuildResult {
    const before = this.standNumber;
    const idBefore = this.nextId;
    const items = this.makeStands(cmd.x, cmd.y, cmd.headingDeg, cmd.count, cmd.spacingM, cmd.standType, cmd.code, ctx);
    if (!Array.isArray(items)) {
      this.standNumber = before;
      this.nextId = idBefore;
      return items;
    }
    const r = this.place(items, cash);
    if (isProblem(r)) {
      this.standNumber = before;
      this.nextId = idBefore;
    }
    return r;
  }

  private buildGaBlock(cmd: Extract<Command, { type: 'buildGaBlock' }>, ctx: BuildContext, cash: number): BuildResult {
    const n = Math.floor(cmd.count);
    if (n < 1 || n > 20) return { code: 'standCount', args: { max: 20 } };
    const spacing = AIRFIELD.codes.A.spanM + 5;
    const d = compassVector(cmd.headingDeg);
    const perp = { x: -d.y, y: d.x };
    const w = spacing * n + 10;
    const depth = 30;
    const o = { x: cmd.x - perp.x * 5 - d.x * 8, y: cmd.y - perp.y * 5 - d.y * 8 };
    const poly: Pt[] = [
      { x: o.x, y: o.y },
      { x: o.x + perp.x * w, y: o.y + perp.y * w },
      { x: o.x + perp.x * w + d.x * depth, y: o.y + perp.y * w + d.y * depth },
      { x: o.x + d.x * depth, y: o.y + d.y * depth },
    ];
    const idBefore = this.nextId;
    const numBefore = this.standNumber;
    const apronProblem = checkPolygon(ctx, poly);
    if (apronProblem) return apronProblem;
    const { pcr, factor } = tierOf('asphalt', 0);
    const apron: Apron = {
      id: this.nextId++,
      cost: Math.round(polygonArea(poly) * SURFACE_SPEC.asphalt.costPerM2 * factor),
      polygon: poly.map((p) => ({ x: round05(p.x), y: round05(p.y) })),
      surface: 'asphalt',
      pcr,
      condition: 100,
    };
    // The apron must exist for the stands to find their surface.
    this.data.aprons.push(apron);
    const stands = this.makeStands(cmd.x + d.x * 8, cmd.y + d.y * 8, cmd.headingDeg, n, spacing, 'gaTieDown', 'A', ctx);
    this.data.aprons.pop();
    if (!Array.isArray(stands)) {
      this.nextId = idBefore;
      this.standNumber = numBefore;
      return stands;
    }
    const r = this.place([{ type: 'apron', obj: apron }, ...stands], cash);
    if (isProblem(r)) {
      this.nextId = idBefore;
      this.standNumber = numBefore;
    }
    return r;
  }

  private demolish(kind: ObjType, id: number): BuildResult {
    const l = this.list(kind);
    const obj = l.find((o) => o.id === id);
    if (!obj) return { code: 'nothingThere' };
    const refund = Math.round((obj as unknown as { cost: number }).cost * REFUND_SHARE);
    const items: Item[] = [{ type: kind, obj: obj as Item['obj'] }];
    // Stands lose their apron with it only if the player demolishes them too.
    this.removeItems(items);
    return this.record(items, false, refund);
  }

  private setTaxiwayProps(cmd: Extract<Command, { type: 'setTaxiwayProps' }>): BuildResult {
    const t = this.data.taxiways.find((x) => x.id === cmd.id);
    if (!t) return { code: 'nothingThere' };
    if (cmd.oneWay !== undefined) t.oneWay = cmd.oneWay;
    if (cmd.preferred !== undefined) t.preferred = cmd.preferred === 0 ? 0 : cmd.preferred > 0 ? 1 : -1;
    if (cmd.closed !== undefined) t.closed = cmd.closed;
    if (cmd.userMaxCode !== undefined) t.userMaxCode = cmd.userMaxCode;
    if (cmd.speedKmh !== undefined) t.speedKmh = Math.max(5, Math.min(80, Math.round(cmd.speedKmh)));
    this.refresh();
    return { cashDelta: 0 };
  }

  /**
   * Starts surface works on a taxiway: the cash change is booked now, the taxiway closes, and the new
   * surface takes effect when the works finish (docs/DESIGN_REVISION_2.md section 2.5).
   */
  private startWorks(t: Taxiway, surface: Surface, tier: number, cash: number, env: BuildEnv, extraCost = 0): BuildResult {
    if (t.works) return { code: 'worksRunning' };
    if (!surfaceAllowsCode(surface, t.code)) return { code: 'surfaceCode', args: { code: t.code } };
    const { pcr, factor } = tierOf(surface, tier);
    if (surface === t.surface && pcr === t.pcr) return extraCost > cash ? { code: 'insufficientFunds', args: { cost: extraCost } } : { cashDelta: -extraCost };
    const change = surfaceChange(t, surface, tier);
    if (!change.upgrade) {
      const blocked = excludedType(t.code, surface, env.assignedTypes);
      if (blocked) return { code: 'surfaceExcludesType', args: { type: blocked } };
    }
    const net = change.cashDelta - extraCost;
    if (-net > cash) return { code: 'insufficientFunds', args: { cost: -net } };
    const area = polylineLength(t.points) * t.widthM;
    t.works = { surface, pcr, cost: Math.round(area * SURFACE_SPEC[surface].costPerM2 * factor), doneTick: env.tick + worksTicks(change.days) };
    this.refresh();
    return { cashDelta: net };
  }

  /** Finishes the works that are due. Called once per tick; cheap when nothing is under works. */
  update(tick: number): void {
    let done = false;
    for (const t of this.data.taxiways) {
      const w = t.works;
      if (!w || w.doneTick > tick) continue;
      t.surface = w.surface;
      t.pcr = w.pcr;
      t.cost = w.cost;
      t.condition = 100;
      delete t.works;
      done = true;
    }
    if (done) this.refresh();
  }

  private resurface(cmd: Extract<Command, { type: 'resurface' }>, cash: number, env: BuildEnv): BuildResult {
    if (cmd.kind === 'taxiway') {
      const t = this.data.taxiways.find((x) => x.id === cmd.id);
      if (!t) return { code: 'nothingThere' };
      return this.startWorks(t, cmd.surface, cmd.tier, cash, env);
    }
    const obj = cmd.kind === 'runway' ? this.data.runways.find((x) => x.id === cmd.id) : this.data.aprons.find((x) => x.id === cmd.id);
    if (!obj) return { code: 'nothingThere' };
    if (cmd.kind === 'runway' && (obj as Runway).approach !== 'visual' && !isPaved(cmd.surface)) return { code: 'approachNeedsPaved' };
    const { pcr, factor } = tierOf(cmd.surface, cmd.tier);
    const area = cmd.kind === 'runway' ? (obj as Runway).lengthM * ((obj as Runway).widthM + 2 * (obj as Runway).shoulderM) : polygonArea((obj as Apron).polygon);
    const cost = Math.round(area * SURFACE_SPEC[cmd.surface].costPerM2 * factor * 0.6);
    if (cost > cash) return { code: 'insufficientFunds', args: { cost } };
    const o = obj as Runway | Apron;
    o.surface = cmd.surface;
    o.pcr = pcr;
    o.condition = 100;
    this.refresh();
    return { cashDelta: -cost };
  }

  /**
   * Changes a taxiway's class (width) now and its surface or strength through works. Wider costs the
   * difference, narrower refunds a share. A code that the current surface does not allow needs a
   * surface change in the same command (docs/DESIGN_REVISION_2.md section 2.5).
   */
  private reclassTaxiway(cmd: Extract<Command, { type: 'reclassTaxiway' }>, ctx: BuildContext, cash: number, env: BuildEnv): BuildResult {
    const t = this.data.taxiways.find((x) => x.id === cmd.id);
    if (!t) return { code: 'nothingThere' };
    if (!surfaceAllowsCode(cmd.surface, cmd.code)) return { code: 'surfaceCode', args: { code: cmd.code } };
    const width = AIRFIELD.codes[cmd.code].taxiwayWidthM;
    if (width > t.widthM) {
      const problem = checkStrip(ctx, t.points, width);
      if (problem) return problem;
    }
    const oldUnit = SURFACE_SPEC[t.surface].costPerM2 * tierOf(t.surface, Math.max(0, SURFACE_SPEC[t.surface].pcrTiers.indexOf(t.pcr))).factor;
    const delta = polylineLength(t.points) * (width - t.widthM) * oldUnit;
    const widthCost = Math.round(delta > 0 ? delta : delta * SURFACE_SPEC[t.surface].refundShare);
    const before = { code: t.code, widthM: t.widthM, userMaxCode: t.userMaxCode, cost: t.cost };
    t.code = cmd.code;
    t.widthM = width;
    t.userMaxCode = cmd.code;
    t.cost = Math.max(0, t.cost + Math.round(Math.max(0, delta)));
    const r = this.startWorks(t, cmd.surface, cmd.tier, cash, env, widthCost);
    if (isProblem(r)) Object.assign(t, before);
    this.refresh();
    return r;
  }

  /** Cost per square meter for a runway at its current strength tier. */
  private unitCost(r: Runway): number {
    const tiers = SURFACE_SPEC[r.surface].pcrTiers;
    return SURFACE_SPEC[r.surface].costPerM2 * tierOf(r.surface, Math.max(0, tiers.indexOf(r.pcr))).factor;
  }

  /**
   * Extends or shortens a runway at one end. The new section joins the old one, so it stays a single
   * runway. Shortening is refused while a taxiway or exit still uses the part that would go.
   */
  private resizeRunway(cmd: Extract<Command, { type: 'resizeRunway' }>, ctx: BuildContext, cash: number): BuildResult {
    const r = this.data.runways.find((x) => x.id === cmd.id);
    if (!r) return { code: 'nothingThere' };
    const delta = Math.round(cmd.deltaM / 5) * 5;
    const newLen = r.lengthM + delta;
    if (delta === 0 || newLen < MIN_RUNWAY_M || newLen > MAX_RUNWAY_M) return { code: 'runwayLength', args: { min: MIN_RUNWAY_M, max: MAX_RUNWAY_M } };
    const d = compassVector(r.headingDeg);
    const fullW = r.widthM + 2 * r.shoulderM;
    const unit = this.unitCost(r);
    if (delta > 0) {
      const from = cmd.end === 'b' ? { x: r.x2, y: r.y2 } : { x: r.x1, y: r.y1 };
      const sign = cmd.end === 'b' ? 1 : -1;
      const to = { x: round05(from.x + d.x * delta * sign), y: round05(from.y + d.y * delta * sign) };
      const problem = checkStrip(ctx, [from, to], fullW);
      if (problem) return problem;
      for (const o of this.data.runways) {
        if (o.id !== r.id && segSegDist(from.x, from.y, to.x, to.y, o.x1, o.y1, o.x2, o.y2) < MIN_RUNWAY_SEP_M) return { code: 'runwayTooClose', args: { min: MIN_RUNWAY_SEP_M } };
      }
      const cost = Math.round(delta * fullW * unit) + stripGradingCost(ctx, [from, to], fullW);
      if (cost > cash) return { code: 'insufficientFunds', args: { cost } };
      if (cmd.end === 'b') {
        r.x2 = to.x;
        r.y2 = to.y;
      } else {
        r.x1 = to.x;
        r.y1 = to.y;
      }
      r.lengthM = newLen;
      r.cost += cost;
      this.refresh();
      return { cashDelta: -cost };
    }
    // Shorten: nothing may be attached to the part that is removed.
    const cut = -delta;
    const edge = r.widthM / 2 + r.shoulderM + 8;
    const touches = (x: number, y: number): boolean => {
      const f = runwayFrame(r, x, y);
      if (Math.abs(f.lateral) > edge) return false;
      return cmd.end === 'b' ? f.s > newLen - 5 && f.s <= r.lengthM + 5 : f.s < cut + 5 && f.s >= -5;
    };
    for (const t of this.data.taxiways) {
      if (t.points.some((p) => touches(p.x, p.y))) return { code: 'runwayInUse' };
    }
    const refund = Math.round(cut * fullW * unit * REFUND_SHARE);
    if (cmd.end === 'b') {
      r.x2 = round05(r.x2 - d.x * cut);
      r.y2 = round05(r.y2 - d.y * cut);
    } else {
      r.x1 = round05(r.x1 + d.x * cut);
      r.y1 = round05(r.y1 + d.y * cut);
    }
    r.lengthM = newLen;
    r.cost = Math.max(0, r.cost - Math.round(cut * fullW * unit));
    this.refresh();
    return { cashDelta: refund };
  }

  /**
   * Changes the class (width and shoulders) and the approach category of a runway. Connectors that end
   * at the old pavement edge follow the new edge. Strength is changed through resurfacing.
   */
  private reclassRunway(cmd: Extract<Command, { type: 'reclassRunway' }>, ctx: BuildContext, cash: number): BuildResult {
    const r = this.data.runways.find((x) => x.id === cmd.id);
    if (!r) return { code: 'nothingThere' };
    const paved = isPaved(r.surface);
    if (!paved && cmd.approach !== 'visual') return { code: 'approachNeedsPaved' };
    const row = AIRFIELD.codes[cmd.code];
    const newW = row.runwayWidthM;
    const newSh = paved ? row.runwayShoulderM : 0;
    const oldFull = r.widthM + 2 * r.shoulderM;
    const newFull = newW + 2 * newSh;
    if (newFull > oldFull) {
      const problem = checkStrip(ctx, [{ x: r.x1, y: r.y1 }, { x: r.x2, y: r.y2 }], newFull);
      if (problem) return problem;
    }
    const unit = this.unitCost(r);
    const areaCost = (newFull - oldFull) * r.lengthM * unit;
    const fee = APPROACH_FEE[cmd.approach] - APPROACH_FEE[r.approach];
    const net = Math.round((areaCost > 0 ? areaCost : areaCost * REFUND_SHARE) + (fee > 0 ? fee : fee * REFUND_SHARE));
    if (net > cash) return { code: 'insufficientFunds', args: { cost: net } };
    // Connectors that meet the pavement edge move with it.
    const oldEdge = r.widthM / 2 + r.shoulderM;
    const newEdge = newW / 2 + newSh;
    const d = compassVector(r.headingDeg);
    for (const t of this.data.taxiways) {
      for (const endIdx of [0, t.points.length - 1]) {
        const e = t.points[endIdx];
        const nb = t.points[endIdx === 0 ? 1 : t.points.length - 2];
        const f = runwayFrame(r, e.x, e.y);
        if (f.s < -5 || f.s > r.lengthM + 5 || Math.abs(Math.abs(f.lateral) - oldEdge) > 6) continue;
        const l = Math.hypot(e.x - nb.x, e.y - nb.y) || 1;
        const ux = (e.x - nb.x) / l;
        const uy = (e.y - nb.y) / l;
        const rate = ux * d.y + uy * -d.x;
        if (Math.abs(rate) < 0.2) continue;
        const tt = (Math.sign(f.lateral) * newEdge - f.lateral) / rate;
        if (Math.abs(tt) > 80) continue;
        const moved = { x: round05(e.x + ux * tt), y: round05(e.y + uy * tt) };
        const other = t.points[endIdx === 0 ? 1 : t.points.length - 2];
        if (Math.hypot(moved.x - other.x, moved.y - other.y) < 8) continue;
        t.points[endIdx] = moved;
      }
    }
    r.code = cmd.code;
    r.widthM = newW;
    r.shoulderM = newSh;
    r.approach = cmd.approach;
    r.cost = Math.max(0, r.cost + Math.round(areaCost > 0 ? areaCost : 0));
    this.refresh();
    return { cashDelta: -net };
  }

  /**
   * Edits a taxiway: extend from an end with more points, trim an end back to a point, or cut a
   * section out of the middle, which leaves two taxiways.
   */
  private editTaxiway(cmd: Extract<Command, { type: 'editTaxiway' }>, ctx: BuildContext, cash: number): BuildResult {
    const t = this.data.taxiways.find((x) => x.id === cmd.id);
    if (!t) return { code: 'nothingThere' };
    const lenOf = (pts: Pt[]): number => {
      let l = 0;
      for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return l;
    };
    const unit = SURFACE_SPEC[t.surface].costPerM2 * (SURFACE_DATA.tierCostFactor[Math.max(0, SURFACE_SPEC[t.surface].pcrTiers.indexOf(t.pcr))] ?? 1);
    if (cmd.op === 'extend') {
      const add = (cmd.points ?? []).map((p) => ({ x: round05(p.x), y: round05(p.y) }));
      if (add.length === 0) return { code: 'taxiwayPoints' };
      const base = cmd.end === 'start' ? t.points[0] : t.points[t.points.length - 1];
      const chain = [base, ...add];
      for (let i = 1; i < chain.length; i++) if (Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y) < 8) return { code: 'segmentTooShort', args: { min: 8 } };
      const next = cmd.end === 'start' ? [...add.slice().reverse(), ...t.points] : [...t.points, ...add];
      if (next.length > 60 || lenOf(next) > 8000) return { code: 'taxiwayTooLong', args: { max: 8000 } };
      const problem = checkStrip(ctx, chain, t.widthM);
      if (problem) return problem;
      const cost = Math.round(lenOf(chain) * t.widthM * unit) + stripGradingCost(ctx, chain, t.widthM);
      if (cost > cash) return { code: 'insufficientFunds', args: { cost } };
      t.points = next;
      t.cost += cost;
      this.refresh();
      return { cashDelta: -cost };
    }
    // Trim and cut work on the arc length of the point nearest the click.
    const arcOf = (p: Pt | undefined): number | null => {
      if (!p) return null;
      let best = Infinity;
      let at = 0;
      let run = 0;
      const c = { x: 0, y: 0, t: 0 };
      for (let i = 1; i < t.points.length; i++) {
        const a = t.points[i - 1];
        const b = t.points[i];
        closestOnSegment(p.x, p.y, a.x, a.y, b.x, b.y, c);
        const dd = Math.hypot(p.x - c.x, p.y - c.y);
        const sl = Math.hypot(b.x - a.x, b.y - a.y);
        if (dd < best) {
          best = dd;
          at = run + sl * c.t;
        }
        run += sl;
      }
      return best < 40 ? at : null;
    };
    const split = (s: number): { before: Pt[]; after: Pt[] } => {
      const before: Pt[] = [t.points[0]];
      const after: Pt[] = [];
      let run = 0;
      let done = false;
      for (let i = 1; i < t.points.length; i++) {
        const a = t.points[i - 1];
        const b = t.points[i];
        const sl = Math.hypot(b.x - a.x, b.y - a.y);
        if (!done && s <= run + sl) {
          const k = sl > 0 ? (s - run) / sl : 0;
          const m = { x: round05(a.x + (b.x - a.x) * k), y: round05(a.y + (b.y - a.y) * k) };
          before.push(m);
          after.push(m, b);
          done = true;
        } else if (!done) before.push(b);
        else after.push(b);
        run += sl;
      }
      return { before, after };
    };
    const total = lenOf(t.points);
    const s1 = arcOf(cmd.at);
    if (s1 === null) return { code: 'nothingThere' };
    const perM = total > 0 ? t.cost / total : 0;
    const MIN_PART = 8;
    if (cmd.op === 'trim') {
      const { before, after } = split(s1);
      const keep = cmd.end === 'start' ? after : before;
      if (lenOf(keep) < MIN_PART) return { code: 'segmentTooShort', args: { min: MIN_PART } };
      const removed = total - lenOf(keep);
      t.points = keep;
      t.cost = Math.max(0, Math.round(t.cost - perM * removed));
      this.refresh();
      return { cashDelta: Math.round(perM * removed * REFUND_SHARE) };
    }
    const s2 = arcOf(cmd.at2);
    if (s2 === null) return { code: 'nothingThere' };
    const lo = Math.min(s1, s2);
    const hi = Math.max(s1, s2);
    if (hi - lo < 4) return { code: 'segmentTooShort', args: { min: 4 } };
    const first = split(lo).before;
    const last = split(hi).after;
    const keepFirst = lenOf(first) >= MIN_PART;
    const keepLast = lenOf(last) >= MIN_PART;
    if (!keepFirst && !keepLast) return { code: 'segmentTooShort', args: { min: MIN_PART } };
    const kept = (keepFirst ? lenOf(first) : 0) + (keepLast ? lenOf(last) : 0);
    const refund = Math.round(perM * (total - kept) * REFUND_SHARE);
    if (keepFirst && keepLast) {
      const second: Taxiway = { ...t, id: this.nextId++, points: last, cost: Math.round(perM * lenOf(last)), name: this.nextTaxiName() };
      t.points = first;
      t.cost = Math.round(perM * lenOf(first));
      this.data.taxiways.push(second);
    } else {
      t.points = keepFirst ? first : last;
      t.cost = Math.round(perM * kept);
    }
    this.refresh();
    return { cashDelta: refund };
  }

  /** Puts copies of the given taxiway states in place of the taxiways with the same ids. */
  private applySwaps(states: readonly Taxiway[]): void {
    for (const st of states) {
      const i = this.data.taxiways.findIndex((x) => x.id === st.id);
      if (i >= 0) this.data.taxiways[i] = structuredClone(st);
    }
  }

  private undo(cash: number): BuildResult {
    const op = this.undoStack[this.undoStack.length - 1];
    if (!op) return { code: 'nothingToUndo' };
    // Undoing an addition refunds it. Undoing a demolition re-adds it and takes the refund back.
    if (-op.cashDelta < 0 && cash < op.cashDelta) return { code: 'insufficientFunds', args: { cost: op.cashDelta } };
    this.undoStack.pop();
    if (op.swaps) this.applySwaps(op.swaps.map((w) => w.before));
    if (op.added) this.removeItems(op.items);
    else this.addItems(op.items);
    this.redoStack.push(op);
    return { cashDelta: -op.cashDelta };
  }

  private redo(cash: number): BuildResult {
    const op = this.redoStack[this.redoStack.length - 1];
    if (!op) return { code: 'nothingToRedo' };
    if (op.cashDelta < 0 && cash < -op.cashDelta) return { code: 'insufficientFunds', args: { cost: -op.cashDelta } };
    this.redoStack.pop();
    if (op.swaps) this.applySwaps(op.swaps.map((w) => w.after));
    if (op.added) this.addItems(op.items);
    else this.removeItems(op.items);
    this.undoStack.push(op);
    return { cashDelta: op.cashDelta };
  }

  /** Everything needed to rebuild the airfield. Undo history is not saved. */
  saveState(): unknown {
    const d = this.data;
    return { runways: d.runways, taxiways: d.taxiways, aprons: d.aprons, stands: d.stands, nextId: this.nextId, nameIndex: this.nameIndex, standNumber: this.standNumber, version: d.version };
  }

  loadState(raw: unknown): void {
    const o = raw as { runways: Runway[]; taxiways: Taxiway[]; aprons: Apron[]; stands: Stand[]; nextId: number; nameIndex: number; standNumber: number; version: number };
    const d = this.data;
    d.runways = o.runways;
    d.taxiways = o.taxiways;
    d.aprons = o.aprons;
    d.stands = o.stands;
    this.nextId = o.nextId;
    this.nameIndex = o.nameIndex;
    this.standNumber = o.standNumber;
    this.undoStack = [];
    this.redoStack = [];
    this.refresh();
    d.version = o.version + 1;
  }

  /** Folds the airfield into a state hash. */
  hash(h: number): number {
    let acc = foldU32(h, this.nextId);
    const r = (v: number): number => Math.round(v * 2);
    for (const x of this.data.runways) {
      acc = foldU32(foldU32(foldU32(acc, x.id), r(x.x1)), r(x.y1));
      acc = foldU32(foldU32(acc, x.headingDeg), x.lengthM);
    }
    for (const t of this.data.taxiways) {
      acc = foldU32(foldU32(acc, t.id), t.points.length);
      acc = foldU32(foldU32(acc, codeIndex(t.maxCode)), (t.closed ? 1 : 0) + (t.oneWay ? 2 : 0) + ((t.preferred ?? 0) + 1) * 4);
      acc = foldU32(foldU32(acc, surfaceRank(t.surface)), t.works ? t.works.doneTick % 0xffffffff : 0);
      for (const p of t.points) acc = foldU32(foldU32(acc, r(p.x)), r(p.y));
    }
    for (const a of this.data.aprons) acc = foldU32(foldU32(acc, a.id), a.polygon.length);
    for (const s of this.data.stands) acc = foldU32(foldU32(foldU32(acc, s.id), r(s.x)), r(s.y));
    return acc;
  }
}
