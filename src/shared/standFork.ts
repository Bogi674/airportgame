import { STAND_SIZES } from '@data/index';
import { compassVector, type Stand } from './airfield';
import { closestOnSegment, segmentIntersection, type Pt } from './geom';
import { atan2Det } from './trig';
import { arcPoints, fillet, wrapAngle } from './pavement/fillet';

/**
 * Stand lead in and push back fork (docs/DESIGN_REVISION_2.md section 1). The stand centerline runs
 * from the stop point back to the fork point F, at the fork radius D from the taxilane centerline.
 * Two arcs of radius D leave F and join the taxilane centerline tangentially, one each way. Nothing
 * crosses the taxilane. The sim drives these lines and the painter draws them, so both always agree.
 */

/** How far back from the stand the lead in looks for a taxilane centerline. */
const REACH_M = 260;
/** The fork keeps this share of the stand to taxilane distance at most, so it stays between them. */
const MAX_FORK_SHARE = 0.7;
/** Push back continues this far along the taxilane past the arc (docs/DESIGN_REVISION_2.md section 1). */
export const PUSHBACK_EXTENSION_M = 28;
const ARC_STEP_M = 1;

export interface StandFork {
  /** Index in the lines the fork was found on: the lead in taxiway. */
  lane: number;
  /** Where the stand axis meets the taxilane centerline. */
  hit: Pt;
  /** Unit vector from the taxilane toward the stand. */
  axis: Pt;
  /** Fork point on the stand centerline. */
  fork: Pt;
  radius: number;
  /** Arc points from the fork to the taxilane, left then right as seen from the parked aircraft. */
  arcs: [Pt[], Pt[]];
  /** Unit direction along the taxilane away from the fork, at each arc end, left then right. */
  away: [Pt, Pt];
}

export interface Polyline {
  pts: readonly Pt[];
}

/** The fork of a stand on the nearest taxilane behind it, or null when no taxilane is behind the stand. */
export function standFork(s: Pick<Stand, 'x' | 'y' | 'headingDeg' | 'size'>, lines: readonly Polyline[]): StandFork | null {
  const back = compassVector((s.headingDeg + 180) % 360);
  let bestT = Infinity;
  let tx = 0;
  let ty = 0;
  let lane = -1;
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li];
    for (let i = 1; i < l.pts.length; i++) {
      const a = l.pts[i - 1];
      const b = l.pts[i];
      const t = segmentIntersection(s.x, s.y, s.x + back.x * REACH_M, s.y + back.y * REACH_M, a.x, a.y, b.x, b.y);
      if (t < 0 || t >= bestT) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) continue;
      bestT = t;
      tx = (b.x - a.x) / len;
      ty = (b.y - a.y) / len;
      lane = li;
    }
  }
  if (bestT === Infinity) return null;
  const dist = REACH_M * bestT;
  const hit = { x: s.x + back.x * dist, y: s.y + back.y * dist };
  const axis = { x: -back.x, y: -back.y };
  const radius = Math.min(STAND_SIZES[s.size].forkRadiusM, dist * MAX_FORK_SHARE);
  const aAxis = atan2Det(axis.y, axis.x);
  // Left of the parked aircraft, which faces along the axis, in screen axes (y down).
  const left = { x: axis.y, y: -axis.x };
  const arcFor = (dirX: number, dirY: number): { pts: Pt[]; td: number } => {
    const aDir = atan2Det(dirY, dirX);
    const ccw = wrapAngle(aDir - aAxis) < Math.PI;
    const f = ccw ? fillet(hit.x, hit.y, aAxis, aDir, 0, radius) : fillet(hit.x, hit.y, aDir, aAxis, 0, radius);
    const pts = arcPoints(f.cx, f.cy, f.r, f.a0, f.sweep, ARC_STEP_M);
    // Start at the stand centerline, end on the taxilane.
    return { pts: ccw ? pts : pts.reverse(), td: f.td };
  };
  const sideL = tx * left.x + ty * left.y >= 0 ? 1 : -1;
  const l = arcFor(tx * sideL, ty * sideL);
  const r = arcFor(-tx * sideL, -ty * sideL);
  const forkDist = Math.max(l.td, r.td);
  const fork = { x: hit.x + axis.x * forkDist, y: hit.y + axis.y * forkDist };
  // A shorter arc runs straight on along the axis to the common fork point.
  const withStem = (arc: { pts: Pt[]; td: number }): Pt[] => (arc.td < forkDist - 1e-6 ? [fork, ...arc.pts] : arc.pts);
  return {
    lane,
    hit,
    axis,
    fork,
    radius,
    arcs: [withStem(l), withStem(r)],
    away: [
      { x: tx * sideL, y: ty * sideL },
      { x: -tx * sideL, y: -ty * sideL },
    ],
  };
}

/** Nearest point on any polyline within reach, for stands with no taxilane straight behind them. */
export function nearestOnLines(p: Pt, lines: readonly Polyline[], reach: number): Pt | null {
  let best = reach;
  let hit: Pt | null = null;
  const c = { x: 0, y: 0, t: 0 };
  for (const l of lines) {
    for (let i = 1; i < l.pts.length; i++) {
      closestOnSegment(p.x, p.y, l.pts[i - 1].x, l.pts[i - 1].y, l.pts[i].x, l.pts[i].y, c);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < best) {
        best = d;
        hit = { x: c.x, y: c.y };
      }
    }
  }
  return hit;
}

/** Facing fork ends of neighbouring stands closer than this share one point on the taxilane. */
const SHARE_M = 8;

/**
 * Forks of all stands, where the facing arc ends of neighbouring stands that land close together on
 * the taxilane meet in one shared point (docs/DESIGN_REVISION_2.md section 1: adjacent forks share
 * where they meet). Each arc is trimmed to the shared point; the arcs lie within a few centimeters of
 * the taxilane there, so the curve keeps its look.
 */
export function standForks(stands: readonly Pick<Stand, 'x' | 'y' | 'headingDeg' | 'size'>[], lines: readonly Polyline[]): (StandFork | null)[] {
  const forks = stands.map((s) => standFork(s, lines));
  const ends: { f: StandFork; side: 0 | 1 }[] = [];
  for (const f of forks) if (f) for (const side of [0, 1] as const) ends.push({ f, side });
  const used = new Set<string>();
  for (let a = 0; a < ends.length; a++) {
    for (let b = a + 1; b < ends.length; b++) {
      const p = ends[a];
      const q = ends[b];
      if (p.f === q.f) continue;
      const ka = `${a}`;
      const kb = `${b}`;
      if (used.has(ka) || used.has(kb)) continue;
      const pe = p.f.arcs[p.side][p.f.arcs[p.side].length - 1];
      const qe = q.f.arcs[q.side][q.f.arcs[q.side].length - 1];
      const ap = p.f.away[p.side];
      const aq = q.f.away[q.side];
      if (Math.hypot(pe.x - qe.x, pe.y - qe.y) > SHARE_M || ap.x * aq.x + ap.y * aq.y > -0.9) continue;
      const mid = { x: (pe.x + qe.x) / 2, y: (pe.y + qe.y) / 2 };
      trimTo(p.f.arcs[p.side], mid, ap);
      trimTo(q.f.arcs[q.side], mid, aq);
      used.add(ka);
      used.add(kb);
    }
  }
  return forks;
}

/** Ends an arc at `mid`, dropping the points that lie beyond it in the direction `away`. */
function trimTo(arc: Pt[], mid: Pt, away: Pt): void {
  while (arc.length > 2) {
    const p = arc[arc.length - 1];
    if ((p.x - mid.x) * away.x + (p.y - mid.y) * away.y > 0) arc.pop();
    else break;
  }
  const last = arc[arc.length - 1];
  if ((mid.x - last.x) * away.x + (mid.y - last.y) * away.y > 0.05) arc.push(mid);
  else arc[arc.length - 1] = mid;
}
