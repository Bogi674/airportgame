import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { PROFILES } from '@data/index';
import { Sim } from '@sim/sim';
import { Stage, type Cohorts } from '@sim/cohorts/cohorts';
import { FlState } from '@sim/ops/traffic';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim } from './helpers';

const WIDE = AIRCRAFT.findIndex((a) => a.id === 'a320neo');

/** A sim with an airport and a terminal that has a curb, check in, security and gate desks. */
function terminalSim(seed?: string): Sim {
  const sim = ownedSim(seed);
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2 })).toEqual([]);
  return sim;
}

function scheduleWide(sim: Sim): number {
  const f = sim.traffic.scheduleArrival(WIDE, sim.traffic.nowTick + 100, 0, 600, -1);
  expect(f).toBeGreaterThanOrEqual(0);
  return f;
}

/** Slots on the free list, in order. Fails when the chain loops or runs past hi. */
function freeSlots(co: Cohorts): number[] {
  const out: number[] = [];
  let c = co.freeHead;
  while (c >= 0) {
    expect(out.length).toBeLessThan(co.hi);
    expect(out).not.toContain(c);
    out.push(c);
    c = co.next[c];
  }
  return out;
}

describe('cohort store', () => {
  it('alloc and free reuse slots and keep hi', () => {
    const co = ownedSim().cohorts;
    const a = co.alloc();
    const b = co.alloc();
    expect([a, b]).toEqual([0, 1]);
    expect(co.hi).toBe(2);
    co.free(a);
    expect(co.alloc()).toBe(a);
    expect(co.hi).toBe(2);
    expect(co.alloc()).toBe(2);
    expect(co.hi).toBe(3);
    expect(co.stage[b]).toBe(Stage.Free);
  });

  it('a wide flight at an eligible terminal generates cohorts that sum to its passengers', () => {
    const sim = terminalSim();
    const f = scheduleWide(sim);
    const co = sim.cohorts;
    const pax = sim.business.paxFor(f);
    expect(sim.business.cohortGrid(f)).toBeGreaterThanOrEqual(0);
    expect(pax).toBeGreaterThan(0);
    let sum = 0;
    let live = 0;
    for (let c = 0; c < co.hi; c++) {
      if (co.stage[c] === Stage.Free || co.flight[c] !== f) continue;
      expect(co.size[c]).toBeGreaterThanOrEqual(1);
      expect(co.size[c]).toBeLessThanOrEqual(PROFILES.maxGroup);
      sum += co.size[c];
      live++;
    }
    expect(live).toBeGreaterThan(0);
    expect(sum).toBe(pax);
    expect(co.generated).toBe(pax);
    expect(co.generated).toBe(co.active);
    expect(co.flActive[f]).toBe(pax);
  });

  it('without a terminal nothing is generated', () => {
    const sim = ownedSim();
    scheduleWide(sim);
    expect(sim.cohorts.generated).toBe(0);
    expect(sim.cohorts.active).toBe(0);
    expect(sim.cohorts.hi).toBe(0);
  });

  it('pushback marks every passenger of the flight as missed', () => {
    const sim = terminalSim();
    const f = scheduleWide(sim);
    const pax = sim.business.paxFor(f);
    const co = sim.cohorts;
    co.onPushback(f);
    expect(co.missed).toBe(pax);
    expect(co.active).toBe(0);
    expect(co.flActive[f]).toBe(0);
    expect(co.generated).toBe(co.boarded + co.missed + co.active);
    // The cohorts were all on the wheel, so the unlink must have cleared every bucket they sat in.
    expect(co.wheelHead.every((h) => h === -1)).toBe(true);
    expect(co.hi).toBeGreaterThan(0);
    expect(freeSlots(co).length).toBe(co.hi);
  });

  it('a slot reused after its flight is Done drops the old cohorts as missed', () => {
    const sim = terminalSim();
    const f = scheduleWide(sim);
    const co = sim.cohorts;
    const oldPax = sim.business.paxFor(f);
    co.flBoarded[f] = 5;
    sim.traffic.fState[f] = FlState.Done;
    const reused = scheduleWide(sim);
    expect(reused).toBe(f);
    expect(co.missed).toBe(oldPax);
    expect(co.generated).toBe(co.boarded + co.missed + co.active);
    expect(co.flBoarded[f]).toBe(0);
    expect(co.active).toBe(sim.business.paxFor(f));
  });

  it('a save restores the same hash and counters', () => {
    const a = terminalSim();
    scheduleWide(a);
    const data: unknown = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Sim(a.seed, OPTIONS);
    b.restore(data);
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.cohorts.generated).toBe(a.cohorts.generated);
    expect(b.cohorts.active).toBe(a.cohorts.active);
    expect(b.cohorts.missed).toBe(a.cohorts.missed);
    expect(b.cohorts.hi).toBe(a.cohorts.hi);
  });

  it('the same seed and the same flights give the same hash', () => {
    const a = terminalSim();
    scheduleWide(a);
    const b = terminalSim();
    scheduleWide(b);
    expect(a.cohorts.generated).toBeGreaterThan(0);
    expect(b.stateHash()).toBe(a.stateHash());
  });
});
