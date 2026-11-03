import { SEASONS, WIND_BINS } from '@shared/site';
import { sinLut } from '@shared/trig';
import type { Rng } from '../rng';

export interface WindRose {
  /** Frequency per season and bin, each season sums to 1. Index season * 16 + bin. Bin 0 is wind from north. */
  freq: Float32Array;
  /** Mean wind speed in knots per season and bin. */
  meanKt: Float32Array;
}

const DEG_TO_RAD = Math.PI / 180;
const SPEED_CLASS = [0.6, 1.0, 1.6];
const SPEED_WEIGHT = [0.35, 0.45, 0.2];

function binDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % WIND_BINS;
  return d > WIND_BINS / 2 ? WIND_BINS - d : d;
}

export function generateWind(rng: Rng): WindRose {
  const freq = new Float32Array(SEASONS * WIND_BINS);
  const meanKt = new Float32Array(SEASONS * WIND_BINS);
  const dominant = rng.int(0, WIND_BINS - 1);
  const concentration = rng.range(0.5, 2.0);
  const baseKt = rng.range(7, 15);
  for (let s = 0; s < SEASONS; s++) {
    const dom = (dominant + rng.int(-2, 2) + WIND_BINS) % WIND_BINS;
    const seasonKt = baseKt * rng.range(0.85, 1.2);
    let total = 0;
    let max = 0;
    const weights = new Float64Array(WIND_BINS);
    for (let b = 0; b < WIND_BINS; b++) {
      const d = binDistance(b, dom) * concentration;
      weights[b] = 0.15 + 1 / (1 + d * d);
      total += weights[b];
      if (weights[b] > max) max = weights[b];
    }
    for (let b = 0; b < WIND_BINS; b++) {
      freq[s * WIND_BINS + b] = weights[b] / total;
      meanKt[s * WIND_BINS + b] = seasonKt * (0.7 + (0.6 * weights[b]) / max);
    }
  }
  return { freq, meanKt };
}

/** Share of time the crosswind on a runway axis stays within `limitKt`, averaged over seasons. */
export function crosswindCoverage(rose: WindRose, axisDeg: number, limitKt: number): number {
  let covered = 0;
  for (let s = 0; s < SEASONS; s++) {
    for (let b = 0; b < WIND_BINS; b++) {
      const f = rose.freq[s * WIND_BINS + b];
      const kt = rose.meanKt[s * WIND_BINS + b];
      const cross = Math.abs(sinLut((b * 22.5 - axisDeg) * DEG_TO_RAD));
      for (let k = 0; k < SPEED_CLASS.length; k++) {
        if (kt * SPEED_CLASS[k] * cross <= limitKt) covered += f * SPEED_WEIGHT[k];
      }
    }
  }
  return covered / SEASONS;
}

/** Ideal runway axis in whole degrees 0 to 179: best mean of jet (20 kt) and turboprop (15 kt) coverage. */
export function idealHeading(rose: WindRose): number {
  let best = 0;
  let bestScore = -1;
  for (let axis = 0; axis < 180; axis++) {
    const score = crosswindCoverage(rose, axis, 20) + crosswindCoverage(rose, axis, 15);
    if (score > bestScore + 1e-12) {
      bestScore = score;
      best = axis;
    }
  }
  return best;
}
