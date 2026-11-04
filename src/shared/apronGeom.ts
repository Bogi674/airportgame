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

/** An apron with a piece taken out: none, one or several shapes. */
export function cutShape(a: Pick<Apron, 'polygon' | 'holes'>, piece: readonly Pt[]): ApronShape[] {
  return fromClip(difference(toClip(a), toClip({ polygon: piece.slice() })));
}
