import { GROUND, PAINT } from '@data/index';
import type { AirfieldPayload, Depot, ServiceRoad } from '@shared/airfield';
import type { Pt } from '@shared/geom';
import { buildRoadGraph, depotExit, headingVec } from '@shared/roadGraph';

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** The paint window in meters, with `scale` device pixels per meter. */
export interface RoadWindow {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  scale: number;
}

const RP = PAINT.road;
const DP = PAINT.depot;
const HALF = GROUND.road.widthM / 2;

const lineM = (w: RoadWindow, meters: number, minPx: number): number => Math.max(meters, minPx / w.scale);

function nearWindow(pts: readonly Pt[], w: RoadWindow, pad: number): boolean {
  for (const p of pts) if (p.x >= w.minX - pad && p.x <= w.maxX + pad && p.y >= w.minY - pad && p.y <= w.maxY + pad) return true;
  return false;
}

function polyline(ctx: Ctx, pts: readonly Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

/** The road surface of every service road: a 7 m band with round joins, under the taxiway pavement it crosses. */
export function paintRoadSurface(ctx: Ctx, roads: readonly ServiceRoad[], w: RoadWindow): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.strokeStyle = RP.fill;
  ctx.lineWidth = GROUND.road.widthM;
  for (const r of roads) {
    if (!nearWindow(r.points, w, 200)) continue;
    polyline(ctx, r.points);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Road lines on top: white edge lines inset from the road edge, a dashed white center line between the
 * two lanes, and at each taxiway crossing a solid white hold line across the road on both sides, where
 * vehicles wait for aircraft (GAME_DESIGN section 10).
 */
export function paintRoadLines(ctx: Ctx, af: AirfieldPayload, w: RoadWindow): void {
  const roads = af.roads ?? [];
  if (roads.length === 0 || w.scale < RP.minScale) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = PAINT.colors.white;
  ctx.lineWidth = lineM(w, RP.lineWidthM, RP.lineMinPx);
  for (const r of roads) {
    if (!nearWindow(r.points, w, 200)) continue;
    for (const side of [1, -1]) {
      const off = offsetLine(r.points, side * (HALF - RP.edgeInsetM));
      polyline(ctx, off);
      ctx.stroke();
    }
    ctx.setLineDash([RP.dashM, RP.dashM]);
    polyline(ctx, r.points);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Hold lines: where the graph puts a crossing node, at the hold distance along each road edge leaving it.
  const g = buildRoadGraph(af);
  ctx.lineWidth = RP.holdWidthM;
  for (let n = 0; n < g.nodeX.length; n++) {
    const tw = g.nodeCross[n];
    if (tw < 0) continue;
    const t = af.taxiways.find((x) => x.id === tw);
    const hold = (t ? t.widthM / 2 : 0) + GROUND.crossing.holdBackM;
    for (const e of g.adj[n]) {
      const o = g.edgeA[e] === n ? g.edgeB[e] : g.edgeA[e];
      const dx = g.nodeX[o] - g.nodeX[n];
      const dy = g.nodeY[o] - g.nodeY[n];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len <= hold) continue;
      const ux = dx / len;
      const uy = dy / len;
      const cx = g.nodeX[n] + ux * hold;
      const cy = g.nodeY[n] + uy * hold;
      ctx.beginPath();
      ctx.moveTo(cx - uy * (HALF - RP.edgeInsetM), cy + ux * (HALF - RP.edgeInsetM));
      ctx.lineTo(cx + uy * (HALF - RP.edgeInsetM), cy - ux * (HALF - RP.edgeInsetM));
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A polyline moved sideways by `d` meters, joined by the miter of each pair of segments. */
function offsetLine(pts: readonly Pt[], d: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = 0;
    let ny = 0;
    for (const [p, q] of [
      [a, pts[i]],
      [pts[i], b],
    ] as const) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;
      nx += -dy / len;
      ny += dx / len;
    }
    const nl = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= nl;
    ny /= nl;
    // The miter of an interior corner is longer than the offset, so the line keeps its distance from both edges.
    let k = 1;
    if (i > 0 && i < pts.length - 1) {
      const dx = b.x - pts[i].x;
      const dy = b.y - pts[i].y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      k = 1 / Math.max(0.5, nx * (-dy / len) + ny * (dx / len));
    }
    out.push({ x: pts[i].x + nx * d * k, y: pts[i].y + ny * d * k });
  }
  return out;
}

/** Ground handling depots: forecourt at the door side, the shed with a ridged roof, roller doors and a shadow. */
export function paintDepots(ctx: Ctx, depots: readonly Depot[], w: RoadWindow): void {
  for (const d of depots) paintDepot(ctx, d, w);
}

export function paintDepot(ctx: Ctx, d: Depot, w: RoadWindow): void {
  const f = headingVec(d.headingDeg);
  const r = { x: -f.y, y: f.x };
  const hw = GROUND.depot.widthM / 2;
  const hd = GROUND.depot.depthM / 2;
  const at = (across: number, along: number): Pt => ({ x: d.x + r.x * across + f.x * along, y: d.y + r.y * across + f.y * along });
  if (!nearWindow([at(0, 0)], w, 80)) return;
  const quad = (a: number, b: number, c: number, e: number): Pt[] => [at(a, c), at(b, c), at(b, e), at(a, e)];
  const fill = (pts: Pt[], color: string): void => {
    ctx.fillStyle = color;
    polyline(ctx, pts);
    ctx.closePath();
    ctx.fill();
  };
  const outline = lineM(w, 0.1, DP.outlinePx);
  // Forecourt of concrete in front of the doors, the shed behind it.
  const shedFront = hd - DP.apronM;
  fill(quad(-hw, hw, shedFront, hd), DP.colors.apron);
  ctx.save();
  ctx.translate(DP.shadowOffsetM, DP.shadowOffsetM);
  fill(quad(-hw, hw, -hd, shedFront), DP.colors.shadow);
  ctx.restore();
  fill(quad(-hw, hw, -hd, shedFront), DP.colors.roof);
  // Roof ridge along the building, and the eaves line.
  fill(quad(-hw, hw, -DP.ridgeWidthM / 2 - (DP.apronM / 2), DP.ridgeWidthM / 2 - DP.apronM / 2), DP.colors.ridge);
  // Roller doors on the door side, spread evenly.
  const n = DP.doorCount;
  const pitch = (2 * hw) / n;
  for (let i = 0; i < n; i++) {
    const c = -hw + pitch * (i + 0.5);
    fill(quad(c - DP.doorWidthM / 2, c + DP.doorWidthM / 2, shedFront - DP.doorDepthM, shedFront), DP.colors.door);
  }
  ctx.strokeStyle = DP.colors.outline;
  ctx.lineWidth = outline;
  polyline(ctx, quad(-hw, hw, -hd, shedFront));
  ctx.closePath();
  ctx.stroke();
  // The exit lane mouth, so the player sees where roads must join.
  const e = depotExit(d);
  ctx.fillStyle = RP.fill;
  polyline(ctx, [
    { x: e.x - r.x * HALF - f.x * GROUND.depot.exitGapM, y: e.y - r.y * HALF - f.y * GROUND.depot.exitGapM },
    { x: e.x + r.x * HALF - f.x * GROUND.depot.exitGapM, y: e.y + r.y * HALF - f.y * GROUND.depot.exitGapM },
    { x: e.x + r.x * HALF, y: e.y + r.y * HALF },
    { x: e.x - r.x * HALF, y: e.y - r.y * HALF },
  ]);
  ctx.closePath();
  ctx.fill();
}
