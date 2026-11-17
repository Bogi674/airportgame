import { PAINT, STAND_MARKINGS, STAND_SIZES } from '@data/index';
import { standGeometry } from '@data/aircraft';
import { ACCEPT_GA, type AirfieldPayload, type Stand } from '@shared/airfield';
import type { Pt } from '@shared/geom';
import { standBox } from '@shared/clearance';
import { standForks, standLeadOut, type StandFork } from '@shared/standFork';
import { standSlot } from '@shared/standGeom';
import { standLayout, toWorld, type FrontZones, type StandLayout, type ThroughMarks } from './standLayout';

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

interface StandForks {
  forks: (StandFork | null)[];
  /** Lead outs of pass through stands (T72), null for every other stand. */
  outs: (StandFork | null)[];
}

const forkCache = new WeakMap<object, StandForks>();

/** Lead in forks and lead outs of a stand list on the taxiways of an airfield, cached per pair of lists. */
function forksFor(af: AirfieldPayload, stands: readonly Stand[]): StandForks {
  const key = stands === af.stands ? af : stands;
  let f = forkCache.get(key);
  if (!f) {
    const lines = af.taxiways.map((t) => ({ pts: t.points }));
    const forks = standForks(stands, lines);
    f = { forks, outs: stands.map((s, i) => (forks[i] ? standLeadOut(s, lines) : null)) };
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

/** Where a box sits against its anchor: centered, or reaching toward +x or -x in stand local terms. */
type Align = 'c' | 'px' | 'nx';

/** Moves the context to world point p in the text frame: text reads upright with the terminal at the bottom, as on the sheet. */
function textFrame(ctx: Ctx, l: StandLayout, p: Pt): void {
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.atan2(-l.right.y, -l.right.x));
}

/** Left edge of a box of width w in the text frame. Stand local +x runs toward the text start. */
const boxX = (align: Align, w: number): number => (align === 'c' ? -w / 2 : align === 'px' ? -w : 0);

/** Text inside its own box, sized to the text, at world point p. */
function labelBox(ctx: Ctx, l: StandLayout, p: Pt, text: string, h: number, fill: string, color: string, align: Align = 'c'): void {
  ctx.save();
  textFrame(ctx, l, p);
  ctx.font = `bold ${h * 0.72}px sans-serif`;
  const w = ctx.measureText(text).width + h * 0.6;
  const x0 = boxX(align, w);
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

/** Painted text with no box at world point p, squeezed to at most maxW meters. */
function paintText(ctx: Ctx, l: StandLayout, p: Pt, text: string, h: number, color: string, align: Align, maxW: number): void {
  ctx.save();
  textFrame(ctx, l, p);
  ctx.font = `bold ${h}px sans-serif`;
  const w = Math.min(ctx.measureText(text).width, maxW);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, boxX(align, w), 0, maxW);
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
  const { forks, outs } = forksFor(af, stands);
  stands.forEach((s, i) => {
    if (overlapsStand(w, s)) paintStand(ctx, s, forks[i], outs[i], w);
  });
}

function paintStand(ctx: Ctx, s: Stand, fork: StandFork | null, out: StandFork | null, w: StandWindow): void {
  const l = standLayout(s, fork);
  if (!l || !fork) {
    paintLoose(ctx, s, w);
    return;
  }
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
    // Zebra crossing where staff walk from the terminal to the stand, on the side away from the bridge.
    const zx1 = hx - MK.zebraEdgeM;
    const zx0 = zx1 - MK.zebraWidthM;
    const span = MK.serviceRoadM - 2 * MK.roadEdgeInsetM;
    const pitch = span / MK.zebraStripes;
    ctx.fillStyle = C.white;
    for (let k = 0; k < MK.zebraStripes; k++) {
      const y0 = l.top + MK.roadEdgeInsetM + k * pitch + pitch / 4;
      path(ctx, [at(zx0, y0), at(zx1, y0), at(zx1, y0 + pitch / 2), at(zx0, y0 + pitch / 2)], true);
      ctx.fill();
    }
    // STOP box on the stand centerline at the terminal edge of the road.
    const [bw, bh] = MK.stopBoxM;
    const sy = l.top + MK.serviceRoadM - MK.roadEdgeInsetM - bh / 2 - MK.roadEdgeInsetM;
    ctx.fillStyle = C.signBlack;
    path(ctx, [at(-bw / 2, sy - bh / 2), at(bw / 2, sy - bh / 2), at(bw / 2, sy + bh / 2), at(-bw / 2, sy + bh / 2)], true);
    ctx.fill();
    paintText(ctx, l, at(0, sy), 'STOP', bh * 0.6, C.yellow, 'c', bw * 0.85);
  }

  // Lead in: fork arcs and the stand centerline from the fork to the first stop bar. A pass through stand
  // with a lead out runs its centerline on through the stand to the lead out fork and its arcs (T72).
  const centerline = out ? [fork.fork, out.fork] : [fork.fork, at(0, l.bars[0].y)];
  const guides = out ? [...fork.arcs, ...out.arcs, centerline] : [...fork.arcs, centerline];
  if (paved) {
    for (const g of guides) yellow(ctx, w, g, concrete);
    if (out) paintLeadOutArrow(ctx, l, out, concrete, w);
  } else {
    // Unpaved: no paint, cones along the lead in.
    ctx.fillStyle = CONE;
    for (const pts of guides) {
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
    paintSmall(ctx, s, l, w, paved);
  } else if (l.funnel) {
    const f = l.funnel;
    const hx = l.W / 2;
    if (detail && l.zones) paintZones(ctx, l, l.zones, w, contact ? 'bridge' : l.through ? 'none' : 'bus');
    // Wing stop outline: the solid restraint line down both sides, angled in to the nose line and closed at the road.
    const rx = hx - MK.restraintInsetM;
    const ry = l.D + MK.restraintTopM;
    const outline = [
      { x: -f.n, y: l.top },
      { x: -f.n, y: f.yn },
      { x: -rx, y: f.ys },
      { x: -rx, y: ry },
      { x: rx, y: ry },
      { x: rx, y: f.ys },
      { x: f.n, y: f.yn },
      { x: f.n, y: l.top },
    ];
    red([...outline, outline[0]].map((p) => at(p.x, p.y)));
    if (detail) {
      // The double restraint line: dashed inside the solid line, and dashed at both stand edges.
      red(inset(outline, MK.innerDashInsetM).slice(1, 7).map((p) => at(p.x, p.y)), MK.innerDashM);
      const ex = hx - MK.edgeDashInsetM;
      for (const sx of [-1, 1]) red([at(sx * ex, l.D), at(sx * ex, l.top)], MK.edgeDashM);
      paintLadder(ctx, l, w, concrete);
      // An aircraft leaving forward is never pushed, so its stand has no push limit.
      if (!out) paintPushLimit(ctx, l, w);
      if (STAND_SIZES[s.size].hydrants) paintPits(ctx, l, w);
      if (contact) paintBridges(ctx, l, w);
      if (l.through) paintThrough(ctx, l, l.through, w, !STAND_SIZES[s.size].hydrants);
    }
  }
  // Stand number box on the centerline inside the stand; unpaved stands have a signboard instead.
  if (paved && s.size !== 'small') labelBox(ctx, l, at(0, l.D + MK.numberBeyondDM), s.number, MK.numberHeightM, C.yellow, C.signBlack);
}

/** A stand with no lead in: its box as a dashed red outline and its number, so the player sees what is unconnected. */
function paintLoose(ctx: Ctx, s: Stand, w: StandWindow): void {
  const slot = standSlot(s.size);
  if (!slot) return;
  const box = standBox(s, slot);
  ctx.strokeStyle = C.red;
  ctx.lineWidth = widthM(w, MK.boundaryWidthM, MK.boundaryMinPx);
  ctx.setLineDash(MK.edgeDashM);
  path(ctx, box, true);
  ctx.stroke();
  ctx.setLineDash([]);
  // The number sits half way between the box middle and its nose edge, clear of the map badge in the middle.
  const c = { x: (box[0].x + box[1].x + 3 * (box[2].x + box[3].x)) / 8, y: (box[0].y + box[1].y + 3 * (box[2].y + box[3].y)) / 8 };
  // Same text frame as textFrame: along minus the stand right, the axis running from the tail edge to the nose edge.
  const ax = box[3].x - box[0].x;
  const ay = box[3].y - box[0].y;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(Math.atan2(-ax, ay));
  const h = MK.numberHeightM;
  ctx.font = `bold ${h * 0.72}px sans-serif`;
  const tw = ctx.measureText(s.number).width + h * 0.6;
  ctx.fillStyle = C.yellow;
  ctx.fillRect(-tw / 2, -h / 2, tw, h);
  ctx.fillStyle = C.signBlack;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s.number, 0, h * 0.04);
  ctx.restore();
}

/** One short yellow bar per type across the centerline, with the type code boxed on both sides. */
function paintLadder(ctx: Ctx, l: StandLayout, w: StandWindow, concrete: boolean): void {
  const h = MK.ladderBarHalfM;
  for (const b of l.bars) {
    yellow(ctx, w, [toWorld(l, -h, b.y), toWorld(l, h, b.y)], concrete, widthM(w, MK.stopBarWidthM, MK.stopBarMinPx));
    labelBox(ctx, l, toWorld(l, h + 0.1, b.y), b.label, MK.ladderBoxHeightM, C.signBlack, C.white, 'px');
    labelBox(ctx, l, toWorld(l, -h - 0.1, b.y), b.label, MK.ladderBoxHeightM, C.signBlack, C.white, 'nx');
  }
}

/** White push limit bar across the centerline, half way from the safety line to the stop ladder. */
function paintPushLimit(ctx: Ctx, l: StandLayout, w: StandWindow): void {
  const last = l.bars[l.bars.length - 1].y;
  const y = l.D + (last - l.D) * MK.pushLimitAt;
  const h = MK.pushLimitLengthM / 2;
  ctx.strokeStyle = C.white;
  ctx.lineWidth = widthM(w, MK.stopBarWidthM * 0.6, 1.4);
  path(ctx, [toWorld(l, -h, y), toWorld(l, h, y)]);
  ctx.stroke();
  paintText(ctx, l, toWorld(l, -h - MK.zoneTextHeightM, y), 'PUSH LIMIT', MK.zoneTextHeightM, C.white, 'nx', l.W / 2 - h - 2 * MK.zoneTextHeightM);
}

/** Red fuel pit squares at the hydrant couplings of the largest type, each with FUEL toward the road. */
function paintPits(ctx: Ctx, l: StandLayout, w: StandWindow): void {
  const g = standGeometry(l.types[0]).fuelCouplingM;
  const h = MK.pitSizeM / 2;
  for (const sx of [-1, 1]) {
    const cx = sx * g.v;
    const cy = l.nose0 - g.u;
    ctx.fillStyle = C.red;
    ctx.strokeStyle = C.signBlack;
    ctx.lineWidth = widthM(w, 0.08, 0.8);
    path(ctx, [toWorld(l, cx - h, cy - h), toWorld(l, cx + h, cy - h), toWorld(l, cx + h, cy + h), toWorld(l, cx - h, cy + h)], true);
    ctx.fill();
    ctx.stroke();
    const c = toWorld(l, cx, cy);
    ctx.fillStyle = C.signBlack;
    ctx.beginPath();
    ctx.arc(c.x, c.y, h * 0.4, 0, Math.PI * 2);
    ctx.fill();
    paintText(ctx, l, toWorld(l, cx, cy + MK.fuelTextM), 'FUEL', MK.zoneTextHeightM * 0.9, C.white, 'c', MK.fuelTextM * 3);
  }
}

/** A red fire point disc with a white F. */
function firePoint(ctx: Ctx, l: StandLayout, p: Pt): void {
  const c = toWorld(l, p.x, p.y);
  ctx.fillStyle = C.red;
  ctx.beginPath();
  ctx.arc(c.x, c.y, MK.fireRadiusM, 0, Math.PI * 2);
  ctx.fill();
  paintText(ctx, l, c, 'F', MK.fireRadiusM * 1.1, C.white, 'c', MK.fireRadiusM * 1.4);
}

/** A filled yellow arrow on the stand centerline with its tip at the lead out fork, pointing the way out. */
function paintLeadOutArrow(ctx: Ctx, l: StandLayout, out: StandFork, concrete: boolean, w: StandWindow): void {
  const tip = (out.fork.x - l.origin.x) * l.axis.x + (out.fork.y - l.origin.y) * l.axis.y;
  const [len, wide] = MK.leadOutArrowM;
  const head = [toWorld(l, 0, tip), toWorld(l, wide / 2, tip - len), toWorld(l, -wide / 2, tip - len)];
  if (concrete) {
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = px(w, 2 * TW.concreteOutlinePx);
    path(ctx, head, true);
    ctx.stroke();
  }
  ctx.fillStyle = C.yellow;
  path(ctx, head, true);
  ctx.fill();
}

/** Marshaller spot, fuel truck box, zebra walkway and bus only bay of the sheet's taxi through template (T72). */
function paintThrough(ctx: Ctx, l: StandLayout, t: ThroughMarks, w: StandWindow, truck: boolean): void {
  const at = (p: Pt): Pt => toWorld(l, p.x, p.y);
  // Fuel truck box where no hydrant pits fuel the aircraft: white dashes, FUEL TRUCK written on the tail side.
  if (truck) paintFuelTruck(ctx, l, t, w);
  paintWalkway(ctx, l, t, w);
  // Marshaller spot: white ring with M ahead of the nose.
  const c = at(t.marshaller);
  ctx.strokeStyle = C.white;
  ctx.lineWidth = widthM(w, 0.15, 1.2);
  ctx.beginPath();
  ctx.arc(c.x, c.y, MK.marshallerRadiusM, 0, Math.PI * 2);
  ctx.stroke();
  paintText(ctx, l, c, 'M', MK.marshallerRadiusM * 1.1, C.white, 'c', MK.marshallerRadiusM * 1.4);
}

function paintFuelTruck(ctx: Ctx, l: StandLayout, t: ThroughMarks, w: StandWindow): void {
  const at = (p: Pt): Pt => toWorld(l, p.x, p.y);
  const th = MK.zoneTextHeightM;
  ctx.strokeStyle = C.white;
  ctx.lineWidth = widthM(w, 0.2, 1.4);
  ctx.setLineDash([1.2, 0.9]);
  path(ctx, t.fuelTruck.map(at), true);
  ctx.stroke();
  ctx.setLineDash([]);
  const fx0 = Math.min(...t.fuelTruck.map((p) => p.x));
  const fx1 = Math.max(...t.fuelTruck.map((p) => p.x));
  const fy = Math.min(...t.fuelTruck.map((p) => p.y));
  paintText(ctx, l, at({ x: (fx0 + fx1) / 2, y: fy - th }), 'FUEL TRUCK', th, C.white, 'c', MK.fuelTruckBoxM[0] * 2);
}

/** Zebra walkway from the last door to the bus only bay, and the bay as a red outline with BUS inside. */
function paintWalkway(ctx: Ctx, l: StandLayout, t: ThroughMarks, w: StandWindow): void {
  const at = (p: Pt): Pt => toWorld(l, p.x, p.y);
  // Zebra walkway: white stripes across the walking direction.
  const [bw] = MK.busBayM;
  const span = t.walkX1 - t.walkX0;
  if (span > 0) {
    const pitch = span / MK.walkwayStripes;
    ctx.fillStyle = C.white;
    for (let k = 0; k < MK.walkwayStripes; k++) {
      const x0 = t.walkX0 + k * pitch + pitch / 4;
      path(ctx, [at({ x: x0, y: t.walkY - MK.zebraWidthM / 2 }), at({ x: x0 + pitch / 2, y: t.walkY - MK.zebraWidthM / 2 }), at({ x: x0 + pitch / 2, y: t.walkY + MK.zebraWidthM / 2 }), at({ x: x0, y: t.walkY + MK.zebraWidthM / 2 })], true);
      ctx.fill();
    }
  }
  // Bus only bay: red outline with BUS inside.
  ctx.strokeStyle = C.red;
  ctx.lineWidth = widthM(w, MK.boundaryWidthM, MK.boundaryMinPx);
  path(ctx, t.busBay.map(at), true);
  ctx.stroke();
  const bx = Math.min(...t.busBay.map((p) => p.x)) + bw / 2;
  labelBox(ctx, l, at({ x: bx, y: t.walkY - MK.zebraWidthM / 2 - MK.ladderBoxHeightM }), 'BUS', MK.ladderBoxHeightM, C.signBlack, C.white);
}

/** Emergency triangle, bridge band or bus bay, GSE box, GPU spot and fire points (revision 3 section 3 items 5 to 7). A pass through stand has its bus bay at the side instead. */
function paintZones(ctx: Ctx, l: StandLayout, z: FrontZones, w: StandWindow, access: 'bridge' | 'bus' | 'none'): void {
  const at = (p: Pt): Pt => toWorld(l, p.x, p.y);
  const th = MK.zoneTextHeightM;
  hatched(ctx, w, z.emergency.map(at), C.red);
  const ex0 = Math.min(...z.emergency.map((p) => p.x));
  const ex1 = Math.max(...z.emergency.map((p) => p.x));
  paintText(ctx, l, at({ x: (ex0 + ex1) / 2, y: z.textY }), 'EMERGENCY EQUIPMENT ONLY', th, C.red, 'c', ex1 - ex0);
  const bx0 = Math.min(...z.bridge.map((p) => p.x));
  const bx1 = Math.max(...z.bridge.map((p) => p.x));
  const by = Math.min(...z.bridge.map((p) => p.y));
  if (access === 'bridge') {
    hatched(ctx, w, z.bridge.map(at), C.red);
    paintText(ctx, l, at({ x: bx1, y: z.textY }), 'NO PARKING', th, C.red, 'nx', bx1 - bx0 - 3 * MK.fireRadiusM);
    firePoint(ctx, l, z.fire[1]);
  } else if (access === 'bus') {
    ctx.strokeStyle = C.white;
    ctx.lineWidth = widthM(w, 0.2, 1.4);
    ctx.setLineDash([2, 1.5]);
    path(ctx, z.bridge.map(at), true);
    ctx.stroke();
    ctx.setLineDash([]);
    labelBox(ctx, l, at({ x: (bx0 + bx1) / 2, y: (by + l.top) / 2 }), 'BUS', 2.4, C.signBlack, C.white);
  }
  firePoint(ctx, l, z.fire[0]);
  // GSE parking: white outline, white hatching across its base, GSE near its top.
  const gx0 = Math.min(...z.gse.map((p) => p.x));
  const gx1 = Math.max(...z.gse.map((p) => p.x));
  const gy = Math.min(...z.gse.map((p) => p.y));
  const gb = Math.max(...z.gse.map((p) => p.y));
  ctx.strokeStyle = C.white;
  ctx.lineWidth = widthM(w, 0.2, 1.4);
  path(ctx, z.gse.map(at), true);
  ctx.stroke();
  ctx.save();
  path(ctx, [at({ x: gx0, y: gb - MK.gseHatchM }), at({ x: gx1, y: gb - MK.gseHatchM }), at({ x: gx1, y: gb }), at({ x: gx0, y: gb })], true);
  ctx.clip();
  ctx.beginPath();
  for (let x = gx0; x < gx1 + MK.gseHatchM; x += MK.hatchSpacingM * 1.4) {
    const p0 = at({ x, y: gb - MK.gseHatchM });
    const p1 = at({ x: x - MK.gseHatchM, y: gb });
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
  }
  ctx.stroke();
  ctx.restore();
  paintText(ctx, l, at({ x: (gx0 + gx1) / 2, y: gy + th * 1.4 }), 'GSE', th, C.white, 'c', gx1 - gx0);
  // GPU spot beside the nose, GPU written toward the road.
  const g = MK.gpuSizeM / 2;
  ctx.fillStyle = C.yellow;
  ctx.strokeStyle = C.signBlack;
  ctx.lineWidth = widthM(w, 0.08, 0.8);
  path(ctx, [at({ x: z.gpu.x - g, y: z.gpu.y - g }), at({ x: z.gpu.x + g, y: z.gpu.y - g }), at({ x: z.gpu.x + g, y: z.gpu.y + g }), at({ x: z.gpu.x - g, y: z.gpu.y + g })], true);
  ctx.fill();
  ctx.stroke();
  paintText(ctx, l, at({ x: z.gpu.x, y: z.gpu.y + g + th }), 'GPU', th * 0.9, C.yellow, 'c', th * 3);
}

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

/**
 * General aviation stand per the sheet: on paint, a stop bar ahead of the nose, T marks at both
 * wingtips and a dashed wingtip line to the stand edge; on gravel, white edge markers and tie down
 * rings; on grass and dirt, rows of cones and tie down rings. A G label sits in the front corner.
 */
function paintSmall(ctx: Ctx, s: Stand, l: StandLayout, w: StandWindow, paved: boolean): void {
  const hx = l.W / 2;
  const a = l.types[0];
  const half = a.dimensions.wingspanM / 2;
  const nose = l.nose0;
  const wingY = nose - a.dimensions.lengthM * MK.gaTAtLength;
  const detail = w.scale >= 1;
  const label = (fill: string): void => {
    const text = (s.accepts & ACCEPT_GA) !== 0 ? `G${s.number}` : s.number;
    labelBox(ctx, l, toWorld(l, hx - MK.gaLabelInsetM, l.top - MK.gaLabelBackM), text, MK.gaLabelHeightM, fill, C.signBlack);
  };
  if (paved) {
    const concrete = s.surface === 'concrete';
    if (detail) {
      const lw = widthM(w, MK.stopBarWidthM, MK.stopBarMinPx);
      yellow(ctx, w, [toWorld(l, -MK.gaStopHalfM, l.bars[0].y), toWorld(l, MK.gaStopHalfM, l.bars[0].y)], concrete, lw);
      for (const sx of [-1, 1]) {
        const x = sx * half;
        yellow(ctx, w, [toWorld(l, x - MK.gaTBarM / 2, wingY), toWorld(l, x + MK.gaTBarM / 2, wingY)], concrete);
        yellow(ctx, w, [toWorld(l, x, wingY), toWorld(l, x, wingY + MK.gaTStemM)], concrete);
      }
      // Wingtip line from the T on the left wing to the stand edge.
      ctx.setLineDash([1, 0.8]);
      yellow(ctx, w, [toWorld(l, -half - MK.gaTBarM / 2, wingY), toWorld(l, -hx, wingY)], false);
      ctx.setLineDash([]);
    }
    label(C.yellow);
    return;
  }
  const ring = (x: number, y: number): void => {
    const c = toWorld(l, x, y);
    ctx.strokeStyle = C.white;
    ctx.lineWidth = widthM(w, 0.12, 2);
    ctx.beginPath();
    ctx.arc(c.x, c.y, MK.tieRingDiameterM / 2, 0, Math.PI * 2);
    ctx.stroke();
  };
  if (detail) {
    ring(-half * MK.gaRingSpan, wingY);
    ring(half * MK.gaRingSpan, wingY);
    ring(0, nose + MK.gaNoseRingM);
  }
  const edges = [l.D, l.top];
  if (s.surface === 'gravel') {
    // White edge markers along the taxilane edge and the front edge.
    const [mw, mh] = MK.gaEdgeMarkerM;
    const n = MK.gaMarkersPerEdge;
    ctx.fillStyle = C.white;
    for (const y of edges) {
      for (let k = 0; k < n; k++) {
        const x = -hx + mw + ((l.W - 2 * mw) * k) / (n - 1);
        path(ctx, [toWorld(l, x - mw / 2, y - mh / 2), toWorld(l, x + mw / 2, y - mh / 2), toWorld(l, x + mw / 2, y + mh / 2), toWorld(l, x - mw / 2, y + mh / 2)], true);
        ctx.fill();
      }
    }
    label(C.yellow);
    return;
  }
  // Grass and dirt: a row of cones along both edges.
  const n = MK.gaConesPerEdge;
  const r = Math.max(0.5, px(w, 3));
  ctx.fillStyle = CONE;
  for (const y of edges) {
    for (let k = 0; k < n; k++) {
      const x = -hx + r + ((l.W - 2 * r) * k) / (n - 1);
      path(ctx, [toWorld(l, x, y - r), toWorld(l, x + r, y + r), toWorld(l, x - r, y + r)], true);
      ctx.fill();
    }
  }
  label(C.white);
}
