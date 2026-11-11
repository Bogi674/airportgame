import { BUSINESS } from '@data/index';
import type { WalkGraph } from './walkGraph';

/**
 * Cached single source walking rows. Each row holds the Dijkstra distances in metres from one source node to
 * every node. Rows are reused least recently used, so a query never allocates.
 */
export interface WalkCache {
  /** Row distances in metres, Float32. Row k is the slice from k * nodeCount, indexed by node id. */
  rows: Float32Array;
  /** Per row: the source node the row was filled from, -1 when the row is free. */
  rowSource: Int32Array;
  /** Per row: the clock value of its last use. Lower means older. */
  rowStamp: Float64Array;
  /** Per node: the row that holds it as a source, -1 when it has no row. */
  sourceRow: Int32Array;
  /** Monotonic use counter behind rowStamp. */
  clock: number;
  /** Scratch: tentative distance per node in metres, Float64. Reset by each fill. */
  dist: Float64Array;
  /** Scratch: indexed binary min heap of node ids, ordered by dist then by id. */
  heap: Int32Array;
  /** Scratch: position of each node in heap, -1 when it is not in the heap. */
  heapPos: Int32Array;
}

/** An empty cache for a graph of nodeCount nodes, with one row per cached source. */
export function newWalkCache(nodeCount: number): WalkCache {
  const sources = BUSINESS.terminal.walk.cacheSources;
  return {
    rows: new Float32Array(sources * nodeCount),
    rowSource: new Int32Array(sources).fill(-1),
    rowStamp: new Float64Array(sources),
    sourceRow: new Int32Array(nodeCount).fill(-1),
    clock: 0,
    dist: new Float64Array(nodeCount),
    heap: new Int32Array(nodeCount),
    heapPos: new Int32Array(nodeCount),
  };
}

/** True when heap entry a must sit above entry b: smaller distance first, then smaller id. */
function before(cache: WalkCache, a: number, b: number): boolean {
  const da = cache.dist[a]!;
  const db = cache.dist[b]!;
  return da < db || (da === db && a < b);
}

/** Moves the heap entry at index i up until its parent sits above it. */
function siftUp(cache: WalkCache, i: number): void {
  const heap = cache.heap;
  const pos = cache.heapPos;
  let k = i;
  const node = heap[k]!;
  while (k > 0) {
    const parent = (k - 1) >> 1;
    if (!before(cache, node, heap[parent]!)) break;
    heap[k] = heap[parent]!;
    pos[heap[k]!] = k;
    k = parent;
  }
  heap[k] = node;
  pos[node] = k;
}

/** Moves the heap entry at index i down until both children sit below it. */
function siftDown(cache: WalkCache, i: number, size: number): void {
  const heap = cache.heap;
  const pos = cache.heapPos;
  let k = i;
  const node = heap[k]!;
  for (;;) {
    let child = 2 * k + 1;
    if (child >= size) break;
    if (child + 1 < size && before(cache, heap[child + 1]!, heap[child]!)) child++;
    if (!before(cache, heap[child]!, node)) break;
    heap[k] = heap[child]!;
    pos[heap[k]!] = k;
    k = child;
  }
  heap[k] = node;
  pos[node] = k;
}

/** Fills row from the Dijkstra distances out of source, over the walk graph edges. */
function fillRow(wg: WalkGraph, source: number, row: number): void {
  const cache = wg.cache;
  const n = wg.nodeCount;
  const dist = cache.dist;
  const pos = cache.heapPos;
  dist.fill(Infinity);
  pos.fill(-1);
  dist[source] = 0;
  cache.heap[0] = source;
  pos[source] = 0;
  let size = 1;
  while (size > 0) {
    const u = cache.heap[0]!;
    size--;
    pos[u] = -1;
    if (size > 0) {
      cache.heap[0] = cache.heap[size]!;
      siftDown(cache, 0, size);
    }
    const du = dist[u]!;
    for (let e = wg.edgeStart[u]!; e < wg.edgeStart[u + 1]!; e++) {
      const v = wg.edgeTo[e]!;
      const dv = du + wg.edgeLen[e]!;
      if (dv >= dist[v]!) continue;
      dist[v] = dv;
      if (pos[v]! >= 0) {
        siftUp(cache, pos[v]!);
      } else {
        cache.heap[size] = v;
        pos[v] = size;
        size++;
        siftUp(cache, size - 1);
      }
    }
  }
  const base = row * n;
  for (let v = 0; v < n; v++) cache.rows[base + v] = dist[v]!;
}

/** The row that holds the distances from source, filling it first when it is not cached. */
function rowFor(wg: WalkGraph, source: number): number {
  const cache = wg.cache;
  let row = cache.sourceRow[source]!;
  if (row < 0) {
    row = cache.rowSource.indexOf(-1);
    if (row < 0) {
      row = 0;
      for (let k = 1; k < cache.rowSource.length; k++) {
        if (cache.rowStamp[k]! < cache.rowStamp[row]!) row = k;
      }
      cache.sourceRow[cache.rowSource[row]!] = -1;
    }
    cache.rowSource[row] = source;
    cache.sourceRow[source] = row;
    fillRow(wg, source, row);
  }
  cache.rowStamp[row] = ++cache.clock;
  return row;
}

/**
 * Walking distance in metres between two walk nodes, or Infinity when either id is not a node or no walk
 * joins them. The row of the smaller id answers, so the result does not depend on what is cached.
 */
export function walkDistance(wg: WalkGraph, from: number, to: number): number {
  const n = wg.nodeCount;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n) return Infinity;
  if (from === to) return 0;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const row = rowFor(wg, lo);
  return wg.cache.rows[row * n + hi]!;
}

/**
 * Walk node that a person in array cell cell walks from: the cell's own node, or the node of its lattice
 * group. -1 when the cell is outside the grid or has no floor.
 */
export function nearestNode(wg: WalkGraph, cell: number): number {
  if (!Number.isInteger(cell) || cell < 0 || cell >= wg.cellMain.length) return -1;
  const main = wg.cellMain[cell]!;
  if (main < 0) return -1;
  const own = wg.cellNode[cell]!;
  return own >= 0 ? own : wg.cellNode[main]!;
}
