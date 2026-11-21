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
  for (let k = 0; k < count; k++) {
    const c = anchors[k]!;
    const col = c % g.w;
    const row = (c - col) / g.w;
    vp.kind[k] = g.fixture[c]!;
    vp.cell[k] = c;
    vp.lx[k] = g.x0 + col;
    vp.ly[k] = g.y0 + row;
    vp.walkNode[k] = nearestNode(wg, c);
    vp.side[k] = sideOfZone(wg.effective[c]!);
  }
  return vp;
}

/** Index of the point with this anchor cell and fixture id, -1 when an edit removed it. */
export function findPoint(vp: VisitPoints, cell: number, kind: number): number {
  for (let k = 0; k < vp.count; k++) if (vp.cell[k] === cell && vp.kind[k] === kind) return k;
  return -1;
}
