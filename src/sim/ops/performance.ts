import { acr, type AircraftSpec } from '@data/aircraft';
import type { Runway, Surface } from '@shared/airfield';
import type { Climate } from '@shared/site';

/** Typical share of MTOW at departure and of MLW at landing until routes decide the real weight. */
const DEFAULT_TAKEOFF_WEIGHT = 0.9;
const DEFAULT_LANDING_WEIGHT = 0.85;

/** Required takeoff run in meters (docs/GAME_DESIGN.md section 5). */
export function requiredTakeoffM(a: AircraftSpec, climate: Climate, windBandFactor: number): number {
  const temp = 1 + (0.07 * (climate.tempMaxC - 15)) / 10;
  const alt = 1 + (0.07 * climate.elevationM) / 300;
  const weight = DEFAULT_TAKEOFF_WEIGHT * DEFAULT_TAKEOFF_WEIGHT;
  return a.performance.takeoffFieldM * Math.max(0.8, temp) * alt * weight * windBandFactor;
}

export function requiredLandingM(a: AircraftSpec, windBandFactor: number): number {
  return a.performance.landingFieldM * DEFAULT_LANDING_WEIGHT * DEFAULT_LANDING_WEIGHT * windBandFactor;
}

export type Limit =
  | { ok: true }
  | { ok: false; reason: 'surface' | 'strength' | 'landingLength' | 'takeoffLength'; needed: number; available: number };

/** Can this type use a pavement surface and strength at all? Up to 10 percent overload is allowed. */
export function checkPavement(a: AircraftSpec, surface: Surface, pcr: number): Limit {
  if (!a.surfaces.includes(surface)) return { ok: false, reason: 'surface', needed: 0, available: 0 };
  const load = acr(a, surface);
  if (load > pcr * 1.1) return { ok: false, reason: 'strength', needed: Math.ceil(load), available: pcr };
  return { ok: true };
}

/** Landing check for a runway, naming the limiting factor. */
export function checkLanding(a: AircraftSpec, r: Runway, windBandFactor: number): Limit {
  const p = checkPavement(a, r.surface, r.pcr);
  if (!p.ok) return p;
  const need = requiredLandingM(a, windBandFactor);
  if (r.lengthM < need) return { ok: false, reason: 'landingLength', needed: Math.ceil(need), available: r.lengthM };
  return { ok: true };
}

/** Takeoff check from an entry with the given takeoff distance available. */
export function checkTakeoff(a: AircraftSpec, r: Runway, toda: number, climate: Climate, windBandFactor: number): Limit {
  const p = checkPavement(a, r.surface, r.pcr);
  if (!p.ok) return p;
  const need = requiredTakeoffM(a, climate, windBandFactor);
  if (toda < need) return { ok: false, reason: 'takeoffLength', needed: Math.ceil(need), available: Math.floor(toda) };
  return { ok: true };
}
