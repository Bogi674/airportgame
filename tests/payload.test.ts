import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { maxStageKm, requiredTakeoffM, takeoffWeight } from '@sim/ops/performance';

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
