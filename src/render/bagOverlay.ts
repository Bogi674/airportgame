/**
 * The Baggage load overlay (docs/BAGGAGE.md 6.1 and 7.3, T78): under floor links as 0.8 m bands colored by load with
 * chevrons every 1.6 m, solid for departures and hollow for arrivals, still and grey while no bags flow; a buffer ring
 * around every node and a back pressure marker on a full node, with the links into it outlined in the warning color.
 * Drawn in logical cells of one grid: the context transform must map a logical cell to device pixels.
 */

import { BAG_LINK_ARRIVAL, BAG_LINK_FLOW, BAG_NODE_BLOCKED, type BagOverlay } from '@shared/overlay';
import { TERMINAL_CELL_M } from '@shared/business';

export interface BagOverlayColors {
  departure: string;
  arrival: string;
  warning: string;
  low: string;
  mid: string;
  high: string;
  idle: string;
}

/** Band width, chevron spacing and chevron length in cells, from the meter values of the doc. */
const BAND = 0.8 / TERMINAL_CELL_M;
const CHEVRON_STEP = 1.6 / TERMINAL_CELL_M;
const CHEVRON_LEN = 0.3 / TERMINAL_CELL_M;
const EDGE_DASH = 0.1 / TERMINAL_CELL_M;
/** Ring radius and width around a node center, in cells. */
const RING_R = 1.2;
const RING_W = 0.18;
/** Ghost view through the floor (section 7.3). */
const ALPHA = 0.7;
/** Light core of a band, as the reference draws it under the tint. */
const CORE = '#ffffff';
/** Dash patterns, made once so a frame allocates nothing. */
const EDGE_PATTERN = [0.25 / TERMINAL_CELL_M, 0.18 / TERMINAL_CELL_M];
const RING_PATTERN = [0.3, 0.2];
const NO_DASH: number[] = [];
/** Belt speed of the chevron scroll, in cells per real second (0.8 m/s). */
const SCROLL_CELLS_S = 0.8 / TERMINAL_CELL_M;

/** Color of a load in percent: green below 60, amber up to 90, red above. */
export function loadColor(pct: number, c: BagOverlayColors): string {
  return pct < 60 ? c.low : pct <= 90 ? c.mid : c.high;
}

/**
 * 1 for each link whose end point is a blocked node, by the nearest node center to the link's last point. Built once per
 * overlay publish, never per frame.
 */
export function blockedLinks(o: BagOverlay): Uint8Array {
  const n = o.linkLoad.length;
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const last = o.linkStart[k + 1]! - 1;
    if (last < o.linkStart[k]!) continue;
    const x = o.linkPts[2 * last]!;
    const y = o.linkPts[2 * last + 1]!;
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < o.nodeFill.length; j++) {
      const d = (o.nodePos[2 * j]! - x) ** 2 + (o.nodePos[2 * j + 1]! - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best >= 0 && (o.nodeFlags[best]! & BAG_NODE_BLOCKED) !== 0) out[k] = 1;
  }
  return out;
}

export function drawBagOverlay(ctx: CanvasRenderingContext2D, o: BagOverlay, blocked: Uint8Array, c: BagOverlayColors, timeS: number): void {
  ctx.save();
  ctx.globalAlpha = ALPHA;
  ctx.lineJoin = 'round';
  for (let k = 0; k < o.linkLoad.length; k++) {
    const a = o.linkStart[k]!;
    const b = o.linkStart[k + 1]!;
    if (b - a < 2) continue;
    const flow = (o.linkFlags[k]! & BAG_LINK_FLOW) !== 0;
    const arrival = (o.linkFlags[k]! & BAG_LINK_ARRIVAL) !== 0;
    const color = flow ? loadColor(o.linkLoad[k]!, c) : c.idle;
    ctx.beginPath();
    ctx.moveTo(o.linkPts[2 * a]!, o.linkPts[2 * a + 1]!);
    for (let p = a + 1; p < b; p++) ctx.lineTo(o.linkPts[2 * p]!, o.linkPts[2 * p + 1]!);
    // The band of fixtures_baggage.link_band: a dashed rim of EDGE_DASH around a light core tinted with the color.
    const edge = blocked[k] ? c.warning : color;
    ctx.strokeStyle = edge;
    ctx.globalAlpha = ALPHA * 0.9;
    ctx.lineWidth = BAND + 2 * EDGE_DASH;
    ctx.setLineDash(EDGE_PATTERN);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.globalAlpha = ALPHA;
    ctx.strokeStyle = CORE;
    ctx.lineWidth = BAND - 0.5 * EDGE_DASH;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.globalAlpha = ALPHA * 0.32;
    ctx.stroke();
    ctx.globalAlpha = ALPHA;
    drawChevrons(ctx, o, a, b, flow ? (arrival ? c.arrival : c.departure) : c.idle, arrival, flow ? (timeS * SCROLL_CELLS_S) % CHEVRON_STEP : 0);
  }
  for (let j = 0; j < o.nodeFill.length; j++) {
    const x = o.nodePos[2 * j]!;
    const y = o.nodePos[2 * j + 1]!;
    const fill = o.nodeFill[j]!;
    ctx.lineWidth = RING_W;
    ctx.strokeStyle = c.idle;
    ctx.beginPath();
    ctx.arc(x, y, RING_R, 0, 2 * Math.PI);
    ctx.stroke();
    if (fill > 0) {
      ctx.strokeStyle = loadColor(fill, c);
      ctx.beginPath();
      ctx.arc(x, y, RING_R, -Math.PI / 2, -Math.PI / 2 + (2 * Math.PI * Math.min(100, fill)) / 100);
      ctx.stroke();
    }
    if ((o.nodeFlags[j]! & BAG_NODE_BLOCKED) !== 0) {
      // Back pressure: a dashed warning ring just outside the buffer ring.
      ctx.strokeStyle = c.warning;
      ctx.setLineDash(RING_PATTERN);
      ctx.beginPath();
      ctx.arc(x, y, RING_R + RING_W * 2, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
    }
  }
  ctx.restore();
}

/** Chevrons along one link from point a to b - 1, every CHEVRON_STEP cells starting at the scroll offset. */
function drawChevrons(ctx: CanvasRenderingContext2D, o: BagOverlay, a: number, b: number, color: string, hollow: boolean, offset: number): void {
  const half = BAND * 0.32;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = BAND * 0.12;
  let carry = offset;
  for (let p = a; p + 1 < b; p++) {
    const x0 = o.linkPts[2 * p]!;
    const y0 = o.linkPts[2 * p + 1]!;
    const dx = o.linkPts[2 * p + 2]! - x0;
    const dy = o.linkPts[2 * p + 3]! - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uy = dy / len;
    for (let s = carry; s + CHEVRON_LEN <= len; s += CHEVRON_STEP) {
      const tx = x0 + ux * (s + CHEVRON_LEN);
      const ty = y0 + uy * (s + CHEVRON_LEN);
      const bx = x0 + ux * s;
      const by = y0 + uy * s;
      ctx.beginPath();
      ctx.moveTo(bx - uy * half, by + ux * half);
      ctx.lineTo(tx, ty);
      ctx.lineTo(bx + uy * half, by - ux * half);
      ctx.closePath();
      if (hollow) ctx.stroke();
      else ctx.fill();
    }
    carry = (((carry - len) % CHEVRON_STEP) + CHEVRON_STEP) % CHEVRON_STEP;
  }
}
