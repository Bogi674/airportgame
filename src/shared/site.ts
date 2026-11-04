/** Types and constants for the generated site, shared by the sim, the renderer and the UI. */

export const GRID_N = 800;
export const CELL_M = 10;
export const SITE_M = GRID_N * CELL_M;

export type Preset = 'flatCoastal' | 'riverValley';
export const PRESETS: readonly Preset[] = ['flatCoastal', 'riverValley'];

export const ParcelType = {
  Farmland: 0,
  ScrubForest: 1,
  Village: 2,
  Industrial: 3,
  Road: 4,
  Wetland: 5,
  Protected: 6,
} as const;
export type ParcelTypeId = (typeof ParcelType)[keyof typeof ParcelType];
export const PARCEL_TYPE_COUNT = 7;

/** Raster land classes, one byte per 10 m cell. */
export const LandClass = {
  Water: 0,
  Beach: 1,
  Grass: 2,
  Forest: 3,
  Wetland: 4,
  Farmland: 5,
  Village: 6,
  Industrial: 7,
  Road: 8,
  Rock: 9,
} as const;

export const WIND_BINS = 16;
export const SEASONS = 4;

/** Starting cash until the finance milestone defines difficulty. */
export const START_CASH = 120_000_000;
/** Land the player can afford in the first two years, used by the fairness guarantee. */
export const AFFORDABLE_LAND_BUDGET = 8_000_000;

export const CORRIDOR_LENGTH_M = 3500;
export const CORRIDOR_WIDTH_M = 400;

export type WindBand = 'optimal' | 'acceptable' | 'poor';

/** Smallest angle between two runway axes (degrees, 0 to 180 periodic). */
export function axisDelta(a: number, b: number): number {
  let d = Math.abs(a - b) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

/** Band of a runway axis against the ideal heading (docs/GAME_DESIGN.md section 4). */
export function windBand(axisDeg: number, idealDeg: number): WindBand {
  const d = axisDelta(axisDeg, idealDeg);
  if (d <= 15) return 'optimal';
  if (d <= 40) return 'acceptable';
  return 'poor';
}

export type ClimateType = 'tropical' | 'temperate' | 'arid' | 'continental' | 'maritime';

export interface Climate {
  type: ClimateType;
  tempMinC: number;
  tempMaxC: number;
  rainDays: number;
  fogDays: number;
  snowDays: number;
  elevationM: number;
}

export interface City {
  population: number;
  growthPctPerYear: number;
  distanceKm: number;
  directionDeg: number;
  incomeIndex: number;
  tourismShare: number;
  businessShare: number;
  /** City centre in site coordinates, meters. May lie outside the 8 km site. */
  x: number;
  y: number;
}

export interface Corridor {
  cx: number;
  cy: number;
  /** Compass heading of the corridor axis, 0 to 179 degrees. */
  headingDeg: number;
  lengthM: number;
  widthM: number;
}

/** Compass heading (degrees clockwise from north) to a world direction. North is -y. */
export function compassToWorldAngle(deg: number): number {
  return (deg * Math.PI) / 180 - Math.PI / 2;
}

/** The generated site as sent to the main thread. */
export interface SitePayload {
  seed: string;
  preset: Preset;
  heights: Float32Array;
  landClass: Uint8Array;
  parcelId: Uint16Array;
  parcelCount: number;
  parcelType: Uint8Array;
  parcelAreaHa: Float32Array;
  parcelPrice: Float64Array;
  parcelExtraCost: Float64Array;
  parcelResettleDays: Uint16Array;
  parcelCx: Float32Array;
  parcelCy: Float32Array;
  windFreq: Float32Array;
  windMeanKt: Float32Array;
  idealHeadingDeg: number;
  climate: Climate;
  city: City;
  corridor: Corridor;
  startParcels: number[];
  startCash: number;
}
