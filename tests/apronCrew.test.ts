import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { STAFF } from '@data/index';
import { STAFF_ROLE_KEYS } from '@data/schemas/staff';
import { AcState } from '@sim/ops/traffic';
import { Sim } from '@sim/sim';
import { STAFF_STATE } from '@sim/staff/staff';
import { SnapHeader, STAFF_PROFILE_BASE, createSnapshotBuffer, createSnapshotViews } from '@shared/snapshot';
import { ACCEPT_COMMERCIAL } from '@shared/airfield';
import { CAUSE_RAMP } from '@shared/turnaround';
import { buildTestAirport, OPTIONS, ownedSim, run } from './helpers';

const A320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');
const RAMP = STAFF_ROLE_KEYS.indexOf('ramp');
const CHOCKS = 0;

function crewSim(seed?: string, ground = true): Sim {
  const sim = ownedSim(seed);
  buildTestAirport(sim, { standsPerRow: 4, ground });
  sim.step();
  return sim;
}

function untilDocked(sim: Sim, f: number): number {
  for (let t = 0; t < 40000; t++) {
    sim.step();
    const a = sim.traffic.fAc[f];
    if (a >= 0 && sim.traffic.state[a] === AcState.Turnaround) return a;
  }
  throw new Error('flight never docked');
}

const arrival = (sim: Sim): number => sim.traffic.scheduleArrival(A320, sim.tick + 1, 0, sim.traffic.turnaroundTicks(A320), 0);

describe('apron crews (T81)', () => {
  it('pools crewSize ramp staff per commercial stand with a road at the depot, on three shifts', () => {
    const sim = crewSim();
    const st = sim.staff;
    expect(st.rampStation).toBeGreaterThanOrEqual(0);
    const commercial = sim.airfield.data.stands.filter((s, i) => sim.roads.standRoad[i] === 1 && (s.accepts & ACCEPT_COMMERCIAL) !== 0).length;
    expect(commercial).toBeGreaterThan(0);
    const need = STAFF.ramp.crewSize * commercial;
    expect(st.sNeed[st.rampStation]).toBe(need);
    expect(st.hired(RAMP)).toBe(3 * (need + Math.ceil(STAFF.reliefShare * need)));
    expect(st.rampCrews()).toBe(commercial);
    for (let m = 0; m < st.hi; m++) if (st.role[m] === RAMP && st.stIdx[m] === st.rampStation && st.shift[m] === 0) expect(st.state[m]).toBe(STAFF_STATE.OnDuty);
  });

  it('needs no crew without a depot', () => {
    const sim = crewSim(undefined, false);
    expect(sim.staff.rampStation).toBe(-1);
    expect(sim.staff.rampCrews()).toBe(-1);
    const a = untilDocked(sim, arrival(sim));
    for (let t = 0; t < 200; t++) sim.step();
    expect(sim.turns.crew[a]).toBe(0);
    expect(sim.turns.phase[a * 12 + CHOCKS]).toBeGreaterThan(0);
  });

  it('holds a crew from chocks to door close and draws it at the aircraft', () => {
    const sim = crewSim();
    const a = untilDocked(sim, arrival(sim));
    for (let t = 0; t < 50; t++) sim.step();
    expect(sim.turns.crew[a]).toBe(1);
    const views = createSnapshotViews(createSnapshotBuffer());
    sim.writeSnapshot(views);
    let crew = 0;
    for (let i = 0; i < views.header[SnapHeader.PeopleCount]!; i++) {
      if (views.peopleProfile[i] !== STAFF_PROFILE_BASE + RAMP) continue;
      crew++;
      expect(Math.hypot(views.peopleX[i]! - sim.traffic.x[a]!, views.peopleY[i]! - sim.traffic.y[a]!)).toBeLessThan(AIRCRAFT[A320]!.dimensions.lengthM);
    }
    expect(crew).toBe(STAFF.ramp.crewSize);
    for (let t = 0; t < 40000 && sim.traffic.state[a] === AcState.Turnaround; t++) sim.step();
    expect(sim.turns.crew[a]).toBe(0);
  }, 60000);

  it('waits at chocks for a ramp crew owned by the airport when the cap is 0, and runs once crews are hired', () => {
    const sim = crewSim();
    expect(run(sim, { type: 'setStaffCap', role: RAMP, cap: 0 })).toEqual([]);
    // Members already on site work to the end of their shift; free them so the pool is empty now.
    for (let m = sim.staff.hi - 1; m >= 0; m--) if (sim.staff.role[m] === RAMP && sim.staff.state[m] !== STAFF_STATE.Free) sim.staff.free(m);
    sim.staff.refresh();
    expect(sim.staff.rampCrews()).toBe(0);
    const a = untilDocked(sim, arrival(sim));
    for (let t = 0; t < 600; t++) sim.step();
    expect(sim.turns.crew[a]).toBe(0);
    expect(sim.turns.phase[a * 12 + CHOCKS]).toBe(0);
    expect(sim.turns.blocker(a)).toBe(CAUSE_RAMP);
    expect(run(sim, { type: 'setStaffCap', role: RAMP, cap: -1 })).not.toContain('badStaffCap');
    for (let t = 0; t < 600; t++) sim.step();
    expect(sim.turns.crew[a]).toBe(1);
    expect(sim.turns.phase[a * 12 + CHOCKS]).toBeGreaterThan(0);
  }, 60000);

  it('loads a version 36 save, from before crews, with no crew held and turnarounds that go on', () => {
    const sim = crewSim('CREW-0002');
    const a = untilDocked(sim, arrival(sim));
    for (let t = 0; t < 100; t++) sim.step();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as { version: number; turnarounds: { arrays: Record<string, string> } };
    data.version = 36;
    delete data.turnarounds.arrays.crew;
    const b = new Sim('CREW-0002', OPTIONS);
    b.restore(data);
    expect(b.turns.crew[a]).toBe(0);
    for (let t = 0; t < 40000 && b.traffic.state[a] === AcState.Turnaround; t++) b.step();
    expect(b.traffic.state[a]).not.toBe(AcState.Turnaround);
  }, 60000);

  it('two sims from one seed agree over 2000 ticks, and a restore mid turnaround replays the same', () => {
    const go = (): Sim => {
      const sim = crewSim('CREW-0001');
      untilDocked(sim, arrival(sim));
      for (let t = 0; t < 100; t++) sim.step();
      return sim;
    };
    const a = go();
    const b = go();
    const c = new Sim('CREW-0001', OPTIONS);
    c.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(c.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
      c.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
    expect(c.stateHash()).toBe(a.stateHash());
  }, 60000);
});
