import { BUSINESS, FIXTURE_CATALOG } from '@data/index';
import type { FixtureAsset } from '@data/schemas';
import { FIXTURE_KEYS, TERMINAL_CELL_M, TRANSITION_KEYS, WALL, ZONE, ZONES, fixtureKey, type Prop, type TerminalGrid } from './business';
import type { Problem } from './validate';

/** Catalog categories whose assets are props on the sub grid (docs/TERMINAL_FIXTURES.md section 8). */
export const PROP_CATEGORIES = ['seating', 'lounge', 'washroom', 'decoration', 'vending', 'screens', 'service', 'office', 'backOfHouse'] as const;
export type PropCategory = (typeof PROP_CATEGORIES)[number];

/** Side of a prop grid step in meters. */
export const PROP_STEP_M = 0.5;
/** Prop grid steps per 2 m terminal cell side. */
const SUB = TERMINAL_CELL_M / PROP_STEP_M;
/** Prop grid squares in one terminal cell. */
const SUB_AREA = SUB * SUB;
/** Rounding guard so a size that is already a whole number of steps does not round up. */
const EPS = 1e-6;
const P = BUSINESS.props;

/** Placement layer: props on one layer may not overlap, props on different layers may. Wall props stand on the floor. */
export type PropLayer = 'floor' | 'floorLayer' | 'overhead' | 'desktop';

const SPECS = new Map<string, FixtureAsset>();
for (const a of FIXTURE_CATALOG.assets) {
  if (a.grid === 'sub' && (PROP_CATEGORIES as readonly string[]).includes(a.category)) SPECS.set(a.id, a);
}

/** The catalog entry of a prop asset, or undefined when the id is not a prop. */
export function propSpec(asset: string): FixtureAsset | undefined {
  return SPECS.get(asset);
}

/** Every prop asset of a category, in catalog order. */
export function propsOfCategory(cat: PropCategory): FixtureAsset[] {
  const out: FixtureAsset[] = [];
  for (const a of SPECS.values()) if (a.category === cat) out.push(a);
  return out;
}

export function layerOf(spec: FixtureAsset): PropLayer {
  if (spec.mount === 'floorLayer') return 'floorLayer';
  if (spec.mount === 'overhead') return 'overhead';
  if (spec.mount === 'desktop') return 'desktop';
  return 'floor';
}

const num = (spec: FixtureAsset, key: string): number => {
  const v = spec.stats[key];
  return typeof v === 'number' ? v : 0;
};

/** Seats a prop offers, 0 for none. */
export const seatsOf = (spec: FixtureAsset): number => num(spec, 'seats');
/** Comfort of a seat prop, 0 to 3. */
export const comfortOf = (spec: FixtureAsset): number => num(spec, 'comfort');
/** Ambience points of a decoration prop. */
export const ambienceOf = (spec: FixtureAsset): number => num(spec, 'ambience');
/** True for a washroom prop people queue at: stalls, accessible toilets and urinals. */
export const isToiletProp = (spec: FixtureAsset): boolean => spec.category === 'washroom' && num(spec, 'serviceTimeS') > 0 && num(spec, 'capacity') > 0;
/** True for a desk a desktop prop may stand on. */
export const isDesk = (spec: FixtureAsset): boolean => spec.mount === 'floor' && (num(spec, 'workplaces') > 0 || spec.id === 'lounge.workDesk');

/** Build cost of one prop: a per seat or per ambience price, a per id override, or the price of its category. */
export function propCost(asset: string): number {
  const spec = SPECS.get(asset);
  if (!spec) return 0;
  const byId = P.costById[asset];
  if (byId !== undefined) return byId;
  if (spec.category === 'seating') return P.perSeat * seatsOf(spec);
  if (spec.category === 'decoration') return P.perAmbience * ambienceOf(spec);
  return P.costByCategory[spec.category as PropCategory];
}

/** Footprint side in prop steps: the drawn size rounded up to the 0.5 m grid. */
const steps = (m: number): number => Math.max(1, Math.ceil(m / PROP_STEP_M - EPS));

/** Width and depth in prop steps of an asset turned by rot quarter turns. */
export function footprintSteps(spec: FixtureAsset, rot: number): [number, number] {
  const w = steps(spec.size[0]);
  const d = steps(spec.size[1]);
  return rot % 2 === 0 ? [w, d] : [d, w];
}

/** Footprint of a prop in prop steps of the logical frame: [sx0, sy0) to [sx1, sy1). */
export interface StepRect {
  sx0: number;
  sy0: number;
  sx1: number;
  sy1: number;
}

/** Footprint of a placed prop, or null when its asset is not a prop. */
export function propRect(p: Prop): StepRect | null {
  const spec = SPECS.get(p.asset);
  if (!spec) return null;
  const [w, d] = footprintSteps(spec, p.rot);
  const sx0 = Math.round(p.x / PROP_STEP_M);
  const sy0 = Math.round(p.y / PROP_STEP_M);
  return { sx0, sy0, sx1: sx0 + w, sy1: sy0 + d };
}

/** Logical cell range [x0, x1] by [y0, y1] that a footprint touches. */
export function cellsOfRect(r: StepRect): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: Math.floor(r.sx0 / SUB), y0: Math.floor(r.sy0 / SUB), x1: Math.ceil(r.sx1 / SUB) - 1, y1: Math.ceil(r.sy1 / SUB) - 1 };
}

const overlap = (a: StepRect, b: StepRect): boolean => a.sx0 < b.sx1 && b.sx0 < a.sx1 && a.sy0 < b.sy1 && b.sy0 < a.sy1;
const inside = (a: StepRect, b: StepRect): boolean => a.sx0 >= b.sx0 && a.sx1 <= b.sx1 && a.sy0 >= b.sy0 && a.sy1 <= b.sy1;

/** Array index of a logical cell, -1 outside the grid. */
function cellAt(g: TerminalGrid, x: number, y: number): number {
  const ax = x - g.x0;
  const ay = y - g.y0;
  return ax < 0 || ay < 0 || ax >= g.w || ay >= g.h ? -1 : ay * g.w + ax;
}

/** Wall type on the horizontal edge above logical cell (x, y), 0 outside. */
function hWallAt(g: TerminalGrid, x: number, y: number): number {
  const ax = x - g.x0;
  const ay = y - g.y0;
  return ax < 0 || ay < 0 || ax >= g.w || ay > g.h ? 0 : g.hWall[ay * g.w + ax]!;
}

/** Wall type on the vertical edge left of logical cell (x, y), 0 outside. */
function vWallAt(g: TerminalGrid, x: number, y: number): number {
  const ax = x - g.x0;
  const ay = y - g.y0;
  return ax < 0 || ay < 0 || ax > g.w || ay >= g.h ? 0 : g.vWall[ay * (g.w + 1) + ax]!;
}

const solid = (w: number): boolean => w === WALL.Wall || w === WALL.Glass;

/**
 * True when the back edge of a footprint lies on a wall along its whole length. The back edge is the top at rot 0 and
 * turns with the prop: right at 1, bottom at 2, left at 3. The edge must sit on a 2 m grid line.
 */
function backOnWall(g: TerminalGrid, r: StepRect, rot: number): boolean {
  const horizontal = rot % 2 === 0;
  const line = rot === 0 ? r.sy0 : rot === 1 ? r.sx1 : rot === 2 ? r.sy1 : r.sx0;
  if (line % SUB !== 0) return false;
  const k = line / SUB;
  const a0 = Math.floor((horizontal ? r.sx0 : r.sy0) / SUB);
  const a1 = Math.ceil((horizontal ? r.sx1 : r.sy1) / SUB);
  for (let a = a0; a < a1; a++) if (!solid(horizontal ? hWallAt(g, a, k) : vWallAt(g, k, a))) return false;
  return true;
}

/** True when a wall, glass or door edge runs through the inside of a footprint. */
function crossesWall(g: TerminalGrid, r: StepRect): boolean {
  const c = cellsOfRect(r);
  for (let x = c.x0 + 1; x <= c.x1; x++) {
    if (x * SUB <= r.sx0 || x * SUB >= r.sx1) continue;
    for (let y = c.y0; y <= c.y1; y++) if (vWallAt(g, x, y) !== WALL.None) return true;
  }
  for (let y = c.y0 + 1; y <= c.y1; y++) {
    if (y * SUB <= r.sy0 || y * SUB >= r.sy1) continue;
    for (let x = c.x0; x <= c.x1; x++) if (hWallAt(g, x, y) !== WALL.None) return true;
  }
  return false;
}

/** Zone ids from the catalog zone names. The apron is never a terminal zone. */
function zoneIds(spec: FixtureAsset): number[] {
  const out: number[] = [];
  for (const z of spec.zones) {
    const i = (ZONES as readonly string[]).indexOf(z);
    if (i > 0) out.push(i);
  }
  return out;
}

/** Prop grid squares of a footprint inside logical cell (x, y). */
function coverIn(r: StepRect, x: number, y: number): number {
  const w = Math.min(r.sx1, (x + 1) * SUB) - Math.max(r.sx0, x * SUB);
  const h = Math.min(r.sy1, (y + 1) * SUB) - Math.max(r.sy0, y * SUB);
  return w > 0 && h > 0 ? w * h : 0;
}

/** True when a prop counts toward the walking block: floor and wall props. */
function blocks(p: Prop): boolean {
  const spec = SPECS.get(p.asset);
  return spec !== undefined && layerOf(spec) === 'floor';
}

/**
 * Per array cell, 1 where floor and wall props cover at least blockShare of the cell, so nobody walks there. Props on
 * one layer never overlap, so the covered squares add up exactly. Allocates; call it when the grid changes.
 */
export function propBlockMask(g: TerminalGrid, props: readonly Prop[] = g.props): Uint8Array {
  const n = g.w * g.h;
  const cover = new Uint16Array(n);
  const mask = new Uint8Array(n);
  const need = Math.ceil(SUB_AREA * P.blockShare - EPS);
  for (const p of props) {
    if (!blocks(p)) continue;
    const r = propRect(p);
    if (!r) continue;
    const c = cellsOfRect(r);
    for (let y = c.y0; y <= c.y1; y++) {
      for (let x = c.x0; x <= c.x1; x++) {
        const i = cellAt(g, x, y);
        if (i < 0) continue;
        cover[i] += coverIn(r, x, y);
        if (cover[i]! >= need) mask[i] = 1;
      }
    }
  }
  return mask;
}

const TRANSITION_IDS: readonly number[] = TRANSITION_KEYS.map((k) => FIXTURE_KEYS.indexOf(k) + 1);
const DX = [-1, 1, 0, 0];
const DY = [0, 0, -1, 1];

/** True when a logical cell has a door or staff door on an edge, or a transition fixture beside it. */
function keepClear(g: TerminalGrid, x: number, y: number): boolean {
  const door = (w: number): boolean => w === WALL.Door || w === WALL.StaffDoor;
  if (door(vWallAt(g, x, y)) || door(vWallAt(g, x + 1, y)) || door(hWallAt(g, x, y)) || door(hWallAt(g, x, y + 1))) return true;
  for (let d = 0; d < 4; d++) {
    const j = cellAt(g, x + DX[d]!, y + DY[d]!);
    if (j >= 0 && TRANSITION_IDS.includes(g.fixture[j]!)) return true;
  }
  return false;
}

/** Index of the topmost prop whose footprint holds the point (x, y) in grid meters, -1 when none does. */
export function propAt(props: readonly Prop[], x: number, y: number): number {
  const sx = x / PROP_STEP_M;
  const sy = y / PROP_STEP_M;
  for (let i = props.length - 1; i >= 0; i--) {
    const r = propRect(props[i]!);
    if (r && sx >= r.sx0 && sx < r.sx1 && sy >= r.sy0 && sy < r.sy1) return i;
  }
  return -1;
}

export interface PropPlan {
  problem: Problem | null;
  cost: number;
}

/**
 * Checks a new prop against the grid and the props already on it. The sim and the UI preview both call this, so the
 * ghost turns red exactly when the sim refuses. `skipWall` drops the wall rule for props converted from old fixtures.
 */
export function planProp(g: TerminalGrid, p: Prop, skipWall = false): PropPlan {
  const no = (code: string): PropPlan => ({ problem: { code }, cost: 0 });
  const spec = SPECS.get(p.asset);
  if (!spec) return no('notAProp');
  if (!Number.isInteger(p.rot) || p.rot < 0 || p.rot > 3) return no('nothingThere');
  if (!Number.isInteger(p.x / PROP_STEP_M) || !Number.isInteger(p.y / PROP_STEP_M)) return no('propOffGrid');
  const r = propRect(p);
  if (!r) return no('notAProp');
  const layer = layerOf(spec);
  const zones = zoneIds(spec);
  const c = cellsOfRect(r);
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0; x <= c.x1; x++) {
      const i = cellAt(g, x, y);
      if (i < 0 || g.floor[i] === 0) return no('terminalNeedsFoundation');
      if (g.zone[i] !== ZONE.None && !zones.includes(g.zone[i]!)) return no('wrongZone');
      if (layer !== 'overhead' && g.fixture[i] !== 0) return no('propOnFixture');
    }
  }
  if (crossesWall(g, r)) return no('propCrossesWall');
  if (spec.mount === 'wall' && !skipWall && !backOnWall(g, r, p.rot)) return no('propNeedsWall');
  let desk = false;
  for (const q of g.props) {
    const qs = SPECS.get(q.asset);
    const qr = propRect(q);
    if (!qs || !qr) continue;
    const ql = layerOf(qs);
    if (ql === layer && overlap(r, qr)) return no('propOverlap');
    if (layer === 'desktop' && isDesk(qs) && inside(r, qr)) desk = true;
  }
  if (layer === 'desktop' && !desk) return no('propNeedsDesk');
  if (layer === 'floor') {
    const before = propBlockMask(g);
    const after = propBlockMask(g, [...g.props, p]);
    for (let y = c.y0; y <= c.y1; y++) {
      for (let x = c.x0; x <= c.x1; x++) {
        const i = cellAt(g, x, y);
        if (after[i] === 1 && before[i] === 0 && keepClear(g, x, y)) return no('propBlocksDoor');
      }
    }
  }
  return { problem: null, cost: propCost(p.asset) };
}

/** Logical cell holding the point (x, y) in grid meters. */
const cellOfM = (x: number, y: number): [number, number] => [Math.floor(x / TERMINAL_CELL_M), Math.floor(y / TERMINAL_CELL_M)];

/** Logical cell of a prop's center. */
export function centerCell(p: Prop): [number, number] {
  const r = propRect(p)!;
  return cellOfM(((r.sx0 + r.sx1) / 2) * PROP_STEP_M, ((r.sy0 + r.sy1) / 2) * PROP_STEP_M);
}

/** Logical cell just in front of the side people use, a quarter step past the edge at its middle. */
function frontCell(p: Prop, r: StepRect): [number, number] {
  const mx = ((r.sx0 + r.sx1) / 2) * PROP_STEP_M;
  const my = ((r.sy0 + r.sy1) / 2) * PROP_STEP_M;
  const q = PROP_STEP_M / 2;
  if (p.rot === 0) return cellOfM(mx, r.sy1 * PROP_STEP_M + q);
  if (p.rot === 1) return cellOfM(r.sx0 * PROP_STEP_M - q, my);
  if (p.rot === 2) return cellOfM(mx, r.sy0 * PROP_STEP_M - q);
  return cellOfM(r.sx1 * PROP_STEP_M + q, my);
}

/** A washroom service point: the toilet props of one room serve as one node at a walkable cell in front of them. */
export interface Washroom {
  /** Array cell of the node, a floor cell with no fixture and no block. */
  cell: number;
  /** Summed capacity of the stalls, accessible toilets and urinals, at most 255. */
  servers: number;
  /** Capacity weighted mean service time in seconds. */
  meanS: number;
}

/**
 * The washrooms of a floor in ascending cell order. The toilet props of one room (labelRooms) form one washroom. Its
 * node is the front cell of the first of them, in placement order, that is walkable and in the room; a room where no
 * front cell is walkable has no washroom. rooms is labelRooms of the grid, mask its propBlockMask.
 */
export function washrooms(g: TerminalGrid, rooms: Int32Array, mask: Uint8Array): Washroom[] {
  const byRoom = new Map<number, { cell: number; cap: number; time: number }>();
  const order: number[] = [];
  for (const p of g.props) {
    const spec = SPECS.get(p.asset);
    if (!spec || !isToiletProp(spec)) continue;
    const [cx, cy] = centerCell(p);
    const at = cellAt(g, cx, cy);
    if (at < 0) continue;
    const room = rooms[at]!;
    if (room < 0) continue;
    let w = byRoom.get(room);
    if (!w) {
      w = { cell: -1, cap: 0, time: 0 };
      byRoom.set(room, w);
      order.push(room);
    }
    const cap = num(spec, 'capacity');
    w.cap += cap;
    w.time += cap * num(spec, 'serviceTimeS');
    if (w.cell < 0) {
      const [fx, fy] = frontCell(p, propRect(p)!);
      const f = cellAt(g, fx, fy);
      if (f >= 0 && g.floor[f]! > 0 && g.fixture[f] === 0 && mask[f] === 0 && rooms[f] === room) w.cell = f;
    }
  }
  const out: Washroom[] = [];
  for (const room of order) {
    const w = byRoom.get(room)!;
    if (w.cell < 0) continue;
    out.push({ cell: w.cell, servers: Math.min(255, w.cap), meanS: w.time / w.cap });
  }
  return out.sort((a, b) => a.cell - b.cell);
}

/** Array cells holding the center of a seat prop, ascending and without repeats. */
export function seatCells(g: TerminalGrid): number[] {
  const out = new Set<number>();
  for (const p of g.props) {
    const spec = SPECS.get(p.asset);
    if (!spec || seatsOf(spec) === 0) continue;
    const [cx, cy] = centerCell(p);
    const i = cellAt(g, cx, cy);
    if (i >= 0) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

/** Sums that feed the passenger rating (T76), per floor. */
export interface PropTotals {
  /** Seats on passenger floor, each weighted by 1 + comfortWeight times its comfort. */
  comfortSeats: number;
  /** Ambience points of props on passenger floor. */
  ambience: number;
  /** Seats whose center lies on secure floor, for the readiness checklist. */
  secureSeats: number;
  /** Floor area of passenger zones in square meters. */
  passengerAreaM2: number;
  /** Summed build cost of the props, for upkeep and demolition. */
  cost: number;
}

const passengerZone = (z: number): boolean => z === ZONE.Public || z === ZONE.Commercial || z === ZONE.Secure || z === ZONE.International;

export function propTotals(g: TerminalGrid): PropTotals {
  const t: PropTotals = { comfortSeats: 0, ambience: 0, secureSeats: 0, passengerAreaM2: 0, cost: 0 };
  for (let i = 0; i < g.floor.length; i++) if (g.floor[i]! > 0 && passengerZone(g.zone[i]!)) t.passengerAreaM2 += TERMINAL_CELL_M * TERMINAL_CELL_M;
  for (const p of g.props) {
    const spec = SPECS.get(p.asset);
    if (!spec) continue;
    t.cost += propCost(p.asset);
    const [cx, cy] = centerCell(p);
    const i = cellAt(g, cx, cy);
    const zone = i >= 0 ? g.zone[i]! : 0;
    if (!passengerZone(zone)) continue;
    const seats = seatsOf(spec);
    t.comfortSeats += seats * (1 + P.comfortWeight * comfortOf(spec));
    t.ambience += ambienceOf(spec);
    if (zone === ZONE.Secure) t.secureSeats += seats;
  }
  return t;
}

/**
 * Props that stand in for the seating and toilet fixtures of a save from before T76: two beam seats of 3 per seating
 * cell and two stalls per toilet cell, each set filling its 2 m cell. The fixtures are cleared from the grid. Returns
 * the number of cells converted.
 */
export function convertLegacyFixtures(g: TerminalGrid): number {
  const seating = FIXTURE_KEYS.indexOf('seating') + 1;
  const toilet = FIXTURE_KEYS.indexOf('toilet') + 1;
  let n = 0;
  for (let i = 0; i < g.fixture.length; i++) {
    const f = g.fixture[i]!;
    if (f !== seating && f !== toilet) continue;
    const x = (g.x0 + (i % g.w)) * TERMINAL_CELL_M;
    const y = (g.y0 + Math.floor(i / g.w)) * TERMINAL_CELL_M;
    const half = TERMINAL_CELL_M / 2;
    if (fixtureKey(f) === 'seating') g.props.push({ asset: P.seatingAsset, x, y, rot: 0 }, { asset: P.seatingAsset, x, y: y + half, rot: 0 });
    else g.props.push({ asset: P.toiletAsset, x, y, rot: 0 }, { asset: P.toiletAsset, x: x + half, y, rot: 0 });
    g.fixture[i] = 0;
    g.fixtureRot[i] = 0;
    g.fixtureOff[i] = 0;
    g.fixtureLevel[i] = 0;
    g.fixtureMode[i] = 0;
    g.leased[i] = 0;
    n++;
  }
  return n;
}
