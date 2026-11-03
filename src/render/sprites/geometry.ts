import type { SpriteBase } from '@data/aircraft';

/**
 * Aircraft outline geometry in meters, built from the sprite base data. The body frame has
 * u running from the nose (0) to the tail (L) and v positive to the right wing. Pure math
 * with no drawing, so calibration tests can measure it.
 */
export interface Pt2 {
  u: number;
  v: number;
}

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

const mirror = (poly: Pt2[]): Pt2[] => poly.map((p) => ({ u: p.u, v: -p.v })).reverse();

function halfWidth(b: SpriteBase, u: number): number {
  const half = b.fw / 2;
  if (u <= 0) return 0;
  if (u < b.nose) {
    const t = u / b.nose;
    return half * Math.sqrt(1 - Math.pow(1 - t, 1 + b.nose_n));
  }
  const tailStart = b.L - b.tail;
  if (u <= tailStart) return half;
  const t = (u - tailStart) / b.tail;
  return half * (1 - (1 - b.tail_end) * Math.pow(t, 1.6));
}

function fuselage(b: SpriteBase): Pt2[] {
  const upper: Pt2[] = [];
  const step = Math.max(0.2, b.L / 160);
  for (let u = 0; u < b.L; u += step) upper.push({ u, v: halfWidth(b, u) });
  upper.push({ u: b.L, v: halfWidth(b, b.L) });
  return [...upper, ...mirror(upper)];
}

function planform(rootU: number, rootChord: number, sweepDeg: number, rootV: number, tipV: number, tipChord: number, kinkV: number): Pt2[] {
  const t = Math.tan((sweepDeg * Math.PI) / 180);
  const leTip = rootU + t * (tipV - rootV);
  const leKink = rootU + t * (kinkV - rootV);
  return [
    { u: rootU, v: rootV },
    { u: leKink, v: kinkV },
    { u: leTip, v: tipV },
    { u: leTip + tipChord, v: tipV },
    { u: rootU + rootChord, v: kinkV > rootV ? kinkV : rootV },
    { u: rootU + rootChord, v: rootV },
  ];
}

export function buildGeometry(b: SpriteBase): AircraftGeometry {
  const w = b.wing;
  const rootV = b.fw / 2 - 0.2;
  const wingR = planform(w.x, w.c, w.sweep, rootV, w.sb, w.tip, Math.min(w.kink, w.sb));
  const winglets: Pt2[][] = [];
  const kind = w.winglet;
  if (w.ext && kind && kind !== 'none' && kind !== 'fence') {
    const t = Math.tan((w.sweep * Math.PI) / 180);
    const leTip = w.x + t * (w.sb - rootV);
    winglets.push([
      { u: leTip + 0.1, v: w.sb },
      { u: leTip + w.tip, v: w.sb },
      { u: leTip + w.tip * 0.7, v: w.sb + w.ext },
    ]);
  }
  const h = b.hstab;
  const stabR = planform(h.x, h.c, h.sweep, 0.3, h.span / 2, h.tip, h.span / 4);
  const engines: EngineShape[] = [];
  for (const e of b.engines ?? []) {
    const propD = (e as { prop_d?: number }).prop_d ?? 0;
    const blades = (e as { blades?: number }).blades ?? 0;
    engines.push({ kind: e.kind === 'prop' ? 'prop' : 'nacelle', u: e.x + e.len / 2, v: e.y, len: e.len, d: e.d, propD, blades });
  }
  const spanM = 2 * (w.sb + (w.ext ?? 0));
  return {
    base: b,
    fuselage: fuselage(b),
    wings: [wingR, mirror(wingR)],
    stabilizers: [stabR, mirror(stabR)],
    winglets: [...winglets, ...winglets.map(mirror)],
    engines,
    nosePropD: b.nose_prop?.d ?? 0,
    lengthM: b.L,
    spanM,
  };
}

/** Axis aligned extent of the body in meters, including nacelles and prop discs. */
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
