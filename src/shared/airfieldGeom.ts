import { apronContains } from '@shared/apronGeom';
import { compassVector, type AirfieldPayload, type Runway } from './airfield';
import { closestOnSegment, distToSegment, type Pt } from './geom';
import { cosLut, sinLut } from './trig';

const round05 = (v: number): number => Math.round(v * 2) / 2;

export const RAPID_EXIT_RADIUS_M: Record<30 | 45 | 90, number> = { 30: 450, 45: 200, 90: 70 };
export const RAPID_EXIT_STRAIGHT_M: Record<30 | 45 | 90, number> = { 30: 120, 45: 120, 90: 60 };

/** Centerline of a rapid exit leaving the runway centerline at `distM` from threshold A. */
export function rapidExitPoints(r: Runway, distM: number, side: 'left' | 'right', angleDeg: 30 | 45 | 90): Pt[] {
  const d = compassVector(r.headingDeg);
  const sign = side === 'left' ? 1 : -1;
  const n = { x: d.y * sign, y: -d.x * sign };
  const radius = RAPID_EXIT_RADIUS_M[angleDeg];
  const straight = RAPID_EXIT_STRAIGHT_M[angleDeg];
  const theta = (angleDeg * Math.PI) / 180;
  const steps = Math.max(4, Math.ceil(angleDeg / 6));
  const p0 = { x: r.x1 + d.x * distM, y: r.y1 + d.y * distM };
  const pts: Pt[] = [];
  for (let k = 0; k <= steps; k++) {
    const phi = (theta * k) / steps;
    pts.push({
      x: round05(p0.x + radius * sinLut(phi) * d.x + radius * (1 - cosLut(phi)) * n.x),
      y: round05(p0.y + radius * sinLut(phi) * d.y + radius * (1 - cosLut(phi)) * n.y),
    });
  }
  const end = pts[pts.length - 1];
  pts.push({
    x: round05(end.x + straight * (d.x * cosLut(theta) + n.x * sinLut(theta))),
    y: round05(end.y + straight * (d.y * cosLut(theta) + n.y * sinLut(theta))),
  });
  return pts;
}

/** Exit distance from the landing threshold that suits a medium jet: touchdown, then braking from 70 to 30 m/s. */
export function suggestedExitDistance(lengthM: number): number {
  const touchdown = 350;
  const braking = (70 * 70 - 30 * 30) / (2 * 2.2);
  return Math.round(Math.max(300, Math.min(lengthM - 300, touchdown + braking)));
}

/** Position along runway axis (s from threshold A) and signed lateral offset (positive is left of travel). */
export function runwayFrame(r: Runway, x: number, y: number): { s: number; lateral: number } {
  const d = compassVector(r.headingDeg);
  const dx = x - r.x1;
  const dy = y - r.y1;
  const s = dx * d.x + dy * d.y;
  // Left of travel is (d.y, -d.x).
  const lateral = dx * d.y + dy * -d.x;
  return { s, lateral };
}

export type PickKind = 'runway' | 'taxiway' | 'apron' | 'stand';
export interface Pick {
  kind: PickKind;
  id: number;
  dist: number;
}

/** Nearest airfield object to a world point within `tol` meters, stands first, then runways, taxiways, aprons. */
export function pickObject(af: AirfieldPayload, x: number, y: number, tol: number): Pick | null {
  let best: Pick | null = null;
  const consider = (kind: PickKind, id: number, dist: number, bias: number): void => {
    if (dist > tol) return;
    const score = dist + bias;
    if (!best || score < best.dist) best = { kind, id, dist: score };
  };
  for (const s of af.stands) consider('stand', s.id, Math.hypot(s.x - x, s.y - y), -1000);
  for (const r of af.runways) {
    const d = distToSegment(x, y, r.x1, r.y1, r.x2, r.y2);
    consider('runway', r.id, Math.max(0, d - r.widthM / 2 - r.shoulderM), -500);
  }
  for (const t of af.taxiways) {
    let d = Infinity;
    for (let i = 1; i < t.points.length; i++) d = Math.min(d, distToSegment(x, y, t.points[i - 1].x, t.points[i - 1].y, t.points[i].x, t.points[i].y));
    consider('taxiway', t.id, Math.max(0, d - t.widthM / 2), -400);
  }
  for (const a of af.aprons) if (apronContains(a, x, y)) consider('apron', a.id, 0, 0);
  return best;
}

/** Snaps a point to the nearest existing vertex or runway end within `radius`. */
export function snapToVertex(af: AirfieldPayload, x: number, y: number, radius: number): Pt | null {
  let best: Pt | null = null;
  let bestD = radius;
  const test = (px: number, py: number): void => {
    const d = Math.hypot(px - x, py - y);
    if (d < bestD) {
      bestD = d;
      best = { x: px, y: py };
    }
  };
  for (const t of af.taxiways) for (const p of t.points) test(p.x, p.y);
  for (const r of af.runways) {
    test(r.x1, r.y1);
    test(r.x2, r.y2);
  }
  for (const a of af.aprons) for (const p of a.polygon) test(p.x, p.y);
  return best;
}

/** Closest point on any runway or taxiway centerline within `radius`, for snapping connectors. */
export function snapToCenterline(af: AirfieldPayload, x: number, y: number, radius: number): Pt | null {
  let best: Pt | null = null;
  let bestD = radius;
  const c = { x: 0, y: 0, t: 0 };
  const test = (ax: number, ay: number, bx: number, by: number): void => {
    closestOnSegment(x, y, ax, ay, bx, by, c);
    const d = Math.hypot(x - c.x, y - c.y);
    if (d < bestD) {
      bestD = d;
      best = { x: c.x, y: c.y };
    }
  };
  for (const r of af.runways) test(r.x1, r.y1, r.x2, r.y2);
  for (const t of af.taxiways) for (let i = 1; i < t.points.length; i++) test(t.points[i - 1].x, t.points[i - 1].y, t.points[i].x, t.points[i].y);
  return best;
}

/**
 * Snaps a point to the pavement edge of a runway when it is within `radius` of it. With a previous
 * point the position along the runway is also matched to it when close, which gives a connector
 * that meets the runway at a right angle. It works the same for the first and the last point.
 */
export function snapToRunwayEdge(af: AirfieldPayload, x: number, y: number, radius: number, prev: Pt | null): Pt | null {
  let best: Pt | null = null;
  let bestD = radius;
  for (const r of af.runways) {
    const edge = r.widthM / 2 + r.shoulderM;
    const f = runwayFrame(r, x, y);
    if (f.s < -radius || f.s > r.lengthM + radius) continue;
    const side = f.lateral >= 0 ? 1 : -1;
    const d = Math.abs(Math.abs(f.lateral) - edge);
    if (d > bestD) continue;
    let s = Math.max(0, Math.min(r.lengthM, f.s));
    if (prev) {
      const fp = runwayFrame(r, prev.x, prev.y);
      // Same side only: a connector never crosses the runway.
      if (Math.sign(fp.lateral) === side && Math.abs(s - fp.s) < radius * 2.5) s = fp.s;
    }
    const dir = compassVector(r.headingDeg);
    const lat = side * edge;
    bestD = d;
    best = { x: r.x1 + dir.x * s + dir.y * lat, y: r.y1 + dir.y * s - dir.x * lat };
  }
  return best;
}

/**
 * Alignment guide: when a point is close to the line that continues an existing taxiway or runway
 * axis, or runs square to it, or lines up with the points of the current gesture, it snaps onto that
 * line. Returns the snapped point and the anchor the guide line starts from.
 */
export function alignGuide(af: AirfieldPayload, extra: readonly Pt[], x: number, y: number, tol: number): { p: Pt; from: Pt } | null {
  let best: { p: Pt; from: Pt } | null = null;
  let bestD = tol;
  const test = (ax: number, ay: number, ux: number, uy: number): void => {
    const l = Math.hypot(ux, uy);
    if (l < 1e-6) return;
    const dx = ux / l;
    const dy = uy / l;
    const along = (x - ax) * dx + (y - ay) * dy;
    if (Math.abs(along) < 20) return;
    const lat = Math.abs((x - ax) * dy - (y - ay) * dx);
    if (lat < bestD) {
      bestD = lat;
      best = { p: { x: ax + dx * along, y: ay + dy * along }, from: { x: ax, y: ay } };
    }
  };
  const anchor = (p: Pt, dirs: [number, number][]): void => {
    for (const [ux, uy] of dirs) {
      test(p.x, p.y, ux, uy);
      test(p.x, p.y, -uy, ux);
    }
  };
  for (const r of af.runways) {
    const d = compassVector(r.headingDeg);
    anchor({ x: r.x1, y: r.y1 }, [[d.x, d.y]]);
    anchor({ x: r.x2, y: r.y2 }, [[d.x, d.y]]);
  }
  for (const t of af.taxiways) {
    for (let i = 0; i < t.points.length; i++) {
      const dirs: [number, number][] = [];
      if (i > 0) dirs.push([t.points[i].x - t.points[i - 1].x, t.points[i].y - t.points[i - 1].y]);
      if (i < t.points.length - 1) dirs.push([t.points[i + 1].x - t.points[i].x, t.points[i + 1].y - t.points[i].y]);
      anchor(t.points[i], dirs);
    }
  }
  for (let i = 0; i < extra.length; i++) {
    const dirs: [number, number][] = [[0, 1]];
    if (i > 0) dirs.push([extra[i].x - extra[i - 1].x, extra[i].y - extra[i - 1].y]);
    anchor(extra[i], dirs);
  }
  return best;
}

/** Alignment frame angles in degrees (compass): one per runway, or north when there is none. */
export function frameHeadings(af: AirfieldPayload, fallback: number): number[] {
  if (af.runways.length === 0) return [fallback];
  return af.runways.map((r) => r.headingDeg);
}
