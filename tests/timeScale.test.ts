import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { Sim } from '@sim/sim';
import { AcState, FlState } from '@sim/ops/traffic';
import { migrate, SAVE_VERSION } from '@sim/save/migrations';
import { unpackTyped } from '@sim/save/pack';
import { dayIndex, minuteOfDay, START_MINUTE, TICKS_PER_DAY, TICKS_PER_MINUTE } from '@shared/business';
import { CLOCK_SCALE, gameSecondsToTicks, TICK_SECONDS, TICKS_PER_REAL_SECOND_AT_1X } from '@shared/time';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run } from './helpers';

const ATR = AIRCRAFT.findIndex((a) => a.id === 'atr72_600');
const WIDE = AIRCRAFT.findIndex((a) => a.role === 'widebody');
const GA = AIRCRAFT.findIndex((a) => a.role === 'ga');

describe('time scale', () => {
  it('keeps the physical tick and runs the calendar 12 times faster', () => {
    expect(TICK_SECONDS).toBe(0.1);
    expect(CLOCK_SCALE).toBe(12);
    expect(TICKS_PER_MINUTE).toBe(50);
    expect(TICKS_PER_DAY).toBe(72000);
  });

  it('plays motion at twice real time and one game day in 60 real minutes at speed 1', () => {
    expect(TICKS_PER_REAL_SECOND_AT_1X * TICK_SECONDS).toBe(2);
    expect(TICKS_PER_DAY / TICKS_PER_REAL_SECOND_AT_1X / 60).toBe(60);
  });

  it('starts the calendar at 06:00 on day 0 and turns the day after 18 game hours', () => {
    expect(minuteOfDay(0)).toBe(START_MINUTE);
    expect(dayIndex(0)).toBe(0);
    expect(dayIndex(18 * 60 * TICKS_PER_MINUTE - 1)).toBe(0);
    expect(dayIndex(18 * 60 * TICKS_PER_MINUTE)).toBe(1);
  });

  it('converts game clock seconds to ticks, at least one tick', () => {
    expect(gameSecondsToTicks(12)).toBe(10);
    expect(gameSecondsToTicks(600)).toBe(500);
    expect(gameSecondsToTicks(0.1)).toBe(1);
  });

  it('gives turnarounds of 45 to 180 game minutes by role', () => {
    const sim = ownedSim();
    expect(sim.traffic.turnaroundTicks(GA)).toBe(45 * TICKS_PER_MINUTE);
    expect(sim.traffic.turnaroundTicks(ATR)).toBe(75 * TICKS_PER_MINUTE);
    expect(sim.traffic.turnaroundTicks(WIDE)).toBe(180 * TICKS_PER_MINUTE);
  });

  it('two runs from one seed agree after 2000 ticks with a flight on the ground', () => {
    const make = (): number => {
      const sim = ownedSim();
      buildTestAirport(sim);
      buildTestTerminal(sim);
      sim.traffic.scheduleArrival(ATR, sim.traffic.nowTick + 100, 0, sim.traffic.turnaroundTicks(ATR), -1);
      for (let t = 0; t < 2000; t++) sim.step();
      return sim.stateHash();
    };
    expect(make()).toBe(make());
  });
});

describe('save migration to the faster calendar', () => {
  /** A save taken with one aircraft in turnaround and one flight still scheduled, relabelled as version 14 with old calendar waits. */
  function oldSave(): { data: Record<string, unknown>; tick: number; parked: number; waiting: number } {
    const sim = ownedSim();
    buildTestAirport(sim);
    run(sim, { type: 'setAutoStands', on: true });
    const parked = sim.traffic.scheduleArrival(ATR, sim.traffic.nowTick + 100, 0, 27000, -1);
    for (let t = 0; t < 20000 && sim.traffic.fState[parked] !== FlState.OnGround; t++) sim.step();
    expect(sim.traffic.fState[parked]).toBe(FlState.OnGround);
    const waiting = sim.traffic.scheduleArrival(ATR, sim.traffic.nowTick + 120000, 0, 27000, -1);
    const data = JSON.parse(JSON.stringify(sim.serialize())) as Record<string, unknown>;
    data.version = 14;
    return { data, tick: sim.tick, parked, waiting };
  }

  it('shortens pending arrivals, turnaround lengths and turnaround timers by 12', () => {
    const { data, tick, parked, waiting } = oldSave();
    const before = (data.traffic as { arrays: Record<string, string> }).arrays;
    const timerBefore = unpackTyped(before.timer, Int32Array);
    const stateBefore = unpackTyped(before.state, Uint8Array);
    const ac = stateBefore.findIndex((s) => s === AcState.Turnaround);
    expect(ac).toBeGreaterThanOrEqual(0);
    const out = migrate(data);
    expect(out.version).toBe(SAVE_VERSION);
    const after = (out.traffic as { arrays: Record<string, string> }).arrays;
    const eta = unpackTyped(after.fEta, Int32Array);
    const turn = unpackTyped(after.fTurn, Int32Array);
    expect(eta[waiting]).toBe(tick + 10000);
    expect(eta[parked]).toBeLessThanOrEqual(tick);
    expect(turn[parked]).toBe(2250);
    expect(turn[waiting]).toBe(2250);
    expect(unpackTyped(after.timer, Int32Array)[ac]).toBe(Math.round(timerBefore[ac] / 12));
  });

  it('shortens running works and leaves finished ones alone', () => {
    const { data, tick } = oldSave();
    const af = data.airfield as { runways: { works?: { doneTick: number } }[]; taxiways: { works?: { doneTick: number } }[] };
    af.runways[0].works = { doneTick: tick + 864000 };
    af.taxiways[0].works = { doneTick: tick - 5 };
    migrate(data);
    expect(af.runways[0].works.doneTick).toBe(tick + 72000);
    expect(af.taxiways[0].works.doneTick).toBe(tick - 5);
  });

  it('restores a migrated save and the parked aircraft departs', () => {
    const { data, parked } = oldSave();
    const sim = new Sim('GOLDEN-0001', OPTIONS);
    sim.restore(data as never);
    for (let t = 0; t < 6000 && sim.traffic.fState[parked] !== FlState.Departing && sim.traffic.fState[parked] !== FlState.Done; t++) sim.step();
    expect([FlState.Departing, FlState.Done]).toContain(sim.traffic.fState[parked]);
  });
});
