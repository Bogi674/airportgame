import { AIRFIELD } from '@data/index';
import { codeIndex, compassVector, CODES, type AirfieldPayload, type CodeLetter, type Runway } from '@shared/airfield';
import {
  frameHeadings,
  pickObject,
  rapidExitPoints,
  runwayFrame,
  snapToCenterline,
  snapToVertex,
  suggestedExitDistance,
} from '@shared/airfieldGeom';
import type { Ghost, GhostShape } from '@shared/ghost';
import { pointInPolygon, type Pt } from '@shared/geom';
import { windBand, type SitePayload } from '@shared/site';
import { TERMINAL_GRID, WALL, type TerminalGrid } from '@shared/business';
import { cellAtWorld, newGrid, originFor, planEdit, rectWorld, worldToCell, cornerWorld, type TerminalEdit } from '@shared/terminalOps';
import { checkPolygon, checkStrip, estimateStripCost, polygonArea, unownedParcelsUnder, type BuildContext, type Problem } from '@shared/validate';
import type { Command } from '@sim/commands';
import { formatMoney } from '../format';
import { tFormat, type StringKey } from '../strings';
import { useGameStore } from '../stores/gameStore';
import { useToolStore } from '../stores/toolStore';

export interface Mods {
  shift: boolean;
  alt: boolean;
}

interface Deps {
  send(cmd: Command): void;
  setGhost(g: Ghost | null): void;
  zoom(): number;
}

const compassOf = (dx: number, dy: number): number => ((Math.round((Math.atan2(dx, -dy) * 180) / Math.PI) % 360) + 360) % 360;

/**
 * Turns pointer input into previews and build commands for the active tool. It holds
 * only the in progress gesture, everything else lives in the tool and game stores.
 */
export class ToolController {
  private start: Pt | null = null;
  private pts: Pt[] = [];
  private cursor: Pt = { x: 0, y: 0 };
  private dragging = false;
  /** After a refused drag the preview and its buy offer stay up until the next press. */
  private frozen = false;

  constructor(private readonly deps: Deps) {}

  private get af(): AirfieldPayload {
    return useGameStore.getState().airfield;
  }

  private ctx(): BuildContext | null {
    const { site, owner } = useGameStore.getState();
    if (!site || !owner) return null;
    return { heights: site.heights, parcelId: site.parcelId, parcelOwner: owner };
  }

  private site(): SitePayload | null {
    return useGameStore.getState().site;
  }

  reset(): void {
    this.start = null;
    this.pts = [];
    this.dragging = false;
    this.frozen = false;
    this.tStart = null;
    this.tGrid = null;
    this.deps.setGhost(null);
    useToolStore.getState().set({ hint: null, problem: null, buy: null });
  }

  /** Snaps to vertices, centerlines and the alignment frame. Shift gives 15 degree steps, Alt is free. */
  private snap(p: Pt, prev: Pt | null, mods: Mods, centerlines: boolean): Pt {
    const radius = Math.max(6, 12 / this.deps.zoom());
    const v = snapToVertex(this.af, p.x, p.y, radius);
    if (v) return v;
    if (centerlines) {
      const c = snapToCenterline(this.af, p.x, p.y, radius * 0.7);
      if (c) return c;
    }
    if (!prev || mods.alt) return p;
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return p;
    const site = this.site();
    const frames = frameHeadings(this.af, site ? site.corridor.headingDeg : 0);
    const stepDeg = mods.shift ? 15 : 90;
    const tol = mods.shift ? 7.5 : 6;
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    let best = Infinity;
    let target = angle;
    for (const f of frames) {
      for (let k = 0; k < 360 / stepDeg; k++) {
        const cand = f + k * stepDeg;
        const diff = Math.abs(((angle - cand + 540) % 360) - 180);
        if (diff < best) {
          best = diff;
          target = cand;
        }
      }
    }
    if (best > tol) return p;
    const dir = compassVector(target);
    return { x: prev.x + dir.x * len, y: prev.y + dir.y * len };
  }

  /** Checks land and ownership, and fills the buy offer when land is what is missing. */
  private landProblem(strip: { pts: Pt[]; widthM: number } | { polygon: Pt[] }): Problem | null {
    const ctx = this.ctx();
    if (!ctx) return null;
    const problem = 'polygon' in strip ? checkPolygon(ctx, strip.polygon) : checkStrip(ctx, strip.pts, strip.widthM);
    if (problem && problem.code === 'notOwned') {
      const ids = unownedParcelsUnder(ctx, strip);
      const site = this.site();
      let cost = 0;
      if (site) for (const id of ids) cost += site.parcelPrice[id];
      useToolStore.getState().set({ buy: { ids, cost } });
    } else {
      useToolStore.getState().set({ buy: null });
    }
    return problem;
  }

  private show(g: Ghost, problem: Problem | null, hint: string | null): void {
    this.deps.setGhost(g);
    useToolStore.getState().set({ problem, hint });
  }

  down(p: Pt, mods: Mods): void {
    this.cursor = p;
    this.frozen = false;
    const tool = useToolStore.getState().tool;
    if (tool === 'runway') {
      this.start = this.snap(p, null, mods, false);
      this.dragging = true;
    } else if (tool === 'terminal') {
      this.terminalDown(p);
    }
  }

  move(p: Pt, mods: Mods): void {
    this.cursor = p;
    const st = useToolStore.getState();
    switch (st.tool) {
      case 'runway':
        this.previewRunway(p, mods);
        break;
      case 'taxiway':
      case 'taxilane':
        this.previewTaxiway(p, mods, st.tool === 'taxilane');
        break;
      case 'rapidExit':
        this.previewRapidExit(p);
        break;
      case 'parallel':
        this.previewParallel(p);
        break;
      case 'apron':
        this.previewApron(p, mods);
        break;
      case 'stands':
      case 'gaBlock':
        this.previewStands(p);
        break;
      case 'terminal':
        this.previewTerminal(p);
        break;
      case 'demolish':
        this.previewDemolish(p);
        break;
      default:
        break;
    }
  }

  up(p: Pt, mods: Mods): void {
    const st = useToolStore.getState();
    this.cursor = p;
    switch (st.tool) {
      case 'runway':
        this.finishRunway(p, mods);
        break;
      case 'taxiway':
      case 'taxilane': {
        const prev = this.pts.length > 0 ? this.pts[this.pts.length - 1] : null;
        const q = this.snap(p, prev, mods, true);
        if (prev && Math.hypot(q.x - prev.x, q.y - prev.y) < 3) break;
        this.pts.push(q);
        this.previewTaxiway(p, mods, st.tool === 'taxilane');
        break;
      }
      case 'apron': {
        const prev = this.pts.length > 0 ? this.pts[this.pts.length - 1] : null;
        this.pts.push(this.snap(p, prev, mods, false));
        this.previewApron(p, mods);
        break;
      }
      case 'rapidExit':
        this.commitRapidExit(p);
        break;
      case 'parallel':
        this.commitParallel(p);
        break;
      case 'stands':
      case 'gaBlock':
        this.commitStands(p);
        break;
      case 'terminal':
        this.finishTerminal(p);
        break;
      case 'demolish': {
        const hit = pickObject(this.af, p.x, p.y, Math.max(8, 14 / this.deps.zoom()));
        if (hit) this.deps.send({ type: 'demolish', kind: hit.kind, id: hit.id });
        break;
      }
      case 'select': {
        const hit = pickObject(this.af, p.x, p.y, Math.max(8, 14 / this.deps.zoom()));
        const term = hit ? null : this.terminalAt(p);
        useToolStore.getState().set({ selection: hit ? { kind: hit.kind, id: hit.id } : term ? { kind: 'terminal', id: term } : null });
        break;
      }
    }
    this.dragging = false;
  }

  /** Double click finishes polylines. */
  finish(): void {
    const tool = useToolStore.getState().tool;
    if (tool === 'taxiway' || tool === 'taxilane') this.commitTaxiway(tool === 'taxilane');
    else if (tool === 'apron') this.commitApron();
  }

  key(e: KeyboardEvent): boolean {
    const st = useToolStore.getState();
    if (e.key === 'Escape') {
      this.reset();
      st.set({ tool: 'select', selection: null });
      return true;
    }
    if (e.key === 'Enter') {
      this.finish();
      return true;
    }
    if (e.key === 'Backspace' && this.pts.length > 0) {
      this.pts.pop();
      this.move(this.cursor, { shift: false, alt: false });
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && (st.tool === 'stands' || st.tool === 'gaBlock' || st.tool === 'terminal')) {
      st.set({ rowHeading: (st.rowHeading + (e.shiftKey ? 15 : 90)) % 360 });
      this.move(this.cursor, { shift: false, alt: false });
      return true;
    }
    return false;
  }

  // Runway ---------------------------------------------------------------

  private runwayShape(a: Pt, heading: number, length: number): { shapes: GhostShape[]; pts: Pt[]; width: number } {
    const st = useToolStore.getState();
    const row = AIRFIELD.codes[st.code];
    const paved = st.surface === 'asphalt' || st.surface === 'concrete';
    const width = row.runwayWidthM + (paved ? 2 * row.runwayShoulderM : 0);
    const d = compassVector(heading);
    const b = { x: a.x + d.x * length, y: a.y + d.y * length };
    const strip = AIRFIELD.stripWidthM[st.approach];
    return {
      shapes: [
        { k: 'box', x: a.x, y: a.y, headingDeg: heading, len: length, w: strip },
        { k: 'box', x: a.x, y: a.y, headingDeg: heading, len: length, w: width },
      ],
      pts: [a, b],
      width,
    };
  }

  private runwayGeometry(p: Pt, mods: Mods): { heading: number; length: number } | null {
    if (!this.start) return null;
    const dx = p.x - this.start.x;
    const dy = p.y - this.start.y;
    const heading = mods.alt ? compassOf(dx, dy) : compassOf(dx, dy);
    return { heading, length: Math.min(5000, Math.round(Math.hypot(dx, dy))) };
  }

  private previewRunway(p: Pt, mods: Mods): void {
    const st = useToolStore.getState();
    if (this.frozen && !this.dragging) return;
    const g = this.runwayGeometry(p, mods);
    if (!this.start || !this.dragging || !g) {
      this.deps.setGhost({ valid: true, shapes: [{ k: 'ring', x: p.x, y: p.y, r: 15 }] });
      st.set({ hint: 'hint.runway', problem: null, buy: null });
      return;
    }
    const shape = this.runwayShape(this.start, g.heading, g.length);
    let problem: Problem | null;
    if (g.length < 300) problem = { code: 'runwayLength', args: { min: 300, max: 5000 } };
    else if (st.approach !== 'visual' && st.surface !== 'asphalt' && st.surface !== 'concrete') problem = { code: 'approachNeedsPaved' };
    else problem = this.landProblem({ pts: shape.pts, widthM: shape.width });
    const site = this.site();
    const band = site ? windBand(g.heading % 180, site.idealHeadingDeg) : 'acceptable';
    const ctx = this.ctx();
    const cost = ctx ? estimateStripCost(ctx, shape.pts, shape.width, st.surface, st.tier) : 0;
    this.show(
      {
        valid: problem === null,
        shapes: shape.shapes,
        label: {
          x: p.x,
          y: p.y,
          text: tFormat('ghost.runway', { len: g.length, hdg: String(g.heading).padStart(3, '0'), band: tFormat(`wind.${band}` as StringKey, {}), cost: formatMoney(cost) }),
        },
      },
      problem,
      'hint.runwayDrag',
    );
  }

  private finishRunway(p: Pt, mods: Mods): void {
    const st = useToolStore.getState();
    const g = this.runwayGeometry(p, mods);
    const start = this.start;
    this.start = null;
    this.dragging = false;
    if (!start || !g || g.length < 300) {
      this.deps.setGhost(null);
      return;
    }
    // A refused runway keeps its preview and the reason on screen, so land can be bought first.
    if (useToolStore.getState().problem) {
      this.frozen = true;
      return;
    }
    this.deps.setGhost(null);
    this.deps.send({ type: 'buildRunway', x: start.x, y: start.y, headingDeg: g.heading, lengthM: g.length, code: st.code, approach: st.approach, surface: st.surface, tier: st.tier });
  }

  // Taxiways -------------------------------------------------------------

  private previewTaxiway(p: Pt, mods: Mods, lane: boolean): void {
    const st = useToolStore.getState();
    const prev = this.pts.length > 0 ? this.pts[this.pts.length - 1] : null;
    const q = this.snap(p, prev, mods, true);
    const width = AIRFIELD.codes[st.code].taxiwayWidthM;
    const pts = [...this.pts, q];
    const shapes: GhostShape[] = [{ k: 'ring', x: q.x, y: q.y, r: AIRFIELD.codes[st.code].spanM / 2 }];
    let problem: Problem | null = null;
    if (pts.length >= 2) {
      shapes.unshift({ k: 'strip', pts, w: width });
      problem = this.landProblem({ pts, widthM: width });
      if (!problem && prev && Math.hypot(q.x - prev.x, q.y - prev.y) < 8) problem = { code: 'segmentTooShort', args: { min: 8 } };
    }
    const ctx = this.ctx();
    const cost = ctx && pts.length >= 2 ? estimateStripCost(ctx, pts, width, st.surface, st.tier) : 0;
    this.show(
      { valid: problem === null, shapes, label: { x: q.x, y: q.y, text: tFormat('ghost.taxiway', { code: st.code, w: width, cost: formatMoney(cost) }) } },
      problem,
      lane ? 'hint.taxilane' : 'hint.taxiway',
    );
  }

  private commitTaxiway(lane: boolean): void {
    const st = useToolStore.getState();
    if (this.pts.length < 2) return;
    this.deps.send({ type: 'buildTaxiway', points: this.pts.slice(), code: st.code, kind: lane ? 'taxilane' : 'taxiway', surface: st.surface, tier: st.tier });
    this.pts = [];
    this.deps.setGhost(null);
  }

  // Rapid exit and parallel taxiway -------------------------------------

  private nearestRunway(p: Pt): Runway | null {
    let best: Runway | null = null;
    let bestD = 400;
    for (const r of this.af.runways) {
      const f = runwayFrame(r, p.x, p.y);
      if (f.s < -50 || f.s > r.lengthM + 50) continue;
      const d = Math.abs(f.lateral);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  private exitPlan(p: Pt): { r: Runway; dist: number; side: 'left' | 'right' } | null {
    const r = this.nearestRunway(p);
    if (!r) return null;
    const f = runwayFrame(r, p.x, p.y);
    return { r, dist: Math.max(200, Math.min(r.lengthM - 200, Math.round(f.s))), side: f.lateral >= 0 ? 'left' : 'right' };
  }

  private previewRapidExit(p: Pt): void {
    const st = useToolStore.getState();
    const plan = this.exitPlan(p);
    if (!plan) {
      this.deps.setGhost(null);
      st.set({ hint: 'hint.needRunway', problem: null, buy: null });
      return;
    }
    const pts = rapidExitPoints(plan.r, plan.dist, plan.side, st.exitAngle);
    const width = AIRFIELD.codes[st.code].taxiwayWidthM;
    const problem = this.landProblem({ pts, widthM: width });
    this.show(
      {
        valid: problem === null,
        shapes: [{ k: 'strip', pts, w: width }],
        label: { x: pts[0].x, y: pts[0].y, text: tFormat('ghost.exit', { dist: plan.dist, angle: st.exitAngle, suggest: suggestedExitDistance(plan.r.lengthM) }) },
      },
      problem,
      'hint.exit',
    );
  }

  private commitRapidExit(p: Pt): void {
    const st = useToolStore.getState();
    const plan = this.exitPlan(p);
    if (!plan) return;
    this.deps.send({ type: 'buildRapidExit', runwayId: plan.r.id, distM: plan.dist, side: plan.side, angleDeg: st.exitAngle, code: st.code, surface: st.surface, tier: st.tier });
  }

  private parallelPlan(p: Pt): { r: Runway; side: 'left' | 'right'; offset: number; pts: Pt[]; conn: Pt[][]; cap: CodeLetter } | null {
    const st = useToolStore.getState();
    const r = this.nearestRunway(p);
    if (!r) return null;
    const f = runwayFrame(r, p.x, p.y);
    const side = f.lateral >= 0 ? 'left' : 'right';
    const row = AIRFIELD.codes[st.code];
    const minOffset = Math.ceil(r.widthM / 2 + r.shoulderM + row.taxiwayWidthM / 2 + 15);
    const offset = Math.max(minOffset, Math.round(Math.abs(f.lateral)));
    const d = compassVector(r.headingDeg);
    const sign = side === 'left' ? 1 : -1;
    const n = { x: d.y * sign, y: -d.x * sign };
    const at = (s: number, off: number): Pt => ({ x: r.x1 + d.x * s + n.x * off, y: r.y1 + d.y * s + n.y * off });
    const edge = r.widthM / 2 + r.shoulderM;
    const count = Math.max(1, st.connectors);
    const inset = Math.min(60, r.lengthM / 4);
    const conn: Pt[][] = [];
    for (let i = 0; i < count; i++) {
      const s = count === 1 ? r.lengthM / 2 : inset + (i * (r.lengthM - 2 * inset)) / (count - 1);
      conn.push([at(s, offset), at(s, edge)]);
    }
    let cap: CodeLetter = 'A';
    for (const c of CODES) if (AIRFIELD.runwayToTaxiwaySepM[r.approach][c] <= offset) cap = c;
    if (codeIndex(cap) > codeIndex(st.code)) cap = st.code;
    return { r, side, offset, pts: [at(0, offset), at(r.lengthM, offset)], conn, cap };
  }

  private previewParallel(p: Pt): void {
    const st = useToolStore.getState();
    const plan = this.parallelPlan(p);
    if (!plan) {
      this.deps.setGhost(null);
      st.set({ hint: 'hint.needRunway', problem: null, buy: null });
      return;
    }
    const width = AIRFIELD.codes[st.code].taxiwayWidthM;
    let problem = this.landProblem({ pts: plan.pts, widthM: width });
    for (const c of plan.conn) problem = problem ?? this.landProblem({ pts: c, widthM: width });
    this.show(
      {
        valid: problem === null,
        shapes: [{ k: 'strip', pts: plan.pts, w: width }, ...plan.conn.map((c): GhostShape => ({ k: 'strip', pts: c, w: width }))],
        label: { x: plan.pts[0].x, y: plan.pts[0].y, text: tFormat('ghost.parallel', { offset: plan.offset, cap: plan.cap }) },
      },
      problem,
      'hint.parallel',
    );
  }

  private commitParallel(p: Pt): void {
    const st = useToolStore.getState();
    const plan = this.parallelPlan(p);
    if (!plan) return;
    this.deps.send({ type: 'buildParallelTaxiway', runwayId: plan.r.id, side: plan.side, offsetM: plan.offset, code: st.code, connectors: st.connectors, surface: st.surface, tier: st.tier });
  }

  // Apron ----------------------------------------------------------------

  private previewApron(p: Pt, mods: Mods): void {
    const st = useToolStore.getState();
    const prev = this.pts.length > 0 ? this.pts[this.pts.length - 1] : null;
    const q = this.snap(p, prev, mods, false);
    const pts = [...this.pts, q];
    const shapes: GhostShape[] = pts.length >= 3 ? [{ k: 'poly', pts }] : [{ k: 'strip', pts, w: 1 }];
    let problem: Problem | null = null;
    let area = 0;
    if (pts.length >= 3) {
      area = polygonArea(pts);
      problem = area < 400 ? { code: 'apronTooSmall', args: { min: 400 } } : this.landProblem({ polygon: pts });
    }
    const tierIdx = Math.min(st.tier, AIRFIELD.surfaces[st.surface].pcrTiers.length - 1);
    const cost = Math.round(area * AIRFIELD.surfaces[st.surface].costPerM2 * (AIRFIELD.tierCostFactor[tierIdx] ?? 1));
    this.show({ valid: problem === null, shapes, label: { x: q.x, y: q.y, text: tFormat('ghost.apron', { area: Math.round(area), cost: formatMoney(cost) }) } }, problem, 'hint.apron');
  }

  private commitApron(): void {
    const st = useToolStore.getState();
    if (this.pts.length < 3) return;
    this.deps.send({ type: 'buildApron', polygon: this.pts.slice(), surface: st.surface, tier: st.tier });
    this.pts = [];
    this.deps.setGhost(null);
  }

  // Stands ---------------------------------------------------------------

  private standPlan(p: Pt): { x: number; y: number; count: number; spacing: number; heading: number; code: CodeLetter; ga: boolean } {
    const st = useToolStore.getState();
    const ga = st.tool === 'gaBlock';
    const code = ga ? 'A' : st.standCode;
    return { x: p.x, y: p.y, count: ga ? st.gaCount : st.standCount, spacing: AIRFIELD.codes[code].spanM + (ga ? 5 : 7.5), heading: st.rowHeading, code, ga };
  }

  private previewStands(p: Pt): void {
    const plan = this.standPlan(p);
    const d = compassVector(plan.heading);
    const perp = { x: -d.y, y: d.x };
    const row = AIRFIELD.codes[plan.code];
    const shapes: GhostShape[] = [];
    for (let i = 0; i < plan.count; i++) {
      const sx = plan.x + perp.x * plan.spacing * i;
      const sy = plan.y + perp.y * plan.spacing * i;
      // The aircraft box extends backward from the nose stop position.
      shapes.push({ k: 'box', x: sx - d.x * row.standLengthM, y: sy - d.y * row.standLengthM, headingDeg: plan.heading, len: row.standLengthM, w: row.spanM });
    }
    let problem: Problem | null = null;
    if (this.ctx()) {
      const last = { x: plan.x + perp.x * plan.spacing * (plan.count - 1), y: plan.y + perp.y * plan.spacing * (plan.count - 1) };
      problem = this.landProblem({ pts: [{ x: plan.x, y: plan.y }, last], widthM: row.spanM });
      if (!problem && !plan.ga) {
        let onApron = true;
        for (let i = 0; i < plan.count && onApron; i++) {
          const sx = plan.x + perp.x * plan.spacing * i;
          const sy = plan.y + perp.y * plan.spacing * i;
          onApron = this.af.aprons.some((a) => pointInPolygon(sx, sy, a.polygon));
        }
        if (!onApron) problem = { code: 'standNeedsApron' };
      }
    }
    this.show({ valid: problem === null, shapes, label: { x: plan.x, y: plan.y, text: tFormat('ghost.stands', { n: plan.count, hdg: String(plan.heading).padStart(3, '0') }) } }, problem, plan.ga ? 'hint.gaBlock' : 'hint.stands');
  }

  private commitStands(p: Pt): void {
    const st = useToolStore.getState();
    const plan = this.standPlan(p);
    if (plan.ga) this.deps.send({ type: 'buildGaBlock', x: plan.x, y: plan.y, headingDeg: plan.heading, count: plan.count });
    else this.deps.send({ type: 'buildStands', x: plan.x, y: plan.y, headingDeg: plan.heading, count: plan.count, spacingM: plan.spacing, standType: st.standType, code: plan.code });
  }

  // Terminal ---------------------------------------------------------------

  private tStart: { cx: number; cy: number } | null = null;
  private tGrid: TerminalGrid | null = null;
  private tTemp: TerminalGrid | null = null;
  private readonly bboxCache = new WeakMap<TerminalGrid, { x0: number; y0: number; x1: number; y1: number } | null>();

  private floorBox(g: TerminalGrid): { x0: number; y0: number; x1: number; y1: number } | null {
    if (this.bboxCache.has(g)) return this.bboxCache.get(g) ?? null;
    const N = TERMINAL_GRID;
    let x0 = N;
    let y0 = N;
    let x1 = -1;
    let y1 = -1;
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        if (g.floor[cy * N + cx] === 0) continue;
        if (cx < x0) x0 = cx;
        if (cy < y0) y0 = cy;
        if (cx > x1) x1 = cx;
        if (cy > y1) y1 = cy;
      }
    }
    const box = x1 < 0 ? null : { x0, y0, x1, y1 };
    this.bboxCache.set(g, box);
    return box;
  }

  /** The existing building a point belongs to: inside or within four cells of its floor. */
  private buildingAt(p: Pt): TerminalGrid | null {
    for (const g of useGameStore.getState().terminalGrids) {
      const box = this.floorBox(g);
      if (!box) continue;
      const c = worldToCell(g, p.x, p.y);
      if (c.cx >= box.x0 - 4 && c.cx <= box.x1 + 5 && c.cy >= box.y0 - 4 && c.cy <= box.y1 + 5) return g;
    }
    return null;
  }

  /** The grid an edit at this point goes to: an existing building or a fresh one that starts here. */
  private gridFor(p: Pt): TerminalGrid {
    const existing = this.buildingAt(p);
    if (existing) return existing;
    const heading = useToolStore.getState().rowHeading;
    const o = originFor(Math.round(p.x / 2) * 2, Math.round(p.y / 2) * 2, heading);
    const t = this.tTemp;
    if (t && t.ox === o.ox && t.oy === o.oy && t.headingDeg === heading) return t;
    this.tTemp = newGrid(-1, o.ox, o.oy, heading);
    return this.tTemp;
  }

  private terminalAt(p: Pt): number | null {
    for (const g of useGameStore.getState().terminalGrids) {
      const c = cellAtWorld(g, p.x, p.y);
      if (c && g.floor[c.cy * TERMINAL_GRID + c.cx] > 0) return g.id;
    }
    return null;
  }

  private env() {
    const ctx = this.ctx();
    if (!ctx) return null;
    return { ctx, af: this.af, others: useGameStore.getState().terminalGrids };
  }

  /** Builds the edit for the current drag in the cell space of the grid. */
  private terminalEdit(g: TerminalGrid, a: { cx: number; cy: number }, b: { cx: number; cy: number }): TerminalEdit | null {
    const st = useToolStore.getState();
    const sub = st.tSub;
    if (sub === 'wall' || sub === 'door') {
      // Grid lines: horizontal when the drag is mostly along x.
      let x0 = Math.round(a.cx);
      let y0 = Math.round(a.cy);
      let x1 = Math.round(b.cx);
      let y1 = Math.round(b.cy);
      if (sub === 'door') {
        const e = this.nearestEdge(a);
        return { op: 'wall', x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, variant: WALL.Door };
      }
      if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) y1 = y0;
      else x1 = x0;
      if (x0 === x1 && y0 === y1) {
        const e = this.nearestEdge(a);
        x0 = e.x0;
        y0 = e.y0;
        x1 = e.x1;
        y1 = e.y1;
      }
      return { op: 'wall', x0, y0, x1, y1, variant: st.wallType };
    }
    void g;
    const x0 = Math.floor(Math.min(a.cx, b.cx));
    const y0 = Math.floor(Math.min(a.cy, b.cy));
    const x1 = Math.floor(Math.max(a.cx, b.cx)) + 1;
    const y1 = Math.floor(Math.max(a.cy, b.cy)) + 1;
    if (sub === 'foundation') return { op: 'foundation', x0, y0, x1, y1, variant: 0 };
    if (sub === 'floor') return { op: 'floor', x0, y0, x1, y1, variant: st.floorType };
    if (sub === 'erase') return { op: 'erase', x0, y0, x1, y1, variant: 0 };
    if (sub === 'zone') return { op: 'zone', x0, y0, x1, y1, variant: st.zoneType };
    return { op: 'fixture', x0, y0, x1, y1, variant: st.fixtureId };
  }

  /** The grid edge closest to a fractional cell position. */
  private nearestEdge(c: { cx: number; cy: number }): { x0: number; y0: number; x1: number; y1: number } {
    const ry = Math.round(c.cy);
    const rx = Math.round(c.cx);
    if (Math.abs(c.cy - ry) <= Math.abs(c.cx - rx)) return { x0: Math.floor(c.cx), y0: ry, x1: Math.floor(c.cx) + 1, y1: ry };
    return { x0: rx, y0: Math.floor(c.cy), x1: rx, y1: Math.floor(c.cy) + 1 };
  }

  private terminalDown(p: Pt): void {
    this.frozen = false;
    const g = this.gridFor(p);
    this.tGrid = g;
    const c = worldToCell(g, p.x, p.y);
    this.tStart = { cx: c.cx, cy: c.cy };
    this.dragging = true;
  }

  private previewTerminal(p: Pt): void {
    if (this.frozen && !this.dragging) return;
    const st = useToolStore.getState();
    const hint = `hint.terminal.${st.tSub}`;
    const g = this.dragging && this.tGrid ? this.tGrid : this.gridFor(p);
    const c = worldToCell(g, p.x, p.y);
    const a = this.dragging && this.tStart ? this.tStart : c;
    const edit = this.terminalEdit(g, a, c);
    const env = this.env();
    if (!edit || !env) {
      this.deps.setGhost(null);
      return;
    }
    const plan = planEdit(g, edit, env);
    const isWall = edit.op === 'wall';
    const shapes: GhostShape[] = [];
    let label: string;
    if (isWall) {
      const a0 = cornerWorld(g, edit.x0, edit.y0);
      const a1 = cornerWorld(g, edit.x1, edit.y1);
      shapes.push({ k: 'strip', pts: [a0, a1], w: 0.8 });
      label = tFormat('ghost.terminalWall', { n: plan.changes, cost: formatMoney(plan.cost) });
    } else {
      shapes.push({ k: 'poly', pts: rectWorld(g, edit.x0, edit.y0, edit.x1, edit.y1) });
      label = tFormat('ghost.terminal', { n: plan.changes, cost: formatMoney(plan.cost) });
    }
    // Before a drag starts, a hovered cell with nothing to do is not an error.
    const idle = !this.dragging && plan.changes === 0;
    let problem: Problem | null = idle ? null : plan.problem;
    if (!problem && !idle && plan.changes === 0) problem = { code: 'terminalNeedsFoundation' };
    if (problem && problem.code === 'notOwned' && edit.op === 'foundation') {
      const ids = unownedParcelsUnder(env.ctx, { polygon: rectWorld(g, edit.x0, edit.y0, edit.x1, edit.y1) });
      const site = this.site();
      let cost = 0;
      if (site) for (const id of ids) cost += site.parcelPrice[id];
      useToolStore.getState().set({ buy: { ids, cost } });
    } else {
      useToolStore.getState().set({ buy: null });
    }
    this.show({ valid: problem === null && !idle, shapes, label: { x: p.x, y: p.y, text: label } }, problem, hint);
  }

  private finishTerminal(p: Pt): void {
    const g = this.tGrid;
    const a = this.tStart;
    this.dragging = false;
    this.tStart = null;
    this.tGrid = null;
    if (!g || !a) return;
    const c = worldToCell(g, p.x, p.y);
    const edit = this.terminalEdit(g, a, c);
    const env = this.env();
    if (!edit || !env) return;
    const plan = planEdit(g, edit, env);
    if (plan.problem || plan.changes === 0) {
      // Keep the preview and the reason up, so missing land can be bought first.
      this.frozen = true;
      return;
    }
    this.deps.send({ type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit });
    this.deps.setGhost(null);
  }

  // Demolish -------------------------------------------------------------

  private previewDemolish(p: Pt): void {
    const hit = pickObject(this.af, p.x, p.y, Math.max(8, 14 / this.deps.zoom()));
    if (!hit) {
      this.deps.setGhost(null);
      useToolStore.getState().set({ hint: 'hint.demolish', problem: null, buy: null });
      return;
    }
    const af = this.af;
    const shapes: GhostShape[] = [];
    if (hit.kind === 'runway') {
      const r = af.runways.find((x) => x.id === hit.id);
      if (r) shapes.push({ k: 'box', x: r.x1, y: r.y1, headingDeg: r.headingDeg, len: r.lengthM, w: r.widthM + 2 * r.shoulderM });
    } else if (hit.kind === 'taxiway') {
      const t = af.taxiways.find((x) => x.id === hit.id);
      if (t) shapes.push({ k: 'strip', pts: t.points, w: t.widthM });
    } else if (hit.kind === 'apron') {
      const a = af.aprons.find((x) => x.id === hit.id);
      if (a) shapes.push({ k: 'poly', pts: a.polygon });
    } else {
      const s = af.stands.find((x) => x.id === hit.id);
      if (s) shapes.push({ k: 'ring', x: s.x, y: s.y, r: 8 });
    }
    this.show({ valid: false, shapes }, null, 'hint.demolishConfirm');
  }
}
