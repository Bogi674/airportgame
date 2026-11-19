import { describe, expect, it } from 'vitest';
import { TICKS_PER_MINUTE } from '@shared/business';
import type { Sim } from '@sim/sim';
import { STAFF_STATE, type Staff } from '@sim/staff/staff';
import { buildTestAirport, buildTestStaffCenter, buildTestTerminal, ownedSim, run } from './helpers';

const HOUR = 60 * TICKS_PER_MINUTE;
/** The game starts at 06:00, so a clock time is this many hours past tick 0. */
const at = (hour: number, minute = 0): number => (hour - 6) * HOUR + minute * TICKS_PER_MINUTE;

function shiftSim(o: { center?: boolean; closedDesk?: boolean } = {}): { sim: Sim; center: number } {
  const sim = ownedSim();
  buildTestAirport(sim);
  expect(run(sim, { type: 'setTestTraffic', perHour: 0, turnScale: 1 })).toEqual([]);
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
    expect(next).toHaveLength(7);
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
    expect(st.clockIns.get(center)).toBe(7);
    expect(st.clockOuts.get(center)).toBe(7);
  }, 120_000);

  it('works without a staff center, with every event counted under -1', () => {
    const { sim } = shiftSim({ center: false });
    runTo(sim, at(14, 45));
    const st = sim.staff;
    for (let s = 0; s < st.stCount; s++) expect(st.sPresent[s]).toBe(st.sNeed[s]);
    expect(st.clockIns.get(-1)).toBe(7);
    expect(st.clockOuts.get(-1)).toBe(7);
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
