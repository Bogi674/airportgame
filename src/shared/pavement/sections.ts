import type { Taxiway } from '../airfield';
import type { Pt } from '../geom';
import { segmentIntersection } from '../geom';
import { AIRFIELD } from '@data/index';
import { landing, MERGE_M } from './fromAirfield';

/** No two nodes closer than this, as in the taxiway tool. */
const GAP_M = AIRFIELD.taxiwayTool.minNodeGapM;

/**
 * Taxiway sections (T71): a taxiway is split into separate records at every junction, so each
 * piece between two junctions can be selected, closed and edited on its own. The split points are
 * the nodes `taxiGraph` already merges: an interior vertex shared with another taxiway, and the end
 * of another taxiway that lands on the middle of a segment. Sections keep the direction of the
 * source polyline, so the pavement graph is the same before and after a split.
 *
 * Two taxiways that cross without a shared point also meet (user, 2026-11-17, the Airport CEO rule:
 * every intersection is a junction). The crossing point is worked out from the lower id taxiway's
 * segment first, so both taxiways get the exact same new vertex and join in one node.
 */
export function sectionPolylines(t: Taxiway, others: readonly Taxiway[]): Pt[][] {
  const pts = t.points;
  const n = pts.length;
  const cutAt = new Set<number>();
  const inserts: { seg: number; k: number; p: Pt }[] = [];
  const near = (a: Pt, b: Pt): boolean => Math.hypot(a.x - b.x, a.y - b.y) < MERGE_M;
  for (const o of others) {
    if (o.id === t.id) continue;
    for (let i = 1; i < n - 1; i++) if (o.points.some((q) => near(pts[i], q))) cutAt.add(i);
    for (const p of crossings(t, o, others)) {
      const at = pts.findIndex((q) => near(q, p.p));
      if (at > 0 && at < n - 1) cutAt.add(at);
      else if (at < 0 && !pts.some((q) => near(q, p.p)) && !inserts.some((x) => near(x.p, p.p))) inserts.push(p);
    }
    for (const e of [o.points[0], o.points[o.points.length - 1]]) {
      const hit = landing(pts, e);
      if (!hit) continue;
      // The landed end itself becomes the vertex, so both meet in one node without a gap.
      const p = { x: e.x, y: e.y };
      if (near({ x: hit.x, y: hit.y }, pts[hit.seg])) {
        if (hit.seg > 0) cutAt.add(hit.seg);
      } else if (near({ x: hit.x, y: hit.y }, pts[hit.seg + 1])) {
        if (hit.seg + 1 < n - 1) cutAt.add(hit.seg + 1);
      } else if (!inserts.some((x) => near(x.p, p))) inserts.push({ seg: hit.seg, k: hit.t, p });
    }
  }
  if (cutAt.size === 0 && inserts.length === 0) return [pts.map((p) => ({ x: p.x, y: p.y }))];
  inserts.sort((a, b) => a.seg - b.seg || a.k - b.k);
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    cur.push({ x: pts[i].x, y: pts[i].y });
    if (cutAt.has(i)) {
      out.push(cur);
      cur = [{ x: pts[i].x, y: pts[i].y }];
    }
    while (j < inserts.length && inserts[j].seg === i) {
      const q = { x: inserts[j].p.x, y: inserts[j++].p.y };
      cur.push(q);
      out.push(cur);
      cur = [{ x: q.x, y: q.y }];
    }
  }
  out.push(cur);
  return out.filter((s) => s.length >= 2);
}

/**
 * Points where a segment of t crosses a segment of o away from every vertex of both, with the
 * segment of t they lie on and the fraction along it. Points within a meter of a vertex are left to
 * the vertex and landing rules.
 */
function crossings(t: Taxiway, o: Taxiway, all: readonly Taxiway[]): { seg: number; k: number; p: Pt }[] {
  const out: { seg: number; k: number; p: Pt }[] = [];
  const near = (a: Pt, b: Pt): boolean => Math.hypot(a.x - b.x, a.y - b.y) < MERGE_M;
  const tFirst = t.id < o.id;
  for (let i = 1; i < t.points.length; i++) {
    const a = t.points[i - 1];
    const b = t.points[i];
    for (let j = 1; j < o.points.length; j++) {
      const c = o.points[j - 1];
      const d = o.points[j];
      // Always solve along the lower id taxiway, so both sides compute the same point.
      const [p0, p1, q0, q1] = tFirst ? [a, b, c, d] : [c, d, a, b];
      const u = segmentIntersection(p0.x, p0.y, p1.x, p1.y, q0.x, q0.y, q1.x, q1.y);
      if (u < 0) continue;
      const p = { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u };
      if ([a, b, c, d].some((v) => near(v, p))) continue;
      // A crossing too close to a node cannot become a junction; the taxiway tool refuses to draw one.
      if (t.points.some((v) => Math.hypot(v.x - p.x, v.y - p.y) < GAP_M) || all.some((x) => x.points.some((v) => Math.hypot(v.x - p.x, v.y - p.y) < GAP_M))) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      out.push({ seg: i - 1, k: len > 0 ? Math.hypot(p.x - a.x, p.y - a.y) / len : 0, p });
    }
  }
  return out;
}

/** The logical taxiway a section belongs to: sections of one taxiway share its name. */
export function taxiLine(t: Taxiway): number {
  return t.line ?? t.id;
}

/** True when the new polyline crosses a taxiway closer than the node gap to a node, where no junction fits. */
export function crossingTooClose(pts: readonly Pt[], taxiways: readonly Taxiway[]): boolean {
  const found: Pt[] = [];
  for (const o of taxiways) {
    for (let i = 1; i < pts.length; i++) {
      for (let j = 1; j < o.points.length; j++) {
        const a = pts[i - 1];
        const b = pts[i];
        const c = o.points[j - 1];
        const d = o.points[j];
        const u = segmentIntersection(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
        if (u < 0) continue;
        const p = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
        // Meeting at a node is a junction the snap already made.
        if ([a, b, c, d].some((v) => Math.hypot(v.x - p.x, v.y - p.y) < MERGE_M)) continue;
        found.push(p);
      }
    }
  }
  const close = (p: Pt, v: Pt): boolean => Math.hypot(v.x - p.x, v.y - p.y) < GAP_M;
  for (let k = 0; k < found.length; k++) {
    const p = found[k];
    if (pts.some((v) => close(p, v)) || taxiways.some((o) => o.points.some((v) => close(p, v)))) return true;
    for (let m = k + 1; m < found.length; m++) if (close(p, found[m])) return true;
  }
  return false;
}
