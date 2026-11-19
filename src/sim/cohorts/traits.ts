import { NEEDS, PROFILES } from '@data/index';
import { NEED_KEYS } from '@data/schemas/needs';
import { PROFILE_KEYS } from '@data/schemas/profiles';
import { FIXTURE_KEYS, TICKS_PER_MINUTE } from '@shared/business';

/**
 * Member traits are a pure integer hash of the member seed (docs/DESIGN_REVISION_4.md 6.2), never drawn from an
 * rng stream, so reading a trait cannot shift any stream and a saved seed regenerates the same member.
 */

/** Murmur3 finaliser: a bijective 32 bit mix. */
export function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Seed of member `index` of a cohort with `cohortSeed`. */
export function memberSeedOf(cohortSeed: number, index: number): number {
  return mix32((cohortSeed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0);
}

/** Uniform float in [0, 1) for trait slot `k` of a member seed. */
export function traitU(seed: number, k: number): number {
  return mix32((seed + Math.imul(k + 1, 0x85ebca6b)) >>> 0) / 4294967296;
}

/** Cohort level draws of the arrival journey (T20): pure draws from the recipe seed through traitU, in slots past the member trait slots. */
export const COHORT_DRAW = { Referral: 10, Red: 11 } as const;

/** Slots of the trait vector. Slots 0 to 3 are the need factors of hunger, thirst, toilet and rest. */
export const TRAIT = { Hunger: 0, Thirst: 1, Toilet: 2, Rest: 3, Desire: 4, Budget: 5, Fav1: 6, Fav2: 7, GateLeadMin: 8, Slow: 9 } as const;
export const TRAIT_COUNT = 10;

const PROFILE_SPEND = Float64Array.from(PROFILE_KEYS, (k) => PROFILES.profiles[k].spend);
/** Fixture ids (index + 1 in FIXTURE_KEYS) of the shop categories a member can favour. */
const CATEGORY_IDS = Int32Array.from(NEEDS.shop.categories, (name) => FIXTURE_KEYS.indexOf(name) + 1);

const lerp = (r: { min: number; max: number }, u: number): number => r.min + (r.max - r.min) * u;

/** Fills TRAIT_COUNT entries of `out` for a member. */
// hot
export function writeTraits(seed: number, profile: number, out: Float64Array): void {
  for (let k = 0; k < 4; k++) out[k] = lerp(NEEDS.factor, traitU(seed, k));
  out[TRAIT.Desire] = traitU(seed, 4);
  out[TRAIT.Budget] = PROFILE_SPEND[profile] * lerp(NEEDS.budget, traitU(seed, 5));
  const n = CATEGORY_IDS.length;
  const fav1 = Math.floor(traitU(seed, 6) * n);
  const fav2 = (fav1 + 1 + Math.floor(traitU(seed, 7) * (n - 1))) % n;
  out[TRAIT.Fav1] = CATEGORY_IDS[fav1];
  out[TRAIT.Fav2] = CATEGORY_IDS[fav2];
  out[TRAIT.GateLeadMin] = lerp(NEEDS.gateLeadMin, traitU(seed, 8));
  out[TRAIT.Slow] = traitU(seed, 9) < NEEDS.mobility.share ? 1 : 0;
}

/** Threshold in hours by need id; the shop want (the last id) does not grow. */
const THRESHOLD_H = Float64Array.from(NEED_KEYS, (key) => (key === 'shop' ? 0 : NEEDS.needs[key].thresholdH));

/** Level units a need grows per tick, where 1 000 is its threshold; 0 for the shop want. */
export function needRatePerTick(need: number, factor: number): number {
  const h = THRESHOLD_H[need];
  return h === 0 ? 0 : (1000 * factor) / (h * 60 * TICKS_PER_MINUTE);
}
