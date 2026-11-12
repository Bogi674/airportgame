/**
 * Aircraft hard footprint, overhead zones and the vehicle clash check, in a local frame in meters.
 * x is lateral with the right wing positive, y runs along the fuselage with the nose at 0, nose up.
 *
 * Ports `boundary`, `place_aircraft` (identity placement here) and `check` for one vehicle against
 * one aircraft from docs/reference/sprite-prototypes/gse.py, and `hw`, `fuselage_pts` and
 * `wing_right` (with R = 0, as `boundary` calls it) from air2.py. The TS origin of the same shapes
 * is src/render/sprites/geometry.ts, which is render code, so the pure math is copied here.
 */
import { z } from 'zod';
import { pointInPolygon, segmentIntersection, type Pt } from './geom';
import { cosLut, PI, sinLut } from './trig';

export type Poly = readonly Pt[];

const engineSchema = z
  .object({
    kind: z.enum(['fan', 'rear', 'prop']),
    /** Lateral offset of the right engine centre. */
    y: z.number(),
    /** Longitudinal position of the nacelle front, nose at 0. */
    x: z.number(),
    len: z.number().positive(),
    d: z.number().positive(),
    prop_d: z.number().positive().optional(),
  })
  .refine((e) => e.kind !== 'prop' || e.prop_d !== undefined, { message: 'prop engines need prop_d' });

/** Sprite geometry fields that the footprint reads. Stored in the `spriteBases` block of aircraft.mvp.json. */
export const footprintSpecSchema = z.object({
  fw: z.number().positive(),
  L: z.number().positive(),
  nose: z.number().positive(),
  nose_n: z.number().default(1.2),
  nose_m: z.number().default(0.6),
  tail: z.number().positive(),
  tail_end: z.number().default(0.3),
  tail_p: z.number().default(1.35),
  wing: z.object({
    x: z.number(),
    c: z.number().positive(),
    sweep: z.number(),
    kink: z.number(),
    tip: z.number(),
    sb: z.number().positive(),
    te_in: z.number().default(0),
    kink_round: z.number().default(0.35),
    rake: z.number().optional(),
    rake_extra: z.number().default(15),
  }),
  hstab: z.object({
    x: z.number(),
    c: z.number().positive(),
    sweep: z.number(),
    span: z.number().positive(),
    tip: z.number(),
  }),
  engines: z.array(engineSchema).default([]),
  gear: z.object({ nose: z.number(), wheelbase: z.number(), track: z.number() }).optional(),
  heights: z
    .object({ wing: z.number().default(3.0), stab: z.number().default(5.4) })
    .default({ wing: 3.0, stab: 5.4 }),
});

export type FootprintSpec = z.infer<typeof footprintSpecSchema>;

export interface OverheadZone {
  poly: Poly;
  /** Underside height above the ground in meters. A vehicle at least this tall cannot pass under it. */
  heightM: number;
}

export interface AircraftBoundary {
  hard: Poly[];
  over: OverheadZone[];
}

export interface FootprintVehicle {
  poly: Poly;
  heightM: number;
  /** Docking vehicles may touch the hard footprint up to `dockTolM2`. */
  docks: boolean;
}

/** Degrees to radians with the same factor as Python's math.radians. */
function radians(deg: number): number {
  return deg * (PI / 180);
}

/** Tangent from the lookup table sine and cosine, so state math stays deterministic (hard rule 2). */
function tanDeg(deg: number): number {
  const a = radians(deg);
  return sinLut(a) / cosLut(a);
}

/** Fuselage half width at station y, ports `hw` in air2.py. */
function halfWidthAt(f: FootprintSpec, y: number): number {
  const R = f.fw / 2;
  if (y <= 0) return 0;
  if (y < f.nose) {
    // Ogive nose fitted to a measured 777 photo.
    const t = y / f.nose;
    return R * (1 - (1 - t) ** f.nose_n) ** f.nose_m;
  }
  const ts = f.L - f.tail;
  if (y > ts) {
    const u = Math.min(1, (y - ts) / f.tail);
    return R - (R - f.tail_end) * u ** f.tail_p;
  }
  return R;
}

/** Fuselage outline, right side then mirrored left side, ports `fuselage_pts` with its default 90 samples. */
function fuselagePoly(f: FootprintSpec): Pt[] {
  const n = 90;
  const samples: number[] = [];
  for (let i = 0; i <= n; i++) samples.push(f.L * (i / n) ** 1.0);
  for (let i = 0; i <= 60; i++) samples.push(f.nose * (i / 60) ** 2.2);
  samples.sort((a, b) => a - b);
  const ys = samples.filter((y, i) => i === 0 || y !== samples[i - 1]);
  const right = ys.map((y): Pt => ({ x: halfWidthAt(f, y), y }));
  const left = right.map((p): Pt => ({ x: -p.x, y: p.y })).reverse();
  return [...right, ...left];
}

/** Right wing planform from fuselage side to tip, ports `wing_right` with R = 0. */
function wingRightPoly(f: FootprintSpec): Pt[] {
  const w = f.wing;
  const R = 0;
  const sb = w.sb;
  const pts: Pt[] = [{ x: R, y: w.x }];
  let tipLeading: Pt;
  if (w.rake) {
    const rb = sb - w.rake;
    const B: Pt = { x: rb, y: w.x + (rb - R) * tanDeg(w.sweep) };
    tipLeading = { x: sb, y: B.y + w.rake * tanDeg(w.sweep + w.rake_extra) };
    pts.push(B, tipLeading);
  } else {
    tipLeading = { x: sb, y: w.x + (sb - R) * tanDeg(w.sweep) };
    pts.push(tipLeading);
  }
  const tip: Pt = { x: sb, y: tipLeading.y + w.tip };
  const K: Pt = { x: w.kink, y: w.x + w.c + (w.kink - R) * tanDeg(w.te_in) };
  const Z: Pt = { x: R, y: w.x + w.c };
  const kr = w.kink_round;
  if (kr > 0) {
    const a: Pt = { x: K.x + (Z.x - K.x) * kr, y: K.y + (Z.y - K.y) * kr };
    const b: Pt = { x: K.x + (tip.x - K.x) * kr * 0.5, y: K.y + (tip.y - K.y) * kr * 0.5 };
    pts.push(tip);
    // Quadratic curve from b through the kink K to a, 13 samples as in air2.py.
    for (let i = 0; i < 13; i++) {
      const t = i / 12;
      pts.push({
        x: (1 - t) ** 2 * b.x + 2 * (1 - t) * t * K.x + t * t * a.x,
        y: (1 - t) ** 2 * b.y + 2 * (1 - t) * t * K.y + t * t * a.y,
      });
    }
    pts.push(Z);
  } else {
    pts.push(tip, K, Z);
  }
  return pts;
}

/** Mirror a right side outline into a closed polygon: right side, then the left side back to the start. */
function mirrored(right: readonly Pt[]): Pt[] {
  return [...right, ...right.map((p): Pt => ({ x: -p.x, y: p.y })).reverse()];
}

/** Axis aligned rectangle, ports shapely `box`. */
function box(x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * Hard footprint (nothing may enter) and overhead zones with underside height, ports `boundary`.
 * The fuselage, every engine box and every gear box are hard. The wing and the stabilizer are overhead.
 */
export function aircraftBoundary(spec: FootprintSpec): AircraftBoundary {
  const hard: Pt[][] = [fuselagePoly(spec)];
  for (const e of spec.engines) {
    for (const sg of [-1, 1]) {
      const x = sg * e.y;
      if (e.kind === 'fan' || e.kind === 'rear') {
        hard.push(box(x - e.d / 2, e.x - 0.1 * e.len, x + e.d / 2, e.x + e.len * 1.15));
      } else {
        const propD = e.prop_d ?? e.d;
        hard.push(box(x - e.d / 2, e.x, x + e.d / 2, e.x + e.len));
        hard.push(box(x - propD / 2, e.x - 0.4, x + propD / 2, e.x + 0.3));
      }
    }
  }
  if (spec.gear) {
    const { nose: ny, wheelbase: wb, track: tr } = spec.gear;
    hard.push(box(-0.6, ny - 0.8, 0.6, ny + 0.8));
    for (const sg of [-1, 1]) {
      hard.push(box(sg * (tr / 2) - 0.9, ny + wb - 1.2, sg * (tr / 2) + 0.9, ny + wb + 1.2));
    }
  }
  const wing = mirrored(wingRightPoly(spec));
  const h = spec.hstab;
  const sb = h.span / 2;
  const sweepY = h.x + sb * tanDeg(h.sweep);
  const stab = mirrored([
    { x: 0, y: h.x },
    { x: sb, y: sweepY },
    { x: sb, y: sweepY + h.tip },
    { x: 0, y: h.x + h.c },
  ]);
  return {
    hard,
    over: [
      { poly: wing, heightM: spec.heights.wing },
      { poly: stab, heightM: spec.heights.stab },
    ],
  };
}

/** Convex hull, counter clockwise (monotone chain). Deterministic: the input is sorted by x then y. */
function convexHull(points: readonly Pt[]): Pt[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Buffer of a polygon by r, approximated as the convex hull of the polygon plus an octagon. The
 * octagon vertices sit on r / cos(PI / 8), so its edges are at least r from the centre and the
 * result contains the round buffer of radius r. The hard set is convex apart from the fuselage,
 * which is convex in practice, so the hull adds little.
 */
function bufferedHull(poly: Poly, r: number): Pt[] {
  const vertexR = r / cosLut(PI / 8);
  const octagon: Pt[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * PI) / 4;
    octagon.push({ x: vertexR * cosLut(a), y: vertexR * sinLut(a) });
  }
  const sums: Pt[] = [];
  for (const p of poly) {
    for (const o of octagon) sums.push({ x: p.x + o.x, y: p.y + o.y });
  }
  return convexHull(sums);
}

function shoelaceArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Cross product of ab and ap. Positive when p lies left of the directed line a to b. */
function sideOf(a: Pt, b: Pt, p: Pt): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** Sutherland Hodgman clip of any subject polygon by a convex counter clockwise clipper. */
function clipToConvex(subject: Poly, convex: readonly Pt[]): Pt[] {
  let out: Pt[] = [...subject];
  for (let i = 0; i < convex.length && out.length > 0; i++) {
    const a = convex[i];
    const b = convex[(i + 1) % convex.length];
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const sp = sideOf(a, b, p);
      const sq = sideOf(a, b, q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  return out;
}

/** Whether two polygons share any point, touching included. Checks edge crossings, then containment. */
function polygonsIntersect(a: Poly, b: Poly): boolean {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentIntersection(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y, b2.x, b2.y) >= 0) return true;
    }
  }
  return pointInPolygon(a[0].x, a[0].y, b) || pointInPolygon(b[0].x, b[0].y, a);
}

/**
 * Checks one vehicle against one aircraft, ports `check` for a single pair. Returns the first clash
 * as a message, or null when the vehicle is clear. The hard rule buffers each hard part by
 * `clearanceM`, then allows `dockTolM2` of overlap only for docking vehicles. The overhead rule
 * blocks a vehicle that touches an overhead zone when the vehicle is at least as tall as its underside.
 * Frame: `hard`, `over` and `vehicle.poly` must all be in the aircraft local frame, nose up, meters
 * (see `toAircraftLocal`).
 */
export function footprintClash(
  hard: readonly Poly[],
  over: readonly OverheadZone[],
  vehicle: FootprintVehicle,
  clearanceM = 0.5,
  dockTolM2 = 0.8,
): string | null {
  const allowed = vehicle.docks ? dockTolM2 : 0;
  for (const h of hard) {
    const overlap = shoelaceArea(clipToConvex(vehicle.poly, bufferedHull(h, clearanceM)));
    if (overlap > allowed) return `vehicle enters an aircraft hard footprint (${overlap.toFixed(2)} m2)`;
  }
  for (const o of over) {
    if (vehicle.heightM >= o.heightM && polygonsIntersect(vehicle.poly, o.poly)) {
      return `vehicle is ${vehicle.heightM} m tall but passes under a part only ${o.heightM} m high`;
    }
  }
  return null;
}

/**
 * Two vehicle footprints closer than gapM, ports the pairwise test in `check` (buffer gap / 2 each).
 * Frame: both polygons must be in the same frame. The test is frame independent, and the
 * aircraft local frame (nose up, meters, see `toAircraftLocal`) is the one the game uses.
 */
export function vehiclesTouch(a: { poly: Poly }, b: { poly: Poly }, gapM = 0.3): boolean {
  return polygonsIntersect(bufferedHull(a.poly, gapM / 2), bufferedHull(b.poly, gapM / 2));
}

/**
 * Maps a world polygon into the aircraft local frame: origin at the nose tip (cx, cy), y pointing
 * aft along the fuselage (nose at 0, tail at +L), x pointing to the aircraft's right. The heading
 * is the unit vector from the tail to the nose in world axes, passed as cos and sin by the caller so
 * no trig runs here. Example: nose heading (0, 1) gives aft = -y and right = +x.
 */
export function toAircraftLocal(poly: Poly, cx: number, cy: number, headingCos: number, headingSin: number): Pt[] {
  return poly.map((p): Pt => {
    const rx = p.x - cx;
    const ry = p.y - cy;
    return {
      x: rx * headingSin - ry * headingCos,
      y: -(rx * headingCos + ry * headingSin),
    };
  });
}
