import { SPRITE_BASES, standGeometry, type AircraftSpec } from '@data/aircraft';
import { STAND_MARKINGS, STAND_SIZES } from '@data/index';
import type { Stand, StandSize } from '@shared/airfield';
import type { Pt } from '@shared/geom';
import { standSlot, standTypes, stopBarOffset } from '@shared/standGeom';
import type { StandFork } from '@shared/standFork';
import { buildGeometry, type Pt2 } from '../sprites/geometry';

/**
 * Stand marking layout in stand local meters (docs/DESIGN_REVISION_2.md section 3, ported from
 * fig4_stand_data.py and fig5.py): x across the stand to the right of the parked aircraft, y away from
 * the taxilane centerline (y = 0). The fork radius D is the stand safety line, the stop bars sit near
 * the stand top, and the funnel keeps the front corners clear of every assigned type.
 */

const MK = STAND_MARKINGS;

export interface StopBar {
  y: number;
  label: string;
  /** Right end of the bar: the largest fuselage half width plus a meter. */
  halfW: number;
}

export interface Funnel {
  /** Funnel start on the stand side (y = ys at the restraint line), nose point (x = n, y = yn). */
  ys: number;
  n: number;
  yn: number;
}

export interface StandLayout {
  size: StandSize;
  /** Frame: origin on the taxilane centerline, y along `axis`, x along `right`. */
  origin: Pt;
  axis: Pt;
  right: Pt;
  D: number;
  W: number;
  top: number;
  /** Types the stand is drawn for, largest first, one stop bar each. */
  types: AircraftSpec[];
  bars: StopBar[];
  /** Nose position of the first type. */
  nose0: number;
  funnel: Funnel | null;
  zones: FrontZones | null;
}

export const toWorld = (l: Pick<StandLayout, 'origin' | 'axis' | 'right'>, x: number, y: number): Pt => ({
  x: l.origin.x + l.right.x * x + l.axis.x * y,
  y: l.origin.y + l.right.y * x + l.axis.y * y,
});

/** Planform outline polygons of a type in stand local meters, nose at y = noseY pointing to +y. */
export function typeOutlines(a: AircraftSpec, noseY: number): Pt[][] {
  const base = SPRITE_BASES[a.sprite.base];
  if (!base) return [];
  const g = buildGeometry(base);
  const map = (poly: readonly Pt2[]): Pt[] => poly.map((p) => ({ x: p.v, y: noseY - p.u }));
  const polys: Pt[][] = [map(g.fuselage), ...g.wings.map(map), ...g.stabilizers.map(map)];
  for (const e of g.engines) {
    for (const side of [1, -1]) {
      const v = e.v * side;
      polys.push([
        { x: v - e.d / 2, y: noseY - (e.u - e.len / 2) },
        { x: v + e.d / 2, y: noseY - (e.u - e.len / 2) },
        { x: v + e.d / 2, y: noseY - (e.u + e.len / 2) },
        { x: v - e.d / 2, y: noseY - (e.u + e.len / 2) },
      ]);
    }
  }
  return polys;
}

function segDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const cross = (p: Pt, q: Pt, r: Pt): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const pt = (p: Pt, s0: Pt, s1: Pt): number => {
    const dx = s1.x - s0.x;
    const dy = s1.y - s0.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - s0.x) * dx + (p.y - s0.y) * dy) / l2));
    return Math.hypot(p.x - (s0.x + dx * t), p.y - (s0.y + dy * t));
  };
  return Math.min(pt(a, c, d), pt(b, c, d), pt(c, a, b), pt(d, a, b));
}

function inside(p: Pt, poly: readonly Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Shortest distance between two polygons, zero when they touch or overlap. */
export function polygonDistance(a: readonly Pt[], b: readonly Pt[]): number {
  if (a.some((p) => inside(p, b)) || b.some((p) => inside(p, a))) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) best = Math.min(best, segDist(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]));
  }
  return best;
}

/**
 * The wing stop outline of the sheet (docs/art/surfaces_stands.png): the restraint line runs down the
 * stand side, angles in by `funnelRiseM` to the nose line `funnelNoseInsetM` before the stand top, and
 * runs straight on to the road. Fixed meters, as measured on the sheet (user, 2026-11-17).
 */
export function sheetFunnel(top: number, n: number): Funnel {
  const yn = top - MK.funnelNoseInsetM;
  return { ys: yn - MK.funnelRiseM, n, yn };
}

/** Front zones of a nose in stand in stand local meters, x toward the aircraft right. */
export interface FrontZones {
  /** Red hatched triangle on the side away from the bridge. */
  emergency: Pt[];
  /** Red hatched bridge no parking band on access type 1, the bus bay on a remote stand. */
  bridge: Pt[];
  /** White GSE parking box beside the bridge band, hatched at its base. */
  gse: Pt[];
  /** Line of the zone texts, toward the taxilane from the zone tops. */
  textY: number;
  /** Fire point symbols. */
  fire: Pt[];
  /** GPU spot center beside the nose. */
  gpu: Pt;
}

const rect = (x0: number, x1: number, y0: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/**
 * Lays out the emergency triangle at the outer corner, the bridge band beside the nose and the GSE box
 * at the stand edge, at the sheet sizes. Each zone keeps
 * `zoneClearM` from every assigned type: its top steps toward the road until it does, never below
 * `zoneMinTopM` from the road.
 */
export function frontZones(l: Pick<StandLayout, 'W' | 'top' | 'funnel' | 'types' | 'nose0'>, outlines: readonly Pt[][]): FrontZones | null {
  const f = l.funnel;
  if (!f) return null;
  const hx = l.W / 2;
  const bottom = l.top - MK.zoneRoadGapM;
  const clear = (poly: Pt[]): boolean => outlines.every((o) => polygonDistance(poly, o) >= MK.zoneClearM);
  const fit = (make: (yTop: number) => Pt[]): Pt[] => {
    let rise = MK.zoneTopM;
    while (rise > MK.zoneMinTopM && !clear(make(l.top - rise))) rise -= 0.5;
    return make(l.top - rise);
  };
  const ex = hx - MK.emergencyEdgeM;
  const leg = Math.min(MK.emergencyLegM, ex - f.n);
  const emergency = fit((yt) => [
    { x: ex, y: Math.max(yt, bottom - leg) },
    { x: ex, y: bottom },
    { x: ex - leg, y: bottom },
  ]);
  const b0 = f.n - MK.noParkingInsetM;
  const b1 = Math.min(b0 + MK.noParkingWidthM, hx - MK.gseEdgeM - MK.gseGapM - MK.gseHatchM);
  const bridge = fit((yt) => rect(-b0, -b1, bottom, yt));
  // The GSE box keeps to the stand edge, as on both sheet templates.
  const g1 = hx - MK.gseEdgeM;
  const g0 = Math.max(b1 + MK.gseGapM, g1 - MK.gseMaxWidthM);
  const gse = fit((yt) => rect(-g0, -g1, bottom, yt));
  const textY = l.top - MK.zoneTextM;
  const fw = l.types[0].dimensions.fuselageWidthM / 2;
  return {
    emergency,
    bridge,
    gse,
    textY,
    fire: [
      { x: Math.max(ex - leg - MK.fireInsetM, f.n + MK.fireRadiusM + MK.zoneClearM), y: bottom - MK.fireRadiusM },
      { x: -b1 + MK.fireRadiusM, y: textY },
    ],
    gpu: { x: -(fw + MK.gpuSideM + MK.gpuSizeM / 2), y: l.nose0 - MK.gpuAftM },
  };
}

/** Outlines of every assigned type parked on its own stop bar. */
export function standOutlines(l: Pick<StandLayout, 'types' | 'bars'>): Pt[][] {
  return l.types.flatMap((a, k) => typeOutlines(a, l.bars[k].y + standGeometry(a).noseGearM));
}

/** Full layout of a stand on its fork, or null when no taxilane is behind it. */
export function standLayout(s: Stand, fork: StandFork | null): StandLayout | null {
  if (!fork) return null;
  const spec = STAND_SIZES[s.size];
  const axis = fork.axis;
  const right = { x: -axis.y, y: axis.x };
  const bar0 = (s.x - fork.hit.x) * axis.x + (s.y - fork.hit.y) * axis.y;
  const slot = standSlot(s.size);
  if (!slot) return null;
  const types = standTypes(s.size);
  const ng0 = standGeometry(types[0]).noseGearM;
  const top = bar0 + slot.far;
  const halfW = types[0].dimensions.fuselageWidthM / 2 + 1;
  const bars = types.map((a, k) => ({ y: bar0 + stopBarOffset(s.size, k), label: s.size === 'small' ? 'GA' : a.icaoType, halfW }));
  const layout: StandLayout = { size: s.size, origin: fork.hit, axis, right, D: fork.radius, W: spec.widthM, top, types, bars, nose0: bar0 + ng0, funnel: null, zones: null };
  if (s.size !== 'small') {
    layout.funnel = sheetFunnel(top, types[0].dimensions.fuselageWidthM / 2 + MK.funnelSideM);
    layout.zones = frontZones(layout, standOutlines(layout));
  }
  return layout;
}
