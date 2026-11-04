import { z } from 'zod';
import raw from './aircraft/aircraft.mvp.json';
import wakeJson from './wake.json';

const surface = z.enum(['asphalt', 'concrete', 'gravel', 'grass', 'dirt']);

const aircraftSchema = z.object({
  id: z.string(),
  name: z.string(),
  family: z.string(),
  phase: z.number(),
  release: z.enum(['mvp1', 'mvp2']),
  role: z.string(),
  icaoType: z.string(),
  generation: z.enum(['classic', 'mature', 'modern']),
  dimensions: z.object({
    lengthM: z.number().positive(),
    wingspanM: z.number().positive(),
    heightM: z.number().positive(),
    fuselageWidthM: z.number().positive(),
    wheelbaseM: z.number().positive(),
    mainGearTrackM: z.number().positive(),
  }),
  weights: z.object({ mtowKg: z.number().positive(), mlwKg: z.number().positive(), oewKg: z.number().positive() }),
  capacity: z.object({ seatsTypical: z.number().int().nonnegative(), seatsMax: z.number().int().nonnegative() }),
  engines: z.object({ count: z.number().int().positive(), type: z.enum(['piston', 'turboprop', 'turbofan']) }),
  performance: z.object({
    rangeKm: z.number().positive(),
    cruiseKmh: z.number().positive(),
    ceilingM: z.number().positive(),
    takeoffFieldM: z.number().positive(),
    landingFieldM: z.number().positive(),
    vrefKt: z.number().positive(),
  }),
  surfaces: z.array(surface).min(1),
  /** Stand geometry in meters from the nose tip: nose gear, door stations for jet bridges, fuel coupling (v to the right). */
  stand: z
    .object({
      noseGearM: z.number().positive(),
      doorStationsM: z.array(z.number().positive()),
      fuelCouplingM: z.object({ u: z.number().positive(), v: z.number().positive() }),
    })
    .optional(),
  sprite: z.object({ base: z.string() }).passthrough(),
  derivedForReading: z.object({ code: z.enum(['A', 'B', 'C', 'D', 'E', 'F']), wake: z.enum(['L', 'M', 'H', 'J']), approachCategory: z.enum(['A', 'B', 'C', 'D', 'E']) }),
});

export type AircraftSpec = z.infer<typeof aircraftSchema>;
export type WakeCat = 'L' | 'M' | 'H' | 'J';
export const WAKE_ORDER: readonly WakeCat[] = ['L', 'M', 'H', 'J'];

/** Code letter from wingspan (docs/GAME_DESIGN.md section 5). */
export function codeFromSpan(spanM: number): 'A' | 'B' | 'C' | 'D' | 'E' | 'F' {
  if (spanM < 15) return 'A';
  if (spanM < 24) return 'B';
  if (spanM < 36) return 'C';
  if (spanM < 52) return 'D';
  if (spanM < 65) return 'E';
  return 'F';
}

export function wakeFromMtow(mtowKg: number): WakeCat {
  if (mtowKg <= 7000) return 'L';
  if (mtowKg <= 136000) return 'M';
  return 'H';
}

export function approachFromVref(vrefKt: number): 'A' | 'B' | 'C' | 'D' | 'E' {
  if (vrefKt < 91) return 'A';
  if (vrefKt <= 120) return 'B';
  if (vrefKt <= 140) return 'C';
  if (vrefKt <= 165) return 'D';
  return 'E';
}

/** Game pavement load per docs/GAME_DESIGN.md section 6: gear factor and main wheel count by size class. */
export function mainWheelCount(a: AircraftSpec): number {
  const t = a.weights.mtowKg;
  if (t < 7000) return 2;
  if (t < 40000) return 4;
  if (t < 100000) return 4;
  if (t < 280000) return 8;
  return 12;
}

export function gearFactor(a: AircraftSpec): number {
  const t = a.weights.mtowKg;
  if (t < 7000) return 1.0;
  if (t < 100000) return 0.8;
  if (t < 280000) return 0.65;
  return 0.55;
}

export function acr(a: AircraftSpec, surface: 'asphalt' | 'concrete' | 'gravel' | 'grass' | 'dirt'): number {
  return ((a.weights.mtowKg / 1000) * gearFactor(a)) / Math.sqrt(mainWheelCount(a)) * (surface === 'concrete' ? 1.1 : 1.0);
}

const file = z.object({
  aircraft: z.array(aircraftSchema).refine((l) => l.every((a) => a.release !== 'mvp1' || a.stand !== undefined), { message: 'every released type needs stand geometry' }),
});

/** Stand geometry of a released type. Every released type has it, the schema checks that. */
export function standGeometry(a: AircraftSpec): NonNullable<AircraftSpec['stand']> {
  if (!a.stand) throw new Error(`no stand geometry for ${a.id}`);
  return a.stand;
}

/** Aircraft released in MVP 1, validated once at load. Index in this array is the type index used by the sim. */
export const AIRCRAFT: readonly AircraftSpec[] = file.parse(raw).aircraft.filter((a) => a.release === 'mvp1');

export const SPRITE_BASES = (raw as { spriteBases: Record<string, SpriteBase> }).spriteBases;

export interface SpriteBase {
  name: string;
  L: number;
  span: number;
  fw: number;
  nose: number;
  nose_n: number;
  nose_m: number;
  tail: number;
  tail_end: number;
  wing: {
    x: number;
    c: number;
    sweep: number;
    kink: number;
    tip: number;
    sb: number;
    te_in?: number;
    winglet?: string;
    ext?: number;
    high?: boolean;
  };
  hstab: { x: number; c: number; sweep: number; span: number; tip: number; ttail?: boolean };
  engines?: { kind: string; y: number; x: number; len: number; d: number }[];
  nose_prop?: { d: number; blades: number };
  doors?: number[];
  windows?: number[] | null;
  tail_color?: string;
}

const wake = wakeJson as { order: string[]; minSeparationSec: number[][]; runwayOccupancySec: { landingRollout: number; lineUp: number; crossing: number } };

/** Minimum seconds between two runway uses by leader and follower wake categories. */
export function wakeSeparationSec(leader: WakeCat, follower: WakeCat): number {
  return wake.minSeparationSec[WAKE_ORDER.indexOf(leader)][WAKE_ORDER.indexOf(follower)];
}

export const RUNWAY_OCCUPANCY = wake.runwayOccupancySec;

export function typeIndex(id: string): number {
  return AIRCRAFT.findIndex((a) => a.id === id);
}
