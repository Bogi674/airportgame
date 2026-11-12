import { FIXTURE_KEYS, type TerminalGrid } from '@shared/business';
import type { OverlayData } from '@shared/overlay';
import { cellIndex } from '@shared/terminalOps';
import { Stage } from '../cohorts/cohorts';
import { serviceWait, type ServiceNodes } from './serviceNodes';

export type { OverlayData } from '@shared/overlay';

/** Largest value a Uint16 overlay field holds. Also the marker for an unreachable gate. */
export const OVERLAY_MAX = 65535;

/** Cohort columns the overlay reads. Cohorts satisfy it without a copy. */
export interface OverlayPeople {
  hi: number;
  stage: Uint8Array;
  node: Int32Array;
  size: Uint8Array;
  building: Uint8Array;
}

/** Walk graph queries of one building, supplied by the business. */
export interface OverlayWalk {
  /** Walk node of the curb for a grid index. */
  curbNode(index: number): number;
  /** Walk node nearest an array cell, for a grid id. */
  nearestNode(gridId: number, cell: number): number;
  /** Walking metres between two walk nodes, for a grid id. */
  walkDistance(gridId: number, from: number, to: number): number;
}

const GATE_DESK = FIXTURE_KEYS.indexOf('gateDesk') + 1;
const CHECK_IN = FIXTURE_KEYS.indexOf('checkIn') + 1;
const SECURITY = FIXTURE_KEYS.indexOf('security') + 1;

/** Array sized to n, reused when the size already matches, so a steady overlay allocates nothing. */
function fit<T extends Uint16Array | Int32Array>(a: T, n: number, make: (n: number) => T): T {
  return a.length === n ? a : make(n);
}

/** Number of gate desk nodes in a table. */
function gateCount(sn: ServiceNodes): number {
  let n = 0;
  for (let k = 0; k < sn.count; k++) if (sn.kind[k] === GATE_DESK) n++;
  return n;
}

/** First service node of a kind in table order, -1 when the building has none. */
function firstOfKind(sn: ServiceNodes, kind: number): number {
  for (let k = 0; k < sn.count; k++) if (sn.kind[k] === kind) return k;
  return -1;
}

/** Cell a queued or served cohort stands on: its queue cell by rank, or the node cell when it is being served or has no queue cell. */
function queueCellOf(sn: ServiceNodes, node: number, c: number, nodeCell: number, grid: TerminalGrid): number {
  if (sn.serving[node] === c) return nodeCell;
  const slots = sn.slots;
  for (let i = 0; i < sn.qCount[node]!; i++) {
    if (sn.qCohort[node * slots + ((sn.qHead[node]! + i) % slots)] !== c) continue;
    const len = sn.qCellLen[node]!;
    if (len === 0) return nodeCell;
    const cell = sn.qCellOffset[node]! + Math.min(i, len - 1);
    return cellIndex(grid, sn.qCellX[cell]!, sn.qCellY[cell]!);
  }
  return nodeCell;
}

/** Overlay of a grid index that has no building or no service table: every array empty. */
export function emptyOverlay(out: OverlayData, index: number): OverlayData {
  out.building = index;
  out.w = 0;
  out.h = 0;
  out.density = fit(out.density, 0, (n) => new Uint16Array(n));
  out.nodeCell = fit(out.nodeCell, 0, (n) => new Int32Array(n));
  out.nodeQueue = fit(out.nodeQueue, 0, (n) => new Uint16Array(n));
  out.nodeWaitS = fit(out.nodeWaitS, 0, (n) => new Uint16Array(n));
  out.gateCell = fit(out.gateCell, 0, (n) => new Int32Array(n));
  out.gateDistM = fit(out.gateDistM, 0, (n) => new Uint16Array(n));
  return out;
}

/**
 * Fills out for one building. Walking cohorts sit at their target node cell, since their origin and total walk
 * time are not stored. A walking cohort with no target (node -1) stands at the first node of the kind it walks
 * to: check in for ToCheckIn, security for ToSecurity, gate desk for ToGate. Airside cohorts with no target sit
 * at the first gate desk. Curb cohorts are outside the building and are not counted. Cohorts with no cell to
 * stand on are not counted.
 */
export function buildOverlayData(
  out: OverlayData,
  index: number,
  gridId: number,
  grid: TerminalGrid,
  sn: ServiceNodes,
  people: OverlayPeople,
  walk: OverlayWalk,
  tick: number,
): OverlayData {
  const cells = grid.w * grid.h;
  out.building = index;
  out.w = grid.w;
  out.h = grid.h;
  out.density = fit(out.density, cells, (n) => new Uint16Array(n));
  out.density.fill(0);
  out.nodeCell = fit(out.nodeCell, sn.count, (n) => new Int32Array(n));
  out.nodeQueue = fit(out.nodeQueue, sn.count, (n) => new Uint16Array(n));
  out.nodeWaitS = fit(out.nodeWaitS, sn.count, (n) => new Uint16Array(n));
  const gates = gateCount(sn);
  out.gateCell = fit(out.gateCell, gates, (n) => new Int32Array(n));
  out.gateDistM = fit(out.gateDistM, gates, (n) => new Uint16Array(n));

  for (let k = 0; k < sn.count; k++) {
    out.nodeCell[k] = cellIndex(grid, sn.lx[k]!, sn.ly[k]!);
    out.nodeQueue[k] = Math.min(OVERLAY_MAX, sn.queueLen[k]!);
    out.nodeWaitS[k] = Math.min(OVERLAY_MAX, Math.round(serviceWait(sn, k, tick)));
  }

  const curb = walk.curbNode(index);
  let gi = 0;
  for (let k = 0; k < sn.count; k++) {
    if (sn.kind[k] !== GATE_DESK) continue;
    const cell = out.nodeCell[k]!;
    const d = walk.walkDistance(gridId, curb, walk.nearestNode(gridId, cell));
    out.gateCell[gi] = cell;
    out.gateDistM[gi] = Number.isFinite(d) ? Math.min(OVERLAY_MAX, Math.round(d)) : OVERLAY_MAX;
    gi++;
  }

  const firstGate = firstOfKind(sn, GATE_DESK);
  const firstCheckIn = firstOfKind(sn, CHECK_IN);
  const firstSecurity = firstOfKind(sn, SECURITY);
  for (let c = 0; c < people.hi; c++) {
    if (people.building[c] !== index) continue;
    const st = people.stage[c]!;
    let cell = -1;
    if (st === Stage.CheckIn || st === Stage.Security || st === Stage.Gate) {
      const node = people.node[c]!;
      if (node >= 0 && node < sn.count) cell = queueCellOf(sn, node, c, out.nodeCell[node]!, grid);
    } else if (st === Stage.ToCheckIn || st === Stage.ToSecurity || st === Stage.ToGate) {
      const node = people.node[c]!;
      if (node >= 0 && node < sn.count) cell = out.nodeCell[node]!;
      else if (st === Stage.ToCheckIn && firstCheckIn >= 0) cell = out.nodeCell[firstCheckIn]!;
      else if (st === Stage.ToSecurity && firstSecurity >= 0) cell = out.nodeCell[firstSecurity]!;
      else if (st === Stage.ToGate && firstGate >= 0) cell = out.nodeCell[firstGate]!;
    } else if (st === Stage.Airside) {
      if (firstGate >= 0) cell = out.nodeCell[firstGate]!;
    } else {
      continue;
    }
    if (cell >= 0 && cell < cells) out.density[cell] = Math.min(OVERLAY_MAX, out.density[cell]! + people.size[c]!);
  }
  return out;
}
