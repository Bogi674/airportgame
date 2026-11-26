import { AIRFIELD } from '@data/index';
import { compassVector, type Taxiway } from '../airfield';
import type { Pt } from '../geom';
import { taxiGraph } from './fromAirfield';

/**
 * Taxiway tool snapping (docs/DESIGN_REVISION_2.md section 2.2). The UI preview and the sim use the
 * same rules, so the preview always shows what the build will do:
 * 1. an existing node (junction or bend) within the snap radius: the new arm joins it,
 * 2. an open end of a taxiway: the new piece continues that taxiway,
 * 3. a point on the middle of a segment: the segment splits there and a junction is made.
 * No two nodes are ever closer than the minimum node gap.
 */

export const TAXI_TOOL = AIRFIELD.taxiwayTool;

export type SnapKind = 'node' | 'end' | 'segment';

export interface SnapHit {
  kind: SnapKind;
  p: Pt;
  /** Label of the node, such as J1, for the tooltip. Empty for segments and ends. */
  label: string;
  /** Taxiway the hit belongs to: its open end, or the segment that splits. */
  taxiwayId: number;
  /** For a segment hit: the segment index along the taxiway. For an end hit: 0 for the start, 1 for the end. */
  index: number;
  /** For a segment hit: where on the segment, 0 at its start to 1 at its end. */
  along: number;
}

export interface TaxiNode {
  p: Pt;
  arms: number;
  label: string;
  /** For an open end: its taxiway and which end. */
  taxiwayId: number;
  end: 0 | 1;
}

/** Nodes of the built taxiways with their arm counts, nodes with two or more arms labelled J1, J2 and so on. */
export function taxiNodes(taxiways: readonly Taxiway[]): TaxiNode[] {
  const { graph, edgesOf } = taxiGraph(taxiways);
  const arms = new Map<number, number>();
  for (const e of graph.edges) {
    arms.set(e.a, (arms.get(e.a) ?? 0) + 1);
    arms.set(e.b, (arms.get(e.b) ?? 0) + 1);
  }
  const endOf = new Map<number, { taxiwayId: number; end: 0 | 1 }>();
  for (const t of taxiways) {
    const own = edgesOf.get(t.id) ?? [];
    if (own.length === 0) continue;
    const first = graph.edges[own[0]];
    const last = graph.edges[own[own.length - 1]];
    if (!endOf.has(first.a)) endOf.set(first.a, { taxiwayId: t.id, end: 0 });
    if (!endOf.has(last.b)) endOf.set(last.b, { taxiwayId: t.id, end: 1 });
  }
  let j = 0;
  return graph.nodes.map((n) => {
    const a = arms.get(n.id) ?? 0;
    const e = endOf.get(n.id);
    return { p: { x: n.x, y: n.y }, arms: a, label: a >= 2 ? `J${++j}` : '', taxiwayId: e?.taxiwayId ?? -1, end: e?.end ?? 0 };
  });
}

/** The snap target for a point, by priority, or null when nothing is within the radius. */
export function findSnap(taxiways: readonly Taxiway[], nodes: readonly TaxiNode[], p: Pt, radius = TAXI_TOOL.snapRadiusM): SnapHit | null {
  let best: TaxiNode | null = null;
  let bestD = radius;
  for (const n of nodes) {
    const d = Math.hypot(n.p.x - p.x, n.p.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = n;
    }
  }
  if (best && best.arms >= 2) return { kind: 'node', p: { ...best.p }, label: best.label, taxiwayId: -1, index: -1, along: 0 };
  if (best && best.arms === 1 && best.taxiwayId >= 0) return { kind: 'end', p: { ...best.p }, label: '', taxiwayId: best.taxiwayId, index: best.end, along: 0 };
  if (best) return { kind: 'node', p: { ...best.p }, label: best.label, taxiwayId: -1, index: -1, along: 0 };
  let seg: SnapHit | null = null;
  let segD = radius;
  for (const t of taxiways) {
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1];
      const b = t.points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) continue;
      const k = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
      if (k <= 0 || k >= 1) continue;
      const q = { x: a.x + dx * k, y: a.y + dy * k };
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > segD) continue;
      // A split this close to a node would break the node gap, so the node wins.
      if (nodes.some((n) => Math.hypot(n.p.x - q.x, n.p.y - q.y) < TAXI_TOOL.minNodeGapM)) continue;
      segD = d;
      seg = { kind: 'segment', p: q, label: '', taxiwayId: t.id, index: i - 1, along: k };
    }
  }
  return seg;
}

/** A segment hit slid along its segment so the new piece meets it square or on a heading step. */
export interface AlignedSegmentHit {
  hit: SnapHit;
  /** True when the piece meets the segment at a right angle, false for a heading step. */
  square: boolean;
  /** The compass heading of the piece from the previous point, 0 to 359. */
  headingDeg: number;
}

/**
 * Slides a segment hit along its segment so the piece from `prev` meets the taxiway square to it, or
 * else on the nearest heading step of `frames`, when the drawn heading is within the tolerance. Square
 * wins over a step. Null when no candidate is close enough or the slid point leaves the segment or
 * comes within the node gap.
 */
export function alignSegmentHit(hit: SnapHit, taxiways: readonly Taxiway[], nodes: readonly TaxiNode[], prev: Pt, frames: readonly number[]): AlignedSegmentHit | null {
  if (hit.kind !== 'segment') return null;
  const t = taxiways.find((w) => w.id === hit.taxiwayId);
  if (!t) return null;
  const a = t.points[hit.index];
  const b = t.points[hit.index + 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const drawn = (Math.atan2(hit.p.x - prev.x, -(hit.p.y - prev.y)) * 180) / Math.PI;
  const diff = (h: number): number => Math.abs(((drawn - h + 540) % 360) - 180);
  const segHdg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const tries: { h: number; square: boolean; tol: number }[] = [segHdg + 90, segHdg - 90].map((h) => ({ h, square: true, tol: TAXI_TOOL.squareTolDeg }));
  const steps: { h: number; square: boolean; tol: number }[] = [];
  for (const f of frames) for (let k = 0; k < 360 / TAXI_TOOL.angleStepDeg; k++) steps.push({ h: f + k * TAXI_TOOL.angleStepDeg, square: false, tol: TAXI_TOOL.angleTolDeg });
  steps.sort((x, y) => diff(x.h) - diff(y.h));
  for (const c of [...tries, ...steps.slice(0, 1)]) {
    if (diff(c.h) > c.tol) continue;
    const u = compassVector(((c.h % 360) + 360) % 360);
    // Ray prev + s u against the segment line a + k (b - a).
    const den = u.x * dy - u.y * dx;
    if (Math.abs(den) < 1e-9) continue;
    const k = ((a.x - prev.x) * u.y - (a.y - prev.y) * u.x) / den;
    const s = ((a.x - prev.x) * dy - (a.y - prev.y) * dx) / den;
    if (s <= 0 || k <= 0 || k >= 1) continue;
    const p = { x: a.x + dx * k, y: a.y + dy * k };
    if (nodes.some((n) => Math.hypot(n.p.x - p.x, n.p.y - p.y) < TAXI_TOOL.minNodeGapM)) continue;
    return { hit: { ...hit, p, along: k }, square: c.square, headingDeg: Math.round((((c.h % 360) + 360) % 360)) % 360 };
  }
  return null;
}

export interface SnappedPolyline {
  points: Pt[];
  /** Hits of each point, null where a point snapped to nothing. */
  hits: (SnapHit | null)[];
}

/**
 * Snaps every point of a new polyline and checks the node gap. Returns the snapped points with their
 * hits, or a problem code when two of the new nodes would sit closer than the gap.
 */
export function snapPolyline(taxiways: readonly Taxiway[], pts: readonly Pt[]): SnappedPolyline | { problem: string } {
  const nodes = taxiNodes(taxiways);
  const points: Pt[] = [];
  const hits: (SnapHit | null)[] = [];
  for (const p of pts) {
    const h = findSnap(taxiways, nodes, p);
    const q = h ? h.p : { x: p.x, y: p.y };
    // A point within the gap of the previous one merges into it.
    const prev = points[points.length - 1];
    if (prev && Math.hypot(prev.x - q.x, prev.y - q.y) < TAXI_TOOL.minNodeGapM) {
      if (h && !hits[hits.length - 1]) {
        points[points.length - 1] = q;
        hits[hits.length - 1] = h;
      }
      continue;
    }
    points.push(q);
    hits.push(h);
  }
  if (points.length < 2) return { problem: 'segmentTooShort' };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 2; j < points.length; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < TAXI_TOOL.minNodeGapM) return { problem: 'nodesTooClose' };
    }
    if (hits[i]) continue;
    // A free new node must keep the gap to every existing node.
    if (nodes.some((n) => Math.hypot(n.p.x - points[i].x, n.p.y - points[i].y) < TAXI_TOOL.minNodeGapM)) return { problem: 'nodesTooClose' };
  }
  return { points, hits };
}
