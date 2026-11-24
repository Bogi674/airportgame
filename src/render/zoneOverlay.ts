import { TERMINAL_CELL_M, ZONE, type TerminalGrid } from '@shared/business';
import { effectiveZones, pendingExitBadges, transitionBadges, zoneAccess, zoneBreaches, type TransitionBadge, type ZoneEdge } from '@shared/terminalZones';
import { withAlpha } from './overlayRamp';

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** Theme colors of the zones overlay, six digit hex each. */
export interface ZoneColors {
  public: string;
  commercial: string;
  secure: string;
  international: string;
  staff: string;
  breach: string;
  badge: string;
}

const TINT_ALPHA = 0.28;
const STAFF_TINT_ALPHA = 0.16;
const LINE_ALPHA = 0.85;
const HATCH_ALPHA = 0.45;
/** Staff hatch lines are 0.8 m apart across the cell, measured square to the line. */
const HATCH_SPACING_M = 0.8;
const HATCH_WIDTH_M = 0.22;
const EDGE_WIDTH_M = 0.24;
const BADGE_R_M = 0.9;
const BADGE_STROKE_M = 0.22;
const BADGE_ARROW_WIDTH_M = 0.2;
const BREACH_STROKE_M = 0.18;
/** The pending ring grows by this many badge radii over one pulse. */
const PENDING_GROW = 1.1;
const PENDING_STROKE_M = 0.3;
const BREACH_BAR_W_M = 0.18;
const BREACH_DOT_R_M = 0.11;

/** Overlay colors of one zone set, built once per theme so each frame reuses the strings. */
interface ZonePaint {
  /** Solid zone colors by zone id, index 0 unused. */
  solid: string[];
  tint: string[];
  line: string[];
  staffTint: string;
  hatch: string;
  badge: string;
  breach: string;
}

const paintCache = new WeakMap<ZoneColors, ZonePaint>();

/**
 * What the overlay derives from one grid: effective zones, transition badges and breach edges. The sim sends a new
 * grid object only when its terminalVersion changes, so the grid object is the cache key and nothing is rebuilt per frame.
 */
interface ZoneView {
  eff: Uint8Array;
  badges: TransitionBadge[];
  /** Badges whose exit zone is not carried on yet (T88), drawn with a pulsing ring. */
  pending: TransitionBadge[];
  breaches: ZoneEdge[];
}

const viewCache = new WeakMap<TerminalGrid, ZoneView>();

function viewOf(g: TerminalGrid): ZoneView {
  const cached = viewCache.get(g);
  if (cached) return cached;
  const eff = effectiveZones(g);
  const view: ZoneView = {
    eff,
    badges: transitionBadges(g),
    pending: pendingExitBadges(g, eff),
    breaches: zoneBreaches(g, zoneAccess(g)),
  };
  viewCache.set(g, view);
  return view;
}

function paintFor(colors: ZoneColors): ZonePaint {
  const cached = paintCache.get(colors);
  if (cached) return cached;
  // Index by zone id: ZONE.Public to ZONE.International.
  const solid = ['', colors.public, colors.commercial, colors.secure, colors.staff, colors.international];
  const paint: ZonePaint = {
    solid,
    tint: solid.map((hex) => (hex === '' ? '' : withAlpha(hex, TINT_ALPHA))),
    line: solid.map((hex) => (hex === '' ? '' : withAlpha(hex, LINE_ALPHA))),
    staffTint: withAlpha(colors.staff, STAFF_TINT_ALPHA),
    hatch: withAlpha(colors.staff, HATCH_ALPHA),
    badge: colors.badge,
    breach: colors.breach,
  };
  paintCache.set(colors, paint);
  return paint;
}

/** Diagonal hatch lines over one staff cell, drawn in grid meters at the cell origin (x, y). */
function hatchCell(ctx: Ctx, x: number, y: number, paint: ZonePaint): void {
  const C = TERMINAL_CELL_M;
  // Lines of constant x + y are square to the 45 degree direction; this spacing gives the perpendicular gap.
  const step = HATCH_SPACING_M * Math.SQRT2;
  const kFirst = Math.ceil((x + y) / step);
  const kLast = Math.floor((x + y + 2 * C) / step);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, C, C);
  ctx.clip();
  ctx.beginPath();
  for (let k = kFirst; k <= kLast; k++) {
    const sum = k * step;
    ctx.moveTo(sum - y - C, y + C);
    ctx.lineTo(sum - y, y);
  }
  ctx.strokeStyle = paint.hatch;
  ctx.lineWidth = HATCH_WIDTH_M;
  ctx.stroke();
  ctx.restore();
}

/** Inner edge line of a cell on one side, 0.24 m wide and kept inside the cell. */
function edgeLine(ctx: Ctx, x: number, y: number, side: number): void {
  const C = TERMINAL_CELL_M;
  const inset = EDGE_WIDTH_M / 2;
  ctx.beginPath();
  if (side === 0) {
    ctx.moveTo(x + inset, y);
    ctx.lineTo(x + inset, y + C);
  } else if (side === 1) {
    ctx.moveTo(x + C - inset, y);
    ctx.lineTo(x + C - inset, y + C);
  } else if (side === 2) {
    ctx.moveTo(x, y + inset);
    ctx.lineTo(x + C, y + inset);
  } else {
    ctx.moveTo(x, y + C - inset);
    ctx.lineTo(x + C, y + C - inset);
  }
  ctx.stroke();
}

/** Transition badge: white circle with a one way arrow in the color of the zone it leads into, turned by the flow. */
function drawTransitionBadge(ctx: Ctx, b: TransitionBadge, paint: ZonePaint): void {
  const r = BADGE_R_M;
  const col = paint.solid[b.to] ?? '';
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(Math.atan2(b.dy, b.dx));
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, 2 * Math.PI);
  ctx.fillStyle = paint.badge;
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = BADGE_STROKE_M;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.45, 0);
  ctx.lineTo(r * 0.35, 0);
  ctx.moveTo(r * 0.05, -r * 0.32);
  ctx.lineTo(r * 0.4, 0);
  ctx.lineTo(r * 0.05, r * 0.32);
  ctx.strokeStyle = col;
  ctx.lineWidth = BADGE_ARROW_WIDTH_M;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/** Pulsing ring around the badge of an exit whose zone is not carried on yet (T88). pulse runs from 0 to 1. */
function drawPendingRing(ctx: Ctx, b: TransitionBadge, paint: ZonePaint, pulse: number): void {
  ctx.beginPath();
  ctx.arc(b.x, b.y, BADGE_R_M * (1.25 + PENDING_GROW * pulse), 0, 2 * Math.PI);
  ctx.strokeStyle = withAlpha(paint.solid[b.to] ?? paint.badge, 0.9 * (1 - pulse));
  ctx.lineWidth = PENDING_STROKE_M;
  ctx.stroke();
}

/** Breach badge on a wall edge: red circle with a white bar and dot. The edge is at the badge center. */
function drawBreachBadge(ctx: Ctx, e: ZoneEdge, paint: ZonePaint): void {
  const C = TERMINAL_CELL_M;
  const r = BADGE_R_M;
  // Edge coordinates are logical cells; the badge sits at the middle of the edge.
  const x = e.horizontal ? (e.x + 0.5) * C : e.x * C;
  const y = e.horizontal ? e.y * C : (e.y + 0.5) * C;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = paint.breach;
  ctx.fill();
  ctx.strokeStyle = paint.badge;
  ctx.lineWidth = BREACH_STROKE_M;
  ctx.stroke();
  ctx.fillStyle = paint.badge;
  ctx.fillRect(x - BREACH_BAR_W_M / 2, y - r * 0.55, BREACH_BAR_W_M, r * 0.7);
  ctx.beginPath();
  ctx.arc(x, y + r * 0.45, BREACH_DOT_R_M, 0, 2 * Math.PI);
  ctx.fill();
}

/** Clear space kept between two badges, in meters. */
const BADGE_GAP_M = 0.2;
const shownCache = new WeakMap<TerminalGrid, ZoneEdge[]>();

/**
 * The breach badges that fit, none on the default split of unzoned floor: a badge that would touch a transition badge, the largest pending ring or a breach
 * badge kept earlier is left out, so badges never overlap. Breaches come in edge order, so the choice is stable.
 */
function shownBreaches(g: TerminalGrid, breaches: readonly ZoneEdge[], badges: readonly TransitionBadge[], pending: readonly TransitionBadge[]): ZoneEdge[] {
  const cached = shownCache.get(g);
  if (cached) return cached;
  const C = TERMINAL_CELL_M;
  const r = BADGE_R_M;
  const taken: { x: number; y: number; r: number }[] = [];
  for (const b of badges) taken.push({ x: b.x, y: b.y, r });
  for (const b of pending) taken.push({ x: b.x, y: b.y, r: r * (1.25 + PENDING_GROW) + PENDING_STROKE_M / 2 });
  const out: ZoneEdge[] = [];
  for (const e of breaches) {
    // Between two unzoned cells the edge is the default landside and airside split (T95): its line shows it, a badge
    // on every cell of it would only be noise. Nobody walks across it all the same.
    const c = (e.y - g.y0) * g.w + (e.x - g.x0);
    if (g.zone[c] === 0 && g.zone[e.horizontal ? c - g.w : c - 1] === 0) continue;
    const x = e.horizontal ? (e.x + 0.5) * C : e.x * C;
    const y = e.horizontal ? e.y * C : (e.y + 0.5) * C;
    if (taken.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + r + BADGE_GAP_M)) continue;
    taken.push({ x, y, r });
    out.push(e);
  }
  shownCache.set(g, out);
  return out;
}

/** Zone id of a floor cell of the grid, 0 outside the grid or without floor. */
function zoneAt(eff: Uint8Array, W: number, H: number, x: number, y: number): number {
  return x < 0 || y < 0 || x >= W || y >= H ? 0 : eff[y * W + x]!;
}

/**
 * Zones overlay of one terminal grid, drawn in grid meters: the caller maps grid meters to the device. Floor cells
 * take their effective zone tint (staff hatched), every edge where the zone changes or the floor ends gets an inner
 * line, each transition fixture an arrow badge and each breach a red badge. An exit whose zone is not carried on yet
 * gets a ring that grows and fades with pulse, from 0 to 1.
 */
export function drawZoneOverlay(ctx: Ctx, g: TerminalGrid, colors: ZoneColors, pulse = 0): void {
  const C = TERMINAL_CELL_M;
  const paint = paintFor(colors);
  const { eff, badges, pending, breaches } = viewOf(g);
  const W = g.w;
  ctx.save();
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < W; x++) {
      const z = eff[y * W + x]!;
      if (z === 0) continue;
      const X = (g.x0 + x) * C;
      const Y = (g.y0 + y) * C;
      ctx.fillStyle = z === ZONE.Staff ? paint.staffTint : paint.tint[z]!;
      ctx.fillRect(X, Y, C, C);
      if (z === ZONE.Staff) hatchCell(ctx, X, Y, paint);
      ctx.strokeStyle = paint.line[z]!;
      ctx.lineWidth = EDGE_WIDTH_M;
      // A side gets its line when the neighbour zone differs or the floor ends there. Sides: 0 left, 1 right, 2 top, 3 bottom.
      if (zoneAt(eff, W, g.h, x - 1, y) !== z) edgeLine(ctx, X, Y, 0);
      if (zoneAt(eff, W, g.h, x + 1, y) !== z) edgeLine(ctx, X, Y, 1);
      if (zoneAt(eff, W, g.h, x, y - 1) !== z) edgeLine(ctx, X, Y, 2);
      if (zoneAt(eff, W, g.h, x, y + 1) !== z) edgeLine(ctx, X, Y, 3);
    }
  }
  for (const b of pending) drawPendingRing(ctx, b, paint, pulse);
  for (const b of badges) drawTransitionBadge(ctx, b, paint);
  for (const e of shownBreaches(g, breaches, badges, pending)) drawBreachBadge(ctx, e, paint);
  ctx.restore();
}
