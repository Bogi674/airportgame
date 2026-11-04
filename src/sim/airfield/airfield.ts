import { AIRFIELD } from '@data/index';
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
import { foldU32 } from '../hash';
import type { Command } from '../commands';
import { rapidExitPoints } from '@shared/airfieldGeom';
import { assignRunwayNames, deriveNetwork } from './geometry';

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
}

export type BuildResult = { cashDelta: number } | Problem;
export const isProblem = (r: BuildResult): r is Problem => 'code' in r;

const TAXI_NAMES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MIN_RUNWAY_M = 300;
const MAX_RUNWAY_M = 5000;
const MIN_RUNWAY_SEP_M = 100;
const REFUND_SHARE = 0.25;
const round05 = (v: number): number => Math.round(v * 2) / 2;

function tierOf(surface: Surface, tier: number): { pcr: number; factor: number } {
  const tiers = AIRFIELD.surfaces[surface].pcrTiers;
  const i = Math.max(0, Math.min(tiers.length - 1, Math.floor(tier)));
  return { pcr: tiers[i], factor: AIRFIELD.tierCostFactor[i] ?? 1 };
}

const isPaved = (s: Surface): boolean => s === 'asphalt' || s === 'concrete';

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
  execute(cmd: Command, ctx: BuildContext, cash: number): BuildResult | null {
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
        return this.resurface(cmd, cash);
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
    const cost = Math.round(area * AIRFIELD.surfaces[cmd.surface].costPerM2 * factor) + stripGradingCost(ctx, [a, b], width + 2 * shoulder);
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
    const width = AIRFIELD.codes[code].taxiwayWidthM;
    const problem = checkStrip(ctx, points, width);
    if (problem) return problem;
    const { pcr, factor } = tierOf(surface, tier);
    let len = 0;
    for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const cost = Math.round(len * width * AIRFIELD.surfaces[surface].costPerM2 * factor) + stripGradingCost(ctx, points, width);
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

  private buildTaxiway(cmd: Extract<Command, { type: 'buildTaxiway' }>, ctx: BuildContext, cash: number): BuildResult {
    const pts = cmd.points.map((p) => ({ x: round05(p.x), y: round05(p.y) }));
    if (pts.length < 2 || pts.length > 60) return { code: 'taxiwayPoints' };
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (d < 8) return { code: 'segmentTooShort', args: { min: 8 } };
      total += d;
    }
    if (total > 8000) return { code: 'taxiwayTooLong', args: { max: 8000 } };
    const t = this.makeTaxiway(pts, cmd.code, cmd.kind, cmd.surface, cmd.tier, this.nextTaxiName(), ctx);
    if (!('points' in t)) {
      this.nameIndex--;
      return t;
    }
    return this.place([{ type: 'taxiway', obj: t }], cash);
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
      cost: Math.round(area * AIRFIELD.surfaces[cmd.surface].costPerM2 * factor),
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
      cost: Math.round(polygonArea(poly) * AIRFIELD.surfaces.asphalt.costPerM2 * factor),
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

  private resurface(cmd: Extract<Command, { type: 'resurface' }>, cash: number): BuildResult {
    const obj =
      cmd.kind === 'runway'
        ? this.data.runways.find((x) => x.id === cmd.id)
        : cmd.kind === 'taxiway'
          ? this.data.taxiways.find((x) => x.id === cmd.id)
          : this.data.aprons.find((x) => x.id === cmd.id);
    if (!obj) return { code: 'nothingThere' };
    if (cmd.kind === 'runway' && (obj as Runway).approach !== 'visual' && !isPaved(cmd.surface)) return { code: 'approachNeedsPaved' };
    const { pcr, factor } = tierOf(cmd.surface, cmd.tier);
    let area = 0;
    if (cmd.kind === 'runway') area = (obj as Runway).lengthM * ((obj as Runway).widthM + 2 * (obj as Runway).shoulderM);
    else if (cmd.kind === 'taxiway') {
      const t = obj as Taxiway;
      for (let i = 1; i < t.points.length; i++) area += Math.hypot(t.points[i].x - t.points[i - 1].x, t.points[i].y - t.points[i - 1].y) * t.widthM;
    } else area = polygonArea((obj as Apron).polygon);
    const cost = Math.round(area * AIRFIELD.surfaces[cmd.surface].costPerM2 * factor * 0.6);
    if (cost > cash) return { code: 'insufficientFunds', args: { cost } };
    const o = obj as Runway | Taxiway | Apron;
    o.surface = cmd.surface;
    o.pcr = pcr;
    o.condition = 100;
    this.refresh();
    return { cashDelta: -cost };
  }

  private undo(cash: number): BuildResult {
    const op = this.undoStack[this.undoStack.length - 1];
    if (!op) return { code: 'nothingToUndo' };
    // Undoing an addition refunds it. Undoing a demolition re-adds it and takes the refund back.
    if (-op.cashDelta < 0 && cash < op.cashDelta) return { code: 'insufficientFunds', args: { cost: op.cashDelta } };
    this.undoStack.pop();
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
      for (const p of t.points) acc = foldU32(foldU32(acc, r(p.x)), r(p.y));
    }
    for (const a of this.data.aprons) acc = foldU32(foldU32(acc, a.id), a.polygon.length);
    for (const s of this.data.stands) acc = foldU32(foldU32(foldU32(acc, s.id), r(s.x)), r(s.y));
    return acc;
  }
}
