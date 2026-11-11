import { describe, expect, it } from 'vitest';
import type { Sim } from '@sim/sim';
import { buildWalkGraph, type WalkGraph } from '@sim/terminal/walkGraph';
import { FIXTURE_KEYS, FLOOR, WALL, ZONE } from '@shared/business';
import { originFor, ROT_STEP, type TerminalEdit } from '@shared/terminalOps';
import { buildTestAirport, buildTestTerminal, ownedSim, run } from './helpers';

/** Array fields of a walk graph that must match a fresh build, scalars included. */
const ARRAY_FIELDS = ['cellKind', 'cellMain', 'cellNode', 'nodeCell', 'nodeX', 'nodeY', 'nodeKind', 'nodeRoom', 'edgeStart', 'edgeTo', 'edgeLen'] as const;
const SCALAR_FIELDS = ['grid', 'x0', 'y0', 'w', 'h', 'nodeCount'] as const;
const ROTS = [0, 1, 2, 3] as const;
const BAG_DROP = FIXTURE_KEYS.indexOf('bagDrop') + 1;
const SMALL_ORIGIN = originFor(3300, 5700, 90);

function expectSameGraph(actual: WalkGraph, fresh: WalkGraph): void {
  for (const k of SCALAR_FIELDS) expect(actual[k], k).toBe(fresh[k]);
  for (const k of ARRAY_FIELDS) expect(Array.from(actual[k]), k).toEqual(Array.from(fresh[k]));
}

/** Every walk graph equals a fresh build of its grid, and the graphs stay index matched with the grids. */
function expectFresh(sim: Sim): void {
  const b = sim.business;
  expect(b.walkGraphs.length).toBe(b.grids.length);
  b.grids.forEach((g, i) => expectSameGraph(b.walkGraphs[i]!, buildWalkGraph(g)));
}

/** One terminal from buildTestTerminal at index 0 and a small second terminal at index 1. */
function setup(): Sim {
  const sim = ownedSim();
  sim.cash = 80_000_000;
  buildTestAirport(sim, { standsPerRow: 6 });
  buildTestTerminal(sim);
  expect(run(sim, { type: 'terminalBuild', building: -1, ox: SMALL_ORIGIN.ox, oy: SMALL_ORIGIN.oy, headingDeg: 90, edit: foundation(40, 40, 46, 44) })).toEqual([]);
  expectFresh(sim);
  return sim;
}

function foundation(x0: number, y0: number, x1: number, y1: number): TerminalEdit {
  return { op: 'foundation', x0, y0, x1, y1, variant: 0 };
}

/** Applies one edit to the grid at index, asserts it applied without a problem, then checks every graph. */
function edit(sim: Sim, index: number, op: TerminalEdit['op'], x0: number, y0: number, x1: number, y1: number, variant = 0, rot: 0 | 1 | 2 | 3 = 0): void {
  const g = sim.business.grids[index]!;
  const e: TerminalEdit = { op, x0, y0, x1, y1, variant, rot };
  expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: e })).toEqual([]);
  expectFresh(sim);
}

describe('walk graph stays equal to a fresh build after each command edit', () => {
  it.each(ROTS)('erasing the tail of a two cell fixture at rotation %i, partner outside the rectangle', (r) => {
    const sim = setup();
    const [dx, dy] = ROT_STEP[r]!;
    const ax = 50 + 4 * r;
    const ay = 47;
    edit(sim, 0, 'fixture', ax, ay, ax + 1, ay + 1, BAG_DROP, r);
    edit(sim, 0, 'erase', ax + dx, ay + dy, ax + dx + 1, ay + dy + 1);
  });

  it.each(ROTS)('erasing the anchor of a two cell fixture at rotation %i, partner outside the rectangle', (r) => {
    const sim = setup();
    const [dx, dy] = ROT_STEP[r]!;
    const ax = 50 + 4 * r;
    const ay = 47;
    edit(sim, 0, 'fixture', ax, ay, ax + 1, ay + 1, BAG_DROP, r);
    edit(sim, 0, 'erase', ax, ay, ax + 1, ay + 1);
    edit(sim, 0, 'foundation', ax, ay, ax + 1, ay + 1);
    edit(sim, 0, 'fixture', ax, ay, ax + 1, ay + 1, BAG_DROP, r);
    edit(sim, 0, 'erase', ax + dx, ay + dy, ax + dx + 1, ay + dy + 1);
  });

  it('erasing both sides of a wall prunes the wall', () => {
    const sim = setup();
    edit(sim, 0, 'wall', 63, 46, 63, 50, WALL.Wall);
    edit(sim, 0, 'erase', 63, 46, 64, 50);
    edit(sim, 0, 'erase', 62, 46, 63, 50);
  });

  it('removeWall takes out a vertical and a horizontal wall', () => {
    const sim = setup();
    edit(sim, 0, 'wall', 66, 46, 66, 50, WALL.Glass);
    edit(sim, 0, 'wall', 50, 48, 54, 48, WALL.Wall);
    edit(sim, 0, 'removeWall', 66, 46, 66, 50);
    edit(sim, 0, 'removeWall', 50, 48, 54, 48);
  });

  it('floor and zone ops keep the graph fresh', () => {
    const sim = setup();
    edit(sim, 0, 'floor', 50, 44, 58, 50, FLOOR.Carpet);
    edit(sim, 0, 'zone', 50, 44, 58, 50, ZONE.Commercial);
  });

  it('a foundation that grows the grid rebuilds its graph', () => {
    const sim = setup();
    const before = sim.business.grids[0]!.w;
    edit(sim, 0, 'foundation', 140, 40, 160, 52);
    expect(sim.business.grids[0]!.w).toBeGreaterThan(before);
  });

  it('erasing the last floor of the first grid removes it and the survivor keeps its graph', () => {
    const sim = setup();
    const survivor = sim.business.grids[1]!.id;
    edit(sim, 0, 'erase', 40, 40, 100, 52);
    expect(sim.business.grids.length).toBe(1);
    expect(sim.business.grids[0]!.id).toBe(survivor);
    expect(sim.business.walkGraphs.length).toBe(1);
  });

  it('erasing the last floor of the last grid removes it', () => {
    const sim = setup();
    const first = sim.business.grids[0]!.id;
    edit(sim, 1, 'erase', 40, 40, 46, 44);
    expect(sim.business.grids.length).toBe(1);
    expect(sim.business.grids[0]!.id).toBe(first);
    expect(sim.business.walkGraphs.length).toBe(1);
  });
});
