import { describe, expect, it } from 'vitest';
import profilesJson from '../src/data/profiles.json';
import { PROFILE_KEYS, profilesSchema } from '../src/data/schemas/profiles';
import { PROFILES } from '../src/data';

function withLeisureMix(mix: number): unknown {
  const copy = structuredClone(profilesJson);
  copy.profiles.leisure.mix = mix;
  return copy;
}

describe('passenger profiles data', () => {
  it('parses', () => {
    expect(PROFILES.capacity).toBe(200000);
  });

  it('has six profiles in PROFILE_KEYS order', () => {
    expect(PROFILE_KEYS).toEqual(['business', 'leisure', 'family', 'budget', 'premium', 'crew']);
    expect(Object.keys(PROFILES.profiles)).toEqual([...PROFILE_KEYS]);
  });

  it('mix sums to 1', () => {
    const sum = PROFILE_KEYS.reduce((acc, k) => acc + PROFILES.profiles[k].mix, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-6);
  });

  it('rejects a copy whose mix sums to 0.9', () => {
    expect(profilesSchema.safeParse(withLeisureMix(0.3)).success).toBe(false);
  });

  it('rejects an unknown profile key', () => {
    const copy = structuredClone(profilesJson) as { profiles: Record<string, unknown> };
    copy.profiles.vip = { ...(profilesJson.profiles.business) };
    expect(profilesSchema.safeParse(copy).success).toBe(false);
  });
});
