import { BUSINESS } from '@data/index';
import { FIXTURE_KEYS, TERMINAL_CELL_M, ZONE, fixtureKey, type TerminalGrid } from '@shared/business';
import { canStep } from '@shared/terminalRooms';
import type { Rng } from '../rng';
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
/** Finished cohorts remembered per service node. */
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
 * when `secure` is set. The anchor is the start and is not counted.
 */
function queueCells(g: TerminalGrid, start: number, secure: boolean, reach: number, seen: Uint8Array, dist: Int32Array, queue: Int32Array): number {
  const W = g.w;
  seen.fill(0);
  seen[start] = 1;
  dist[start] = 0;
  queue[0] = start;
  let head = 0;
  let tail = 1;
  let counted = 0;
  while (head < tail) {
    const i = queue[head++];
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
      queue[tail++] = j;
      counted++;
    }
  }
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

  const nodes: ServiceNodes = {
    count,
    kind: new Uint8Array(count),
    cell: new Int32Array(count),
    lx: new Int32Array(count),
    ly: new Int32Array(count),
    servers: new Uint8Array(count),
    meanS: new Float32Array(count),
    queueCap: new Int32Array(count),
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
    const cells = queueCells(g, c, id === SECURITY, reach, seen, dist, queue);
    nodes.queueCap[k] = Math.floor(cells * AREA_PER_CELL * density);
    nodes.walkNode[k] = wg.cellNode[c]!;
  }
  return nodes;
}

/**
 * exp of a number in the range of a lognormal draw, from a Taylor series of x / 16 with 14 terms, squared
 * four times. Only + - * / so the result is the same on every platform.
 */
export function expSeries(x: number): number {
  const u = x / 2 ** EXP_HALVINGS;
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
  let z = -NORMAL_ROLLS / 2;
  for (let i = 0; i < NORMAL_ROLLS; i++) z += rng.next();
  return expSeries(Math.sqrt(s2) * z - s2 / 2);
}
