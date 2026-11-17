import { STAND_PLACEMENT } from '@data/index';
import { compassVector, type Stand, type StandSize, type Taxiway } from './airfield';
import { closestOnSegment, segmentIntersection, type Pt } from './geom';
import { standHeading } from './apronPricing';
import { REACH_M } from './standFork';
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
  /** Where the stand axis meets that taxiway's centerline, for the snap marker. */
  join: Pt;
  /** The built stand it abuts, when it snapped beside one. */
  neighbourId?: number;
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
  return { x: best.hit.x + axis.x * along, y: best.hit.y + axis.y * along, headingDeg: best.heading, taxiwayId: best.t.id, join: best.hit };
}

/**
 * Snaps a stand like `snapStand`, then beside a built stand of the same heading when the result lies
 * within `neighbourSnapM` of the spot that abuts it: edge to edge, with the stand top (the service road
 * edge) on the neighbour's, so a row of stands forms one straight service road (user, 2026-11-17). Only the
 * lateral distance counts toward `neighbourSnapM`; along the axis the two must overlap as one row. The
 * stand only ever slides away from its taxiway to line up the roads, which lengthens its lead in; when it
 * would have to come closer than its lead in clearance, it abuts beside the neighbour at its own depth.
 */
export function snapStandRow(p: Pt, size: StandSize, taxiways: readonly Taxiway[], stands: readonly Stand[], headingDeg: number | null): StandSnap | null {
  const snap = snapStand(p, size, taxiways, headingDeg);
  const slot = standSlot(size);
  if (!snap || !slot) return snap;
  const axis = compassVector(snap.headingDeg);
  const right = { x: -axis.y, y: axis.x };
  const reach = STAND_PLACEMENT.neighbourSnapM;
  let best: { o: Stand; shift: number; along: number; err: number } | null = null;
  for (const o of stands) {
    if (o.headingDeg !== snap.headingDeg) continue;
    const os = standSlot(o.size);
    if (!os) continue;
    const dx = snap.x - o.x;
    const dy = snap.y - o.y;
    const lat = dx * right.x + dy * right.y;
    const along = dx * axis.x + dy * axis.y;
    const lat0 = Math.sign(lat || 1) * (os.widthM + slot.widthM) / 2;
    // The along offset that puts both stand tops on one line.
    const along0 = os.far - slot.far;
    // Lateral distance from the abutting spot decides; along the axis the two only have to share a row,
    // since the lead in snap already put the stand at its own depth.
    const err = Math.abs(lat - lat0);
    if (err > reach || Math.abs(along) > Math.max(os.far - os.near, slot.far - slot.near) || (best && err >= best.err)) continue;
    best = { o, shift: lat0 - lat, along: along - along0, err };
  }
  if (!best) return snap;
  // Shift sideways onto the abutting spot at the stand's own depth and find the lead in there, then slide out
  // to the neighbour's road line when that keeps the lead in valid.
  const side = { x: snap.x + right.x * best.shift, y: snap.y + right.y * best.shift };
  const beside = snapStand(side, size, taxiways, snap.headingDeg);
  if (!beside) return snap;
  const lined = { x: side.x - axis.x * best.along, y: side.y - axis.y * best.along };
  const out = (lined.x - beside.x) * axis.x + (lined.y - beside.y) * axis.y;
  // The built stand finds its lead in up to REACH_M behind the stop point, so a deeper slide still connects.
  const back = Math.hypot(lined.x - beside.join.x, lined.y - beside.join.y);
  if (out >= -1e-6 && back <= REACH_M) return { ...beside, x: lined.x, y: lined.y, neighbourId: best.o.id };
  return { ...beside, neighbourId: best.o.id };
}
