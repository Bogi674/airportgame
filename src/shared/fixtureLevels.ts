import { BUSINESS } from '@data/index';
import type { FixtureKey } from './business';

/** Fixtures that come in levels 1 to 3 with the same footprint and upgrade in place (T74). */
export const LEVELED_KEYS = ['checkIn', 'security', 'passport', 'gateDesk'] as const;
export type LeveledKey = (typeof LEVELED_KEYS)[number];
export const MAX_FIXTURE_LEVEL = 3;

export const isLeveled = (key: FixtureKey): key is LeveledKey => (LEVELED_KEYS as readonly FixtureKey[]).includes(key);

const clampLevel = (level: number): number => Math.min(Math.max(level, 1), MAX_FIXTURE_LEVEL);

/** Build cost of a leveled fixture at a level. */
export const levelCost = (key: LeveledKey, level: number): number => BUSINESS.fixtureLevels[key].cost[clampLevel(level) - 1];

/** Price of raising a fixture from one level to the next: the difference of the two build costs. */
export const upgradeCost = (key: LeveledKey, from: number): number => levelCost(key, from + 1) - levelCost(key, from);

/** Game days a fixture is closed while it is upgraded. */
export const upgradeDays = (key: LeveledKey): number => BUSINESS.fixtureLevels[key].worksDays;

/** Mean service seconds of levels 2 and 3. Level 1 keeps the module and mode values of the data. */
export const levelServiceSeconds = (key: LeveledKey, level: number): number => BUSINESS.fixtureLevels[key].serviceSeconds[clampLevel(level) - 1];

/** A fixture under upgrade works: the anchor cell in logical coordinates, the level it reaches and when. */
export interface FixtureWorks {
  building: number;
  floor: number;
  x: number;
  y: number;
  from: number;
  to: number;
  cost: number;
  doneTick: number;
}
