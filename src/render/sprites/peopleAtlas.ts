import { PEOPLE } from '@data/index';
import { personOps, shadowOps, type ShapeOp } from './peopleShapes';

/** Frame columns per recipe row: four gait frames. */
const FRAMES = 4;
/** Recipe rows followed by one shadow row. */
const SHADOW_ROW = PEOPLE.recipes.length;
const ROWS = SHADOW_ROW + 1;

export interface PeopleAtlas {
  canvas: HTMLCanvasElement;
  ppm: number;
  cellPx: number;
}

/** Draws shape ops in meters on a canvas whose transform already maps meters to pixels. */
export function rasterOps(ctx: CanvasRenderingContext2D, ops: readonly ShapeOp[]): void {
  for (const op of ops) {
    ctx.save();
    ctx.translate(op.tx ?? 0, op.ty ?? 0);
    if (op.rotDeg) ctx.rotate((op.rotDeg * Math.PI) / 180);
    ctx.scale(op.sx ?? 1, op.sy ?? 1);
    ctx.globalAlpha = op.op ?? 1;
    drawOp(ctx, op);
    ctx.restore();
  }
}

function drawOp(ctx: CanvasRenderingContext2D, op: ShapeOp): void {
  switch (op.k) {
    case 'rect':
      ctx.beginPath();
      if (op.rx) ctx.roundRect(op.x, op.y, op.w, op.h, op.rx);
      else ctx.rect(op.x, op.y, op.w, op.h);
      paint(ctx, op.fill, op.stroke, op.sw);
      return;
    case 'circle':
      ctx.beginPath();
      ctx.arc(op.cx, op.cy, op.r, 0, 2 * Math.PI);
      paint(ctx, op.fill, op.stroke, op.sw);
      return;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(op.cx, op.cy, op.rx, op.ry, 0, 0, 2 * Math.PI);
      paint(ctx, op.fill, op.stroke, op.sw);
      return;
    case 'line':
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.lineCap = op.cap ?? 'butt';
      ctx.strokeStyle = op.stroke;
      ctx.lineWidth = op.sw;
      ctx.stroke();
      return;
    case 'poly':
      ctx.beginPath();
      op.pts.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      paint(ctx, op.fill, op.stroke, op.sw);
      return;
    case 'path':
      paint(ctx, op.fill, op.stroke, op.sw, new Path2D(op.d));
      return;
  }
}

function paint(ctx: CanvasRenderingContext2D, fill: string, stroke: string | undefined, sw: number | undefined, path?: Path2D): void {
  if (fill !== 'none') {
    ctx.fillStyle = fill;
    if (path) ctx.fill(path);
    else ctx.fill();
  }
  if (stroke !== undefined) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = sw ?? 0;
    if (path) ctx.stroke(path);
    else ctx.stroke();
  }
}

/**
 * Bakes one detail tier into an atlas: column frame, row recipe, last row the shadow. Each cell is
 * cellM meters square with the figure centred, so the sprite draws at true scale.
 */
export function bakePeopleAtlas(tier: number): PeopleAtlas {
  const t = PEOPLE.tiers[tier];
  if (!t) throw new RangeError(`people tier ${tier} is not in people.json`);
  const ppm = t.ppm;
  const cellPx = Math.ceil(PEOPLE.cellM * ppm);
  const canvas = document.createElement('canvas');
  canvas.width = FRAMES * cellPx;
  canvas.height = ROWS * cellPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, ppm, cellPx };
  const ops: ShapeOp[] = [];
  for (let row = 0; row < PEOPLE.recipes.length; row++) {
    const recipe = PEOPLE.recipes[row];
    for (let frame = 0; frame < FRAMES; frame++) {
      ops.length = 0;
      personOps(recipe, frame, t.detail, false, ops);
      drawCell(ctx, ops, frame * cellPx, row * cellPx, cellPx, ppm);
    }
  }
  ops.length = 0;
  shadowOps(ops);
  drawCell(ctx, ops, 0, SHADOW_ROW * cellPx, cellPx, ppm);
  return { canvas, ppm, cellPx };
}

function drawCell(ctx: CanvasRenderingContext2D, ops: readonly ShapeOp[], x0: number, y0: number, cellPx: number, ppm: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, cellPx, cellPx);
  ctx.clip();
  ctx.setTransform(ppm, 0, 0, ppm, x0 + cellPx / 2, y0 + cellPx / 2);
  rasterOps(ctx, ops);
  ctx.restore();
}

/** Keeps each tier's atlas after its first bake. Tiers bake lazily, so unused zoom bands cost nothing. */
export class PeopleAtlasCache {
  private readonly atlases = new Map<number, PeopleAtlas>();

  get(tier: number): PeopleAtlas {
    const cached = this.atlases.get(tier);
    if (cached) return cached;
    const atlas = bakePeopleAtlas(tier);
    this.atlases.set(tier, atlas);
    return atlas;
  }
}

/** Highest people tier whose minZoom is at or below zoom, or -1 when zoomed out past all tiers. */
export function peopleTierForZoom(zoom: number): number {
  let tier = -1;
  PEOPLE.tiers.forEach((t, i) => {
    if (t.minZoom <= zoom && i > tier) tier = i;
  });
  return tier;
}
