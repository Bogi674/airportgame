import { describe, expect, it } from 'vitest';
import { AIRFIELD } from '@data/index';
import { TICKS_PER_DAY } from '@shared/business';
import { runwayWorksDays } from '@shared/surfaceRules';
import { buildTestAirport, ownedSim, run } from './helpers';

describe('runway works', () => {
  it('days grow with the pavement that changes and with a new approach type', () => {
    const sim = ownedSim();
    buildTestAirport(sim);
    const r = sim.airfield.data.runways[0];
    expect(runwayWorksDays(r, {})).toBe(0);
    const short = runwayWorksDays(r, { lengthDeltaM: 200 });
    const long = runwayWorksDays(r, { lengthDeltaM: 800 });
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
    const vis = { ...r, approach: 'visual' as const };
    expect(runwayWorksDays(vis, { approach: 'precision' })).toBe(AIRFIELD.runwayWorks.approachDays.precision);
  });

  it('an extension closes the runway for the shown days, then it opens again', () => {
    const sim = ownedSim();
    buildTestAirport(sim);
    const before = { ...sim.airfield.data.runways[0] };
    const days = runwayWorksDays(before, { lengthDeltaM: 300 });
    const tick = sim.tick;
    expect(run(sim, { type: 'resizeRunway', id: 1, end: 'b', deltaM: 300 })).toEqual([]);
    const r = sim.airfield.data.runways[0];
    expect(r.works?.doneTick).toBe(tick + days * TICKS_PER_DAY);
    sim.airfield.update(r.works?.doneTick ?? 0);
    expect(sim.airfield.data.runways[0].works).toBeUndefined();
  });

  it('a closed runway takes no arrivals or departures', () => {
    const open = ownedSim();
    buildTestAirport(open);
    run(open, { type: 'setTestTraffic', perHour: 30, turnScale: 0.2 });
    const shut = ownedSim();
    buildTestAirport(shut);
    run(shut, { type: 'reclassRunway', id: 1, code: 'C', approach: 'nonPrecision' });
    expect(shut.airfield.data.runways[0].works).toBeDefined();
    run(shut, { type: 'setTestTraffic', perHour: 30, turnScale: 0.2 });
    for (let i = 0; i < 24000; i++) {
      open.step();
      shut.step();
    }
    expect(open.traffic.completedFlights).toBeGreaterThan(0);
    expect(shut.traffic.completedFlights).toBe(0);
    expect(shut.traffic.count).toBe(0);
  });
});
