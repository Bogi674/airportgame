import { describe, expect, it } from 'vitest';
import { BAGGAGE } from '@data/index';
import { Sim } from '@sim/sim';
import { WALL } from '../src/shared/business';
import { dropOutCell, nodeCells } from '../src/shared/baggageNodes';
import { cellIndex, hEdgeIndex, originFor, vEdgeIndex } from '../src/shared/terminalOps';
import { buildTestAirport, ownedSim, OPTIONS, run } from './helpers';

const { ox, oy } = originFor(3960, 5440, 90);

interface Layout {
  sim: Sim;
  building: number;
}

/** A hall with a check in desk, a closed machine room with a door and one wall on the south edge for a bay. */
function layout(): Layout {
  const sim = ownedSim();
  buildTestAirport(sim);
  const edit = (building: number, e: { op: 'foundation' | 'floor' | 'zone' | 'fixture' | 'erase'; x0: number; y0: number; x1: number; y1: number; variant: number }): string[] =>
    run(sim, { type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e });
  expect(edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 70, y1: 53, variant: 0 })).toEqual([]);
  const building = sim.business.grids[0].id;
  expect(edit(building, { op: 'floor', x0: 40, y0: 40, x1: 70, y1: 53, variant: 2 })).toEqual([]);
  expect(edit(building, { op: 'zone', x0: 40, y0: 46, x1: 60, y1: 53, variant: 4 })).toEqual([]);
  const g = sim.business.grids[0];
  for (let x = 41; x <= 45; x++) {
    g.hWall[hEdgeIndex(g, x, 47)] = WALL.Wall;
    g.hWall[hEdgeIndex(g, x, 50)] = x === 43 ? WALL.Door : WALL.Wall;
  }
  for (let y = 47; y <= 49; y++) {
    g.vWall[vEdgeIndex(g, 41, y)] = WALL.Wall;
    g.vWall[vEdgeIndex(g, 46, y)] = WALL.Wall;
  }
  for (let x = 50; x <= 53; x++) g.hWall[hEdgeIndex(g, x, 53)] = WALL.Wall;
  expect(edit(building, { op: 'fixture', x0: 60, y0: 41, x1: 61, y1: 42, variant: 1 })).toEqual([]);
  return { sim, building };
}

const place = (l: Layout, kind: 'machine' | 'bay' | 'carousel', cx: number, cy: number, widthCells = 4): string[] =>
  run(l.sim, { type: 'placeBaggageNode', building: l.building, kind, cx, cy, rot: 0, widthCells });

const idOf = (l: Layout, kind: string): number => {
  const rec = l.sim.baggage.nodesOf(l.building).find((r) => r.kind === kind);
  if (!rec) throw new Error(`no ${kind}`);
  return rec.id;
};

const links = (l: Layout): [number, number, string][] => l.sim.baggage.saveState().links.flatMap((x) => x.links);

/** Machine, carousel, then bay, so the bay finds the carousel when it is added. */
function fullLayout(): Layout {
  const l = layout();
  expect(place(l, 'machine', 42, 48)).toEqual([]);
  expect(place(l, 'carousel', 42, 42)).toEqual([]);
  expect(place(l, 'bay', 50, 49)).toEqual([]);
  return l;
}

describe('baggage subsystem', () => {
  it('creates a drop point from the check in desk', () => {
    const l = layout();
    const drop = l.sim.baggage.nodesOf(l.building);
    expect(drop.map((r) => r.kind)).toEqual(['drop']);
    expect(drop[0].cell).toEqual([60, 41]);
    expect(l.sim.baggage.warnings()).toEqual([{ id: drop[0].id, code: 'dropNoMachine' }]);
  });

  it('links drop to machine, bay to carousel, and routes a departure after a stand is assigned', () => {
    const l = fullLayout();
    const drop = idOf(l, 'drop');
    const machine = idOf(l, 'machine');
    const bay = idOf(l, 'bay');
    const carousel = idOf(l, 'carousel');
    expect(links(l)).toEqual([[drop, machine, 'auto'], [bay, carousel, 'auto']]);
    const stand = l.sim.airfield.data.stands[0].id;
    expect(run(l.sim, { type: 'setStandBay', standId: stand, bayId: bay })).toEqual([]);
    expect(links(l)).toContainEqual([machine, bay, 'auto']);
    expect(l.sim.baggage.bayOfStand(stand)).toBe(bay);
    expect(l.sim.baggage.carouselOf(bay)).toBe(carousel);
    expect(l.sim.baggage.routeDeparture(drop, stand)).toEqual({ route: [drop, machine, bay] });
    expect(run(l.sim, { type: 'setStandBay', standId: stand, bayId: -1 })).toEqual([]);
    expect(links(l)).not.toContainEqual([machine, bay, 'auto']);
    expect(l.sim.baggage.bayOfStand(stand)).toBeNull();
    expect(run(l.sim, { type: 'setStandBay', standId: 99999, bayId: bay })).toEqual(['nothingThere']);
    expect(run(l.sim, { type: 'setStandBay', standId: stand, bayId: 99999 })).toEqual(['nothingThere']);
  });

  it('removes a machine whose cells are erased, with its links, and warns for the drop', () => {
    const l = fullLayout();
    const drop = idOf(l, 'drop');
    const machine = idOf(l, 'machine');
    const problems = run(l.sim, { type: 'terminalBuild', building: l.building, ox, oy, headingDeg: 90, edit: { op: 'erase', x0: 42, y0: 48, x1: 46, y1: 49, variant: 0 } });
    expect(problems).toEqual([]);
    expect(l.sim.baggage.nodesOf(l.building).some((r) => r.id === machine)).toBe(false);
    expect(links(l).some(([s, d]) => s === machine || d === machine)).toBe(false);
    expect(l.sim.baggage.warnings()).toContainEqual({ id: drop, code: 'dropNoMachine' });
  });

  it('removes a placed node by command and clears its cells', () => {
    const l = fullLayout();
    const machine = idOf(l, 'machine');
    expect(run(l.sim, { type: 'removeBaggageNode', id: machine })).toEqual([]);
    expect(l.sim.baggage.nodesOf(l.building).some((r) => r.id === machine)).toBe(false);
    const g = l.sim.business.grids[0];
    expect(g.fixture.some((f) => f === 17)).toBe(false);
    expect(run(l.sim, { type: 'removeBaggageNode', id: machine })).toEqual(['nothingThere']);
    expect(run(l.sim, { type: 'fixBaggageNode', id: machine })).toEqual(['nothingThere']);
  });

  it('gives a drop whose out cell has no floor a null port and no link', () => {
    const l = layout();
    expect(l.sim.baggage.nodesOf(l.building).filter((r) => r.kind === 'drop')).toHaveLength(1);
    const problems = run(l.sim, { type: 'terminalBuild', building: l.building, ox, oy, headingDeg: 90, edit: { op: 'fixture', x0: 50, y0: 40, x1: 51, y1: 41, variant: 1 } });
    expect(problems).toEqual([]);
    expect(place(l, 'machine', 42, 48)).toEqual([]);
    const drops = l.sim.baggage.nodesOf(l.building).filter((r) => r.kind === 'drop');
    expect(drops).toHaveLength(2);
    const machine = idOf(l, 'machine');
    const offFloor = drops.find((r) => r.cell[0] === 50 && r.cell[1] === 40);
    if (!offFloor) throw new Error('no off floor drop');
    expect(links(l).some(([s, d]) => (s === offFloor.id || d === offFloor.id) && (s === machine || d === machine))).toBe(false);
    expect(links(l).some(([s, d]) => s === offFloor.id || d === offFloor.id)).toBe(false);
  });

  it('nulls a drop port under a machine and restores it and its link when the machine goes', () => {
    const l = layout();
    const drop = idOf(l, 'drop');
    const [ox0, oy0] = dropOutCell(60, 41, 0);
    expect(place(l, 'machine', 42, 48)).toEqual([]);
    expect(links(l).some(([s]) => s === drop)).toBe(true);
    expect(place(l, 'machine', ox0, oy0)).toEqual([]);
    const blocker = l.sim.baggage.nodesOf(l.building).filter((r) => r.kind === 'machine').find((r) => r.cell[0] === ox0 && r.cell[1] === oy0);
    if (!blocker) throw new Error('no blocker');
    expect(links(l).some(([s]) => s === drop)).toBe(false);
    expect(run(l.sim, { type: 'removeBaggageNode', id: blocker.id })).toEqual([]);
    expect(links(l).some(([s]) => s === drop)).toBe(true);
  });

  it('removes a bay and clears its other cells when one cell is erased', () => {
    const l = fullLayout();
    const bay = idOf(l, 'bay');
    const g = l.sim.business.grids[0];
    const spec = l.sim.baggage.nodesOf(l.building).find((r) => r.id === bay)?.spec;
    if (!spec) throw new Error('no bay spec');
    const cells = nodeCells(spec);
    const [ex, ey] = cells[0];
    const problems = run(l.sim, { type: 'terminalBuild', building: l.building, ox, oy, headingDeg: 90, edit: { op: 'erase', x0: ex, y0: ey, x1: ex + 1, y1: ey + 1, variant: 0 } });
    expect(problems).toEqual([]);
    expect(l.sim.baggage.nodesOf(l.building).some((r) => r.id === bay)).toBe(false);
    expect(links(l).some(([s, d]) => s === bay || d === bay)).toBe(false);
    for (const [x, y] of cells) expect(g.fixture[cellIndex(g, x, y)]).toBe(0);
  });

  it('removes the drop node and its link when the check in desk is erased', () => {
    const l = fullLayout();
    const drop = idOf(l, 'drop');
    expect(links(l).some(([s]) => s === drop)).toBe(true);
    const problems = run(l.sim, { type: 'terminalBuild', building: l.building, ox, oy, headingDeg: 90, edit: { op: 'erase', x0: 60, y0: 41, x1: 61, y1: 42, variant: 0 } });
    expect(problems).toEqual([]);
    expect(l.sim.baggage.nodesOf(l.building).some((r) => r.kind === 'drop')).toBe(false);
    expect(links(l).some(([s, d]) => s === drop || d === drop)).toBe(false);
  });

  it('books the cost and refuses without funds', () => {
    const l = layout();
    const before = l.sim.cash;
    expect(place(l, 'machine', 42, 48)).toEqual([]);
    expect(l.sim.cash).toBe(before - BAGGAGE.costs.machine);
    expect(place(l, 'carousel', 42, 42)).toEqual([]);
    const cash = l.sim.cash;
    expect(place(l, 'bay', 50, 49, 4)).toEqual([]);
    expect(l.sim.cash).toBe(cash - 4 * BAGGAGE.costs.bayPerCell);
    const poor = layout();
    poor.sim.cash = 10;
    expect(place(poor, 'machine', 42, 48)).toEqual([`insufficientFunds|cost=${BAGGAGE.costs.machine}`]);
    expect(poor.sim.baggage.nodesOf(poor.building).map((r) => r.kind)).toEqual(['drop']);
  });

  it('restores to the same hash after a save in mid run', () => {
    const l = fullLayout();
    const bay = idOf(l, 'bay');
    run(l.sim, { type: 'setStandBay', standId: l.sim.airfield.data.stands[0].id, bayId: bay });
    for (let i = 0; i < 300; i++) l.sim.step();
    const data = JSON.parse(JSON.stringify(l.sim.serialize())) as unknown;
    const copy = new Sim('GOLDEN-0001', OPTIONS);
    copy.restore(data);
    expect(copy.stateHash()).toBe(l.sim.stateHash());
    expect(copy.baggage.saveState()).toEqual(l.sim.baggage.saveState());
  });

  it('gives drop points to a save from before the baggage network', () => {
    const l = layout();
    const data = JSON.parse(JSON.stringify(l.sim.serialize())) as { version: number; baggage?: unknown };
    data.version = 22;
    delete data.baggage;
    const copy = new Sim('GOLDEN-0001', OPTIONS);
    copy.restore(data);
    expect(copy.baggage.nodesOf(l.building).map((r) => r.kind)).toEqual(['drop']);
  });

  it('is deterministic over 2000 ticks', () => {
    const hashes = [0, 1].map(() => {
      const l = fullLayout();
      run(l.sim, { type: 'setStandBay', standId: l.sim.airfield.data.stands[0].id, bayId: idOf(l, 'bay') });
      for (let i = 0; i < 2000; i++) l.sim.step();
      return l.sim.stateHash();
    });
    expect(hashes[0]).toBe(hashes[1]);
  });
});
