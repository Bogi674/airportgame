import { BUSINESS, FIXTURE_CATALOG } from '@data/index';
import { FIXTURE_KEYS, TERMINAL_CELL_M, footprintOf, type TerminalGrid } from './business';

/** Fixture id of the travelator pair (T77). Its level picks the length: 1, 2, 3 are the 8, 16 and 24 m kit pairs. */
export const TRAVELATOR = FIXTURE_KEYS.indexOf('travelator') + 1;
/** Kit asset per level, index level minus 1. */
export const TRAVELATOR_ASSETS: readonly string[] = ['circulation.travelator8', 'circulation.travelator16', 'circulation.travelator24'];
/** Cost keys in business.json fixtureCosts per level. */
const COST_KEYS = ['travelator.8', 'travelator.16', 'travelator.24'] as const;

const clampLevel = (level: number): number => Math.min(Math.max(level, 1), 3);

/** Belt speed in m/s from the catalog, added to the walking speed of whoever rides it. */
function beltSpeedMps(): number {
  const a = FIXTURE_CATALOG.assets.find((x) => x.id === TRAVELATOR_ASSETS[0]);
  const v = a?.stats['speedMps'];
  return typeof v === 'number' ? v : 0;
}
const BELT_MPS = beltSpeedMps();
const REF_MPS = BUSINESS.terminal.walk.travelatorRefWalkMps;

export function travelatorCost(level: number): number {
  return BUSINESS.fixtureCosts[COST_KEYS[clampLevel(level) - 1]!];
}

/** Belt length in meters of a level. */
export function travelatorLengthM(level: number): number {
  return footprintOf('travelator', clampLevel(level))[0] * TERMINAL_CELL_M;
}

/**
 * Walk graph length of a ride: the belt length scaled to the time a walker at the reference speed needs with the belt
 * speed added, so edge lengths stay comparable with plain walking.
 */
export function rideLengthM(level: number): number {
  return (travelatorLengthM(level) * REF_MPS) / (REF_MPS + BELT_MPS);
}

/** Direction steps of a footprint code minus one, as in terminalOps ROT_STEP. */
const STEP: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/** One belt of a travelator: the walkable array cells just before its first and after its last cell, and the ride length. */
export interface TravelatorLane {
  a: number;
  b: number;
  lenM: number;
}

/** Calls fn for every array cell of every travelator in the grid, with the cell index. */
function eachTravelator(g: TerminalGrid, fn: (anchor: number, rot: number, along: number, across: number) => void): void {
  for (let i = 0; i < g.fixture.length; i++) {
    if (g.fixture[i] !== TRAVELATOR || g.fixtureRot[i] === 0 || g.fixtureRot[i] >= 5) continue;
    const [along, across] = footprintOf('travelator', g.fixtureLevel[i]!);
    fn(i, g.fixtureRot[i]! - 1, along, across);
  }
}

/** Per array cell, 1 on cells a travelator covers. Its balustrades close them to walking from every side. */
export function travelatorMask(g: TerminalGrid): Uint8Array {
  const mask = new Uint8Array(g.w * g.h);
  for (let i = 0; i < g.fixture.length; i++) if (g.fixture[i] === TRAVELATOR) mask[i] = 1;
  return mask;
}

/** True when the grid holds a travelator. */
export function hasTravelator(g: TerminalGrid): boolean {
  for (let i = 0; i < g.fixture.length; i++) if (g.fixture[i] === TRAVELATOR) return true;
  return false;
}

/**
 * The belts of every travelator, in anchor cell order, one per across column. A belt joins the floor cell before its
 * first cell to the floor cell after its last cell along the travelator axis. A belt whose end cell lies outside the
 * grid, has no floor or holds a fixture is left out, and so is one whose ends lie in different effective zones (eff),
 * since a belt never replaces a transition.
 */
export function travelatorLanes(g: TerminalGrid, eff: Uint8Array): TravelatorLane[] {
  const out: TravelatorLane[] = [];
  const W = g.w;
  const open = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= W || y >= g.h) return -1;
    const c = y * W + x;
    return g.floor[c]! > 0 && g.fixture[c] === 0 ? c : -1;
  };
  eachTravelator(g, (anchor, rot, along, across) => {
    const [ax, ay] = STEP[rot]!;
    const [bx, by] = STEP[(rot + 1) % 4]!;
    const x0 = anchor % W;
    const y0 = (anchor - x0) / W;
    const len = rideLengthM(g.fixtureLevel[anchor]!);
    for (let j = 0; j < across; j++) {
      const sx = x0 + j * bx;
      const sy = y0 + j * by;
      const a = open(sx - ax, sy - ay);
      const b = open(sx + along * ax, sy + along * ay);
      if (a >= 0 && b >= 0 && eff[a] === eff[b]) out.push({ a: Math.min(a, b), b: Math.max(a, b), lenM: len });
    }
  });
  return out;
}

/** Calls fn with the other end of every belt that ends at an array cell. For the validation floods, never per tick. */
export function eachLanePartner(lanes: readonly TravelatorLane[], cell: number, fn: (other: number) => void): void {
  for (const l of lanes) {
    if (l.a === cell) fn(l.b);
    else if (l.b === cell) fn(l.a);
  }
}

/** Summed build cost of the travelators of a grid, left out of the building upkeep (owner, 2026-11-23). */
export function travelatorCostOf(g: TerminalGrid): number {
  let sum = 0;
  eachTravelator(g, (anchor) => {
    sum += travelatorCost(g.fixtureLevel[anchor]!);
  });
  return sum;
}
