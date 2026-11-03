import { fbm } from '@shared/noise';
import { CELL_M, GRID_N, SITE_M, type Preset } from '@shared/site';
import type { Rng } from '../rng';

/** Coarse noise grid: smooth fields are sampled every 40 m and interpolated, which keeps generation fast. */
export const COARSE_STEP = 4;
export const COARSE_N = GRID_N / COARSE_STEP + 1;

export function buildCoarse(fn: (x: number, y: number) => number): Float32Array {
  const g = new Float32Array(COARSE_N * COARSE_N);
  const stepM = CELL_M * COARSE_STEP;
  for (let j = 0; j < COARSE_N; j++) {
    for (let i = 0; i < COARSE_N; i++) g[j * COARSE_N + i] = fn(i * stepM, j * stepM);
  }
  return g;
}

/** Bilinear sample of a coarse grid at a world position in meters. */
export function sampleCoarse(g: Float32Array, x: number, y: number): number {
  const stepM = CELL_M * COARSE_STEP;
  let fx = x / stepM;
  let fy = y / stepM;
  if (fx < 0) fx = 0;
  if (fy < 0) fy = 0;
  if (fx > COARSE_N - 1.001) fx = COARSE_N - 1.001;
  if (fy > COARSE_N - 1.001) fy = COARSE_N - 1.001;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const o = iy * COARSE_N + ix;
  const a = g[o] + (g[o + 1] - g[o]) * tx;
  const b = g[o + COARSE_N] + (g[o + COARSE_N + 1] - g[o + COARSE_N]) * tx;
  return a + (b - a) * ty;
}

/** Maps world x, y into (u, v) with u running away from the edge or along the river. */
function orient(side: number, x: number, y: number, out: { u: number; v: number }): void {
  switch (side) {
    case 0:
      out.u = y;
      out.v = x;
      break;
    case 1:
      out.u = SITE_M - y;
      out.v = x;
      break;
    case 2:
      out.u = x;
      out.v = y;
      break;
    default:
      out.u = SITE_M - x;
      out.v = y;
      break;
  }
}

/** Heightmap in meters above sea level on the 10 m grid. Negative means water. */
export function generateHeights(rng: Rng, preset: Preset): Float32Array {
  const seedA = (rng.int(0, 0x7fffffff) | 0) as number;
  const seedB = (rng.int(0, 0x7fffffff) | 0) as number;
  const seedC = (rng.int(0, 0x7fffffff) | 0) as number;
  const side = rng.int(0, 3);
  const uv = { u: 0, v: 0 };

  const field = (x: number, y: number): number => {
    orient(side, x, y, uv);
    const u = uv.u;
    const v = uv.v;
    const detail = (fbm(seedA, x / 900, y / 900, 4) - 0.5) * 10;
    if (preset === 'flatCoastal') {
      const coast = 700 + (fbm(seedB, v / 1500, 0.5, 3) - 0.5) * 1800;
      const d = u - coast;
      let h = (d < 0 ? d * 0.012 : d * 0.004) + detail;
      if (d > 250 && h < 0.4) h = 0.4;
      return h;
    }
    const centre = 4000 + (fbm(seedB, u / 2500, 0.5, 2) - 0.5) * 2400 + (fbm(seedC, u / 700, 0.5, 2) - 0.5) * 500;
    const dv = Math.abs(v - centre);
    const half = (45 + 25 * fbm(seedC, u / 1200, 3.5, 2)) / 2;
    const hills = (dv / 4000) * (dv / 4000) * 60;
    const damp = dv / 400 < 1 ? dv / 400 : 1;
    if (dv < half) {
      const r = dv / half;
      return 0.9 - 4.5 * (1 - r * r);
    }
    return 0.9 + (dv - half) * 0.01 + hills + detail * 0.8 * damp;
  };

  const coarse = buildCoarse(field);
  const heights = new Float32Array(GRID_N * GRID_N);
  for (let j = 0; j < GRID_N; j++) {
    const y = (j + 0.5) * CELL_M;
    for (let i = 0; i < GRID_N; i++) heights[j * GRID_N + i] = sampleCoarse(coarse, (i + 0.5) * CELL_M, y);
  }
  return heights;
}
