import { BUSINESS } from '@data/index';
import type { AirfieldPayload } from './airfield';

/**
 * The ATC tower ladder (handoff/tasks/T40-atc-tower.md, "Numbers"): movements per rolling hour
 * per runway and the runway count limit, read from `business.json` once and shared by the sim,
 * the renderer and the UI so they cannot disagree.
 */

export interface TowerCapacity {
  hasTower: boolean;
  /** Highest tower level on the airfield, 0 without a tower. */
  level: number;
  /** Movements per rolling hour per runway. */
  perHour: number;
  /** Movements per rolling hour across every runway. */
  total: number;
}

/** Highest tower level on the airfield, or 0 when no tower stands. More than one tower is allowed and the highest counts. */
export function towerLevelOf(af: Pick<AirfieldPayload, 'towers'>): number {
  let level = 0;
  for (const t of af.towers ?? []) if (t.level > level) level = t.level;
  return level;
}

/** Movements per rolling hour per runway at a level, 0 without a tower. Levels above the ladder clamp to the top. */
export function movementsPerHour(level: number): number {
  if (level < 1) return 0;
  const levels = BUSINESS.tower.levels;
  return levels[Math.min(level, levels.length) - 1].movementsPerHour;
}

/** Runway cap at a level. -1 means unlimited, which also covers the no tower case, because a runway comes before the tower. */
export function runwayCapOf(level: number): number {
  if (level < 1) return -1;
  const levels = BUSINESS.tower.levels;
  return levels[Math.min(level, levels.length) - 1].maxRunways;
}

/** The cheapest level whose cap allows this many runways. */
export function levelForRunways(n: number): number {
  const levels = BUSINESS.tower.levels;
  for (let i = 0; i < levels.length; i++) {
    const cap = levels[i].maxRunways;
    if (cap === -1 || cap >= n) return i + 1;
  }
  return levels.length;
}

/** What the tower allows on the site: its level, the per runway budget and the total budget. */
export function towerCapacity(af: Pick<AirfieldPayload, 'towers' | 'runways'>): TowerCapacity {
  const level = towerLevelOf(af);
  const perHour = movementsPerHour(level);
  return { hasTower: level > 0, level, perHour, total: perHour * af.runways.length };
}
