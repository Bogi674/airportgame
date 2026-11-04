import { AIRCRAFT } from '@data/aircraft';
import { AIRFIELD, SURFACE_DATA, SURFACE_SPEC } from '@data/index';
import { codeIndex, type CodeLetter, type Surface, type Taxiway } from './airfield';
import { TICKS_PER_DAY } from './business';

/**
 * Surface rules shared by the sim and the UI previews (docs/DESIGN_REVISION_2.md section 2.5):
 * which codes a surface allows, what a change costs and how long the works take.
 */

export const SURFACE_ORDER: readonly Surface[] = ['grass', 'dirt', 'gravel', 'asphalt', 'concrete'];
export const surfaceRank = (s: Surface): number => SURFACE_ORDER.indexOf(s);
export const isPaved = (s: Surface): boolean => SURFACE_SPEC[s].paint === 'full';

export function surfaceAllowsCode(surface: Surface, code: CodeLetter): boolean {
  return SURFACE_SPEC[surface].allowedCodes.includes(code);
}

/** Strength tier and cost factor of a surface. */
export function tierOf(surface: Surface, tier: number): { pcr: number; factor: number; tier: number } {
  const tiers = SURFACE_SPEC[surface].pcrTiers;
  const i = Math.max(0, Math.min(tiers.length - 1, Math.floor(tier)));
  return { pcr: tiers[i], factor: SURFACE_DATA.tierCostFactor[i] ?? 1, tier: i };
}

/** Cost per square meter of a surface at a strength tier. */
export const unitCost = (surface: Surface, tier: number): number => SURFACE_SPEC[surface].costPerM2 * tierOf(surface, tier).factor;

export function polylineLength(points: readonly { x: number; y: number }[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return l;
}

/** Pavement area of a taxiway with its paved shoulders, in square meters. */
export function taxiwayArea(t: Pick<Taxiway, 'points' | 'widthM' | 'code'>, surface: Surface): number {
  const shoulder = isPaved(surface) ? AIRFIELD.codes[t.code].taxiwayShoulderM : 0;
  return polylineLength(t.points) * (t.widthM + 2 * shoulder);
}

/** Whole game days the works on `areaM2` of a surface take. */
export function worksDays(surface: Surface, areaM2: number): number {
  return Math.max(SURFACE_DATA.minWorksDays, Math.ceil((SURFACE_SPEC[surface].worksDaysPerKm2 * areaM2) / 1e6));
}

export const worksTicks = (days: number): number => days * TICKS_PER_DAY;

export interface SurfaceChange {
  /** Cash change: negative for spending, positive for a downgrade refund. */
  cashDelta: number;
  days: number;
  upgrade: boolean;
}

/**
 * Price and duration of changing a taxiway's surface or strength. An upgrade pays for the new
 * pavement; a downgrade refunds a share of the old value and pays for the new surface.
 */
export function surfaceChange(t: Pick<Taxiway, 'points' | 'widthM' | 'code' | 'surface' | 'pcr'>, surface: Surface, tier: number): SurfaceChange {
  const oldTier = Math.max(0, SURFACE_SPEC[t.surface].pcrTiers.indexOf(t.pcr));
  const oldUnit = unitCost(t.surface, oldTier);
  const newUnit = unitCost(surface, tier);
  const area = taxiwayArea(t, surface);
  const upgrade = surfaceRank(surface) > surfaceRank(t.surface) || (surface === t.surface && newUnit >= oldUnit);
  const cashDelta = upgrade
    ? -Math.round(area * newUnit)
    : Math.round(taxiwayArea(t, t.surface) * oldUnit * SURFACE_SPEC[t.surface].refundShare - area * newUnit);
  return { cashDelta, days: worksDays(surface, area), upgrade };
}

/**
 * The first assigned aircraft type that could use a taxiway of this code but not this surface,
 * or null when every assigned type accepts it.
 */
export function excludedType(code: CodeLetter, surface: Surface, assignedTypes: readonly number[]): string | null {
  for (const i of [...new Set(assignedTypes)].sort((a, b) => a - b)) {
    const a = AIRCRAFT[i];
    if (!a || codeIndex(a.derivedForReading.code) > codeIndex(code)) continue;
    if (!a.surfaces.includes(surface)) return a.name;
  }
  return null;
}
