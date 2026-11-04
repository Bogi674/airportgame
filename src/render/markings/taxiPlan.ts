import { AIRFIELD, SURFACE_SPEC } from '@data/index';
import { compassVector, type AirfieldPayload, type Runway, type Surface, type Taxiway } from '@shared/airfield';
import type { Pt } from '@shared/geom';
import { taxiGraph } from '@shared/pavement/fromAirfield';
import { buildPavement, type EndTrim, type Sign } from '@shared/pavement/pavement';

/**
 * Plans taxiway and runway paint from the built geometry. Everything the player builds is turned
 * into marking geometry automatically. Taxiway pavement, bends, junctions, shoulders, centerlines
 * and edge lines come from the node based generator in @shared/pavement (docs/DESIGN_REVISION_2.md
 * section 2). This module adds what meets the runways: fillets, lead-on curves, edge stripe
 * openings, holding positions with their signs and enhanced centerlines, plus stand lead-in lines.
 * The plan is computed once per airfield change and drawn per chunk.
 */

export interface Line {
  pts: Pt[];
  /** On concrete: drawn with a dark outline so it stays visible. */
  outlined: boolean;
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

/** A filled pavement shape: rings drawn with the even odd rule, so holes stay open. */
export interface Area {
  color: string;
  rings: Pt[][];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Plan {
  /** Smoothed centerlines per taxiway id, for features placed along a taxiway. */
  smooth: Map<number, Pt[]>;
  /** Taxiway shoulders, drawn under the pavement. */
  shoulders: Area[];
  /** Taxiway pavement. */
  areas: Area[];
  patches: Pt[][];
  centerlines: Line[];
  redCenterlines: Line[];
  edges: Line[];
  enhanced: Line[];
  leadIns: Line[];
  /** Shoulder stripes on junction fillets. */
  stripes: Line[];
  /** Edge markers along unpaved taxiways. */
  markers: Pt[];
  /** Concrete slab joints. */
  joints: Line[];
  /** Taxiway location and direction signs before junctions. */
  signs: Sign[];
  holds: HoldMark[];
  /** Cuts in the white runway edge stripes at taxiway openings, per runway id: [s0, s1] along the runway. */
  /** Openings in the runway edge stripes: start, end and the side (+1 right of travel, -1 left) they are on. */
  runwayBreaks: Map<number, [number, number, number][]>;
}

const EDGE_INSETS = [0.45, 0.8];
const STEP = 1.2;

const mkLine = (pts: Pt[], outlined = false): Line => {
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
  return { pts, outlined, minX, minY, maxX, maxY };
};

const len = (x: number, y: number): number => Math.hypot(x, y);

/** Pavement fill color of a surface, from surfaces.json. */
export const pavementColor = (s: Surface): string => SURFACE_SPEC[s].color;

function mkArea(color: string, rings: Pt[][]): Area {
  const b = mkLine(rings[0]);
  return { color, rings, minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
}

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

/** Resamples a polyline every `step` meters at most, keeping its first and last point. */
function resample(pts: readonly Pt[], step: number): Pt[] {
  const out: Pt[] = pts.length > 0 ? [{ x: pts[0].x, y: pts[0].y }] : [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = len(b.x - a.x, b.y - a.y);
    if (l === 0) continue;
    const n = Math.max(1, Math.ceil(l / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/** Resamples a polyline and splits it into runs, dropping the samples that fall in an excluded area. */
function runsOutside(pts: readonly Pt[], excluded: (x: number, y: number) => boolean): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] | null = null;
  for (const p of resample(pts, STEP)) {
    if (excluded(p.x, p.y)) {
      cur = null;
      continue;
    }
    if (!cur) {
      cur = [];
      runs.push(cur);
    }
    cur.push(p);
  }
  return runs;
}

const emptyPlan = (): Plan => ({ smooth: new Map(), shoulders: [], areas: [], patches: [], centerlines: [], redCenterlines: [], edges: [], enhanced: [], leadIns: [], stripes: [], markers: [], joints: [], signs: [], holds: [], runwayBreaks: new Map() });

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
  /** Runway direction (unit), its half width with shoulders, and the runway. */
  tx: number;
  ty: number;
  hT: number;
  throughRunway: Runway;
  /** Arc length position of the junction along the runway. */
  along: number;
}

export function buildPlan(af: AirfieldPayload): Plan {
  const plan = emptyPlan();
  const cum = new Map<number, number[]>();
  for (const t of af.taxiways) {
    const R = AIRFIELD.codes[t.code].turnRadiusM;
    const sm = smoothCorners(t.points, R);
    plan.smooth.set(t.id, sm);
    cum.set(t.id, cumulative(sm));
  }
  const endCuts = new Map<number, { start: number; end: number }>();
  const centerCuts = new Map<number, { start: number; end: number }>();
  /** Edge line cuts at an end of an arriving taxiway, per side, from where each fillet arc leaves the straight edge. */
  const sideCuts = new Map<number, { start: Map<number, number>; end: Map<number, number> }>();
  const extraCenter: { pts: Pt[]; outlined: boolean }[] = [];
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
      {
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
          found = { c, end, px, py, cx, cy, tx: rd.x, ty: rd.y, hT: edge, throughRunway: r, along: (px - r.x1) * rd.x + (py - r.y1) * rd.y };
          break;
        }
      }
      if (found) junctions.push(found);
    }
  }

  for (const j of junctions) {
    const c = j.c;
    const sm = plan.smooth.get(c.id) ?? c.points;
    const hC = c.widthM / 2;
    const codeR = AIRFIELD.codes[c.code].turnRadiusM;
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
      // Lead-on centerline arc onto the runway centerline, with a wide sweep.
      const Rc = Math.min(codeR * 2.2, 3.4 * hC + R, 0.45 * (lenC + eDist) * tanH);
      const tc = Rc / tanH;
      const A = { x: j.px + r2x * tc, y: j.py + r2y * tc };
      const B = { x: j.px + r1x * tc, y: j.py + r1y * tc };
      const bc = R > 0 ? Rc / Math.sin(psi / 2) : 0;
      const ccx = j.px + (bx / bl) * bc;
      const ccy = j.py + (by / bl) * bc;
      const arcPts = arc(ccx, ccy, Rc, Math.atan2(A.y - ccy, A.x - ccx), Math.atan2(B.y - ccy, B.x - ccx));
      extraCenter.push({ pts: arcPts, outlined: c.surface === 'concrete' });
      tcMax = Math.max(tcMax, tc);
    }
    // Opening in the through feature's edge: from the first to the last fillet tangent point.
    if (cutIntervals.length > 0) {
      // The opening runs exactly between the fillet tangent points, so the straight edge meets the arc without a gap,
      // and it is only on the side the arriving taxiway comes from.
      const lo = Math.min(...cutIntervals) + j.along;
      const hi = Math.max(...cutIntervals) + j.along;
      const l = plan.runwayBreaks.get(j.throughRunway.id) ?? [];
      l.push([lo, hi, -(nx * j.ty - ny * j.tx > 0 ? 1 : -1)]);
      plan.runwayBreaks.set(j.throughRunway.id, l);
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
      extraCenter.push({ pts: [{ x: E.x, y: E.y }, { x: j.px - j.cx * tcMax, y: j.py - j.cy * tcMax }], outlined: c.surface === 'concrete' });
    }
  }

  // Taxiway pavement and lines from the node generator, with the runway trims at taxiway ends.
  const { graph, edgesOf } = taxiGraph(af.taxiways);
  const trims = new Map<string, EndTrim>();
  for (const t of af.taxiways) {
    const own = edgesOf.get(t.id) ?? [];
    if (own.length === 0) continue;
    const ec = endCuts.get(t.id);
    const sc = sideCuts.get(t.id);
    const cc = centerCuts.get(t.id);
    for (const end of [0, 1] as const) {
      const both = (end === 0 ? ec?.start : ec?.end) ?? 0;
      const perSide = end === 0 ? sc?.start : sc?.end;
      const center = (end === 0 ? cc?.start : cc?.end) ?? 0;
      if (both === 0 && center === 0 && (perSide?.size ?? 0) === 0) continue;
      trims.set(`${end === 0 ? own[0] : own[own.length - 1]}:${end}`, { center, left: perSide?.get(1) ?? both, right: perSide?.get(-1) ?? both });
    }
  }
  const pave = buildPavement(graph, trims);
  for (const sp of pave.shoulders) for (const poly of sp.polys) plan.shoulders.push(mkArea(SURFACE_SPEC[sp.surface].shoulderColor ?? SURFACE_SPEC[sp.surface].color, poly));
  for (const f of pave.fills) for (const poly of f.polys) plan.areas.push(mkArea(pavementColor(f.surface), poly));
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
  const onRunwayOrApron = (x: number, y: number): boolean => {
    if (onRunway(x, y)) return true;
    for (const ap of af.aprons) if (insidePoly(x, y, ap.polygon)) return true;
    return false;
  };
  // Lines stop where they would enter a runway; edge lines also stop on aprons.
  for (const c of pave.centerlines) {
    for (const run of runsOutside(c.pts, onRunway)) if (run.length >= 2) (c.closed ? plan.redCenterlines : plan.centerlines).push(mkLine(run, c.outlined));
  }
  for (const e of pave.edgeLines) {
    for (const run of runsOutside(e.pts, onRunwayOrApron)) if (run.length >= 2) plan.edges.push(mkLine(run, e.outlined));
  }
  for (const x of extraCenter) plan.centerlines.push(mkLine(x.pts, x.outlined));
  for (const st of pave.stripes) plan.stripes.push(mkLine(st.pts, st.outlined));
  plan.markers.push(...pave.markers.filter((p) => !onRunwayOrApron(p.x, p.y)));
  plan.signs.push(...pave.signs);
  for (const j of pave.joints) plan.joints.push(mkLine(j));

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
    const R = Math.min(AIRFIELD.codes[s.code].turnRadiusM * 0.6, dist * 0.4);
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
