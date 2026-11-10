import { BUSINESS, PAINT } from '@data/index';
import type { Tower } from '@shared/airfield';

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** The paint window in meters, with `scale` device pixels per meter. */
export interface TowerWindow {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  scale: number;
}

const TP = PAINT.tower;
const C = TP.colors;
const FULL_TURN_DEG = 360;
const EPS = 1e-9;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Adds one closed regular polygon subpath. `across` is the flat to flat distance, so 4 sides is an axis aligned square. */
function ring(ctx: Ctx, cx: number, cy: number, across: number, sides: number): void {
  const r = across / 2 / Math.cos(Math.PI / sides);
  for (let i = 0; i < sides; i++) {
    const a = Math.PI / sides + (2 * Math.PI * i) / sides;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function fillRing(ctx: Ctx, color: string, cx: number, cy: number, across: number, sides: number): void {
  ctx.beginPath();
  ring(ctx, cx, cy, across, sides);
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Clips to the glass wedge from the centre, centred on the top of the screen. The reach is one footprint side,
 * which is longer than any cab half-diagonal the level table allows. A full turn needs no clip.
 */
function clipWedge(ctx: Ctx, cx: number, cy: number, sweepDeg: number): void {
  if (sweepDeg >= FULL_TURN_DEG) return;
  const half = rad(sweepDeg) / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, BUSINESS.tower.footprintM, -Math.PI / 2 - half, -Math.PI / 2 + half);
  ctx.closePath();
  ctx.clip();
}

/** Clamps a tower level to the paint table, where index 0 is level 1. */
const levelIndex = (level: number): number => Math.min(TP.levels.length, Math.max(1, level)) - 1;

function paintTower(ctx: Ctx, t: Tower, win: TowerWindow): void {
  const L = TP.levels[levelIndex(t.level)];
  const side = BUSINESS.tower.footprintM;
  const D = L.heightM * TP.shadowPerM;
  const reach = side / 2 + D;
  if (t.x + reach < win.minX || t.x - reach > win.maxX || t.y + reach < win.minY || t.y - reach > win.maxY) return;
  const { x, y } = t;
  const outlineW = Math.max(TP.outlineMinM, TP.outlinePx / win.scale);

  // Shadow: base, shaft sweep and cab, all cast toward the south east in one fill.
  ctx.beginPath();
  ctx.fillStyle = TP.shadowColor;
  ring(ctx, x + TP.shadowOffsetM, y + TP.shadowOffsetM, L.baseM, 4);
  // The shaft square swept along the diagonal is a hexagon, wound like `ring` so the fill stays one union.
  const h = L.shaftM / 2;
  ctx.moveTo(x - h, y + h);
  ctx.lineTo(x - h, y - h);
  ctx.lineTo(x + h, y - h);
  ctx.lineTo(x + h + D, y - h + D);
  ctx.lineTo(x + h + D, y + h + D);
  ctx.lineTo(x - h + D, y + h + D);
  ctx.closePath();
  ring(ctx, x + D, y + D, L.cabM, L.cabSides);
  ctx.fill();

  // Pad under the whole footprint.
  ctx.beginPath();
  ring(ctx, x, y, side, 4);
  ctx.fillStyle = C.pad;
  ctx.fill();
  ctx.strokeStyle = C.padEdge;
  ctx.lineWidth = Math.max(TP.padEdgeMinM, TP.padEdgePx / win.scale);
  ctx.stroke();

  fillRing(ctx, C.base, x, y, L.baseM, 4);
  fillRing(ctx, C.baseRoof, x, y, L.baseM - TP.baseRoofInsetM, 4);
  if (L.walkwayM > 0) fillRing(ctx, C.walkway, x, y, L.walkwayM, L.cabSides);

  // Cab: wall, then glass in the wedge, then mullions in the same wedge when the view is close enough.
  fillRing(ctx, C.wall, x, y, L.cabM, L.cabSides);
  ctx.save();
  clipWedge(ctx, x, y, L.glassSweepDeg);
  fillRing(ctx, C.glass, x, y, L.cabM, L.cabSides);
  ctx.restore();
  if (win.scale >= TP.mullionMinScale) {
    const sweep = rad(L.glassSweepDeg);
    const start = -Math.PI / 2 - sweep / 2;
    const step = rad(TP.mullionStepDeg);
    const rIn = L.cabM / 2 - L.glassBandM;
    const rOut = L.cabM / 2;
    ctx.save();
    clipWedge(ctx, x, y, L.glassSweepDeg);
    ctx.beginPath();
    for (let a = start; a < start + sweep - EPS; a += step) {
      ctx.moveTo(x + rIn * Math.cos(a), y + rIn * Math.sin(a));
      ctx.lineTo(x + rOut * Math.cos(a), y + rOut * Math.sin(a));
    }
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = TP.mullionWidthM;
    ctx.stroke();
    ctx.restore();
  }

  const roofAcross = L.cabM - 2 * L.glassBandM;
  ctx.beginPath();
  ring(ctx, x, y, roofAcross, L.cabSides);
  ctx.fillStyle = C.roof;
  ctx.fill();
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = outlineW;
  ctx.stroke();

  if (L.radomeM > 0) {
    ctx.beginPath();
    ctx.arc(x, y, L.radomeM / 2, 0, Math.PI * 2);
    ctx.fillStyle = C.radome;
    ctx.fill();
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = outlineW;
    ctx.stroke();
  }

  // Antennas sit on a small circle inside the roof, evenly spaced from the start angle.
  const antennaR = roofAcross * TP.antennaRingFrac;
  const antennaStart = rad(TP.antennaStartDeg);
  ctx.fillStyle = C.antenna;
  for (let k = 0; k < L.antennas; k++) {
    const a = antennaStart + (2 * Math.PI * k) / L.antennas;
    ctx.beginPath();
    ctx.arc(x + antennaR * Math.cos(a), y + antennaR * Math.sin(a), TP.antennaRadiusM, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Paints every free standing ATC tower of one chunk, skipping those whose shadow lies outside the window. */
export function paintTowers(ctx: Ctx, towers: readonly Tower[], win: TowerWindow): void {
  for (const t of towers) paintTower(ctx, t, win);
}
