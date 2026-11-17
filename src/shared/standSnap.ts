import { STAND_PLACEMENT } from '@data/index';
import { compassVector, type StandSize, type Taxiway } from './airfield';
import { closestOnSegment, segmentIntersection, type Pt } from './geom';
import { standHeading } from './apronPricing';
import { leadInTargetGapM, standSlot } from './standGeom';

/**
 * Lead in snapping of a single stand (docs/DESIGN_REVISION_4.md section 2.2, D3 and D4). The stand
 * tool calls this on every pointer move; the sim never does, because an unconnected stand is a valid state.
 */

export interface StandSnap {
  /** Stand point (the stop point) after the slide. */
  x: number;
  y: number;
  /** Whole degrees, as the sim stores it. */
  headingDeg: number;
  /** The taxiway the lead in joins. */
  taxiwayId: number;
}

/** Compass degrees of a direction in screen axes (y down), the inverse of `compassVector`. */
function compassOf(x: number, y: number): number {
  return (Math.atan2(x, -y) * 180) / Math.PI;
}

/**
 * Snaps a stand at the pointer to the nearest taxiway centerline it can reach. With no heading given,
 * the stand faces away from the nearest centerline, square to it. With a heading, only a centerline
 * straight behind the stand counts. Either way the stand slides along its axis so its tail edge sits at
 * `leadInTargetGapM` from the centerline. Null when no centerline lies within the lead in reach of the
 * tail edge, measured from the pointer.
 */
export function snapStand(p: Pt, size: StandSize, taxiways: readonly Taxiway[], headingDeg: number | null): StandSnap | null {
  const slot = standSlot(size);
  if (!slot) return null;
  // Distance from the stand point to the centerline when the tail edge is at the reach.
  const reach = STAND_PLACEMENT.leadInReachM - slot.near;
  let best: { hit: Pt; heading: number; t: Taxiway } | null = null;
  if (headingDeg === null) {
    let bestD = reach;
    const c = { x: 0, y: 0, t: 0 };
    for (const t of taxiways) {
      for (let i = 1; i < t.points.length; i++) {
        const a = t.points[i - 1];
        const b = t.points[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len === 0) continue;
        closestOnSegment(p.x, p.y, a.x, a.y, b.x, b.y, c);
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d > bestD) continue;
        // The normal of the segment on the pointer side, so the stand faces away square to the centerline.
        let nx = -(b.y - a.y) / len;
        let ny = (b.x - a.x) / len;
        if (nx * (p.x - c.x) + ny * (p.y - c.y) < 0) {
          nx = -nx;
          ny = -ny;
        }
        bestD = d;
        best = { hit: { x: c.x, y: c.y }, heading: standHeading(compassOf(nx, ny)), t };
      }
    }
  } else {
    const heading = standHeading(headingDeg);
    const back = compassVector((heading + 180) % 360);
    let bestT = Infinity;
    for (const t of taxiways) {
      for (let i = 1; i < t.points.length; i++) {
        const a = t.points[i - 1];
        const b = t.points[i];
        const k = segmentIntersection(p.x, p.y, p.x + back.x * reach, p.y + back.y * reach, a.x, a.y, b.x, b.y);
        if (k < 0 || k >= bestT) continue;
        bestT = k;
        best = { hit: { x: p.x + back.x * reach * k, y: p.y + back.y * reach * k }, heading, t };
      }
    }
  }
  if (!best) return null;
  const axis = compassVector(best.heading);
  const along = leadInTargetGapM(size, best.t.code) - slot.near;
  return { x: best.hit.x + axis.x * along, y: best.hit.y + axis.y * along, headingDeg: best.heading, taxiwayId: best.t.id };
}
