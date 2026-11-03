import {
  axisDelta,
  CELL_M,
  CORRIDOR_LENGTH_M,
  CORRIDOR_WIDTH_M,
  GRID_N,
  SITE_M,
  type Corridor,
} from '@shared/site';
import { cosLut, sinLut } from '@shared/trig';
import type { Rng } from '../rng';

const DEG_TO_RAD = Math.PI / 180;
const MAX_SLOPE = 0.04;

function heightAt(heights: Float32Array, x: number, y: number): number {
  let i = Math.floor(x / CELL_M);
  let j = Math.floor(y / CELL_M);
  if (i < 0) i = 0;
  if (j < 0) j = 0;
  if (i > GRID_N - 1) i = GRID_N - 1;
  if (j > GRID_N - 1) j = GRID_N - 1;
  return heights[j * GRID_N + i];
}

interface Eval {
  score: number;
  wet: number;
  slope: number;
}

/** Axis unit vector in world space for a compass heading (north is -y). */
export function axisVector(headingDeg: number, out: { x: number; y: number }): void {
  const a = headingDeg * DEG_TO_RAD;
  out.x = sinLut(a);
  out.y = -cosLut(a);
}

function evaluate(heights: Float32Array, cx: number, cy: number, heading: number, ideal: number): Eval | null {
  const ax = sinLut(heading * DEG_TO_RAD);
  const ay = -cosLut(heading * DEG_TO_RAD);
  const px = -ay;
  const py = ax;
  const half = CORRIDOR_LENGTH_M / 2;
  const hw = CORRIDOR_WIDTH_M / 2;
  // All four corners must stay inside the site with a margin.
  for (const t of [-half, half]) {
    for (const s of [-hw, hw]) {
      const x = cx + ax * t + px * s;
      const y = cy + ay * t + py * s;
      if (x < 100 || y < 100 || x > SITE_M - 100 || y > SITE_M - 100) return null;
    }
  }
  let wet = 0;
  let slope = 0;
  let prev = 0;
  let havePrev = false;
  for (let t = -half; t <= half; t += 25) {
    for (let s = -hw; s <= hw; s += 25) {
      const h = heightAt(heights, cx + ax * t + px * s, cy + ay * t + py * s);
      if (h < 0.3) wet++;
      if (s === 0) {
        if (havePrev && t % 100 === 0) {
          const d = Math.abs(h - prev) / 100;
          if (d > slope) slope = d;
        }
        if (t % 100 === 0) {
          prev = h;
          havePrev = true;
        }
      }
    }
  }
  const score = wet * 1000 + (slope > MAX_SLOPE ? (slope - MAX_SLOPE) * 10000 : 0) + axisDelta(heading, ideal) * 0.5;
  return { score, wet, slope };
}

/** Flattens and dries land along the corridor so that it is always usable. */
function carve(heights: Float32Array, c: Corridor): void {
  const ax = sinLut(c.headingDeg * DEG_TO_RAD);
  const ay = -cosLut(c.headingDeg * DEG_TO_RAD);
  const px = -ay;
  const py = ax;
  const half = c.lengthM / 2;
  let sum = 0;
  let n = 0;
  for (let t = -half; t <= half; t += 50) {
    const h = heightAt(heights, c.cx + ax * t, c.cy + ay * t);
    sum += h < 0.5 ? 0.5 : h;
    n++;
  }
  let target = sum / n;
  if (target < 1.5) target = 1.5;
  if (target > 30) target = 30;
  const reachT = half + 250;
  const reachS = 450;
  const minX = Math.max(0, Math.floor((c.cx - reachT - reachS) / CELL_M));
  const maxX = Math.min(GRID_N - 1, Math.ceil((c.cx + reachT + reachS) / CELL_M));
  const minY = Math.max(0, Math.floor((c.cy - reachT - reachS) / CELL_M));
  const maxY = Math.min(GRID_N - 1, Math.ceil((c.cy + reachT + reachS) / CELL_M));
  for (let j = minY; j <= maxY; j++) {
    for (let i = minX; i <= maxX; i++) {
      const dx = (i + 0.5) * CELL_M - c.cx;
      const dy = (j + 0.5) * CELL_M - c.cy;
      const t = Math.abs(dx * ax + dy * ay);
      const s = Math.abs(dx * px + dy * py);
      if (t > reachT || s > reachS) continue;
      const wt = t <= half ? 1 : 1 - smooth((t - half) / 250);
      const ws = s <= 250 ? 1 : 1 - smooth((s - 250) / 200);
      const w = wt * ws;
      const o = j * GRID_N + i;
      heights[o] = heights[o] * (1 - w) + target * w;
    }
  }
}

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Picks a 3.5 km by 400 m corridor aligned within the Acceptable band of the ideal heading.
 * If no natural candidate is dry and gentle enough, the best one is carved flat, so every
 * seed has a usable corridor (the fairness guarantee).
 */
export function findCorridor(heights: Float32Array, idealDeg: number, rng: Rng): Corridor {
  let best: Corridor | null = null;
  let bestEval: Eval | null = null;
  for (let d = -36; d <= 36; d += 6) {
    const heading = (((idealDeg + d) % 180) + 180) % 180;
    for (let cy = 2500; cy <= 5500; cy += 500) {
      for (let cx = 2500; cx <= 5500; cx += 500) {
        const ev = evaluate(heights, cx, cy, heading, idealDeg);
        if (!ev) continue;
        const jitter = rng.next() * 0.01;
        if (!bestEval || ev.score + jitter < bestEval.score) {
          bestEval = { ...ev, score: ev.score + jitter };
          best = { cx, cy, headingDeg: heading, lengthM: CORRIDOR_LENGTH_M, widthM: CORRIDOR_WIDTH_M };
        }
      }
    }
  }
  if (!best || !bestEval) {
    best = { cx: SITE_M / 2, cy: SITE_M / 2, headingDeg: idealDeg, lengthM: CORRIDOR_LENGTH_M, widthM: CORRIDOR_WIDTH_M };
    carve(heights, best);
  } else if (bestEval.wet > 0 || bestEval.slope > MAX_SLOPE) {
    carve(heights, best);
  }
  return best;
}
