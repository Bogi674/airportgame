import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { BUSINESS, PROFILES } from '@data/index';
import { Sim } from '@sim/sim';
import { Stage, type Cohorts } from '@sim/cohorts/cohorts';
import { FlState } from '@sim/ops/traffic';
import { FIXTURE_KEYS, LEDGER_CATEGORIES } from '@shared/business';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run, type TerminalOptions } from './helpers';

const WIDE = AIRCRAFT.findIndex((a) => a.id === 'a320neo');

/** A sim with an airport and a terminal that has a curb, check in, security and gate desks. */
function terminalSim(seed?: string, o: TerminalOptions = { checkIn: 4, security: 2, gateDesk: 2 }): Sim {
  const sim = ownedSim(seed);
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, o)).toEqual([]);
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

const BOARD_HOLD_TICKS = PROFILES.boardingHoldS * 10;
const SMALL = AIRCRAFT.findIndex((a) => a.id === 'atr72_600');
/** Turnaround that lets every passenger of a small aircraft board. */
const FULL_TURN_TICKS = 50000;
/** Turnaround that ends while some passengers are at the gate desks, so the push back holds. */
const HOLD_TURN_TICKS = 24000;
const ARRIVE_TICKS = 4000;
const DEPART_TICKS = 100000;
const PASSENGERS = LEDGER_CATEGORIES.indexOf('passengers');
const BUSY = { checkIn: 16, security: 3, gateDesk: 4, belt: 0 } as const;

function ledgerPassengers(sim: Sim): number {
  return sim.business.payload(sim.traffic.nowTick).today[PASSENGERS]!;
}

/** Steps until the condition holds, at most maxTicks steps. False when it never held. */
function stepUntil(sim: Sim, done: () => boolean, maxTicks: number): boolean {
  for (let t = 0; t < maxTicks; t++) {
    if (done()) return true;
    sim.step();
  }
  return done();
}

/** Hold ticks of the aircraft flying flight f, -1 when no aircraft flies it. */
function holdOf(sim: Sim, f: number): number {
  const t = sim.traffic;
  for (let i = 0; i < t.active.length; i++) if (t.active[i] && t.flight[i] === f) return t.boardHold[i]!;
  return -1;
}

/** Steps through the turnaround and the push back. Returns the passengers ledger gain of the departure. */
function departureGain(sim: Sim, f: number): number {
  expect(stepUntil(sim, () => sim.traffic.fState[f] === FlState.OnGround, ARRIVE_TICKS)).toBe(true);
  const before = ledgerPassengers(sim);
  expect(stepUntil(sim, () => sim.traffic.fState[f] === FlState.Departing, DEPART_TICKS)).toBe(true);
  return ledgerPassengers(sim) - before;
}

/** Two busy terminals south of the test apron. Flights alternate between them by flight index. */
function twoTerminalSim(): Sim {
  const sim = terminalSim(undefined, BUSY);
  expect(buildTestTerminal(sim, { ...BUSY, atc: false, at: { x: 3960, y: 5600 } })).toEqual([]);
  return sim;
}

describe('boarding and departure revenue', () => {
  it('an adequate terminal boards every passenger, and the departure pays for each of them', () => {
    const sim = terminalSim(undefined, BUSY);
    const f = sim.traffic.scheduleArrival(SMALL, sim.traffic.nowTick + 100, 0, FULL_TURN_TICKS, -1);
    const pax = sim.business.paxFor(f);
    const gain = departureGain(sim, f);
    const co = sim.cohorts;
    expect(co.flBoarded[f]).toBe(pax);
    expect(co.boarded).toBe(pax);
    expect(co.missed).toBe(0);
    expect(gain).toBe(pax * BUSINESS.fees.passengerDeparting);
    expectConserved(co);
  });

  it('one check in desk and a short turnaround: some board, the rest miss, and revenue counts boarded only', () => {
    const sim = terminalSim(undefined, { checkIn: 1, security: 2, gateDesk: 2 });
    const f = sim.traffic.scheduleArrival(WIDE, sim.traffic.nowTick + 100, 0, 5000, -1);
    const pax = sim.business.paxFor(f);
    const gain = departureGain(sim, f);
    const co = sim.cohorts;
    expect(co.flBoarded[f]).toBeGreaterThan(0);
    expect(co.missed).toBeGreaterThan(0);
    expect(co.flBoarded[f]).toBeLessThan(pax);
    expect(gain).toBe(co.flBoarded[f]! * BUSINESS.fees.passengerDeparting);
    expectConserved(co);
  });

  it('passengers at the gate desks hold the push back, at most the hold limit', () => {
    const sim = terminalSim(undefined, BUSY);
    const f = sim.traffic.scheduleArrival(SMALL, sim.traffic.nowTick + 100, 0, HOLD_TURN_TICKS, -1);
    let maxHold = 0;
    let gateAtHold = -1;
    for (let t = 0; t < DEPART_TICKS && sim.traffic.fState[f] !== FlState.Departing; t++) {
      sim.step();
      const h = holdOf(sim, f);
      if (h > 0 && gateAtHold < 0) gateAtHold = sim.cohorts.flGate[f]!;
      maxHold = Math.max(maxHold, h);
    }
    expect(sim.traffic.fState[f]).toBe(FlState.Departing);
    expect(maxHold).toBeGreaterThan(0);
    // The hold begins only while a cohort walks to or queues at a gate desk.
    expect(gateAtHold).toBeGreaterThan(0);
    expect(maxHold).toBeLessThanOrEqual(BOARD_HOLD_TICKS);
  });

  it('a turnaround with no passenger at a gate desk does not hold', () => {
    const sim = ownedSim();
    buildTestAirport(sim);
    const f = sim.traffic.scheduleArrival(WIDE, sim.traffic.nowTick + 100, 0, 600, -1);
    let maxHold = 0;
    for (let t = 0; t < DEPART_TICKS && sim.traffic.fState[f] !== FlState.Departing; t++) {
      sim.step();
      maxHold = Math.max(maxHold, holdOf(sim, f));
    }
    expect(sim.traffic.fState[f]).toBe(FlState.Departing);
    expect(sim.cohorts.generated).toBe(0);
    expect(maxHold).toBe(0);
  });

  it('a terminal demolished mid journey misses its passengers, and the other terminal keeps boarding', () => {
    const sim = twoTerminalSim();
    const fA = sim.traffic.scheduleArrival(SMALL, sim.traffic.nowTick + 100, 0, FULL_TURN_TICKS, -1);
    const fB = sim.traffic.scheduleArrival(SMALL, sim.traffic.nowTick + 100, 0, FULL_TURN_TICKS, -1);
    expect(sim.business.cohortGrid(fA)).not.toBe(sim.business.cohortGrid(fB));
    const co = sim.cohorts;
    const paxA = sim.business.paxFor(fA);
    const paxB = sim.business.paxFor(fB);
    expect(stepUntil(sim, () => co.flActive[fA]! > 0 && co.boarded === 0, 10)).toBe(true);
    const gA = sim.business.grids[sim.business.cohortGrid(fA)]!;
    expect(run(sim, { type: 'demolishTerminal', id: gA.id })).toEqual([]);
    expect(co.flActive[fA]).toBe(0);
    expect(co.flBoarded[fA]).toBe(0);
    expect(co.missed).toBe(paxA);
    expectConserved(co);
    const gain = departureGain(sim, fB);
    expect(co.flBoarded[fB]).toBe(paxB);
    expect(gain).toBe(paxB * BUSINESS.fees.passengerDeparting);
    expectConserved(co);
  });

  it('two runs from one seed agree at 2000 ticks with a turnaround scheduled', () => {
    const a = terminalSim(undefined, BUSY);
    a.traffic.scheduleArrival(SMALL, a.traffic.nowTick + 100, 0, HOLD_TURN_TICKS, -1);
    const b = terminalSim(undefined, BUSY);
    b.traffic.scheduleArrival(SMALL, b.traffic.nowTick + 100, 0, HOLD_TURN_TICKS, -1);
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    expect(a.cohorts.generated).toBeGreaterThan(0);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('a save taken while a turnaround holds restores and runs to the same hash', () => {
    const a = terminalSim(undefined, BUSY);
    const f = a.traffic.scheduleArrival(SMALL, a.traffic.nowTick + 100, 0, HOLD_TURN_TICKS, -1);
    expect(stepUntil(a, () => holdOf(a, f) > 0, DEPART_TICKS)).toBe(true);
    const data: unknown = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Sim(a.seed, OPTIONS);
    b.restore(data);
    expect(holdOf(b, f)).toBe(holdOf(a, f));
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 1000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });
});
