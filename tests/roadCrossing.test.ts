import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { AcState } from '@sim/ops/traffic';
import { buildTestAirport, ownedSim, run } from './helpers';

describe('service road crossings (T60)', () => {
  it('marks the crossed taxiway section and reports aircraft taxiing on it', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 4 });
    // A road north across parallel taxiway A (east to west at y = 5190), on the section the stands hang off.
    expect(run(sim, { type: 'buildRoad', points: [{ x: 4600, y: 5300 }, { x: 4600, y: 5120 }] })).toEqual([]);
    const slots = sim.roads.crossMark;
    expect(slots.length).toBe(1);
    const node = sim.roads.nodeCrossSlot.indexOf(0);
    const tw = sim.roads.graph.nodeCross[node];
    const section = sim.airfield.data.taxiways.find((t) => t.id === tw)!;
    expect(section.name).toBe('A');
    const net = sim.traffic.net;
    for (let e = 0; e < net.edgeCount; e++) expect(slots[0][e] === 1).toBe(net.edgeSource[e] === tw);
    // Traffic: at some tick an aircraft taxis on the section, and whenever none moves the crossing is free.
    run(sim, { type: 'testArrival', typeIdx: AIRCRAFT.findIndex((a) => a.id === 'a320neo'), inTicks: 0, turnTicks: 600 });
    let busy = 0;
    for (let t = 0; t < 12000 && sim.traffic.completedFlights === 0; t++) {
      sim.step();
      const moving = [0, 1, 2, 3].some((i) => sim.traffic.active[i] === 1 && sim.traffic.state[i] !== AcState.Turnaround);
      const on = sim.traffic.taxiOnEdges(slots[0]);
      if (on) busy++;
      if (!moving) expect(on).toBe(false);
    }
    expect(busy).toBeGreaterThan(0);
  });

  it('refuses a road across a runway', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 4 });
    expect(run(sim, { type: 'buildRoad', points: [{ x: 3500, y: 4900 }, { x: 3500, y: 5100 }] })).toEqual(['roadOnRunway']);
  });
});
