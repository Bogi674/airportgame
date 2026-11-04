import { acr, type AircraftSpec } from '@data/aircraft';
import type { Runway, Surface } from '@shared/airfield';
import type { Climate } from '@shared/site';

/** Typical share of MTOW at departure and of MLW at landing until routes decide the real weight. */
const DEFAULT_TAKEOFF_WEIGHT = 0.9;
const DEFAULT_LANDING_WEIGHT = 0.85;

/** Required takeoff run in meters (docs/GAME_DESIGN.md section 5). */
export function requiredTakeoffM(a: AircraftSpec, climate: Climate, windBandFactor: number, share = DEFAULT_TAKEOFF_WEIGHT): number {
  const temp = 1 + (0.07 * (climate.tempMaxC - 15)) / 10;
  const alt = 1 + (0.07 * climate.elevationM) / 300;
  const weight = share * share;
  return a.performance.takeoffFieldM * Math.max(0.8, temp) * alt * weight * windBandFactor;
}

/** Passenger plus bags weight per seat in kg. */
const KG_PER_PAX = 100;

/**
 * Takeoff weight as a share of MTOW for a stage length: empty weight, passengers and the fuel the
 * stage needs. When that exceeds MTOW the payload is cut, so `payloadFactor` falls below 1.
 * Longer stages and fuller cabins need longer runways.
 */
export function takeoffWeight(a: AircraftSpec, stageKm: number, loadFactor: number): { share: number; payloadFactor: number } {
  const mtow = a.weights.mtowKg;
  const payload = a.capacity.seatsTypical * loadFactor * KG_PER_PAX;
  const fuel = mtow * Math.min(0.4, 0.03 + 0.32 * Math.min(1, stageKm / a.performance.rangeKm));
  let share = (a.weights.oewKg + payload + fuel) / mtow;
  let payloadFactor = 1;
  if (share > 1 && payload > 0) {
    payloadFactor = Math.max(0, (payload - (share - 1) * mtow) / payload);
    share = 1;
  }
  return { share: Math.max(0.55, share), payloadFactor };
}

/** Longest stage an airline flies with this type: 85 percent of its range. */
export const maxStageKm = (a: AircraftSpec): number => Math.floor(a.performance.rangeKm * 0.85);

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
export function checkTakeoff(a: AircraftSpec, r: Runway, toda: number, climate: Climate, windBandFactor: number, share = DEFAULT_TAKEOFF_WEIGHT): Limit {
  const p = checkPavement(a, r.surface, r.pcr);
  if (!p.ok) return p;
  const need = requiredTakeoffM(a, climate, windBandFactor, share);
  if (toda < need) return { ok: false, reason: 'takeoffLength', needed: Math.ceil(need), available: Math.floor(toda) };
  return { ok: true };
}
