import { closestOnSegment, polylineLength, type Pt } from './geom';

export { polylineLength };

/** Points of a cut are kept on the 0.5 m build grid, like every laid point. */
const round05 = (v: number): number => Math.round(v * 2) / 2;

/**
 * Arc length along the polyline of the point nearest to `p`, or null when `p` is farther than `reachM` from it.
 * Line demolish (DEM2) turns the two ends of a stroke into arc lengths with this.
 */
export function arcLengthAt(pts: readonly Pt[], p: Pt, reachM: number): number | null {
  let best = Infinity;
  let at = 0;
  let run = 0;
  const c = { x: 0, y: 0, t: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    closestOnSegment(p.x, p.y, a.x, a.y, b.x, b.y, c);
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < best) {
      best = d;
      at = run + len * c.t;
    }
    run += len;
  }
  return best <= reachM ? at : null;
}

/** The polyline split at an arc length: the part up to it and the part from it, sharing the split point. */
export function splitPolyline(pts: readonly Pt[], s: number): { before: Pt[]; after: Pt[] } {
  const before: Pt[] = [pts[0]];
  const after: Pt[] = [];
  let run = 0;
  let done = false;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!done && s <= run + len) {
      const k = len > 0 ? (s - run) / len : 0;
      const m = { x: round05(a.x + (b.x - a.x) * k), y: round05(a.y + (b.y - a.y) * k) };
      before.push(m);
      if (m.x !== b.x || m.y !== b.y) after.push(m, b);
      else after.push(m);
      done = true;
    } else if (!done) before.push(b);
    else after.push(b);
    run += len;
  }
  return { before, after };
}

/** What is left of a polyline after the stretch between two arc lengths is removed. */
export interface PolylineCut {
  /** The part before the stretch, or null when it is shorter than the minimum part and goes with the stretch. */
  first: Pt[] | null;
  /** The part after the stretch, or null likewise. */
  last: Pt[] | null;
  /** Length removed in meters, leftovers too short to keep included. */
  removedM: number;
}

/**
 * Removes the stretch between arc lengths `s1` and `s2` (either order). A leftover shorter than `minPartM`
 * is removed too, so a stroke that starts near an end trims that end instead of leaving a stub.
 */
export function cutPolyline(pts: readonly Pt[], s1: number, s2: number, minPartM: number): PolylineCut {
  const total = polylineLength(pts);
  const lo = Math.max(0, Math.min(s1, s2));
  const hi = Math.min(total, Math.max(s1, s2));
  const head = splitPolyline(pts, lo).before;
  const tail = splitPolyline(pts, hi).after;
  const first = lo > 0 && polylineLength(head) >= minPartM ? head : null;
  const last = hi < total && tail.length >= 2 && polylineLength(tail) >= minPartM ? tail : null;
  const kept = (first ? polylineLength(first) : 0) + (last ? polylineLength(last) : 0);
  return { first, last, removedM: total - kept };
}
