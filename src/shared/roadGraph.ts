import { GROUND, STAND_MARKINGS, STAND_SIZES } from '@data/index';
import type { AirfieldPayload, Building, Depot, Stand } from './airfield';
import { closestOnSegment, segmentIntersection, type Pt } from './geom';
import { standSlot } from './standGeom';
import { cosLut, PI, sinLut } from './trig';

/**
 * Service road and apron lane graph (T60, docs/DESIGN_REVISION_4.md section 4, user answers of 2026-11-18).
 * Built from the roads the player drew, the road strip at the top of every contact stand and the depot exits.
 * Pure, so the sim builds it after each airfield change and the road tool reads the same anchors.
 * Edges are undirected centerlines; vehicles keep right by the lane offset of the edge kind.
 */

/** A drawn service road, 7 m with two lanes. */
export const EDGE_ROAD = 0;
/** The two lane strip at the top of a contact stand. */
export const EDGE_LANE = 1;

/** Points closer than this are one node, in meters. The road tool snaps ends exactly, this only absorbs rounding. */
const MERGE_M = 1;

/** Unit vector of a compass heading in screen axes (y down), from the lookup tables. */
export function headingVec(deg: number): Pt {
  const a = (deg * PI) / 180;
  return { x: sinLut(a), y: -cosLut(a) };
}

/** The four corners of a depot footprint. */
export function depotRect(d: Pick<Depot, 'x' | 'y' | 'headingDeg'>): Pt[] {
  return footprintRect(d, GROUND.depot.widthM, GROUND.depot.depthM);
}

/** The four corners of a supporting building (T65). */
export function buildingRect(b: Pick<Building, 'x' | 'y' | 'headingDeg' | 'kind'>): Pt[] {
  const spec = GROUND.buildings[b.kind];
  return footprintRect(b, spec.widthM, spec.depthM);
}

/** Where vehicles leave and enter a supporting building: in front of the middle of its door side. */
export function buildingDoor(b: Pick<Building, 'x' | 'y' | 'headingDeg' | 'kind'>): Pt {
  const f = headingVec(b.headingDeg);
  const k = GROUND.buildings[b.kind].depthM / 2 + GROUND.depot.exitGapM;
  return { x: b.x + f.x * k, y: b.y + f.y * k };
}

/** A footprint of the given width across its door side and depth along its heading, centred on the point. */
export function footprintRect(d: Pick<Depot, 'x' | 'y' | 'headingDeg'>, widthM: number, depthM: number): Pt[] {
  const f = headingVec(d.headingDeg);
  const r = { x: -f.y, y: f.x };
  const hd = depthM / 2;
  const hw = widthM / 2;
  return [
    { x: d.x + f.x * hd - r.x * hw, y: d.y + f.y * hd - r.y * hw },
    { x: d.x + f.x * hd + r.x * hw, y: d.y + f.y * hd + r.y * hw },
    { x: d.x - f.x * hd + r.x * hw, y: d.y - f.y * hd + r.y * hw },
    { x: d.x - f.x * hd - r.x * hw, y: d.y - f.y * hd - r.y * hw },
  ];
}

/** Where vehicles leave and enter a depot: in front of the middle of its door side. */
export function depotExit(d: Pick<Depot, 'x' | 'y' | 'headingDeg'>): Pt {
  const f = headingVec(d.headingDeg);
  const k = GROUND.depot.depthM / 2 + GROUND.depot.exitGapM;
  return { x: d.x + f.x * k, y: d.y + f.y * k };
}

/** True when the stand paints a road strip at its top, the same rule as the stand painter. */
export function hasRoadStrip(s: Pick<Stand, 'type' | 'size'>): boolean {
  return s.type === 'contact' && s.size !== 'small';
}

export interface StandRoadAnchors {
  /** The one service road connection point of the stand (D2 section 2.1). */
  conn: Pt;
  /** Both ends of the road strip, on contact stands only. */
  ends: [Pt, Pt] | null;
  /** Unit vector along the stand heading (the nose) and to its right. */
  fwd: Pt;
  right: Pt;
}

/**
 * The road anchors of a stand. A contact stand connects at the middle of its road strip, any other stand
 * half a road width beyond its top edge, so a road ending there covers the box edge.
 */
export function standRoadAnchors(s: Stand): StandRoadAnchors | null {
  const slot = standSlot(s.size);
  if (!slot) return null;
  const fwd = headingVec(s.headingDeg);
  const right = { x: -fwd.y, y: fwd.x };
  if (hasRoadStrip(s)) {
    const k = slot.far + STAND_MARKINGS.serviceRoadM / 2;
    const conn = { x: s.x + fwd.x * k, y: s.y + fwd.y * k };
    const hw = STAND_SIZES[s.size].widthM / 2;
    return { conn, ends: [{ x: conn.x - right.x * hw, y: conn.y - right.y * hw }, { x: conn.x + right.x * hw, y: conn.y + right.y * hw }], fwd, right };
  }
  const k = slot.far + GROUND.road.widthM / 2;
  return { conn: { x: s.x + fwd.x * k, y: s.y + fwd.y * k }, ends: null, fwd, right };
}

/** Every point the road tool snaps to: depot exits, stand connection points, strip ends and road ends. */
export function roadSnapPoints(af: AirfieldPayload): Pt[] {
  const out: Pt[] = [];
  for (const d of af.depots ?? []) out.push(depotExit(d));
  for (const b of af.buildings ?? []) out.push(buildingDoor(b));
  for (const s of af.stands) {
    const a = standRoadAnchors(s);
    if (!a) continue;
    out.push(a.conn);
    if (a.ends) out.push(a.ends[0], a.ends[1]);
  }
  for (const r of af.roads ?? []) out.push(r.points[0], r.points[r.points.length - 1]);
  return out;
}

export interface RoadGraph {
  nodeX: number[];
  nodeY: number[];
  /** Taxiway record id a crossing node lies on, else -1. */
  nodeCross: number[];
  /** Number of edges at each node. */
  nodeDegree: number[];
  edgeA: number[];
  edgeB: number[];
  edgeLen: number[];
  edgeKind: number[];
  /** Edge ids at each node, in edge order. */
  adj: number[][];
  /** Connection node per stand, same order as `af.stands`, or -1 for a stand with no anchors. */
  standConn: number[];
  /** Exit node per depot, same order as `af.depots`. */
  depotNode: number[];
  /** Door node per supporting building, same order as `af.buildings`. */
  buildingNode: number[];
}

interface Seg {
  a: Pt;
  b: Pt;
  kind: number;
}

/** Builds the road graph of an airfield. Deterministic: every list is walked in its stored order. */
export function buildRoadGraph(af: AirfieldPayload): RoadGraph {
  const g: RoadGraph = { nodeX: [], nodeY: [], nodeCross: [], nodeDegree: [], edgeA: [], edgeB: [], edgeLen: [], edgeKind: [], adj: [], standConn: [], depotNode: [], buildingNode: [] };
  const nodeAt = (p: Pt): number => {
    for (let i = 0; i < g.nodeX.length; i++) {
      const dx = g.nodeX[i] - p.x;
      const dy = g.nodeY[i] - p.y;
      if (dx * dx + dy * dy <= MERGE_M * MERGE_M) return i;
    }
    g.nodeX.push(p.x);
    g.nodeY.push(p.y);
    g.nodeCross.push(-1);
    g.nodeDegree.push(0);
    g.adj.push([]);
    return g.nodeX.length - 1;
  };
  for (const d of af.depots ?? []) g.depotNode.push(nodeAt(depotExit(d)));
  for (const b of af.buildings ?? []) g.buildingNode.push(nodeAt(buildingDoor(b)));
  const segs: Seg[] = [];
  for (const s of af.stands) {
    const a = standRoadAnchors(s);
    if (!a) {
      g.standConn.push(-1);
      continue;
    }
    g.standConn.push(nodeAt(a.conn));
    if (a.ends) {
      segs.push({ a: a.ends[0], b: a.conn, kind: EDGE_LANE });
      segs.push({ a: a.conn, b: a.ends[1], kind: EDGE_LANE });
    }
  }
  for (const r of af.roads ?? []) {
    for (let i = 1; i < r.points.length; i++) segs.push({ a: r.points[i - 1], b: r.points[i], kind: EDGE_ROAD });
  }
  // Points that split a segment when they lie on it: every anchor node and every segment end.
  const splitters: Pt[] = [];
  for (let i = 0; i < g.nodeX.length; i++) splitters.push({ x: g.nodeX[i], y: g.nodeY[i] });
  for (const s of segs) splitters.push(s.a, s.b);
  const c = { x: 0, y: 0, t: 0 };
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si];
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) continue;
    const cuts: { t: number; cross: number }[] = [
      { t: 0, cross: -1 },
      { t: 1, cross: -1 },
    ];
    for (const p of splitters) {
      closestOnSegment(p.x, p.y, s.a.x, s.a.y, s.b.x, s.b.y, c);
      const ex = p.x - c.x;
      const ey = p.y - c.y;
      if (c.t > 0 && c.t < 1 && ex * ex + ey * ey <= MERGE_M * MERGE_M) cuts.push({ t: c.t, cross: -1 });
    }
    for (let sj = 0; sj < segs.length; sj++) {
      if (sj === si) continue;
      const o = segs[sj];
      const t = segmentIntersection(s.a.x, s.a.y, s.b.x, s.b.y, o.a.x, o.a.y, o.b.x, o.b.y);
      if (t > 0 && t < 1) cuts.push({ t, cross: -1 });
    }
    // A drawn road that crosses a taxiway centerline gets a crossing node there; vehicles give way at it.
    if (s.kind === EDGE_ROAD) {
      for (const tw of af.taxiways) {
        for (let i = 1; i < tw.points.length; i++) {
          const p = tw.points[i - 1];
          const q = tw.points[i];
          const t = segmentIntersection(s.a.x, s.a.y, s.b.x, s.b.y, p.x, p.y, q.x, q.y);
          if (t >= 0) cuts.push({ t, cross: tw.id });
        }
      }
    }
    cuts.sort((u, v) => u.t - v.t || v.cross - u.cross);
    let prev = -1;
    let prevT = -1;
    for (const cut of cuts) {
      if (prev >= 0 && (cut.t - prevT) * len < MERGE_M) {
        if (cut.cross >= 0) g.nodeCross[prev] = cut.cross;
        continue;
      }
      const n = nodeAt({ x: s.a.x + dx * cut.t, y: s.a.y + dy * cut.t });
      if (cut.cross >= 0) g.nodeCross[n] = cut.cross;
      if (prev >= 0 && n !== prev) addEdge(g, prev, n, s.kind);
      prev = n;
      prevT = cut.t;
    }
  }
  return g;
}

function addEdge(g: RoadGraph, a: number, b: number, kind: number): void {
  for (const e of g.adj[a]) if ((g.edgeA[e] === b && g.edgeB[e] === a) || (g.edgeA[e] === a && g.edgeB[e] === b)) return;
  const dx = g.nodeX[b] - g.nodeX[a];
  const dy = g.nodeY[b] - g.nodeY[a];
  const e = g.edgeA.length;
  g.edgeA.push(a);
  g.edgeB.push(b);
  g.edgeLen.push(Math.sqrt(dx * dx + dy * dy));
  g.edgeKind.push(kind);
  g.adj[a].push(e);
  g.adj[b].push(e);
  g.nodeDegree[a]++;
  g.nodeDegree[b]++;
}

/** Travel speed of an edge kind in meters per second. */
export function edgeSpeedMps(kind: number): number {
  return (kind === EDGE_ROAD ? GROUND.road.speedKmh : GROUND.apronLane.speedKmh) / 3.6;
}

/** Lane offset of an edge kind: how far right of the centerline vehicles drive. */
export function edgeOffsetM(kind: number): number {
  return kind === EDGE_ROAD ? GROUND.road.laneOffsetM : GROUND.apronLane.laneOffsetM;
}

export interface RoadRoutes {
  /** Travel time from the nearest depot in seconds, Infinity when no depot reaches the node. */
  time: number[];
  /** Edge and node a node was reached from, -1 at a depot or when unreached. */
  viaEdge: number[];
  viaNode: number[];
  /** Depot index each node is served from, or -1. */
  depot: number[];
}

/**
 * Fastest paths from every depot at once (multi source Dijkstra over travel time). Ties keep the lower
 * node index, so the result is deterministic. The graph is small and built only on edits, so the
 * quadratic selection is fine and nothing runs in the tick loop (hard rule 7).
 */
export function routeFromDepots(g: RoadGraph): RoadRoutes {
  return routeFrom(g, g.depotNode);
}

/** Fastest paths from a set of source nodes, as `routeFromDepots`; `depot` then holds the index in `sources`. */
export function routeFrom(g: RoadGraph, sources: readonly number[]): RoadRoutes {
  const n = g.nodeX.length;
  const time = new Array<number>(n).fill(Infinity);
  const viaEdge = new Array<number>(n).fill(-1);
  const viaNode = new Array<number>(n).fill(-1);
  const depot = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  sources.forEach((d, k) => {
    if (time[d] === 0) return;
    time[d] = 0;
    depot[d] = k;
  });
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && time[i] < Infinity && (u < 0 || time[i] < time[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    for (const e of g.adj[u]) {
      const v = g.edgeA[e] === u ? g.edgeB[e] : g.edgeA[e];
      const t = time[u] + g.edgeLen[e] / edgeSpeedMps(g.edgeKind[e]);
      if (t < time[v]) {
        time[v] = t;
        viaEdge[v] = e;
        viaNode[v] = u;
        depot[v] = depot[u];
      }
    }
  }
  return { time, viaEdge, viaNode, depot };
}

/** Node path from the serving depot to a node, or null when no depot reaches it. */
export function pathTo(r: RoadRoutes, node: number): number[] | null {
  if (node < 0 || r.time[node] === Infinity) return null;
  const out: number[] = [];
  for (let n = node; n >= 0; n = r.viaNode[n]) out.push(n);
  return out.reverse();
}

/** Edge between two adjacent nodes, or -1. */
export function edgeBetween(g: RoadGraph, a: number, b: number): number {
  for (const e of g.adj[a]) if (g.edgeA[e] === b || g.edgeB[e] === b) return e;
  return -1;
}

/**
 * The lane a vehicle drives along a node path: each point offset to the right of travel by its edge's
 * lane offset, joined at the nodes by the miter of the two offset lines (limited on sharp turns).
 */
export function lanePolyline(g: RoadGraph, nodes: readonly number[]): Pt[] {
  const out: Pt[] = [];
  if (nodes.length < 2) return nodes.map((n) => ({ x: g.nodeX[n], y: g.nodeY[n] }));
  const right: Pt[] = [];
  const off: number[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    const dx = g.nodeX[b] - g.nodeX[a];
    const dy = g.nodeY[b] - g.nodeY[a];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    right.push({ x: -dy / len, y: dx / len });
    off.push(edgeOffsetM(g.edgeKind[edgeBetween(g, a, b)]));
  }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    let rx: number;
    let ry: number;
    let o: number;
    if (i === 0 || i === nodes.length - 1) {
      const k = i === 0 ? 0 : right.length - 1;
      rx = right[k].x;
      ry = right[k].y;
      o = off[k];
    } else {
      const p = right[i - 1];
      const q = right[i];
      const mx = p.x + q.x;
      const my = p.y + q.y;
      const ml = Math.sqrt(mx * mx + my * my);
      o = (off[i - 1] + off[i]) / 2;
      if (ml < 1e-6) {
        rx = q.x;
        ry = q.y;
      } else {
        rx = mx / ml;
        ry = my / ml;
        o /= Math.max(0.5, rx * q.x + ry * q.y);
      }
    }
    out.push({ x: g.nodeX[n] + rx * o, y: g.nodeY[n] + ry * o });
  }
  return out;
}

/** The rectangle a straight piece of road covers, half its width each side of the centerline. */
export function segmentRect(a: Pt, b: Pt, halfM: number): Pt[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = (-dy / len) * halfM;
  const ny = (dx / len) * halfM;
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}

/** Per stand, same order as `af.stands`: true when a depot reaches its connection point by road. */
export function standsReached(af: AirfieldPayload): boolean[] {
  const g = buildRoadGraph(af);
  const r = routeFromDepots(g);
  return g.standConn.map((n) => n >= 0 && r.time[n] < Infinity);
}
