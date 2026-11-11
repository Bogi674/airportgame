import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@data/index';
import { FIXTURE_KEYS, WALL, type TerminalGrid } from '../src/shared/business';
import { cellIndex, ensureCells, newGrid } from '../src/shared/terminalOps';
import { buildWalkGraph, updateWalkGraph, type WalkGraph } from '../src/sim/terminal/walkGraph';
import { nearestNode, walkDistance } from '../src/sim/terminal/walkDistance';
import { Rng } from '../src/sim/rng';

/** Inclusive logical cell bounds of an edit: x0, y0, x1, y1. */
type Bounds = [number, number, number, number];

const WALL_VALUES = [WALL.None, WALL.Wall, WALL.Door];
const CHECK_IN = FIXTURE_KEYS.indexOf('checkIn') + 1;
const BAG_DROP = FIXTURE_KEYS.indexOf('bagDrop') + 1;

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

/** Every field that a regional rebuild must leave equal to a fresh build. */
function graphFields(wg: WalkGraph): unknown[] {
  return [
    wg.x0, wg.y0, wg.w, wg.h, wg.nodeCount,
    Array.from(wg.cellKind), Array.from(wg.cellMain), Array.from(wg.cellNode),
    Array.from(wg.nodeCell), Array.from(wg.nodeX), Array.from(wg.nodeY),
    Array.from(wg.nodeKind), Array.from(wg.nodeRoom),
    Array.from(wg.edgeStart), Array.from(wg.edgeTo), Array.from(wg.edgeLen),
  ];
}

/** Lays a run of 1 to 4 walls or doors on a vertical or horizontal line. Returns the bounds of the cells it touches. */
function wallRun(g: TerminalGrid, rng: Rng): Bounds {
  const k = rng.int(1, 4);
  const value = WALL_VALUES[rng.int(0, 2)]!;
  if (rng.int(0, 1) === 0) {
    const c = rng.int(0, g.w);
    const r = rng.int(0, g.h - k);
    for (let i = 0; i < k; i++) g.vWall[(r + i) * (g.w + 1) + c] = value;
    return [g.x0 + c - 1, g.y0 + r, g.x0 + c, g.y0 + r + k - 1];
  }
  const c = rng.int(0, g.w - k);
  const r = rng.int(0, g.h);
  for (let i = 0; i < k; i++) g.hWall[r * g.w + c + i] = value;
  return [g.x0 + c, g.y0 + r - 1, g.x0 + c + k - 1, g.y0 + r];
}

/** Toggles the floor of a rect of up to 3 by 3 cells, clearing fixtures where the floor goes away. */
function floorToggle(g: TerminalGrid, rng: Rng): Bounds {
  const sw = rng.int(1, 3);
  const sh = rng.int(1, 3);
  const x = rng.int(g.x0, g.x0 + g.w - sw);
  const y = rng.int(g.y0, g.y0 + g.h - sh);
  const on = g.floor[cellIndex(g, x, y)]! > 0 ? 0 : 1;
  for (let j = 0; j < sh; j++) {
    for (let i = 0; i < sw; i++) {
      const c = cellIndex(g, x + i, y + j);
      g.floor[c] = on;
      if (on === 0) {
        g.fixture[c] = 0;
        g.fixtureRot[c] = 0;
      }
    }
  }
  return [x, y, x + sw - 1, y + sh - 1];
}

/** Sets or clears a check in fixture on a floor cell, scanning forward from a random cell to find floor. */
function fixtureToggle(g: TerminalGrid, rng: Rng): Bounds {
  const n = g.w * g.h;
  let c = rng.int(0, n - 1);
  while (g.floor[c]! === 0) c = (c + 1) % n;
  g.fixture[c] = g.fixture[c] === CHECK_IN ? 0 : CHECK_IN;
  g.fixtureRot[c] = 0;
  const ax = c % g.w;
  const ay = (c - ax) / g.w;
  return [g.x0 + ax, g.y0 + ay, g.x0 + ax, g.y0 + ay];
}

/**
 * Places or clears a two cell fixture. The anchor carries fixtureRot 1 + rot and the tail 5 + rot. Only the anchor
 * is reported as touched, because the tail is never a walk node.
 */
function twoCellToggle(g: TerminalGrid, rng: Rng): Bounds {
  const n = g.w * g.h;
  const c = rng.int(0, n - 1);
  const ax = c % g.w;
  const ay = (c - ax) / g.w;
  const bounds: Bounds = [g.x0 + ax, g.y0 + ay, g.x0 + ax, g.y0 + ay];
  if (g.fixtureRot[c]! >= 1 && g.fixtureRot[c]! <= 4) {
    const rot = g.fixtureRot[c]! - 1;
    const tail = c + tailOffset(g, rot);
    g.fixture[c] = 0;
    g.fixtureRot[c] = 0;
    g.fixture[tail] = 0;
    g.fixtureRot[tail] = 0;
    return bounds;
  }
  if (g.floor[c]! === 0 || g.fixture[c] !== 0) return bounds;
  const start = rng.int(0, 3);
  for (let k = 0; k < 4; k++) {
    const rot = (start + k) % 4;
    const tail = c + tailOffset(g, rot);
    if (tail < 0 || tail >= n) continue;
    const tx = tail % g.w;
    if (Math.abs(tx - ax) + Math.abs(Math.floor(tail / g.w) - ay) !== 1) continue;
    if (g.floor[tail]! === 0 || g.fixture[tail] !== 0) continue;
    g.fixture[c] = BAG_DROP;
    g.fixtureRot[c] = 1 + rot;
    g.fixture[tail] = BAG_DROP;
    g.fixtureRot[tail] = 5 + rot;
    return bounds;
  }
  return bounds;
}

/** Array index offset from an anchor to its tail for a fixtureRot direction: +column, +row, -column, -row. */
function tailOffset(g: TerminalGrid, rot: number): number {
  if (rot === 0) return 1;
  if (rot === 1) return g.w;
  if (rot === 2) return -1;
  return -g.w;
}

/** One random edit of the grid, returning the bounds of the cells it touched. */
function randomEdit(g: TerminalGrid, rng: Rng): Bounds {
  const kind = rng.int(0, 3);
  if (kind === 0) return wallRun(g, rng);
  if (kind === 1) return floorToggle(g, rng);
  if (kind === 2) return twoCellToggle(g, rng);
  return fixtureToggle(g, rng);
}

/** Blocks in the update rect and in the whole grid for these bounds, counted the way updateWalkGraph counts them. */
function blockTotals(g: TerminalGrid, b: Bounds): [number, number] {
  const L = BUSINESS.terminal.walk.latticeCells;
  const M = BUSINESS.terminal.walk.dirtyMarginCells;
  const wx0 = Math.floor(g.x0 / L);
  const wy0 = Math.floor(g.y0 / L);
  const wx1 = Math.floor((g.x0 + g.w - 1) / L);
  const wy1 = Math.floor((g.y0 + g.h - 1) / L);
  const rx0 = Math.max(wx0, Math.floor((b[0] - M) / L));
  const ry0 = Math.max(wy0, Math.floor((b[1] - M) / L));
  const rx1 = Math.min(wx1, Math.floor((b[2] + M) / L));
  const ry1 = Math.min(wy1, Math.floor((b[3] + M) / L));
  return [Math.max(0, rx1 - rx0 + 1) * Math.max(0, ry1 - ry0 + 1), (wx1 - wx0 + 1) * (wy1 - wy0 + 1)];
}

/**
 * Starts from a full floor grid and applies 100 seeded edits. After each edit the graph is updated
 * regionally and onStep is called with it. Returns the final graph and how many updates kept the object.
 */
function playEdits(onStep: (wg: WalkGraph, g: TerminalGrid) => void): { g: TerminalGrid; wg: WalkGraph; inPlace: number } {
  const g = handGrid(-30, 12, 90, 60);
  setFloor(g, g.x0, g.y0, g.x0 + g.w, g.y0 + g.h);
  let wg = buildWalkGraph(g);
  const rng = new Rng(20261111);
  let inPlace = 0;
  for (let i = 0; i < 100; i++) {
    const [lx0, ly0, lx1, ly1] = randomEdit(g, rng);
    const next = updateWalkGraph(wg, g, lx0, ly0, lx1, ly1);
    if (next === wg) inPlace++;
    wg = next;
    onStep(wg, g);
  }
  return { g, wg, inPlace };
}

describe('walk graph regional rebuild', () => {
  it('equals a fresh build after every one of 100 random edits', () => {
    let step = 0;
    const { inPlace } = playEdits((wg, g) => {
      expect(graphFields(wg), `edit ${step}`).toEqual(graphFields(buildWalkGraph(g)));
      step++;
    });
    expect(step).toBe(100);
    expect(inPlace).toBeGreaterThanOrEqual(90);
  });

  it('gives the same walk distances as a fresh build after the edits', () => {
    const { g, wg } = playEdits(() => undefined);
    const fresh = buildWalkGraph(g);
    expect(wg.nodeCount).toBe(fresh.nodeCount);
    const rng = new Rng(7);
    for (let i = 0; i < 100; i++) {
      const a = rng.int(0, fresh.nodeCount - 1);
      const b = rng.int(0, fresh.nodeCount - 1);
      expect(walkDistance(wg, a, b)).toBe(walkDistance(fresh, a, b));
    }
  });

  it('keeps the graph equal to a fresh build for edits on the grid border', () => {
    const g = handGrid(-30, 12, 90, 60);
    setFloor(g, g.x0, g.y0, g.x0 + g.w, g.y0 + g.h);
    let wg = buildWalkGraph(g);
    const x0 = g.x0;
    const y0 = g.y0;
    const x1 = g.x0 + g.w - 1;
    const y1 = g.y0 + g.h - 1;
    const edits: [() => void, Bounds][] = [
      [() => { g.vWall[0] = WALL.Wall; }, [x0 - 1, y0, x0, y0]],
      [() => { g.vWall[(g.h - 1) * (g.w + 1) + g.w] = WALL.Door; }, [x1, y1, x1 + 1, y1]],
      [() => { g.hWall[g.w - 1] = WALL.Wall; }, [x1, y0 - 1, x1, y0]],
      [() => { g.hWall[g.h * g.w] = WALL.Door; }, [x0, y1, x0, y1 + 1]],
      [() => { g.floor[0] = 0; }, [x0, y0, x0, y0]],
      [() => { g.floor[g.w * g.h - 1] = 0; }, [x1, y1, x1, y1]],
      [() => { g.fixture[g.w - 1] = CHECK_IN; g.fixtureRot[g.w - 1] = 0; }, [x1, y0, x1, y0]],
      [() => { g.vWall[g.h * (g.w + 1)] = WALL.Wall; }, [x0 - 1, y0 + 1, x0, y0 + 1]],
    ];
    for (let i = 0; i < edits.length; i++) {
      const [apply, b] = edits[i]!;
      apply();
      const next = updateWalkGraph(wg, g, b[0], b[1], b[2], b[3]);
      expect(next, `border edit ${i}`).toBe(wg);
      wg = next;
      expect(graphFields(wg), `border edit ${i}`).toEqual(graphFields(buildWalkGraph(g)));
    }
  });

  it('switches from an in place update to a full build exactly where the block count passes a quarter', () => {
    const g = handGrid(0, 0, 32, 32);
    setFloor(g, g.x0, g.y0, g.x0 + g.w, g.y0 + g.h);
    let wg = buildWalkGraph(g);
    const row = g.y0 + 16;
    const full = (x: number): boolean => {
      const [rect, whole] = blockTotals(g, [x - 1, row, x, row]);
      return rect * 4 > whole;
    };
    let xFull = -1;
    for (let x = g.x0; x <= g.x0 + g.w && xFull < 0; x++) if (full(x)) xFull = x;
    expect(xFull).toBeGreaterThan(g.x0);
    const xIn = xFull - 1;
    expect(full(xIn)).toBe(false);
    for (const x of [xIn, xFull]) {
      const i = (row - g.y0) * (g.w + 1) + (x - g.x0);
      g.vWall[i] = g.vWall[i] === WALL.Wall ? WALL.None : WALL.Wall;
      const prev = wg;
      wg = updateWalkGraph(wg, g, x - 1, row, x, row);
      expect(wg === prev).toBe(x === xIn);
      expect(graphFields(wg)).toEqual(graphFields(buildWalkGraph(g)));
    }
  });

  it('empties the cache and resizes it when an in place edit changes the node count', () => {
    const g = handGrid(0, 0, 96, 64);
    setFloor(g, g.x0, g.y0, g.x0 + g.w, g.y0 + g.h);
    for (let y = 0; y < g.h; y++) g.vWall[y * (g.w + 1) + 48] = WALL.Wall;
    g.vWall[2 * (g.w + 1) + 48] = WALL.Door;
    let wg = buildWalkGraph(g);
    const from = nearestNode(wg, cellIndex(g, 10, 20));
    const to = nearestNode(wg, cellIndex(g, 80, 20));
    for (const value of [WALL.Door, WALL.Wall]) {
      walkDistance(wg, from, to);
      const count = wg.nodeCount;
      expect(wg.cache.rowSource.some((r) => r >= 0)).toBe(true);
      g.vWall[40 * (g.w + 1) + 48] = value;
      const next = updateWalkGraph(wg, g, 47, 40, 48, 40);
      expect(next).toBe(wg);
      expect(next.nodeCount).not.toBe(count);
      expect(next.cache.rowSource.every((r) => r === -1)).toBe(true);
      expect(next.cache.sourceRow.every((r) => r === -1)).toBe(true);
      expect(next.cache.sourceRow.length).toBe(next.nodeCount);
      const fresh = buildWalkGraph(g);
      expect(graphFields(next)).toEqual(graphFields(fresh));
      const a = nearestNode(next, cellIndex(g, 10, 20));
      const b = nearestNode(next, cellIndex(g, 80, 20));
      expect(walkDistance(next, a, b)).toBe(walkDistance(fresh, a, b));
      wg = next;
    }
  });

  it('recomputes a cached distance after an in place update that keeps the node count', () => {
    const g = handGrid(0, 0, 96, 64);
    setFloor(g, g.x0, g.y0, g.x0 + g.w, g.y0 + g.h);
    for (let y = 0; y < g.h; y++) g.vWall[y * (g.w + 1) + 48] = WALL.Wall;
    g.vWall[2 * (g.w + 1) + 48] = WALL.Door;
    const wg = buildWalkGraph(g);
    const count = wg.nodeCount;
    const before = walkDistance(wg, nearestNode(wg, cellIndex(g, 10, 20)), nearestNode(wg, cellIndex(g, 80, 20)));
    g.vWall[20 * (g.w + 1) + 48] = WALL.None;
    const after = updateWalkGraph(wg, g, 47, 20, 48, 20);
    expect(after).toBe(wg);
    expect(after.nodeCount).toBe(count);
    const from = nearestNode(after, cellIndex(g, 10, 20));
    const to = nearestNode(after, cellIndex(g, 80, 20));
    const fresh = buildWalkGraph(g);
    const shorter = walkDistance(after, from, to);
    expect(shorter).toBeLessThan(before);
    expect(shorter).toBe(walkDistance(fresh, from, to));
  });

  it('returns a new graph equal to a fresh build when the grid grows', () => {
    const g = handGrid(0, 0, 32, 32);
    setFloor(g, g.x0, g.y0, g.x0 + g.w, g.y0 + g.h);
    const wg = buildWalkGraph(g);
    ensureCells(g, -40, 0, 40, 40);
    const next = updateWalkGraph(wg, g, 0, 0, 1, 1);
    expect(next).not.toBe(wg);
    expect(graphFields(next)).toEqual(graphFields(buildWalkGraph(g)));
  });

  it('builds and updates a stress terminal within the time budget', () => {
    const g = handGrid(0, 0, 320, 60);
    setFloor(g, g.x0, g.y0, g.x0 + g.w, g.y0 + g.h);
    for (let k = 1; k * 20 < g.w; k++) {
      const c = k * 20;
      for (let r = 0; r < g.h; r++) g.vWall[r * (g.w + 1) + c] = WALL.Wall;
      g.vWall[(g.h >> 1) * (g.w + 1) + c] = WALL.Door;
    }
    const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[2]!;

    const buildTimes: number[] = [];
    let wg = buildWalkGraph(g);
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      wg = buildWalkGraph(g);
      buildTimes.push(performance.now() - t0);
    }

    // A 2 by 2 wall box at array cell (50, 20), set and cleared alternately so every update changes the grid.
    const setBox = (value: number): void => {
      for (const r of [20, 21]) {
        g.vWall[r * (g.w + 1) + 50] = value;
        g.vWall[r * (g.w + 1) + 52] = value;
      }
      for (const c of [50, 51]) {
        g.hWall[20 * g.w + c] = value;
        g.hWall[22 * g.w + c] = value;
      }
    };
    const lx0 = g.x0 + 50;
    const ly0 = g.y0 + 20;
    const updateTimes: number[] = [];
    for (let i = 0; i < 5; i++) {
      setBox(i % 2 === 0 ? WALL.Wall : WALL.None);
      const before = wg;
      const t0 = performance.now();
      wg = updateWalkGraph(wg, g, lx0, ly0, lx0 + 1, ly0 + 1);
      updateTimes.push(performance.now() - t0);
      expect(wg).toBe(before);
    }
    expect(graphFields(wg)).toEqual(graphFields(buildWalkGraph(g)));

    const buildMs = median(buildTimes);
    const updateMs = median(updateTimes);
    console.log(`walk build median ${buildMs.toFixed(2)} ms, walk update median ${updateMs.toFixed(2)} ms`);
    expect(buildMs).toBeLessThan(100);
    expect(updateMs).toBeLessThan(10);
  });
});
