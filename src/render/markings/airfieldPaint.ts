import { AIRFIELD } from '@data/index';
import { compassVector, type AirfieldPayload, type Runway, type Stand, type Surface, type Taxiway } from '@shared/airfield';
import { closestOnSegment } from '@shared/geom';
import { terminalPolygon, type Terminal } from '@shared/business';
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
export function paintAirfield(ctx: Ctx, af: AirfieldPayload, terminals: readonly Terminal[], band: number, cx: number, cy: number): void {
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
  for (const t of af.taxiways) paintTaxiwayMarks(ctx, t, win);
  for (const h of af.holding) {
    if (!overlaps(win, h.x - 30, h.y - 30, h.x + 30, h.y + 30)) continue;
    const t = af.taxiways.find((x) => x.id === h.taxiwayId);
    if (t) paintHoldingMark(ctx, t, h.x, h.y, win);
  }
  for (const r of af.runways) paintRunwayMarks(ctx, r, win);
  for (const t of terminals) paintTerminal(ctx, t, win);
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

function paintTaxiwayMarks(ctx: Ctx, t: Taxiway, win: Window): void {
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
  ctx.lineJoin = 'round';
  ctx.strokeStyle = t.closed ? RED : YELLOW;
  ctx.lineWidth = lineM(win, 0.3);
  ctx.beginPath();
  ctx.moveTo(t.points[0].x, t.points[0].y);
  for (let i = 1; i < t.points.length; i++) ctx.lineTo(t.points[i].x, t.points[i].y);
  ctx.stroke();
  if (win.scale >= 1 && t.kind !== 'taxilane') {
    // Edge lines, offset from the centerline.
    ctx.lineWidth = lineM(win, 0.15);
    ctx.strokeStyle = YELLOW;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let i = 1; i < t.points.length; i++) {
        const a = t.points[i - 1];
        const b = t.points[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = (-(b.y - a.y) / len) * side * (t.widthM / 2 - 0.6);
        const ny = ((b.x - a.x) / len) * side * (t.widthM / 2 - 0.6);
        ctx.moveTo(a.x + nx, a.y + ny);
        ctx.lineTo(b.x + nx, b.y + ny);
      }
      ctx.stroke();
    }
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

function paintTerminal(ctx: Ctx, t: Terminal, win: Window): void {
  const poly = terminalPolygon(t);
  const r = Math.max(t.w, t.d) / 2 + 4;
  if (!overlaps(win, t.cx - r, t.cy - r, t.cx + r, t.cy + r)) return;
  // Soft shadow, roof, rim and a glazed strip along the long side.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.moveTo(poly[0].x + 3, poly[0].y + 3);
  for (let i = 1; i < 4; i++) ctx.lineTo(poly[i].x + 3, poly[i].y + 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#9aa7b3';
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5c6872';
  ctx.lineWidth = lineM(win, 0.8);
  ctx.stroke();
  ctx.save();
  ctx.translate(t.cx, t.cy);
  ctx.rotate((t.headingDeg * Math.PI) / 180 - Math.PI / 2);
  ctx.fillStyle = '#6f8fa8';
  ctx.fillRect(-t.w / 2 + 2, -t.d / 2 + 1.5, t.w - 4, 3);
  ctx.fillStyle = '#c4ccd3';
  for (let x = -t.w / 2 + 8; x < t.w / 2 - 8; x += 14) ctx.fillRect(x, -t.d / 2 + 8, 8, t.d - 16);
  if (win.scale >= 0.25) {
    ctx.fillStyle = '#2a3844';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`T${t.id}`, 0, 0);
  }
  ctx.restore();
}
