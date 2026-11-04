import { PAINT, STAND_MARKINGS, STAND_SIZES } from '@data/index';
import { standGeometry } from '@data/aircraft';
import type { AirfieldPayload, Stand } from '@shared/airfield';
import type { Pt } from '@shared/geom';
import { standForks, type StandFork } from '@shared/standFork';
import { cornerPolygons, standLayout, toWorld, type StandLayout } from './standLayout';

/**
 * Stand markings drawn from stand data (docs/DESIGN_REVISION_2.md sections 1 and 3): the lead in fork
 * and stand number on every stand; for Medium, Large and Extra large the stand safety line, the stand
 * boundary with its funnel, the jet bridge zone and staging area, stop bars per type group, hydrant pits,
 * and on contact stands the service road and jet bridges; for Small stands the GA stop mark, wingtip
 * lines and tie down rings, or cones and a signboard when unpaved.
 */

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface StandWindow {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Device pixels per meter. */
  scale: number;
}

const MK = STAND_MARKINGS;
const C = PAINT.colors;
const TW = PAINT.taxiway;
const ROAD_FILL = '#3f4046';
const BRIDGE_FILL = '#cfd4da';
const BRIDGE_EDGE = '#2a2f37';
const ROTUNDA_FILL = '#9aa3ae';
const CONE = '#f07a1a';

const px = (w: StandWindow, n: number): number => n / w.scale;
const widthM = (w: StandWindow, meters: number, minPx: number): number => Math.max(meters, minPx / w.scale);
const isPaved = (s: Stand): boolean => s.surface === 'asphalt' || s.surface === 'concrete';

const forkCache = new WeakMap<object, (StandFork | null)[]>();

/** Forks of a stand list on the taxiways of an airfield, cached per pair of lists. */
function forksFor(af: AirfieldPayload, stands: readonly Stand[]): (StandFork | null)[] {
  const key = stands === af.stands ? af : stands;
  let f = forkCache.get(key);
  if (!f) {
    f = standForks(stands, af.taxiways.map((t) => ({ pts: t.points })));
    forkCache.set(key, f);
  }
  return f;
}

function path(ctx: Ctx, pts: readonly Pt[], close = false): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (close) ctx.closePath();
}

/** A yellow line with a dark outline on concrete. */
function yellow(ctx: Ctx, w: StandWindow, pts: readonly Pt[], concrete: boolean, lineW = widthM(w, TW.centerlineWidthM, TW.centerlineMinPx)): void {
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  if (concrete) {
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = lineW + px(w, 2 * TW.concreteOutlinePx);
    path(ctx, pts);
    ctx.stroke();
  }
  ctx.strokeStyle = C.yellow;
  ctx.lineWidth = lineW;
  path(ctx, pts);
  ctx.stroke();
}

/** Text inside its own box, sized to the text, in stand local orientation at world point p. */
function labelBox(ctx: Ctx, l: StandLayout, p: Pt, text: string, h: number, fill: string, color: string, anchorLeft: boolean): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  // Text reads upright with the terminal at the top: the stand's +y is up the page.
  ctx.rotate(Math.atan2(l.right.y, l.right.x));
  ctx.font = `bold ${h * 0.72}px sans-serif`;
  const w = ctx.measureText(text).width + h * 0.6;
  const x0 = anchorLeft ? 0 : -w / 2;
  ctx.fillStyle = fill;
  ctx.fillRect(x0, -h / 2, w, h);
  ctx.strokeStyle = C.signBlack;
  ctx.lineWidth = h * 0.06;
  ctx.strokeRect(x0, -h / 2, w, h);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x0 + w / 2, h * 0.04);
  ctx.restore();
}

/** Hatch lines at 45 degrees inside a world polygon, then its outline. */
function hatched(ctx: Ctx, w: StandWindow, poly: readonly Pt[], color: string): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  ctx.save();
  path(ctx, poly, true);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = widthM(w, 0.12, 1);
  ctx.beginPath();
  const span = maxX - minX + maxY - minY;
  for (let d = 0; d <= span; d += MK.hatchSpacingM) {
    ctx.moveTo(minX + d, minY);
    ctx.lineTo(minX + d - (maxY - minY), maxY);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = color;
  ctx.lineWidth = widthM(w, 0.25, 1.6);
  path(ctx, poly, true);
  ctx.stroke();
}

/** A convex polygon moved inward by d on every edge. */
function inset(poly: readonly Pt[], d: number): Pt[] {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += poly[i].x * poly[(i + 1) % n].y - poly[(i + 1) % n].x * poly[i].y;
  const sgn = area > 0 ? 1 : -1;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (-(b.y - a.y) / len) * sgn;
    const ny = ((b.x - a.x) / len) * sgn;
    return { x: a.x + nx * d, y: a.y + ny * d, dx: b.x - a.x, dy: b.y - a.y };
  });
  return lines.map((l, i) => {
    const p = lines[(i - 1 + n) % n];
    const den = p.dx * l.dy - p.dy * l.dx;
    if (Math.abs(den) < 1e-9) return { x: l.x, y: l.y };
    const t = ((l.x - p.x) * l.dy - (l.y - p.y) * l.dx) / den;
    return { x: p.x + p.dx * t, y: p.y + p.dy * t };
  });
}

function overlapsStand(w: StandWindow, s: Stand): boolean {
  const r = STAND_SIZES[s.size].depthM + STAND_SIZES[s.size].widthM + 150;
  return s.x + r >= w.minX && s.x - r <= w.maxX && s.y + r >= w.minY && s.y - r <= w.maxY;
}

/** Paints the markings of the given stands. Shared fork ends are drawn once, since each arc ends there. */
export function paintStands(ctx: Ctx, af: AirfieldPayload, stands: readonly Stand[], w: StandWindow): void {
  const forks = forksFor(af, stands);
  stands.forEach((s, i) => {
    if (overlapsStand(w, s)) paintStand(ctx, s, forks[i], w);
  });
}

function paintStand(ctx: Ctx, s: Stand, fork: StandFork | null, w: StandWindow): void {
  const l = standLayout(s, fork);
  if (!l || !fork) return;
  const at = (x: number, y: number): Pt => toWorld(l, x, y);
  const paved = isPaved(s);
  const concrete = s.surface === 'concrete';
  const detail = w.scale >= 1;
  const red = (pts: Pt[], dash: number[] = []): void => {
    ctx.strokeStyle = C.red;
    ctx.lineWidth = widthM(w, MK.boundaryWidthM, MK.boundaryMinPx);
    ctx.setLineDash(dash);
    path(ctx, pts);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const contact = s.type === 'contact' && s.size !== 'small';

  // Service road and jet bridges above the stand top, under everything else.
  if (contact && detail) {
    const hx = l.W / 2;
    const road = [at(-hx, l.top), at(hx, l.top), at(hx, l.top + MK.serviceRoadM), at(-hx, l.top + MK.serviceRoadM)];
    ctx.fillStyle = ROAD_FILL;
    path(ctx, road, true);
    ctx.fill();
    ctx.strokeStyle = C.white;
    ctx.lineWidth = widthM(w, 0.15, 1.3);
    for (const y of [l.top + MK.roadEdgeInsetM, l.top + MK.serviceRoadM - MK.roadEdgeInsetM]) {
      path(ctx, [at(-hx, y), at(hx, y)]);
      ctx.stroke();
    }
    ctx.setLineDash([3, 3]);
    path(ctx, [at(-hx, l.top + MK.serviceRoadM / 2), at(hx, l.top + MK.serviceRoadM / 2)]);
    ctx.stroke();
    ctx.setLineDash([]);
    // One arrow per lane, flow opposite on the two lanes.
    for (const [y, dir] of [[l.top + MK.serviceRoadM * 0.27, 1], [l.top + MK.serviceRoadM * 0.73, -1]] as const) {
      const x = l.W * MK.roadArrowAt;
      const a = at(x - dir * 2.5, y);
      const b = at(x + dir * 2.5, y);
      path(ctx, [a, b]);
      ctx.stroke();
      ctx.fillStyle = C.white;
      path(ctx, [at(x + dir * 2.5, y - 0.6), at(x + dir * 3.8, y), at(x + dir * 2.5, y + 0.6)], true);
      ctx.fill();
    }
  }

  // Lead in: fork arcs and the stand centerline from the fork to the first stop bar.
  if (paved) {
    for (const arc of fork.arcs) yellow(ctx, w, arc, concrete);
    yellow(ctx, w, [fork.fork, at(0, l.bars[0].y)], concrete);
  } else {
    // Unpaved: no paint, cones along the lead in.
    ctx.fillStyle = CONE;
    for (const pts of [...fork.arcs, [fork.fork, at(0, l.bars[0].y)]]) {
      let acc = 0;
      for (let k = 1; k < pts.length; k++) {
        const seg = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
        while (acc <= seg) {
          const t = seg > 0 ? acc / seg : 0;
          ctx.beginPath();
          ctx.arc(pts[k - 1].x + (pts[k].x - pts[k - 1].x) * t, pts[k - 1].y + (pts[k].y - pts[k - 1].y) * t, Math.max(0.35, px(w, 2)), 0, Math.PI * 2);
          ctx.fill();
          acc += MK.coneSpacingM;
        }
        acc -= seg;
      }
    }
  }

  if (s.size === 'small') {
    paintSmall(ctx, s, l, w, paved, red);
  } else if (l.funnel) {
    const f = l.funnel;
    const hx = l.W / 2;
    // Front corners: jet bridge zone (or bus bay on a remote stand) left, equipment staging right.
    const [left, rightCorner] = cornerPolygons(l.W, l.top, f).map((poly) => inset(poly, MK.cornerInsetM).map((p) => at(p.x, p.y)));
    if (detail) {
      if (contact) hatched(ctx, w, left, C.red);
      else {
        ctx.strokeStyle = C.white;
        ctx.lineWidth = widthM(w, 0.2, 1.4);
        ctx.setLineDash([2, 1.5]);
        path(ctx, left, true);
        ctx.stroke();
        ctx.setLineDash([]);
        labelBox(ctx, l, at(-(hx + f.n) / 2, (f.yn + l.top) / 2), 'BUS', 2.4, C.signBlack, C.white, false);
      }
      hatched(ctx, w, rightCorner, C.white);
    }
    // Stand safety line, then the boundary with its funnel, continuing toward the neighbours.
    red([at(-hx, l.D), at(hx, l.D)]);
    for (const sx of [-1, 1]) {
      red([at(sx * hx, l.D), at(sx * hx, f.ys), at(sx * f.n, f.yn), at(sx * f.n, l.top)]);
      const run = MK.boundaryExtendM;
      red([at(sx * hx, f.ys), at(sx * (hx + run), f.ys + ((f.yn - f.ys) * run) / (hx - f.n))]);
    }
    if (detail) {
      paintBars(ctx, l, w, concrete);
      if (STAND_SIZES[s.size].hydrants) paintPits(ctx, l, w);
      if (contact) paintBridges(ctx, l, w);
    }
  }
  // Stand number box on the centerline between the arcs; unpaved stands have a signboard instead.
  if (paved) labelBox(ctx, l, at(0, l.D * MK.numberAt), s.number, 2.6, C.yellow, C.signBlack, false);
}

function paintBars(ctx: Ctx, l: StandLayout, w: StandWindow, concrete: boolean): void {
  for (const b of l.bars) {
    yellow(ctx, w, [toWorld(l, -1.5, b.y), toWorld(l, b.halfW, b.y)], concrete, widthM(w, MK.stopBarWidthM, MK.stopBarMinPx));
    labelBox(ctx, l, toWorld(l, b.halfW + 0.6, b.y), b.label, 2, C.signBlack, C.white, true);
  }
}

function paintPits(ctx: Ctx, l: StandLayout, w: StandWindow): void {
  const g = standGeometry(l.types[0]).fuelCouplingM;
  const h = MK.pitSizeM / 2;
  ctx.strokeStyle = C.red;
  ctx.lineWidth = widthM(w, 0.15, 1.4);
  for (const sx of [-1, 1]) {
    const cx = sx * g.v;
    const cy = l.nose0 - g.u;
    path(ctx, [toWorld(l, cx - h, cy - h), toWorld(l, cx + h, cy - h), toWorld(l, cx + h, cy + h), toWorld(l, cx - h, cy + h)], true);
    ctx.stroke();
    path(ctx, [toWorld(l, cx - h, cy - h), toWorld(l, cx + h, cy + h)]);
    ctx.stroke();
  }
}

/** Fixed link from the service road to a rotunda in the jet bridge zone, a tunnel to the door, and the cab. */
function paintBridges(ctx: Ctx, l: StandLayout, w: StandWindow): void {
  const a = l.types[0];
  const doors = standGeometry(a).doorStationsM.slice(0, STAND_SIZES[l.size].jetBridges);
  const f = l.funnel;
  if (!f) return;
  const fw = a.dimensions.fuselageWidthM;
  const band = (p0: Pt, p1: Pt, width: number): Pt[] => {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (width / 2);
    const ny = (dx / len) * (width / 2);
    return [
      { x: p0.x + nx, y: p0.y + ny },
      { x: p1.x + nx, y: p1.y + ny },
      { x: p1.x - nx, y: p1.y - ny },
      { x: p0.x - nx, y: p0.y - ny },
    ].map((p) => toWorld(l, p.x, p.y));
  };
  doors.forEach((dl, k) => {
    const door = { x: -fw / 2 - 0.5, y: l.nose0 - dl };
    const rot = { x: -f.n - MK.rotundaOffsetM - k * MK.rotundaStepM[0], y: l.top - 4 - k * MK.rotundaStepM[1] };
    const cabEnd = { x: door.x - MK.cabLengthM, y: door.y };
    const shapes = [
      band({ x: rot.x, y: l.top + MK.serviceRoadM }, rot, MK.linkWidthM),
      band(rot, cabEnd, MK.tunnelWidthM),
      band(cabEnd, door, MK.cabWidthM),
    ];
    ctx.fillStyle = BRIDGE_FILL;
    ctx.strokeStyle = BRIDGE_EDGE;
    ctx.lineWidth = widthM(w, 0.12, 1);
    for (const sh of shapes) {
      path(ctx, sh, true);
      ctx.fill();
      ctx.stroke();
    }
    const c = toWorld(l, rot.x, rot.y);
    ctx.fillStyle = ROTUNDA_FILL;
    ctx.beginPath();
    ctx.arc(c.x, c.y, MK.rotundaRadiusM, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
}

function paintSmall(ctx: Ctx, s: Stand, l: StandLayout, w: StandWindow, paved: boolean, red: (pts: Pt[], dash?: number[]) => void): void {
  const hx = l.W / 2;
  const a = l.types[0];
  const half = a.dimensions.wingspanM / 2;
  const ring = (x: number, y: number): void => {
    const c = toWorld(l, x, y);
    ctx.strokeStyle = C.white;
    ctx.lineWidth = widthM(w, 0.12, 2);
    ctx.beginPath();
    ctx.arc(c.x, c.y, MK.tieRingDiameterM / 2, 0, Math.PI * 2);
    ctx.stroke();
  };
  // Tie down rings under both wings and at the tail.
  const wingY = l.nose0 - a.dimensions.lengthM * 0.4;
  ring(-half * 0.65, wingY);
  ring(half * 0.65, wingY);
  ring(0, l.nose0 - a.dimensions.lengthM + 1);
  if (paved) {
    if (w.scale >= 1) yellow(ctx, w, [toWorld(l, -1.6, l.bars[0].y), toWorld(l, 1.6, l.bars[0].y)], s.surface === 'concrete', widthM(w, MK.stopBarWidthM, MK.stopBarMinPx));
    if (w.scale >= 1) labelBox(ctx, l, toWorld(l, 2.2, l.bars[0].y), 'GA', 1.6, C.signBlack, C.white, true);
    for (const sx of [-1, 1]) red([toWorld(l, sx * hx, l.D), toWorld(l, sx * hx, l.top)], [2, 1.5]);
    return;
  }
  // Unpaved: white edge markers at the corners and a signboard at the stand head.
  ctx.fillStyle = C.white;
  const m = Math.max(0.6, px(w, 4));
  for (const [x, y] of [[-hx, l.D], [hx, l.D], [-hx, l.top], [hx, l.top]] as const) {
    const c = toWorld(l, x, y);
    ctx.fillRect(c.x - m / 2, c.y - m / 2, m, m);
  }
  labelBox(ctx, l, toWorld(l, 0, l.top + 1.5), s.number, 1.6, C.white, C.signBlack, false);
}
