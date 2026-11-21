import { describe, expect, it } from 'vitest';
import { NEEDS } from '@data/index';
import { TICKS_PER_MINUTE } from '@shared/business';
import { TRAIT, TRAIT_COUNT, memberSeedOf, needRatePerTick, traitU, writeTraits } from '@sim/cohorts/traits';

describe('member traits', () => {
  it('same seed and profile give identical traits', () => {
    const a = new Float64Array(TRAIT_COUNT);
    const b = new Float64Array(TRAIT_COUNT);
    writeTraits(123456, 1, a);
    writeTraits(123456, 1, b);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('member seeds differ per index', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 6; i++) seeds.add(memberSeedOf(987654321, i));
    expect(seeds.size).toBe(6);
  });

  it('keeps ranges and shares from data over 10 000 seeds', () => {
    const t = new Float64Array(TRAIT_COUNT);
    let factorSum = 0;
    let slow = 0;
    for (let s = 0; s < 10000; s++) {
      const seed = memberSeedOf(s * 7919 + 1, s % 6);
      writeTraits(seed, s % 3, t);
      for (let k = 0; k < 4; k++) {
        expect(t[k]).toBeGreaterThanOrEqual(NEEDS.factor.min);
        expect(t[k]).toBeLessThanOrEqual(NEEDS.factor.max);
        factorSum += t[k];
      }
      expect(t[TRAIT.Fav1]).not.toBe(t[TRAIT.Fav2]);
      expect(t[TRAIT.GateLeadMin]).toBeGreaterThanOrEqual(NEEDS.gateLeadMin.min);
      expect(t[TRAIT.GateLeadMin]).toBeLessThanOrEqual(NEEDS.gateLeadMin.max);
      slow += t[TRAIT.Slow];
    }
    expect(Math.abs(factorSum / 40000 - 1)).toBeLessThan(0.01);
    expect(Math.abs(slow / 10000 - NEEDS.mobility.share)).toBeLessThan(0.01);
    expect(traitU(5, 0)).toBeGreaterThanOrEqual(0);
    expect(traitU(5, 0)).toBeLessThan(1);
  });

  it('hunger at factor 1 reaches 1000 after its threshold hours of ticks', () => {
    const ticks = NEEDS.needs.hunger.thresholdH * 60 * TICKS_PER_MINUTE;
    const level = needRatePerTick(0, 1) * ticks;
    expect(Math.abs(level - 1000) / 1000).toBeLessThan(1e-9);
    expect(needRatePerTick(4, 1)).toBe(0);
  });
});
