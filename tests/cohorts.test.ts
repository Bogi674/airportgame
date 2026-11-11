import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { PROFILES } from '@data/index';
import { Sim } from '@sim/sim';
import { Stage, type Cohorts } from '@sim/cohorts/cohorts';
import { FlState } from '@sim/ops/traffic';
import { FIXTURE_KEYS } from '@shared/business';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run } from './helpers';

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

/** Turnaround long enough that the passengers reach the gate desks before push back. */
const LONG_TURN_TICKS = 36000;
const RUN_TICKS = 6000;

function scheduleLong(sim: Sim): number {
  const f = sim.traffic.scheduleArrival(WIDE, sim.traffic.nowTick + 100, 0, LONG_TURN_TICKS, -1);
  expect(f).toBeGreaterThanOrEqual(0);
  return f;
}

/** Live cohorts per stage, indexed by Stage value. Free slots are not counted. */
function stageCounts(co: Cohorts): number[] {
  const out = Array.from({ length: Stage.Missed + 1 }, () => 0);
  for (let c = 0; c < co.hi; c++) {
    const st = co.stage[c];
    if (st !== Stage.Free) out[st] = (out[st] ?? 0) + 1;
  }
  return out;
}

function expectConserved(co: Cohorts): void {
  expect(co.generated).toBe(co.boarded + co.missed + co.active);
}

/** Runs the sim and checks the passenger books every 100 ticks. Returns the highest stage seen. */
function runChecked(sim: Sim, ticks: number): number {
  let top = 0;
  for (let t = 0; t < ticks; t++) {
    sim.step();
    for (let c = 0; c < sim.cohorts.hi; c++) top = Math.max(top, sim.cohorts.stage[c]!);
    if (sim.tick % 100 === 0) expectConserved(sim.cohorts);
  }
  return top;
}

describe('cohort journey from curb to boarded', () => {
  it('passengers board and reach the airside stages', () => {
    const sim = terminalSim();
    scheduleLong(sim);
    const top = runChecked(sim, RUN_TICKS);
    expect(sim.cohorts.boarded).toBeGreaterThan(0);
    expect(top).toBeGreaterThanOrEqual(Stage.Airside);
  });

  it('generated equals boarded plus missed plus active through the run', () => {
    const sim = terminalSim();
    scheduleLong(sim);
    runChecked(sim, RUN_TICKS);
    expect(sim.cohorts.generated).toBeGreaterThan(0);
    expectConserved(sim.cohorts);
  });

  it('two runs from one seed agree at 2000 ticks, with cohorts leaving the curb', () => {
    const a = terminalSim();
    scheduleLong(a);
    const b = terminalSim();
    scheduleLong(b);
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    const counts = stageCounts(a.cohorts);
    const live = counts.reduce((x, y) => x + y, 0);
    expect(live).toBeGreaterThan(counts[Stage.Curb]!);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('a save taken mid journey restores and runs to the same hash', () => {
    const a = terminalSim();
    scheduleLong(a);
    let mid = false;
    for (let t = 0; t < RUN_TICKS && !mid; t++) {
      a.step();
      const counts = stageCounts(a.cohorts);
      const queued = (counts[Stage.CheckIn] ?? 0) + (counts[Stage.Security] ?? 0) + (counts[Stage.Gate] ?? 0);
      const walking = (counts[Stage.ToCheckIn] ?? 0) + (counts[Stage.ToSecurity] ?? 0) + (counts[Stage.ToGate] ?? 0);
      mid = queued > 0 && walking > 0;
    }
    expect(mid).toBe(true);
    const data: unknown = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Sim(a.seed, OPTIONS);
    b.restore(data);
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 750; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 750; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });

  it('erasing a check in desk with cohorts queued there keeps the books and boarding', () => {
    const sim = terminalSim();
    scheduleLong(sim);
    const g = sim.business.grids[0]!;
    const checkIn = FIXTURE_KEYS.indexOf('checkIn') + 1;
    let at = -1;
    for (let t = 0; t < RUN_TICKS && at < 0; t++) {
      sim.step();
      const sn = sim.business.serviceTable(g.id)!;
      for (let k = 0; k < sn.count; k++) if (sn.kind[k] === checkIn && sn.queueLen[k]! > 0) at = k;
    }
    expect(at).toBeGreaterThanOrEqual(0);
    const sn = sim.business.serviceTable(g.id)!;
    const lx = sn.lx[at]!;
    const ly = sn.ly[at]!;
    expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op: 'erase', x0: lx, y0: ly, x1: lx + 1, y1: ly + 1, variant: 0 } })).toEqual([]);
    runChecked(sim, RUN_TICKS);
    expect(sim.business.serviceTable(g.id)!.evictedCount).toBe(0);
    expect(sim.cohorts.boarded).toBeGreaterThan(0);
  });

  it('an edit between wheel visits, saved before the next visit, restores to the same hash', () => {
    const a = terminalSim();
    scheduleLong(a);
    const g = a.business.grids[0]!;
    // Stop on a tick the wheel does not visit, with a cohort walking, so the edit lands between visits.
    let ready = false;
    for (let t = 0; t < RUN_TICKS && !ready; t++) {
      a.step();
      ready = a.tick % 5 === 1 && (stageCounts(a.cohorts)[Stage.ToCheckIn] ?? 0) > 0;
    }
    expect(ready).toBe(true);
    const before = a.business.serviceVersion;
    // A wall edit renumbers the service tables without evicting anyone.
    a.enqueue({ type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op: 'wall', x0: 50, y0: 45, x1: 50, y1: 46, variant: 1 } });
    a.step();
    expect(a.business.serviceVersion).toBeGreaterThan(before);
    const data: unknown = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Sim(a.seed, OPTIONS);
    b.restore(data);
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 300; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });
});
