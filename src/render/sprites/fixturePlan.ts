/**
 * Canvas free draw planner for the fixture sprites. It decides which ops are drawn at a zoom tier, which fill and
 * stroke each op gets, which ops are overhead and which shadow outlines are built. The sprite baker and the
 * on screen renderer both consume the plan, so the gating lives in one place.
 *
 * Port of docs/reference/sprite-prototypes/fixture_ops.py (bake, _fill, _base, _area, _outline) and the color and
 * geometry helpers of fixture_core.py (mix, shade, hull, rect_pts, ell_pts). Keep the math exact.
 */
import type { FixtureOp } from '../../data/schemas';

export type Pt = readonly [number, number];
export type Tier = 1 | 2 | 3;
export type Rot = 0 | 90 | 180 | 270;

/** Shadow offset per meter of part height, fixture_core SUN. */
export const SUN: Pt = [0.13, 0.18];
/** Part heights above this many meters do not lengthen the shadow, fixture_core SH_CAP. */
export const SH_CAP = 2.6;
/** Shadow opacity and blur, fixture_ops.bake. */
export const SHADOW_ALPHA = 0.28;
export const SHADOW_BLUR_M = 0.07;

const DEFAULT_GRAD_COLOR = '#888888';
/** Light color of the screen glow gradient, fixture_core glow_grad. */
const GLOW_COLOR = '#9fd3f2';
const DEG = Math.PI / 180;
/** Area factor of a point list bounding box, fixture_ops._area. */
const BOX_AREA_FACTOR = 0.6;
/** Flat base colors used at tier 1, fixture_ops._base. A null entry drops the op. */
const FLAT_BASE: Record<string, string | null> = {
  screen: '#1d2a38',
  glow: null,
  water: '#7cc3e0',
  ramp: '#4a5058',
  escalator: '#b9c0c8',
};

type ShapeOp = Extract<FixtureOp, { k: 'r' | 'c' | 'e' | 'p' | 'a' }>;
type LineOp = Extract<FixtureOp, { k: 'l' }>;
type FillSpec = NonNullable<Extract<FixtureOp, { k: 'r' }>['f']>;
type StrokeSpec = NonNullable<Extract<FixtureOp, { k: 'r' }>['sw']>;

export type ResolvedFill =
  | { kind: 'color'; color: string }
  | { kind: 'grad'; g: string; c: string; a: 'h' | 'v' }
  | { kind: 'pat'; pat: 'perf' | 'weave' }
  | null;

export interface PlannedOp {
  op: FixtureOp;
  /** null means no fill, stroke only. */
  fill: ResolvedFill;
  stroke: string | null;
  /** Stroke width in meters, null when there is no stroke. */
  strokeM: number | null;
}

export interface FixturePlan {
  /** Floor layer ops (fl), drawn first, under the shadows and the bodies, and never casting a shadow. */
  floor: PlannedOp[];
  body: PlannedOp[];
  over: PlannedOp[];
  /** One convex shadow outline in sprite meters per kept shape op with a height. */
  shadows: Pt[][];
}

/** Python round: exact halves go to the even neighbour, as in the reference. */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

function blend(a: number, b: number, t: number): string {
  return roundHalfEven(a + (b - a) * t).toString(16).padStart(2, '0');
}

/** Linear blend of two hex colors, fixture_core mix. */
export function mix(c1: string, c2: string, t: number): string {
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);
  return `#${blend(r1, r2, t)}${blend(g1, g2, t)}${blend(b1, b2, t)}`;
}

/** f below zero darkens toward black, above zero lightens toward white, fixture_core shade. */
export function shade(c: string, f: number): string {
  return f < 0 ? mix(c, '#000000', -f) : mix(c, '#ffffff', f);
}

const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Points rounded to 4 decimals, as the reference does, with duplicates removed. */
const roundTo4 = (x: number): number => roundHalfEven(x * 10000) / 10000;

/** Convex hull (monotone chain) of the rounded, unique points, fixture_core hull. */
export function hull(pts: readonly Pt[]): Pt[] {
  const unique = new Map<string, Pt>();
  for (const [x, y] of pts) {
    const p: Pt = [roundTo4(x), roundTo4(y)];
    unique.set(`${p[0]},${p[1]}`, p);
  }
  const sorted = [...unique.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 2) return sorted;

  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Rectangle outline with optional corner radius rx, four points per corner, fixture_core rect_pts. */
export function rectPts(x: number, y: number, w: number, h: number, rx = 0): Pt[] {
  if (rx <= 0) {
    return [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
  }
  const r = Math.min(rx, w / 2, h / 2);
  const corners: [number, number, number][] = [
    [x + w - r, y + r, -90],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, 90],
    [x + r, y + r, 180],
  ];
  const out: Pt[] = [];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k < 4; k++) {
      const a = (a0 + k * 30) * DEG;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return out;
}

/** Ellipse outline with n points, fixture_core ell_pts. */
export function ellPts(cx: number, cy: number, rx: number, ry: number, n = 20): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) {
    out.push([cx + rx * Math.cos((2 * Math.PI * k) / n), cy + ry * Math.sin((2 * Math.PI * k) / n)]);
  }
  return out;
}

/** Zoom tier from pixels per meter. Tier 0 draws nothing. */
export function tierForZoom(pxPerM: number): 0 | Tier {
  if (pxPerM > 24) return 3;
  if (pxPerM >= 12) return 2;
  if (pxPerM >= 6) return 1;
  return 0;
}

/** Shadow offset of a part of height ht for the placement rotation, fixture_ops.bake. */
export function shadowOffset(ht: number, rot: Rot): Pt {
  const h = Math.min(ht, SH_CAP);
  const dx = SUN[0] * h;
  const dy = SUN[1] * h;
  if (rot === 0) return [dx, dy];
  if (rot === 90) return [dy, -dx];
  if (rot === 180) return [-dx, -dy];
  return [-dy, dx];
}

function strokeMeters(sw: StrokeSpec | undefined, ppm: number): number | null {
  if (sw === undefined) return null;
  return 'px' in sw ? sw.px / ppm : sw.m;
}

/** Area used by the tier gates, fixture_ops._area. Ellipses and circles use the reference 3.14. */
function shapeArea(op: ShapeOp): number {
  switch (op.k) {
    case 'r':
      return op.w * op.h;
    case 'c':
      return 3.14 * op.r ** 2;
    case 'e':
      return 3.14 * op.rx * op.ry;
    case 'p':
    case 'a': {
      const pts = op.k === 'p' ? op.p : op.shp;
      if (pts === undefined || pts.length === 0) return 1;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) * BOX_AREA_FACTOR;
    }
  }
}

/** Outline used for the shadow, fixture_ops._outline. */
function outlinePts(op: ShapeOp): Pt[] {
  switch (op.k) {
    case 'r':
      return rectPts(op.x, op.y, op.w, op.h, op.rx ?? 0);
    case 'c':
      return ellPts(op.x, op.y, op.r, op.r);
    case 'e': {
      const a = (op.rot ?? 0) * DEG;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      return ellPts(op.x, op.y, op.rx, op.ry).map(([x, y]): Pt => [
        op.x + (x - op.x) * cos - (y - op.y) * sin,
        op.y + (x - op.x) * sin + (y - op.y) * cos,
      ]);
    }
    case 'p':
      return op.p;
    case 'a':
      return op.shp ?? [];
  }
}

/** Applies the airline livery to a fill spec: a color or a gradient c is replaced, patterns keep their look. */
function withLivery(f: FillSpec | undefined, livery: string | null, fLiv: number | undefined): FillSpec | undefined {
  if (f === undefined || livery === null || fLiv === undefined) return f;
  const color = shade(livery, fLiv);
  if (typeof f === 'string') return color;
  if ('pat' in f) return f;
  return { ...f, c: color };
}

/**
 * Fill for a tier. Returns null for no fill, undefined when the op is dropped at this tier,
 * fixture_ops._fill and _base.
 */
function resolveFill(f: FillSpec | undefined, tier: Tier): ResolvedFill | undefined {
  if (f === undefined) return null;
  if (typeof f === 'string') return { kind: 'color', color: f };
  if ('pat' in f) return tier < 3 ? undefined : { kind: 'pat', pat: f.pat };
  if (tier === 1) {
    const flat = FLAT_BASE[f.g];
    const base = flat === undefined ? (f.c ?? DEFAULT_GRAD_COLOR) : flat;
    return base === null ? undefined : { kind: 'color', color: base };
  }
  return { kind: 'grad', g: f.g, c: f.c ?? DEFAULT_GRAD_COLOR, a: f.a ?? 'h' };
}

function planLine(op: LineOp, tier: Tier, ppm: number): PlannedOp | undefined {
  if (tier === 1) return undefined;
  if (tier === 2 && 'px' in op.sw && op.sw.px < 1) return undefined;
  return { op, fill: null, stroke: op.s, strokeM: strokeMeters(op.sw, ppm) };
}

function planShape(op: ShapeOp, tier: Tier, ppm: number, livery: string | null): PlannedOp | undefined {
  const h = op.ht ?? 0;
  if (op.k === 'a') {
    const hasShape = op.shp !== undefined && op.shp.length > 0;
    const px = op.sw !== undefined && 'px' in op.sw ? op.sw.px : 0;
    if (tier < 3 && !hasShape && op.f === undefined && px < 1.2) return undefined;
    if (tier === 1 && (!hasShape || h < 0.3)) return undefined;
  } else {
    const area = shapeArea(op);
    if (tier === 2 && area < 0.012) return undefined;
    if (tier === 1 && (area < 0.1 || h < 0.3)) return undefined;
  }

  const fill = resolveFill(withLivery(op.f, livery, op.fLiv), tier);
  if (fill === undefined) return undefined;

  let stroke = tier > 1 ? (op.s ?? null) : null;
  if (stroke !== null && livery !== null && op.sLiv !== undefined) stroke = shade(livery, op.sLiv);
  return { op, fill, stroke, strokeM: stroke === null ? null : strokeMeters(op.sw, ppm) };
}

function isShape(op: FixtureOp): op is ShapeOp {
  return op.k === 'r' || op.k === 'c' || op.k === 'e' || op.k === 'p' || op.k === 'a';
}

/** Plans one op, or returns undefined when the op is not drawn at this tier. */
function planOp(op: FixtureOp, tier: Tier, ppm: number, livery: string | null): PlannedOp | undefined {
  switch (op.k) {
    case 'l':
      return planLine(op, tier, ppm);
    case 't':
      return { op, fill: { kind: 'color', color: op.f }, stroke: null, strokeM: null };
    case 'glow':
      return tier >= 2 ? { op, fill: { kind: 'grad', g: 'glow', c: GLOW_COLOR, a: 'h' }, stroke: null, strokeM: null } : undefined;
    case 'air':
      return tier >= 2 ? { op, fill: null, stroke: null, strokeM: null } : undefined;
    default:
      return planShape(op, tier, ppm, livery);
  }
}

/**
 * Plan of one asset at a zoom tier and placement rotation. ppm is pixels per meter of the bake or view scale,
 * used only for pixel stroke widths. livery is a hex color or null to keep the exported colors.
 */
export function planFixture(ops: readonly FixtureOp[], tier: Tier, rot: Rot, ppm: number, livery: string | null): FixturePlan {
  const floor: PlannedOp[] = [];
  const body: PlannedOp[] = [];
  const over: PlannedOp[] = [];
  const shadows: Pt[][] = [];
  for (const op of ops) {
    const overhead = 'ov' in op && op.ov === 1;
    if (overhead && tier < 2) continue;
    const planned = planOp(op, tier, ppm, livery);
    if (planned === undefined) continue;
    const onFloor = 'fl' in op && op.fl === 1;
    (overhead ? over : onFloor ? floor : body).push(planned);
    if (!isShape(op) || overhead || onFloor) continue;
    const h = op.ht ?? 0;
    const outline = h > 0 ? outlinePts(op) : [];
    if (outline.length === 0) continue;
    const [dx, dy] = shadowOffset(h, rot);
    shadows.push(hull([...outline, ...outline.map(([x, y]): Pt => [x + dx, y + dy])]));
  }
  return { floor, body, over, shadows };
}
