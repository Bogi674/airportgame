import { AIRFIELD } from '@data/index';
import { compassVector, type AirfieldPayload, type Runway, type Taxiway } from '@shared/airfield';
import type { Pt } from '@shared/geom';

/**
 * Plans taxiway and runway paint from the built geometry. Everything the player builds is turned
 * into marking geometry automatically: smoothed taxiway corners with fillets, curved lead-on lines
 * where a taxiway meets another taxiway or a runway, edge lines that open at junctions, runway
 * holding positions with their signs, enhanced centerlines and stand lead-in lines. The plan is
 * computed once per airfield change and drawn per chunk.
 */

export interface Line {
  pts: Pt[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface HoldMark {
  x: number;
  y: number;
  /** Unit direction along the taxiway toward the runway. */
  dx: number;
  dy: number;
  widthM: number;
  taxiName: string;
  runwayName: string;
  instrument: boolean;
}

export interface Plan {
  /** Smoothed centerlines per taxiway id, used for the pavement too. */
  smooth: Map<number, Pt[]>;
  patches: Pt[][];
  centerlines: Line[];
  redCenterlines: Line[];
  edges: Line[];
  enhanced: Line[];
  leadIns: Line[];
  holds: HoldMark[];
  /** Cuts in the white runway edge stripes at taxiway openings, per runway id: [s0, s1] along the runway. */
  /** Openings in the runway edge stripes: start, end and the side (+1 right of travel, -1 left) they are on. */
  runwayBreaks: Map<number, [number, number, number][]>;
}

const EDGE_INSETS = [0.45, 0.8];
const STEP = 1.2;

const mkLine = (pts: Pt[]): Line => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { pts, minX, minY, maxX, maxY };
};

const len = (x: number, y: number): number => Math.hypot(x, y);

/** Points along an arc from angle a0 to a1 taking the short way round. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): Pt[] {
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const n = Math.max(3, Math.ceil((Math.abs(d) * r) / STEP));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (d * i) / n;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

/** Rounds the corners of a polyline with arcs. A corner turning less than 8 degrees is left alone. */
export function smoothCorners(pts: readonly Pt[], radius: number): Pt[] {
  if (pts.length < 3) return pts.map((p) => ({ x: p.x, y: p.y }));
  const out: Pt[] = [{ x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const l0 = len(b.x - a.x, b.y - a.y);
    const l1 = len(c.x - b.x, c.y - b.y);
    if (l0 === 0 || l1 === 0) continue;
    const d0 = { x: (b.x - a.x) / l0, y: (b.y - a.y) / l0 };
    const d1 = { x: (c.x - b.x) / l1, y: (c.y - b.y) / l1 };
    const cross = d0.x * d1.y - d0.y * d1.x;
    const dot = d0.x * d1.x + d0.y * d1.y;
    const turn = Math.atan2(Math.abs(cross), dot);
    if (turn < (8 * Math.PI) / 180) {
      out.push({ x: b.x, y: b.y });
      continue;
    }
    let t = radius * Math.tan(turn / 2);
    const lim = 0.45 * Math.min(l0, l1);
    let r = radius;
    if (t > lim) {
      t = lim;
      r = t / Math.tan(turn / 2);
    }
    const p0 = { x: b.x - d0.x * t, y: b.y - d0.y * t };
    const p1 = { x: b.x + d1.x * t, y: b.y + d1.y * t };
    const sign = cross > 0 ? 1 : -1;
    // Centre lies on the inside of the turn.
    const cx = p0.x + -d0.y * sign * r;
    const cy = p0.y + d0.x * sign * r;
    out.push(...arc(cx, cy, r, Math.atan2(p0.y - cy, p0.x - cx), Math.atan2(p1.y - cy, p1.x - cx)));
  }
  const last = pts[pts.length - 1];
  out.push({ x: last.x, y: last.y });
  return out;
}

/** Arc length positions along a polyline. */
function cumulative(pts: readonly Pt[]): number[] {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + len(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return s;
}

interface Hit {
  dist: number;
  along: number;
  /** Unit direction of the segment at the hit. */
  tx: number;
  ty: number;
  /** Position inside the segment, 0 to 1. */
  t: number;
  x: number;
  y: number;
}

function closestOnPolyline(pts: readonly Pt[], cum: readonly number[], x: number, y: number): Hit | null {
  let best: Hit | null = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) continue;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const d = len(x - px, y - py);
    if (!best || d < best.dist) {
      const l = Math.sqrt(l2);
      best = { dist: d, along: cum[i - 1] + l * t, tx: dx / l, ty: dy / l, t, x: px, y: py };
    }
  }
  return best;
}

/** Position and unit direction at a distance along a polyline, clamped to its ends. */
function pointAlong(pts: readonly Pt[], cum: readonly number[], s: number): { x: number; y: number; tx: number; ty: number } | null {
  if (pts.length < 2) return null;
  const total = cum[pts.length - 1] ?? 0;
  const d = s < 0 ? 0 : s > total ? total : s;
  for (let i = 1; i < pts.length; i++) {
    if (d > cum[i] && i < pts.length - 1) continue;
    const l = cum[i] - cum[i - 1];
    if (l <= 0) continue;
    const t = (d - cum[i - 1]) / l;
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const ll = len(dx, dy) || 1;
    return { x: pts[i - 1].x + dx * t, y: pts[i - 1].y + dy * t, tx: dx / ll, ty: dy / ll };
  }
  return null;
}

/** Offsets a polyline sideways with mitred corners. */
export function offsetPolyline(pts: readonly Pt[], d: number): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    let nx0 = 0;
    let ny0 = 0;
    let nx1 = 0;
    let ny1 = 0;
    if (i > 0) {
      const l = len(p.x - pts[i - 1].x, p.y - pts[i - 1].y) || 1;
      nx0 = -(p.y - pts[i - 1].y) / l;
      ny0 = (p.x - pts[i - 1].x) / l;
    }
    if (i < n - 1) {
      const l = len(pts[i + 1].x - p.x, pts[i + 1].y - p.y) || 1;
      nx1 = -(pts[i + 1].y - p.y) / l;
      ny1 = (pts[i + 1].x - p.x) / l;
    }
    if (i === 0) {
      nx0 = nx1;
      ny0 = ny1;
    }
    if (i === n - 1) {
      nx1 = nx0;
      ny1 = ny0;
    }
    const dot = nx0 * nx1 + ny0 * ny1;
    const k = 1 / Math.max(0.5, 1 + dot);
    out.push({ x: p.x + (nx0 + nx1) * k * d, y: p.y + (ny0 + ny1) * k * d });
  }
  return out;
}

/** Resamples a polyline every `step` meters. */
function resample(pts: readonly Pt[], step: number): { pts: Pt[]; s: number[] } {
  const out: Pt[] = [];
  const s: number[] = [];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = len(b.x - a.x, b.y - a.y);
    if (l === 0) continue;
    const n = Math.max(1, Math.ceil(l / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
      s.push(acc + (l * k) / n);
    }
    acc += l;
  }
  return { pts: out, s };
}

interface Cut {
  /** Which side of the taxiway: +1 left of travel, -1 right, 0 both. */
  side: number;
  s0: number;
  s1: number;
}

/** Splits samples into runs, dropping samples that fall in a cut or in an excluded area. */
function runsOf(samples: { pts: Pt[]; s: number[] }, side: number, cuts: readonly Cut[], total: number, endCut: { start: number; end: number }, excluded: (x: number, y: number) => boolean): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] | null = null;
  for (let i = 0; i < samples.pts.length; i++) {
    const p = samples.pts[i];
    const s = samples.s[i];
    let drop = s < endCut.start || s > total - endCut.end;
    if (!drop) for (const c of cuts) if ((c.side === 0 || c.side === side) && s >= c.s0 && s <= c.s1) drop = true;
    if (!drop && excluded(p.x, p.y)) drop = true;
    if (drop) {
      cur = null;
    } else {
      if (!cur) {
        cur = [];
        runs.push(cur);
      }
      cur.push(p);
    }
  }
  return runs;
}

const emptyPlan = (): Plan => ({ smooth: new Map(), patches: [], centerlines: [], redCenterlines: [], edges: [], enhanced: [], leadIns: [], holds: [], runwayBreaks: new Map() });

const cache = new WeakMap<AirfieldPayload, Plan>();

export function planFor(af: AirfieldPayload): Plan {
  let p = cache.get(af);
  if (!p) {
    p = buildPlan(af);
    cache.set(af, p);
  }
  return p;
}

interface Junction {
  /** Taxiway that arrives and which of its ends. */
  c: Taxiway;
  end: 0 | 1;
  /** Where the arriving centerline meets the through feature. */
  px: number;
  py: number;
  /** Unit direction of the arriving taxiway toward the junction. */
  cx: number;
  cy: number;
  /** Through feature direction (unit), its half width incl. shoulder, and the id for cuts. */
  tx: number;
  ty: number;
  hT: number;
  throughTaxi: Taxiway | null;
  throughRunway: Runway | null;
  /** Arc length position of the junction along the through feature. */
  along: number;
}

export function buildPlan(af: AirfieldPayload): Plan {
  const plan = emptyPlan();
  const cum = new Map<number, number[]>();
  for (const t of af.taxiways) {
    const R = AIRFIELD.codes[t.code].filletRadiusM;
    const sm = smoothCorners(t.points, R);
    plan.smooth.set(t.id, sm);
    cum.set(t.id, cumulative(sm));
  }
  const cutsByTaxi = new Map<number, Cut[]>();
  const endCuts = new Map<number, { start: number; end: number }>();
  const centerCuts = new Map<number, { start: number; end: number }>();
  /** Edge line cuts at an end of an arriving taxiway, per side, from where each fillet arc leaves the straight edge. */
  const sideCuts = new Map<number, { start: Map<number, number>; end: Map<number, number> }>();
  const extraCenter: Pt[][] = [];
  const addCut = (id: number, c: Cut): void => {
    const l = cutsByTaxi.get(id);
    if (l) l.push(c);
    else cutsByTaxi.set(id, [c]);
  };
  const bump = (m: Map<number, { start: number; end: number }>, id: number, end: 0 | 1, v: number): void => {
    const cur = m.get(id) ?? { start: 0, end: 0 };
    if (end === 0) cur.start = Math.max(cur.start, v);
    else cur.end = Math.max(cur.end, v);
    m.set(id, cur);
  };

  // Junctions: a taxiway end that lands on another taxiway or on a runway.
  const junctions: Junction[] = [];
  for (const c of af.taxiways) {
    const sm = plan.smooth.get(c.id) ?? c.points;
    for (const end of [0, 1] as const) {
      const E = end === 0 ? sm[0] : sm[sm.length - 1];
      const back = end === 0 ? sm[Math.min(sm.length - 1, 1)] : sm[Math.max(0, sm.length - 2)];
      let cx = E.x - back.x;
      let cy = E.y - back.y;
      const cl = len(cx, cy) || 1;
      cx /= cl;
      cy /= cl;
      let found: Junction | null = null;
      for (const t of af.taxiways) {
        if (t.id === c.id) continue;
        const tsm = plan.smooth.get(t.id) ?? t.points;
        const hit = closestOnPolyline(tsm, cum.get(t.id) ?? [], E.x, E.y);
        if (!hit || hit.dist > 1.5) continue;
        const total = (cum.get(t.id) ?? [0])[tsm.length - 1] ?? 0;
        if (hit.along < 3 || hit.along > total - 3) continue;
        const cross = Math.abs(cx * hit.ty - cy * hit.tx);
        if (cross < 0.3) continue;
        found = { c, end, px: hit.x, py: hit.y, cx, cy, tx: hit.tx, ty: hit.ty, hT: t.widthM / 2, throughTaxi: t, throughRunway: null, along: hit.along };
        break;
      }
      if (!found) {
        for (const r of af.runways) {
          const rd = compassVector(r.headingDeg);
          const rel = { x: E.x - r.x1, y: E.y - r.y1 };
          const along = rel.x * rd.x + rel.y * rd.y;
          const lat = Math.abs(-rel.x * rd.y + rel.y * rd.x);
          const edge = r.widthM / 2 + r.shoulderM;
          if (lat > edge + 3 || lat < edge - 4 || along < 0 || along > r.lengthM) continue;
          const cross = Math.abs(cx * rd.y - cy * rd.x);
          if (cross < 0.4) continue;
          // Where the arriving line crosses the runway centerline.
          const k = (rd.y * (E.x - r.x1) - rd.x * (E.y - r.y1)) / (cy * rd.x - cx * rd.y || 1);
          const px = E.x + cx * k;
          const py = E.y + cy * k;
          found = { c, end, px, py, cx, cy, tx: rd.x, ty: rd.y, hT: edge, throughTaxi: null, throughRunway: r, along: (px - r.x1) * rd.x + (py - r.y1) * rd.y };
          break;
        }
      }
      if (found) junctions.push(found);
    }
  }

  // Two taxiways that meet the same through taxiway from opposite sides at one point form a crossing:
  // their centerlines run straight across instead of forking into the through line.
  const crossing = new Set<Junction>();
  for (let a = 0; a < junctions.length; a++) {
    for (let b = a + 1; b < junctions.length; b++) {
      const p = junctions[a];
      const q = junctions[b];
      if (!p.throughTaxi || !q.throughTaxi || p.throughTaxi.id !== q.throughTaxi.id || p.c.id === q.c.id) continue;
      if (len(p.px - q.px, p.py - q.py) > 4 || p.cx * q.cx + p.cy * q.cy > -0.94) continue;
      crossing.add(p);
      crossing.add(q);
    }
  }

  for (const j of junctions) {
    const c = j.c;
    const sm = plan.smooth.get(c.id) ?? c.points;
    const hC = c.widthM / 2;
    const codeR = AIRFIELD.codes[c.code].filletRadiusM;
    // Pavement fillets stay small, the lead-on centerline sweeps wider (FAA AC 150/5340-1 style).
    const Rf0 = codeR * 0.5;
    const E = j.end === 0 ? sm[0] : sm[sm.length - 1];
    const lenC = (cum.get(c.id) ?? [0])[sm.length - 1] ?? 0;
    const eDist = len(E.x - j.px, E.y - j.py);
    // Normal of the through feature pointing to the side the arriving taxiway comes from.
    const backPt = { x: j.px - j.cx * 20, y: j.py - j.cy * 20 };
    let nx = -j.ty;
    let ny = j.tx;
    if ((backPt.x - j.px) * nx + (backPt.y - j.py) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    let tfMax = 0;
    let tcMax = 0;
    const perSide = new Map<number, number>();
    const cutIntervals: number[] = [];
    for (const sigma of [1, -1] as const) {
      const r1x = sigma * j.tx;
      const r1y = sigma * j.ty;
      const r2x = -j.cx;
      const r2y = -j.cy;
      const cosPsi = r1x * r2x + r1y * r2y;
      const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
      if (psi < (25 * Math.PI) / 180 || psi > (155 * Math.PI) / 180) continue;
      // Edge of the arriving taxiway on this side, and the corner where it meets the through edge.
      let ex = -j.cy;
      let ey = j.cx;
      if (ex * r1x + ey * r1y < 0) {
        ex = -ex;
        ey = -ey;
      }
      // Solve: P + n*hT + t*s = P + e*hC + c*u
      const det = j.tx * -j.cy - j.ty * -j.cx;
      if (Math.abs(det) < 1e-6) continue;
      const rx = ex * hC - nx * j.hT;
      const ry = ey * hC - ny * j.hT;
      const s = (rx * -j.cy - ry * -j.cx) / det;
      const Qx = j.px + nx * j.hT + j.tx * s;
      const Qy = j.py + ny * j.hT + j.ty * s;
      let R = Rf0;
      const tanH = Math.tan(psi / 2);
      R = Math.min(R, 0.4 * (lenC + eDist) * tanH);
      const tf = R / tanH;
      const Tpt = { x: Qx + r1x * tf, y: Qy + r1y * tf };
      const Cpt = { x: Qx + r2x * tf, y: Qy + r2y * tf };
      const bx = r1x + r2x;
      const by = r1y + r2y;
      const bl = len(bx, by) || 1;
      const dc = R / Math.sin(psi / 2);
      const cxn = Qx + (bx / bl) * dc;
      const cyn = Qy + (by / bl) * dc;
      const a0 = Math.atan2(Tpt.y - cyn, Tpt.x - cxn);
      const a1 = Math.atan2(Cpt.y - cyn, Cpt.x - cxn);
      plan.patches.push([{ x: Qx, y: Qy }, ...arc(cxn, cyn, R, a0, a1)]);
      for (const inset of EDGE_INSETS) plan.edges.push(mkLine(arc(cxn, cyn, R + inset, a0, a1)));
      const tn = j.end === 1 ? { x: -j.cy, y: j.cx } : { x: j.cy, y: -j.cx };
      const sideSign = ex * tn.x + ey * tn.y >= 0 ? 1 : -1;
      perSide.set(sideSign, Math.max(perSide.get(sideSign) ?? 0, (Cpt.x - j.px) * -j.cx + (Cpt.y - j.py) * -j.cy));
      tfMax = Math.max(tfMax, len(Cpt.x - j.px, Cpt.y - j.py) * 0 + (Cpt.x - j.px) * -j.cx + (Cpt.y - j.py) * -j.cy);
      cutIntervals.push((Tpt.x - j.px) * j.tx + (Tpt.y - j.py) * j.ty);
      // Lead-on centerline arc: concentric with the fillet where the widths match.
      // Between two taxiways the centerline runs straight almost to the junction and forks into two tight
      // curves, each tangent to the through centerline. The radius is about half the taxiway width, so
      // the fork keeps the same look at any angle: the tangent length grows as the angle gets shallower.
      // Runway entries keep the wider sweep.
      const Rc = j.throughRunway ? Math.min(codeR * 2.2, 3.4 * hC + R, 0.45 * (lenC + eDist) * tanH) : Math.min(hC * 1.05, 0.45 * (lenC + eDist) * tanH);
      const tc = Rc / tanH;
      const A = { x: j.px + r2x * tc, y: j.py + r2y * tc };
      const B = { x: j.px + r1x * tc, y: j.py + r1y * tc };
      const bc = R > 0 ? Rc / Math.sin(psi / 2) : 0;
      const ccx = j.px + (bx / bl) * bc;
      const ccy = j.py + (by / bl) * bc;
      const arcPts = arc(ccx, ccy, Rc, Math.atan2(A.y - ccy, A.x - ccx), Math.atan2(B.y - ccy, B.x - ccx));
      if (!crossing.has(j)) {
        extraCenter.push(arcPts);
        tcMax = Math.max(tcMax, tc);
      }
    }
    // Opening in the through feature's edge: from the first to the last fillet tangent point.
    if (cutIntervals.length > 0) {
      // The opening runs exactly between the fillet tangent points, so the straight edge meets the arc without a gap,
      // and it is only on the side the arriving taxiway comes from.
      const lo = Math.min(...cutIntervals) + j.along;
      const hi = Math.max(...cutIntervals) + j.along;
      if (j.throughTaxi) addCut(j.throughTaxi.id, { side: nx * -j.ty + ny * j.tx > 0 ? 1 : -1, s0: lo, s1: hi });
      else if (j.throughRunway) {
        const l = plan.runwayBreaks.get(j.throughRunway.id) ?? [];
        l.push([lo, hi, -(nx * j.ty - ny * j.tx > 0 ? 1 : -1)]);
        plan.runwayBreaks.set(j.throughRunway.id, l);
      }
    }
    // The arriving taxiway's own edge lines start at the fillets, its centerline at the lead-on arcs.
    const edgeFromEnd = Math.max(0, tfMax - eDist);
    bump(endCuts, c.id, j.end, edgeFromEnd + eDist * 0);
    const sc = sideCuts.get(c.id) ?? { start: new Map<number, number>(), end: new Map<number, number>() };
    for (const [sd, tf] of perSide) {
      const m = j.end === 0 ? sc.start : sc.end;
      m.set(sd, Math.max(m.get(sd) ?? 0, Math.max(0, tf - eDist)));
    }
    sideCuts.set(c.id, sc);
    const centerFromEnd = tcMax - eDist;
    if (centerFromEnd > 0) bump(centerCuts, c.id, j.end, centerFromEnd);
    else if (tcMax > 0) {
      // The arcs start beyond the pavement end: run the line on to them.
      extraCenter.push([{ x: E.x, y: E.y }, { x: j.px - j.cx * tcMax, y: j.py - j.cy * tcMax }]);
    }
  }

  // Taxiway lines.
  for (const t of af.taxiways) {
    const sm = plan.smooth.get(t.id) ?? t.points;
    const cm = cum.get(t.id) ?? [0];
    const total = cm[sm.length - 1] ?? 0;
    const cc = centerCuts.get(t.id) ?? { start: 0, end: 0 };
    const centerSamples = resample(sm, STEP);
    const onRunway = (x: number, y: number): boolean => {
      for (const r of af.runways) {
        const dx = r.x2 - r.x1;
        const dy = r.y2 - r.y1;
        const l2 = dx * dx + dy * dy;
        let k = ((x - r.x1) * dx + (y - r.y1) * dy) / l2;
        k = k < 0 ? 0 : k > 1 ? 1 : k;
        if (len(x - (r.x1 + dx * k), y - (r.y1 + dy * k)) <= r.widthM / 2 + r.shoulderM + 0.3) return true;
      }
      return false;
    };
    // The centerline is one continuous line, cut only for the lead-on arcs and where it would enter a runway.
    const center = runsOf(centerSamples, 0, [], total, cc, onRunway);
    for (const run of center) if (run.length >= 2) (t.closed ? plan.redCenterlines : plan.centerlines).push(mkLine(run));
    if (t.kind === 'taxilane' || !(t.surface === 'asphalt' || t.surface === 'concrete')) continue;
    const ec = endCuts.get(t.id) ?? { start: 0, end: 0 };
    const cuts = cutsByTaxi.get(t.id) ?? [];
    const inOtherPavement = (x: number, y: number): boolean => {
      if (onRunway(x, y)) return true;
      for (const o of af.taxiways) {
        if (o.id === t.id) continue;
        const reach = o.widthM / 2 + 0.2;
        const osm = plan.smooth.get(o.id) ?? o.points;
        for (let i = 1; i < osm.length; i++) {
          const a = osm[i - 1];
          const b = osm[i];
          if (x < Math.min(a.x, b.x) - reach || x > Math.max(a.x, b.x) + reach || y < Math.min(a.y, b.y) - reach || y > Math.max(a.y, b.y) + reach) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const l2 = dx * dx + dy * dy || 1;
          const k = ((x - a.x) * dx + (y - a.y) * dy) / l2;
          if (k < 0 || k > 1) continue;
          if (len(x - (a.x + dx * k), y - (a.y + dy * k)) <= reach) return true;
        }
      }
      for (const ap of af.aprons) if (insidePoly(x, y, ap.polygon)) return true;
      return false;
    };
    for (const side of [1, -1] as const) {
      for (const inset of EDGE_INSETS) {
        const off = offsetPolyline(sm, side * (t.widthM / 2 - inset));
        const samples = resample(off, STEP);
        const sc = sideCuts.get(t.id);
        const ecSide = sc ? { start: sc.start.get(side) ?? ec.start, end: sc.end.get(side) ?? ec.end } : ec;
        for (const run of runsOf(samples, side, cuts, total, ecSide, inOtherPavement)) if (run.length >= 2) plan.edges.push(mkLine(run));
      }
    }
  }
  for (const pts of extraCenter) plan.centerlines.push(mkLine(pts));

  // Runway holding positions with their signs, and the enhanced centerline before them on instrument runways.
  for (const h of af.holding) {
    const t = af.taxiways.find((x) => x.id === h.taxiwayId);
    const r = af.runways.find((x) => x.id === h.runwayId);
    if (!t || !r) continue;
    const sm = plan.smooth.get(t.id) ?? t.points;
    const hit = closestOnPolyline(sm, cum.get(t.id) ?? [], h.x, h.y);
    if (!hit) continue;
    // Point the direction toward the runway.
    const rd = compassVector(r.headingDeg);
    const rel = { x: hit.x - r.x1, y: hit.y - r.y1 };
    const lat = -rel.x * rd.y + rel.y * rd.x;
    const toRunwaySign = lat > 0 ? -1 : 1;
    let dx = hit.tx;
    let dy = hit.ty;
    const gx = (-rd.y) * toRunwaySign;
    const gy = rd.x * toRunwaySign;
    if (dx * gx + dy * gy < 0) {
      dx = -dx;
      dy = -dy;
    }
    const instrument = r.approach !== 'visual';
    plan.holds.push({ x: hit.x, y: hit.y, dx, dy, widthM: t.widthM, taxiName: t.name.replace(/\d+$/, '') || t.name, runwayName: `${r.nameA}-${r.nameB}`, instrument });
    if (instrument) {
      // Dashes either side of the centerline for up to 45.7 m (150 ft) before the hold line. They follow
      // the taxiway, so on a curve they bend with it and never leave the pavement.
      const cumT = cum.get(t.id) ?? [];
      const forward = hit.tx * (-rd.y * toRunwaySign) + hit.ty * (rd.x * toRunwaySign) >= 0;
      for (const side of [-1, 1]) {
        const pts: Pt[] = [];
        for (let d = 2; d <= 45.7; d += 2.5) {
          const q = pointAlong(sm, cumT, hit.along + (forward ? -d : d));
          if (!q) break;
          pts.push({ x: q.x - q.ty * side * 0.55, y: q.y + q.tx * side * 0.55 });
        }
        if (pts.length >= 2) plan.enhanced.push(mkLine(pts));
      }
    }
  }

  // Stand lead-in lines run straight back to a lead-on curve into the taxiway centerline, both ways.
  for (const s of af.stands) {
    const bd = compassVector((s.headingDeg + 180) % 360);
    let best: { t: number; hit: Hit } | null = null;
    for (const t of af.taxiways) {
      const sm = plan.smooth.get(t.id) ?? t.points;
      for (let i = 1; i < sm.length; i++) {
        const a = sm[i - 1];
        const b = sm[i];
        const rx = bd.x * 260;
        const ry = bd.y * 260;
        const sx = b.x - a.x;
        const sy = b.y - a.y;
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-9) continue;
        const k = ((a.x - s.x) * sy - (a.y - s.y) * sx) / den;
        const u = ((a.x - s.x) * ry - (a.y - s.y) * rx) / den;
        if (k < 0 || k > 1 || u < 0 || u > 1) continue;
        const l = len(sx, sy);
        if (!best || k < best.t) best = { t: k, hit: { dist: 0, along: 0, tx: sx / l, ty: sy / l, t: u, x: s.x + rx * k, y: s.y + ry * k } };
      }
    }
    if (!best) continue;
    const P = { x: best.hit.x, y: best.hit.y };
    const cdx = -bd.x;
    const cdy = -bd.y;
    const dist = len(P.x - s.x, P.y - s.y);
    const R = Math.min(AIRFIELD.codes[s.code].filletRadiusM * 0.6, dist * 0.4);
    const tx = best.hit.tx;
    const ty = best.hit.ty;
    const cos = Math.abs(cdx * tx + cdy * ty);
    const psi = Math.acos(Math.min(1, cos));
    const sinPsi = Math.sin(psi);
    if (sinPsi < 0.3) continue;
    const lines: Pt[][] = [];
    lines.push([{ x: s.x, y: s.y }, { x: P.x + bd.x * 0 - cdx * R * 0, y: P.y }]);
    // Tangent length for a turn of the angle between the lead-in and the taxiway direction.
    for (const sg of [1, -1]) {
      const r1x = sg * tx;
      const r1y = sg * ty;
      const r2x = bd.x;
      const r2y = bd.y;
      const ps = Math.acos(Math.max(-1, Math.min(1, r1x * r2x + r1y * r2y)));
      if (ps < 0.4 || ps > 2.75) continue;
      const tn = Math.tan(ps / 2);
      const tc = R / tn;
      const A = { x: P.x + r2x * tc, y: P.y + r2y * tc };
      const B = { x: P.x + r1x * tc, y: P.y + r1y * tc };
      const bx = r1x + r2x;
      const by = r1y + r2y;
      const bl = len(bx, by) || 1;
      const dc = R / Math.sin(ps / 2);
      const cxn = P.x + (bx / bl) * dc;
      const cyn = P.y + (by / bl) * dc;
      lines.push(arc(cxn, cyn, R, Math.atan2(A.y - cyn, A.x - cxn), Math.atan2(B.y - cyn, B.x - cxn)));
      lines[0] = [{ x: s.x, y: s.y }, A];
    }
    for (const l of lines) if (l.length >= 2) plan.leadIns.push(mkLine(l));
  }
  return plan;
}

function insidePoly(x: number, y: number, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
