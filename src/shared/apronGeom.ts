import { difference, union, type MultiPolygon, type Polygon as ClipPolygon } from './clip';
import type { Apron } from './airfield';
import { pointInPolygon, type Pt } from './geom';

/**
 * Apron shapes (docs/DESIGN_REVISION_2.md section 4): a polygon with holes. Pieces of the same
 * surface that overlap or touch merge into one apron, and a cut takes a piece out of an apron.
 */

/** Grid the clipper input is snapped to, 5 cm: aprons are built on half meter points. */
const SNAP = 0.05;
const snap = (v: number): number => Math.round(v / SNAP) * SNAP;
/** Pieces of an apron smaller than this after a cut are dropped. */
const MIN_PART_M2 = 50;

export function ringArea(r: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const q = r[(i + 1) % r.length];
    a += r[i].x * q.y - q.x * r[i].y;
  }
  return Math.abs(a / 2);
}

export function apronArea(a: Pick<Apron, 'polygon' | 'holes'>): number {
  return ringArea(a.polygon) - (a.holes ?? []).reduce((s, h) => s + ringArea(h), 0);
}

export function apronContains(a: Pick<Apron, 'polygon' | 'holes'>, x: number, y: number): boolean {
  if (!pointInPolygon(x, y, a.polygon)) return false;
  for (const h of a.holes ?? []) if (pointInPolygon(x, y, h)) return false;
  return true;
}

const openRing = (r: [number, number][]): Pt[] => r.slice(0, -1).map(([x, y]) => ({ x, y }));

const toClip = (a: Pick<Apron, 'polygon' | 'holes'>): ClipPolygon => [a.polygon, ...(a.holes ?? [])].map((r) => r.map((p) => [snap(p.x), snap(p.y)] as [number, number]));

/** One apron shape: the outer ring and its holes, without the closing point the clipper repeats. */
export interface ApronShape {
  polygon: Pt[];
  holes: Pt[][];
}

function fromClip(mp: MultiPolygon): ApronShape[] {
  const open = (r: [number, number][]): Pt[] => r.slice(0, r.length - 1).map(([x, y]) => ({ x, y }));
  return mp
    .map((poly) => ({ polygon: open(poly[0]), holes: poly.slice(1).map(open) }))
    .filter((s) => s.polygon.length >= 3 && apronArea(s) >= MIN_PART_M2);
}

/** True when two shapes overlap or share an edge, so they would merge into one. */
export function touches(a: Pick<Apron, 'polygon' | 'holes'>, b: Pick<Apron, 'polygon' | 'holes'>): boolean {
  return union(toClip(a), toClip(b)).length === 1;
}

/** The union of a new piece with existing shapes. */
export function mergeShapes(piece: readonly Pt[], others: readonly Pick<Apron, 'polygon' | 'holes'>[]): ApronShape[] {
  return fromClip(union(toClip({ polygon: piece.slice() }), ...others.map(toClip)));
}

/** An apron with a region taken out: none, one or several shapes. */
export function cutRegion(a: Pick<Apron, 'polygon' | 'holes'>, region: MultiPolygon): ApronShape[] {
  return fromClip(difference(toClip(a), region));
}

/** The part of a piece that no apron covers, of any surface. */
export function freeRegion(piece: readonly Pt[], aprons: readonly Pick<Apron, 'polygon' | 'holes'>[]): MultiPolygon {
  return difference([toClip({ polygon: piece.slice() })], ...aprons.map(toClip));
}

/** Area of a clipped region, outer rings less their holes. */
export function regionArea(mp: MultiPolygon): number {
  let sum = 0;
  for (const poly of mp) {
    sum += ringArea(openRing(poly[0]));
    for (const hole of poly.slice(1)) sum -= ringArea(openRing(hole));
  }
  return sum;
}

/** Area of a piece that no apron covers. */
export function uncoveredArea(piece: readonly Pt[], aprons: readonly Pick<Apron, 'polygon' | 'holes'>[]): number {
  return regionArea(freeRegion(piece, aprons));
}

/** Overlap below this many square metres is a shared edge, not a clash. */
const OVERLAP_EPS_M2 = 0.01;

/** True when two polygons overlap by more than a hundredth of a square metre. */
export function overlaps(a: readonly Pt[], b: readonly Pt[]): boolean {
  return ringArea(a) - uncoveredArea(a, [{ polygon: [...b] }]) > OVERLAP_EPS_M2;
}

/** The union of a clipped region with existing shapes. */
export function mergeRegion(region: MultiPolygon, others: readonly Pick<Apron, 'polygon' | 'holes'>[]): ApronShape[] {
  return fromClip(union(region, ...others.map(toClip)));
}

/** The piece with every keeper polygon taken out of it: the area a removal may clear. */
export function clearOf(piece: readonly Pt[], keepers: readonly Pt[][]): MultiPolygon {
  return difference([toClip({ polygon: piece.slice() })], ...keepers.map((k) => toClip({ polygon: k })));
}

/**
 * One square capped box per segment of a polyline, so their union covers the pavement of a taxiway
 * at every bend. Used to keep an apron removal off built pavement.
 */
export function polylineBoxes(points: readonly Pt[], widthM: number): Pt[][] {
  const half = widthM / 2;
  const out: Pt[][] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const ux = ((b.x - a.x) / len) * half;
    const uy = ((b.y - a.y) / len) * half;
    const nx = -uy;
    const ny = ux;
    const p = { x: a.x - ux, y: a.y - uy };
    const q = { x: b.x + ux, y: b.y + uy };
    out.push([
      { x: p.x + nx, y: p.y + ny },
      { x: q.x + nx, y: q.y + ny },
      { x: q.x - nx, y: q.y - ny },
      { x: p.x - nx, y: p.y - ny },
    ]);
  }
  return out;
}
