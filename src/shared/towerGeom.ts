import { STAND_SIZES } from '@data/index';
import { apronContains } from './apronGeom';
import { bounds, distToSegment, type Pt } from './geom';
import type { AirfieldPayload, Stand } from './airfield';

/**
 * Where a free standing tower may stand (handoff/tasks/T40-atc-tower.md R2). The footprint is a
 * square of `tower.footprintM` in metres and it must stay clear of every paved surface and of
 * every stand, because an aircraft taxis or parks there.
 */

/** Spacing of the points that test the footprint, in metres. */
const SAMPLE_M = 1;

/** True when a point lies inside a stand's parked aircraft footprint, a rectangle centred on the stand. */
function insideStand(s: Stand, x: number, y: number): boolean {
  const spec = STAND_SIZES[s.size];
  const a = (s.headingDeg * Math.PI) / 180;
  const dx = x - s.x;
  const dy = y - s.y;
  // The heading points along the nose, so the depth runs along it and the width across it.
  const along = dx * Math.sin(a) - dy * Math.cos(a);
  const across = dx * Math.cos(a) + dy * Math.sin(a);
  return Math.abs(along) <= spec.depthM / 2 && Math.abs(across) <= spec.widthM / 2;
}

/** True when a point lies on a runway, a taxiway, an apron or a stand. */
function onPavement(af: AirfieldPayload, x: number, y: number): boolean {
  for (const a of af.aprons) if (apronContains(a, x, y)) return true;
  for (const r of af.runways) if (distToSegment(x, y, r.x1, r.y1, r.x2, r.y2) < r.widthM / 2 + r.shoulderM) return true;
  for (const t of af.taxiways) {
    for (let i = 1; i < t.points.length; i++) {
      if (distToSegment(x, y, t.points[i - 1].x, t.points[i - 1].y, t.points[i].x, t.points[i].y) < t.widthM / 2) return true;
    }
  }
  for (const s of af.stands) if (insideStand(s, x, y)) return true;
  return false;
}

/** True when the square footprint touches pavement or a stand. The sim refuses the build on true. */
export function towerBlocked(af: AirfieldPayload, rect: readonly Pt[]): boolean {
  const b = bounds(rect);
  for (let y = b.minY; y <= b.maxY; y += SAMPLE_M) {
    for (let x = b.minX; x <= b.maxX; x += SAMPLE_M) {
      if (onPavement(af, x, y)) return true;
    }
  }
  // The edges themselves are part of the footprint even when the grid step misses them.
  for (let i = 0; i < rect.length; i++) {
    const p = rect[i];
    if (onPavement(af, p.x, p.y)) return true;
  }
  return false;
}

/** True when two axis aligned tower footprints share any area. Towers are square on the world grid, so bounds are exact. */
export function towersOverlap(a: readonly Pt[], b: readonly Pt[]): boolean {
  const x = bounds(a);
  const y = bounds(b);
  return x.minX < y.maxX && y.minX < x.maxX && x.minY < y.maxY && y.minY < x.maxY;
}
