import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@data/index';
import { FIXTURE_KEYS, WALL, type TerminalGrid } from '../src/shared/business';
import { labelRooms } from '../src/shared/terminalRooms';
import { originFor } from '../src/shared/terminalOps';
import { WALK_NODE, buildWalkGraph, type WalkGraph } from '../src/sim/terminal/walkGraph';
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

describe('walk graph nodes', () => {
  const build = (): { grid: TerminalGrid; wg: WalkGraph } => {
    const sim = ownedSim();
    expect(buildTestTerminal(sim)).toEqual([]);
    const grid = splitTerminal(sim);
    return { grid, wg: buildWalkGraph(grid) };
  };

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
