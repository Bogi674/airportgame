import type { TerminalGrid } from '@shared/business';
import { AUD } from '@shared/terminalZones';
import { pathPoint, type WalkGraph } from '../terminal/walkGraph';
import { distanceRowIn, nextEdge, type SampleCache } from '../terminal/walkDistance';

/** Length of the out array of routePoint. */
export const ROUTE_OUT = 6;

/** Array index of a logical cell of the graph's grid, or -1 outside it. */
export function cellAt(wg: WalkGraph, lx: number, ly: number): number {
  const ax = lx - wg.x0;
  const ay = ly - wg.y0;
  return ax < 0 || ay < 0 || ax >= wg.w || ay >= wg.h ? -1 : ay * wg.w + ax;
}

/**
 * Point on the route from node `from` to node `to` after s metres of walking, found by descending the distance
 * row of `to`. `walked` is the route length already covered when `from` was reached, so a caller can resume
 * from a node of an earlier call. Writes [x, y, ex, ey, node, walked] to out: the point in logical cell units
 * (cell centre), the cell step of the edge in use, and the last node passed with the length walked up to it.
 * Returns 1 while on the way, 0 at the target, -1 when there is no route. `aud` picks the audience whose edges may be used.
 * With the grid `g`, an edge whose ends do not see each other is walked over its floor cells, around the wall between.
 */
export function routePoint(
  wg: WalkGraph,
  cache: SampleCache,
  from: number,
  walked: number,
  to: number,
  s: number,
  out: Float64Array,
  aud: number = AUD.Pax,
  g?: TerminalGrid,
): number {
  const n = wg.nodeCount;
  if (!Number.isInteger(from) || from < 0 || from >= n) return -1;
  const base = distanceRowIn(wg, cache, to, aud);
  if (base < 0 || cache.rows[base + from] === Infinity) return -1;
  let acc = walked;
  let u = from;
  let ex = 0;
  let ey = 0;
  for (let hops = 0; u !== to; hops++) {
    if (hops >= n) return -1;
    const e = nextEdge(wg, cache.rows, base, u, aud);
    if (e < 0) return -1;
    const v = wg.edgeTo[e]!;
    const len = wg.edgeLen[e]!;
    const dx = wg.nodeX[v]! - wg.nodeX[u]!;
    const dy = wg.nodeY[v]! - wg.nodeY[u]!;
    ex = dx;
    ey = dy;
    if (s - acc < len) {
      if (!g || !pathPoint(g, wg, wg.nodeCell[u]!, wg.nodeCell[v]!, s - acc, out)) {
        const f = (s - acc) / len;
        out[0] = wg.nodeX[u]! + dx * f + 0.5;
        out[1] = wg.nodeY[u]! + dy * f + 0.5;
        out[2] = ex;
        out[3] = ey;
      }
      out[4] = u;
      out[5] = acc;
      return 1;
    }
    acc += len;
    u = v;
  }
  out[0] = wg.nodeX[to]! + 0.5;
  out[1] = wg.nodeY[to]! + 0.5;
  out[2] = ex;
  out[3] = ey;
  out[4] = to;
  out[5] = acc;
  return 0;
}
