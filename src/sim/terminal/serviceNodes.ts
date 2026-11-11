import { BUSINESS } from '@data/index';
import { FIXTURE_KEYS, TERMINAL_CELL_M, ZONE, fixtureKey, type TerminalGrid } from '@shared/business';
import { canStep } from '@shared/terminalRooms';
import type { Rng } from '../rng';
import { packTyped, unpackTyped } from '../save/pack';
import type { WalkGraph } from './walkGraph';

/** Fixtures that serve people one at a time. Each anchor of these is a service node. */
export const SERVICE_KEYS = ['checkIn', 'kiosk', 'bagDrop', 'security', 'passport', 'gateDesk', 'toilet'] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

/** fixtureRot below this marks the anchor of a fixture. 5 and up is the tail of a two cell fixture. */
const TAIL_ROT = 5;
/** Lattice terms for ln and the exp Taylor terms, fixed so every platform sums the same way. */
const LN_TERMS = 12;
const EXP_TERMS = 14;
const EXP_HALVINGS = 4;
/** Uniforms summed for an approximate standard normal: 12 uniforms have mean 6 and variance 1. */
const NORMAL_ROLLS = 12;
/** Finished cohorts the done buffer holds per node. The buffer is shared by all nodes of a table: count * 16 entries per call. */
export const DONE_PER_NODE = 16;

const SECURITY = FIXTURE_KEYS.indexOf('security') + 1;
const SERVICE_IDS: readonly number[] = SERVICE_KEYS.map((k) => FIXTURE_KEYS.indexOf(k) + 1);
const AREA_PER_CELL = TERMINAL_CELL_M * TERMINAL_CELL_M;
const DX = [-1, 1, 0, 0];
const DY = [0, 0, -1, 1];

/**
 * Struct of arrays for every service node of one terminal floor, in ascending array cell order. Queues are
 * ring buffers of `slots` cohorts per node. The join and update logic lives elsewhere.
 */
export interface ServiceNodes {
  count: number;
  /** Fixture id of the node, see FIXTURE_KEYS. */
  kind: Uint8Array;
  /** Array cell index of the anchor. */
  cell: Int32Array;
  /** Logical cell of the anchor. */
  lx: Int32Array;
  ly: Int32Array;
  /** Parallel servers at the node, from the module data. */
  servers: Uint8Array;
  /** Mean service time in seconds, from the module data. */
  meanS: Float32Array;
  /** Most people the walkable area around the node holds in a queue. */
  queueCap: Int32Array;
  /** Queue cells of each node: first index in qCellX and qCellY, and how many. Logical cells, nearest the node first. */
  qCellOffset: Int32Array;
  qCellLen: Int32Array;
  qCellX: Int32Array;
  qCellY: Int32Array;
  /** Local index of the cell each queue cell was reached from, -1 for the node cell. Rank order is BFS order. */
  qCellParent: Int32Array;
  /** Walk graph node of the anchor cell. */
  walkNode: Int32Array;
  /** People waiting in the queue. */
  queueLen: Int32Array;
  /** Tick when the node's servers are next free. */
  busyUntil: Int32Array;
  /** Cohort being served at the node, -1 when idle. */
  serving: Int32Array;
  servingSize: Int32Array;
  slots: number;
  qCohort: Int32Array;
  qSize: Int32Array;
  qHead: Uint16Array;
  qCount: Uint16Array;
  doneCohort: Int32Array;
  doneNode: Int32Array;
  doneCount: number;
  evicted: Int32Array;
  evictedCount: number;
  /** Cohorts queued or serving at any node. */
  active: number;
}

/** Module timing for a service key. Every service key carries both values in the data. */
function timing(key: ServiceKey): { servers: number; meanS: number } {
  const m = BUSINESS.modules[key];
  if (m.servers === undefined || m.serviceSeconds === undefined) throw new Error(`${key} has no service timing`);
  return { servers: m.servers, meanS: m.serviceSeconds };
}

/**
 * Counts the cells a queue for the anchor at `start` can use. Breadth first over canStep, at most `reach`
 * steps out. Only cells without a fixture count and only they are passed through. Secure cells are skipped
 * when `secure` is set. The anchor is the start and is not counted. The counted cells are left in
 * queue[1..count], in the order found, so nearest the anchor first. parent[p] is the queue position the cell at
 * queue[p] was reached from.
 */
function queueCells(g: TerminalGrid, start: number, secure: boolean, reach: number, seen: Uint8Array, dist: Int32Array, queue: Int32Array, parent: Int32Array): number {
  const W = g.w;
  seen[start] = 1;
  dist[start] = 0;
  queue[0] = start;
  let head = 0;
  let tail = 1;
  let counted = 0;
  while (head < tail) {
    const pos = head;
    const i = queue[head++]!;
    if (dist[i] >= reach) continue;
    const x = i % W;
    const y = (i - x) / W;
    for (let d = 0; d < 4; d++) {
      if (!canStep(g, x, y, d)) continue;
      const j = (y + DY[d]) * W + x + DX[d];
      if (seen[j] === 1 || g.fixture[j] !== 0) continue;
      if (secure && g.zone[j] === ZONE.Secure) continue;
      seen[j] = 1;
      dist[j] = dist[i] + 1;
      parent[tail] = pos;
      queue[tail++] = j;
      counted++;
    }
  }
  for (let i = 0; i < tail; i++) seen[queue[i]!] = 0;
  return counted;
}

/** Builds the service node table of one terminal floor. Nodes are the anchors of the service fixtures, in cell order. */
export function buildServiceNodes(g: TerminalGrid, wg: WalkGraph): ServiceNodes {
  const n = g.w * g.h;
  const anchors: number[] = [];
  for (let c = 0; c < n; c++) {
    if (SERVICE_IDS.includes(g.fixture[c]!) && g.fixtureRot[c]! < TAIL_ROT) anchors.push(c);
  }
  const count = anchors.length;
  const slots = BUSINESS.terminal.service.queueSlots;
  const reach = BUSINESS.terminal.service.queueReachCells;
  const density = BUSINESS.terminal.service.queueDensityPerM2;
  const seen = new Uint8Array(n);
  const dist = new Int32Array(n);
  const queue = new Int32Array(n);
  const parent = new Int32Array(n);
  const cellX: number[] = [];
  const cellY: number[] = [];
  const cellParent: number[] = [];

  const nodes: ServiceNodes = {
    count,
    kind: new Uint8Array(count),
    cell: new Int32Array(count),
    lx: new Int32Array(count),
    ly: new Int32Array(count),
    servers: new Uint8Array(count),
    meanS: new Float32Array(count),
    queueCap: new Int32Array(count),
    qCellOffset: new Int32Array(count),
    qCellLen: new Int32Array(count),
    qCellX: new Int32Array(0),
    qCellY: new Int32Array(0),
    qCellParent: new Int32Array(0),
    walkNode: new Int32Array(count),
    queueLen: new Int32Array(count),
    busyUntil: new Int32Array(count),
    serving: new Int32Array(count).fill(-1),
    servingSize: new Int32Array(count),
    slots,
    qCohort: new Int32Array(count * slots),
    qSize: new Int32Array(count * slots),
    qHead: new Uint16Array(count),
    qCount: new Uint16Array(count),
    doneCohort: new Int32Array(count * DONE_PER_NODE),
    doneNode: new Int32Array(count * DONE_PER_NODE),
    doneCount: 0,
    evicted: new Int32Array(0),
    evictedCount: 0,
    active: 0,
  };

  for (let k = 0; k < count; k++) {
    const c = anchors[k]!;
    const id = g.fixture[c]!;
    const key = fixtureKey(id) as ServiceKey;
    const t = timing(key);
    const x = c % g.w;
    nodes.kind[k] = id;
    nodes.cell[k] = c;
    nodes.lx[k] = g.x0 + x;
    nodes.ly[k] = g.y0 + (c - x) / g.w;
    nodes.servers[k] = t.servers;
    nodes.meanS[k] = t.meanS;
    const cells = queueCells(g, c, id === SECURITY, reach, seen, dist, queue, parent);
    nodes.queueCap[k] = Math.floor(cells * AREA_PER_CELL * density);
    nodes.qCellOffset[k] = cellX.length;
    nodes.qCellLen[k] = cells;
    for (let i = 1; i <= cells; i++) {
      const j = queue[i]!;
      const jx = j % g.w;
      cellX.push(g.x0 + jx);
      cellY.push(g.y0 + (j - jx) / g.w);
      // Queue position p is the cell reached from position p - 1 of the queue, so its stored index is p - 1 and the start is -1.
      cellParent.push(parent[i]! - 1);
    }
    nodes.walkNode[k] = wg.cellNode[c]!;
  }
  nodes.qCellX = Int32Array.from(cellX);
  nodes.qCellY = Int32Array.from(cellY);
  nodes.qCellParent = Int32Array.from(cellParent);
  return nodes;
}

/** Index of the node of a table at logical cell (lx, ly) with the given kind, -1 when there is none. */
function findNode(sn: ServiceNodes, lx: number, ly: number, kind: number): number {
  for (let k = 0; k < sn.count; k++) if (sn.lx[k] === lx && sn.ly[k] === ly && sn.kind[k] === kind) return k;
  return -1;
}

/**
 * Builds the table of a grid after a change and carries the queues of `prev` over. A node is the same when its
 * logical cell and fixture kind match. Cohorts at a node that no longer exists are evicted: its serving cohort,
 * then its queue in order. Evicted cohorts are kept on the new table, after the ones already evicted before.
 * Allocates, so it runs at command time only.
 */
export function rebuildServiceNodes(prev: ServiceNodes, g: TerminalGrid, wg: WalkGraph): ServiceNodes {
  const next = buildServiceNodes(g, wg);
  const evicted: number[] = Array.from(prev.evicted.subarray(0, prev.evictedCount));
  for (let p = 0; p < prev.count; p++) {
    const k = findNode(next, prev.lx[p]!, prev.ly[p]!, prev.kind[p]!);
    if (k < 0) {
      if (prev.serving[p]! >= 0) evicted.push(prev.serving[p]!);
      for (let q = 0; q < prev.qCount[p]!; q++) evicted.push(prev.qCohort[p * prev.slots + ((prev.qHead[p]! + q) % prev.slots)]!);
      continue;
    }
    next.queueLen[k] = prev.queueLen[p]!;
    next.busyUntil[k] = prev.busyUntil[p]!;
    next.serving[k] = prev.serving[p]!;
    next.servingSize[k] = prev.servingSize[p]!;
    next.qHead[k] = prev.qHead[p]!;
    next.qCount[k] = prev.qCount[p]!;
    for (let s = 0; s < prev.slots; s++) {
      next.qCohort[k * next.slots + s] = prev.qCohort[p * prev.slots + s]!;
      next.qSize[k * next.slots + s] = prev.qSize[p * prev.slots + s]!;
    }
    next.active += prev.qCount[p]! + (prev.serving[p]! >= 0 ? 1 : 0);
  }
  next.evicted = Int32Array.from(evicted);
  next.evictedCount = evicted.length;
  return next;
}

/**
 * exp of a number in the range of a lognormal draw, from a Taylor series of x / 16 with 14 terms, squared
 * four times. Only + - * / so the result is the same on every platform.
 */
export function expSeries(x: number): number {
  const u = x / 16;
  let term = 1;
  let sum = 1;
  for (let k = 1; k < EXP_TERMS; k++) {
    term = (term * u) / k;
    sum += term;
  }
  for (let i = 0; i < EXP_HALVINGS; i++) sum *= sum;
  return sum;
}

/**
 * Natural log for x in (0.5, 2], from the odd series of atanh with 12 terms. Only + - * / so the result is
 * the same on every platform.
 */
export function lnSeries(x: number): number {
  const y = (x - 1) / (x + 1);
  const y2 = y * y;
  let power = y;
  let sum = 0;
  for (let k = 0; k < LN_TERMS; k++) {
    sum += power / (2 * k + 1);
    power *= y2;
  }
  return 2 * sum;
}

/**
 * A lognormal draw with mean 1 and coefficient of variation cv. The normal is a sum of 12 uniforms, centred
 * and with variance 1, so the result is exact under the seeded stream on every platform.
 */
export function lognormalFactor(rng: Rng, cv: number): number {
  const s2 = lnSeries(1 + cv * cv);
  return lognormalDraw(rng, Math.sqrt(s2), s2);
}

/** One lognormal draw from precomputed sigma and sigma squared, so a caller with many draws computes them once. */
function lognormalDraw(rng: Rng, sigma: number, s2: number): number {
  let z = -NORMAL_ROLLS / 2;
  for (let i = 0; i < NORMAL_ROLLS; i++) z += rng.next();
  return expSeries(sigma * z - s2 / 2);
}

/** Ticks per game second, see docs/ARCHITECTURE.md. */
const TICKS_PER_S = 10;

/**
 * Queues a cohort of `size` people at a node. False when the node is out of range, the cohort is empty, the
 * node has no queue room or the queue is full. Once people wait, a cohort may not take the queue past its cap,
 * but an empty queue takes any size so one large cohort can always start.
 */
// hot
export function serviceJoin(sn: ServiceNodes, node: number, cohort: number, size: number): boolean {
  if (node < 0 || node >= sn.count || size < 1) return false;
  if (sn.queueCap[node] === 0 || sn.qCount[node] === sn.slots) return false;
  if (sn.queueLen[node] > 0 && sn.queueLen[node] + size > sn.queueCap[node]) return false;
  const slot = node * sn.slots + ((sn.qHead[node] + sn.qCount[node]) % sn.slots);
  sn.qCohort[slot] = cohort;
  sn.qSize[slot] = size;
  sn.qCount[node] += 1;
  sn.queueLen[node] += size;
  sn.active += 1;
  return true;
}

/**
 * Advances every node to `tick`. A serving cohort finishes once its busy time has passed and the next waiting
 * cohort starts at the finish tick, so a node never loses time between cohorts. Finished cohorts go to the done
 * buffer, which holds 16 per node, so a call finishes at most that many. The rest stay serving and finish on a
 * later call. Draws from rng only when a cohort starts.
 */
// hot
export function serviceUpdate(sn: ServiceNodes, tick: number, rng: Rng): void {
  sn.doneCount = 0;
  if (sn.active === 0) return;
  const cv = BUSINESS.terminal.service.cv;
  const s2 = lnSeries(1 + cv * cv);
  const sigma = Math.sqrt(s2);
  const doneCap = sn.doneCohort.length;
  for (let k = 0; k < sn.count; k++) {
    let finish = -1;
    for (;;) {
      if (sn.serving[k] >= 0) {
        if (sn.busyUntil[k] > tick || sn.doneCount >= doneCap) break;
        const d = sn.doneCount;
        sn.doneCount += 1;
        sn.doneCohort[d] = sn.serving[k];
        sn.doneNode[d] = k;
        finish = sn.busyUntil[k];
        sn.serving[k] = -1;
        sn.active -= 1;
      }
      if (sn.qCount[k] === 0) break;
      const slot = k * sn.slots + sn.qHead[k];
      const size = sn.qSize[slot];
      sn.qHead[k] = (sn.qHead[k] + 1) % sn.slots;
      sn.qCount[k] -= 1;
      sn.queueLen[k] -= size;
      const start = finish >= 0 ? finish : tick;
      const f = lognormalDraw(rng, sigma, s2);
      sn.serving[k] = sn.qCohort[slot];
      sn.servingSize[k] = size;
      sn.busyUntil[k] = start + Math.max(1, Math.round((size * sn.meanS[k] * f * TICKS_PER_S) / sn.servers[k]));
    }
  }
}

/**
 * Seconds a person joining node now would wait: the time left on the cohort being served plus the people
 * queued ahead, each at the node's mean service time over its servers. Infinity for a node out of range.
 */
// hot
export function serviceWait(sn: ServiceNodes, node: number, tick: number): number {
  if (node < 0 || node >= sn.count) return Infinity;
  const left = sn.serving[node] >= 0 ? Math.max(0, sn.busyUntil[node] - tick) / TICKS_PER_S : 0;
  return left + (sn.queueLen[node] * sn.meanS[node]) / sn.servers[node];
}

/** The queue state of a service table as saved. Grid derived arrays are not saved, they come from the grid. */
export interface ServiceSave {
  count: number;
  queueLen: string;
  busyUntil: string;
  serving: string;
  servingSize: string;
  qCohort: string;
  qSize: string;
  qHead: string;
  qCount: string;
  evictedCount: number;
  /** The first evictedCount entries of the evicted list. */
  evicted: string;
}

/** Packs the queue state of a service table for a save. */
export function serviceSave(sn: ServiceNodes): ServiceSave {
  return {
    count: sn.count,
    queueLen: packTyped(sn.queueLen),
    busyUntil: packTyped(sn.busyUntil),
    serving: packTyped(sn.serving),
    servingSize: packTyped(sn.servingSize),
    qCohort: packTyped(sn.qCohort),
    qSize: packTyped(sn.qSize),
    qHead: packTyped(sn.qHead),
    qCount: packTyped(sn.qCount),
    evictedCount: sn.evictedCount,
    evicted: packTyped(sn.evicted.subarray(0, sn.evictedCount)),
  };
}

/**
 * Restores the queue state of a table built from the same grid. False and no change when the node count or any
 * array length differs, so a save from another layout cannot write past the table. Finished cohorts are not
 * saved and start empty.
 */
export function serviceLoad(sn: ServiceNodes, s: ServiceSave): boolean {
  if (s.count !== sn.count) return false;
  const evicted = unpackTyped(s.evicted, Int32Array);
  if (evicted.length !== s.evictedCount) return false;
  const pairs: [ArrayLike<number>, { length: number; set(src: ArrayLike<number>): void }][] = [
    [unpackTyped(s.queueLen, Int32Array), sn.queueLen],
    [unpackTyped(s.busyUntil, Int32Array), sn.busyUntil],
    [unpackTyped(s.serving, Int32Array), sn.serving],
    [unpackTyped(s.servingSize, Int32Array), sn.servingSize],
    [unpackTyped(s.qCohort, Int32Array), sn.qCohort],
    [unpackTyped(s.qSize, Int32Array), sn.qSize],
    [unpackTyped(s.qHead, Uint16Array), sn.qHead],
    [unpackTyped(s.qCount, Uint16Array), sn.qCount],
  ];
  if (pairs.some(([src, dst]) => src.length !== dst.length)) return false;
  for (const [src, dst] of pairs) dst.set(src);
  sn.evicted = evicted;
  sn.evictedCount = evicted.length;
  sn.doneCount = 0;
  sn.active = 0;
  for (let k = 0; k < sn.count; k++) sn.active += sn.qCount[k]! + (sn.serving[k]! >= 0 ? 1 : 0);
  return true;
}
