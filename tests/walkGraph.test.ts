import { describe, expect, it } from 'vitest';
import { WALL } from '../src/shared/business';
import { labelRooms } from '../src/shared/terminalRooms';
import { originFor } from '../src/shared/terminalOps';
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
