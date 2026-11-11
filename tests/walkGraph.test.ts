import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@data/index';
import { FIXTURE_KEYS, TERMINAL_CELL_M, WALL, type TerminalGrid } from '../src/shared/business';
import { canStep, labelRooms } from '../src/shared/terminalRooms';
import { cellIndex, ensureCells, hEdgeIndex, newGrid, originFor } from '../src/shared/terminalOps';
import { WALK_NODE, buildWalkGraph, lineOfSight, type WalkGraph } from '../src/sim/terminal/walkGraph';
import { buildTestTerminal, ownedSim, run } from './helpers';
import type { Sim } from '../src/sim/sim';

/**
 * Splits the test terminal in two with a full height wall at x 56 and a door at y 45, both laid with
 * terminal commands. Returns the first grid after the edits.
 */
function splitTerminal(sim: Sim) {
  const { ox, oy } = originFor(3960, 5440, 90);
  const id = sim.business.grids[0]!.id;
  const edit = (e: { op: 'wall'; x0: number; y0: number; x1: number; y1: number; variant: number }): string[] =>
    run(sim, { type: 'terminalBuild', building: id, ox, oy, headingDeg: 90, edit: e });
  expect(edit({ op: 'wall', x0: 56, y0: 40, x1: 56, y1: 52, variant: 1 })).toEqual([]);
  expect(edit({ op: 'wall', x0: 56, y0: 45, x1: 56, y1: 46, variant: 3 })).toEqual([]);
  return sim.business.grids[0]!;
}

/** Neighbour steps in the canStep direction order: left, right, up, down. */
const STEP_DX = [-1, 1, 0, 0];
const STEP_DY = [0, 0, -1, 1];

/** True when array cells a and b sit in the same logical block of the grid. */
function sameBlock(g: TerminalGrid, a: number, b: number): boolean {
  const L = BUSINESS.terminal.walk.latticeCells;
  const block = (c: number): string => {
    const ax = c % g.w;
    const ay = (c - ax) / g.w;
    return `${Math.floor((ax + g.x0) / L)},${Math.floor((ay + g.y0) / L)}`;
  };
  return block(a) === block(b);
}

/** True when array cell c is the lattice centre of its block. */
function isBlockCentre(g: TerminalGrid, c: number): boolean {
  const L = BUSINESS.terminal.walk.latticeCells;
  const ax = c % g.w;
  const ay = (c - ax) / g.w;
  return (((ax + g.x0) % L) + L) % L === 1 && (((ay + g.y0) % L) + L) % L === 1;
}

function walkFields(wg: WalkGraph): unknown[] {
  return [
    wg.grid, wg.x0, wg.y0, wg.w, wg.h, wg.nodeCount,
    Array.from(wg.cellKind), Array.from(wg.cellMain), Array.from(wg.cellNode),
    Array.from(wg.nodeCell), Array.from(wg.nodeX), Array.from(wg.nodeY),
    Array.from(wg.nodeKind), Array.from(wg.nodeRoom), Array.from(wg.edgeStart),
    Array.from(wg.edgeTo), Array.from(wg.edgeLen),
  ];
}

/** Builds the split test terminal and its walk graph. */
function build(): { grid: TerminalGrid; wg: WalkGraph } {
  const sim = ownedSim();
  expect(buildTestTerminal(sim)).toEqual([]);
  const grid = splitTerminal(sim);
  return { grid, wg: buildWalkGraph(grid) };
}

/** Array index of logical cell (lx, ly) in the grid. */
const cellAt = (g: TerminalGrid, lx: number, ly: number): number => (ly - g.y0) * g.w + (lx - g.x0);

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

/** Puts a wall on the vertical edge left of logical cell (x, y). */
function wallLeftOf(g: TerminalGrid, x: number, y: number): void {
  g.vWall[(y - g.y0) * (g.w + 1) + (x - g.x0)] = WALL.Wall;
}

/** Puts a wall on the horizontal edge above logical cell (x, y). */
function wallAbove(g: TerminalGrid, x: number, y: number): void {
  g.hWall[hEdgeIndex(g, x, y)] = WALL.Wall;
}

/** Cells reached from start over canStep, as a flag per array cell. */
function floodCells(g: TerminalGrid, start: number): Uint8Array {
  const W = g.w;
  const seen = new Uint8Array(W * g.h);
  seen[start] = 1;
  const cells = [start];
  while (cells.length > 0) {
    const c = cells.pop()!;
    const x = c % W;
    const y = (c - x) / W;
    for (let d = 0; d < 4; d++) {
      if (!canStep(g, x, y, d)) continue;
      const nc = (y + STEP_DY[d]!) * W + x + STEP_DX[d]!;
      if (seen[nc] === 1) continue;
      seen[nc] = 1;
      cells.push(nc);
    }
  }
  return seen;
}

/** Nodes reached from first over the walk graph edges, as a flag per node id. */
function floodNodes(wg: WalkGraph, first: number): Uint8Array {
  const seen = new Uint8Array(wg.nodeCount);
  seen[first] = 1;
  const nodes = [first];
  while (nodes.length > 0) {
    const a = nodes.pop()!;
    for (let e = wg.edgeStart[a]!; e < wg.edgeStart[a + 1]!; e++) {
      const b = wg.edgeTo[e]!;
      if (seen[b] === 1) continue;
      seen[b] = 1;
      nodes.push(b);
    }
  }
  return seen;
}

/** Length of the edge from node a to node b, or undefined when there is none. */
function edgeLen(wg: WalkGraph, a: number, b: number): number | undefined {
  for (let e = wg.edgeStart[a]!; e < wg.edgeStart[a + 1]!; e++) {
    if (wg.edgeTo[e] === b) return wg.edgeLen[e];
  }
  return undefined;
}

describe('walk graph nodes', () => {
  it('keeps node cells in ascending order', () => {
    const { wg } = build();
    expect(wg.nodeCount).toBeGreaterThan(0);
    for (let i = 1; i < wg.nodeCount; i++) expect(wg.nodeCell[i]!).toBeGreaterThan(wg.nodeCell[i - 1]!);
  });

  it('gives every floor cell a main node in its own block and no main to other cells', () => {
    const { grid, wg } = build();
    for (let c = 0; c < grid.w * grid.h; c++) {
      if (grid.floor[c]! > 0) {
        const main = wg.cellMain[c]!;
        expect(main).toBeGreaterThanOrEqual(0);
        expect(sameBlock(grid, main, c)).toBe(true);
        expect(wg.cellKind[main]!).toBeGreaterThan(0);
      } else {
        expect(wg.cellMain[c]).toBe(-1);
      }
    }
  });

  it('makes every floor cell at a block centre its own main', () => {
    const { grid, wg } = build();
    let centres = 0;
    for (let c = 0; c < grid.w * grid.h; c++) {
      if (grid.floor[c]! > 0 && isBlockCentre(grid, c)) {
        centres++;
        expect(wg.cellMain[c]).toBe(c);
      }
    }
    expect(centres).toBeGreaterThan(0);
  });

  it('makes both cells beside a door edge nodes', () => {
    const { grid, wg } = build();
    const W = grid.w;
    let doors = 0;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 1; x < W; x++) {
        const left = y * W + x - 1;
        const right = y * W + x;
        if (grid.vWall[y * (W + 1) + x] !== WALL.Door || grid.floor[left]! <= 0 || grid.floor[right]! <= 0) continue;
        doors++;
        expect(wg.cellKind[left]!).toBeGreaterThan(0);
        expect(wg.cellKind[right]!).toBeGreaterThan(0);
      }
    }
    expect(doors).toBeGreaterThan(0);
  });

  it('makes every fixture anchor that is not seating a Fixture node', () => {
    const { grid, wg } = build();
    const seating = FIXTURE_KEYS.indexOf('seating') + 1;
    let anchors = 0;
    for (let c = 0; c < grid.w * grid.h; c++) {
      if (grid.fixture[c]! === 0 || grid.fixture[c] === seating || grid.fixtureRot[c]! >= 5) continue;
      anchors++;
      expect(wg.cellKind[c]).toBe(WALK_NODE.Fixture);
      expect(wg.nodeKind[wg.cellNode[c]!]).toBe(WALK_NODE.Fixture);
    }
    expect(anchors).toBeGreaterThan(0);
  });

  it('builds equal graphs from one grid', () => {
    const { grid } = build();
    expect(walkFields(buildWalkGraph(grid))).toEqual(walkFields(buildWalkGraph(grid)));
  });
});

describe('walk graph edges', () => {
  it('sees along an open row, stops at the wall and sees through the door', () => {
    const { grid } = build();
    expect(lineOfSight(grid, cellAt(grid, 44, 48), cellAt(grid, 50, 48))).toBe(true);
    expect(lineOfSight(grid, cellAt(grid, 50, 48), cellAt(grid, 60, 48))).toBe(false);
    expect(lineOfSight(grid, cellAt(grid, 50, 45), cellAt(grid, 60, 45))).toBe(true);
  });

  it('makes every edge symmetric with equal length', () => {
    const { wg } = build();
    for (let a = 0; a < wg.nodeCount; a++) {
      for (let e = wg.edgeStart[a]!; e < wg.edgeStart[a + 1]!; e++) {
        const b = wg.edgeTo[e]!;
        let back = -1;
        for (let f = wg.edgeStart[b]!; f < wg.edgeStart[b + 1]!; f++) if (wg.edgeTo[f] === a) back = f;
        expect(back).toBeGreaterThanOrEqual(0);
        expect(wg.edgeLen[back]).toBe(wg.edgeLen[e]);
      }
    }
  });

  it('keeps edgeTo ascending inside each node range', () => {
    const { wg } = build();
    for (let a = 0; a < wg.nodeCount; a++) {
      for (let e = wg.edgeStart[a]! + 1; e < wg.edgeStart[a + 1]!; e++) {
        expect(wg.edgeTo[e]!).toBeGreaterThan(wg.edgeTo[e - 1]!);
      }
    }
  });

  it('gives an interior lattice node at least 16 edges', () => {
    const { grid, wg } = build();
    const node = wg.cellNode[cellAt(grid, 46, 46)]!;
    expect(node).toBeGreaterThanOrEqual(0);
    expect(wg.edgeStart[node + 1]! - wg.edgeStart[node]!).toBeGreaterThanOrEqual(16);
  });

  it('reaches from every start the same floor cells over edges as over canStep', () => {
    const g = handGrid(0, 0, 32, 32);
    setFloor(g, 2, 2, 10, 10);
    setFloor(g, 20, 2, 28, 10);
    const wg = buildWalkGraph(g);
    const floorCells: number[] = [];
    for (let c = 0; c < g.w * g.h; c++) if (g.floor[c]! > 0) floorCells.push(c);
    const reachable = floodCells(g, floorCells[0]!);
    expect(floorCells.filter((c) => reachable[c] === 1).length).toBeLessThan(floorCells.length);
    for (const s of floorCells) {
      const cellsSeen = floodCells(g, s);
      const nodesSeen = floodNodes(wg, wg.cellNode[wg.cellMain[s]!]!);
      for (const c of floorCells) {
        expect(nodesSeen[wg.cellNode[wg.cellMain[c]!]!] === 1).toBe(cellsSeen[c] === 1);
      }
      for (let id = 0; id < wg.nodeCount; id++) {
        if (nodesSeen[id] === 1) expect(cellsSeen[wg.nodeCell[id]!]).toBe(1);
      }
    }
  });

  it('links an interior fixture and a split lattice group through the fallbacks', () => {
    const g = handGrid(0, 0, 32, 32);
    setFloor(g, 0, 0, 6, 3);
    // Block 0 splits into a group with the centre (cols 0 and 1) and a group of column 2.
    for (let y = 0; y < 3; y++) wallLeftOf(g, 2, y);
    // A wall on the vertical edge left of (1, 0) hides the fixture at (0, 0) from the centre.
    wallLeftOf(g, 1, 0);
    // A wall under (3, 0) hides the line from (2, 0) to the centre (4, 1), so only the group fallback joins them.
    wallAbove(g, 3, 1);
    g.fixture[cellIndex(g, 0, 0)] = 1;
    const wg = buildWalkGraph(g);
    const node = (x: number, y: number): number => wg.cellNode[cellIndex(g, x, y)]!;
    expect(wg.cellMain[cellIndex(g, 0, 0)]).toBe(cellIndex(g, 1, 1));
    expect(wg.cellMain[cellIndex(g, 2, 0)]).toBe(cellIndex(g, 2, 0));
    expect(wg.cellMain[cellIndex(g, 3, 0)]).toBe(cellIndex(g, 4, 1));
    expect(edgeLen(wg, node(0, 0), node(1, 1))).toBeCloseTo(2 * TERMINAL_CELL_M, 4);
    expect(edgeLen(wg, node(2, 0), node(4, 1))).toBeCloseTo(3 * TERMINAL_CELL_M, 4);
  });
});

describe('walk graph hand grids', () => {
  it('keeps block centres, borders and diagonal sight lengths right for negative origins', () => {
    const g = handGrid(-40, -40, 35, 35);
    expect(g.x0).toBeLessThan(0);
    expect(g.y0).toBeLessThan(0);
    expect(g.w % BUSINESS.terminal.walk.latticeCells).not.toBe(0);
    setFloor(g, -12, -12, -3, -3);
    const wg = buildWalkGraph(g);
    for (let c = 0; c < g.w * g.h; c++) {
      if (g.floor[c]! > 0) {
        expect(wg.cellMain[c]).toBeGreaterThanOrEqual(0);
        expect(sameBlock(g, wg.cellMain[c]!, c)).toBe(true);
        if (isBlockCentre(g, c)) expect(wg.cellMain[c]).toBe(c);
      } else {
        expect(wg.cellMain[c]).toBe(-1);
      }
    }
    const a = wg.cellNode[cellIndex(g, -11, -11)]!;
    const b = wg.cellNode[cellIndex(g, -8, -8)]!;
    expect(edgeLen(wg, a, b)).toBeCloseTo(TERMINAL_CELL_M * Math.sqrt(18), 4);
  });
});

describe('labelRooms', () => {
  it('labels floor cells with a room and leaves other cells at -1', () => {
    const sim = ownedSim();
    expect(buildTestTerminal(sim)).toEqual([]);
    const grid = sim.business.grids[0]!;
    const labels = labelRooms(grid);
    expect(labels.length).toBe(grid.w * grid.h);
    for (let i = 0; i < labels.length; i++) {
      if (grid.floor[i]! > 0) expect(labels[i]).toBeGreaterThanOrEqual(0);
      else expect(labels[i]).toBe(-1);
    }
  });

  it('finds at least two rooms in the test terminal', () => {
    const sim = ownedSim();
    expect(buildTestTerminal(sim)).toEqual([]);
    const grid = splitTerminal(sim);
    const labels = labelRooms(grid);
    let maxId = -1;
    for (let i = 0; i < labels.length; i++) maxId = Math.max(maxId, labels[i]!);
    expect(maxId).toBeGreaterThanOrEqual(1);
  });

  it('splits rooms at a door edge', () => {
    const sim = ownedSim();
    expect(buildTestTerminal(sim)).toEqual([]);
    const grid = splitTerminal(sim);
    const labels = labelRooms(grid);
    const W = grid.w;
    let doors = 0;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 1; x < W; x++) {
        const edge = y * (W + 1) + x;
        const left = y * W + x - 1;
        const right = y * W + x;
        if (grid.vWall[edge] !== WALL.Door || grid.floor[left]! <= 0 || grid.floor[right]! <= 0) continue;
        doors++;
        expect(labels[left]).not.toBe(labels[right]);
      }
    }
    for (let y = 1; y < grid.h; y++) {
      for (let x = 0; x < W; x++) {
        const edge = y * W + x;
        const up = (y - 1) * W + x;
        const down = y * W + x;
        if (grid.hWall[edge] !== WALL.Door || grid.floor[up]! <= 0 || grid.floor[down]! <= 0) continue;
        doors++;
        expect(labels[up]).not.toBe(labels[down]);
      }
    }
    expect(doors).toBeGreaterThan(0);
  });

  it('returns equal arrays on repeated calls', () => {
    const sim = ownedSim();
    expect(buildTestTerminal(sim)).toEqual([]);
    const grid = sim.business.grids[0]!;
    expect(Array.from(labelRooms(grid))).toEqual(Array.from(labelRooms(grid)));
  });
});
