import { AIRFIELD } from '@data/index';
import { APPROACHES, type Approach, type Runway } from './airfield';
import { bounds, pointInPolygon, type Pt } from './geom';
import { CELL_M, GRID_N, LandClass } from './site';

/**
 * Obstacle limitation surfaces (docs/GAME_DESIGN.md section 6, clearances), simplified from ICAO
 * Annex 14: an approach surface from each threshold and a transitional surface along both sides of
 * the strip. Terrain, the cover standing on land the player does not own (forest, villages,
 * industry, roads) and terminal buildings are the obstacles. A penetration rules out that approach
 * type in that direction; the runway falls back to the best type whose surfaces are clear.
 */

const OS = AIRFIELD.obstacleSurfaces;

export interface ObstacleInput {
  heights: Float32Array;
  landClass: Uint8Array;
  parcelId: Uint16Array;
  /** 1 for parcels the player owns: their cover is cleared. */
  parcelOwner: Uint8Array;
  /** Building footprints in world meters. */
  buildings: readonly Pt[][];
}

export interface Penetration {
  x: number;
  y: number;
  /** How far the obstacle reaches above the surface, in meters. */
  byM: number;
  /** The approach surface of threshold A or B, or the transitional surface (both directions). */
  end: 'a' | 'b' | 'both';
}

export interface RunwayObstacles {
  runwayId: number;
  /** Usable approach type when landing at threshold A (toward B) and at threshold B. */
  approachA: Approach;
  approachB: Approach;
  /** Penetrations of the surfaces of the runway's own approach type, worst first. */
  penetrations: Penetration[];
}

/** Outlines of the surfaces for drawing. */
export interface SurfaceOutlines {
  approachA: Pt[];
  approachB: Pt[];
  /** Outer edges of the transitional surface, left and right. */
  transitional: Pt[][];
}

interface Frame {
  ax: number;
  ay: number;
  ux: number;
  uy: number;
  len: number;
  elevA: number;
  elevB: number;
}

const ground = (h: Float32Array, x: number, y: number): number => {
  const i = Math.floor(x / CELL_M);
  const j = Math.floor(y / CELL_M);
  if (i < 0 || j < 0 || i >= GRID_N || j >= GRID_N) return 0;
  const v = h[j * GRID_N + i];
  return v > 0 ? v : 0;
};

function frameOf(r: Runway, h: Float32Array): Frame {
  const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1) || 1;
  return { ax: r.x1, ay: r.y1, ux: (r.x2 - r.x1) / len, uy: (r.y2 - r.y1) / len, len, elevA: ground(h, r.x1, r.y1), elevB: ground(h, r.x2, r.y2) };
}

function coverHeight(c: number): number {
  if (c === LandClass.Forest) return OS.coverHeightM.forest;
  if (c === LandClass.Village) return OS.coverHeightM.village;
  if (c === LandClass.Industrial) return OS.coverHeightM.industrial;
  if (c === LandClass.Road) return OS.coverHeightM.road;
  return 0;
}

/**
 * Height of the lowest surface over a point and which one it is, or null when no surface covers it.
 * 0 is the approach surface of A, 1 of B, 2 the transitional surface.
 */
function surfaceAt(f: Frame, ap: Approach, stripHalf: number, x: number, y: number, out: { h: number; which: number }): boolean {
  const p = OS.approach[ap];
  const dx = x - f.ax;
  const dy = y - f.ay;
  const s = dx * f.ux + dy * f.uy;
  const l = Math.abs(dx * -f.uy + dy * f.ux);
  let best = Infinity;
  let which = -1;
  const alongA = -s - p.startM;
  if (alongA >= 0 && alongA <= p.lengthM && l <= p.innerEdgeM / 2 + alongA * p.divergence) {
    best = f.elevA + alongA * p.slope;
    which = 0;
  }
  const alongB = s - f.len - p.startM;
  if (alongB >= 0 && alongB <= p.lengthM && l <= p.innerEdgeM / 2 + alongB * p.divergence) {
    const hB = f.elevB + alongB * p.slope;
    if (hB < best) {
      best = hB;
      which = 1;
    }
  }
  if (s >= -p.startM && s <= f.len + p.startM && l > stripHalf) {
    const rise = (l - stripHalf) * p.transitionalSlope;
    if (rise <= OS.transitionalTopM) {
      const t = s <= 0 ? 0 : s >= f.len ? 1 : s / f.len;
      const hT = f.elevA + (f.elevB - f.elevA) * t + rise;
      if (hT < best) {
        best = hT;
        which = 2;
      }
    }
  }
  if (which < 0) return false;
  out.h = best;
  out.which = which;
  return true;
}

export function surfaceOutlines(r: Runway, ap: Approach): SurfaceOutlines {
  const p = OS.approach[ap];
  const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1) || 1;
  const ux = (r.x2 - r.x1) / len;
  const uy = (r.y2 - r.y1) / len;
  const nx = -uy;
  const ny = ux;
  const at = (s: number, l: number): Pt => ({ x: r.x1 + ux * s + nx * l, y: r.y1 + uy * s + ny * l });
  const trap = (s0: number, dir: number): Pt[] => {
    const w0 = p.innerEdgeM / 2;
    const w1 = w0 + p.lengthM * p.divergence;
    const s1 = s0 + dir * p.lengthM;
    return [at(s0, -w0), at(s0, w0), at(s1, w1), at(s1, -w1)];
  };
  const out = AIRFIELD.stripWidthM[ap] / 2 + OS.transitionalTopM / p.transitionalSlope;
  return {
    approachA: trap(-p.startM, -1),
    approachB: trap(len + p.startM, 1),
    transitional: [-1, 1].map((side) => [at(-p.startM, side * out), at(len + p.startM, side * out)]),
  };
}

const ORDER: readonly Approach[] = APPROACHES.slice().reverse();

/**
 * Penetrations of one approach type's surfaces: a flag per surface, and the points when a list is
 * given. Terrain is sampled every cell size in the runway's own frame, so only the surfaces are visited.
 */
function scan(r: Runway, ap: Approach, inp: ObstacleInput, list: Penetration[] | null): [boolean, boolean, boolean] {
  const f = frameOf(r, inp.heights);
  const p = OS.approach[ap];
  const stripHalf = AIRFIELD.stripWidthM[ap] / 2;
  const transOut = stripHalf + OS.transitionalTopM / p.transitionalSlope;
  const hit: [boolean, boolean, boolean] = [false, false, false];
  const res = { h: 0, which: -1 };
  const tol = OS.toleranceM;
  const ends: Penetration['end'][] = ['a', 'b', 'both'];
  const test = (x: number, y: number, top: number): void => {
    if (!surfaceAt(f, ap, stripHalf, x, y, res)) return;
    const by = top - res.h;
    if (by <= tol) return;
    hit[res.which] = true;
    if (list) list.push({ x, y, byM: Math.round(by * 10) / 10, end: ends[res.which] });
  };
  const nx = -f.uy;
  const ny = f.ux;
  const s0 = -p.startM - p.lengthM;
  const s1 = f.len + p.startM + p.lengthM;
  for (let s = s0; s <= s1; s += CELL_M) {
    let w = 0;
    const alongA = -s - p.startM;
    if (alongA >= 0 && alongA <= p.lengthM) w = Math.max(w, p.innerEdgeM / 2 + alongA * p.divergence);
    const alongB = s - f.len - p.startM;
    if (alongB >= 0 && alongB <= p.lengthM) w = Math.max(w, p.innerEdgeM / 2 + alongB * p.divergence);
    if (s >= -p.startM && s <= f.len + p.startM) w = Math.max(w, transOut);
    for (let l = -Math.floor(w / CELL_M) * CELL_M; l <= w; l += CELL_M) {
      const x = f.ax + f.ux * s + nx * l;
      const y = f.ay + f.uy * s + ny * l;
      const i = Math.floor(x / CELL_M);
      const j = Math.floor(y / CELL_M);
      if (i < 0 || j < 0 || i >= GRID_N || j >= GRID_N) continue;
      const c = j * GRID_N + i;
      const g = inp.heights[c] > 0 ? inp.heights[c] : 0;
      const cover = inp.parcelOwner[inp.parcelId[c]] === 1 ? 0 : coverHeight(inp.landClass[c]);
      if (g + cover > f.elevA + tol || g + cover > f.elevB + tol) test(x, y, g + cover);
    }
  }
  for (const poly of inp.buildings) {
    const bb = bounds(poly);
    for (let y = bb.minY + CELL_M / 2; y < bb.maxY; y += CELL_M) {
      for (let x = bb.minX + CELL_M / 2; x < bb.maxX; x += CELL_M) {
        if (pointInPolygon(x, y, poly)) test(x, y, ground(inp.heights, x, y) + OS.terminalHeightM);
      }
    }
  }
  return hit;
}

/** Penetrations of the runway's own approach type only, worst first: one pass, for previews. */
export function previewPenetrations(r: Runway, inp: ObstacleInput): Penetration[] {
  const list: Penetration[] = [];
  scan(r, r.approach, inp, list);
  list.sort((p, q) => q.byM - p.byM || p.y - q.y || p.x - q.x);
  return list.slice(0, OS.maxReported);
}

/** The usable approach type per direction and the penetrations of the runway's own type. */
export function checkRunwayObstacles(r: Runway, inp: ObstacleInput): RunwayObstacles {
  const penetrations: Penetration[] = [];
  let approachA: Approach | null = null;
  let approachB: Approach | null = null;
  for (const ap of ORDER) {
    if (APPROACHES.indexOf(ap) > APPROACHES.indexOf(r.approach)) continue;
    const hit = scan(r, ap, inp, ap === r.approach ? penetrations : null);
    if (!approachA && !hit[0] && !hit[2]) approachA = ap;
    if (!approachB && !hit[1] && !hit[2]) approachB = ap;
    if (approachA && approachB) break;
  }
  penetrations.sort((p, q) => q.byM - p.byM || p.y - q.y || p.x - q.x);
  return {
    runwayId: r.id,
    approachA: approachA ?? 'visual',
    approachB: approachB ?? 'visual',
    penetrations: penetrations.slice(0, OS.maxReported),
  };
}
