import { AIRFIELD } from '@data/index';
import { compassVector, type AirfieldPayload, type Runway, type Stand, type Surface, type Taxiway } from '@shared/airfield';

import { FLOOR, TERMINAL_CELL_M, TERMINAL_GRID, WALL, type TerminalGrid } from '@shared/business';
import { worldToCell } from '@shared/terminalOps';
import { CHUNK_SIZE_M } from '@shared/math';
import { BAND_RASTER_SCALE } from '../chunks';
import type { GhostPreview } from '@shared/ghost';
import { planFor, type HoldMark, type Line, type Plan } from './taxiPlan';

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

const PAVEMENT: Record<Surface, string> = {
  asphalt: '#4a4c52',
  concrete: '#a8a8a2',
  grass: '#86a85e',
  gravel: '#a39b8b',
  dirt: '#8a6f4d',
};
const SHOULDER: Record<Surface, string> = {
  asphalt: '#5d5f64',
  concrete: '#bdbdb7',
  grass: '#86a85e',
  gravel: '#a39b8b',
  dirt: '#8a6f4d',
};
const WHITE = '#f1f1ec';
const YELLOW = '#f2c318';
const RED = '#d8362f';
const THRESHOLD_STRIPES: Record<number, number> = { 18: 4, 23: 6, 30: 8, 45: 12, 60: 16 };

const isPaved = (s: Surface): boolean => s === 'asphalt' || s === 'concrete';

interface Window {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  scale: number;
}

const overlaps = (w: Window, minX: number, minY: number, maxX: number, maxY: number): boolean =>
  maxX >= w.minX && minX <= w.maxX && maxY >= w.minY && minY <= w.maxY;

/** A line width that never falls below one device pixel at the bake scale. */
const lineM = (w: Window, meters: number): number => Math.max(meters, 0.9 / w.scale);

/** Paints the airfield pavement and markings of one chunk into its canvas context. */
export function paintAirfield(ctx: Ctx, af: AirfieldPayload, terminals: readonly TerminalGrid[], band: number, cx: number, cy: number): void {
  if (af.runways.length === 0 && af.taxiways.length === 0 && af.aprons.length === 0 && af.stands.length === 0 && terminals.length === 0) return;
  const scale = BAND_RASTER_SCALE[band];
  const ox = cx * CHUNK_SIZE_M;
  const oy = cy * CHUNK_SIZE_M;
  const pad = 120;
  const win: Window = { minX: ox - pad, minY: oy - pad, maxX: ox + CHUNK_SIZE_M + pad, maxY: oy + CHUNK_SIZE_M + pad, scale };
  ctx.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);

  paintGroundContact(ctx, af, terminals, win);

  for (const a of af.aprons) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of a.polygon) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (!overlaps(win, minX, minY, maxX, maxY)) continue;
    ctx.fillStyle = PAVEMENT[a.surface];
    ctx.beginPath();
    ctx.moveTo(a.polygon[0].x, a.polygon[0].y);
    for (let i = 1; i < a.polygon.length; i++) ctx.lineTo(a.polygon[i].x, a.polygon[i].y);
    ctx.closePath();
    ctx.fill();
  }

  const plan = planFor(af);
  for (const t of af.taxiways) paintTaxiwayPavement(ctx, t, win, plan);
  for (const r of af.runways) paintRunwayPavement(ctx, r, win);
  paintTaxiPlan(ctx, af, plan, win);
  for (const h of plan.holds) paintHold(ctx, h, win);
  for (const r of af.runways) paintRunwayMarks(ctx, r, win, plan);
  for (const g of terminals) paintTerminal(ctx, g, win);
  for (const s of af.stands) {
    if (overlaps(win, s.x - 100, s.y - 100, s.x + 100, s.y + 100)) paintStand(ctx, s, win);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * Seats everything on the ground. All of this is baked into the static chunk, so it costs
 * nothing per frame: a cleared, packed earth margin around pavement and building pads, and a
 * few stacked translucent strips that darken toward the edge like ambient occlusion.
 */
function paintGroundContact(ctx: Ctx, af: AirfieldPayload, terminals: readonly TerminalGrid[], win: Window): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const soil = (alpha: number): string => `rgba(74,62,44,${alpha})`;
  for (const a of af.aprons) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of a.polygon) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (!overlaps(win, minX - 8, minY - 8, maxX + 8, maxY + 8)) continue;
    ctx.beginPath();
    ctx.moveTo(a.polygon[0].x, a.polygon[0].y);
    for (let i = 1; i < a.polygon.length; i++) ctx.lineTo(a.polygon[i].x, a.polygon[i].y);
    ctx.closePath();
    for (const [w, al] of [[9, 0.1], [6, 0.12], [3.2, 0.16]] as const) {
      ctx.strokeStyle = soil(al);
      ctx.lineWidth = w * 2;
      ctx.stroke();
    }
  }
  for (const t of af.taxiways) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of t.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (!overlaps(win, minX - t.widthM, minY - t.widthM, maxX + t.widthM, maxY + t.widthM)) continue;
    ctx.beginPath();
    ctx.moveTo(t.points[0].x, t.points[0].y);
    for (let i = 1; i < t.points.length; i++) ctx.lineTo(t.points[i].x, t.points[i].y);
    for (const [grow, al] of [[9, 0.09], [5.5, 0.12], [2.4, 0.16]] as const) {
      ctx.strokeStyle = soil(al);
      ctx.lineWidth = t.widthM + grow;
      ctx.stroke();
    }
  }
  for (const r of af.runways) {
    const b = runwayBounds(r);
    if (!overlaps(win, b[0], b[1], b[2], b[3])) continue;
    ctx.save();
    ctx.translate(r.x1, r.y1);
    ctx.rotate((r.headingDeg * Math.PI) / 180 - Math.PI / 2);
    const half = r.widthM / 2 + r.shoulderM;
    for (const [grow, al] of [[9, 0.09], [5.5, 0.12], [2.4, 0.16]] as const) {
      ctx.fillStyle = soil(al);
      ctx.fillRect(-grow, -half - grow, r.lengthM + 2 * grow, 2 * (half + grow));
    }
    ctx.restore();
  }
  void terminals;
}

function runwayBounds(r: Runway): [number, number, number, number] {
  const m = r.widthM / 2 + r.shoulderM + 2;
  return [Math.min(r.x1, r.x2) - m, Math.min(r.y1, r.y2) - m, Math.max(r.x1, r.x2) + m, Math.max(r.y1, r.y2) + m];
}

function paintTaxiwayPavement(ctx: Ctx, t: Taxiway, win: Window, plan: Plan): void {
  const pts = plan.smooth.get(t.id) ?? t.points;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!overlaps(win, minX - t.widthM, minY - t.widthM, maxX + t.widthM, maxY + t.widthM)) return;
  ctx.strokeStyle = PAVEMENT[t.surface];
  ctx.lineWidth = t.widthM;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function drawLines(ctx: Ctx, lines: readonly Line[], win: Window): void {
  ctx.beginPath();
  for (const l of lines) {
    if (!overlaps(win, l.minX, l.minY, l.maxX, l.maxY)) continue;
    ctx.moveTo(l.pts[0].x, l.pts[0].y);
    for (let i = 1; i < l.pts.length; i++) ctx.lineTo(l.pts[i].x, l.pts[i].y);
  }
  ctx.stroke();
}

/** Taxiway paint from the plan: fillets, centerlines with lead-on curves, double edge lines, enhanced centerlines. */
function paintTaxiPlan(ctx: Ctx, af: AirfieldPayload, plan: Plan, win: Window): void {
  const surface = af.taxiways[0]?.surface ?? 'asphalt';
  ctx.fillStyle = PAVEMENT[surface];
  for (const patch of plan.patches) {
    const first = patch[0];
    if (!overlaps(win, first.x - 80, first.y - 80, first.x + 80, first.y + 80)) continue;
    ctx.beginPath();
    ctx.moveTo(patch[0].x, patch[0].y);
    for (let i = 1; i < patch.length; i++) ctx.lineTo(patch[i].x, patch[i].y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.strokeStyle = YELLOW;
  ctx.lineWidth = lineM(win, 0.3);
  drawLines(ctx, plan.centerlines, win);
  drawLines(ctx, plan.leadIns, win);
  ctx.strokeStyle = RED;
  drawLines(ctx, plan.redCenterlines, win);
  if (win.scale >= 1) {
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = lineM(win, 0.15);
    drawLines(ctx, plan.edges, win);
    ctx.lineWidth = lineM(win, 0.18);
    ctx.setLineDash([1.2, 1.2]);
    drawLines(ctx, plan.enhanced, win);
    ctx.setLineDash([]);
  }
  for (const t of af.taxiways) {
    if (!t.oneWay || win.scale < 0.25) continue;
    const pts = plan.smooth.get(t.id) ?? t.points;
    ctx.fillStyle = YELLOW;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l < 60) continue;
      const dx = (b.x - a.x) / l;
      const dy = (b.y - a.y) / l;
      if (!overlaps(win, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) continue;
      for (let d = 40; d < l - 20; d += 120) {
        const px = a.x + dx * d;
        const py = a.y + dy * d;
        ctx.beginPath();
        ctx.moveTo(px + dx * 5, py + dy * 5);
        ctx.lineTo(px - dx * 3 - dy * 3, py - dy * 3 + dx * 3);
        ctx.lineTo(px - dx * 3 + dy * 3, py - dy * 3 - dx * 3);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

/**
 * Runway holding position: four yellow lines across the taxiway, two solid on the side where
 * aircraft hold and two dashed on the runway side (ICAO pattern A), with the surface painted
 * signs: white on red for the runway, yellow on black for the taxiway.
 */
function paintHold(ctx: Ctx, h: HoldMark, win: Window): void {
  if (!overlaps(win, h.x - 30, h.y - 30, h.x + 30, h.y + 30)) return;
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(Math.atan2(h.dy, h.dx));
  // Local frame: +x toward the runway, +y to the right of travel.
  const half = h.widthM / 2 - 0.3;
  const lw = lineM(win, 0.15);
  ctx.strokeStyle = YELLOW;
  ctx.lineWidth = lw;
  const rows: [number, boolean][] = [[-0.675, true], [-0.225, true], [0.225, false], [0.675, false]];
  for (const [x, solid] of rows) {
    ctx.setLineDash(solid ? [] : [1.2, 1.2]);
    ctx.beginPath();
    ctx.moveTo(x, -half);
    ctx.lineTo(x, half);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (win.scale >= 1) {
    const sign = (cy: number, fill: string, text: string, color: string): void => {
      ctx.fillStyle = fill;
      ctx.fillRect(-12, cy - 1.5, 7, 3);
      ctx.fillStyle = color;
      ctx.font = 'bold 2.2px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.translate(-8.5, cy);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    sign(-half * 0.45, '#c82a24', h.runwayName, '#fff');
    sign(half * 0.45, '#151515', h.taxiName, YELLOW);
  }
  ctx.restore();
}

function paintRunwayPavement(ctx: Ctx, r: Runway, win: Window): void {
  const b = runwayBounds(r);
  if (!overlaps(win, b[0], b[1], b[2], b[3])) return;
  ctx.save();
  ctx.translate(r.x1, r.y1);
  ctx.rotate((r.headingDeg * Math.PI) / 180 - Math.PI / 2);
  const half = r.widthM / 2;
  if (r.shoulderM > 0) {
    ctx.fillStyle = SHOULDER[r.surface];
    ctx.fillRect(0, -half - r.shoulderM, r.lengthM, r.widthM + 2 * r.shoulderM);
  }
  ctx.fillStyle = PAVEMENT[r.surface];
  ctx.fillRect(0, -half, r.lengthM, r.widthM);
  ctx.restore();
}

const DIGITS: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', L: 'fed', R: 'abfegc', C: 'afed' };

/** Block stencil numeral or letter, centred on the origin with its top toward -y. */
function stencil(ctx: Ctx, ch: string, cx: number, cy: number): void {
  const w = 4;
  const h = 9;
  const st = 1.15;
  const seg = DIGITS[ch];
  if (!seg) return;
  const rects: Record<string, [number, number, number, number]> = {
    a: [-w / 2, -h / 2, w, st],
    b: [w / 2 - st, -h / 2, st, h / 2],
    c: [w / 2 - st, 0, st, h / 2],
    d: [-w / 2, h / 2 - st, w, st],
    e: [-w / 2, 0, st, h / 2],
    f: [-w / 2, -h / 2, st, h / 2],
    g: [-w / 2, -st / 2, w, st],
  };
  for (const k of seg) {
    const r = rects[k];
    ctx.fillRect(cx + r[0], cy + r[1], r[2], r[3]);
  }
}

/** Pairs of touchdown zone marks by usable length (ICAO Annex 14). */
function tdzPairs(length: number): number {
  return length < 900 ? 1 : length < 1200 ? 2 : length < 1500 ? 3 : length < 2400 ? 4 : 6;
}

function aimingDistance(length: number): number {
  return length >= 2400 ? 300 : length >= 1500 ? 250 : length >= 1200 ? 200 : 150;
}

function paintRunwayMarks(ctx: Ctx, r: Runway, win: Window, plan: Plan): void {
  const b = runwayBounds(r);
  if (!overlaps(win, b[0], b[1], b[2], b[3])) return;
  ctx.save();
  ctx.translate(r.x1, r.y1);
  ctx.rotate((r.headingDeg * Math.PI) / 180 - Math.PI / 2);
  const half = r.widthM / 2;
  const L = r.lengthM;
  if (!isPaved(r.surface)) {
    // Unpaved runways get edge markers instead of paint.
    ctx.fillStyle = WHITE;
    for (let x = 0; x <= L; x += 25) {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x, side * (half + 1), Math.max(0.5, 0.9 / win.scale), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    return;
  }
  ctx.fillStyle = WHITE;
  // Edge stripes, continuous except where a taxiway opens onto the runway.
  const edgeW = lineM(win, 0.9);
  const breaks = (plan.runwayBreaks.get(r.id) ?? []).slice().sort((p, q) => p[0] - q[0]);
  for (const side of [-1, 1]) {
    let x = 0;
    for (const [s0, s1, bs] of breaks) {
      if (bs !== side) continue;
      if (s0 > x) ctx.fillRect(x, side * (half - 0.6) - (side > 0 ? edgeW : 0), Math.min(s0, L) - x, edgeW);
      x = Math.max(x, s1);
    }
    if (x < L) ctx.fillRect(x, side * (half - 0.6) - (side > 0 ? edgeW : 0), L - x, edgeW);
  }
  const instrument = r.approach !== 'visual';
  const precision = r.approach === 'precision';
  const name = [r.nameA, r.nameB];
  // Centerline: 30 m stripes with 20 m gaps, centred between the two designators.
  const cw = lineM(win, r.widthM >= 30 ? 0.9 : 0.45);
  const first = 72;
  const span = L - 2 * first;
  if (span > 30) {
    const n = Math.floor((span + 20) / 50);
    const used = n * 50 - 20;
    const startX = first + (span - used) / 2;
    for (let i = 0; i < n; i++) ctx.fillRect(startX + i * 50, -cw / 2, 30, cw);
  }
  const aim = aimingDistance(L);
  const inner = r.widthM >= 30 ? 18 : 6;
  for (let end = 0; end < 2; end++) {
    ctx.save();
    if (end === 1) {
      ctx.translate(L, 0);
      ctx.rotate(Math.PI);
    }
    // Threshold stripes: 1.8 m wide, 30 m long, 6 m in, in two symmetric groups.
    if (instrument) {
      const n = THRESHOLD_STRIPES[r.widthM] ?? 8;
      const perSide = n / 2;
      const group = perSide * 1.8 + (perSide - 1) * 1.8;
      const start = half - 1.5 - group;
      for (const side of [-1, 1]) {
        for (let i = 0; i < perSide; i++) {
          const y0 = start + i * 3.6;
          ctx.fillRect(6, side > 0 ? y0 : -y0 - 1.8, 30, Math.max(1.8, 0.9 / win.scale));
        }
      }
    }
    // Designator: numerals with their tops toward the runway centre, a letter below.
    const label = name[end];
    const digits = label.slice(0, 2);
    const letter = label.slice(2);
    ctx.save();
    ctx.translate(instrument ? 56 : 24, 0);
    ctx.rotate(Math.PI / 2);
    for (let i = 0; i < digits.length; i++) stencil(ctx, digits[i], (i - (digits.length - 1) / 2) * 5.6, 0);
    if (letter) stencil(ctx, letter, 0, 12);
    ctx.restore();
    // Aiming point on instrument runways, and on visual ones that are long enough for jets.
    if (instrument || L >= 1200) {
      const off = inner / 2 + 3;
      const bar = aim >= 250 ? 45 : 30;
      for (const side of [-1, 1]) ctx.fillRect(aim, side * off - 3, bar, 6);
    }
    // Touchdown zone: groups of 3, 2 and 1 bars every 150 m, only on precision runways.
    if (precision) {
      const pairs = tdzPairs(L);
      const counts = [3, 3, 2, 2, 1, 1];
      for (let k = 0; k < pairs; k++) {
        const x = 150 * (k + 1);
        if (Math.abs(x - aim) < 60 || x + 22.5 > L / 2) continue;
        for (const side of [-1, 1]) {
          for (let i = 0; i < counts[k]; i++) {
            const y0 = inner / 2 + i * 3.3;
            ctx.fillRect(x, side > 0 ? y0 : -y0 - 1.8, 22.5, Math.max(1.8, 0.9 / win.scale));
          }
        }
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

function paintStand(ctx: Ctx, s: Stand, win: Window): void {
  const row = AIRFIELD.codes[s.code];
  const d = compassVector(s.headingDeg);
  const rot = Math.atan2(d.y, d.x);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(rot);
  // Local frame: +x is the nose direction, +y is to the right.
  const halfSpan = row.spanM / 2;
  const paved = s.surface === 'asphalt' || s.surface === 'concrete';
  if (paved) {
    if (s.type !== 'gaTieDown') {
      ctx.fillStyle = YELLOW;
      ctx.fillRect(-0.4, -3, Math.max(0.8, 1 / win.scale), 6);
    }
  } else {
    ctx.fillStyle = WHITE;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(-row.standLengthM * 0.4, side * halfSpan * 0.9, Math.max(0.4, 0.8 / win.scale), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (s.type !== 'gaTieDown') {
    ctx.strokeStyle = RED;
    ctx.lineWidth = lineM(win, 0.3);
    ctx.strokeRect(-row.standLengthM - 6, -halfSpan - 3, row.standLengthM + 10, row.spanM + 6);
  } else {
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = lineM(win, 0.15);
    ctx.strokeRect(-row.standLengthM - 1, -halfSpan - 0.5, row.standLengthM + 2, row.spanM + 1);
  }
  if (win.scale >= 0.25) {
    ctx.fillStyle = s.type === 'contact' ? '#6fa8ff' : YELLOW;
    ctx.font = 'bold 4.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.rotate(Math.PI / 2);
    ctx.fillText(s.number, 0, -(s.type === 'gaTieDown' ? 2 : 9));
  }
  ctx.restore();
}

/**
 * Draws not yet built objects with the same painting as the finished ones, so a preview shows the
 * real shape: runway with its markings, stands with lead-in curves, stop bars and restraint boxes.
 * The caller sets the world transform and the alpha. `scale` is pixels per meter.
 */
export function paintGhostObjects(ctx: Ctx, af: AirfieldPayload, preview: GhostPreview, scale: number): void {
  const win: Window = { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9, scale };
  if (preview.runway) {
    paintRunwayPavement(ctx, preview.runway, win);
    paintRunwayMarks(ctx, preview.runway, win, planFor(af));
  }
  if (preview.leadIns && preview.leadIns.length > 0) {
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = lineM(win, 0.3);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const l of preview.leadIns) {
      ctx.moveTo(l[0].x, l[0].y);
      for (let i = 1; i < l.length; i++) ctx.lineTo(l[i].x, l[i].y);
    }
    ctx.stroke();
  }
  for (const s of preview.stands ?? []) paintStand(ctx, s, win);
}

const FLOOR_COLOR = ['', '#a9aeb3', '#d3dadd', '#7f90a8'];
const FIXTURE_COLOR = ['', '#3f7fd8', '#e08a2e', '#8b95a0', '#3aa89a', '#9a5cc8', '#d85c5c', '#e0a030', '#b87a4a', '#c8a8e8', '#5aa860', '#4ab0b8'];
const FIXTURE_LETTER = ['', 'C', 'S', 'B', '', 'WC', 'Sh', 'F', 'Cf', 'DF', 'Bk', 'Rx'];

/** Draws one terminal building as a cutaway: floors, walls, doors and fixtures. */
const ZONE_TINT = ['', 'rgba(70,140,230,0.22)', 'rgba(235,170,50,0.26)', 'rgba(70,190,120,0.24)', 'rgba(220,80,80,0.26)'];

function paintTerminal(ctx: Ctx, g: TerminalGrid, win: Window): void {
  const N = TERMINAL_GRID;
  const C = TERMINAL_CELL_M;
  // Cell range under the window.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of [[win.minX, win.minY], [win.maxX, win.minY], [win.maxX, win.maxY], [win.minX, win.maxY]]) {
    const c = worldToCell(g, x, y);
    minX = Math.min(minX, c.cx);
    minY = Math.min(minY, c.cy);
    maxX = Math.max(maxX, c.cx);
    maxY = Math.max(maxY, c.cy);
  }
  const x0 = Math.max(0, Math.floor(minX));
  const y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(N - 1, Math.ceil(maxX));
  const y1 = Math.min(N - 1, Math.ceil(maxY));
  if (x1 < x0 || y1 < y0) return;
  ctx.save();
  ctx.translate(g.ox, g.oy);
  ctx.rotate((g.headingDeg * Math.PI) / 180 - Math.PI / 2);
  // Cleared pad and soft edge darkening so the building looks seated on the ground. Baked into the chunk.
  const filled = (cx: number, cy: number): boolean => cx >= 0 && cy >= 0 && cx < N && cy < N && g.floor[cy * N + cx] > 0;
  for (let cy = y0; cy <= y1; cy++) {
    let runStart = -1;
    for (let cx = x0; cx <= x1 + 1; cx++) {
      const on = cx <= x1 && filled(cx, cy);
      if (on && runStart < 0) runStart = cx;
      if (!on && runStart >= 0) {
        ctx.fillStyle = '#7b7260';
        ctx.fillRect(runStart * C - 2.6, cy * C - 2.6, (cx - runStart) * C + 5.2, C + 5.2);
        runStart = -1;
      }
    }
  }
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (!filled(cx, cy)) continue;
      const px = cx * C;
      const py = cy * C;
      // Strips outside each exposed edge, longer toward the south east, as if lit from the north west.
      for (const [w, al] of [[0.5, 0.2], [1.1, 0.14], [1.8, 0.09]] as const) {
        ctx.fillStyle = `rgba(38,30,20,${al})`;
        if (!filled(cx - 1, cy)) ctx.fillRect(px - w, py, w, C);
        if (!filled(cx, cy - 1)) ctx.fillRect(px, py - w, C, w);
        if (!filled(cx + 1, cy)) ctx.fillRect(px + C, py, w * 1.6, C);
        if (!filled(cx, cy + 1)) ctx.fillRect(px, py + C, C, w * 1.6);
      }
    }
  }
  // Floors, merged along rows.
  let any = false;
  for (let cy = y0; cy <= y1; cy++) {
    let runStart = -1;
    let runType = 0;
    for (let cx = x0; cx <= x1 + 1; cx++) {
      const f = cx <= x1 ? g.floor[cy * N + cx] : 0;
      if (f !== runType) {
        if (runType !== 0) {
          ctx.fillStyle = FLOOR_COLOR[runType];
          ctx.fillRect(runStart * C, cy * C, (cx - runStart) * C, C);
          any = true;
        }
        runStart = cx;
        runType = f;
      }
    }
  }
  if (!any) {
    ctx.restore();
    return;
  }
  // Zone tint, merged along rows: public blue, commercial amber, secure green, staff red.
  for (let cy = y0; cy <= y1; cy++) {
    let runStart = -1;
    let runZone = 0;
    for (let cx = x0; cx <= x1 + 1; cx++) {
      const z = cx <= x1 && g.floor[cy * N + cx] > 0 ? g.zone[cy * N + cx] : 0;
      if (z !== runZone) {
        if (runZone !== 0) {
          ctx.fillStyle = ZONE_TINT[runZone];
          ctx.fillRect(runStart * C, cy * C, (cx - runStart) * C, C);
        }
        runStart = cx;
        runZone = z;
      }
    }
  }
  if (win.scale >= 2) {
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (g.floor[cy * N + cx] === FLOOR.None) continue;
        ctx.rect(cx * C, cy * C, C, C);
      }
    }
    ctx.stroke();
  }
  // A thin lit curb on the north and west edges and a dark one on the south and east.
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (!filled(cx, cy)) continue;
      const px = cx * C;
      const py = cy * C;
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      if (!filled(cx - 1, cy)) ctx.fillRect(px, py, 0.3, C);
      if (!filled(cx, cy - 1)) ctx.fillRect(px, py, C, 0.3);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      if (!filled(cx + 1, cy)) ctx.fillRect(px + C - 0.3, py, 0.3, C);
      if (!filled(cx, cy + 1)) ctx.fillRect(px, py + C - 0.3, C, 0.3);
    }
  }
  // Fixtures.
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const f0 = g.fixture[cy * N + cx];
      if (f0 === 0) continue;
      // A short shadow under each fixture lifts it off the floor in the same cheap way.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(cx * C + 0.45, cy * C + 0.45, C - 0.4, C - 0.4);
    }
  }
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const f = g.fixture[cy * N + cx];
      if (f === 0) continue;
      ctx.fillStyle = FIXTURE_COLOR[f];
      ctx.fillRect(cx * C + 0.2, cy * C + 0.2, C - 0.4, C - 0.4);
      if (f === 4) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(cx * C + 0.5, cy * C + 0.7, C - 1, 0.6);
      } else if (win.scale >= 2 && FIXTURE_LETTER[f]) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 1px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(FIXTURE_LETTER[f], cx * C + C / 2, cy * C + C / 2);
      }
    }
  }
  // Walls, glass and doors on grid lines, merged into runs per type.
  const wallStyle = (t: number): void => {
    ctx.strokeStyle = t === WALL.Wall ? '#37424c' : t === WALL.Glass ? '#79bde8' : '#c58f3a';
    ctx.lineWidth = lineM(win, t === WALL.Wall ? 0.35 : t === WALL.Glass ? 0.22 : 0.3);
  };
  for (const t of [WALL.Wall, WALL.Glass, WALL.Door]) {
    wallStyle(t);
    ctx.beginPath();
    for (let y = y0; y <= y1 + 1 && y <= N; y++) {
      let start = -1;
      for (let x = x0; x <= x1 + 1; x++) {
        const on = x <= x1 && g.hWall[y * N + x] === t;
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          ctx.moveTo(start * C, y * C);
          ctx.lineTo(x * C, y * C);
          start = -1;
        }
      }
    }
    for (let x = x0; x <= x1 + 1 && x <= N; x++) {
      let start = -1;
      for (let y = y0; y <= y1 + 1; y++) {
        const on = y <= y1 && g.vWall[y * (N + 1) + x] === t;
        if (on && start < 0) start = y;
        if (!on && start >= 0) {
          ctx.moveTo(x * C, start * C);
          ctx.lineTo(x * C, y * C);
          start = -1;
        }
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}
