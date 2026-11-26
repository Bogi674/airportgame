import { GROUND } from '@data/index';
import { keptPavement, REFUND_SHARE, removePlan, roundApronPoly } from '@shared/apronPricing';
import type { AirfieldPayload, Runway } from '@shared/airfield';
import { BAGGAGE_FIXTURE_KEYS, fixtureKey, TERMINAL_CELL_M, WALL, type TerminalGrid } from '@shared/business';
import { closestOnSegment, type Pt } from '@shared/geom';
import type { GhostShape } from '@shared/ghost';
import { arcLengthAt, cutPolyline, polylineLength, splitPolyline } from '@shared/polylineCut';
import { propCost, propRect, propSpec, type PropCategory } from '@shared/props';
import { runwayUnitCost } from '@shared/surfaceRules';
import { cellIndex, cornerWorld, hEdgeIndex, vEdgeIndex, type TerminalEdit } from '@shared/terminalOps';
import type { Problem } from '@shared/validate';
import type { Command } from '@sim/commands';
import { formatInt, formatMoney } from '../format';
import { objectName, objectRefund } from '../demolishTargets';
import type { DemolishRequest } from '../stores/demolishStore';
import type { AreaBox, AreaKind, LineKind } from '../stores/toolStore';
import { tFormat } from '../strings';

/** The part of a polyline between two arc lengths. */
export function slicePolyline(pts: readonly Pt[], a: number, b: number): Pt[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const head = splitPolyline(pts, hi).before;
  return splitPolyline(head, lo).after;
}

/** Distance from a point to a polyline. */
function distToPolyline(pts: readonly Pt[], p: Pt): number {
  const c = { x: 0, y: 0, t: 0 };
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    closestOnSegment(p.x, p.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, c);
    best = Math.min(best, Math.hypot(p.x - c.x, p.y - c.y));
  }
  return best;
}

/** The point of a polyline at an arc length. */
function pointAt(pts: readonly Pt[], s: number): Pt {
  const before = splitPolyline(pts, s).before;
  return before[before.length - 1];
}

/** Runway frame: distance along the runway from threshold A and the signed offset across it. */
function runwayAlong(r: Runway, p: Pt): { s: number; lateral: number } {
  const dx = r.x2 - r.x1;
  const dy = r.y2 - r.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = p.x - r.x1;
  const py = p.y - r.y1;
  return { s: px * ux + py * uy, lateral: px * -uy + py * ux };
}

/** What a line demolish stroke would do: the stretch to paint red, the confirm request, or why it cannot. */
export interface LinePlan {
  shapes: GhostShape[];
  request: DemolishRequest | null;
  problem: Problem | null;
  /** Readout beside the cursor: the length removed and the refund. */
  label: string | null;
}

const NONE: LinePlan = { shapes: [], request: null, problem: null, label: null };

/** Extra reach in meters around a laid object within which a stroke picks it. */
const PICK_MARGIN_M = 12;
/** A runway stroke that reaches within this many meters of a threshold trims from that end. */
const RUNWAY_END_SNAP_M = 30;
/** Shortest leftover of a taxiway that the sim keeps; shorter leftovers go with the cut. */
const TAXI_MIN_PART_M = 8;

/**
 * Line demolish of UI revision 6 (DEM2): the stroke from `a` to `b` cuts the laid object under `a`. Taxiways and
 * service roads lose the stretch between the stroke ends and split in two; a runway can only be trimmed from an end,
 * because two short runway pieces are of no use (owner, 2026-11-25). A stroke over the whole object removes it.
 */
export function planLineCut(af: AirfieldPayload, kind: LineKind, a: Pt, b: Pt): LinePlan {
  if (kind === 'runway') return planRunwayCut(af, a, b);
  const isRoad = kind === 'road';
  const list = isRoad
    ? (af.roads ?? []).map((r) => ({ id: r.id, pts: r.points, w: GROUND.road.widthM, cost: r.cost }))
    : af.taxiways.map((t) => ({ id: t.id, pts: t.points, w: t.widthM, cost: t.cost }));
  if (!list.some((o) => distToPolyline(o.pts, a) <= o.w / 2 + PICK_MARGIN_M)) return { ...NONE, problem: { code: isRoad ? 'pickRoad' : 'pickTaxiway' } };
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1) return NONE;
  // A laid line is often stored as several pieces (taxiway sections between junctions), so the stroke cuts every piece it runs along.
  const stroke = [a, b];
  const shapes: GhostShape[] = [];
  const commands: Command[] = [];
  let refund = 0;
  let removed = 0;
  let wholeCount = 0;
  let firstId = -1;
  for (const o of list) {
    const s1 = arcLengthAt(o.pts, a, Infinity) ?? 0;
    const s2 = arcLengthAt(o.pts, b, Infinity) ?? 0;
    if (Math.abs(s2 - s1) < 1) continue;
    const reach = o.w / 2 + PICK_MARGIN_M;
    if (!slicePolyline(o.pts, s1, s2).every((p) => distToPolyline(stroke, p) <= reach)) continue;
    const total = polylineLength(o.pts);
    const cut = cutPolyline(o.pts, s1, s2, isRoad ? GROUND.road.minSegmentM : TAXI_MIN_PART_M);
    const whole = !cut.first && !cut.last;
    shapes.push({ k: 'clash', pts: slicePolyline(o.pts, cut.first ? Math.min(s1, s2) : 0, cut.last ? Math.max(s1, s2) : total), w: o.w });
    refund += whole ? Math.round(o.cost * REFUND_SHARE) : Math.round((total > 0 ? o.cost / total : 0) * cut.removedM * REFUND_SHARE);
    removed += cut.removedM;
    if (whole) wholeCount++;
    if (firstId < 0) firstId = o.id;
    const at = pointAt(o.pts, Math.min(s1, s2));
    const at2 = pointAt(o.pts, Math.max(s1, s2));
    commands.push(isRoad ? { type: 'cutRoad', id: o.id, at, at2 } : whole ? { type: 'demolish', kind: 'taxiway', id: o.id } : { type: 'editTaxiway', id: o.id, op: 'cut', at, at2 });
  }
  if (commands.length === 0) return NONE;
  const what = objectName(af, isRoad ? 'road' : 'taxiway', firstId) ?? '';
  const length = tFormat('demolish.lengthLine', { m: formatInt(Math.round(removed)) });
  const lines = [length];
  if (commands.length > 1) lines.push(tFormat('demolish.piecesLine', { n: commands.length }));
  if (wholeCount > 0) lines.push(tFormat('demolish.wholePiecesLine', { n: wholeCount }));
  return { shapes, problem: null, label: `${length}  +${formatMoney(refund)}`, request: { what, lines, refund, commands } };
}

function planRunwayCut(af: AirfieldPayload, a: Pt, b: Pt): LinePlan {
  let best: Runway | null = null;
  for (const r of af.runways) {
    const f = runwayAlong(r, a);
    if (Math.abs(f.lateral) <= r.widthM / 2 + r.shoulderM + PICK_MARGIN_M && f.s >= -PICK_MARGIN_M && f.s <= r.lengthM + PICK_MARGIN_M) {
      best = r;
      break;
    }
  }
  if (!best) return { ...NONE, problem: { code: 'pickRunway' } };
  const r = best;
  const len = r.lengthM;
  const clamp = (v: number): number => Math.max(0, Math.min(len, v));
  const lo = clamp(Math.min(runwayAlong(r, a).s, runwayAlong(r, b).s));
  const hi = clamp(Math.max(runwayAlong(r, a).s, runwayAlong(r, b).s));
  const fullW = r.widthM + 2 * r.shoulderM;
  const axis = [
    { x: r.x1, y: r.y1 },
    { x: r.x2, y: r.y2 },
  ];
  const what = objectName(af, 'runway', r.id) ?? '';
  const fromA = lo <= RUNWAY_END_SNAP_M;
  const toB = hi >= len - RUNWAY_END_SNAP_M;
  if (fromA && toB) {
    const refund = objectRefund(af, 'runway', r.id);
    return { shapes: [{ k: 'clash', pts: axis, w: fullW }], problem: null, label: `+${formatMoney(refund)}`, request: { what, lines: [tFormat('demolish.wholeLine', { name: what })], refund, commands: [{ type: 'demolish', kind: 'runway', id: r.id }] } };
  }
  if (!fromA && !toB) return { shapes: [{ k: 'clash', pts: slicePolyline(axis, lo, hi), w: fullW }], problem: { code: 'runwayCutMiddle' }, label: null, request: null };
  const cutM = Math.round((fromA ? hi : len - lo) / 5) * 5;
  if (cutM <= 0) return NONE;
  const refund = Math.round(cutM * fullW * runwayUnitCost(r) * REFUND_SHARE);
  const stretch = fromA ? slicePolyline(axis, 0, cutM) : slicePolyline(axis, len - cutM, len);
  const length = tFormat('demolish.lengthLine', { m: formatInt(cutM) });
  return {
    shapes: [{ k: 'clash', pts: stretch, w: fullW }],
    problem: null,
    label: `${length}  +${formatMoney(refund)}`,
    request: { what, lines: [tFormat('demolish.trimLine', { name: fromA ? r.nameA : r.nameB }), length], refund, commands: [{ type: 'resizeRunway', id: r.id, end: fromA ? 'a' : 'b', deltaM: -cutM }] },
  };
}

/** Which checklist row a prop category falls in. */
const PROP_ROW: Record<PropCategory, AreaKind> = {
  seating: 'furniture',
  lounge: 'furniture',
  office: 'furniture',
  washroom: 'amenities',
  vending: 'amenities',
  service: 'amenities',
  backOfHouse: 'amenities',
  decoration: 'decoration',
  screens: 'info',
};

/** What an area sweep finds per row, the commands that remove the checked rows, and the refund. */
export interface AreaPlan {
  counts: Record<AreaKind, number>;
  commands: Command[];
  refund: number;
  /** Items the checked rows remove. */
  total: number;
  /** World polygon of the box. */
  polygon: Pt[];
}

const ZERO = (): Record<AreaKind, number> => ({ walls: 0, floors: 0, doors: 0, furniture: 0, stations: 0, amenities: 0, decoration: 0, info: 0, zones: 0, pavement: 0, stands: 0, runways: 0, roads: 0, buildings: 0 });

const inBox = (box: AreaBox, p: Pt): boolean => p.x >= Math.min(box.x0, box.x1) && p.x <= Math.max(box.x0, box.x1) && p.y >= Math.min(box.y0, box.y1) && p.y <= Math.max(box.y0, box.y1);

/** The box as a world polygon. */
export function boxPolygon(box: AreaBox): Pt[] {
  const x0 = Math.min(box.x0, box.x1);
  const x1 = Math.max(box.x0, box.x1);
  const y0 = Math.min(box.y0, box.y1);
  const y1 = Math.max(box.y0, box.y1);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Groups indices that pass a test into runs of neighbours, for edits that take a range. */
function runs(n: number, ok: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && ok(i);
    if (on && start < 0) start = i;
    else if (!on && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

/**
 * The area bulldoze of UI revision 6 section 5.6 (DEM3): everything inside the box, counted per checklist row. Airfield
 * objects go whole when they lie fully inside, aprons are cut to the box, and terminal parts go per cell, wall edge,
 * station and prop. A floor cell goes only when nothing that stays stands on it, since lifting a floor takes its contents.
 */
export function planArea(af: AirfieldPayload, grids: readonly TerminalGrid[], box: AreaBox, filter: Record<AreaKind, boolean>): AreaPlan {
  const counts = ZERO();
  const commands: Command[] = [];
  let refund = 0;
  const polygon = boxPolygon(box);

  // Aprons first, while the stands in the box still keep their own pavement, so the refund matches the sim.
  const apron = removePlan(af.aprons, roundApronPoly(polygon), keptPavement(af.stands, af.taxiways));
  if (apron.area >= 1) {
    counts.pavement = apron.pieces.length;
    if (filter.pavement) {
      commands.push({ type: 'removeApronArea', polygon: roundApronPoly(polygon) });
      refund += Math.round(apron.refund);
    }
  }
  const whole = (row: AreaKind, kind: 'runway' | 'taxiway' | 'stand' | 'road' | 'depot' | 'building' | 'tower', id: number): void => {
    counts[row]++;
    if (!filter[row]) return;
    commands.push(kind === 'tower' ? { type: 'demolishTower', id } : { type: 'demolish', kind, id });
    refund += objectRefund(af, kind, id);
  };
  for (const s of af.stands) if (inBox(box, s)) whole('stands', 'stand', s.id);
  for (const r of af.runways) if (inBox(box, { x: r.x1, y: r.y1 }) && inBox(box, { x: r.x2, y: r.y2 })) whole('runways', 'runway', r.id);
  for (const t of af.taxiways) if (t.points.every((p) => inBox(box, p))) whole('runways', 'taxiway', t.id);
  for (const r of af.roads ?? []) if (r.points.every((p) => inBox(box, p))) whole('roads', 'road', r.id);
  for (const d of af.depots ?? []) if (inBox(box, d)) whole('buildings', 'depot', d.id);
  for (const b of af.buildings ?? []) if (inBox(box, b)) whole('buildings', 'building', b.id);
  for (const t of af.towers ?? []) if (inBox(box, t)) whole('buildings', 'tower', t.id);

  for (const g of grids) sweepGrid(g, box, filter, counts, commands, (v) => (refund += v));
  let total = 0;
  for (const k of Object.keys(counts) as AreaKind[]) if (filter[k]) total += counts[k];
  return { counts, commands, refund, total, polygon };
}

function sweepGrid(g: TerminalGrid, box: AreaBox, filter: Record<AreaKind, boolean>, counts: Record<AreaKind, number>, commands: Command[], addRefund: (v: number) => void): void {
  const build = (edit: TerminalEdit): Command => ({ type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit });
  const cellIn = (x: number, y: number): boolean => inBox(box, cornerWorld(g, x + 0.5, y + 0.5));
  const kept = new Uint8Array(g.w * g.h);

  // Props, topmost first, so each removal by point takes the prop it means.
  for (let i = g.props.length - 1; i >= 0; i--) {
    const p = g.props[i]!;
    const r = propRect(p);
    const spec = propSpec(p.asset);
    if (!r || !spec) continue;
    const cx = (r.sx0 + r.sx1) / 2 / 4;
    const cy = (r.sy0 + r.sy1) / 2 / 4;
    const row = PROP_ROW[spec.category as PropCategory] ?? 'decoration';
    const cell = cellIndex(g, Math.floor(cx), Math.floor(cy));
    if (!inBox(box, cornerWorld(g, cx, cy))) {
      if (cell >= 0) kept[cell] = 1;
      continue;
    }
    counts[row]++;
    if (!filter[row]) {
      if (cell >= 0) kept[cell] = 1;
      continue;
    }
    commands.push({ type: 'removeProp', building: g.id, x: cx * TERMINAL_CELL_M, y: cy * TERMINAL_CELL_M });
    addRefund(propCost(p.asset));
  }

  // Stations by their anchor cell; a baggage node is edited from its own panel and stays.
  for (let i = 0; i < g.fixture.length; i++) {
    const f = g.fixture[i]!;
    if (f === 0) continue;
    const x = g.x0 + (i % g.w);
    const y = g.y0 + Math.floor(i / g.w);
    const anchor = g.fixtureRot[i]! < 5 && g.fixtureOff[i] === 0;
    const bag = BAGGAGE_FIXTURE_KEYS.includes(fixtureKey(f));
    if (bag || !cellIn(x, y) || !filter.stations) kept[i] = 1;
    if (!anchor || bag || !cellIn(x, y)) continue;
    counts.stations++;
    if (filter.stations) commands.push({ type: 'removeFixture', building: g.id, x, y });
  }

  // Wall edges in runs of one kind: walls, or doors and windows.
  const wallRow = (v: number): AreaKind | null => (v === WALL.Wall ? 'walls' : v === WALL.None ? null : 'doors');
  for (let row = 0; row <= g.h; row++) {
    const y = g.y0 + row;
    for (const kind of ['walls', 'doors'] as const) {
      const ok = (c: number): boolean => wallRow(g.hWall[hEdgeIndex(g, g.x0 + c, y)] ?? 0) === kind && inBox(box, cornerWorld(g, g.x0 + c + 0.5, y));
      for (const [a, b] of runs(g.w, ok)) {
        counts[kind] += b - a;
        if (filter[kind]) commands.push(build({ op: 'removeWall', x0: g.x0 + a, y0: y, x1: g.x0 + b, y1: y, variant: 0 }));
      }
    }
  }
  for (let col = 0; col <= g.w; col++) {
    const x = g.x0 + col;
    for (const kind of ['walls', 'doors'] as const) {
      const ok = (r: number): boolean => wallRow(g.vWall[vEdgeIndex(g, x, g.y0 + r)] ?? 0) === kind && inBox(box, cornerWorld(g, x, g.y0 + r + 0.5));
      for (const [a, b] of runs(g.h, ok)) {
        counts[kind] += b - a;
        if (filter[kind]) commands.push(build({ op: 'removeWall', x0: x, y0: g.y0 + a, x1: x, y1: g.y0 + b, variant: 0 }));
      }
    }
  }

  // Zones and floors per row of cells.
  for (let row = 0; row < g.h; row++) {
    const y = g.y0 + row;
    const zoneOk = (c: number): boolean => g.zone[row * g.w + c]! > 0 && cellIn(g.x0 + c, y);
    for (const [a, b] of runs(g.w, zoneOk)) {
      counts.zones += b - a;
      if (filter.zones) commands.push(build({ op: 'zone', x0: g.x0 + a, y0: y, x1: g.x0 + b, y1: y + 1, variant: 0 }));
    }
    const floorIn = (c: number): boolean => g.floor[row * g.w + c]! > 0 && cellIn(g.x0 + c, y);
    for (let c = 0; c < g.w; c++) if (floorIn(c)) counts.floors++;
    if (!filter.floors) continue;
    for (const [a, b] of runs(g.w, (c) => floorIn(c) && kept[row * g.w + c] === 0)) commands.push(build({ op: 'erase', x0: g.x0 + a, y0: y, x1: g.x0 + b, y1: y + 1, variant: 0 }));
  }
}
