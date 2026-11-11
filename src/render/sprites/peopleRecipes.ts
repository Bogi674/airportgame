import { PEOPLE } from '@data/index';

/** Number of passenger recipes in people.json. */
export const RECIPE_COUNT = 30;

const PROFILE_COUNT = PEOPLE.profiles.length;

/** Cumulative weights per profile, row major: entry profile * RECIPE_COUNT + recipe. */
const MAX_COLUMN_TOTAL = 65535;

const CUMULATIVE = buildCumulative();

function buildCumulative(): Uint16Array {
  const table = new Uint16Array(PROFILE_COUNT * RECIPE_COUNT);
  for (let profile = 0; profile < PROFILE_COUNT; profile++) {
    let running = 0;
    for (let recipe = 0; recipe < RECIPE_COUNT; recipe++) {
      running += PEOPLE.recipes[recipe]?.weights[profile] ?? 0;
      table[profile * RECIPE_COUNT + recipe] = running;
    }
    if (running === 0 || running > MAX_COLUMN_TOTAL) {
      throw new Error(`people profile ${profile} weight total ${running} must be 1 to ${MAX_COLUMN_TOTAL}`);
    }
  }
  return table;
}

/** Hashes a seed and a member index to a uint32. Same inputs always give the same output. */
export function memberHash(seed: number, member: number): number {
  let h = (seed ^ Math.imul(member + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Picks a recipe index (0..29) for one member of a cohort by weighted lookup.
 * Recipes with weight 0 for the profile are never returned. An unknown profile uses profile 0.
 */
export function pickRecipe(profile: number, seed: number, member: number): number {
  const column = Number.isInteger(profile) && profile >= 0 && profile < PROFILE_COUNT ? profile : 0;
  const base = column * RECIPE_COUNT;
  const total = CUMULATIVE[base + RECIPE_COUNT - 1] ?? 0;
  const roll = memberHash(seed, member) % total;
  for (let recipe = 0; recipe < RECIPE_COUNT; recipe++) {
    if (roll < (CUMULATIVE[base + recipe] ?? 0)) return recipe;
  }
  return RECIPE_COUNT - 1;
}
