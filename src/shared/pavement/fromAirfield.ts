import type { Taxiway } from '../airfield';
import type { Pt } from '../geom';
import type { PaveEdge, PaveGraph, PaveNode } from './pavement';

/** Taxiway ends this close to another taxiway's centerline land on it and split it there. */
const LAND_M = 1.5;
/** Polyline points this close together are one node. */
const MERGE_M = 1;

export interface TaxiGraph {
  graph: PaveGraph;
  /** Graph edge ids of each taxiway, in polyline order. */
  edgesOf: Map<number, number[]>;
}

interface Split {
  seg: number;
  t: number;
  x: number;
  y: number;
}

/**
 * Turns the taxiway polylines into a node graph: every polyline point is a node, an end that lands
 * on the middle of another taxiway splits that taxiway with a new node, and points closer than
 * a meter merge. Each straight piece between two nodes becomes one edge.
 */
export function taxiGraph(taxiways: readonly Taxiway[]): TaxiGraph {
  const splits = new Map<number, Split[]>();
  for (const c of taxiways) {
    for (const E of [c.points[0], c.points[c.points.length - 1]]) {
      for (const t of taxiways) {
        if (t.id === c.id) continue;
        const hit = landing(t.points, E);
        if (!hit) continue;
        const l = splits.get(t.id);
        if (l) l.push(hit);
        else splits.set(t.id, [hit]);
        break;
      }
    }
  }

  const nodes: PaveNode[] = [];
  const grid = new Map<string, number[]>();
  const cellKey = (x: number, y: number): string => `${Math.floor(x / MERGE_M)},${Math.floor(y / MERGE_M)}`;
  const nodeAt = (p: Pt): number => {
    const cx = Math.floor(p.x / MERGE_M);
    const cy = Math.floor(p.y / MERGE_M);
    let best = -1;
    let bestD = MERGE_M;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const n = nodes[id];
          const d = Math.hypot(n.x - p.x, n.y - p.y);
          if (d < bestD) {
            bestD = d;
            best = id;
          }
        }
      }
    }
    if (best >= 0) return best;
    const id = nodes.length;
    nodes.push({ id, x: p.x, y: p.y });
    const k = cellKey(p.x, p.y);
    const l = grid.get(k);
    if (l) l.push(id);
    else grid.set(k, [id]);
    return id;
  };

  // Split points go in first so the ends that land on them merge into them.
  const withSplits = new Map<number, Pt[]>();
  for (const t of taxiways) {
    const s = (splits.get(t.id) ?? []).slice().sort((p, q) => p.seg - q.seg || p.t - q.t);
    const pts: Pt[] = [];
    let k = 0;
    for (let i = 0; i < t.points.length; i++) {
      pts.push(t.points[i]);
      while (k < s.length && s[k].seg === i) pts.push({ x: s[k].x, y: s[k++].y });
    }
    withSplits.set(t.id, pts);
    for (const sp of s) nodeAt(sp);
  }

  const edges: PaveEdge[] = [];
  const edgesOf = new Map<number, number[]>();
  const seen = new Set<string>();
  for (const t of taxiways) {
    const ids = (withSplits.get(t.id) ?? t.points).map(nodeAt);
    const own: number[] = [];
    for (let i = 1; i < ids.length; i++) {
      const a = ids[i - 1];
      const b = ids[i];
      if (a === b) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const id = edges.length;
      edges.push({ id, a, b, hw: t.widthM / 2, code: t.code, surface: t.surface, kind: t.kind, closed: t.closed });
      own.push(id);
    }
    edgesOf.set(t.id, own);
  }
  return { graph: { nodes, edges }, edgesOf };
}

/** Where a point lands on the middle of a polyline, or null when it is off it or at one of its ends. */
function landing(pts: readonly Pt[], p: Pt): Split | null {
  let best: Split | null = null;
  let bestD = LAND_M;
  let along = 0;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let bestAlong = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = { seg: i - 1, t, x, y };
      bestAlong = along + Math.sqrt(l2) * t;
    }
    along += Math.sqrt(l2);
  }
  if (!best || bestAlong < LAND_M || bestAlong > total - LAND_M) return null;
  return best;
}
