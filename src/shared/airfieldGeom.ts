import { BUSINESS, GROUND } from '@data/index';
import { buildingRect, depotRect } from './roadGraph';
import { apronContains } from '@shared/apronGeom';
import { compassVector, towerRect, type AirfieldPayload, type Runway } from './airfield';
import { standBox } from './clearance';
import { closestOnSegment, distToSegment, pointInPolygon, type Pt } from './geom';
import { standSlot } from './standGeom';
import { cosLut, sinLut } from './trig';

const round05 = (v: number): number => Math.round(v * 2) / 2;

export const RAPID_EXIT_RADIUS_M: Record<30 | 45 | 90, number> = { 30: 450, 45: 200, 90: 70 };
export const RAPID_EXIT_STRAIGHT_M: Record<30 | 45 | 90, number> = { 30: 120, 45: 120, 90: 60 };

/** Centerline of a rapid exit leaving the runway centerline at `distM` from the landing threshold (A unless `landingEnd` is b), on `side` of the landing direction. */
export function rapidExitPoints(r: Runway, distM: number, side: 'left' | 'right', angleDeg: 30 | 45 | 90, landingEnd: 'a' | 'b' = 'a'): Pt[] {
  // Landing over threshold B runs from B toward A, so the exit is measured from B and turns off the other way.
  const fromB = landingEnd === 'b';
  const d = compassVector(fromB ? (r.headingDeg + 180) % 360 : r.headingDeg);
  const t0 = fromB ? { x: r.x2, y: r.y2 } : { x: r.x1, y: r.y1 };
  const sign = side === 'left' ? 1 : -1;
  const n = { x: d.y * sign, y: -d.x * sign };
  const radius = RAPID_EXIT_RADIUS_M[angleDeg];
  const straight = RAPID_EXIT_STRAIGHT_M[angleDeg];
  const theta = (angleDeg * Math.PI) / 180;
  const steps = Math.max(4, Math.ceil(angleDeg / 6));
  const p0 = { x: t0.x + d.x * distM, y: t0.y + d.y * distM };
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

export type PickKind = 'runway' | 'taxiway' | 'apron' | 'stand' | 'tower' | 'road' | 'depot' | 'building';
export interface Pick {
  kind: PickKind;
  id: number;
  dist: number;
}

/** Nearest airfield object to a world point within `tol` meters, towers first, then stands (their whole box), runways, taxiways, aprons. */
export function pickObject(af: AirfieldPayload, x: number, y: number, tol: number): Pick | null {
  let best: Pick | null = null;
  const consider = (kind: PickKind, id: number, dist: number, bias: number): void => {
    if (dist > tol) return;
    const score = dist + bias;
    if (!best || score < best.dist) best = { kind, id, dist: score };
  };
  for (const tw of af.towers ?? []) {
    // The footprint grown by the pick tolerance on every side, as an axis aligned square.
    const side = BUSINESS.tower.footprintM + 2 * tol;
    const corners = towerRect(tw.x, tw.y, side);
    const inside = x >= corners[0].x && x <= corners[1].x && y >= corners[0].y && y <= corners[2].y;
    if (inside) consider('tower', tw.id, 0, -1200);
  }
  for (const d of af.depots ?? []) if (pointInPolygon(x, y, depotRect(d))) consider('depot', d.id, 0, -1100);
  for (const b of af.buildings ?? []) if (pointInPolygon(x, y, buildingRect(b))) consider('building', b.id, 0, -1100);
  for (const r of af.roads ?? []) {
    let d = Infinity;
    for (let i = 1; i < r.points.length; i++) d = Math.min(d, distToSegment(x, y, r.points[i - 1].x, r.points[i - 1].y, r.points[i].x, r.points[i].y));
    // A road wins over the apron under it but not over a stand box it runs beside.
    consider('road', r.id, Math.max(0, d - GROUND.road.widthM / 2), -300);
  }
  for (const s of af.stands) {
    // Anywhere on the stand box picks the stand, so it wins over the apron it sits on; else the stop point within tol.
    const slot = standSlot(s.size);
    const inside = slot !== null && pointInPolygon(x, y, standBox(s, slot));
    consider('stand', s.id, inside ? 0 : Math.hypot(s.x - x, s.y - y), -1000);
  }
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

/** What a guide line follows (T84). `gesture` is the segment being drawn, `world` the north and east axes. */
export type GuideKind = 'runway' | 'taxiway' | 'apron' | 'gesture' | 'world';

export interface GuideLine {
  /** The anchor the line starts from and the point on it nearest the pointer. */
  from: Pt;
  to: Pt;
  kind: GuideKind;
  /** True for the line at right angles to what it follows. For `world`, true is the east west axis. */
  square: boolean;
}

export interface GuideHit {
  p: Pt;
  from: Pt;
  /** One guide, or two when the point sits where two guides cross. */
  lines: GuideLine[];
}

/** Guides closer than this many degrees to parallel never make a crossing. */
const CROSS_MIN_SIN = Math.sin((10 * Math.PI) / 180);
/** A guide does not snap within this distance of its own anchor, where every line would pass. */
const GUIDE_MIN_ALONG_M = 20;
/** A gesture point this close to a taxiway centerline or apron edge lies on it. */
const ON_LINE_M = 0.5;

interface Cand {
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  lat: number;
  along: number;
  kind: GuideKind;
  square: boolean;
}

/**
 * Alignment guides (T84): lines that continue a runway or taxiway axis or an apron edge, the lines at
 * right angles to them, the last segment of the current gesture and its square, and the world axes
 * through the gesture's points as the lowest priority. A point near one line snaps onto it; a point
 * near the crossing of two lines that are not parallel snaps onto the crossing, so a corner can be
 * square to a taxiway and in line with an apron edge at once.
 */
export function alignGuide(af: AirfieldPayload, extra: readonly Pt[], x: number, y: number, tol: number): GuideHit | null {
  const cands: Cand[] = [];
  const test = (ax: number, ay: number, ux: number, uy: number, kind: GuideKind, square: boolean): void => {
    const l = Math.hypot(ux, uy);
    if (l < 1e-6) return;
    const dx = ux / l;
    const dy = uy / l;
    const along = (x - ax) * dx + (y - ay) * dy;
    if (Math.abs(along) < GUIDE_MIN_ALONG_M) return;
    const lat = Math.abs((x - ax) * dy - (y - ay) * dx);
    // Crossings may sit up to the tolerance from each line, so keep a little more than the snap band.
    if (lat < tol * 1.5) cands.push({ ax, ay, dx, dy, lat, along, kind, square });
  };
  const anchor = (p: Pt, dirs: readonly (readonly [number, number])[], kind: GuideKind): void => {
    for (const [ux, uy] of dirs) {
      test(p.x, p.y, ux, uy, kind, false);
      test(p.x, p.y, -uy, ux, kind, true);
    }
  };
  for (const r of af.runways) {
    const d = compassVector(r.headingDeg);
    anchor({ x: r.x1, y: r.y1 }, [[d.x, d.y]], 'runway');
    anchor({ x: r.x2, y: r.y2 }, [[d.x, d.y]], 'runway');
  }
  for (const t of af.taxiways) {
    for (let i = 0; i < t.points.length; i++) {
      const dirs: [number, number][] = [];
      if (i > 0) dirs.push([t.points[i].x - t.points[i - 1].x, t.points[i].y - t.points[i - 1].y]);
      if (i < t.points.length - 1) dirs.push([t.points[i + 1].x - t.points[i].x, t.points[i + 1].y - t.points[i].y]);
      anchor(t.points[i], dirs, 'taxiway');
    }
  }
  for (const a of af.aprons) {
    const poly = a.polygon;
    for (let i = 0; i < poly.length; i++) {
      const prev = poly[(i + poly.length - 1) % poly.length];
      const next = poly[(i + 1) % poly.length];
      anchor(poly[i], [[poly[i].x - prev.x, poly[i].y - prev.y], [next.x - poly[i].x, next.y - poly[i].y]], 'apron');
    }
  }
  for (let i = 0; i < extra.length; i++) {
    if (i > 0) anchor(extra[i], [[extra[i].x - extra[i - 1].x, extra[i].y - extra[i - 1].y]], 'gesture');
    // A gesture point laid on a taxiway centerline or an apron edge also guides along and square to it.
    const on = lineThrough(af, extra[i]);
    if (on) anchor(extra[i], [[on.dx, on.dy]], on.kind);
    anchor(extra[i], [[0, 1]], 'world');
  }
  if (cands.length === 0) return null;
  // The same line can come several ways, such as an edge's own line and the square of its neighbour,
  // or a world axis along an edge. It is named by the best of them: a real edge over the world axes,
  // then its own line over a square.
  const rank = (c: Cand): number => (c.kind === 'world' ? 2 : 0) + (c.square ? 1 : 0);
  for (let i = 0; i < cands.length; i++) {
    for (let j = 0; j < cands.length; j++) {
      const a = cands[i];
      const b = cands[j];
      if (rank(b) >= rank(a) || Math.abs(a.dx * b.dy - a.dy * b.dx) > 1e-6 || Math.abs((b.ax - a.ax) * a.dy - (b.ay - a.ay) * a.dx) > 1e-3) continue;
      a.kind = b.kind;
      a.square = b.square;
    }
  }
  const line = (c: Cand, p: Pt): GuideLine => ({ from: { x: c.ax, y: c.ay }, to: p, kind: c.kind, square: c.square });
  // Two guides that cross near the pointer win over a single one; a pair without the world axes wins over one with them.
  let cross: { p: Pt; a: Cand; b: Cand; d: number; world: boolean } | null = null;
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const a = cands[i];
      const b = cands[j];
      if (a.lat >= tol || b.lat >= tol) continue;
      const den = a.dx * b.dy - a.dy * b.dx;
      if (Math.abs(den) < CROSS_MIN_SIN) continue;
      const t = ((b.ax - a.ax) * b.dy - (b.ay - a.ay) * b.dx) / den;
      const p = { x: a.ax + a.dx * t, y: a.ay + a.dy * t };
      const d = Math.hypot(p.x - x, p.y - y);
      if (d >= tol) continue;
      const world = a.kind === 'world' || b.kind === 'world';
      if (!cross || (cross.world && !world) || (cross.world === world && d < cross.d)) cross = { p, a, b, d, world };
    }
  }
  if (cross) return { p: cross.p, from: { x: cross.a.ax, y: cross.a.ay }, lines: [line(cross.a, cross.p), line(cross.b, cross.p)] };
  let best: Cand | null = null;
  for (const c of cands) {
    if (c.lat >= tol) continue;
    if (!best || (best.kind === 'world' && c.kind !== 'world')) {
      best = c;
      continue;
    }
    if ((best.kind === 'world') !== (c.kind === 'world')) continue;
    // The same line can come as one edge's own line and the square of its neighbour: name it by the edge.
    if (c.lat < best.lat - 1e-9 || (Math.abs(c.lat - best.lat) <= 1e-9 && best.square && !c.square)) best = c;
  }
  if (!best) return null;
  const p = { x: best.ax + best.dx * best.along, y: best.ay + best.dy * best.along };
  return { p, from: { x: best.ax, y: best.ay }, lines: [line(best, p)] };
}

/** The taxiway centerline or apron edge a point lies on, with its direction, or null. */
function lineThrough(af: AirfieldPayload, p: Pt): { dx: number; dy: number; kind: GuideKind } | null {
  const c = { x: 0, y: 0, t: 0 };
  const on = (a: Pt, b: Pt): boolean => {
    closestOnSegment(p.x, p.y, a.x, a.y, b.x, b.y, c);
    return Math.hypot(c.x - p.x, c.y - p.y) < ON_LINE_M;
  };
  for (const t of af.taxiways) {
    for (let i = 1; i < t.points.length; i++) if (on(t.points[i - 1], t.points[i])) return { dx: t.points[i].x - t.points[i - 1].x, dy: t.points[i].y - t.points[i - 1].y, kind: 'taxiway' };
  }
  for (const a of af.aprons) {
    for (let i = 0; i < a.polygon.length; i++) {
      const u = a.polygon[i];
      const v = a.polygon[(i + 1) % a.polygon.length];
      if (on(u, v)) return { dx: v.x - u.x, dy: v.y - u.y, kind: 'apron' };
    }
  }
  return null;
}

/** Alignment frame angles in degrees (compass): one per runway, or north when there is none. */
export function frameHeadings(af: AirfieldPayload, fallback: number): number[] {
  if (af.runways.length === 0) return [fallback];
  return af.runways.map((r) => r.headingDeg);
}
