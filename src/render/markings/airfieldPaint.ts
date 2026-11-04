import { AIRFIELD } from '@data/index';
import { compassVector, type AirfieldPayload, type Runway, type Stand, type Surface, type Taxiway } from '@shared/airfield';
import { closestOnSegment, distToSegment, pointInPolygon } from '@shared/geom';
import { FLOOR, TERMINAL_CELL_M, TERMINAL_GRID, WALL, type TerminalGrid } from '@shared/business';
import { worldToCell } from '@shared/terminalOps';
import { CHUNK_SIZE_M } from '@shared/math';
import { BAND_RASTER_SCALE } from '../chunks';

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

  for (const t of af.taxiways) paintTaxiwayPavement(ctx, t, win);
  for (const r of af.runways) paintRunwayPavement(ctx, r, win);
  for (const t of af.taxiways) paintTaxiwayMarks(ctx, t, win, af);
  for (const h of af.holding) {
    if (!overlaps(win, h.x - 30, h.y - 30, h.x + 30, h.y + 30)) continue;
    const t = af.taxiways.find((x) => x.id === h.taxiwayId);
    if (t) paintHoldingMark(ctx, t, h.x, h.y, win);
  }
  for (const r of af.runways) paintRunwayMarks(ctx, r, win);
  for (const g of terminals) paintTerminal(ctx, g, win);
  for (const s of af.stands) {
    if (overlaps(win, s.x - 100, s.y - 100, s.x + 100, s.y + 100)) paintStand(ctx, s, win);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function runwayBounds(r: Runway): [number, number, number, number] {
  const m = r.widthM / 2 + r.shoulderM + 2;
  return [Math.min(r.x1, r.x2) - m, Math.min(r.y1, r.y2) - m, Math.max(r.x1, r.x2) + m, Math.max(r.y1, r.y2) + m];
}

function paintTaxiwayPavement(ctx: Ctx, t: Taxiway, win: Window): void {
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
  if (!overlaps(win, minX - t.widthM, minY - t.widthM, maxX + t.widthM, maxY + t.widthM)) return;
  ctx.strokeStyle = PAVEMENT[t.surface];
  ctx.lineWidth = t.widthM;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(t.points[0].x, t.points[0].y);
  for (let i = 1; i < t.points.length; i++) ctx.lineTo(t.points[i].x, t.points[i].y);
  ctx.stroke();
}

/** Offsets a polyline sideways with mitred corners, so edge lines stay continuous through turns. */
function offsetPolyline(pts: readonly { x: number; y: number }[], d: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    let nx0 = 0;
    let ny0 = 0;
    let nx1 = 0;
    let ny1 = 0;
    if (i > 0) {
      const l = Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) || 1;
      nx0 = -(p.y - pts[i - 1].y) / l;
      ny0 = (p.x - pts[i - 1].x) / l;
    }
    if (i < n - 1) {
      const l = Math.hypot(pts[i + 1].x - p.x, pts[i + 1].y - p.y) || 1;
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

type Excluder = (x: number, y: number) => boolean;

/** Samples a polyline and returns the stretches that fall inside the window and outside excluded areas. */
function visibleRuns(pts: readonly { x: number; y: number }[], step: number, win: Window, excluded: Excluder): { x: number; y: number }[][] {
  const runs: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] | null = null;
  const take = (x: number, y: number): void => {
    const inside = x >= win.minX && x <= win.maxX && y >= win.minY && y <= win.maxY && !excluded(x, y);
    if (inside) {
      if (!cur) {
        cur = [];
        runs.push(cur);
      }
      cur.push({ x, y });
    } else {
      cur = null;
    }
  };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    // Skip whole segments far from the window.
    if (Math.max(a.x, b.x) < win.minX || Math.min(a.x, b.x) > win.maxX || Math.max(a.y, b.y) < win.minY || Math.min(a.y, b.y) > win.maxY) {
      cur = null;
      continue;
    }
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) take(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n);
  }
  return runs;
}

function strokeRuns(ctx: Ctx, runs: { x: number; y: number }[][]): void {
  ctx.beginPath();
  for (const run of runs) {
    if (run.length < 2) continue;
    ctx.moveTo(run[0].x, run[0].y);
    for (let i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y);
  }
  ctx.stroke();
}

function insideRunway(r: Runway, x: number, y: number, margin: number): boolean {
  const c = { x: 0, y: 0, t: 0 };
  closestOnSegment(x, y, r.x1, r.y1, r.x2, r.y2, c);
  return Math.hypot(x - c.x, y - c.y) <= r.widthM / 2 + r.shoulderM + margin;
}

function paintTaxiwayMarks(ctx: Ctx, t: Taxiway, win: Window, af: AirfieldPayload): void {
  if (!isPaved(t.surface)) return;
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
  if (!overlaps(win, minX - t.widthM, minY - t.widthM, maxX + t.widthM, maxY + t.widthM)) return;
  const step = Math.max(0.5, 1.2 / win.scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  const onRunway: Excluder = (x, y) => {
    for (const r of af.runways) if (insideRunway(r, x, y, 0.3)) return true;
    return false;
  };
  // The centerline is one continuous line along the whole taxiway, cut only where it would enter a runway.
  ctx.strokeStyle = t.closed ? RED : YELLOW;
  ctx.lineWidth = lineM(win, 0.3);
  strokeRuns(ctx, visibleRuns(t.points, step, win, onRunway));

  if (win.scale >= 1 && t.kind !== 'taxilane') {
    // Edge lines stop where another pavement opens up: junctions, runways and aprons.
    const others = af.taxiways.filter((o) => o.id !== t.id);
    const inOther: Excluder = (x, y) => {
      if (onRunway(x, y)) return true;
      for (const o of others) {
        const reach = o.widthM / 2 + 0.25;
        for (let i = 1; i < o.points.length; i++) {
          const a = o.points[i - 1];
          const b = o.points[i];
          if (x < Math.min(a.x, b.x) - reach || x > Math.max(a.x, b.x) + reach || y < Math.min(a.y, b.y) - reach || y > Math.max(a.y, b.y) + reach) continue;
          // Only the strip beside the centerline counts, not the rounded end of a stub that stops at this taxiway.
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len2 = dx * dx + dy * dy || 1;
          const along = ((x - a.x) * dx + (y - a.y) * dy) / len2;
          if (along < 0 || along > 1) continue;
          if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= reach) return true;
        }
      }
      for (const ap of af.aprons) if (pointInPolygon(x, y, ap.polygon)) return true;
      return false;
    };
    ctx.lineWidth = lineM(win, 0.15);
    ctx.strokeStyle = YELLOW;
    for (const side of [-1, 1]) strokeRuns(ctx, visibleRuns(offsetPolyline(t.points, side * (t.widthM / 2 - 0.6)), step, win, inOther));
  }
  if (t.oneWay && win.scale >= 0.25) {
    // Small arrowheads along one way taxiways.
    ctx.fillStyle = YELLOW;
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1];
      const b = t.points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const dx = (b.x - a.x) / len;
      const dy = (b.y - a.y) / len;
      for (let d = 40; d < len - 20; d += 120) {
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

function paintHoldingMark(ctx: Ctx, t: Taxiway, x: number, y: number, win: Window): void {
  if (!isPaved(t.surface)) return;
  const c = { x: 0, y: 0, t: 0 };
  let best = Infinity;
  let dx = 1;
  let dy = 0;
  for (let i = 1; i < t.points.length; i++) {
    closestOnSegment(x, y, t.points[i - 1].x, t.points[i - 1].y, t.points[i].x, t.points[i].y, c);
    const d = Math.hypot(x - c.x, y - c.y);
    if (d < best) {
      best = d;
      const len = Math.hypot(t.points[i].x - t.points[i - 1].x, t.points[i].y - t.points[i - 1].y) || 1;
      dx = (t.points[i].x - t.points[i - 1].x) / len;
      dy = (t.points[i].y - t.points[i - 1].y) / len;
    }
  }
  const half = t.widthM / 2 - 0.4;
  ctx.strokeStyle = YELLOW;
  ctx.lineWidth = lineM(win, 0.15);
  for (let k = 0; k < 4; k++) {
    const off = (k - 1.5) * 0.9;
    const px = x + dx * off;
    const py = y + dy * off;
    ctx.setLineDash(k < 2 ? [] : [1.5, 1.5]);
    ctx.beginPath();
    ctx.moveTo(px - dy * half, py + dx * half);
    ctx.lineTo(px + dy * half, py - dx * half);
    ctx.stroke();
  }
  ctx.setLineDash([]);
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

function paintRunwayMarks(ctx: Ctx, r: Runway, win: Window): void {
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
  // Edge lines.
  const edgeW = lineM(win, 0.9);
  ctx.fillRect(0, -half + 0.6, L, edgeW);
  ctx.fillRect(0, half - 0.6 - edgeW, L, edgeW);
  // Centerline dashes.
  const cw = lineM(win, 0.9);
  for (let x = 90; x + 30 <= L - 90; x += 50) ctx.fillRect(x, -cw / 2, 30, cw);
  for (const end of [0, 1]) {
    ctx.save();
    if (end === 1) {
      ctx.translate(L, 0);
      ctx.rotate(Math.PI);
    }
    paintRunwayEnd(ctx, r, end === 0 ? r.nameA : r.nameB, win);
    ctx.restore();
  }
  ctx.restore();
}

/** Paints one end in end local coordinates, x pointing inward from the threshold. */
function paintRunwayEnd(ctx: Ctx, r: Runway, name: string, win: Window): void {
  const half = r.widthM / 2;
  const n = THRESHOLD_STRIPES[r.widthM] ?? 8;
  const usable = r.widthM - 6;
  const pitch = usable / n;
  for (let i = 0; i < n; i++) {
    const y = -usable / 2 + pitch * (i + 0.5) - 0.9;
    ctx.fillRect(6, y, 30, Math.max(1.8, 0.9 / win.scale));
  }
  // Designator: number on top of the letter, readable on approach.
  const digits = name.slice(0, 2);
  const letter = name.slice(2);
  const size = 12.5;
  ctx.save();
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(50, 0);
  ctx.rotate(Math.PI / 2);
  ctx.fillText(digits, 0, 0);
  if (letter) ctx.fillText(letter, 0, size * 1.05);
  ctx.restore();
  // Aiming point and touchdown zone marks on instrument runways.
  if (r.approach !== 'visual' && r.lengthM >= 1200) {
    const aim = r.lengthM >= 1500 ? 300 : 250;
    const off = Math.min(12, half - 5);
    for (const side of [-1, 1]) ctx.fillRect(aim, side * off - 3, 45, 6);
    if (r.approach === 'precision') {
      for (let k = 0; k < 3; k++) {
        const x = aim + 150 * (k + 1);
        if (x + 22 > r.lengthM / 2) break;
        for (const side of [-1, 1]) {
          ctx.fillRect(x, side * (off - 4) - 1.5, 22.5, 3);
          ctx.fillRect(x, side * (off + 4) - 1.5, 22.5, 3);
        }
      }
    }
  }
  void half;
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
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = lineM(win, 0.2);
    ctx.beginPath();
    ctx.moveTo(-row.standLengthM - 20, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();
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

const FLOOR_COLOR = ['', '#a9aeb3', '#d3dadd', '#7f90a8'];
const FIXTURE_COLOR = ['', '#3f7fd8', '#e08a2e', '#8b95a0', '#3aa89a', '#9a5cc8', '#d85c5c', '#e0a030', '#b87a4a', '#c8a8e8', '#5aa860', '#4ab0b8'];
const FIXTURE_LETTER = ['', 'C', 'S', 'B', '', 'WC', 'Sh', 'F', 'Cf', 'DF', 'Bk', 'Rx'];

/** Draws one terminal building as a cutaway: floors, walls, doors and fixtures. */
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
  // Fixtures.
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
