import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@data/index';
import { TERMINAL_CELL_M, WALL, type TerminalGrid } from '../src/shared/business';
import { cellIndex, ensureCells, newGrid, vEdgeIndex } from '../src/shared/terminalOps';
import { buildWalkGraph, type WalkGraph } from '../src/sim/terminal/walkGraph';
import { nearestNode, walkDistance } from '../src/sim/terminal/walkDistance';
import { Rng } from '../src/sim/rng';

/** A grid with logical cells from (x0, y0) to (x0 + w, y0 + h), rounded to whole chunks by ensureCells. */
function handGrid(x0: number, y0: number, w: number, h: number): TerminalGrid {
  const g = newGrid(1, 0, 0, 0);
  ensureCells(g, x0, y0, x0 + w, y0 + h);
  return g;
}

/** Sets floor on logical cells from (x0, y0) up to, not including, (x1, y1). */
function setFloor(g: TerminalGrid, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g.floor[cellIndex(g, x, y)] = 1;
}

/** Puts a wall of the given kind on the vertical edge left of logical cell (x, y). */
function setVWall(g: TerminalGrid, x: number, y: number, kind: number): void {
  g.vWall[vEdgeIndex(g, x, y)] = kind;
}

/** Walking length of the straight line between two logical points, in metres. */
function straightM(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return TERMINAL_CELL_M * Math.sqrt(dx * dx + dy * dy);
}

/** Node centre in logical cell units. */
const nodeXY = (wg: WalkGraph, id: number): [number, number] => [wg.nodeX[id]!, wg.nodeY[id]!];

/** Open floor of 40 by 20 cells. */
function openFloor(): { g: TerminalGrid; wg: WalkGraph } {
  const g = handGrid(0, 0, 40, 20);
  setFloor(g, 0, 0, 40, 20);
  return { g, wg: buildWalkGraph(g) };
}

/** The open floor with a full wall at column 20 and, when door is true, one door at row 10. */
function splitFloor(door: boolean): { g: TerminalGrid; wg: WalkGraph } {
  const g = handGrid(0, 0, 40, 20);
  setFloor(g, 0, 0, 40, 20);
  for (let y = 0; y < 20; y++) setVWall(g, 20, y, WALL.Wall);
  if (door) setVWall(g, 20, 10, WALL.Door);
  return { g, wg: buildWalkGraph(g) };
}

/** Single source shortest paths over the edge arrays, plain Bellman-Ford in float64. */
function bellmanFord(wg: WalkGraph, src: number): Float64Array {
  const d = new Float64Array(wg.nodeCount).fill(Infinity);
  d[src] = 0;
  for (let round = 0; round < wg.nodeCount; round++) {
    let changed = false;
    for (let u = 0; u < wg.nodeCount; u++) {
      if (d[u] === Infinity) continue;
      for (let e = wg.edgeStart[u]!; e < wg.edgeStart[u + 1]!; e++) {
        const v = wg.edgeTo[e]!;
        const nd = d[u]! + wg.edgeLen[e]!;
        if (nd < d[v]!) {
          d[v] = nd;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return d;
}

describe('walkDistance on an open floor', () => {
  it('stays within the straight line and 5 percent above it to every node', () => {
    const { g, wg } = openFloor();
    const from = nearestNode(wg, cellIndex(g, 4, 4));
    const [fx, fy] = nodeXY(wg, from);
    expect(wg.nodeCount).toBeGreaterThan(0);
    for (let id = 0; id < wg.nodeCount; id++) {
      const [tx, ty] = nodeXY(wg, id);
      const straight = straightM(fx, fy, tx, ty);
      const d = walkDistance(wg, from, id);
      expect(d).toBeGreaterThanOrEqual(straight - 0.01);
      expect(d).toBeLessThanOrEqual(1.05 * straight);
    }
  });
});

describe('walkDistance across a wall', () => {
  it('routes through the door point when a door is in the wall', () => {
    const { g, wg } = splitFloor(true);
    const a = nearestNode(wg, cellIndex(g, 10, 3));
    const b = nearestNode(wg, cellIndex(g, 30, 3));
    const [ax, ay] = nodeXY(wg, a);
    const [bx, by] = nodeXY(wg, b);
    // The door sits on the edge between logical columns 19 and 20, at row 10.
    const viaDoor = straightM(ax, ay, 19.5, 10) + straightM(19.5, 10, bx, by);
    const d = walkDistance(wg, a, b);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(viaDoor - 0.01);
  });

  it('is infinite without a door', () => {
    const { g, wg } = splitFloor(false);
    const a = nearestNode(wg, cellIndex(g, 10, 3));
    const b = nearestNode(wg, cellIndex(g, 30, 3));
    expect(walkDistance(wg, a, b)).toBe(Infinity);
  });

  it('is infinite for ids that are not nodes and zero for the same node', () => {
    const { g, wg } = splitFloor(false);
    const a = nearestNode(wg, cellIndex(g, 10, 3));
    expect(walkDistance(wg, -1, a)).toBe(Infinity);
    expect(walkDistance(wg, a, wg.nodeCount)).toBe(Infinity);
    expect(walkDistance(wg, 1.5, a)).toBe(Infinity);
    expect(walkDistance(wg, a, a)).toBe(0);
  });
});

describe('walkDistance cache', () => {
  it('answers the same both ways for 200 seeded random pairs', () => {
    const { wg } = splitFloor(true);
    const rng = new Rng(7);
    for (let i = 0; i < 200; i++) {
      const a = rng.int(0, wg.nodeCount - 1);
      const b = rng.int(0, wg.nodeCount - 1);
      expect(walkDistance(wg, a, b)).toBe(walkDistance(wg, b, a));
    }
  });

  it('evicts the least recently used row and stamps a row on every use', () => {
    const { wg } = openFloor();
    const cache = wg.cache;
    const last = wg.nodeCount - 1;
    const n = BUSINESS.terminal.walk.cacheSources;
    expect(last).toBeGreaterThan(n + 1);
    const first = walkDistance(wg, 0, last);
    for (let a = 1; a < n; a++) walkDistance(wg, a, last);
    expect(cache.rowSource.indexOf(-1)).toBe(-1);
    // Source 0 is refreshed, so source 1 holds the lowest stamp and is the one evicted.
    walkDistance(wg, 0, last);
    walkDistance(wg, n, last);
    expect(cache.sourceRow[0]).toBeGreaterThanOrEqual(0);
    expect(cache.sourceRow[1]).toBe(-1);
    expect(cache.sourceRow[n]).toBeGreaterThanOrEqual(0);
    expect(walkDistance(wg, 0, last)).toBe(first);
  });

  it('breaks ties between equal stamps by the lowest row index', () => {
    const { wg } = openFloor();
    const cache = wg.cache;
    const last = wg.nodeCount - 1;
    const n = BUSINESS.terminal.walk.cacheSources;
    expect(last).toBeGreaterThan(n + 1);
    for (let a = 0; a < n; a++) walkDistance(wg, a, last);
    cache.rowStamp.fill(7);
    // Source 0 sits in row 0, the lowest index among equal stamps.
    walkDistance(wg, n, last);
    expect(cache.sourceRow[0]).toBe(-1);
    expect(cache.sourceRow[n]).toBe(0);
    // Source n now sits in row 0, so it is the next one evicted among equal stamps.
    cache.rowStamp.fill(7);
    walkDistance(wg, n + 1, last);
    expect(cache.sourceRow[n]).toBe(-1);
    expect(cache.sourceRow[n + 1]).toBe(0);
  });

  it('matches a Bellman-Ford over the edges for 50 seeded random pairs', () => {
    const { wg } = openFloor();
    const rng = new Rng(11);
    for (let i = 0; i < 50; i++) {
      const a = rng.int(0, wg.nodeCount - 1);
      const b = rng.int(0, wg.nodeCount - 1);
      if (a === b) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const expected = bellmanFord(wg, lo)[hi]!;
      expect(Math.abs(walkDistance(wg, a, b) - expected)).toBeLessThanOrEqual(0.01);
    }
  });
});

describe('nearestNode', () => {
  it('returns -1 for cells without floor and outside the grid', () => {
    const { g, wg } = openFloor();
    const outside = cellIndex(g, 45, 5);
    expect(outside).toBeGreaterThanOrEqual(0);
    expect(g.floor[outside]).toBe(0);
    expect(nearestNode(wg, outside)).toBe(-1);
    expect(nearestNode(wg, -1)).toBe(-1);
    expect(nearestNode(wg, g.w * g.h)).toBe(-1);
  });

  it('returns the lattice node of a plain floor cell', () => {
    const { g, wg } = openFloor();
    expect(nearestNode(wg, cellIndex(g, 5, 5))).toBe(wg.cellNode[wg.cellMain[cellIndex(g, 5, 5)]!]);
    expect(nearestNode(wg, cellIndex(g, 5, 5))).toBe(wg.cellNode[cellIndex(g, 4, 4)]);
  });

  it('returns the node itself for a node cell', () => {
    const { g, wg } = openFloor();
    const c = cellIndex(g, 4, 4);
    expect(wg.cellNode[c]).toBeGreaterThanOrEqual(0);
    expect(nearestNode(wg, c)).toBe(wg.cellNode[c]);
  });
});
