import { FIXTURE_KEYS, ZONE, type TerminalGrid } from '@shared/business';
import { VENDING_KIND, seatCells, vendingPoints } from '@shared/props';
import { categoryVisitKind, unitAnchor, type TenantUnit } from '@shared/tenants';
import { nearestNode } from './walkDistance';
import type { WalkGraph } from './walkGraph';

/** Which side of security a visit point is on. */
export const SIDE = { None: 0, Land: 1, Air: 2 } as const;

/** fixtureRot below this marks the anchor of a fixture, as in serviceNodes. */
const TAIL_ROT = 5;
const SEATING = FIXTURE_KEYS.indexOf('seating') + 1;
/** Cells around a seat that may hold the walk node people sit down from, nearest first, as flat (dx, dy) pairs. */
const SEAT_REACH = [0, 0, 0, 1, 0, -1, 1, 0, -1, 0, 1, 1, -1, 1, 1, -1, -1, -1, 0, 2, 0, -2, 2, 0, -2, 0];
/** Seat props (T76) are seating points. Shops are the leased tenant units of the floor (T32), visited at their center cell. */

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
  /** Sales share the airport keeps from a vending point, 0 for any other point (T82). */
  share: Float64Array;
}

/** Side an effective zone gives to a visit point. Commercial cells that touch both sides or neither stay commercial and are unusable. */
export function sideOfZone(zone: number): number {
  if (zone === ZONE.Secure || zone === ZONE.International) return SIDE.Air;
  if (zone === ZONE.Public) return SIDE.Land;
  return SIDE.None;
}

/**
 * Builds the visit points of one terminal floor: its seats, the center cells of its leased units and its vending machines
 * (T82), ascending by anchor cell and then kind. Allocates only here.
 */
export function buildVisitPoints(g: TerminalGrid, wg: WalkGraph, units: readonly TenantUnit[] = []): VisitPoints {
  const n = g.w * g.h;
  const anchors: number[] = [];
  const kinds: number[] = [];
  const shares: number[] = [];
  const seats = new Set(seatCells(g));
  const shops = new Map<number, number>();
  for (const u of units) {
    if (u.building !== g.id || u.brand < 0) continue;
    const a = unitAnchor(u);
    shops.set((a.y - g.y0) * g.w + (a.x - g.x0), categoryVisitKind(u.category));
  }
  const vending = vendingPoints(g);
  let v = 0;
  for (let c = 0; c < n; c++) {
    if ((g.fixture[c]! === SEATING && g.fixtureRot[c]! < TAIL_ROT) || seats.has(c) || shops.has(c)) {
      anchors.push(c);
      kinds.push(shops.get(c) ?? SEATING);
      shares.push(0);
    }
    // Vending kinds are above every fixture id, so they follow the seat or shop of the same cell.
    for (; v < vending.length && vending[v]!.cell === c; v++) {
      anchors.push(c);
      kinds.push(vending[v]!.kind);
      shares.push(vending[v]!.share);
    }
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
    share: Float64Array.from(shares),
  };
  for (let k = 0; k < count; k++) {
    const c = anchors[k]!;
    const col = c % g.w;
    const row = (c - col) / g.w;
    // A seat or vending prop may block its own cell, so people use it from the nearest open cell beside it.
    const open = seats.has(c) || kinds[k]! >= VENDING_KIND.hunger ? openCellNear(g, wg, c) : c;
    vp.kind[k] = kinds[k]!;
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

/** Index of the point anchored on this cell, whatever its kind, -1 when an edit removed it. */
export function pointAtCell(vp: VisitPoints, cell: number): number {
  for (let k = 0; k < vp.count; k++) if (vp.cell[k] === cell) return k;
  return -1;
}
