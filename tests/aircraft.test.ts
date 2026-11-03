import { describe, expect, it } from 'vitest';
import { acr, AIRCRAFT, approachFromVref, codeFromSpan, SPRITE_BASES, wakeFromMtow, wakeSeparationSec } from '@data/aircraft';

describe('aircraft data', () => {
  it('loads the 10 MVP 1 types', () => {
    expect(AIRCRAFT.map((a) => a.id).sort()).toEqual(['a320neo', 'atr72_600', 'b737_800', 'b777_300er', 'b787_9', 'c172s', 'c208b', 'crj900', 'dash8_q400', 'kingair_360']);
  });

  it('derived code, wake and approach category match the data file for every type', () => {
    for (const a of AIRCRAFT) {
      expect(codeFromSpan(a.dimensions.wingspanM), a.id).toBe(a.derivedForReading.code);
      expect(wakeFromMtow(a.weights.mtowKg), a.id).toBe(a.derivedForReading.wake);
      expect(approachFromVref(a.performance.vrefKt), a.id).toBe(a.derivedForReading.approachCategory);
    }
  });

  it('every type has a sprite base with matching length', () => {
    for (const a of AIRCRAFT) {
      const base = SPRITE_BASES[a.sprite.base];
      expect(base, a.id).toBeDefined();
      expect(Math.abs(base.L - a.dimensions.lengthM) / a.dimensions.lengthM, a.id).toBeLessThan(0.05);
    }
  });

  it('pavement load grows with weight', () => {
    const by = (id: string) => AIRCRAFT.find((a) => a.id === id)!;
    expect(acr(by('c172s'), 'asphalt')).toBeLessThan(acr(by('a320neo'), 'asphalt'));
    expect(acr(by('a320neo'), 'asphalt')).toBeLessThan(acr(by('b777_300er'), 'asphalt'));
    expect(acr(by('a320neo'), 'concrete')).toBeCloseTo(acr(by('a320neo'), 'asphalt') * 1.1, 6);
  });

  it('wake separation grows with the leader category', () => {
    expect(wakeSeparationSec('H', 'L')).toBeGreaterThan(wakeSeparationSec('M', 'L'));
    expect(wakeSeparationSec('L', 'H')).toBe(0);
  });
});
