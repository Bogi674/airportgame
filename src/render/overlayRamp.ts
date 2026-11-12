import { OVERLAY_MAX, type OverlayData, type OverlayKind } from '@shared/overlay';

/** Colour steps of the overlay ramp, from the good end to the bad end. */
export const RAMP_STEPS = 16;

/** Six digit hex colour to its red, green and blue channels. Throws on any other form. */
function hexChannels(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`Not a six digit hex colour: ${hex}`);
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** A six digit hex colour with an alpha, as a CSS rgba string. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexChannels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The overlay colour ramp: RAMP_STEPS rgba strings from ok through warn to bad. The first step is ok and the last
 * is bad. Built from theme tokens, so it is rebuilt only when the theme changes.
 */
export function buildRamp(ok: string, warn: string, bad: string, alpha: number): string[] {
  const okRgb = hexChannels(ok);
  const warnRgb = hexChannels(warn);
  const badRgb = hexChannels(bad);
  const out: string[] = [];
  for (let i = 0; i < RAMP_STEPS; i++) {
    const t = i / (RAMP_STEPS - 1);
    // The first half blends ok into warn, the second half blends warn into bad.
    const first = t <= 0.5;
    const from = first ? okRgb : warnRgb;
    const to = first ? warnRgb : badRgb;
    const u = first ? t * 2 : (t - 0.5) * 2;
    const r = Math.round(from[0] + (to[0] - from[0]) * u);
    const g = Math.round(from[1] + (to[1] - from[1]) * u);
    const b = Math.round(from[2] + (to[2] - from[2]) * u);
    out.push(`rgba(${r}, ${g}, ${b}, ${alpha})`);
  }
  return out;
}

/** Ramp step of a value against the scale maximum, 0 when the maximum is not positive, clamped to the ramp. */
export function rampIndex(value: number, max: number): number {
  if (max <= 0) return 0;
  const i = Math.floor((value / max) * RAMP_STEPS);
  return Math.max(0, Math.min(RAMP_STEPS - 1, i));
}

/** Largest value of an array, 0 when empty. */
function maxOf(a: ArrayLike<number>, below: number): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    if (v < below && v > m) m = v;
  }
  return m;
}

/**
 * Scale maximum of one overlay over every building: the highest density, the longest service wait, or the longest
 * reachable gate distance (unreachable gates are left out). Never below 1, so an empty overlay still scales.
 */
export function overlayMax(kind: OverlayKind, data: readonly OverlayData[]): number {
  let max = 1;
  for (let k = 0; k < data.length; k++) {
    const d = data[k]!;
    if (kind === 'density') max = Math.max(max, maxOf(d.density, Infinity));
    else if (kind === 'queue') max = Math.max(max, maxOf(d.nodeWaitS, Infinity));
    else if (kind === 'walk') max = Math.max(max, maxOf(d.gateDistM, OVERLAY_MAX));
  }
  return max;
}
