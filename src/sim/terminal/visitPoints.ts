import { FIXTURE_KEYS, ZONE, type TerminalGrid } from '@shared/business';
import { nearestNode } from './walkDistance';
import type { WalkGraph } from './walkGraph';

/** Which side of security a visit point is on. */
export const SIDE = { None: 0, Land: 1, Air: 2 } as const;

/** fixtureRot below this marks the anchor of a fixture, as in serviceNodes. */
const TAIL_ROT = 5;
/** Fixtures people visit for a need: seating and the six shop kinds. */
const VISIT_IDS: readonly number[] = ['seating', 'convenience', 'quickFood', 'cafe', 'dutyFree', 'booksGifts', 'pharmacy'].map(
  (k) => FIXTURE_KEYS.indexOf(k as (typeof FIXTURE_KEYS)[number]) + 1,
);
const DX = [-1, 1, 0, 0];
const DY = [0, 0, -1, 1];

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

/** Zone value of the international zone that the T75 branch adds. It is air side. */
const ZONE_INTERNATIONAL = 5;

/** Side a zone value gives to a visit point or to a neighbour of a commercial area. Commercial cells are resolved by `commercialSide`. */
export function sideOfZone(zone: number): number {
  if (zone === ZONE.Secure || zone === ZONE_INTERNATIONAL) return SIDE.Air;
  if (zone === ZONE.Public) return SIDE.Land;
  return SIDE.None;
}

/**
 * Side of a commercial area: it takes the side of the zones it touches (docs/TERMINAL_ZONING.md section 1). An area
 * touching both sides or neither is unusable. Floods the 4 connected commercial cells from `cell`.
 */
function commercialSide(g: TerminalGrid, cell: number, seen: Uint8Array, queue: Int32Array): number {
  const w = g.w;
  const h = g.h;
  let head = 0;
  let tail = 0;
  queue[tail++] = cell;
  seen[cell] = 1;
  let air = false;
  let land = false;
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % w;
    const y = (i - x) / w;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      const z = g.zone[j]!;
      if (z === ZONE.Commercial) {
        if (seen[j] === 0) {
          seen[j] = 1;
          queue[tail++] = j;
        }
        continue;
      }
      const side = sideOfZone(z);
      if (side === SIDE.Air) air = true;
      else if (side === SIDE.Land) land = true;
    }
  }
  for (let i = 0; i < tail; i++) seen[queue[i]!] = 0;
  if (air && !land) return SIDE.Air;
  if (land && !air) return SIDE.Land;
  return SIDE.None;
}

/** Side of an anchor cell by its own zone, or by the commercial area it stands in. */
function sideOf(g: TerminalGrid, cell: number, seen: Uint8Array, queue: Int32Array): number {
  const zone = g.zone[cell]!;
  return zone === ZONE.Commercial ? commercialSide(g, cell, seen, queue) : sideOfZone(zone);
}

/** Builds the visit points of one terminal floor. Allocates only here. */
export function buildVisitPoints(g: TerminalGrid, wg: WalkGraph): VisitPoints {
  const n = g.w * g.h;
  const anchors: number[] = [];
  for (let c = 0; c < n; c++) {
    if (VISIT_IDS.includes(g.fixture[c]!) && g.fixtureRot[c]! < TAIL_ROT) anchors.push(c);
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
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  for (let k = 0; k < count; k++) {
    const c = anchors[k]!;
    const col = c % g.w;
    const row = (c - col) / g.w;
    vp.kind[k] = g.fixture[c]!;
    vp.cell[k] = c;
    vp.lx[k] = g.x0 + col;
    vp.ly[k] = g.y0 + row;
    vp.walkNode[k] = nearestNode(wg, c);
    vp.side[k] = sideOf(g, c, seen, queue);
  }
  return vp;
}

/** Index of the point with this anchor cell and fixture id, -1 when an edit removed it. */
export function findPoint(vp: VisitPoints, cell: number, kind: number): number {
  for (let k = 0; k < vp.count; k++) if (vp.cell[k] === cell && vp.kind[k] === kind) return k;
  return -1;
}
