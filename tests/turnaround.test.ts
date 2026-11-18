import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { GSE_INDEX, TURNAROUNDS } from '@data/index';
import { AcState } from '@sim/ops/traffic';
import { Sim } from '@sim/sim';
import { TICKS_PER_MINUTE } from '@shared/business';
import { causeOwner, VEHICLE_CAUSE } from '@shared/turnaround';
import { buildTestAirport, OPTIONS, ownedSim, run } from './helpers';

const A320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');

/** A test airport with an airline flight of an A320 arriving now. Returns the flight. */
function airlineFlight(sim: Sim, ground = true): number {
  buildTestAirport(sim, { standsPerRow: 4, ground });
  return sim.traffic.scheduleArrival(A320, sim.tick + 1, 0, sim.traffic.turnaroundTicks(A320), 0);
}

/** Steps until the flight's aircraft is in its turnaround, and returns the aircraft slot. */
function untilDocked(sim: Sim, f: number): number {
  for (let t = 0; t < 40000; t++) {
    sim.step();
    const a = sim.traffic.fAc[f];
    if (a >= 0 && sim.traffic.state[a] === AcState.Turnaround) return a;
  }
  throw new Error('flight never docked');
}

describe('turnaround task lists (T63)', () => {
  it('the longest chain of task shares is exactly one turnaround', () => {
    const end = new Map<string, number>();
    for (const t of TURNAROUNDS.tasks) {
      let start = 0;
      for (const d of t.after) {
        expect(end.has(d)).toBe(true);
        start = Math.max(start, end.get(d)!);
      }
      expect(t.kind === null || GSE_INDEX[t.kind] !== undefined).toBe(true);
      end.set(t.id, start + t.share);
    }
    expect(Math.max(...end.values())).toBeCloseTo(1, 9);
  });

  it('runs deterministically, also across a save and load mid turnaround', () => {
    const go = (): Sim => {
      const sim = ownedSim();
      untilDocked(sim, airlineFlight(sim));
      for (let t = 0; t < 2000; t++) sim.step();
      return sim;
    };
    const a = go();
    const b = go();
    expect(a.stateHash()).toBe(b.stateHash());
    const c = new Sim(a.seed, OPTIONS);
    c.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(c.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 3000; t++) {
      a.step();
      c.step();
    }
    expect(c.stateHash()).toBe(a.stateHash());
    expect(c.gse.count).toBe(a.gse.count);
  });

  it('with a depot and a road the flight leaves within the on time window', () => {
    const sim = ownedSim();
    const f = airlineFlight(sim);
    const a = untilDocked(sim, f);
    const plan = sim.traffic.timer[a];
    const docked = sim.tick;
    while (sim.traffic.state[a] === AcState.Turnaround && sim.tick < docked + 4 * plan) sim.step();
    expect(sim.traffic.state[a]).not.toBe(AcState.Turnaround);
    expect(sim.tick - docked - plan).toBeLessThan(15 * TICKS_PER_MINUTE);
  });

  it('waits for a missing belt loader, names it as the airport delay, and finishes once one is bought', () => {
    const sim = ownedSim();
    const f = airlineFlight(sim);
    sim.business.fleet[GSE_INDEX.beltloader] = 0;
    const a = untilDocked(sim, f);
    const plan = sim.traffic.timer[a];
    for (let t = 0; t < plan + 3000; t++) sim.step();
    expect(sim.traffic.state[a]).toBe(AcState.Turnaround);
    expect(sim.traffic.fCause[f]).toBe(VEHICLE_CAUSE + GSE_INDEX.beltloader);
    expect(causeOwner(sim.traffic.fCause[f])).toBe('airport');
    const events: string[] = [];
    sim.drainEvents(events);
    expect(events).toContain('noVehicle|vehicle=belt loader');
    expect(run(sim, { type: 'buyGse', kind: 'beltloader', count: 1 })).toEqual([]);
    for (let t = 0; t < 2 * plan && sim.traffic.state[a] === AcState.Turnaround; t++) sim.step();
    expect(sim.traffic.state[a]).not.toBe(AcState.Turnaround);
  });

  it('a flight with no depot and no fleet stays on its stand, while test traffic still turns on its timer', () => {
    const sim = ownedSim();
    const f = airlineFlight(sim, false);
    const a = untilDocked(sim, f);
    const plan = sim.traffic.timer[a];
    for (let t = 0; t < plan + 2000; t++) sim.step();
    expect(sim.traffic.state[a]).toBe(AcState.Turnaround);
    expect(causeOwner(sim.traffic.fCause[f])).toBe('airport');
    const events: string[] = [];
    sim.drainEvents(events);
    expect(events.some((e) => e.startsWith('noVehicle|'))).toBe(true);
    const t2 = ownedSim();
    buildTestAirport(t2, { standsPerRow: 4, ground: false });
    run(t2, { type: 'testArrival', typeIdx: A320, inTicks: 0, turnTicks: 3000 });
    for (let t = 0; t < 30000 && t2.traffic.completedFlights === 0; t++) t2.step();
    expect(t2.traffic.completedFlights).toBe(1);
  });
});
