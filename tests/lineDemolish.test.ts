import { describe, expect, it } from 'vitest';
import { cutPolyline, polylineLength } from '@shared/polylineCut';
import { buildTestAirport, ownedSim, run } from './helpers';
import type { Sim } from '@sim/sim';

const ROAD = [
  { x: 3000, y: 5800 },
  { x: 3200, y: 5800 },
  { x: 3200, y: 5600 },
];

function withRoad(): Sim {
  const sim = ownedSim();
  sim.cash = 500_000_000;
  buildTestAirport(sim, { standsPerRow: 2 });
  expect(run(sim, { type: 'buildRoad', points: ROAD })).toEqual([]);
  return sim;
}

describe('polyline cut (DEM2)', () => {
  it('splits a polyline into the parts before and after a stretch', () => {
    const c = cutPolyline(ROAD, 100, 300, 8);
    expect(c.first).toEqual([{ x: 3000, y: 5800 }, { x: 3100, y: 5800 }]);
    expect(c.last).toEqual([{ x: 3200, y: 5700 }, { x: 3200, y: 5600 }]);
    expect(c.removedM).toBeCloseTo(200);
  });

  it('drops a leftover shorter than the minimum part, so a stroke near an end trims it', () => {
    const c = cutPolyline(ROAD, 4, 100, 8);
    expect(c.first).toBeNull();
    expect(c.last?.[0]).toEqual({ x: 3100, y: 5800 });
    expect(c.removedM).toBeCloseTo(100);
    expect(polylineLength(c.last ?? [])).toBeCloseTo(300);
  });
});

describe('road cut (DEM2)', () => {
  it('cuts a section out of a road into two roads with a pro rata refund, and undo restores it', () => {
    const sim = withRoad();
    const before = sim.airfield.data.roads!.slice();
    const road = before[before.length - 1];
    const cash = sim.cash;
    expect(run(sim, { type: 'cutRoad', id: road.id, at: { x: 3100, y: 5800 }, at2: { x: 3200, y: 5700 } })).toEqual([]);
    const roads = sim.airfield.data.roads!;
    expect(roads).toHaveLength(before.length + 1);
    expect(roads.find((r) => r.id === road.id)).toBeUndefined();
    const share = 200 / 400;
    expect(sim.cash - cash).toBe(Math.round(road.cost * share * 0.25));
    run(sim, { type: 'undo' });
    expect(sim.airfield.data.roads!.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(sim.cash).toBe(cash);
  });

  it('removes the whole road when the stroke covers it', () => {
    const sim = withRoad();
    const road = sim.airfield.data.roads![sim.airfield.data.roads!.length - 1];
    const n = sim.airfield.data.roads!.length;
    expect(run(sim, { type: 'cutRoad', id: road.id, at: { x: 3000, y: 5800 }, at2: { x: 3200, y: 5600 } })).toEqual([]);
    expect(sim.airfield.data.roads).toHaveLength(n - 1);
  });

  it('refuses a stroke away from the road', () => {
    const sim = withRoad();
    const road = sim.airfield.data.roads![sim.airfield.data.roads!.length - 1];
    expect(run(sim, { type: 'cutRoad', id: road.id, at: { x: 2000, y: 2000 }, at2: { x: 2100, y: 2000 } })).toEqual(['nothingThere']);
  });

  it('replays deterministically', () => {
    const hash = (): number => {
      const sim = withRoad();
      const road = sim.airfield.data.roads![sim.airfield.data.roads!.length - 1];
      run(sim, { type: 'cutRoad', id: road.id, at: { x: 3100, y: 5800 }, at2: { x: 3200, y: 5700 } });
      for (let i = 0; i < 2000; i++) sim.step();
      return sim.stateHash();
    };
    expect(hash()).toBe(hash());
  });
});
