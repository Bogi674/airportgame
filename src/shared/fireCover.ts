import { GROUND } from '@data/index';
import type { AirfieldPayload, Building } from './airfield';

/**
 * Rescue and fire fighting cover (T65, D21, docs/GAME_DESIGN.md section 10, user 2026-11-18). A station's
 * category follows its fire vehicles, it covers a runway when both ends lie within the response time at
 * the response speed, and the airport category is the weakest runway's best cover.
 */

const FIRE = GROUND.fire;
/** Straight line reach of the response limit, in meters. */
export const FIRE_REACH_M = (FIRE.responseS * FIRE.speedKmh) / 3.6;

/** Category a station reaches with its vehicles: the highest one whose vehicle count it meets, 0 without vehicles. */
export function stationCategory(b: Pick<Building, 'fireVehicles'>): number {
  const n = b.fireVehicles ?? 0;
  let cat = 0;
  for (const c of FIRE.categories) if (n >= c.vehicles) cat = Math.max(cat, c.category);
  return cat;
}

/** Category an aircraft of this length needs. */
export function neededCategory(lengthM: number): number {
  for (const c of FIRE.categories) if (lengthM <= c.maxLengthM) return c.category;
  return FIRE.categories[FIRE.categories.length - 1].category;
}

/** The airport's fire category: over every runway, the best station covering both its ends; the weakest runway counts. */
export function airportFireCategory(af: AirfieldPayload): number {
  if (af.runways.length === 0) return 0;
  const stations = (af.buildings ?? []).filter((b) => b.kind === 'fire');
  let worst = Infinity;
  for (const r of af.runways) {
    let best = 0;
    for (const s of stations) {
      const reach = (x: number, y: number): boolean => (x - s.x) ** 2 + (y - s.y) ** 2 <= FIRE_REACH_M * FIRE_REACH_M;
      if (reach(r.x1, r.y1) && reach(r.x2, r.y2)) best = Math.max(best, stationCategory(s));
    }
    worst = Math.min(worst, best);
  }
  return worst;
}
