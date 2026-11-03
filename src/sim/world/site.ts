import {
  CELL_M,
  GRID_N,
  START_CASH,
  type Climate,
  type City,
  type Corridor,
  type Preset,
  type SitePayload,
} from '@shared/site';
import { foldF64, foldInts, foldU32, HASH_INIT } from '../hash';
import { Rng } from '../rng';
import { generateCity, generateClimate } from './climate';
import { findCorridor } from './corridor';
import { generateParcels, type ParcelResult } from './parcels';
import { generateHeights } from './terrain';
import { generateWind, idealHeading, type WindRose } from './wind';

/** The generated site. The seed alone produces it, so it is never saved. */
export interface SiteSpec extends ParcelResult {
  seed: string;
  preset: Preset;
  heights: Float32Array;
  wind: WindRose;
  idealHeadingDeg: number;
  climate: Climate;
  city: City;
  corridor: Corridor;
  /** Parcels the player owns at the start, nearest to the corridor centre first. */
  startParcels: number[];
}

export function generateSite(seed: string, preset: Preset): SiteSpec {
  const root = Rng.fromString(`${seed}|${preset}`);
  const terrainRng = root.fork('terrain');
  const heights = generateHeights(terrainRng, preset);
  const wind = generateWind(root.fork('wind'));
  const ideal = idealHeading(wind);
  const climate = generateClimate(root.fork('climate'), preset);
  const city = generateCity(root.fork('city'), preset);
  const corridor = findCorridor(heights, ideal, root.fork('corridor'));
  const noiseSeed = root.fork('cover').int(0, 0x7fffffff) | 0;
  const parcels = generateParcels(root.fork('parcels'), preset, heights, city, corridor, noiseSeed);

  // Start with the corridor centre parcel plus its two nearest buyable neighbours.
  const centre = parcels.parcelId[Math.floor(corridor.cy / CELL_M) * GRID_N + Math.floor(corridor.cx / CELL_M)];
  const order: number[] = [];
  for (let p = 0; p < parcels.parcelCount; p++) if (p !== centre && parcels.parcelType[p] < 6 && parcels.parcelType[p] !== 4) order.push(p);
  const dist = (p: number): number => Math.hypot(parcels.parcelCx[p] - corridor.cx, parcels.parcelCy[p] - corridor.cy);
  order.sort((a, b) => dist(a) - dist(b) || a - b);
  const startParcels = [centre, order[0], order[1]];

  return { seed, preset, heights, wind, idealHeadingDeg: ideal, climate, city, corridor, startParcels, ...parcels };
}

/** 32 bit hash of everything in the site, for golden seed tests. */
export function hashSite(site: SiteSpec): number {
  let h = HASH_INIT;
  h = foldInts(h, site.landClass, site.landClass.length);
  h = foldInts(h, new Int32Array(site.parcelId), site.parcelId.length);
  h = foldInts(h, site.parcelType, site.parcelCount);
  const f64 = (a: Float64Array): number => foldF64(h, new Uint32Array(a.buffer, a.byteOffset, a.length * 2), a.length);
  h = f64(site.parcelPrice);
  h = f64(site.parcelExtraCost);
  const f32 = (a: Float32Array): number => {
    const d = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) d[i] = a[i];
    return foldF64(h, new Uint32Array(d.buffer), d.length);
  };
  h = f32(site.heights);
  h = f32(site.wind.freq);
  h = f32(site.wind.meanKt);
  h = foldU32(h, site.idealHeadingDeg);
  h = foldU32(h, site.corridor.headingDeg);
  h = foldU32(h, site.corridor.cx);
  h = foldU32(h, site.corridor.cy);
  h = foldU32(h, site.city.population);
  h = foldU32(h, site.climate.tempMaxC);
  for (let i = 0; i < site.startParcels.length; i++) h = foldU32(h, site.startParcels[i]);
  return h;
}

/** Copies the site into transferable arrays for the main thread. */
export function toPayload(site: SiteSpec): SitePayload {
  return {
    seed: site.seed,
    preset: site.preset,
    heights: new Float32Array(site.heights),
    landClass: new Uint8Array(site.landClass),
    parcelId: new Uint16Array(site.parcelId),
    parcelCount: site.parcelCount,
    parcelType: new Uint8Array(site.parcelType),
    parcelAreaHa: new Float32Array(site.parcelAreaHa),
    parcelPrice: new Float64Array(site.parcelPrice),
    parcelExtraCost: new Float64Array(site.parcelExtraCost),
    parcelResettleDays: new Uint16Array(site.parcelResettleDays),
    parcelCx: new Float32Array(site.parcelCx),
    parcelCy: new Float32Array(site.parcelCy),
    windFreq: new Float32Array(site.wind.freq),
    windMeanKt: new Float32Array(site.wind.meanKt),
    idealHeadingDeg: site.idealHeadingDeg,
    climate: site.climate,
    city: site.city,
    corridor: site.corridor,
    startParcels: site.startParcels.slice(),
    startCash: START_CASH,
  };
}
