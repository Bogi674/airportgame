import { FIXTURE_KEYS, ZONE, type TerminalGrid } from '@shared/business';
import { seatCells } from '@shared/props';
import { nearestNode } from './walkDistance';
import type { WalkGraph } from './walkGraph';

/** Which side of security a visit point is on. */
export const SIDE = { None: 0, Land: 1, Air: 2 } as const;

/** fixtureRot below this marks the anchor of a fixture, as in serviceNodes. */
const TAIL_ROT = 5;
const SEATING = FIXTURE_KEYS.indexOf('seating') + 1;
/** Cells around a seat that may hold the walk node people sit down from, nearest first, as flat (dx, dy) pairs. */
const SEAT_REACH = [0, 0, 0, 1, 0, -1, 1, 0, -1, 0, 1, 1, -1, 1, 1, -1, -1, -1, 0, 2, 0, -2, 2, 0, -2, 0];
/** Fixtures people visit for a need: seating and the six shop kinds. Seat props (T76) are seating points too. */
const VISIT_IDS: readonly number[] = ['seating', 'convenience', 'quickFood', 'cafe', 'dutyFree', 'booksGifts', 'pharmacy'].map(
  (k) => FIXTURE_KEYS.indexOf(k as (typeof FIXTURE_KEYS)[number]) + 1,
);

/**
 * Struct of arrays of the places a passenger can visit on one terminal floor, in ascending anchor cell order.
 * Derived from the grid, never saved or hashed. Node ids are valid only until the walk graph is rebuilt (PITFALLS 25).
 */
export interface VisitPoints {
  count: number;
  /** Fixture id of the point, see FIXTURE_KEYS. */
  kind: Uint8Array;
  /** Array cell index of the anchor. */
  cell: Int32Array;
  /** Logical cell of the anchor. */
  lx: Int32Array;
  ly: Int32Array;
  /** Walk node nearest the anchor, -1 when none. */
  walkNode: Int32Array;
  /** SIDE value. */
  side: Uint8Array;
}

/** Side an effective zone gives to a visit point. Commercial cells that touch both sides or neither stay commercial and are unusable. */
export function sideOfZone(zone: number): number {
  if (zone === ZONE.Secure || zone === ZONE.International) return SIDE.Air;
  if (zone === ZONE.Public) return SIDE.Land;
  return SIDE.None;
}

/** Builds the visit points of one terminal floor. Allocates only here. */
export function buildVisitPoints(g: TerminalGrid, wg: WalkGraph): VisitPoints {
  const n = g.w * g.h;
  const anchors: number[] = [];
  const seats = new Set(seatCells(g));
  for (let c = 0; c < n; c++) {
    if ((VISIT_IDS.includes(g.fixture[c]!) && g.fixtureRot[c]! < TAIL_ROT) || seats.has(c)) anchors.push(c);
  }
  const count = anchors.length;
  const vp: VisitPoints = {
    count,
    kind: new Uint8Array(count),
    cell: new Int32Array(count),
    lx: new Int32Array(count),
    ly: new Int32Array(count),
    walkNode: new Int32Array(count),
    side: new Uint8Array(count),
  };
  for (let k = 0; k < count; k++) {
    const c = anchors[k]!;
    const col = c % g.w;
    const row = (c - col) / g.w;
    const seat = seats.has(c);
    // A seat prop usually blocks its own cell, so people sit down from the nearest open cell beside it.
    const open = seat ? openCellNear(g, wg, c) : c;
    vp.kind[k] = seat ? SEATING : g.fixture[c]!;
    vp.cell[k] = c;
    vp.lx[k] = g.x0 + col;
    vp.ly[k] = g.y0 + row;
    vp.walkNode[k] = open < 0 ? -1 : nearestNode(wg, open);
    vp.side[k] = open < 0 ? SIDE.None : sideOfZone(wg.effective[open]!);
  }
  return vp;
}

/** The cell nearest a seat, in SEAT_REACH order, that belongs to a walk group, or -1 when none does. */
function openCellNear(g: TerminalGrid, wg: WalkGraph, c: number): number {
  const x = c % g.w;
  const y = (c - x) / g.w;
  for (let i = 0; i < SEAT_REACH.length; i += 2) {
    const nx = x + SEAT_REACH[i]!;
    const ny = y + SEAT_REACH[i + 1]!;
    if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
    const j = ny * g.w + nx;
    if (wg.cellMain[j]! >= 0) return j;
  }
  return -1;
}

/** Index of the point with this anchor cell and fixture id, -1 when an edit removed it. */
export function findPoint(vp: VisitPoints, cell: number, kind: number): number {
  for (let k = 0; k < vp.count; k++) if (vp.cell[k] === cell && vp.kind[k] === kind) return k;
  return -1;
}
