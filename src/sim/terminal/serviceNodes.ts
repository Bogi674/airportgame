import { frontStep, useDepth } from '@shared/useArea';
import { ARRIVALS, BUSINESS, DEPARTURES, PROFILES, STAFF } from '@data/index';
import { FIXTURE_KEYS, TERMINAL_CELL_M, fixtureKey, type FixtureKey, type TerminalGrid } from '@shared/business';
import { isLeveled, levelServiceSeconds } from '@shared/fixtureLevels';
import { CLOCK_SCALE, gameSecondsToTicks } from '@shared/time';
import { fixtureCells } from '@shared/terminalOps';
import { AUD, flowStep, stepAud, transitionOf, type ZoneAccess } from '@shared/terminalZones';
import { washrooms, type Washroom } from '@shared/props';
import { labelRooms } from '@shared/terminalRooms';
import { nearestNode } from './walkDistance';
import type { Rng } from '../rng';
import { packTyped, unpackTyped } from '../save/pack';
import type { WalkGraph } from './walkGraph';

/** Fixtures that serve people one at a time. Each anchor of these is a service node. */
export const SERVICE_KEYS = ['checkIn', 'kiosk', 'bagDrop', 'security', 'passport', 'gateDesk', 'toilet', 'eGate', 'customs', 'securityExit'] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];
/** Keys before this index existed before save version 31, so the migration needs no hard coded list. */
export const LEGACY_SERVICE_COUNT = 7;
/** Keys before this index existed before save version 34, when security exits became service nodes (T80). */
export const V33_SERVICE_COUNT = 9;

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

const SERVICE_IDS: readonly number[] = SERVICE_KEYS.map((k) => FIXTURE_KEYS.indexOf(k) + 1);
const TOILET_ID = FIXTURE_KEYS.indexOf('toilet') + 1;
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
  /**
   * Single file line of each node for the people sample (PX1): `slots` logical cells per node at k * slots, rank 0 at
   * the desk front, running straight back and folding where blocked. qLineLen holds how many are set. Derived, not saved.
   */
  qLineX: Int32Array;
  qLineY: Int32Array;
  qLineLen: Int32Array;
  /**
   * Where the group being served is drawn, in logical cell units (cell centres): it moves from (passX0, passY0) to
   * (passX1, passY1) as its service runs. A transition fixture spans its entry to its exit cells, any other fixture
   * holds still at the first cell of its line. Derived, not saved.
   */
  passX0: Float32Array;
  passY0: Float32Array;
  passX1: Float32Array;
  passY1: Float32Array;
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
  /** 1 while the node may not start a new service, set by the baggage back pressure. Derived, not saved. */
  blocked: Uint8Array;
  /** Officers the node needs to serve at full speed, 0 when it needs none. Derived from the staff data, not saved. */
  staffNeed: Uint8Array;
  /** Officers on duty at the node. Derived, set by the staff store, not saved. */
  staffPresent: Uint8Array;
  /** Service speed factor of the staff on the node, 1 for nodes that need no staff. Derived, not saved. */
  staffFactor: Float32Array;
  /** 1 on a node closed for upgrade works (T74): it takes no queue and needs no staff. */
  closed: Uint8Array;
}

/**
 * Module timing for a service key. Every service key carries both values in the data. A passport booth or eGate in
 * departure mode (mode 0) takes its own departure values (T79), a security exit the values of its level (T80), and a leveled fixture above level 1 the values of its level (T74).
 */
function timing(key: ServiceKey, mode: number, level: number): { servers: number; meanS: number } {
  if (key === 'securityExit') {
    const lv = ARRIVALS.service.securityExit.levels[Math.min(Math.max(level, 1), 3) - 1]!;
    return { servers: lv.servers, meanS: lv.serviceSeconds };
  }
  if ((key === 'passport' || key === 'eGate') && mode === 0) return { servers: DEPARTURES.service[key].servers, meanS: DEPARTURES.service[key].serviceSeconds };
  if (key === 'eGate' || key === 'customs') return { servers: ARRIVALS.service[key].servers, meanS: ARRIVALS.service[key].serviceSeconds };
  const m = BUSINESS.modules[key];
  if (m.servers === undefined || m.serviceSeconds === undefined) throw new Error(`${key} has no service timing`);
  // Levels 2 and 3 of a leveled fixture serve at their own speed in every mode (T74).
  if (isLeveled(key) && level > 1) return { servers: m.servers, meanS: levelServiceSeconds(key, level) };
  return { servers: m.servers, meanS: m.serviceSeconds };
}

/** Staff a station needs at a fixture level, 0 for a fixture without a station. */
export function stationNeed(key: FixtureKey, level: number): number {
  const entry = STAFF.stations[key];
  if (!entry) return 0;
  return entry.needByLevel ? entry.needByLevel[Math.min(Math.max(level, 1), 3) - 1]! : entry.need;
}

/**
 * Counts the cells a queue for the anchor at `start` can use. Breadth first, at most `reach` steps out. Only cells
 * without a fixture count and only they are passed through. A transition fixture queues on its entry side, in cells
 * of its from zone. Its own first step may cross any edge that lets one of its audiences through in either direction,
 * and every later step needs the audience the fixture serves (passengers, or staff for a staff lane) to be able to
 * walk back toward the anchor, so a staff only door never extends a passenger queue. Every other anchor steps over
 * edges that are open to everyone. The start is the anchor, or for a transition fixture over several cells its entry
 * cells, the cells whose upstream neighbour lies outside the fixture (a 16 m security lane queues at its entrance,
 * T74). Start cells are not counted. They are left in queue[0..seeds - 1] and the counted cells after them, in the
 * order found, so nearest the start first. parent[p] is the queue position the cell at queue[p] was reached from.
 */
function queueCells(g: TerminalGrid, acc: ZoneAccess, effective: Uint8Array, start: number, reach: number, seen: Uint8Array, dist: Int32Array, queue: Int32Array, parent: Int32Array): { counted: number; seeds: number } {
  const W = g.w;
  const transition = g.fixture[start] === 0 ? null : transitionOf(fixtureKey(g.fixture[start]!), g.fixtureMode[start]!);
  // The audience whose walk toward the anchor must be possible: passengers unless the fixture is staff only.
  const need = transition && (transition.aud & AUD.Pax) !== 0 ? AUD.Pax : AUD.Staff;
  // A fixture with a use area queues only on its front side, which turns with it (T85): every footprint cell seeds, and
  // the first step goes toward the front.
  const key = !transition && g.fixture[start]! > 0 ? fixtureKey(g.fixture[start]!) : null;
  const code = g.fixtureRot[start]!;
  const front = key !== null && useDepth(key).front > 0 ? frontStep(code === 0 ? 0 : code - 1) : null;
  let tail = 0;
  if (transition) {
    const [fx, fy] = flowStep(g.fixtureRot[start]!);
    const cells = fixtureCells(g, start);
    for (const c of cells) {
      const x = c % W;
      const up = cellIndexArray(g, x - fx, (c - x) / W - fy);
      if (up >= 0 && cells.includes(up)) continue;
      seen[c] = 1;
      dist[c] = 0;
      queue[tail++] = c;
    }
  } else if (front) {
    for (const c of fixtureCells(g, start)) {
      seen[c] = 1;
      dist[c] = 0;
      queue[tail++] = c;
    }
  } else {
    seen[start] = 1;
    dist[start] = 0;
    queue[tail++] = start;
  }
  const seeds = tail;
  let head = 0;
  let counted = 0;
  while (head < tail) {
    const pos = head;
    const i = queue[head++]!;
    if (dist[i] >= reach) continue;
    const x = i % W;
    const y = (i - x) / W;
    for (let d = 0; d < 4; d++) {
      const j = (y + DY[d]) * W + x + DX[d];
      if (x + DX[d] < 0 || x + DX[d] >= W || y + DY[d] < 0 || y + DY[d] >= g.h) continue;
      const out = stepAud(acc, g, x, y, d);
      const back = stepAud(acc, g, x + DX[d], y + DY[d], d ^ 1);
      if (transition) {
        if (effective[j] !== transition.from) continue;
        if (pos < seeds ? ((out | back) & transition.aud) === 0 : (back & need) === 0) continue;
      } else if (out !== 3) continue;
      else if (front && pos < seeds && (DX[d] !== front[0] || DY[d] !== front[1])) continue;
      if (seen[j] === 1 || g.fixture[j] !== 0) continue;
      seen[j] = 1;
      dist[j] = dist[i] + 1;
      parent[tail] = pos;
      queue[tail++] = j;
      counted++;
    }
  }
  for (let i = 0; i < tail; i++) seen[queue[i]!] = 0;
  return { counted, seeds };
}

/**
 * Fills the single file line of node k (PX1): the cells a queue of `slots` steps may use, walked from the cell in front
 * of the fixture straight away from it for queueRunCells cells, then one cell to the side and back again, as a
 * serpentine. Cells a prop blocks, cells of the lines of earlier nodes (allow 3) and the front cells of other nodes
 * (`owner`, node + 1) are left out, so the lines of desks side by side never share a cell or block a desk. The line ends where it gets stuck. Runs only when the table is built.
 */
function queueLine(
  g: TerminalGrid,
  wg: WalkGraph,
  anchor: number,
  slots: number,
  seen: Uint8Array,
  dist: Int32Array,
  queue: Int32Array,
  parent: Int32Array,
  allow: Uint8Array,
  owner: Int32Array,
  nodes: ServiceNodes,
  k: number,
): void {
  const W = g.w;
  const { counted, seeds } = queueCells(g, wg.access, wg.effective, anchor, slots, seen, dist, queue, parent);
  const base = k * slots;
  let len = 0;
  if (counted === 0) return;
  const first = queue[seeds]!;
  // Another node's line already holds the cell in front of this one: no line of its own.
  if (allow[first] === 3) return;
  for (let i = seeds; i < seeds + counted; i++) {
    const c = queue[i]!;
    if (wg.blocked[c] !== 1 && allow[c] === 0 && (owner[c] === 0 || owner[c] === k + 1)) allow[c] = 1;
  }
  const from = queue[parent[seeds]!]!;
  let bx = (first % W) - (from % W);
  let by = Math.floor(first / W) - Math.floor(from / W);
  let sx = 0;
  let sy = 0;
  let cur = allow[first] === 1 ? first : -1;
  const run = PROFILES.walkSample.queueRunCells;
  let steps = 0;
  const take = (c: number): void => {
    allow[c] = 2;
    const x = c % W;
    nodes.qLineX[base + len] = g.x0 + x;
    nodes.qLineY[base + len] = g.y0 + (c - x) / W;
    len++;
  };
  if (cur >= 0) take(cur);
  while (cur >= 0 && len < slots) {
    const x = cur % W;
    const y = (cur - x) / W;
    const ahead = steps + 1 < run ? cellIndexArray(g, x + bx, y + by) : -1;
    if (ahead >= 0 && allow[ahead] === 1) {
      cur = ahead;
      steps++;
      take(cur);
      continue;
    }
    // Fold: one cell to the side, the same way as the first fold, then run back the other way.
    let next = -1;
    if (sx === 0 && sy === 0) {
      for (const s of [1, -1]) {
        const c = cellIndexArray(g, x - by * s, y + bx * s);
        if (c >= 0 && allow[c] === 1) {
          next = c;
          sx = -by * s;
          sy = bx * s;
          break;
        }
      }
    } else {
      const c = cellIndexArray(g, x + sx, y + sy);
      if (c >= 0 && allow[c] === 1) next = c;
    }
    if (next < 0) break;
    cur = next;
    bx = -bx;
    by = -by;
    steps = 0;
    take(cur);
  }
  // Cells of this line stay claimed (3) so the lines of later nodes go around them; the rest are freed.
  for (let i = seeds; i < seeds + counted; i++) {
    const c = queue[i]!;
    if (allow[c] === 1) allow[c] = 0;
    else if (allow[c] === 2) allow[c] = 3;
  }
  nodes.qLineLen[k] = len;
}

/**
 * Sets where node k draws the group it serves (PX1): through a transition fixture from the centre of its entry cells
 * to the centre of its exit cells, otherwise at the first cell of its line, or on the anchor without a line.
 */
function passPoints(g: TerminalGrid, nodes: ServiceNodes, k: number, slots: number): void {
  const c = nodes.cell[k]!;
  const transition = transitionOf(fixtureKey(g.fixture[c]!), g.fixtureMode[c]!);
  if (transition) {
    const [fx, fy] = flowStep(g.fixtureRot[c]!);
    const cells = fixtureCells(g, c);
    let ax = 0;
    let ay = 0;
    let an = 0;
    let bx = 0;
    let by = 0;
    let bn = 0;
    for (const f of cells) {
      const x = f % g.w;
      const y = (f - x) / g.w;
      const up = cellIndexArray(g, x - fx, y - fy);
      const down = cellIndexArray(g, x + fx, y + fy);
      if (up < 0 || !cells.includes(up)) {
        ax += x;
        ay += y;
        an++;
      }
      if (down < 0 || !cells.includes(down)) {
        bx += x;
        by += y;
        bn++;
      }
    }
    if (an > 0 && bn > 0) {
      nodes.passX0[k] = g.x0 + ax / an + 0.5;
      nodes.passY0[k] = g.y0 + ay / an + 0.5;
      nodes.passX1[k] = g.x0 + bx / bn + 0.5;
      nodes.passY1[k] = g.y0 + by / bn + 0.5;
      return;
    }
  }
  const line = nodes.qLineLen[k]! > 0;
  const x = line ? nodes.qLineX[k * slots]! + 0.5 : nodes.lx[k]! + 0.5;
  const y = line ? nodes.qLineY[k * slots]! + 0.5 : nodes.ly[k]! + 0.5;
  nodes.passX0[k] = x;
  nodes.passY0[k] = y;
  nodes.passX1[k] = x;
  nodes.passY1[k] = y;
}

/** Array index of array cell (x, y), -1 outside the grid. */
function cellIndexArray(g: TerminalGrid, x: number, y: number): number {
  return x < 0 || y < 0 || x >= g.w || y >= g.h ? -1 : y * g.w + x;
}

/**
 * Builds the service node table of one terminal floor. Nodes are the anchors of the service fixtures and the washrooms
 * of the toilet props (T76), a toilet node each, in cell order. Anchors at the array cells in `closed` are under works:
 * they keep their node but take no queue and need no staff.
 */
export function buildServiceNodes(g: TerminalGrid, wg: WalkGraph, closed: readonly number[] = []): ServiceNodes {
  const n = g.w * g.h;
  const anchors: number[] = [];
  const wash = new Map<number, Washroom>();
  if (g.props.length > 0) for (const w of washrooms(g, labelRooms(g), wg.blocked)) wash.set(w.cell, w);
  for (let c = 0; c < n; c++) {
    if ((SERVICE_IDS.includes(g.fixture[c]!) && g.fixtureRot[c]! < TAIL_ROT) || wash.has(c)) anchors.push(c);
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
  const allow = new Uint8Array(n);
  // The straight run in front of each node belongs to that node's line, so no other line folds over it.
  const owner = new Int32Array(n);
  const run = PROFILES.walkSample.queueRunCells;
  anchors.forEach((c, k) => {
    if (wash.has(c)) return;
    const { counted, seeds } = queueCells(g, wg.access, wg.effective, c, run, seen, dist, queue, parent);
    if (counted === 0) return;
    for (let i = seeds; i < seeds + counted; i++) allow[queue[i]!] = 1;
    const first = queue[seeds]!;
    const from = queue[parent[seeds]!]!;
    const bx = (first % g.w) - (from % g.w);
    const by = Math.floor(first / g.w) - Math.floor(from / g.w);
    let cur = first;
    for (let i = 0; i < run && cur >= 0 && allow[cur] === 1 && owner[cur] === 0 && wg.blocked[cur] !== 1; i++) {
      owner[cur] = k + 1;
      const x = cur % g.w;
      cur = cellIndexArray(g, x + bx, (cur - x) / g.w + by);
    }
    for (let i = seeds; i < seeds + counted; i++) allow[queue[i]!] = 0;
  });

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
    qLineX: new Int32Array(count * slots),
    qLineY: new Int32Array(count * slots),
    qLineLen: new Int32Array(count),
    passX0: new Float32Array(count),
    passY0: new Float32Array(count),
    passX1: new Float32Array(count),
    passY1: new Float32Array(count),
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
    blocked: new Uint8Array(count),
    staffNeed: new Uint8Array(count),
    staffPresent: new Uint8Array(count),
    staffFactor: new Float32Array(count).fill(1),
    closed: new Uint8Array(count),
  };

  for (let k = 0; k < count; k++) {
    const c = anchors[k]!;
    const w = wash.get(c);
    const id = w ? TOILET_ID : g.fixture[c]!;
    const key = fixtureKey(id) as ServiceKey;
    const t = w ? { servers: w.servers, meanS: w.meanS } : timing(key, g.fixtureMode[c]!, g.fixtureLevel[c]!);
    const x = c % g.w;
    nodes.kind[k] = id;
    nodes.cell[k] = c;
    nodes.lx[k] = g.x0 + x;
    nodes.ly[k] = g.y0 + (c - x) / g.w;
    nodes.servers[k] = t.servers;
    nodes.meanS[k] = t.meanS;
    nodes.staffNeed[k] = stationNeed(key, g.fixtureLevel[c]!);
    const { counted: cells, seeds } = queueCells(g, wg.access, wg.effective, c, reach, seen, dist, queue, parent);
    nodes.queueCap[k] = Math.floor(cells * AREA_PER_CELL * density);
    nodes.qCellOffset[k] = cellX.length;
    nodes.qCellLen[k] = cells;
    for (let i = seeds; i < seeds + cells; i++) {
      const j = queue[i]!;
      const jx = j % g.w;
      cellX.push(g.x0 + jx);
      cellY.push(g.y0 + (j - jx) / g.w);
      // A queue cell reached from position p stores p - seeds, and one reached from a start cell stores -1.
      cellParent.push(parent[i]! < seeds ? -1 : parent[i]! - seeds);
    }
    if (!w) queueLine(g, wg, c, slots, seen, dist, queue, parent, allow, owner, nodes, k);
    passPoints(g, nodes, k, slots);
    // A washroom node stands on plain floor, which is a walk node only when it holds its lattice node.
    nodes.walkNode[k] = w ? nearestNode(wg, c) : wg.cellNode[c]!;
    if (closed.includes(c)) {
      nodes.closed[k] = 1;
      nodes.queueCap[k] = 0;
      nodes.staffNeed[k] = 0;
    }
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
 * logical cell and fixture kind match. Cohorts at a node that no longer exists or that closes for works are evicted:
 * its serving cohort, then its queue in order. Evicted cohorts are kept on the new table, after the ones already
 * evicted before. Allocates, so it runs at command time only.
 */
export function rebuildServiceNodes(prev: ServiceNodes, g: TerminalGrid, wg: WalkGraph, closed: readonly number[] = []): ServiceNodes {
  const next = buildServiceNodes(g, wg, closed);
  const evicted: number[] = Array.from(prev.evicted.subarray(0, prev.evictedCount));
  for (let p = 0; p < prev.count; p++) {
    const k = findNode(next, prev.lx[p]!, prev.ly[p]!, prev.kind[p]!);
    if (k < 0 || next.closed[k] === 1) {
      if (prev.serving[p]! >= 0) evicted.push(prev.serving[p]!);
      for (let q = 0; q < prev.qCount[p]!; q++) evicted.push(prev.qCohort[p * prev.slots + ((prev.qHead[p]! + q) % prev.slots)]!);
      continue;
    }
    next.queueLen[k] = prev.queueLen[p]!;
    next.busyUntil[k] = prev.busyUntil[p]!;
    next.serving[k] = prev.serving[p]!;
    next.servingSize[k] = prev.servingSize[p]!;
    next.blocked[k] = prev.blocked[p]!;
    next.staffPresent[k] = prev.staffPresent[p]!;
    next.staffFactor[k] = prev.staffFactor[p]!;
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


/**
 * Queues a cohort of `size` people at a node. False when the node is out of range, the cohort is empty, the
 * node has no queue room or the queue is full. Once people wait, a cohort may not take the queue past its cap,
 * but an empty queue takes any size so one large cohort can always start.
 */
// hot
export function serviceJoin(sn: ServiceNodes, node: number, cohort: number, size: number, ahead?: (cohort: number) => boolean): boolean {
  if (node < 0 || node >= sn.count || size < 1) return false;
  if (sn.queueCap[node] === 0 || sn.qCount[node] === sn.slots) return false;
  if (sn.queueLen[node] > 0 && sn.queueLen[node] + size > sn.queueCap[node]) return false;
  const base = node * sn.slots;
  const head = sn.qHead[node];
  // A priority join (T74) goes behind the priority cohorts at the head and ahead of everyone else: later entries shift back one.
  let at = sn.qCount[node];
  if (ahead) {
    at = 0;
    while (at < sn.qCount[node] && ahead(sn.qCohort[base + ((head + at) % sn.slots)]!)) at++;
    for (let q = sn.qCount[node]; q > at; q--) {
      const to = base + ((head + q) % sn.slots);
      const from = base + ((head + q - 1) % sn.slots);
      sn.qCohort[to] = sn.qCohort[from]!;
      sn.qSize[to] = sn.qSize[from]!;
    }
  }
  const slot = base + ((head + at) % sn.slots);
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
      if (sn.qCount[k] === 0 || sn.blocked[k] === 1 || sn.staffFactor[k] === 0) break;
      const slot = k * sn.slots + sn.qHead[k];
      const size = sn.qSize[slot];
      sn.qHead[k] = (sn.qHead[k] + 1) % sn.slots;
      sn.qCount[k] -= 1;
      sn.queueLen[k] -= size;
      const start = finish >= 0 ? finish : tick;
      const f = lognormalDraw(rng, sigma, s2);
      sn.serving[k] = sn.qCohort[slot];
      sn.servingSize[k] = size;
      sn.busyUntil[k] = start + gameSecondsToTicks((size * sn.meanS[k] * f) / (sn.servers[k] * sn.staffFactor[k]));
    }
  }
}

/**
 * Game clock seconds a person joining node now would wait: the time left on the cohort being served plus the people
 * queued ahead, each at the node's mean service time over its servers. Infinity for a node out of range.
 */
// hot
export function serviceWait(sn: ServiceNodes, node: number, tick: number): number {
  if (node < 0 || node >= sn.count) return Infinity;
  const left = sn.serving[node] >= 0 ? (Math.max(0, sn.busyUntil[node] - tick) * CLOCK_SCALE) / 10 : 0;
  const rate = sn.servers[node] * sn.staffFactor[node];
  if (rate === 0) return Infinity;
  return left + (sn.queueLen[node] * sn.meanS[node]) / rate;
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
