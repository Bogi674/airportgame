import { AIRCRAFT, SPRITE_BASES } from '@data/aircraft';
import type { SpriteEngine } from '@data/aircraft';
import { SPRITES } from '@data/index';
import type { LiveryData } from '@data/schemas';
import { bounds, buildGeometry, finPts, fuselagePts, hstabRight, hw, leY, teY, windscreen, upperDeckPts, wingRight, winglet, type AircraftGeometry, type XY } from './geometry';

export type Livery = LiveryData;

/** Livery slots: the 8 invented airline liveries of the data file, then the neutral default. */
export const LIVERY_SLOTS = SPRITES.liveries.length + 1;

/** Invented airline liveries, no real logos. Index 0 to 7 is stored per aircraft, anything else is neutral. */
export function liveryFor(idx: number): Livery {
  return SPRITES.liveries[idx] ?? SPRITES.neutral;
}

/** Tier of the aircraft sprite at a camera zoom in px per m, from the thresholds in `sprites.json`. */
export function tierForZoom(zoom: number): number {
  const min = SPRITES.tiers.minZoom;
  return zoom >= min[3] ? 3 : zoom >= min[2] ? 2 : zoom >= min[1] ? 1 : 0;
}

export interface Sprite {
  canvas: HTMLCanvasElement;
  ppm: number;
  width: number;
  height: number;
}

const PAD_M = SPRITES.padM;
const geometryCache = new Map<number, AircraftGeometry>();

function geometryFor(typeIdx: number): AircraftGeometry {
  let g = geometryCache.get(typeIdx);
  if (!g) {
    g = buildGeometry(SPRITE_BASES[AIRCRAFT[typeIdx].sprite.base]);
    geometryCache.set(typeIdx, g);
  }
  return g;
}

/** Colors of the prototype, `COL` in air2.py. */
const COL = {
  outline: '#8f99a5',
  wing: '#e9ecef',
  wingLine: '#b7bfc8',
  wingDark: '#d7dce2',
  glass: '#1c2530',
  glassLine: '#c9d2dc',
  window: '#6f7a86',
  door: '#8f99a5',
  nacelleLip: '#c4cbd3',
  core: '#5f6873',
  pylon: '#d9dee4',
  prop: '#2b3036',
  spinner: '#e9ecef',
  mask: '#14191f',
  skinEdge: '#d3d9e0',
};

/**
 * Bakes a top down sprite at true scale from vector geometry in meters, drawing the layers in the
 * order of docs/ART_AND_ASSETS.md section 4.2. The nose points to +x. Sprite tier 0 is the shadow
 * silhouette, tier 1 the default look without panel detail, tier 2 the reference look, tier 3 the
 * close up with slats, spoilers, lights and nacelle seams. Prototype tiers: 2 for sprite tiers 1
 * and 2, 3 for sprite tier 3.
 */
export function bakeAircraftSprite(typeIdx: number, liveryIdx: number, tier: number): Sprite {
  const g = geometryFor(typeIdx);
  const s = g.base;
  const livery = liveryFor(liveryIdx);
  const ppm = SPRITES.tiers.bakePpm[tier];
  const L = s.L;
  if (tier === 0) return bakeArrow(L, livery.fin, ppm);
  const bnd = bounds(s);
  const width = Math.ceil((L + 2 * PAD_M) * ppm);
  const height = Math.ceil((2 * bnd.xMax + 2 * PAD_M) * ppm);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, ppm, width, height };
  ctx.setTransform(ppm, 0, 0, ppm, 0, 0);
  ctx.lineJoin = 'round';
  const X = (y: number): number => L - y + PAD_M;
  const Y = (x: number): number => x + bnd.xMax + PAD_M;
  const lw = (px: number): number => px / ppm;
  const trace = (pts: readonly XY[], close = true): void => {
    ctx.beginPath();
    ctx.moveTo(X(pts[0][1]), Y(pts[0][0]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][1]), Y(pts[i][0]));
    if (close) ctx.closePath();
  };
  const paint = (fill: string | CanvasGradient | null, stroke: string | null, px: number): void => {
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw(px);
      ctx.stroke();
    }
  };
  const poly = (pts: readonly XY[], fill: string | CanvasGradient | null, stroke: string | null = null, px = 1): void => {
    trace(pts);
    paint(fill, stroke, px);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, px: number): void => {
    ctx.beginPath();
    ctx.moveTo(X(y1), Y(x1));
    ctx.lineTo(X(y2), Y(x2));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw(px);
    ctx.stroke();
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, stroke: string | null = null, px = 1): void => {
    ctx.beginPath();
    ctx.ellipse(X(y), Y(x), ry, rx, 0, 0, Math.PI * 2);
    paint(fill, stroke, px);
  };
  const circle = (x: number, y: number, r: number, fill: string): void => ellipse(x, y, r, r, fill);
  const rect = (x: number, y: number, w: number, h: number, fill: string | CanvasGradient | null, stroke: string | null = null, px = 1): void =>
    poly(
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      fill,
      stroke,
      px,
    );
  const dark = shade(livery.body, 0.82);
  const gradAcross = (xc: number, r: number, mid: string, edge: string): CanvasGradient => {
    const gr = ctx.createLinearGradient(0, Y(xc - r), 0, Y(xc + r));
    gr.addColorStop(0, edge);
    gr.addColorStop(0.18, shade(mid, 0.96));
    gr.addColorStop(0.5, mid);
    gr.addColorStop(0.82, shade(mid, 0.96));
    gr.addColorStop(1, edge);
    return gr;
  };
  const tierP = tier >= 3 ? 3 : 2;
  const detail = tier >= 2;
  const w = s.wing;
  const high = w.high === true;
  const ttail = s.hstab.ttail === true;
  const fin = s.fin ? finPts(s) : [];

  // Silhouette union, ports `silhouette`, used for the shadow and for tier 0.
  const engineSilhouette = (): void => {
    for (const e of s.engines ?? []) {
      for (const sg of [1, -1]) {
        const x = sg * e.y;
        const r = e.d / 2;
        poly(
          [
            [x - r * 0.8, e.x],
            [x + r * 0.8, e.x],
            [x + r, e.x + e.len * 0.2],
            [x + r, e.x + e.len],
            [x - r, e.x + e.len],
            [x - r, e.x + e.len * 0.2],
          ],
          '#000',
        );
      }
    }
  };
  const drawSilhouette = (): void => {
    const rp = wingRight(s, w, 0);
    for (const sg of [1, -1] as const) {
      poly(rp.map(([x, y]): XY => [sg * x, y]), '#000');
      const wl = winglet(s, w, sg);
      if (wl.length) poly(wl, '#000');
      poly(hstabRight(s).map(([x, y]): XY => [sg * x, y]), '#000');
    }
    poly(fuselagePts(s), '#000');
    engineSilhouette();
  };

  // Soft ground shadow.
  ctx.save();
  ctx.translate(1.2, 1.2);
  ctx.globalAlpha = 0.28;
  drawSilhouette();
  ctx.restore();
  if (tier === 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = livery.body;
    const wing = wingRight(s, w, 0);
    for (const sg of [1, -1] as const) {
      poly(wing.map(([x, y]): XY => [sg * x, y]), dark);
      poly(hstabRight(s).map(([x, y]): XY => [sg * x, y]), dark);
    }
    poly(fuselagePts(s), livery.body);
    ctx.restore();
    return { canvas, ppm, width, height };
  }

  const finFill = livery.fin;

  // ----- engines
  const nacelleGrad = (x: number, r: number): CanvasGradient => {
    const gr = ctx.createLinearGradient(0, Y(x - r), 0, Y(x + r));
    gr.addColorStop(0, '#c9d0d8');
    gr.addColorStop(0.35, '#ffffff');
    gr.addColorStop(0.65, '#ffffff');
    gr.addColorStop(1, '#c9d0d8');
    return gr;
  };
  const quadFront = (x: number, y0: number, Ln: number, r: number): void => {
    ctx.moveTo(X(y0 + 0.02 * Ln), Y(x - r * 0.9));
    ctx.quadraticCurveTo(X(y0 - 0.1 * Ln), Y(x), X(y0 + 0.02 * Ln), Y(x + r * 0.9));
  };
  const nacelleFan = (x: number, y0: number, Ln: number, d: number, e: SpriteEngine): void => {
    const r = d / 2;
    const flow = e.flow ?? 'separate';
    const fanEnd = e.fan_end ?? (flow === 'separate' ? 0.66 : 0.94);
    let pts: XY[];
    if (flow === 'separate') {
      const cr = r * (e.core_r ?? 0.5);
      poly(
        [
          [x - cr, y0 + fanEnd * Ln - 0.05 * Ln],
          [x - cr * 0.92, y0 + 0.86 * Ln],
          [x - cr * 0.7, y0 + Ln],
          [x + cr * 0.7, y0 + Ln],
          [x + cr * 0.92, y0 + 0.86 * Ln],
          [x + cr, y0 + fanEnd * Ln - 0.05 * Ln],
        ],
        '#e3e7eb',
        COL.outline,
        0.7,
      );
      const pr = cr * 0.62;
      poly(
        [
          [x - pr, y0 + Ln],
          [x - pr * 0.5, y0 + Ln * 1.1],
          [x, y0 + Ln * 1.15],
          [x + pr * 0.5, y0 + Ln * 1.1],
          [x + pr, y0 + Ln],
        ],
        COL.core,
        COL.outline,
        0.5,
      );
      pts = [
        [x - r * 0.9, y0 + 0.02 * Ln],
        [x - r, y0 + 0.2 * Ln],
        [x - r * 0.98, y0 + 0.5 * fanEnd * Ln + 0.15 * Ln],
        [x - r * 0.84, y0 + fanEnd * Ln],
        [x + r * 0.84, y0 + fanEnd * Ln],
        [x + r * 0.98, y0 + 0.5 * fanEnd * Ln + 0.15 * Ln],
        [x + r, y0 + 0.2 * Ln],
        [x + r * 0.9, y0 + 0.02 * Ln],
      ];
    } else {
      pts = [
        [x - r * 0.9, y0 + 0.02 * Ln],
        [x - r, y0 + 0.2 * Ln],
        [x - r * 0.96, y0 + 0.55 * Ln],
        [x - r * 0.72, y0 + 0.88 * Ln],
        [x - r * 0.5, y0 + Ln],
        [x + r * 0.5, y0 + Ln],
        [x + r * 0.72, y0 + 0.88 * Ln],
        [x + r * 0.96, y0 + 0.55 * Ln],
        [x + r, y0 + 0.2 * Ln],
        [x + r * 0.9, y0 + 0.02 * Ln],
      ];
      const pr = r * 0.26;
      poly(
        [
          [x - pr, y0 + Ln],
          [x, y0 + Ln * 1.07],
          [x + pr, y0 + Ln],
        ],
        COL.core,
        COL.outline,
        0.5,
      );
    }
    // White front fill, then the shaded body.
    ctx.beginPath();
    quadFront(x, y0, Ln, r);
    for (const [px, py] of pts) ctx.lineTo(X(py), Y(px));
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    poly(pts, nacelleGrad(x, r), COL.outline, 0.9);
    if (detail && livery.nacelle) {
      // Livery tint of the cowl, ports `nacelle_fan` with a livery.
      poly(
        [
          [x - r * 0.97, y0 + 0.12 * Ln],
          [x - r * 0.97, y0 + 0.5 * fanEnd * Ln + 0.15 * Ln],
          [x - r * 0.84, y0 + fanEnd * Ln * 0.97],
          [x + r * 0.84, y0 + fanEnd * Ln * 0.97],
          [x + r * 0.97, y0 + 0.5 * fanEnd * Ln + 0.15 * Ln],
          [x + r * 0.97, y0 + 0.12 * Ln],
        ],
        null,
      );
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = livery.nacelle;
      ctx.fill();
      ctx.restore();
    }
    // Lip.
    ctx.beginPath();
    quadFront(x, y0, Ln, r);
    ctx.lineTo(X(y0 + 0.09 * Ln), Y(x + r * 0.92));
    ctx.quadraticCurveTo(X(y0 + 0.02 * Ln), Y(x), X(y0 + 0.09 * Ln), Y(x - r * 0.92));
    ctx.closePath();
    paint(COL.nacelleLip, COL.outline, 0.6);
    if (e.chevrons && detail) {
      const ye = y0 + fanEnd * Ln;
      const nn = 9;
      ctx.beginPath();
      for (let i = 0; i <= nn; i++) {
        const xx = x - r * 0.84 + i * ((1.68 * r) / nn);
        const yy = ye + (i % 2 ? 0.035 * Ln : 0);
        if (i === 0) ctx.moveTo(X(yy), Y(xx));
        else ctx.lineTo(X(yy), Y(xx));
      }
      ctx.strokeStyle = COL.outline;
      ctx.lineWidth = lw(0.7);
      ctx.stroke();
    }
    if (tierP >= 3) line(x - r * 0.97, y0 + 0.4 * Ln, x + r * 0.97, y0 + 0.4 * Ln, COL.wingLine, 0.6);
  };
  const pylon = (x: number, y0: number, Ln: number, d: number): void => {
    const wl = leY(s, w, Math.abs(x));
    const pw = Math.max(0.35, d * 0.16);
    rect(x - pw / 2, y0 + 0.45 * Ln, pw, wl - (y0 + 0.45 * Ln) + 0.4, '#f3f5f7', '#b3bcc6', 0.5);
  };
  const prop = (x: number, y: number, pd: number, blades: number, phase: number): void => {
    const R = pd / 2;
    for (let i = 0; i < blades; i++) {
      const a = rad360(phase + (i * 360) / blades);
      const ln = R * Math.abs(Math.cos(a));
      if (ln < 0.05) continue;
      const sgn = Math.cos(a) > 0 ? 1 : -1;
      const ch = 0.09 + 0.06 * Math.abs(Math.sin(a)) + pd * 0.012;
      const off = Math.sin(a) > 0 ? 0.04 : -0.04;
      poly(
        [
          [x + sgn * 0.15, y + off - ch * 0.5],
          [x + sgn * ln * 0.75, y + off - ch * 0.6],
          [x + sgn * ln, y + off - ch * 0.25],
          [x + sgn * ln, y + off + ch * 0.25],
          [x + sgn * ln * 0.75, y + off + ch * 0.5],
          [x + sgn * 0.15, y + off + ch * 0.45],
        ],
        COL.prop,
      );
    }
  };
  const spinner = (x: number, y: number, rs: number): void => {
    ctx.beginPath();
    ctx.moveTo(X(y + rs * 1.1), Y(x - rs));
    ctx.quadraticCurveTo(X(y), Y(x - rs), X(y - rs * 0.6), Y(x));
    ctx.quadraticCurveTo(X(y), Y(x + rs), X(y + rs * 1.1), Y(x + rs));
    ctx.closePath();
    paint(COL.spinner, COL.outline, 0.6);
  };
  const nacelleProp = (x: number, y0: number, Ln: number, d: number): void => {
    const r = d / 2;
    poly(
      [
        [x - r * 0.55, y0 + 0.06 * Ln],
        [x - r, y0 + 0.2 * Ln],
        [x - r, y0 + 0.62 * Ln],
        [x - r * 0.7, y0 + 0.9 * Ln],
        [x - r * 0.3, y0 + Ln],
        [x + r * 0.3, y0 + Ln],
        [x + r * 0.7, y0 + 0.9 * Ln],
        [x + r, y0 + 0.62 * Ln],
        [x + r, y0 + 0.2 * Ln],
        [x + r * 0.55, y0 + 0.06 * Ln],
      ],
      nacelleGrad(x, r),
      COL.outline,
      0.8,
    );
    if (tierP >= 3) {
      ellipse(x - r * 0.6, y0 + 0.2 * Ln, r * 0.18, Ln * 0.03, COL.core);
      ellipse(x + r * 0.6, y0 + 0.2 * Ln, r * 0.18, Ln * 0.03, COL.core);
    }
  };
  const engines = (stage: 'under' | 'over' | 'rear' | 'props'): void => {
    for (const e of s.engines ?? []) {
      for (const sg of [-1, 1]) {
        const x = sg * e.y;
        if (e.kind === 'fan' && stage === 'under') {
          nacelleFan(x, e.x, e.len, e.d, e);
          if (tierP >= 3) pylon(x, e.x, e.len, e.d);
        } else if (e.kind === 'rear' && stage === 'rear') {
          const inner = sg * hw(s, e.x + e.len * 0.5);
          rect(Math.min(inner, x), e.x + e.len * 0.35, Math.abs(x - inner), e.len * 0.35, COL.pylon, COL.outline, 0.6);
          nacelleFan(x, e.x, e.len, e.d, e);
        } else if (e.kind === 'prop' && stage === (e.stage ?? 'under')) {
          nacelleProp(x, e.x, e.len, e.d);
        } else if (e.kind === 'prop' && stage === 'props') {
          prop(x, e.x - 0.05, e.prop_d ?? 0, e.blades ?? 0, e.phase ?? 12);
          spinner(x, e.x + 0.1, e.d * 0.28);
        }
      }
    }
  };

  // ----- wing parts
  const flapTracks = (): void => {
    for (const yy of w.tracks ?? []) {
      const ty = teY(s, w, yy);
      const ln = w.track_len ?? 1.2;
      const wd = w.track_w ?? 0.32;
      for (const sg of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(X(ty - 0.6), Y(sg * yy - wd / 2));
        ctx.lineTo(X(ty + ln * 0.5), Y(sg * yy - wd / 2));
        ctx.quadraticCurveTo(X(ty + ln * 1.15), Y(sg * yy), X(ty + ln * 0.5), Y(sg * yy + wd / 2));
        ctx.lineTo(X(ty - 0.6), Y(sg * yy + wd / 2));
        ctx.closePath();
        paint(COL.wingDark, COL.outline, 0.7);
      }
    }
    for (const e of s.engines ?? []) {
      if (e.kind === 'fan' && e.aft_fairing !== false) {
        const ty = teY(s, w, e.y);
        const ln = e.fair_len ?? 1.6;
        const wd = 0.42;
        for (const sg of [-1, 1]) {
          const x = sg * e.y;
          ctx.beginPath();
          ctx.moveTo(X(ty - 0.6), Y(x - wd / 2));
          ctx.lineTo(X(ty + ln * 0.55), Y(x - wd / 2));
          ctx.quadraticCurveTo(X(ty + ln * 1.15), Y(x), X(ty + ln * 0.55), Y(x + wd / 2));
          ctx.lineTo(X(ty - 0.6), Y(x + wd / 2));
          ctx.closePath();
          paint(COL.wingDark, COL.outline, 0.7);
        }
      }
    }
  };
  const wingParts = (): void => {
    const rp = wingRight(s, w, high ? 0 : undefined);
    if (high) poly([...rp, ...rp.map(([x, y]): XY => [-x, y]).reverse()], COL.wing, COL.outline, 0.9);
    for (const sg of [-1, 1] as const) {
      if (!high) poly(rp.map(([x, y]): XY => [sg * x, y]), COL.wing, COL.outline, 0.9);
      const wl = winglet(s, w, sg);
      if (wl.length) poly(wl, livery.winglet, COL.outline, 0.8);
    }
    if (!detail) return;
    const R = w.root_y ?? s.fw / 2;
    for (const sg of [-1, 1]) {
      const ys = [R + 0.05, w.kink, w.sb * 0.97];
      ctx.beginPath();
      ys.forEach((yy, i) => {
        const c = teY(s, w, yy) - leY(s, w, yy);
        const py = teY(s, w, yy) - c * 0.24;
        if (i === 0) ctx.moveTo(X(py), Y(sg * yy));
        else ctx.lineTo(X(py), Y(sg * yy));
      });
      ctx.strokeStyle = COL.wingLine;
      ctx.lineWidth = lw(0.8);
      ctx.stroke();
      const ail = (w.aileron ?? 0.72) * w.sb;
      const c = teY(s, w, ail) - leY(s, w, ail);
      line(sg * ail, teY(s, w, ail) - c * 0.24, sg * ail, teY(s, w, ail), COL.wingLine, 0.8);
      if (tierP >= 3) {
        ctx.beginPath();
        [R + 0.6, w.sb * 0.97].forEach((yy, i) => {
          const cc = teY(s, w, yy) - leY(s, w, yy);
          const py = leY(s, w, yy) + cc * 0.12;
          if (i === 0) ctx.moveTo(X(py), Y(sg * yy));
          else ctx.lineTo(X(py), Y(sg * yy));
        });
        ctx.setLineDash([1.6, 0.15]);
        ctx.strokeStyle = COL.wingLine;
        ctx.lineWidth = lw(0.6);
        ctx.stroke();
        ctx.setLineDash([]);
        for (let k = 0; k < 5; k++) {
          const yy = R + 0.8 + (k * (ail - R - 1.0)) / 5;
          const cc = teY(s, w, yy) - leY(s, w, yy);
          line(sg * yy, teY(s, w, yy) - cc * 0.24, sg * yy, teY(s, w, yy) - cc * 0.4, COL.wingLine, 0.5);
        }
      }
    }
  };

  // ----- tail
  const hstab = (): void => {
    const h = s.hstab;
    const rp = hstabRight(s);
    for (const sg of [-1, 1]) {
      poly(rp.map(([x, y]): XY => [sg * x, y]), COL.wing, COL.outline, 0.9);
      if (detail) {
        const R = rp[0][0];
        const sb = h.span / 2;
        line(sg * R, h.x + h.c * 0.7, sg * sb * 0.97, rp[1][1] + h.tip * 0.68, COL.wingLine, 0.7);
      }
    }
    if (ttail) ellipse(0, h.x + h.c * 0.45, 0.22 * h.c * 0.4 + 0.1, h.c * 0.55, COL.wing, COL.outline, 0.7);
  };
  const finDraw = (): void => {
    if (fin.length) poly(fin, finFill, COL.outline, 0.8);
  };

  // ----- fuselage and cabin details
  const fuselageDraw = (): void => {
    poly(fuselagePts(s), gradAcross(0, s.fw / 2, livery.body, shade(livery.body, 0.82)), COL.outline, 1.0);
    if (detail && livery.crown) {
      // Crown band along the top of the barrel, between the nose and the tail taper.
      rect(-s.fw * 0.09, s.nose, s.fw * 0.18, s.L - s.tail - s.nose, livery.crown);
    }
  };
  const upperDeck = (): void => {
    const pts = upperDeckPts(s);
    if (pts.length) poly(pts, null, COL.skinEdge, 1.2);
  };
  const doorsWindows = (): void => {
    const dd = s.doors ?? [];
    const ow = s.overwing ?? [];
    const inset = s.door_inset ?? 0.07;
    const dw = s.door_w ?? 0.24;
    for (const y of dd) {
      const h = s.door_len ?? 0.95;
      for (const sg of [-1, 1]) {
        const xe = hw(s, y) - inset - dw;
        rect(sg * (xe + dw / 2) - dw / 2, y - h / 2, dw, h, null, COL.door, 0.8);
      }
    }
    for (const y of ow) {
      for (const sg of [-1, 1]) {
        const xe = hw(s, y) - inset - dw * 0.8;
        rect(sg * (xe + dw * 0.4) - dw * 0.4, y - 0.3, dw * 0.8, 0.6, null, COL.door, 0.7);
      }
    }
    const wn = s.windows;
    if (wn) {
      const [a, b, pitch] = wn;
      const rr = s.win_r ?? 0.09;
      const skip: [number, number][] = [...dd.map((y): [number, number] => [y - 0.75, y + 0.75]), ...ow.map((y): [number, number] => [y - 0.45, y + 0.45])];
      for (let y = a; y <= b; y += pitch) {
        if (skip.some(([lo, hi]) => lo < y && y < hi)) continue;
        const xw = hw(s, y) - (s.win_inset ?? 0.2);
        circle(-xw, y, rr, COL.window);
        circle(xw, y, rr, COL.window);
      }
      if (s.upper) {
        const [ua, ub, uw] = s.upper.win;
        for (let y = ua; y <= ub; y += pitch) {
          circle(-uw, y, rr, COL.window);
          circle(uw, y, rr, COL.window);
        }
      }
    }
  };
  const windscreenDraw = (): void => {
    const ws = windscreen(s);
    if (!ws) return;
    if (ws.style === 'a350') {
      poly(ws.mask, COL.mask);
      poly(ws.shape, '#2d3a48');
    } else {
      poly(ws.shape, COL.glass);
    }
    for (const [a, b] of ws.dividers) line(a[0], a[1], b[0], b[1], COL.glassLine, 1.0);
    if (ws.rear.length) poly(ws.rear, COL.glass);
  };
  const lights = (): void => {
    const sb = w.sb + (w.winglet && w.winglet !== 'none' ? (w.ext ?? 0) : 0);
    const yl = leY(s, w, w.sb) + w.tip * 0.5;
    const r = Math.max(0.12, 1.6 / ppm);
    circle(-sb, yl, r, '#e5322d');
    circle(sb, yl, r, '#25b04a');
    circle(0, L * 0.42, r * 0.9, '#e5322d');
  };

  // ----- layer order, section 4.2 of docs/ART_AND_ASSETS.md
  if (!high) {
    if (detail) flapTracks();
    engines('under');
    wingParts();
    engines('over');
    if (!ttail) hstab();
    fuselageDraw();
  } else {
    if (!ttail) hstab();
    fuselageDraw();
    for (const [a, b, o] of s.sponsons ?? []) {
      for (const sg of [-1, 1]) {
        const x = sg * (hw(s, (a + b) / 2) + o / 2);
        rect(x - o / 2 - 0.15, a, o + 0.3, b - a, nacelleGrad(x, o / 2 + 0.15), COL.outline, 0.7);
      }
    }
    if (detail) {
      doorsWindows();
      windscreenDraw();
      flapTracks();
    }
    engines('under');
    wingParts();
  }
  if (detail && !high) {
    upperDeck();
    doorsWindows();
    windscreenDraw();
  }
  engines('rear');
  finDraw();
  if (ttail) hstab();
  engines('props');
  if (s.nose_prop) {
    const np = s.nose_prop;
    prop(0, 0.05, np.d, np.blades, np.phase ?? 10);
    spinner(0, 0.2, np.spinner ?? 0.22);
  }
  if (tierP >= 3 && tier >= 3) {
    lights();
    circle(0, L * 0.25, Math.max(0.08, 1.2 / ppm), '#6d7783');
    circle(0, L * 0.6, Math.max(0.08, 1.2 / ppm), '#6d7783');
  }
  return { canvas, ppm, width, height };
}

const rad360 = (deg: number): number => (deg * Math.PI) / 180;

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const gg = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${gg},${b})`;
}

/** Marker of tier 0: a heading arrow in the airline color, ports `marker`. The nose points to +x. */
function bakeArrow(L: number, color: string, ppm: number): Sprite {
  const k = Math.max(6, L * 0.5);
  const width = Math.ceil(1.6 * k * ppm) + 2;
  const height = Math.ceil(1.1 * k * ppm) + 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, ppm, width, height };
  ctx.setTransform(ppm, 0, 0, ppm, 0, 0);
  const cx = width / ppm / 2;
  const cy = height / ppm / 2;
  const pts: XY[] = [
    [0, 0],
    [0.55 * k, 1.6 * k],
    [0, 1.2 * k],
    [-0.55 * k, 1.6 * k],
  ];
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const px = cx + 0.8 * k - y;
    const py = cy + x;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.08 * k;
  ctx.stroke();
  return { canvas, ppm, width, height };
}

/**
 * Sprite cache keyed by type, livery slot and tier. It is a least recently used cache bounded by
 * `SPRITES.cache.maxEntries`, so baking every combination never grows past that count.
 */
export class SpriteCache {
  private readonly sprites = new Map<number, Sprite>();

  constructor(
    private readonly bake: (typeIdx: number, liveryIdx: number, tier: number) => Sprite = bakeAircraftSprite,
    private readonly maxEntries: number = SPRITES.cache.maxEntries,
  ) {}

  get(typeIdx: number, liveryIdx: number, tier: number): Sprite {
    const slot = liveryIdx >= 0 && liveryIdx < SPRITES.liveries.length ? liveryIdx : SPRITES.liveries.length;
    const key = (typeIdx * LIVERY_SLOTS + slot) * 4 + tier;
    let s = this.sprites.get(key);
    if (s) {
      // Touch: move to the most recent end.
      this.sprites.delete(key);
    } else {
      s = this.bake(typeIdx, slot, tier);
      if (this.sprites.size >= this.maxEntries) {
        const oldest = this.sprites.keys().next();
        if (!oldest.done) this.sprites.delete(oldest.value);
      }
    }
    this.sprites.set(key, s);
    return s;
  }

  get size(): number {
    return this.sprites.size;
  }

  clear(): void {
    this.sprites.clear();
  }
}
