import { STAFF } from '@data/index';
import { mix32, traitU } from '../cohorts/traits';

/**
 * Staff traits are a pure integer hash of the staff seed, never drawn from an rng stream, like cohort member
 * traits (T68 decisions 1 and 10).
 */

/** Seed of the staff member hired with the given serial number. */
export function staffSeed(serial: number): number {
  return mix32(Math.imul(serial + 1, 0x9e3779b9) >>> 0);
}

/** Service speed multiplier of a member, within STAFF.skill. */
export function staffSkill(seed: number): number {
  return STAFF.skill.min + (STAFF.skill.max - STAFF.skill.min) * traitU(seed, 0);
}

/** Extra minutes added to the first break time of a member, 0 to STAFF.breaks.jitterMin. */
export function breakJitterMin(seed: number): number {
  return Math.floor(traitU(seed, 1) * (STAFF.breaks.jitterMin + 1));
}
