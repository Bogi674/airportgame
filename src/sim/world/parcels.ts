import { fbm } from '@shared/noise';
import {
  CELL_M,
  CORRIDOR_LENGTH_M,
  CORRIDOR_WIDTH_M,
  GRID_N,
  LandClass,
  ParcelType,
  SITE_M,
  type City,
  type Corridor,
  type Preset,
} from '@shared/site';
import { cosLut, sinLut } from '@shared/trig';
import type { Rng } from '../rng';
import { buildCoarse, sampleCoarse } from './terrain';

const SEED_SPACING = 400;
const SEEDS_PER_SIDE = SITE_M / SEED_SPACING;
const ROAD_KEY_BASE = SEEDS_PER_SIDE * SEEDS_PER_SIDE * 2;
const ROAD_BUCKET_M = 600;
const ROAD_MAX_BUCKETS = 32;
const ROAD_HALF_WIDTH_M = 7;
const DEG_TO_RAD = Math.PI / 180;

/** Price per hectare by parcel type before the city proximity factor. */
const PRICE_PER_HA = [6000, 5000, 40000, 18000, 12000, 9000, 0];
/** Extra work per hectare: clearing, demolition, relocation and wetland fill. */
const EXTRA_PER_HA = [0, 1500, 0, 10000, 8000, 125000, 0];
const RESETTLE_DAYS = 60;

export interface ParcelResult {
  parcelId: Uint16Array;
  parcelCount: number;
  parcelType: Uint8Array;
  parcelAreaHa: Float32Array;
  parcelPrice: Float64Array;
  parcelExtraCost: Float64Array;
  parcelResettleDays: Uint16Array;
  parcelCx: Float32Array;
  parcelCy: Float32Array;
  landClass: Uint8Array;
}

function buildRoads(rng: Rng, heights: Float32Array, keys: Int32Array): void {
  const roadCount = rng.int(2, 3);
  for (let r = 0; r < roadCount; r++) {
    const horizontal = r % 2 === 0;
    const base = rng.range(1200, 6800);
    const wander = rng.range(200, 600);
    const phaseSeed = rng.int(0, 0x7fffffff) | 0;
    const slant = rng.range(-0.25, 0.25);
    let arc = 0;
    let px = 0;
    let py = 0;
    for (let a = 0; a <= SITE_M; a += 5) {
      const off = base + slant * a + (fbm(phaseSeed, a / 1800, 0.5, 3) - 0.5) * 2 * wander;
      const x = horizontal ? a : off;
      const y = horizontal ? off : a;
      if (a > 0) arc += Math.hypot(x - px, y - py);
      px = x;
      py = y;
      const bucket = Math.min(ROAD_MAX_BUCKETS - 1, Math.floor(arc / ROAD_BUCKET_M));
      const key = ROAD_KEY_BASE + r * ROAD_MAX_BUCKETS + bucket;
      const i0 = Math.floor((x - ROAD_HALF_WIDTH_M) / CELL_M);
      const i1 = Math.floor((x + ROAD_HALF_WIDTH_M) / CELL_M);
      const j0 = Math.floor((y - ROAD_HALF_WIDTH_M) / CELL_M);
      const j1 = Math.floor((y + ROAD_HALF_WIDTH_M) / CELL_M);
      for (let j = j0; j <= j1; j++) {
        if (j < 0 || j >= GRID_N) continue;
        for (let i = i0; i <= i1; i++) {
          if (i < 0 || i >= GRID_N) continue;
          const o = j * GRID_N + i;
          if (heights[o] >= 0) keys[o] = key;
        }
      }
    }
  }
}

function cityProximity(city: City, x: number, y: number): number {
  const d = Math.hypot(x - city.x, y - city.y) / 1500;
  return 1 + 1.5 / (1 + d * d / 4);
}

export function generateParcels(
  rng: Rng,
  preset: Preset,
  heights: Float32Array,
  city: City,
  corridor: Corridor,
  noiseSeed: number,
): ParcelResult {
  const n = GRID_N * GRID_N;
  // Voronoi seeds on a jittered grid, with a coarse domain warp for irregular edges.
  const seedX = new Float32Array(SEEDS_PER_SIDE * SEEDS_PER_SIDE);
  const seedY = new Float32Array(SEEDS_PER_SIDE * SEEDS_PER_SIDE);
  for (let gj = 0; gj < SEEDS_PER_SIDE; gj++) {
    for (let gi = 0; gi < SEEDS_PER_SIDE; gi++) {
      const k = gj * SEEDS_PER_SIDE + gi;
      seedX[k] = (gi + 0.5) * SEED_SPACING + rng.range(-150, 150);
      seedY[k] = (gj + 0.5) * SEED_SPACING + rng.range(-150, 150);
    }
  }
  const warpX = buildCoarse((x, y) => (fbm(noiseSeed + 11, x / 500, y / 500, 2) - 0.5) * 160);
  const warpY = buildCoarse((x, y) => (fbm(noiseSeed + 23, x / 500, y / 500, 2) - 0.5) * 160);

  const keys = new Int32Array(n);
  for (let j = 0; j < GRID_N; j++) {
    const y = (j + 0.5) * CELL_M;
    for (let i = 0; i < GRID_N; i++) {
      const x = (i + 0.5) * CELL_M;
      const wx = x + sampleCoarse(warpX, x, y);
      const wy = y + sampleCoarse(warpY, x, y);
      // Only the 2 by 2 block of seed cells nearest to the point can win with this jitter.
      const fx = wx / SEED_SPACING - 0.5;
      const fy = wy / SEED_SPACING - 0.5;
      const gi = Math.min(SEEDS_PER_SIDE - 2, Math.max(0, Math.floor(fx)));
      const gj = Math.min(SEEDS_PER_SIDE - 2, Math.max(0, Math.floor(fy)));
      let bestK = 0;
      let bestD = Infinity;
      for (let dj = 0; dj <= 1; dj++) {
        for (let di = 0; di <= 1; di++) {
          const k = (gj + dj) * SEEDS_PER_SIDE + gi + di;
          const dx = wx - seedX[k];
          const dy = wy - seedY[k];
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            bestK = k;
          }
        }
      }
      keys[j * GRID_N + i] = bestK * 2 + (heights[j * GRID_N + i] < 0 ? 1 : 0);
    }
  }
  buildRoads(rng, heights, keys);

  // Compact keys to ids in raster order.
  const maxKey = ROAD_KEY_BASE + 4 * ROAD_MAX_BUCKETS;
  const lookup = new Int32Array(maxKey + 1).fill(-1);
  const parcelId = new Uint16Array(n);
  let count = 0;
  for (let o = 0; o < n; o++) {
    const key = keys[o];
    if (lookup[key] < 0) lookup[key] = count++;
    parcelId[o] = lookup[key];
  }

  const cells = new Int32Array(count);
  const waterCells = new Int32Array(count);
  const sumH = new Float64Array(count);
  const sumX = new Float64Array(count);
  const sumY = new Float64Array(count);
  const isRoad = new Uint8Array(count);
  for (let o = 0; o < n; o++) {
    const p = parcelId[o];
    cells[p]++;
    sumH[p] += heights[o];
    const j = Math.floor(o / GRID_N);
    sumX[p] += ((o - j * GRID_N) + 0.5) * CELL_M;
    sumY[p] += (j + 0.5) * CELL_M;
    if (heights[o] < 0) waterCells[p]++;
    if (keys[o] >= ROAD_KEY_BASE) isRoad[p] = 1;
  }

  const parcelType = new Uint8Array(count);
  const parcelCx = new Float32Array(count);
  const parcelCy = new Float32Array(count);
  const parcelAreaHa = new Float32Array(count);
  const protectedAsForest = new Uint8Array(count);
  for (let p = 0; p < count; p++) {
    const cx = sumX[p] / cells[p];
    const cy = sumY[p] / cells[p];
    parcelCx[p] = cx;
    parcelCy[p] = cy;
    parcelAreaHa[p] = (cells[p] * CELL_M * CELL_M) / 10000;
    const meanH = sumH[p] / cells[p];
    const waterFrac = waterCells[p] / cells[p];
    const dc = Math.hypot(cx - city.x, cy - city.y);
    const prox = 1 / (1 + (dc / 2500) * (dc / 2500));
    const r = rng.next();
    const r2 = rng.next();
    protectedAsForest[p] = r2 < 0.5 ? 1 : 0;
    if (isRoad[p] === 1) {
      parcelType[p] = ParcelType.Road;
    } else if (waterFrac > 0.6) {
      parcelType[p] = r < 0.25 ? ParcelType.Protected : ParcelType.Wetland;
    } else if (r < 0.02 + 0.1 * prox) {
      parcelType[p] = ParcelType.Village;
    } else if (r < 0.03 + 0.18 * prox) {
      parcelType[p] = ParcelType.Industrial;
    } else if (meanH < 2.5 && waterFrac > 0.05 && r2 < 0.5) {
      parcelType[p] = r2 < 0.15 ? ParcelType.Protected : ParcelType.Wetland;
    } else if (r > 0.97) {
      parcelType[p] = ParcelType.Protected;
    } else if (r > 0.72 - 0.25 * Math.min(1, meanH / 60)) {
      parcelType[p] = ParcelType.ScrubForest;
    } else {
      parcelType[p] = ParcelType.Farmland;
    }
  }

  // Parcels under the corridor must be buyable land of a type that does not block the guarantee.
  const ax = sinLut(corridor.headingDeg * DEG_TO_RAD);
  const ay = -cosLut(corridor.headingDeg * DEG_TO_RAD);
  const px = -ay;
  const py = ax;
  for (let t = -CORRIDOR_LENGTH_M / 2 - CELL_M; t <= CORRIDOR_LENGTH_M / 2 + CELL_M; t += CELL_M / 2) {
    for (let s = -CORRIDOR_WIDTH_M / 2 - CELL_M; s <= CORRIDOR_WIDTH_M / 2 + CELL_M; s += CELL_M / 2) {
      const i = Math.floor((corridor.cx + ax * t + px * s) / CELL_M);
      const j = Math.floor((corridor.cy + ay * t + py * s) / CELL_M);
      if (i < 0 || j < 0 || i >= GRID_N || j >= GRID_N) continue;
      const p = parcelId[j * GRID_N + i];
      const type = parcelType[p];
      if (type === ParcelType.Village || type === ParcelType.Protected || type === ParcelType.Wetland) {
        parcelType[p] = ParcelType.Farmland;
      }
    }
  }

  const parcelPrice = new Float64Array(count);
  const parcelExtraCost = new Float64Array(count);
  const parcelResettleDays = new Uint16Array(count);
  for (let p = 0; p < count; p++) {
    const type = parcelType[p];
    const ha = parcelAreaHa[p];
    parcelPrice[p] = Math.round(ha * PRICE_PER_HA[type] * cityProximity(city, parcelCx[p], parcelCy[p]));
    parcelExtraCost[p] = Math.round(ha * EXTRA_PER_HA[type]);
    parcelResettleDays[p] = type === ParcelType.Village ? RESETTLE_DAYS : 0;
  }

  // Raster land classes from parcel types, height and cover noise.
  const cover = buildCoarse((x, y) => fbm(noiseSeed + 37, x / 300, y / 300, 3));
  const landClass = new Uint8Array(n);
  const coastal = preset === 'flatCoastal';
  for (let j = 0; j < GRID_N; j++) {
    const y = (j + 0.5) * CELL_M;
    for (let i = 0; i < GRID_N; i++) {
      const o = j * GRID_N + i;
      const h = heights[o];
      const p = parcelId[o];
      const type = parcelType[p];
      let c: number;
      if (h < 0) {
        c = LandClass.Water;
      } else if (type === ParcelType.Road) {
        c = LandClass.Road;
      } else if (type === ParcelType.Village) {
        c = LandClass.Village;
      } else if (type === ParcelType.Industrial) {
        c = LandClass.Industrial;
      } else if (coastal && h < 0.9) {
        c = LandClass.Beach;
      } else if (h > 55) {
        c = LandClass.Rock;
      } else if (type === ParcelType.Farmland) {
        c = LandClass.Farmland;
      } else if (type === ParcelType.Wetland) {
        c = LandClass.Wetland;
      } else if (type === ParcelType.Protected) {
        c = protectedAsForest[p] === 1 ? LandClass.Forest : LandClass.Wetland;
      } else {
        c = sampleCoarse(cover, (i + 0.5) * CELL_M, y) > 0.45 ? LandClass.Forest : LandClass.Grass;
      }
      landClass[o] = c;
    }
  }
  return {
    parcelId,
    parcelCount: count,
    parcelType,
    parcelAreaHa,
    parcelPrice,
    parcelExtraCost,
    parcelResettleDays,
    parcelCx,
    parcelCy,
    landClass,
  };
}
