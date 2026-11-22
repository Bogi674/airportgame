import { describe, expect, it } from 'vitest';
import type { Sim } from '@sim/sim';
import { WALL } from '../src/shared/business';
import { hEdgeIndex, originFor, vEdgeIndex } from '../src/shared/terminalOps';
import { bagNodeAt, bagNodeNumber, bayOptions, standBagState } from '../src/ui/standInspector';
import { buildTestAirport, ownedSim, run } from './helpers';

const { ox, oy } = originFor(3960, 5440, 90);

interface Layout {
  sim: Sim;
  building: number;
}

function fullLayout(): Layout {
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
  const place = (kind: 'machine' | 'bay' | 'carousel', cx: number, cy: number): string[] => run(sim, { type: 'placeBaggageNode', building, kind, cx, cy, rot: 0, widthCells: 4 });
  expect(place('machine', 42, 48)).toEqual([]);
  expect(place('carousel', 42, 42)).toEqual([]);
  expect(place('bay', 50, 49)).toEqual([]);
  return { sim, building };
}

const kindId = (l: Layout, kind: string): number => {
  const rec = l.sim.baggage.nodesOf(l.building).find((r) => r.kind === kind);
  if (!rec) throw new Error(`no ${kind}`);
  return rec.id;
};

describe('baggage inspector payload', () => {
  it('lists bays, slot use, carousel of a bay, node links and warnings', () => {
    const l = fullLayout();
    const stands = l.sim.airfield.data.stands;
    const bay = kindId(l, 'bay');
    const carousel = kindId(l, 'carousel');
    const machine = kindId(l, 'machine');
    const drop = kindId(l, 'drop');
    expect(run(l.sim, { type: 'setStandBay', standId: stands[0].id, bayId: bay })).toEqual([]);
    const info = l.sim.takeBusiness()?.baggage;
    if (!info) throw new Error('no payload');
    expect(info.standBay[0]).toBe(bay);
    expect(info.standBay.slice(1).every((b) => b === -1)).toBe(true);
    expect(info.bays).toEqual([{ id: bay, building: l.building, slots: 2, stands: [stands[0].id], carousel, road: false }]);
    const byId = (id: number) => info.nodes.find((n) => n.id === id);
    expect(byId(drop)?.links).toEqual([{ from: drop, to: machine, mode: 'auto' }]);
    expect(byId(machine)?.links).toContainEqual({ from: machine, to: bay, mode: 'auto' });
    expect(byId(bay)?.links).toContainEqual({ from: bay, to: carousel, mode: 'auto' });
    // The test airport has no road to the bay (T78).
    expect(byId(bay)?.warnings).toEqual(['bayNoRoad']);
    expect(byId(bay)?.capacity).toBe(200);
    expect(byId(drop)?.cells).toEqual([[60, 41]]);
    expect(info.nodes.every((n) => n.held === 0)).toBe(true);
  });

  it('reports a node with no link as a warning', () => {
    const l = fullLayout();
    const info = l.sim.baggage.inspect([]);
    const bay = kindId(l, 'bay');
    expect(info.nodes.find((n) => n.id === bay)?.warnings).toEqual(['bayNoRoad']);
    expect(run(l.sim, { type: 'removeBaggageNode', id: kindId(l, 'carousel') })).toEqual([]);
    const after = l.sim.baggage.inspect([]);
    expect(after.nodes.find((n) => n.id === bay)?.warnings).toEqual(['bayNoCarousel', 'bayNoRoad']);
    expect(after.bays[0].carousel).toBeNull();
  });

  it('leaves the state hash unchanged', () => {
    const l = fullLayout();
    const before = l.sim.stateHash();
    l.sim.baggage.inspect(l.sim.airfield.data.stands.map((s) => s.id));
    l.sim.takeBusiness();
    expect(l.sim.stateHash()).toBe(before);
  });
});

describe('baggage inspector helpers', () => {
  const bays = [
    { id: 9, building: 2, slots: 2, stands: [1], carousel: 4, road: false },
    { id: 7, building: 1, slots: 4, stands: [2, 3], carousel: null, road: true },
    { id: 8, building: 1, slots: 2, stands: [], carousel: 4, road: true },
  ];
  it('numbers bays per terminal with slot use', () => {
    expect(bayOptions(bays)).toEqual([
      { id: 7, building: 1, number: 1, used: 2, total: 4 },
      { id: 8, building: 1, number: 2, used: 0, total: 2 },
      { id: 9, building: 2, number: 1, used: 1, total: 2 },
    ]);
  });
  it('warns per stand case', () => {
    expect(standBagState({ commercial: false, bayId: -1, bays })).toEqual({ visible: false, warning: null, carousel: null });
    expect(standBagState({ commercial: true, bayId: -1, bays })).toEqual({ visible: true, warning: 'noBay', carousel: null });
    expect(standBagState({ commercial: true, bayId: 7, bays })).toEqual({ visible: true, warning: 'bayNoCarousel', carousel: null });
    expect(standBagState({ commercial: true, bayId: 8, bays })).toEqual({ visible: true, warning: null, carousel: 4 });
    expect(standBagState({ commercial: true, bayId: 9, bays })).toEqual({ visible: true, warning: 'bayNoRoad', carousel: 4 });
  });
  it('picks and numbers nodes', () => {
    const nodes = [
      { id: 1, kind: 'drop' as const, building: 1, cells: [[5, 5]] as const },
      { id: 2, kind: 'drop' as const, building: 1, cells: [[6, 5]] as const },
      { id: 3, kind: 'machine' as const, building: 1, cells: [[1, 1], [2, 1]] as const },
    ];
    expect(bagNodeAt(nodes, 1, 2, 1)?.id).toBe(3);
    expect(bagNodeAt(nodes, 2, 2, 1)).toBeNull();
    expect(bagNodeNumber(nodes, 2)).toBe(2);
    expect(bagNodeNumber(nodes, 3)).toBe(1);
  });
});
