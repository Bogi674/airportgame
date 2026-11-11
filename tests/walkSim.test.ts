import { describe, expect, it } from 'vitest';
import { Sim } from '@sim/sim';
import { buildWalkGraph, type WalkGraph } from '@sim/terminal/walkGraph';
import { TERMINAL_CELL_M } from '@shared/business';
import { cellIndex, originFor } from '@shared/terminalOps';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run } from './helpers';

/** Array fields of a walk graph that must match a fresh build, scalars included. */
const ARRAY_FIELDS = ['cellKind', 'cellMain', 'cellNode', 'nodeCell', 'nodeX', 'nodeY', 'nodeKind', 'nodeRoom', 'edgeStart', 'edgeTo', 'edgeLen'] as const;
const SCALAR_FIELDS = ['grid', 'x0', 'y0', 'w', 'h', 'nodeCount'] as const;

function expectSameGraph(actual: WalkGraph, fresh: WalkGraph): void {
  for (const k of SCALAR_FIELDS) expect(actual[k], k).toBe(fresh[k]);
  for (const k of ARRAY_FIELDS) expect(Array.from(actual[k]), k).toEqual(Array.from(fresh[k]));
}

/** A terminal with a wall across it and a door, then one fixture edit. */
function walledSim(): Sim {
  const sim = ownedSim();
  sim.cash = 80_000_000;
  buildTestAirport(sim, { standsPerRow: 6 });
  buildTestTerminal(sim);
  const g = sim.business.grids[0]!;
  const { ox, oy } = originFor(3960, 5440, 90);
  const edit = (op: 'wall' | 'fixture', x0: number, y0: number, x1: number, y1: number, variant: number): void => {
    run(sim, { type: 'terminalBuild', building: g.id, ox, oy, headingDeg: 90, edit: { op, x0, y0, x1, y1, variant } });
  };
  edit('wall', 56, 40, 56, 52, 1);
  edit('wall', 56, 45, 56, 46, 3);
  edit('fixture', 50, 46, 52, 47, 1);
  return sim;
}

function scripted(sim: Sim, ticks: number): void {
  buildTestAirport(sim, { standsPerRow: 4 });
  buildTestTerminal(sim);
  sim.enqueue({ type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
  for (let t = 0; t < ticks; t++) sim.step();
}

describe('walk graph per terminal in the sim', () => {
  it('after walls, a door and a fixture edit, every graph equals a fresh build', () => {
    const sim = walledSim();
    const b = sim.business;
    expect(b.walkGraphs.length).toBe(b.grids.length);
    b.grids.forEach((g, i) => expectSameGraph(b.walkGraphs[i]!, buildWalkGraph(g)));
  });

  it('walks round the wall are longer than the straight line, and unknown ids give Infinity and -1', () => {
    const sim = walledSim();
    const b = sim.business;
    const g = b.grids[0]!;
    const west = cellIndex(g, 54, 42);
    const east = cellIndex(g, 58, 42);
    const from = b.nearestNode(g.id, west);
    const to = b.nearestNode(g.id, east);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThanOrEqual(0);
    const d = b.walkDistance(g.id, from, to);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(4 * TERMINAL_CELL_M);
    expect(b.walkDistance(-1, from, to)).toBe(Infinity);
    expect(b.nearestNode(-1, west)).toBe(-1);
  });

  it('demolishing the terminal empties the walk graphs', () => {
    const sim = walledSim();
    const id = sim.business.grids[0]!.id;
    run(sim, { type: 'demolishTerminal', id });
    expect(sim.business.grids.length).toBe(0);
    expect(sim.business.walkGraphs.length).toBe(0);
  });

  it('save and restore give equal graphs, distances and hash', () => {
    const a = walledSim();
    for (let t = 0; t < 200; t++) a.step();
    const text = JSON.stringify(a.serialize());
    const b = new Sim('GOLDEN-0001', OPTIONS);
    b.restore(JSON.parse(text));
    const ga = a.business;
    const gb = b.business;
    expect(gb.walkGraphs.length).toBe(ga.walkGraphs.length);
    ga.walkGraphs.forEach((wg, i) => expectSameGraph(gb.walkGraphs[i]!, wg));
    const g = ga.grids[0]!;
    const from = ga.nearestNode(g.id, cellIndex(g, 54, 42));
    const to = ga.nearestNode(g.id, cellIndex(g, 58, 42));
    expect(gb.walkDistance(g.id, from, to)).toBe(ga.walkDistance(g.id, from, to));
    expect(b.stateHash()).toBe(a.stateHash());
  });

  it('2000 ticks twice from one seed give equal hashes and equal graphs', () => {
    const a = ownedSim();
    const b = ownedSim();
    scripted(a, 2000);
    scripted(b, 2000);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.business.walkGraphs.length).toBeGreaterThan(0);
    a.business.walkGraphs.forEach((wg, i) => expectSameGraph(b.business.walkGraphs[i]!, wg));
  });
});
