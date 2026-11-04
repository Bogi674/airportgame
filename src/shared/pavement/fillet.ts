import { atan2Det, cosLut, PI, sinLut, TWO_PI } from '../trig';
import type { Pt } from '../geom';

/**
 * Turn curve between two arms of a node, ported from `fillet()` in
 * docs/reference/geometry/netdraw.py. Angles are in radians in world space.
 */
export interface Fillet {
  /** Corner point: the node moved `off` into the sector along the bisector. */
  px: number;
  py: number;
  /** Arc center and radius. */
  cx: number;
  cy: number;
  r: number;
  /** Start angle of the arc at the tangent point on arm `a`, and the signed sweep to arm `b`. */
  a0: number;
  sweep: number;
  /** Distance from the corner point to each tangent point along the arms. */
  td: number;
}

/** Normalizes an angle to [0, 2 pi). */
export function wrapAngle(a: number): number {
  let r = a % TWO_PI;
  if (r < 0) r += TWO_PI;
  return r;
}

/**
 * Fillet in the sector turning from ray angle `a` to ray angle `b` in the positive direction,
 * with both lines offset `off` into the sector and radius `r`.
 */
export function fillet(nx: number, ny: number, a: number, b: number, off: number, r: number): Fillet {
  const th = wrapAngle(b - a);
  const dax = cosLut(a);
  const day = sinLut(a);
  const dbx = cosLut(b);
  const dby = sinLut(b);
  let bx = dax + dbx;
  let by = day + dby;
  const bl = Math.sqrt(bx * bx + by * by);
  bx /= bl;
  by /= bl;
  const sh = sinLut(th / 2);
  const ch = cosLut(th / 2);
  const px = nx + (bx * off) / sh;
  const py = ny + (by * off) / sh;
  const td = (r * ch) / sh;
  const tax = px + dax * td;
  const tay = py + day * td;
  const tbx = px + dbx * td;
  const tby = py + dby * td;
  const cx = px + (bx * r) / sh;
  const cy = py + (by * r) / sh;
  const a0 = atan2Det(tay - cy, tax - cx);
  const a1 = atan2Det(tby - cy, tbx - cx);
  let sweep = (a1 - a0 + PI) % TWO_PI;
  if (sweep < 0) sweep += TWO_PI;
  sweep -= PI;
  return { px, py, cx, cy, r, a0, sweep, td };
}

/** Points on an arc, at most `stepM` apart along a circle of radius `r`, endpoints included. */
export function arcPoints(cx: number, cy: number, r: number, a0: number, sweep: number, stepM: number): Pt[] {
  const n = Math.max(4, Math.ceil((Math.abs(sweep) * r) / stepM));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + (sweep * i) / n;
    out.push({ x: cx + r * cosLut(t), y: cy + r * sinLut(t) });
  }
  return out;
}
