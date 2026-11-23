import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { STAFF } from '@data/index';
import { FIXTURE_KEYS, TICKS_PER_MINUTE } from '@shared/business';
import type { Sim } from '@sim/sim';
import { STAFF_FLAG, STAFF_STATE, type Staff } from '@sim/staff/staff';
import { Sim as SimClass } from '@sim/sim';
import { staffSkill } from '@sim/staff/staffTraits';
import { buildTestAirport, buildTestStaffCenter, buildTestTerminal, ownedSim, run, OPTIONS } from './helpers';

const HOUR = 60 * TICKS_PER_MINUTE;
/** The game starts at 06:00, so a clock time is this many hours past tick 0. */
const at = (hour: number, minute = 0): number => (hour - 6) * HOUR + minute * TICKS_PER_MINUTE;

function shiftSim(o: { center?: boolean; closedDesk?: boolean; perHour?: number } = {}): { sim: Sim; center: number } {
  const sim = ownedSim();
  // No depot, so no apron crew pool (T81): the rosters and clock counts are the terminal staff only.
  buildTestAirport(sim, { ground: false });
  expect(run(sim, { type: 'setTestTraffic', perHour: o.perHour ?? 0, turnScale: 1 })).toEqual([]);
  if (o.center !== false) expect(buildTestStaffCenter(sim)).toEqual([]);
  expect(buildTestTerminal(sim, { checkIn: 2, security: 1, gateDesk: 1 })).toEqual([]);
  if (o.closedDesk) {
    const g = sim.business.grids[0]!;
    const edit = (e: { op: 'wall' | 'fixture'; x0: number; y0: number; x1: number; y1: number; variant: number }): string[] =>
      run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: e });
    expect(edit({ op: 'wall', x0: 46, y0: 44, x1: 51, y1: 44, variant: 1 })).toEqual([]);
    expect(edit({ op: 'wall', x0: 46, y0: 48, x1: 51, y1: 48, variant: 1 })).toEqual([]);
    expect(edit({ op: 'wall', x0: 46, y0: 44, x1: 46, y1: 48, variant: 1 })).toEqual([]);
    expect(edit({ op: 'wall', x0: 51, y0: 44, x1: 51, y1: 48, variant: 1 })).toEqual([]);
    expect(edit({ op: 'fixture', x0: 48, y0: 46, x1: 49, y1: 47, variant: 1 })).toEqual([]);
  }
  const center = sim.airfield.data.buildings?.find((b) => b.kind === 'staff')?.id ?? -1;
  return { sim, center };
}

const runTo = (sim: Sim, tick: number): void => {
  while (sim.tick < tick) sim.step();
};

const membersOf = (st: Staff, shift: number): number[] => {
  const out: number[] = [];
  for (let m = 0; m < st.hi; m++) if (st.state[m] !== STAFF_STATE.Free && st.shift[m] === shift) out.push(m);
  return out;
};

describe('shift cycle', () => {
  it('has the next shift off and planned before it starts', () => {
    const { sim } = shiftSim();
    runTo(sim, at(13));
    const st = sim.staff;
    const next = membersOf(st, 1);
    expect(next).toHaveLength(8);
    for (const m of next) {
      expect(st.state[m]).toBe(STAFF_STATE.Off);
      expect(st.wake[m]).toBeLessThan(at(14));
      expect(st.wake[m]).toBeGreaterThan(sim.tick);
    }
  }, 120_000);

  it('hands over at 14:00, with every station at its need and the shift counters matching', () => {
    const { sim, center } = shiftSim();
    expect(center).toBeGreaterThanOrEqual(0);
    runTo(sim, at(14, 45));
    const st = sim.staff;
    for (let s = 0; s < st.stCount; s++) expect(st.sPresent[s]).toBe(st.sNeed[s]);
    for (let m = 0; m < st.hi; m++) if (st.state[m] === STAFF_STATE.OnDuty) expect(st.shift[m]).toBe(1);
    expect(st.clockIns.get(center)).toBe(8);
    expect(st.clockOuts.get(center)).toBe(8);
  }, 120_000);

  it('works without a staff center, with every event counted under -1', () => {
    const { sim } = shiftSim({ center: false });
    runTo(sim, at(14, 45));
    const st = sim.staff;
    for (let s = 0; s < st.stCount; s++) expect(st.sPresent[s]).toBe(st.sNeed[s]);
    expect(st.clockIns.get(-1)).toBe(8);
    expect(st.clockOuts.get(-1)).toBe(8);
  }, 120_000);

  it('leaves a desk the staff cannot reach unstaffed and sends its staff back off', () => {
    const { sim } = shiftSim({ closedDesk: true });
    runTo(sim, at(15, 30));
    const st = sim.staff;
    let closed = -1;
    for (let s = 0; s < st.stCount; s++) if (st.sX[s] === 48 && st.sY[s] === 46) closed = s;
    expect(closed).toBeGreaterThanOrEqual(0);
    expect(st.sPresent[closed]).toBe(0);
    let planned = 0;
    for (let m = 0; m < st.hi; m++) {
      if (st.stIdx[m] !== closed || st.shift[m] !== 1) continue;
      planned++;
      expect(st.state[m]).toBe(STAFF_STATE.Off);
    }
    expect(planned).toBe(1);
  }, 120_000);
});

/** The agent on duty with the earliest break, the one the relief of the shift goes to first. */
function firstBreaker(sim: Sim): number {
  const st = sim.staff;
  let best = -1;
  for (let m = 0; m < st.hi; m++) {
    if (st.role[m] !== 0 || st.state[m] !== STAFF_STATE.OnDuty) continue;
    if (best < 0 || st.breakAt[m]! < st.breakAt[best]!) best = m;
  }
  return best;
}

describe('breaks', () => {
  it('keeps a relief on the desk during a break, for exactly the break length, and releases it after', () => {
    const { sim } = shiftSim();
    runTo(sim, 60);
    const st = sim.staff;
    const m = firstBreaker(sim);
    expect(m).toBeGreaterThanOrEqual(0);
    const desk = st.stIdx[m]!;
    const breakAt = st.breakAt[m]!;
    runTo(sim, breakAt - 100);
    let breakTicks = 0;
    let relief = -1;
    for (let t = breakAt - 100; t < breakAt + 90 * TICKS_PER_MINUTE; t++) {
      sim.step();
      expect(st.sPresent[desk]).toBeGreaterThan(0);
      if (st.state[m] === STAFF_STATE.Break) breakTicks++;
      if (relief < 0) for (let r = 0; r < st.hi; r++) if (st.covering[r] === m) relief = r;
    }
    expect(breakTicks).toBe(Math.ceil(STAFF.breaks.lengthMin * TICKS_PER_MINUTE));
    expect(relief).toBeGreaterThanOrEqual(0);
    expect(st.state[m]).toBe(STAFF_STATE.OnDuty);
    expect(st.stIdx[m]).toBe(desk);
    expect(st.state[relief]).toBe(STAFF_STATE.Standby);
    expect(st.covering[relief]).toBe(-1);
  }, 120_000);

  it('leaves the desk empty during a break when no relief is staffed', () => {
    const { sim } = shiftSim();
    expect(run(sim, { type: 'setStaffCap', role: 0, cap: 3 })).toEqual([]);
    const st = sim.staff;
    const m = firstBreaker(sim);
    expect(m).toBeGreaterThanOrEqual(0);
    const node = st.sNode[st.stIdx[m]!]!;
    const sn = sim.business.serviceNodes[0]!;
    runTo(sim, st.breakAt[m]!);
    let empty = false;
    for (let t = 0; t < 120 * TICKS_PER_MINUTE && !empty; t++) {
      sim.step();
      empty = st.state[m] === STAFF_STATE.Break && sn.staffFactor[node] === 0;
    }
    expect(empty).toBe(true);
  }, 120_000);

  it('works tired without a staff center', () => {
    const { sim } = shiftSim({ center: false });
    runTo(sim, 60);
    const st = sim.staff;
    const m = firstBreaker(sim);
    const node = st.sNode[st.stIdx[m]!]!;
    runTo(sim, st.breakAt[m]! + 100);
    expect(st.state[m]).toBe(STAFF_STATE.OnDuty);
    expect(st.flags[m]! & STAFF_FLAG.Tired).toBe(STAFF_FLAG.Tired);
    expect(sim.business.serviceNodes[0]!.staffFactor[node]).toBeCloseTo(staffSkill(st.seed[m]!) * STAFF.breaks.tiredSkill, 5);
  }, 120_000);

  it('restores a save taken during a break to an identical run', () => {
    const { sim } = shiftSim();
    runTo(sim, 60);
    const m = firstBreaker(sim);
    runTo(sim, sim.staff.breakAt[m]! + 40 * TICKS_PER_MINUTE);
    expect(sim.staff.state[m]).toBe(STAFF_STATE.Break);
    const copy = new SimClass(sim.seed, OPTIONS);
    copy.restore(JSON.parse(JSON.stringify(sim.serialize())));
    expect(copy.stateHash()).toBe(sim.stateHash());
    for (let t = 0; t < 2000; t++) {
      sim.step();
      copy.step();
    }
    expect(copy.stateHash()).toBe(sim.stateHash());
  }, 120_000);

  it('ends the cover when the member on break is freed, so a reused slot is never covered', () => {
    const { sim } = shiftSim();
    runTo(sim, 60);
    const st = sim.staff;
    const m = firstBreaker(sim);
    runTo(sim, st.breakAt[m]! + 100);
    let relief = -1;
    for (let r = 0; r < st.hi; r++) if (st.covering[r] === m) relief = r;
    expect(relief).toBeGreaterThanOrEqual(0);
    expect(st.state[relief]).toBe(STAFF_STATE.Commute);
    st.free(m);
    expect(st.covering[relief]).toBe(-1);
    expect(st.state[relief]).toBe(STAFF_STATE.Standby);
    expect(st.stIdx[relief]).toBe(-1);
    for (let r = 0; r < st.hi; r++) expect(st.covering[r]).not.toBe(m);
  }, 120_000);
});

describe('phase exit', () => {
  it('keeps every station staffed through the 14:00 shift change and counts the rosters', () => {
    const { sim, center } = shiftSim({ perHour: 4 });
    runTo(sim, at(13, 30));
    const st = sim.staff;
    const roster = (shift: number): number => membersOf(st, shift).length;
    const insBefore = st.clockIns.get(center) ?? 0;
    const outsBefore = st.clockOuts.get(center) ?? 0;
    const next = roster(1);
    const last = roster(0);
    for (let t = at(13, 30); t < at(14, 30); t += TICKS_PER_MINUTE) {
      runTo(sim, t);
      for (let s = 0; s < st.stCount; s++) expect(st.sPresent[s]).toBeGreaterThanOrEqual(1);
    }
    runTo(sim, at(14, 45));
    for (let s = 0; s < st.stCount; s++) expect(st.sPresent[s]).toBe(st.sNeed[s]);
    for (let m = 0; m < st.hi; m++) if (st.state[m] === STAFF_STATE.OnDuty) expect(st.shift[m]).toBe(1);
    expect((st.clockIns.get(center) ?? 0) - insBefore).toBe(next);
    expect((st.clockOuts.get(center) ?? 0) - outsBefore).toBe(last);
  }, 120_000);

  const WIDE = AIRCRAFT.findIndex((a) => a.id === 'a320neo');

  /** A small terminal with four arrivals of an A320 neo spread over the first day, security staffed under `cap` officers (-1 for no cap). */
  function trafficSim(cap: number): Sim {
    const sim = ownedSim();
    buildTestAirport(sim);
    expect(buildTestStaffCenter(sim)).toEqual([]);
    expect(buildTestTerminal(sim, { checkIn: 4, security: 1, gateDesk: 2 })).toEqual([]);
    run(sim, { type: 'signAirline', airlineId: 0, sign: true });
    if (cap >= 0) expect(run(sim, { type: 'setStaffCap', role: 1, cap })).toEqual([]);
    for (let i = 0; i < 4; i++) expect(sim.traffic.scheduleArrival(WIDE, sim.traffic.nowTick + 100 + i * 3000, 0, 6000, -1)).toBeGreaterThanOrEqual(0);
    return sim;
  }

  // Long on purpose (PITFALLS 18): the only test that runs to the first daily close, two sims of 54 001 ticks on a small terminal.
  it('lets no passenger through an unstaffed security lane and drops satisfaction and rating', () => {
    const open = trafficSim(-1);
    const shut = trafficSim(0);
    runTo(open, 54_001);
    runTo(shut, 54_001);
    expect(open.cohorts.boarded).toBeGreaterThan(0);
    expect(shut.cohorts.boarded).toBe(0);
    expect(shut.business.satisfaction).toBeLessThan(open.business.satisfaction);
    expect(shut.business.rating).toBeLessThan(open.business.rating);
  }, 300_000);

  it('serves at half the skill with one officer on a lane that needs two, and queues build up', () => {
    const open = trafficSim(-1);
    const one = trafficSim(1);
    const laneOf = (sim: Sim): number => {
      const sn = sim.business.serviceNodes[0]!;
      for (let k = 0; k < sn.count; k++) if (sn.kind[k] === FIXTURE_KEYS.indexOf('security') + 1) return k;
      return -1;
    };
    let queueOpen = 0;
    let queueOne = 0;
    for (let t = 0; t < 6000; t++) {
      open.step();
      one.step();
      queueOpen = Math.max(queueOpen, open.business.serviceNodes[0]!.queueLen[laneOf(open)]!);
      queueOne = Math.max(queueOne, one.business.serviceNodes[0]!.queueLen[laneOf(one)]!);
    }
    const st = one.staff;
    let officer = -1;
    for (let m = 0; m < st.hi; m++) if (st.role[m] === 1 && st.state[m] === STAFF_STATE.OnDuty && st.stIdx[m]! >= 0) officer = m;
    expect(officer).toBeGreaterThanOrEqual(0);
    expect(one.business.serviceNodes[0]!.staffFactor[laneOf(one)]).toBeCloseTo(staffSkill(st.seed[officer]!) / 2, 5);
    expect(queueOne).toBeGreaterThan(queueOpen);
  }, 120_000);

  it('is deterministic across the shift change, also across a save taken mid handover', () => {
    const a = shiftSim({ perHour: 4 }).sim;
    const b = shiftSim({ perHour: 4 }).sim;
    runTo(a, 26_000);
    runTo(b, 26_000);
    expect(a.stateHash()).toBe(b.stateHash());
    const c = shiftSim({ perHour: 4 }).sim;
    runTo(c, at(14) - 5 * TICKS_PER_MINUTE);
    const copy = new SimClass(c.seed, OPTIONS);
    copy.restore(JSON.parse(JSON.stringify(c.serialize())));
    expect(copy.stateHash()).toBe(c.stateHash());
    for (let t = 0; t < 2000; t++) {
      c.step();
      copy.step();
    }
    expect(copy.stateHash()).toBe(c.stateHash());
  }, 240_000);
});
