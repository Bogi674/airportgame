import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { maxStageKm, requiredTakeoffM, takeoffWeight } from '@sim/ops/performance';
import { TICKS_PER_DAY } from '@shared/business';
import { buildArrivalTerminal, buildTestAirport, ownedSim } from './helpers';

const spec = (id: string) => AIRCRAFT[AIRCRAFT.findIndex((a) => a.id === id)];
const climate = { tempMaxC: 25, elevationM: 100 } as never;

describe('payload and range', () => {
  it('longer stages are heavier and need more runway', () => {
    const a = spec('a320neo');
    const short = takeoffWeight(a, 400, 0.8);
    const long = takeoffWeight(a, 2500, 0.8);
    expect(long.share).toBeGreaterThan(short.share);
    expect(requiredTakeoffM(a, climate, 1, long.share)).toBeGreaterThan(requiredTakeoffM(a, climate, 1, short.share));
  });

  it('payload is cut when the aircraft would exceed its maximum takeoff weight', () => {
    const a = spec('b777_300er');
    const full = takeoffWeight(a, maxStageKm(a), 1);
    expect(full.share).toBeLessThanOrEqual(1);
    expect(full.payloadFactor).toBeLessThanOrEqual(1);
    const light = takeoffWeight(a, 500, 0.5);
    expect(light.payloadFactor).toBe(1);
  });

  it('a stage never exceeds 85 percent of the range', () => {
    for (const a of AIRCRAFT) expect(maxStageKm(a)).toBeLessThanOrEqual(Math.floor(a.performance.rangeKm * 0.85));
  });
});

describe('arrival numbers in the business payload (T20)', () => {
  const A320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');

  function hall(): ReturnType<typeof ownedSim> {
    const sim = ownedSim();
    sim.cash = 1_000_000_000;
    buildTestAirport(sim, { standsPerRow: 8 });
    expect(buildArrivalTerminal(sim)).toEqual([]);
    return sim;
  }

  it('after a day with an arrival arrDay lists four numbers and the first is above zero', () => {
    const sim = hall();
    expect(sim.business.payload(sim.traffic.nowTick).arrDay).toEqual([]);
    const f = sim.traffic.scheduleArrival(A320, sim.traffic.nowTick + 100, 0, 600, -1);
    sim.traffic.fStand[f] = sim.airfield.data.stands[0]!.id;
    for (let t = 0; t < 30000 && (sim.cohorts.arrGenerated === 0 || sim.cohorts.arrActive > 0); t++) sim.step();
    expect(sim.cohorts.arrExited).toBeGreaterThan(0);
    (sim.business as unknown as { dailyClose(tick: number): void }).dailyClose(sim.tick + TICKS_PER_DAY);
    const day = sim.business.payload(sim.traffic.nowTick).arrDay;
    expect(day).toHaveLength(4);
    expect(day[0]).toBeGreaterThan(0);
  });

  it('marks the board row of an international flight and not that of a domestic one', () => {
    const sim = hall();
    const market = sim.business.market;
    const dest = market.destinations.find((d) => d.international)!;
    market.series.push({ id: 9001, airline: 0, dest: dest.id, typeIdx: A320, days: 127, winMin: 0, startDay: 0, endDay: 100, standId: -1, minute: -1, turnMin: 30 });
    const intl = sim.traffic.scheduleArrival(A320, sim.traffic.nowTick + 5000, 0, 600, -1, 0, 9001);
    const home = sim.traffic.scheduleArrival(A320, sim.traffic.nowTick + 6000, 0, 600, -1);
    const board = sim.business.payload(sim.traffic.nowTick).board;
    expect(board.find((r) => r.flight === intl)?.intl).toBe(true);
    expect(board.find((r) => r.flight === home)?.intl).toBe(false);
  });
});
