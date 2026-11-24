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

/** Bends this close to straight keep their vertex, as in `nodeGeometry`. */
const STRAIGHT_TOL = (1 * PI) / 180;

/**
 * A polyline with every inner vertex replaced by its bend fillet of radius `r`, as the pavement and
 * paint draw a bend (`buildNode` and `nodeGeometry` in `pavement.ts`): both arms are cut at the
 * tangent distance, and a vertex whose tangents would overrun a segment shrinks its radius so the
 * two tangents on that segment share it in proportion. Arc points are at most `stepM` apart.
 */
export function roundCorners(pts: readonly Pt[], r: number, stepM: number): Pt[] {
  const n = pts.length;
  if (n < 3 || r <= 0) return pts.map((p) => ({ x: p.x, y: p.y }));
  const full: (Fillet | null)[] = [null];
  const flip: boolean[] = [false];
  for (let i = 1; i < n - 1; i++) {
    const v = pts[i];
    const a = wrapAngle(atan2Det(pts[i - 1].y - v.y, pts[i - 1].x - v.x));
    const b = wrapAngle(atan2Det(pts[i + 1].y - v.y, pts[i + 1].x - v.x));
    const th = wrapAngle(b - a);
    if (Math.abs(th - PI) < STRAIGHT_TOL) {
      full.push(null);
      flip.push(false);
      continue;
    }
    // The fillet turns in the positive direction from its first ray, so a turn the other way swaps them.
    const swap = th >= PI;
    full.push(swap ? fillet(v.x, v.y, b, a, 0, r) : fillet(v.x, v.y, a, b, 0, r));
    flip.push(swap);
  }
  full.push(null);
  const scale = new Array<number>(n).fill(1);
  for (let i = 1; i < n; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const na = full[i - 1]?.td ?? 0;
    const nb = full[i]?.td ?? 0;
    if (na + nb <= len) continue;
    if (na > 0) scale[i - 1] = Math.min(scale[i - 1], (len * (na / (na + nb))) / na);
    if (nb > 0) scale[i] = Math.min(scale[i], (len * (nb / (na + nb))) / nb);
  }
  const out: Pt[] = [{ x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < n - 1; i++) {
    const f0 = full[i];
    if (!f0) {
      out.push({ x: pts[i].x, y: pts[i].y });
      continue;
    }
    const v = pts[i];
    const a = wrapAngle(atan2Det(pts[i - 1].y - v.y, pts[i - 1].x - v.x));
    const b = wrapAngle(atan2Det(pts[i + 1].y - v.y, pts[i + 1].x - v.x));
    const f = scale[i] < 1 ? (flip[i] ? fillet(v.x, v.y, b, a, 0, r * scale[i]) : fillet(v.x, v.y, a, b, 0, r * scale[i])) : f0;
    const arc = arcPoints(f.cx, f.cy, f.r, f.a0, f.sweep, stepM);
    if (flip[i]) arc.reverse();
    for (const p of arc) out.push(p);
  }
  out.push({ x: pts[n - 1].x, y: pts[n - 1].y });
  return out;
}
