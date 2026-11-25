/**
 * Canvas baker for the terminal fixtures. It executes the draw plan of fixturePlan.ts on an OffscreenCanvas in sprite
 * meters, and draws baked sprites onto a meter space context. Port of the drawing parts of
 * docs/reference/sprite-prototypes/fixture_ops.py (bake and the SVG paint of the ops) with the gradients of
 * fixture_ops._grad and the patterns of fixture_core.defs.
 */
import type { FixtureOp } from '../../data/schemas';
import { kitAsset } from './fixtureKit';
import {
  SHADOW_ALPHA,
  SHADOW_BLUR_M,
  planFixture,
  shade,
  type PlannedOp,
  type Pt,
  type ResolvedFill,
  type Rot,
  type Tier,
} from './fixturePlan';

/** Margin around the footprint so shadows and strokes are not clipped, in meters. */
export const SPRITE_PAD_M = 0.7;

/** Baked sprites kept before the cache is cleared. */
const CACHE_LIMIT = 512;
const PERF_TILE_M = 0.07;
const WEAVE_TILE_M = 0.1;
const DEG = Math.PI / 180;
/** Light color of the glow gradient at its center, fixture_ops._grad glow stops. */
const GLOW_RGB = '159, 211, 242';

export interface FixtureSprite {
  canvas: OffscreenCanvas;
  /** Footprint width and depth in meters, rotation 0. */
  wM: number;
  hM: number;
  padM: number;
}

type Patterns = { perf: CanvasPattern | null; weave: CanvasPattern | null };
type Box = [number, number, number, number];

const cache = new Map<string, FixtureSprite>();
const patternsByPpm = new Map<number, Patterns>();
const pathByData = new Map<string, Path2D>();

/** Tiles the perf and weave fills, built once per ppm. The tile is drawn in meters and repeated in meters. */
function patternsFor(ppm: number): Patterns {
  const cached = patternsByPpm.get(ppm);
  if (cached !== undefined) return cached;
  const patterns: Patterns = {
    perf: tilePattern(PERF_TILE_M, ppm, (ctx) => {
      ctx.fillStyle = '#00000030';
      ctx.beginPath();
      ctx.arc(PERF_TILE_M / 2, PERF_TILE_M / 2, 0.014, 0, 2 * Math.PI);
      ctx.fill();
    }),
    weave: tilePattern(WEAVE_TILE_M, ppm, (ctx) => {
      ctx.strokeStyle = '#ffffff22';
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.moveTo(0, WEAVE_TILE_M / 2);
      ctx.lineTo(WEAVE_TILE_M, WEAVE_TILE_M / 2);
      ctx.moveTo(WEAVE_TILE_M / 2, 0);
      ctx.lineTo(WEAVE_TILE_M / 2, WEAVE_TILE_M);
      ctx.stroke();
    }),
  };
  patternsByPpm.set(ppm, patterns);
  return patterns;
}

/** A repeating pattern whose period is tileM meters: the tile is drawn at its own pixel size and scaled back. */
function tilePattern(tileM: number, ppm: number, draw: (ctx: OffscreenCanvasRenderingContext2D) => void): CanvasPattern | null {
  const n = Math.max(1, Math.round(tileM * ppm));
  const tile = new OffscreenCanvas(n, n);
  const ctx = tile.getContext('2d');
  if (ctx === null) return null;
  ctx.setTransform(n / tileM, 0, 0, n / tileM, 0, 0);
  draw(ctx);
  const pattern = ctx.createPattern(tile, 'repeat');
  const s = tileM / n;
  pattern?.setTransform({ a: s, b: 0, c: 0, d: s, e: 0, f: 0 });
  return pattern;
}

/** A path from SVG path data, built once per data string. */
function pathFromData(d: string): Path2D {
  let path = pathByData.get(d);
  if (path === undefined) {
    path = new Path2D(d);
    pathByData.set(d, path);
  }
  return path;
}

function polygonPath(pts: readonly Pt[]): Path2D {
  const path = new Path2D();
  pts.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  path.closePath();
  return path;
}

/** Outline of a drawable op in its local frame, rotation of an ellipse excluded. Undefined for text and air. */
function opPath(op: FixtureOp): Path2D | undefined {
  switch (op.k) {
    case 'r': {
      const path = new Path2D();
      const radius = op.rx ?? 0;
      if (radius > 0) path.roundRect(op.x, op.y, op.w, op.h, Math.min(radius, op.w / 2, op.h / 2));
      else path.rect(op.x, op.y, op.w, op.h);
      return path;
    }
    case 'c': {
      const path = new Path2D();
      path.arc(op.x, op.y, op.r, 0, 2 * Math.PI);
      return path;
    }
    case 'e': {
      const path = new Path2D();
      path.ellipse(op.x, op.y, op.rx, op.ry, 0, 0, 2 * Math.PI);
      return path;
    }
    case 'p':
    case 'glow':
      return polygonPath(op.p);
    case 'a':
      return pathFromData(op.d);
    case 'l': {
      const path = new Path2D();
      path.moveTo(op.x1, op.y1);
      path.lineTo(op.x2, op.y2);
      return path;
    }
    case 't':
    case 'air':
      return undefined;
  }
}

/** Bounding box [x, y, w, h] in the local frame, the reference for gradient fills. Undefined when unknown. */
function opBox(op: FixtureOp): Box | undefined {
  switch (op.k) {
    case 'r':
      return [op.x, op.y, op.w, op.h];
    case 'c':
      return [op.x - op.r, op.y - op.r, 2 * op.r, 2 * op.r];
    case 'e':
      return [op.x - op.rx, op.y - op.ry, 2 * op.rx, 2 * op.ry];
    case 'p':
    case 'glow':
      return pointsBox(op.p);
    case 'a':
      return op.shp === undefined ? undefined : pointsBox(op.shp);
    default:
      return undefined;
  }
}

function pointsBox(pts: readonly Pt[]): Box {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}

/** Gradient in unit space, the exact stops and directions of fixture_ops._grad. */
function unitGradient(ctx: OffscreenCanvasRenderingContext2D, g: string, c: string, a: 'h' | 'v'): CanvasGradient {
  const horizontal = a === 'h';
  const linear = (x1: number, y1: number, x2: number, y2: number, stops: [number, string][]): CanvasGradient => {
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    for (const [offset, color] of stops) grad.addColorStop(offset, color);
    return grad;
  };
  const radial = (cx: number, cy: number, r: number, stops: [number, string][]): CanvasGradient => {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [offset, color] of stops) grad.addColorStop(offset, color);
    return grad;
  };
  const dirX = horizontal ? 1 : 0;
  const dirY = horizontal ? 0 : 1;
  switch (g) {
    case 'soft': {
      const edge = shade(c, -0.12);
      const mid = shade(c, 0.06);
      return linear(0, 0, dirX, dirY, [
        [0, edge],
        [0.2, mid],
        [0.5, shade(c, 0.14)],
        [0.8, mid],
        [1, edge],
      ]);
    }
    case 'lit':
      return linear(0, 0, dirX, dirY, [
        [0, shade(c, 0.12)],
        [1, shade(c, -0.08)],
      ]);
    case 'dome':
      return radial(0.4, 0.38, 0.65, [
        [0, shade(c, 0.18)],
        [0.7, c],
        [1, shade(c, -0.14)],
      ]);
    case 'screen':
      return linear(0, 0, 1, 1, [
        [0, '#2c4864'],
        [0.55, '#1d2a38'],
        [1, '#141c26'],
      ]);
    case 'glow':
      return radial(0.5, 0, 1, [
        [0, `rgba(${GLOW_RGB}, 0.55)`],
        [1, `rgba(${GLOW_RGB}, 0)`],
      ]);
    case 'water':
      return radial(0.5, 0.5, 0.5, [
        [0, '#bfe6f5'],
        [0.7, '#7cc3e0'],
        [1, '#4f9fc4'],
      ]);
    case 'ramp':
      return linear(0, 1, 0, 0, [
        [0, '#4a5058'],
        [0.4, '#4a5058'],
        [1, '#14181d'],
      ]);
    default:
      return linear(0, 0, 0, 1, [
        [0, '#d9dee4'],
        [1, '#8c96a2'],
      ]);
  }
}

/**
 * Fills the path with a gradient in SVG objectBoundingBox units: the path clips a unit square mapped onto the box.
 * Without a known box the gradient falls back to its base color.
 */
function fillGradient(ctx: OffscreenCanvasRenderingContext2D, path: Path2D, box: Box | undefined, fill: Extract<ResolvedFill, { kind: 'grad' }>): void {
  if (box === undefined || box[2] <= 0 || box[3] <= 0) {
    ctx.fillStyle = fill.c;
    ctx.fill(path);
    return;
  }
  ctx.save();
  ctx.clip(path);
  ctx.translate(box[0], box[1]);
  ctx.scale(box[2], box[3]);
  ctx.fillStyle = unitGradient(ctx, fill.g, fill.c, fill.a);
  ctx.fillRect(0, 0, 1, 1);
  ctx.restore();
}

function paintFill(ctx: OffscreenCanvasRenderingContext2D, path: Path2D, box: Box | undefined, fill: NonNullable<ResolvedFill>, patterns: Patterns): void {
  switch (fill.kind) {
    case 'color':
      ctx.fillStyle = fill.color;
      ctx.fill(path);
      return;
    case 'grad':
      fillGradient(ctx, path, box, fill);
      return;
    case 'pat': {
      const pattern = patterns[fill.pat];
      if (pattern === null) return;
      ctx.fillStyle = pattern;
      ctx.fill(path);
    }
  }
}

function opacityOf(op: FixtureOp): number {
  return 'o' in op && op.o !== undefined ? op.o : 1;
}

/** Local frame of an ellipse: its rotation turns the shape about its center. */
function applyLocalFrame(ctx: OffscreenCanvasRenderingContext2D, op: FixtureOp): void {
  if (op.k !== 'e' || op.rot === undefined || op.rot === 0) return;
  ctx.translate(op.x, op.y);
  ctx.rotate(op.rot * DEG);
  ctx.translate(-op.x, -op.y);
}

function drawText(ctx: OffscreenCanvasRenderingContext2D, op: Extract<FixtureOp, { k: 't' }>): void {
  ctx.save();
  ctx.translate(op.x, op.y);
  ctx.rotate((op.rot ?? 0) * DEG);
  ctx.font = `bold ${op.size}px sans-serif`;
  ctx.textAlign = op.anchor === 'start' ? 'left' : op.anchor === 'end' ? 'right' : 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = op.f;
  ctx.fillText(op.s, 0, 0);
  ctx.restore();
}

function drawPlanned(ctx: OffscreenCanvasRenderingContext2D, planned: PlannedOp, ppm: number, patterns: Patterns): void {
  const op = planned.op;
  if (op.k === 'air') return;
  if (op.k === 't') {
    drawText(ctx, op);
    return;
  }
  const path = opPath(op);
  if (path === undefined) return;

  ctx.save();
  applyLocalFrame(ctx, op);
  ctx.globalAlpha = opacityOf(op);
  if (planned.fill !== null) paintFill(ctx, path, opBox(op), planned.fill, patterns);
  if (planned.stroke !== null && planned.strokeM !== null) {
    ctx.strokeStyle = planned.stroke;
    ctx.lineWidth = planned.strokeM;
    ctx.lineCap = op.k === 'l' && op.cap === 'butt' ? 'butt' : 'round';
    ctx.lineJoin = 'round';
    const dash = 'dash' in op ? op.dash : undefined;
    const dashPx = 'dashPx' in op && op.dashPx === 1;
    ctx.setLineDash(dash === undefined ? [] : dash.map((d) => (dashPx ? d / ppm : d)));
    ctx.stroke(path);
  }
  ctx.restore();
}

/** Shadows are unioned on a second canvas, blurred onto the sprite and drawn under the body. */
function drawShadows(ctx: OffscreenCanvasRenderingContext2D, shadows: readonly Pt[][], ppm: number, padM: number): void {
  if (shadows.length === 0) return;
  const layer = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
  const layerCtx = layer.getContext('2d');
  if (layerCtx === null) return;
  applyBaseFrame(layerCtx, ppm, padM);
  layerCtx.fillStyle = '#000000';
  for (const pts of shadows) {
    layerCtx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? layerCtx.moveTo(x, y) : layerCtx.lineTo(x, y)));
    layerCtx.closePath();
    layerCtx.fill();
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = SHADOW_ALPHA;
  ctx.filter = `blur(${SHADOW_BLUR_M * ppm}px)`;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/** Sprite meters: origin shifted by the pad, scaled by ppm pixels per meter. */
function applyBaseFrame(ctx: OffscreenCanvasRenderingContext2D, ppm: number, padM: number): void {
  ctx.setTransform(ppm, 0, 0, ppm, padM * ppm, padM * ppm);
}

/**
 * Bakes a kit asset at a zoom tier, placement rotation, pixels per meter and optional livery color. Returns null
 * when the asset's pack is not loaded. Results are cached per key.
 */
export function bakeFixture(assetId: string, tier: Tier, rot: Rot, ppm: number, livery: string | null): FixtureSprite | null {
  const key = `${assetId}|${tier}|${rot}|${ppm}|${livery ?? ''}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const asset = kitAsset(assetId);
  if (asset === undefined) return null;
  const [wM, hM] = asset.size;
  const padM = SPRITE_PAD_M;
  const canvas = new OffscreenCanvas(Math.ceil((wM + 2 * padM) * ppm), Math.ceil((hM + 2 * padM) * ppm));
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  const plan = planFixture(asset.ops, tier, rot, ppm, livery);
  applyBaseFrame(ctx, ppm, padM);
  const patterns = patternsFor(ppm);
  for (const planned of plan.floor) drawPlanned(ctx, planned, ppm, patterns);
  drawShadows(ctx, plan.shadows, ppm, padM);
  for (const planned of plan.body) drawPlanned(ctx, planned, ppm, patterns);
  for (const planned of plan.over) drawPlanned(ctx, planned, ppm, patterns);

  const sprite: FixtureSprite = { canvas, wM, hM, padM };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, sprite);
  return sprite;
}

/** Draws a baked sprite centered at cx, cy in meters, turned by rot degrees. */
export function drawFixture(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  s: FixtureSprite,
  cx: number,
  cy: number,
  rot: Rot,
): void {
  const w = s.wM + 2 * s.padM;
  const h = s.hM + 2 * s.padM;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot * DEG);
  ctx.drawImage(s.canvas, -w / 2, -h / 2, w, h);
  ctx.restore();
}
