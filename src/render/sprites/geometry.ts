import type { SpriteBase, SpriteEngine } from '@data/aircraft';

/**
 * Aircraft outline geometry in meters, ported from docs/reference/sprite-prototypes/air2.py.
 * The Python frame is kept for the helpers: `[x, y]` with x lateral (right wing positive) and
 * y longitudinal with the nose at 0 and the tail at L. The body frame used by `AircraftGeometry`
 * is `Pt2 {u, v}` with `u = y` and `v = x`. Pure math with no drawing, so tests can measure it.
 */
export interface Pt2 {
  u: number;
  v: number;
}

/** A point in the Python frame: lateral x, longitudinal y. */
export type XY = readonly [number, number];

export interface EngineShape {
  kind: 'nacelle' | 'prop';
  /** Centre of the nacelle or the prop disc, right side (mirror v for the left). */
  u: number;
  v: number;
  len: number;
  d: number;
  propD: number;
  blades: number;
}

export interface AircraftGeometry {
  base: SpriteBase;
  fuselage: Pt2[];
  /** Right wing, left wing, right stabilizer, left stabilizer. */
  wings: Pt2[][];
  stabilizers: Pt2[][];
  winglets: Pt2[][];
  engines: EngineShape[];
  nosePropD: number;
  /** Extent of everything drawn, used by calibration. */
  lengthM: number;
  spanM: number;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;
const tan = Math.tan;

const toPt2 = (pts: readonly XY[]): Pt2[] => pts.map(([x, y]) => ({ u: y, v: x }));
const mirrorXY = (pts: readonly XY[]): XY[] => pts.map(([x, y]): XY => [-x, y]);

/** Ports `hw`: fuselage half width at station y. */
export function hw(s: SpriteBase, y: number): number {
  const R = s.fw / 2;
  if (y <= 0) return 0;
  if (y < s.nose) {
    const t = y / s.nose;
    return R * (1 - (1 - t) ** (s.nose_n ?? 1.2)) ** (s.nose_m ?? 0.6);
  }
  const ts = s.L - s.tail;
  if (y > ts) {
    const u = Math.min(1, (y - ts) / s.tail);
    const te = s.tail_end ?? 0.3;
    return R - (R - te) * u ** (s.tail_p ?? 1.35);
  }
  return R;
}

/** Ports `fuselage_pts`: right side nose to tail, then the left side back to the nose. */
export function fuselagePts(s: SpriteBase, n = 90): XY[] {
  const set = new Set<number>();
  for (let i = 0; i <= n; i++) set.add(s.L * (i / n));
  for (let i = 0; i <= 60; i++) set.add(s.nose * (i / 60) ** 2.2);
  const ys = [...set].sort((a, b) => a - b);
  const right = ys.map((y): XY => [hw(s, y), y]);
  const left = right.map(([x, y]): XY => [-x, y]).reverse();
  return [...right, ...left];
}

type Wing = SpriteBase['wing'];

const wingRoot = (s: SpriteBase, w: Wing): number => w.root_y ?? s.fw / 2;

/** Ports `wing_right`: right wing planform from the fuselage side to the tip, no winglet. */
export function wingRight(s: SpriteBase, w: Wing, root?: number): XY[] {
  const R = root ?? wingRoot(s, w);
  const sb = w.sb;
  const sw = rad(w.sweep);
  const pts: XY[] = [[R, w.x]];
  let Tp: XY;
  if (w.rake) {
    const rb = sb - w.rake;
    const B: XY = [rb, w.x + (rb - R) * tan(sw)];
    Tp = [sb, B[1] + w.rake * tan(rad(w.sweep + (w.rake_extra ?? 15)))];
    pts.push(B, Tp);
  } else {
    Tp = [sb, w.x + (sb - R) * tan(sw)];
    pts.push(Tp);
  }
  const TT: XY = [sb, Tp[1] + w.tip];
  const K: XY = [w.kink, w.x + w.c + (w.kink - R) * tan(rad(w.te_in ?? 0))];
  const Z: XY = [R, w.x + w.c];
  const kr = w.kink_round ?? 0.35;
  if (kr > 0) {
    const a: XY = [K[0] + (Z[0] - K[0]) * kr, K[1] + (Z[1] - K[1]) * kr];
    const b: XY = [K[0] + (TT[0] - K[0]) * kr * 0.5, K[1] + (TT[1] - K[1]) * kr * 0.5];
    const curve: XY[] = [];
    for (let i = 0; i < 13; i++) {
      const t = i / 12;
      curve.push([(1 - t) ** 2 * b[0] + 2 * (1 - t) * t * K[0] + t * t * a[0], (1 - t) ** 2 * b[1] + 2 * (1 - t) * t * K[1] + t * t * a[1]]);
    }
    pts.push(TT, ...curve, Z);
  } else {
    pts.push(TT, K, Z);
  }
  return pts;
}

/** Ports `le_y`: leading edge station at a span position. */
export function leY(s: SpriteBase, w: Wing, ySpan: number): number {
  const R = wingRoot(s, w);
  if (w.rake && ySpan > w.sb - w.rake) {
    const rb = w.sb - w.rake;
    return w.x + (rb - R) * tan(rad(w.sweep)) + (ySpan - rb) * tan(rad(w.sweep + (w.rake_extra ?? 15)));
  }
  return w.x + (ySpan - R) * tan(rad(w.sweep));
}

/** Ports `te_y`: trailing edge station at a span position. */
export function teY(s: SpriteBase, w: Wing, ySpan: number): number {
  const R = wingRoot(s, w);
  const TT: XY = [w.sb, leY(s, w, w.sb) + w.tip];
  const K: XY = [w.kink, w.x + w.c + (w.kink - R) * tan(rad(w.te_in ?? 0))];
  const Z: XY = [R, w.x + w.c];
  if (ySpan <= K[0]) {
    const f = (ySpan - R) / Math.max(1e-6, K[0] - R);
    return Z[1] + (K[1] - Z[1]) * f;
  }
  const f = (ySpan - K[0]) / Math.max(1e-6, TT[0] - K[0]);
  return K[1] + (TT[1] - K[1]) * f;
}

/** Ports `winglet` for the right side (side = 1) or the left (side = -1). Empty when there is none. */
export function winglet(s: SpriteBase, w: Wing, side: 1 | -1): XY[] {
  const kind = w.winglet;
  if (!kind || kind === 'none') return [];
  const sb = w.sb;
  const ext = w.ext ?? 0.6;
  const yl = leY(s, w, sb);
  const tip = w.tip;
  let pts: XY[];
  if (kind === 'sharklet' || kind === 'blended') {
    pts = [
      [sb, yl + 0.05 * tip],
      [sb + ext * 0.55, yl + 0.35 * tip + ext * 0.4],
      [sb + ext, yl + 0.85 * tip + ext * 0.9],
      [sb + ext, yl + 1.05 * tip + ext * 0.95],
      [sb, yl + tip],
    ];
  } else {
    pts = [
      [sb, yl + 0.1 * tip],
      [sb + ext, yl + 0.55 * tip + ext * 0.7],
      [sb + ext, yl + 0.95 * tip + ext * 0.7],
      [sb, yl + tip],
    ];
  }
  return pts.map(([x, y]): XY => [side * x, y]);
}

/** Ports the `hstab` branch of `tail_parts`: right half planform. */
export function hstabRight(s: SpriteBase): XY[] {
  const h = s.hstab;
  const R = h.ttail ? 0 : Math.max(0.2, hw(s, h.x + h.c * 0.5) * 0.92);
  const sb = h.span / 2;
  const Tp: XY = [sb, h.x + (sb - R) * tan(rad(h.sweep))];
  return [[R, h.x], Tp, [sb, Tp[1] + h.tip], [R, h.x + h.c]];
}

/** Ports the `fin` branch of `tail_parts`: the fin lens as seen from above. */
export function finPts(s: SpriteBase): XY[] {
  const f = s.fin;
  if (!f) return [];
  const a = f.x0;
  const b = f.x1;
  const wd = f.w;
  const d0 = f.dorsal ?? a;
  return [
    [0, d0],
    [wd * 0.12, a],
    [wd * 0.5, a + (b - a) * 0.3],
    [wd * 0.32, a + (b - a) * 0.8],
    [0.04, b],
    [-0.04, b],
    [-wd * 0.32, a + (b - a) * 0.8],
    [-wd * 0.5, a + (b - a) * 0.3],
    [-wd * 0.12, a],
  ];
}

/** Window style presets of `WS_STYLES`: front edge exponent k, back edge exponent kb, side run, pane dividers. */
export const WS_STYLES: Record<string, { k: number; kb: number; side: number; divs: number[] }> = {
  airbus: { k: 1.25, kb: 1.6, side: 0.55, divs: [-0.8, -0.5, 0.0, 0.5, 0.8] },
  b737: { k: 0.95, kb: 1.3, side: 0.5, divs: [-0.8, -0.45, 0.0, 0.45, 0.8] },
  boeing: { k: 1.15, kb: 1.5, side: 0.5, divs: [-0.8, -0.46, 0.0, 0.46, 0.8] },
  b787: { k: 2.0, kb: 2.2, side: 0.95, divs: [-0.55, 0.0, 0.55] },
  a350: { k: 1.6, kb: 1.9, side: 0.75, divs: [-0.62, 0.0, 0.62] },
  crj: { k: 1.05, kb: 1.4, side: 0.45, divs: [-0.55, 0.0, 0.55] },
  atr: { k: 1.7, kb: 1.8, side: 0.5, divs: [-0.56, 0.0, 0.56] },
  q400: { k: 1.35, kb: 1.6, side: 0.6, divs: [-0.72, -0.36, 0.0, 0.36, 0.72] },
  kingair: { k: 1.5, kb: 1.7, side: 0.55, divs: [0.0] },
  ga: { k: 2.0, kb: 2.0, side: 0.3, divs: [0.0] },
};

export interface Windscreen {
  /** Front edge to back edge outline. */
  shape: XY[];
  /** Mask outline drawn first for the a350 style, empty otherwise. */
  mask: XY[];
  style: string;
  /** Pane dividers as front and back points. */
  dividers: [XY, XY][];
  rear: XY[];
}

/** Ports `windscreen` geometry. Returns undefined when the base has no windscreen data. */
export function windscreen(s: SpriteBase): Windscreen | undefined {
  const c = s.ws;
  if (!c) return undefined;
  const style = c.style ?? 'airbus';
  const base = WS_STYLES[style] ?? WS_STYLES.airbus;
  const st = { k: c.k ?? base.k, kb: c.kb ?? base.kb, side: c.side ?? base.side, divs: c.divs ?? base.divs };
  const y0 = c.y;
  const dep = c.d;
  const cur = c.c;
  const wf = c.wf ?? 0.97;
  const n = 32;
  const fy = (u: number): number => y0 + cur * Math.abs(u) ** st.k;
  const by = (u: number): number => y0 + dep + (cur + dep * st.side) * Math.abs(u) ** st.kb;
  const us: number[] = [];
  for (let i = 0; i <= n; i++) us.push(-1 + (2 * i) / n);
  const front = us.map((u): XY => [u * hw(s, fy(u)) * wf, fy(u)]);
  const back = us.map((u): XY => [u * hw(s, by(u)) * wf, by(u)]);
  const shape = [...front, ...back.slice().reverse()];
  let mask: XY[] = [];
  if (style === 'a350') {
    const mf = us.map((u): XY => [u * hw(s, fy(u) - 0.3) * 0.995, fy(u) - 0.3]);
    const mb = us.map((u): XY => [u * hw(s, by(u) + 0.4) * 0.995, by(u) + 0.4]);
    mask = [...mf, ...mb.slice().reverse()];
  }
  const dividers = st.divs.map((u): [XY, XY] => [
    [u * hw(s, fy(u)) * wf, fy(u)],
    [u * hw(s, by(u)) * wf, by(u)],
  ]);
  let rear: XY[] = [];
  if (s.rear_window) {
    const [a, b] = s.rear_window;
    rear = us.map((u): XY => [u * hw(s, a) * 0.9, a + 0.08 * u * u]);
    for (let i = n; i >= 0; i--) {
      const u = -1 + (2 * i) / n;
      rear.push([u * hw(s, b) * 0.85, b - 0.05 * u * u]);
    }
  }
  return { shape, mask, style, dividers, rear };
}

/** Ports `upper_deck`: the hump outline of the 747 and A380 types, empty when there is none. */
export function upperDeckPts(s: SpriteBase): XY[] {
  const u = s.upper;
  if (!u) return [];
  const pts: XY[] = [];
  const n = 30;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = u.y0 + (u.y1 - u.y0) * t;
    let k = 1;
    if (t < 0.18) k = (t / 0.18) ** 0.5;
    else if (t > 0.75) k = ((1 - t) / 0.25) ** 0.8;
    pts.push([(u.w / 2) * k, y]);
  }
  return [...pts, ...mirrorXY(pts).reverse()];
}

/** Longitudinal and lateral bounds in the Python frame, ports `extent`. Includes props and winglets. */
export function bounds(s: SpriteBase): { xMax: number; yMin: number; yMax: number } {
  let half = s.span / 2;
  const wext = s.wing.winglet && s.wing.winglet !== 'none' ? (s.wing.ext ?? 0.6) : 0;
  half = Math.max(half, s.wing.sb + wext);
  for (const e of s.engines ?? []) if (e.kind === 'prop') half = Math.max(half, e.y + (e.prop_d ?? 0) / 2);
  if (s.nose_prop) half = Math.max(half, s.nose_prop.d / 2);
  let yMin = 0;
  for (const e of s.engines ?? []) yMin = Math.min(yMin, e.x - 0.3);
  let yMax = s.L;
  for (const e of s.engines ?? []) yMax = Math.max(yMax, e.x + e.len * 1.22);
  const h = s.hstab;
  yMax = Math.max(yMax, h.x + (h.span / 2) * tan(rad(h.sweep)) + h.tip);
  return { xMax: half, yMin, yMax };
}

const engineShape = (e: SpriteEngine): EngineShape => ({
  kind: e.kind === 'prop' ? 'prop' : 'nacelle',
  u: e.x + e.len / 2,
  v: e.y,
  len: e.len,
  d: e.d,
  propD: e.prop_d ?? 0,
  blades: e.blades ?? 0,
});

export function buildGeometry(b: SpriteBase): AircraftGeometry {
  const w = b.wing;
  const wingR = wingRight(b, w, w.high ? 0 : undefined);
  const winglets: Pt2[][] = [];
  for (const side of [1, -1] as const) {
    const wl = winglet(b, w, side);
    if (wl.length) winglets.push(toPt2(wl));
  }
  const stabR = hstabRight(b);
  const wingsOut = [toPt2(wingR), toPt2(mirrorXY(wingR).reverse())];
  const stabOut = [toPt2(stabR), toPt2(mirrorXY(stabR).reverse())];
  const spanM = 2 * (w.sb + (w.winglet && w.winglet !== 'none' ? (w.ext ?? 0.6) : 0));
  return {
    base: b,
    fuselage: toPt2(fuselagePts(b)),
    wings: wingsOut,
    stabilizers: stabOut,
    winglets,
    engines: (b.engines ?? []).map(engineShape),
    nosePropD: b.nose_prop?.d ?? 0,
    lengthM: b.L,
    spanM,
  };
}

/** Axis aligned extent of the body in meters, polygons only (fuselage, wings, stabilizers, winglets). */
export function extent(g: AircraftGeometry): { length: number; span: number } {
  let minU = Infinity;
  let maxU = -Infinity;
  let maxV = 0;
  const take = (poly: Pt2[]): void => {
    for (const p of poly) {
      minU = Math.min(minU, p.u);
      maxU = Math.max(maxU, p.u);
      maxV = Math.max(maxV, Math.abs(p.v));
    }
  };
  take(g.fuselage);
  for (const p of g.wings) take(p);
  for (const p of g.stabilizers) take(p);
  for (const p of g.winglets) take(p);
  return { length: maxU - minU, span: 2 * maxV };
}
