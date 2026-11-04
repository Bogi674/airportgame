import { AIRCRAFT, SPRITE_BASES } from '@data/aircraft';
import { buildGeometry, type AircraftGeometry, type Pt2 } from './geometry';

export interface Livery {
  body: string;
  tail: string;
  accent: string;
}

/** Invented airline liveries, no real logos. Index 0 to 7 is stored per aircraft in the snapshot. */
export const LIVERIES: readonly Livery[] = [
  { body: '#eef0f2', tail: '#c8102e', accent: '#1d2b53' },
  { body: '#f4f1e8', tail: '#1f6fb2', accent: '#f2b705' },
  { body: '#e9eef0', tail: '#2a9d8f', accent: '#264653' },
  { body: '#f6f6f6', tail: '#e76f51', accent: '#2b2d42' },
  { body: '#dfe5ea', tail: '#6a4c93', accent: '#f4a261' },
  { body: '#f0ede4', tail: '#2d6a4f', accent: '#d4a017' },
  { body: '#eaeaea', tail: '#0b3c5d', accent: '#d9b310' },
  { body: '#f8f1e5', tail: '#9d0208', accent: '#370617' },
];

/** Pixels per meter for the three detail tiers. */
export const TIER_PPM = [1.5, 4, 9, 18] as const;
export const tierForZoom = (zoom: number): number => (zoom < 0.5 ? 0 : zoom < 3 ? 1 : zoom < 8 ? 2 : 3);

export interface Sprite {
  canvas: HTMLCanvasElement;
  ppm: number;
  width: number;
  height: number;
}

const PAD_M = 3;
const geometryCache = new Map<number, AircraftGeometry>();

function geometryFor(typeIdx: number): AircraftGeometry {
  let g = geometryCache.get(typeIdx);
  if (!g) {
    g = buildGeometry(SPRITE_BASES[AIRCRAFT[typeIdx].sprite.base]);
    geometryCache.set(typeIdx, g);
  }
  return g;
}

/**
 * Bakes a top down sprite at true scale from vector geometry in meters. The nose points to +x.
 * Tier 0 is a silhouette, tier 1 adds engines, tail colour and the windscreen, tier 2 adds
 * panel lines, flap lines and the cheat line.
 */
export function bakeAircraftSprite(typeIdx: number, liveryIdx: number, tier: number): Sprite {
  const g = geometryFor(typeIdx);
  const livery = LIVERIES[liveryIdx % LIVERIES.length];
  const ppm = TIER_PPM[tier];
  const L = g.lengthM;
  const span = g.spanM;
  const width = Math.ceil((L + 2 * PAD_M) * ppm);
  const height = Math.ceil((span + 2 * PAD_M) * ppm);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, ppm, width, height };
  ctx.setTransform(ppm, 0, 0, ppm, 0, 0);
  const X = (u: number): number => L - u + PAD_M;
  const Y = (v: number): number => v + span / 2 + PAD_M;
  const poly = (pts: Pt2[]): void => {
    ctx.beginPath();
    ctx.moveTo(X(pts[0].u), Y(pts[0].v));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].u), Y(pts[i].v));
    ctx.closePath();
  };
  const dark = shade(livery.body, 0.82);

  // Soft ground shadow.
  if (tier >= 1) {
    ctx.save();
    ctx.translate(1.2, 1.2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (const p of [g.fuselage, ...g.wings, ...g.stabilizers]) {
      poly(p);
      ctx.fill();
    }
    ctx.restore();
  }
  const highWing = g.base.wing.high === true;
  const drawWings = (): void => {
    ctx.fillStyle = dark;
    for (const w of g.wings) {
      poly(w);
      ctx.fill();
    }
    ctx.fillStyle = tier >= 1 ? livery.accent : dark;
    for (const w of g.winglets) {
      poly(w);
      ctx.fill();
    }
  };
  ctx.fillStyle = dark;
  for (const s of g.stabilizers) {
    poly(s);
    ctx.fill();
  }
  if (!highWing) drawWings();
  // Engines.
  for (const e of g.engines) {
    for (const side of [-1, 1]) {
      const v = e.v * side;
      if (e.kind === 'nacelle') {
        ctx.fillStyle = tier >= 1 ? '#c9ced3' : dark;
        ctx.beginPath();
        ctx.ellipse(X(e.u), Y(v), e.len / 2, e.d / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        if (tier >= 1) {
          ctx.fillStyle = '#3a3f45';
          ctx.beginPath();
          ctx.ellipse(X(e.u - e.len / 2 + 0.2), Y(v), 0.25, e.d / 2 - 0.15, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.ellipse(X(e.u), Y(v), e.len / 2, e.d / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        if (tier >= 1 && e.propD > 0) {
          ctx.fillStyle = 'rgba(40,40,40,0.28)';
          ctx.beginPath();
          ctx.arc(X(e.u - e.len / 2), Y(v), e.propD / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  // Fuselage on top.
  ctx.fillStyle = livery.body;
  poly(g.fuselage);
  ctx.fill();
  if (highWing) drawWings();
  if (g.nosePropD > 0 && tier >= 1) {
    ctx.fillStyle = 'rgba(40,40,40,0.28)';
    ctx.beginPath();
    ctx.arc(X(0), Y(0), g.nosePropD / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (tier >= 1) {
    // Tail colour on the fin as seen from above, and a windscreen.
    const fin = (g.base as unknown as { fin?: { x0: number; x1: number; w: number } }).fin;
    if (fin) {
      ctx.fillStyle = livery.tail;
      ctx.fillRect(X(fin.x1), Y(-fin.w / 2), fin.x1 - fin.x0, fin.w);
    }
    ctx.fillStyle = '#26323a';
    const wsU = g.base.nose * 0.82;
    ctx.beginPath();
    ctx.ellipse(X(wsU), Y(0), 0.5, g.base.fw * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Cheat line along the fuselage.
    ctx.fillStyle = livery.accent;
    ctx.fillRect(X(L - g.base.tail), Y(-0.12), L - g.base.tail - g.base.nose, 0.24);
  }
  if (tier >= 2) {
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 0.05;
    for (const w of g.wings) {
      ctx.beginPath();
      const a = w[3];
      const b = w[4];
      ctx.moveTo(X(a.u - 0.2), Y(a.v * 0.9));
      ctx.lineTo(X(b.u - 0.1), Y(b.v));
      ctx.stroke();
    }
    const doors = g.base.doors ?? [];
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (const d of doors) for (const side of [-1, 1]) ctx.fillRect(X(d + 0.4), Y(side * g.base.fw * 0.5 - 0.1), 0.8, 0.2);
  }
  if (tier >= 3) {
    // Close detail: fuselage panel seams, window strips under the cheat line, flap tracks and engine pylons.
    const fw = g.base.fw;
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    for (let u = g.base.nose; u < L - g.base.tail; u += 2.6) {
      ctx.moveTo(X(u), Y(-fw * 0.48));
      ctx.lineTo(X(u), Y(fw * 0.48));
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(38,50,58,0.55)';
    for (const side of [-1, 1]) {
      for (let u = g.base.nose + 2; u < L - g.base.tail - 2; u += 0.75) ctx.fillRect(X(u), Y(side * fw * 0.42 - 0.09), 0.38, 0.18);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 0.04;
    for (const w of g.wings) {
      const a = w[3];
      const b = w[4];
      for (const k of [0.3, 0.55, 0.8]) {
        ctx.beginPath();
        ctx.moveTo(X(a.u + (b.u - a.u) * k), Y(a.v + (b.v - a.v) * k));
        ctx.lineTo(X(a.u + (b.u - a.u) * k - 0.9), Y(a.v + (b.v - a.v) * k));
        ctx.stroke();
      }
    }
    for (const e of g.engines) {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(X(e.u), Y(e.v * side));
        ctx.lineTo(X(e.u - 1.2), Y(e.v * side * 0.85));
        ctx.stroke();
      }
    }
  }
  return { canvas, ppm, width, height };
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const gg = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${gg},${b})`;
}

/** Sprite cache keyed by type, livery and tier. At most 10 types by 8 liveries by 4 tiers. */
export class SpriteCache {
  private readonly sprites: (Sprite | undefined)[] = [];

  get(typeIdx: number, liveryIdx: number, tier: number): Sprite {
    const key = (typeIdx * 8 + (liveryIdx & 7)) * 4 + tier;
    let s = this.sprites[key];
    if (!s) {
      s = bakeAircraftSprite(typeIdx, liveryIdx & 7, tier);
      this.sprites[key] = s;
    }
    return s;
  }

  clear(): void {
    this.sprites.length = 0;
  }
}
