/**
 * Deterministic value noise using only integer ops and + - * /, shared by the sim
 * (terrain, parcels) and the renderer (vegetation, fields). Lattice units: one cell per unit.
 */

/** Hash of an integer lattice point to [0, 1). */
export function hash2(seed: number, ix: number, iy: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
export function valueNoise(seed: number, x: number, y: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  let tx = x - fx;
  let ty = y - fy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const a = hash2(seed, fx, fy);
  const b = hash2(seed, fx + 1, fy);
  const c = hash2(seed, fx, fy + 1);
  const d = hash2(seed, fx + 1, fy + 1);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

/** Fractal noise normalized to roughly [0, 1). */
export function fbm(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise((seed + o * 0x9e3779b1) | 0, x * f, y * f);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}
