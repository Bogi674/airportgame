import type { Taxiway } from '../airfield';
import type { Pt } from '../geom';
import { landing, MERGE_M } from './fromAirfield';

/**
 * Taxiway sections (T71): a taxiway is split into separate records at every junction, so each
 * piece between two junctions can be selected, closed and edited on its own. The split points are
 * the nodes `taxiGraph` already merges: an interior vertex shared with another taxiway, and the end
 * of another taxiway that lands on the middle of a segment. Sections keep the direction of the
 * source polyline, so the pavement graph is the same before and after a split.
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

/** The logical taxiway a section belongs to: sections of one taxiway share its name. */
export function taxiLine(t: Taxiway): number {
  return t.line ?? t.id;
}
