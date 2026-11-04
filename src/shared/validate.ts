import { AIRFIELD, SURFACE_SPEC, SURFACE_DATA } from '@data/index';
import { cosLut, sinLut } from './trig';
import { bounds, pointInPolygon, polylineLength, type Pt } from './geom';
import { CELL_M, GRID_N, SITE_M } from './site';

/** What validation needs to know about the site. Both the sim and the UI can provide it. */
export interface BuildContext {
  heights: Float32Array;
  parcelId: Uint16Array;
  parcelOwner: Uint8Array;
}

export interface Problem {
  code: string;
  /** Values for the message placeholders. */
  args?: Record<string, string | number>;
}

const cellOf = (x: number, y: number): number => {
  const i = Math.floor(x / CELL_M);
  const j = Math.floor(y / CELL_M);
  if (i < 0 || j < 0 || i >= GRID_N || j >= GRID_N) return -1;
  return j * GRID_N + i;
};

/** Checks one point: inside the site, on land, on owned land. */
export function checkPoint(ctx: BuildContext, x: number, y: number): Problem | null {
  if (x < 0 || y < 0 || x >= SITE_M || y >= SITE_M) return { code: 'outsideSite' };
  const o = cellOf(x, y);
  if (o < 0) return { code: 'outsideSite' };
  if (ctx.heights[o] < 0) return { code: 'onWater' };
  if (ctx.parcelOwner[ctx.parcelId[o]] !== 1) return { code: 'notOwned' };
  return null;
}

/** Checks a pavement strip of the given width along a polyline. */
export function checkStrip(ctx: BuildContext, pts: readonly Pt[], widthM: number): Problem | null {
  const half = widthM / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const steps = Math.max(1, Math.ceil(len / (CELL_M / 2)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      for (const off of [-half, 0, half]) {
        const p = checkPoint(ctx, x + nx * off, y + ny * off);
        if (p) return p;
      }
    }
  }
  return null;
}

/** Checks every cell centre inside a polygon. */
export function checkPolygon(ctx: BuildContext, poly: readonly Pt[]): Problem | null {
  const b = bounds(poly);
  for (let y = Math.floor(b.minY / CELL_M) * CELL_M + CELL_M / 2; y <= b.maxY; y += CELL_M) {
    for (let x = Math.floor(b.minX / CELL_M) * CELL_M + CELL_M / 2; x <= b.maxX; x += CELL_M) {
      if (!pointInPolygon(x, y, poly)) continue;
      const p = checkPoint(ctx, x, y);
      if (p) return p;
    }
  }
  return null;
}

export function polygonArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a) / 2;
}

/** Estimated grading cost along a strip: height deviation from the end to end plane times area times the unit cost. */
export function stripGradingCost(ctx: BuildContext, pts: readonly Pt[], widthM: number): number {
  if (pts.length < 2) return 0;
  const total = polylineLength(pts);
  if (total === 0) return 0;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const o1 = cellOf(first.x, first.y);
  const o2 = cellOf(last.x, last.y);
  if (o1 < 0 || o2 < 0) return 0;
  const h1 = ctx.heights[o1];
  const h2 = ctx.heights[o2];
  let volume = 0;
  let walked = 0;
  const step = 20;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let d = 0; d < len; d += step) {
      const t = d / len;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const o = cellOf(x, y);
      if (o < 0) continue;
      const plane = h1 + (h2 - h1) * ((walked + d) / total);
      volume += Math.abs(ctx.heights[o] - plane) * widthM * step;
    }
    walked += len;
  }
  return Math.round(volume * AIRFIELD.gradingCostPerM3);
}

/** Endpoint of a line from (x, y) at a compass heading. Uses the lookup tables, so the sim stays deterministic. */
export function endpoint(x: number, y: number, headingDeg: number, lengthM: number): Pt {
  const a = (headingDeg * Math.PI) / 180;
  return { x: x + sinLut(a) * lengthM, y: y - cosLut(a) * lengthM };
}

/** Ids of parcels under a strip or polygon that the player does not own yet and that can be bought. */
export function unownedParcelsUnder(ctx: BuildContext, strip: { pts: readonly Pt[]; widthM: number } | { polygon: readonly Pt[] }): number[] {
  const ids = new Set<number>();
  const add = (x: number, y: number): void => {
    const o = cellOf(x, y);
    if (o < 0 || ctx.heights[o] < 0) return;
    const id = ctx.parcelId[o];
    if (ctx.parcelOwner[id] !== 1) ids.add(id);
  };
  if ('polygon' in strip) {
    const b = bounds(strip.polygon);
    for (let y = b.minY; y <= b.maxY; y += CELL_M) for (let x = b.minX; x <= b.maxX; x += CELL_M) if (pointInPolygon(x, y, strip.polygon)) add(x, y);
  } else {
    const half = strip.widthM / 2;
    for (let i = 1; i < strip.pts.length; i++) {
      const a = strip.pts[i - 1];
      const b = strip.pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) continue;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      for (let d = 0; d <= len; d += CELL_M / 2) {
        for (const off of [-half, 0, half]) add(a.x + ((b.x - a.x) * d) / len + nx * off, a.y + ((b.y - a.y) * d) / len + ny * off);
      }
    }
  }
  return Array.from(ids).sort((p, q) => p - q);
}

/** Estimated build cost of a pavement strip including grading, for previews. */
export function estimateStripCost(ctx: BuildContext, pts: readonly Pt[], widthM: number, surface: keyof typeof SURFACE_SPEC, tier: number): number {
  const tiers = SURFACE_SPEC[surface].pcrTiers;
  const i = Math.max(0, Math.min(tiers.length - 1, Math.floor(tier)));
  let len = 0;
  for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
  return Math.round(len * widthM * SURFACE_SPEC[surface].costPerM2 * (SURFACE_DATA.tierCostFactor[i] ?? 1)) + stripGradingCost(ctx, pts, widthM);
}
