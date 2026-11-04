import { union, type MultiPolygon, type Polygon as ClipPolygon, type Ring } from '../clip';
import { AIRFIELD, PAINT, SURFACE_SPEC } from '@data/index';
import { atan2Det, cosLut, PI, sinLut, TWO_PI } from '../trig';
import { codeIndex, type CodeLetter, type Surface, type TaxiKind } from '../airfield';
import type { Pt } from '../geom';
import { arcPoints, fillet, wrapAngle, type Fillet } from './fillet';

/**
 * Taxiway pavement and line geometry generated from a node graph (docs/DESIGN_REVISION_2.md
 * section 2.1, ported from `junction()`, `junction2()` and `bend()` in docs/reference/geometry).
 *
 * A node with one arm is an end, two arms a bend, three or more a junction. Nodes whose shapes
 * reach each other along a short edge form one cluster, and each cluster's pieces are merged with
 * a polygon union. Edges between clusters are plain strips. Edge lines and shoulders come from the
 * same pieces built with a smaller or larger half width, which equals an exact inward or outward
 * offset of the merged shape.
 */

export interface PaveNode {
  id: number;
  x: number;
  y: number;
}

export interface PaveEdge {
  id: number;
  /** Node ids, in the direction of the source polyline. */
  a: number;
  b: number;
  hw: number;
  code: CodeLetter;
  surface: Surface;
  kind: TaxiKind;
  closed: boolean;
  /** Taxiway name, for signs. */
  name: string;
}

export interface PaveGraph {
  nodes: PaveNode[];
  edges: PaveEdge[];
}

/** Trims at the end of an edge that meets something outside the graph, such as a runway. */
export interface EndTrim {
  /** Where the centerline starts, measured from the end node. */
  center: number;
  /** Where each edge line starts, per side (+1 is left of the a to b direction in world axes). */
  left: number;
  right: number;
}

/** A corner is a bend whose turn does not fit its arms: the arms meet at a round joint instead. */
export type NodeKind = 'end' | 'straight' | 'corner' | 'bend' | 'junction';

export interface ArmGeom {
  edge: number;
  angle: number;
  dx: number;
  dy: number;
  hw: number;
  code: CodeLetter;
  surface: Surface;
  length: number;
  /** Another arm continues straight through the node, so the centerline crosses it. */
  through: boolean;
  /** Distance from the node where the arm's centerline starts. */
  start: number;
  /** Distance from the node that the node's pavement pieces cover. */
  reach: number;
}

export interface FilletGeom {
  f: Fillet;
  armA: number;
  armB: number;
  /** Half width and shoulder of the turn, from the smaller code of its two arms. */
  hw: number;
  code: CodeLetter;
}

export interface NodeGeom {
  id: number;
  x: number;
  y: number;
  kind: NodeKind;
  arms: ArmGeom[];
  fillets: FilletGeom[];
  /** Radius of the node disc, zero when the node has none. */
  discR: number;
  surface: Surface;
}

export interface SurfacePolys {
  surface: Surface;
  /** Polygons as rings, the first ring outer, the rest holes. */
  polys: Pt[][][];
}

/** A painted line. Lines on concrete get a dark outline so they stay visible. */
export interface Stroke {
  pts: Pt[];
  outlined: boolean;
}

export interface CenterLine extends Stroke {
  closed: boolean;
}

/** One box of a taxiway sign: a location box (yellow on black) or a direction box (black on yellow). */
export interface SignPart {
  text: string;
  location: boolean;
}

/** Signs beside a taxiway before a junction, facing the aircraft that approach it. */
export interface Sign {
  x: number;
  y: number;
  /** Direction of the text baseline in radians, to the right of the approaching aircraft. */
  angle: number;
  parts: SignPart[];
}

export interface PavementGeom {
  nodes: Map<number, NodeGeom>;
  fills: SurfacePolys[];
  shoulders: SurfacePolys[];
  /** Double edge lines on painted pavement, each a polyline. */
  edgeLines: Stroke[];
  centerlines: CenterLine[];
  /** Yellow transverse stripes across the shoulders on junction fillets. */
  stripes: Stroke[];
  /** Edge markers along unpaved pavement. */
  markers: Pt[];
  /** Slab joints on concrete strips, aligned with the taxiway. */
  joints: Pt[][];
  signs: Sign[];
  /** Nodes per cluster, so callers can see which nodes were merged. */
  clusters: number[][];
}

const TW = PAINT.taxiway;
const STRAIGHT_TOL = (1 * PI) / 180;
const THROUGH_TOL = (10 * PI) / 180;
const FILLET_MAX = (170 * PI) / 180;
const ARC_STEP_M = 1;
const CAP_EPS = 1e-4;
const CLUSTER_MARGIN_M = 0.5;
const MIN_RADIUS_MARGIN_M = 0.5;
/** Arm strips start this far behind their node, so their end edges do not all cross in one point. */
const STRIP_BACK_M = 0.01;
const FILL_INSET_M = 0.05;
/**
 * Plain strip fills overlap the cluster they join by this much, so the join never depends on exact
 * equality and leaves no antialiasing seam at the sharpest bake scale (4 px per meter). Lines still
 * meet exactly at the cap.
 */
const JOIN_OVERLAP_M = 0.5;

const SURFACE_RANK: Record<Surface, number> = { grass: 0, dirt: 1, gravel: 2, asphalt: 3, concrete: 4 };
export const isPavedSurface = (s: Surface): boolean => s === 'asphalt' || s === 'concrete';
const smallerCode = (a: CodeLetter, b: CodeLetter): CodeLetter => (codeIndex(a) <= codeIndex(b) ? a : b);
const shoulderOf = (code: CodeLetter): number => AIRFIELD.codes[code].taxiwayShoulderM;

/** Builds the geometry of every node: kind, arm angles, turn curves, centerline starts and reaches. */
export function nodeGeometry(graph: PaveGraph): Map<number, NodeGeom> {
  const pos = new Map<number, PaveNode>();
  for (const n of graph.nodes) pos.set(n.id, n);
  const armsOf = new Map<number, ArmGeom[]>();
  for (const n of graph.nodes) armsOf.set(n.id, []);
  for (const e of graph.edges) {
    const a = pos.get(e.a);
    const b = pos.get(e.b);
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length <= 0) continue;
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const angle = wrapAngle(atan2Det(to.y - from.y, to.x - from.x));
      armsOf.get(from.id)?.push({ edge: e.id, angle, dx: (to.x - from.x) / length, dy: (to.y - from.y) / length, hw: e.hw, code: e.code, surface: e.surface, length, through: false, start: 0, reach: 0 });
    }
  }
  // First pass at full radius, then shrink nodes whose turns do not fit their edges.
  const full = new Map<number, NodeGeom>();
  for (const n of graph.nodes) full.set(n.id, buildNode(n, armsOf.get(n.id) ?? [], 1));
  const need = (g: NodeGeom, edge: number): number => {
    let m = 0;
    for (const f of g.fillets) {
      if (g.arms[f.armA].edge === edge || g.arms[f.armB].edge === edge) m = Math.max(m, f.f.td);
    }
    return m;
  };
  const scale = new Map<number, number>();
  for (const e of graph.edges) {
    const ga = full.get(e.a);
    const gb = full.get(e.b);
    if (!ga || !gb) continue;
    const arm = ga.arms.find((x) => x.edge === e.id);
    if (!arm) continue;
    const na = need(ga, e.id);
    const nb = need(gb, e.id);
    if (na + nb <= arm.length) continue;
    const ka = na > 0 ? (arm.length * (na / (na + nb))) / na : 1;
    const kb = nb > 0 ? (arm.length * (nb / (na + nb))) / nb : 1;
    scale.set(e.a, Math.min(scale.get(e.a) ?? 1, ka));
    scale.set(e.b, Math.min(scale.get(e.b) ?? 1, kb));
  }
  const out = new Map<number, NodeGeom>();
  for (const n of graph.nodes) {
    const k = scale.get(n.id);
    out.set(n.id, k === undefined ? (full.get(n.id) as NodeGeom) : buildNode(n, armsOf.get(n.id) ?? [], k));
  }
  return out;
}

function buildNode(n: PaveNode, armsIn: readonly ArmGeom[], k: number): NodeGeom {
  const arms = armsIn.map((a) => ({ ...a })).sort((p, q) => p.angle - q.angle || p.edge - q.edge);
  const g: NodeGeom = { id: n.id, x: n.x, y: n.y, kind: 'end', arms, fillets: [], discR: 0, surface: 'grass' };
  for (const a of arms) if (SURFACE_RANK[a.surface] > SURFACE_RANK[g.surface]) g.surface = a.surface;
  if (arms.length === 0) return g;
  if (arms.length === 1) return g;
  const turn = (i: number, j: number): void => {
    const A = arms[i];
    const B = arms[j];
    // A junction turn is used by aircraft that fit both arms, so it takes the smaller code. A bend
    // carries the wider pavement round, so a width change there shows as a step, never a notch.
    const code = arms.length === 2 ? (codeIndex(A.code) >= codeIndex(B.code) ? A.code : B.code) : smallerCode(A.code, B.code);
    const hw = arms.length === 2 ? Math.max(A.hw, B.hw) : Math.min(A.hw, B.hw);
    const r = AIRFIELD.codes[code].turnRadiusM * k;
    // A turn tighter than its own half width cannot be laid; the arms then meet without one.
    if (r < hw + MIN_RADIUS_MARGIN_M) return;
    g.fillets.push({ f: fillet(n.x, n.y, A.angle, B.angle, 0, r), armA: i, armB: j, hw, code });
  };
  if (arms.length === 2) {
    const th = wrapAngle(arms[1].angle - arms[0].angle);
    if (Math.abs(th - PI) < STRAIGHT_TOL) {
      g.kind = 'straight';
      g.discR = Math.max(arms[0].hw, arms[1].hw);
      for (const a of arms) {
        a.through = true;
        a.reach = g.discR;
      }
      return g;
    }
    if (th < PI) turn(0, 1);
    else turn(1, 0);
    if (g.fillets.length === 0) {
      g.kind = 'corner';
      g.discR = Math.max(arms[0].hw, arms[1].hw);
      for (const a of arms) a.reach = g.discR;
      return g;
    }
    g.kind = 'bend';
    const td = g.fillets[0].f.td;
    for (const a of arms) {
      a.start = td;
      a.reach = td;
    }
    return g;
  }
  g.kind = 'junction';
  for (let i = 0; i < arms.length; i++) {
    const j = (i + 1) % arms.length;
    if (wrapAngle(arms[j].angle - arms[i].angle) < FILLET_MAX) turn(i, j);
  }
  g.discR = Math.max(...arms.map((a) => a.hw));
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i];
    a.through = arms.some((b, j) => j !== i && Math.abs(wrapAngle(b.angle - a.angle) - PI) < THROUGH_TOL);
    let minTd = Infinity;
    let maxTd = 0;
    for (const f of g.fillets) {
      if (f.armA !== i && f.armB !== i) continue;
      minTd = Math.min(minTd, f.f.td);
      maxTd = Math.max(maxTd, f.f.td);
    }
    a.start = a.through || minTd === Infinity ? 0 : minTd;
    a.reach = Math.max(maxTd, g.discR);
  }
  return g;
}

// Pieces --------------------------------------------------------------------------------------

type HalfWidth = (hw: number, code: CodeLetter) => number;

const ring = (pts: readonly Pt[]): Ring => pts.map((p) => [p.x, p.y]);

function strip(x: number, y: number, dx: number, dy: number, s0: number, s1: number, h: number): ClipPolygon {
  const nx = -dy * h;
  const ny = dx * h;
  const ax = x + dx * s0;
  const ay = y + dy * s0;
  const bx = x + dx * s1;
  const by = y + dy * s1;
  return [[[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]];
}

function disc(x: number, y: number, r: number): ClipPolygon {
  const n = Math.max(16, Math.ceil((TWO_PI * r) / ARC_STEP_M));
  const pts: Ring = [];
  for (let i = 0; i < n; i++) {
    const t = (TWO_PI * i) / n;
    pts.push([x + r * cosLut(t), y + r * sinLut(t)]);
  }
  return [pts];
}

/** The turn centerline swept at half width h: an annular sector between radii r - h and r + h. */
function sweep(f: Fillet, h: number): ClipPolygon {
  const outer = arcPoints(f.cx, f.cy, f.r + h, f.a0, f.sweep, ARC_STEP_M);
  const inner = f.r - h > 0 ? arcPoints(f.cx, f.cy, f.r - h, f.a0, f.sweep, ARC_STEP_M).reverse() : [{ x: f.cx, y: f.cy }];
  return [ring([...outer, ...inner])];
}

/** Turn centerline points of a fillet. */
export function filletLine(f: Fillet): Pt[] {
  return arcPoints(f.cx, f.cy, f.r, f.a0, f.sweep, ARC_STEP_M);
}

/** The node's own pieces without arm strips: the disc, the swept turns and the area they enclose. */
function nodePieces(g: NodeGeom, width: HalfWidth): ClipPolygon[] {
  const out: ClipPolygon[] = [];
  if (g.kind === 'end') return out;
  if (g.kind !== 'bend') {
    const maxArm = g.arms.reduce((m, a) => (width(a.hw, a.code) > width(m.hw, m.code) ? a : m), g.arms[0]);
    out.push(disc(g.x, g.y, width(maxArm.hw, maxArm.code)));
  }
  for (const f of g.fillets) {
    out.push(sweep(f.f, width(f.hw, f.code)));
    if (g.kind !== 'junction') continue;
    // The area between the node and the turn. When the node lies within the swept turn it is covered
    // already and is left out, which avoids slivers the clipper handles badly.
    const h = width(f.hw, f.code);
    const half = wrapAngle(g.arms[f.armB].angle - g.arms[f.armA].angle) / 2;
    const gap = f.f.r / sinLut(half) - f.f.r;
    if (gap < h * 0.9) continue;
    // Its corner sits a little into the sector so neighboring fills never share an edge or a vertex.
    const a = g.arms[f.armA];
    const b = g.arms[f.armB];
    const bx = a.dx + b.dx;
    const by = a.dy + b.dy;
    const bl = Math.hypot(bx, by) || 1;
    out.push([ring([{ x: g.x + (bx / bl) * FILL_INSET_M, y: g.y + (by / bl) * FILL_INSET_M }, ...filletLine(f.f)])]);
  }
  return out;
}

interface Cap {
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Largest sideways distance of the cap from the arm centerline. */
  lat: number;
}

const onCapLine = (c: Cap, p: readonly number[]): boolean =>
  Math.abs((p[0] - c.x) * c.dx + (p[1] - c.y) * c.dy) < CAP_EPS && Math.abs(-(p[0] - c.x) * c.dy + (p[1] - c.y) * c.dx) <= c.lat;

const onCap = (caps: readonly Cap[], p: readonly number[], q: readonly number[]): boolean => {
  for (const c of caps) if (onCapLine(c, p) && onCapLine(c, q)) return true;
  return false;
};

/** Outline runs of a merged shape, leaving out the flat caps where the shape continues as a plain strip. */
function outlineRuns(mp: MultiPolygon, caps: readonly Cap[]): Pt[][] {
  const runs: Pt[][] = [];
  for (const poly of mp) {
    for (const r of poly) {
      const n = r.length - 1;
      if (n < 2) continue;
      // Start the walk at a cap edge when there is one, so no run is split at the ring seam.
      let first = 0;
      for (let i = 0; i < n; i++) {
        if (onCap(caps, r[i], r[i + 1])) {
          first = i + 1;
          break;
        }
      }
      let cur: Pt[] | null = null;
      for (let k = 0; k < n; k++) {
        const i = (first + k) % n;
        const p = r[i];
        const q = r[i + 1];
        if (onCap(caps, p, q)) {
          cur = null;
          continue;
        }
        if (!cur) {
          cur = [{ x: p[0], y: p[1] }];
          runs.push(cur);
        }
        cur.push({ x: q[0], y: q[1] });
      }
    }
  }
  return runs;
}

/** Rings smaller than this are clipper leftovers, never pavement anyone built. */
const MIN_RING_AREA_M2 = 0.5;

function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0; i + 1 < r.length; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(a / 2);
}

/** Drops leftover slivers: tiny outer rings with their holes, and tiny holes. */
function clean(mp: MultiPolygon): MultiPolygon {
  const out: MultiPolygon = [];
  for (const poly of mp) {
    if (poly.length === 0 || ringArea(poly[0]) < MIN_RING_AREA_M2) continue;
    out.push(poly.filter((r, i) => i === 0 || ringArea(r) >= MIN_RING_AREA_M2));
  }
  return out;
}

const toPts = (mp: MultiPolygon): Pt[][][] => mp.map((poly) => poly.map((r) => r.map(([x, y]) => ({ x, y }))));

/** Grid the clipper input is snapped to. It removes the near zero noise that trips the sweep line. */
const SNAP_M = 1e-4;
const snap = (v: number, grid = SNAP_M, shift = 0): number => Math.round((v + shift) / grid) * grid - shift;

function snapPolygon(p: ClipPolygon, grid = SNAP_M, shift = 0): ClipPolygon {
  const out: ClipPolygon = [];
  for (const r of p) {
    const q: Ring = [];
    for (const [x, y] of r) {
      const sx = snap(x, grid, shift);
      const sy = snap(y, grid, shift);
      const last = q[q.length - 1];
      if (!last || last[0] !== sx || last[1] !== sy) q.push([sx, sy]);
    }
    while (q.length > 1 && q[0][0] === q[q.length - 1][0] && q[0][1] === q[q.length - 1][1]) q.pop();
    if (q.length >= 3) out.push(q);
  }
  return out;
}

function unionOnce(pieces: readonly ClipPolygon[], grid: number, shift: number): MultiPolygon {
  const snapped = pieces.map((p) => snapPolygon(p, grid, shift)).filter((p) => p.length > 0);
  if (snapped.length === 0) return [];
  return clean(union(snapped[0], ...snapped.slice(1)));
}

/** Snap grids and grid shifts to try in turn when the clipper fails on a degenerate input. */
const UNION_ATTEMPTS: readonly [number, number][] = [
  [SNAP_M, 0],
  [SNAP_M, SNAP_M * 0.37],
  [SNAP_M * 10, 0],
  [SNAP_M * 10, SNAP_M * 4.1],
  [SNAP_M * 100, 0],
];

/**
 * Union of all pieces. The clipper can fail on near degenerate input, so a failed union is retried
 * on shifted and coarser grids, and finally merged one piece at a time, leaving out a piece only
 * when nothing else works. The result is always a valid shape.
 */
function unionAll(pieces: readonly ClipPolygon[]): MultiPolygon {
  for (const [grid, shift] of UNION_ATTEMPTS) {
    try {
      return unionOnce(pieces, grid, shift);
    } catch {
      // Try the next grid.
    }
  }
  let acc: MultiPolygon = [];
  for (const p of pieces) {
    for (const [grid, shift] of UNION_ATTEMPTS) {
      try {
        acc = acc.length === 0 ? unionOnce([p], grid, shift) : union(acc, snapPolygon(p, grid, shift));
        break;
      } catch {
        // Try the next grid for this piece.
      }
    }
  }
  return clean(acc);
}

// Clusters ------------------------------------------------------------------------------------

interface ClusterOut {
  fills: SurfacePolys[];
  shoulders: SurfacePolys[];
  edgeLines: Stroke[];
  stripes: Stroke[];
  markers: Pt[];
}

/** What a cluster needs besides its pieces to place stripes. */
interface ClusterInfo {
  /** Arm centerlines of its nodes, as segments with the arm half width. */
  segs: [number, number, number, number, number][];
  /** Junction nodes, how far from them fillet stripes may go, and their shoulder width. */
  junctions: { x: number; y: number; reach: number; sw: number }[];
  outlined: boolean;
}

/** Merged cluster shapes by content key, so an edit only rebuilds the clusters it touched. */
const clusterCache = new Map<string, ClusterOut>();

interface Piece {
  surface: Surface;
  painted: boolean;
  make: (w: HalfWidth) => ClipPolygon[];
}

function buildCluster(pieces: readonly Piece[], caps: readonly Cap[], info: ClusterInfo): ClusterOut {
  const surfaces = [...new Set(pieces.map((p) => p.surface))].sort((a, b) => SURFACE_RANK[a] - SURFACE_RANK[b]);
  const out: ClusterOut = { fills: [], shoulders: [], edgeLines: [], stripes: [], markers: [] };
  for (const s of surfaces) {
    const own = pieces.filter((p) => p.surface === s);
    const fill = unionAll(own.flatMap((p) => p.make((hw) => hw)));
    out.fills.push({ surface: s, polys: toPts(fill) });
    if (isPavedSurface(s)) {
      const sh = unionAll(own.flatMap((p) => p.make((hw, code) => hw + shoulderOf(code))));
      if (sh.length > 0) out.shoulders.push({ surface: s, polys: toPts(sh) });
    } else {
      const spacing = SURFACE_SPEC[s].unpavedMarkerSpacingM ?? 0;
      for (const run of outlineRuns(fill, caps)) out.markers.push(...samplesAlong(run, spacing).map((q) => ({ x: q.x, y: q.y })));
    }
  }
  const painted = pieces.filter((p) => p.painted);
  if (painted.length === 0) return out;
  for (const inset of TW.edgeLineInsetsM) {
    for (const pts of outlineRuns(unionAll(painted.flatMap((p) => p.make((hw) => hw - inset))), caps)) out.edgeLines.push({ pts, outlined: info.outlined });
  }
  if (info.junctions.length === 0) return out;
  // Shoulder stripes on the fillets (`junction2` in fig6.py): every few meters along the pavement edge,
  // not beside straight arms and not far from the junction, across the shoulder from just off the edge.
  const edge = unionAll(painted.flatMap((p) => p.make((hw) => hw)));
  for (const run of outlineRuns(edge, caps)) {
    for (const q of samplesAlong(run, TW.shoulderStripeSpacingM)) {
      let near: ClusterInfo['junctions'][number] | null = null;
      let nearD = Infinity;
      for (const j of info.junctions) {
        const d = Math.hypot(q.x - j.x, q.y - j.y);
        if (d < nearD) {
          nearD = d;
          near = j;
        }
      }
      if (!near || nearD > near.reach || near.sw <= 0) continue;
      if (info.segs.some(([ax, ay, bx, by, hw]) => distToSeg(q.x, q.y, ax, ay, bx, by) < hw + TW.shoulderStripeEdgeClearM)) continue;
      let nx = q.ty;
      let ny = -q.tx;
      if (insideRings(edge, q.x + nx, q.y + ny)) {
        nx = -nx;
        ny = -ny;
      }
      out.stripes.push({
        pts: [
          { x: q.x + nx * TW.shoulderStripeInsetM, y: q.y + ny * TW.shoulderStripeInsetM },
          { x: q.x + nx * (near.sw - TW.shoulderStripeEndGapM), y: q.y + ny * (near.sw - TW.shoulderStripeEndGapM) },
        ],
        outlined: info.outlined,
      });
    }
  }
  return out;
}

/** Points every `step` meters along a polyline with the unit tangent there. */
function samplesAlong(pts: readonly Pt[], step: number): { x: number; y: number; tx: number; ty: number }[] {
  const out: { x: number; y: number; tx: number; ty: number }[] = [];
  if (step <= 0) return out;
  let next = 0;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l === 0) continue;
    while (next <= acc + l) {
      const t = (next - acc) / l;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tx: (b.x - a.x) / l, ty: (b.y - a.y) / l });
      next += step;
    }
    acc += l;
  }
  return out;
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Even odd point test against every ring of a shape. */
function insideRings(mp: MultiPolygon, x: number, y: number): boolean {
  let inside = false;
  for (const poly of mp) {
    for (const r of poly) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i];
        const [xj, yj] = r[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

/** Builds pavement fills, shoulders, edge lines and centerlines for a taxiway graph. */
export function buildPavement(graph: PaveGraph, trims: ReadonlyMap<string, EndTrim> = new Map()): PavementGeom {
  const geo = nodeGeometry(graph);
  const edgeById = new Map<number, PaveEdge>();
  for (const e of graph.edges) edgeById.set(e.id, e);
  const armOf = (node: number, edge: number): ArmGeom | undefined => geo.get(node)?.arms.find((a) => a.edge === edge);

  // Union find over nodes whose shapes reach each other.
  const parent = new Map<number, number>();
  for (const n of graph.nodes) parent.set(n.id, n.id);
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    let c = x;
    while (c !== r) {
      const next = parent.get(c) as number;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const internal = new Set<number>();
  for (const e of graph.edges) {
    const aa = armOf(e.a, e.id);
    const ab = armOf(e.b, e.id);
    if (!aa || !ab) continue;
    if (aa.reach + ab.reach + CLUSTER_MARGIN_M <= aa.length) continue;
    if ((geo.get(e.a)?.kind ?? 'end') === 'end' && (geo.get(e.b)?.kind ?? 'end') === 'end') continue;
    internal.add(e.id);
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  }
  const members = new Map<number, number[]>();
  for (const n of graph.nodes) {
    const r = find(n.id);
    const l = members.get(r);
    if (l) l.push(n.id);
    else members.set(r, [n.id]);
  }

  const out: PavementGeom = { nodes: geo, fills: [], shoulders: [], edgeLines: [], centerlines: [], stripes: [], markers: [], joints: [], signs: [], clusters: [] };
  const paintedEdge = (e: PaveEdge): boolean => isPavedSurface(e.surface) && e.kind !== 'taxilane';
  const used = new Set<string>();
  for (const ids of [...members.values()].sort((p, q) => p[0] - q[0])) {
    const nodes = ids.map((id) => geo.get(id) as NodeGeom).filter((g) => g.kind !== 'end' || g.arms.some((a) => internal.has(a.edge)));
    if (nodes.length === 0) continue;
    out.clusters.push(ids);
    const pieces: Piece[] = [];
    const caps: Cap[] = [];
    const keyParts: string[] = [];
    for (const g of nodes) {
      const painted = g.arms.some((a) => {
        const e = edgeById.get(a.edge);
        return e !== undefined && paintedEdge(e);
      });
      keyParts.push(`${g.id}|${g.x}|${g.y}|${g.kind}|${g.surface}|${painted}|${g.arms.map((a) => `${a.edge}:${a.angle}:${a.hw}:${a.code}:${a.surface}:${edgeById.get(a.edge)?.kind}:${a.reach}:${a.length}:${internal.has(a.edge)}`).join(',')}`);
      pieces.push({ surface: g.surface, painted, make: (w) => nodePieces(g, w) });
      for (const a of g.arms) {
        const e = edgeById.get(a.edge);
        if (!e) continue;
        if (internal.has(a.edge)) {
          // A short edge inside the cluster is laid once, from its first node.
          if (e.a !== g.id) continue;
          pieces.push({ surface: e.surface, painted: paintedEdge(e), make: (w) => [strip(g.x, g.y, a.dx, a.dy, -STRIP_BACK_M, a.length + STRIP_BACK_M, w(a.hw, a.code))] });
          keyParts.push(`i${e.id}|${a.length}|${e.surface}|${e.kind}`);
          continue;
        }
        if (g.kind === 'end') continue;
        // The arm continues as a plain strip from its reach, so the cluster shape ends there with a flat cap.
        if (g.kind !== 'bend') pieces.push({ surface: e.surface, painted: paintedEdge(e), make: (w) => [strip(g.x, g.y, a.dx, a.dy, -STRIP_BACK_M, a.reach, w(a.hw, a.code))] });
        caps.push({ x: g.x + a.dx * a.reach, y: g.y + a.dy * a.reach, dx: a.dx, dy: a.dy, lat: a.hw + CAP_EPS });
      }
    }
    const key = keyParts.join(';');
    used.add(key);
    let c = clusterCache.get(key);
    if (!c) {
      const info: ClusterInfo = { segs: [], junctions: [], outlined: nodes.some((g) => g.surface === 'concrete') };
      for (const g of nodes) {
        for (const a of g.arms) info.segs.push([g.x, g.y, g.x + a.dx * a.length, g.y + a.dy * a.length, a.hw]);
        if (g.kind !== 'junction' || g.fillets.length === 0) continue;
        const r = Math.max(...g.fillets.map((f) => f.f.r));
        const sw = Math.max(0, ...g.arms.filter((a) => isPavedSurface(a.surface)).map((a) => shoulderOf(a.code)));
        info.junctions.push({ x: g.x, y: g.y, reach: r * TW.shoulderStripeReachFactor, sw });
      }
      c = buildCluster(pieces, caps, info);
      clusterCache.set(key, c);
    }
    out.fills.push(...c.fills);
    out.shoulders.push(...c.shoulders);
    out.edgeLines.push(...c.edgeLines);
    out.stripes.push(...c.stripes);
    out.markers.push(...c.markers);
  }
  for (const k of [...clusterCache.keys()]) if (!used.has(k)) clusterCache.delete(k);

  // Plain strips between clusters, and every edge's centerline.
  const pos = new Map<number, PaveNode>();
  for (const n of graph.nodes) pos.set(n.id, n);
  for (const e of graph.edges) {
    const A = pos.get(e.a);
    const aa = armOf(e.a, e.id);
    const ab = armOf(e.b, e.id);
    if (!A || !aa || !ab) continue;
    const L = aa.length;
    const trimA = trims.get(`${e.id}:0`);
    const trimB = trims.get(`${e.id}:1`);
    const c0 = Math.max(aa.start, trimA?.center ?? 0);
    const c1 = L - Math.max(ab.start, trimB?.center ?? 0);
    const outlined = e.surface === 'concrete';
    if (c1 > c0 && isPavedSurface(e.surface)) out.centerlines.push({ pts: [{ x: A.x + aa.dx * c0, y: A.y + aa.dy * c0 }, { x: A.x + aa.dx * c1, y: A.y + aa.dy * c1 }], closed: e.closed, outlined });
    if (internal.has(e.id)) continue;
    const s0 = aa.reach;
    const s1 = L - ab.reach;
    if (s1 <= s0) continue;
    const f0 = s0 > 0 ? s0 - JOIN_OVERLAP_M : s0;
    const f1 = s1 < L ? s1 + JOIN_OVERLAP_M : s1;
    const poly = snapPolygon(strip(A.x, A.y, aa.dx, aa.dy, f0, f1, e.hw));
    out.fills.push({ surface: e.surface, polys: [poly.map((r) => r.map(([x, y]) => ({ x, y })))] });
    if (isPavedSurface(e.surface) && shoulderOf(e.code) > 0) {
      const sp = snapPolygon(strip(A.x, A.y, aa.dx, aa.dy, f0, f1, e.hw + shoulderOf(e.code)));
      out.shoulders.push({ surface: e.surface, polys: [sp.map((r) => r.map(([x, y]) => ({ x, y })))] });
    }
    if (!isPavedSurface(e.surface)) {
      // Unpaved: no paint, edge markers along both edges.
      const spacing = SURFACE_SPEC[e.surface].unpavedMarkerSpacingM ?? 0;
      for (const side of [1, -1]) {
        const nx = -aa.dy * side * e.hw;
        const ny = aa.dx * side * e.hw;
        for (let d = s0; spacing > 0 && d <= s1; d += spacing) out.markers.push({ x: A.x + aa.dx * d + nx, y: A.y + aa.dy * d + ny });
      }
      continue;
    }
    const slab = SURFACE_SPEC[e.surface].slabJointM;
    if (slab !== null) {
      const at = (d: number, lat: number): Pt => ({ x: A.x + aa.dx * d - aa.dy * lat, y: A.y + aa.dy * d + aa.dx * lat });
      for (let d = Math.ceil(s0 / slab) * slab; d <= s1; d += slab) out.joints.push([at(d, -e.hw), at(d, e.hw)]);
      for (let lat = -e.hw + slab; lat < e.hw - 0.5; lat += slab) out.joints.push([at(s0, lat), at(s1, lat)]);
    }
    if (!paintedEdge(e)) continue;
    for (const side of [1, -1] as const) {
      const from = Math.max(s0, (side === 1 ? trimA?.left : trimA?.right) ?? 0);
      const to = Math.min(s1, L - ((side === 1 ? trimB?.left : trimB?.right) ?? 0));
      if (to <= from) continue;
      for (const inset of TW.edgeLineInsetsM) {
        const d = side * (e.hw - inset);
        const nx = -aa.dy * d;
        const ny = aa.dx * d;
        out.edgeLines.push({
          pts: [
            { x: A.x + aa.dx * from + nx, y: A.y + aa.dy * from + ny },
            { x: A.x + aa.dx * to + nx, y: A.y + aa.dy * to + ny },
          ],
          outlined,
        });
      }
    }
  }
  for (const g of geo.values()) {
    for (const f of g.fillets) {
      const ea = edgeById.get(g.arms[f.armA].edge);
      const eb = edgeById.get(g.arms[f.armB].edge);
      if (!ea || !eb || !isPavedSurface(ea.surface) || !isPavedSurface(eb.surface)) continue;
      out.centerlines.push({ pts: filletLine(f.f), closed: ea.closed && eb.closed, outlined: ea.surface === 'concrete' || eb.surface === 'concrete' });
    }
    if (g.kind === 'junction') out.signs.push(...junctionSigns(g, edgeById));
  }
  return out;
}

const ARROWS: readonly [number, string][] = [
  [-0.75, '\u2190'],
  [-0.25, '\u2196'],
  [0.25, '\u2191'],
  [0.75, '\u2197'],
  [Infinity, '\u2192'],
];

/**
 * Location and direction signs before a junction, one group per arm that leads into it: placed beside
 * the pavement on the left of the approaching aircraft, the location box with the arm's own name and a
 * direction box for each other taxiway, arrows pointing left on the left (docs/DESIGN_REVISION_2.md 2.4).
 */
function junctionSigns(g: NodeGeom, edgeById: ReadonlyMap<number, PaveEdge>): Sign[] {
  const out: Sign[] = [];
  for (const a of g.arms) {
    const e = edgeById.get(a.edge);
    if (!e || e.kind === 'taxilane' || e.name === '') continue;
    const d = Math.min(TW.signBeforeJunctionM, a.length / 2);
    if (d < a.reach) continue;
    // The aircraft travels toward the node, against the arm direction.
    const vx = -a.dx;
    const vy = -a.dy;
    const dirs: { turn: number; text: string }[] = [];
    for (const b of g.arms) {
      const eb = edgeById.get(b.edge);
      if (b === a || !eb || eb.name === '' || eb.name === e.name || eb.kind === 'taxilane') continue;
      const cross = vx * b.dy - vy * b.dx;
      const dot = vx * b.dx + vy * b.dy;
      // Signed turn from -1 (hard left) to +1 (hard right).
      const turn = cross >= 0 ? 1 - (dot + 1) / 2 : -(1 - (dot + 1) / 2);
      const arrow = ARROWS.find(([lim]) => turn * 2 < lim)?.[1] ?? '\u2192';
      dirs.push({ turn, text: turn < 0 ? `${arrow} ${eb.name}` : `${eb.name} ${arrow}` });
    }
    if (dirs.length === 0) continue;
    dirs.sort((p, q) => p.turn - q.turn);
    const parts: SignPart[] = [
      ...dirs.filter((x) => x.turn < 0).map((x) => ({ text: x.text, location: false })),
      { text: e.name, location: true },
      ...dirs.filter((x) => x.turn >= 0).map((x) => ({ text: x.text, location: false })),
    ];
    // Left of travel in screen axes (y down) is (vy, -vx).
    const off = a.hw + (isPavedSurface(e.surface) ? shoulderOf(e.code) : 0) + TW.signOffsetM + TW.signHeightM / 2;
    out.push({ x: g.x + a.dx * d + vy * off, y: g.y + a.dy * d - vx * off, angle: atan2Det(vx, -vy), parts });
  }
  return out;
}
