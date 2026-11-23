import { PAINT, SURFACE_SPEC } from '@data/index';
import { padPolygon } from '@shared/turnPad';
import type { Sign } from '@shared/pavement/pavement';
import type { AirfieldPayload, Runway, Surface } from '@shared/airfield';

import { FIXTURE_FOOTPRINT, FLOOR, fixtureKey, footprintOf, isBaggageFixture, TERMINAL_CELL_M, WALL, type FixtureKey, type TerminalGrid } from '@shared/business';
import { carouselSize, drawCenter, drawFootprint, dropRampCenter, stagingLaneCenters, type BagDrawNode } from '@shared/baggageNodes';
import { ACROSS, cellIndex, hEdgeIndex, ROT_STEP, vEdgeIndex, worldToCell } from '@shared/terminalOps';
import { layerOf, PROP_CATEGORIES, PROP_STEP_M, propRect, propSpec } from '@shared/props';
import { BAND_RASTER_SCALE, chunkSizeM } from '../chunks';
import type { GhostPreview } from '@shared/ghost';
import type { FixtureWorks } from '@shared/fixtureLevels';
import { bakeFixture, drawFixture, type FixtureSprite } from '../sprites/fixtureSprite';
import { tierForZoom, type Rot, type Tier } from '../sprites/fixturePlan';
import type { KitCategory } from '../sprites/fixtureKit';
import { paintStands } from './standPaint';
import { paintTowers } from './towerPaint';
import { paintBuildings, paintDepots, paintRoadCrossings, paintRoadLines, paintRoadSurface } from './roadPaint';
import { pavementColor, planFor, type Area, type HoldMark, type Line, type Plan } from './taxiPlan';
import { TRAVELATOR_ASSETS } from '@shared/travelator';
import { TENANTS } from '@data/index';
import type { TenantUnitView } from '@shared/tenants';

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

const shoulderColor = (s: Surface): string => SURFACE_SPEC[s].shoulderColor ?? SURFACE_SPEC[s].color;
const WHITE = '#f1f1ec';
const YELLOW = PAINT.colors.yellow;
const TW = PAINT.taxiway;
const SLAB_JOINT = 'rgba(40,38,34,0.18)';
const RED = '#d8362f';
const THRESHOLD_STRIPES: Record<number, number> = { 18: 4, 23: 6, 30: 8, 45: 12, 60: 16 };
/** Kit asset drawn for each terminal fixture. Belt, shops and atc keep block drawing: their kit footprint differs from the game footprint and sprites are never scaled. */
export const FIXTURE_ASSET: Partial<Record<FixtureKey, string>> = {
  kiosk: 'kiosk',
  bagDrop: 'bagDrop',
  seating: 'bench.beam3',
  toilet: 'washroom.wcStall',
  eGate: 'eGate',
  customs: 'customs',
};
/** Kit asset per level of a fixture with levels, index level minus 1 (T74 for the four leveled families). */
export const FIXTURE_LEVEL_ASSET: Partial<Record<FixtureKey, readonly string[]>> = {
  checkIn: ['checkIn.l1', 'checkIn.l2', 'checkIn.l3'],
  security: ['security.l1', 'security.l2', 'security.l3'],
  passport: ['passport.l1', 'passport.l2', 'passport.l3'],
  gateDesk: ['gateDesk.l1', 'gateDesk.l2', 'gateDesk.l3'],
  securityExit: ['securityExit.staffed', 'securityExit.auto', 'securityExit.revolving'],
  travelator: TRAVELATOR_ASSETS,
};
/**
 * Extra turn in degrees of a kit sprite whose people flow along its x axis. The security lane art flows left to right
 * along its 16 m length, while a game footprint flows against its across axis, so the art turns a further 270 degrees.
 * The travelator art runs its belts down its y axis, while its game footprint runs along, so it turns 270 degrees too.
 */
export const KIT_FLOW_TURN: Partial<Record<FixtureKey, Rot>> = { security: 270, travelator: 270 };
/** Cells a fixture body can reach past its anchor, the longest footprint side minus one. */
const FOOTPRINT_REACH = Math.max(...Object.values(FIXTURE_FOOTPRINT).flatMap((levels) => levels.flatMap(([a, b]: readonly [number, number]) => [a - 1, b - 1])));
/** Kit asset of a staff door, drawn on its wall edge. */
export const STAFF_DOOR_ASSET = 'staffDoor';
/** Kit packs the terminal painter needs before its chunks bake. */
export const TERMINAL_KIT_PACKS: readonly KitCategory[] = ['processing', 'baggage', 'zoning', 'circulation', ...PROP_CATEGORIES];
/** Rotation in degrees of a two cell fixture by its footprint code 1 to 4, see fixtureRot in TerminalGrid. */
const KIT_ROT: readonly Rot[] = [0, 90, 180, 270];
/** Kit assets of the baggage nodes that do not depend on a bay width. */
export const BAG_FIXED_ASSETS: readonly string[] = ['screeningMachine', 'carousel', 'carousel.s', 'carousel.l', 'ramp.out', 'ramp.unconnected', 'stagingLane'];
const BAG_BLOCK_COLOR = '#8e959c';

/** Kit asset of a carousel by its length in cells. */
export function carouselAssetId(widthCells: number): string {
  const id = carouselSize(widthCells).id;
  return id === 'M' ? 'carousel' : `carousel.${id.toLowerCase()}`;
}

/** Kit asset of a baggage node's body: a drop has none, it draws only its ramp stub. */
export function bagAssetId(n: BagDrawNode): string | null {
  if (n.kind === 'machine') return 'screeningMachine';
  // The medium carousel keeps the kit id it had before sizes (T78).
  if (n.kind === 'carousel') return carouselAssetId(n.widthCells);
  if (n.kind === 'bay') return `baggageBay.w${n.widthCells}`;
  return null;
}

/** Footprint center in grid meters and kit rotation in degrees of a baggage node, null for a drop. */
export function bagPlacement(n: BagDrawNode): { x: number; y: number; rot: Rot } | null {
  const c = drawCenter(n);
  return c === null ? null : { x: c[0] * TERMINAL_CELL_M, y: c[1] * TERMINAL_CELL_M, rot: KIT_ROT[n.rot] };
}

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

/** A line width in meters that never falls below `minPx` device pixels at the bake scale. */
const lineM = (w: Window, meters: number, minPx = 0.9): number => Math.max(meters, minPx / w.scale);

/** Paints the airfield pavement and markings of one chunk into its canvas context. */
export function paintAirfield(ctx: Ctx, af: AirfieldPayload, terminals: readonly TerminalGrid[], band: number, cx: number, cy: number): void {
  if (af.runways.length === 0 && af.taxiways.length === 0 && af.aprons.length === 0 && af.stands.length === 0 && (af.towers?.length ?? 0) === 0 && (af.roads?.length ?? 0) === 0 && (af.depots?.length ?? 0) === 0 && (af.buildings?.length ?? 0) === 0 && terminals.length === 0) return;
  const scale = BAND_RASTER_SCALE[band];
  const size = chunkSizeM(band);
  const ox = cx * size;
  const oy = cy * size;
  const pad = 120;
  const win: Window = { minX: ox - pad, minY: oy - pad, maxX: ox + size + pad, maxY: oy + size + pad, scale };
  ctx.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);

  paintGroundContact(ctx, af, terminals, win);

  const plan = planFor(af);
  // Shoulders go under the aprons, so a taxiway entering an apron shows no shoulder band on it.
  paintAreas(ctx, plan.shoulders, win);
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
    ctx.fillStyle = pavementColor(a.surface);
    ctx.beginPath();
    for (const r of [a.polygon, ...(a.holes ?? [])]) {
      ctx.moveTo(r[0].x, r[0].y);
      for (let i = 1; i < r.length; i++) ctx.lineTo(r[i].x, r[i].y);
      ctx.closePath();
    }
    ctx.fill('evenodd');
    // Concrete slab joints on a world grid, clipped to the apron.
    const slab = SURFACE_SPEC[a.surface].slabJointM;
    if (slab !== null && win.scale >= 1) {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = SLAB_JOINT;
      ctx.lineWidth = 1 / win.scale;
      ctx.beginPath();
      const x0 = Math.max(minX, win.minX);
      const x1 = Math.min(maxX, win.maxX);
      const y0 = Math.max(minY, win.minY);
      const y1 = Math.min(maxY, win.maxY);
      for (let x = Math.ceil(x0 / slab) * slab; x <= x1; x += slab) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      for (let y = Math.ceil(y0 / slab) * slab; y <= y1; y += slab) {
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Service roads go under the taxiway pavement they cross, so the taxiway stays continuous (T60). They are
  // clipped off the shoulders too; paintRoadCrossings carries them on faintly over both.
  ctx.save();
  ctx.beginPath();
  ctx.rect(win.minX, win.minY, win.maxX - win.minX, win.maxY - win.minY);
  for (const a of plan.shoulders) {
    if (!overlaps(win, a.minX, a.minY, a.maxX, a.maxY)) continue;
    for (const r of a.rings) {
      ctx.moveTo(r[0].x, r[0].y);
      for (let i = 1; i < r.length; i++) ctx.lineTo(r[i].x, r[i].y);
      ctx.closePath();
    }
  }
  ctx.clip('evenodd');
  paintRoadSurface(ctx, af.roads ?? [], win);
  paintRoadLines(ctx, af, win);
  ctx.restore();
  paintAreas(ctx, plan.areas, win);
  for (const r of af.runways) paintRunwayPavement(ctx, r, win);
  // Turn pad pavement joins the runway end fill in the same surface color, and the yellow turn curve
  // sits on the pad under all white paint (docs/ART_AND_ASSETS.md section 8).
  for (const r of af.runways) {
    if (!overlaps(win, ...runwayBounds(r))) continue;
    for (const end of ['a', 'b'] as const) {
      const side = r.pads?.[end];
      if (!side) continue;
      ctx.fillStyle = pavementColor(r.surface);
      const poly = padPolygon(r, end, side);
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fill();
    }
  }
  strokeLines(ctx, plan.padCurves, win, YELLOW, TW.centerlineWidthM, TW.centerlineMinPx);
  paintTaxiPlan(ctx, af, plan, win);
  for (const h of plan.holds) paintHold(ctx, h, win);
  for (const r of af.runways) paintRunwayMarks(ctx, r, win, plan);
  for (const g of terminals) paintTerminal(ctx, g, win);
  paintStands(ctx, af, af.stands, win);
  paintTowers(ctx, af.towers ?? [], win);
  paintDepots(ctx, af.depots ?? [], win);
  paintBuildings(ctx, af.buildings ?? [], win);
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
  let x0 = Math.min(r.x1, r.x2) - m;
  let y0 = Math.min(r.y1, r.y2) - m;
  let x1 = Math.max(r.x1, r.x2) + m;
  let y1 = Math.max(r.y1, r.y2) + m;
  // A pad reaches past the runway end and sticks out sideways, so the culling box must include both.
  for (const end of ['a', 'b'] as const) {
    const side = r.pads?.[end];
    if (!side) continue;
    for (const p of padPolygon(r, end, side)) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  return [x0, y0, x1, y1];
}

function paintAreas(ctx: Ctx, areas: readonly Area[], win: Window): void {
  for (const a of areas) {
    if (!overlaps(win, a.minX, a.minY, a.maxX, a.maxY)) continue;
    ctx.fillStyle = a.color;
    ctx.beginPath();
    for (const r of a.rings) {
      ctx.moveTo(r[0].x, r[0].y);
      for (let i = 1; i < r.length; i++) ctx.lineTo(r[i].x, r[i].y);
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }
}

function drawLines(ctx: Ctx, lines: readonly Line[], win: Window, outlinedOnly = false): void {
  ctx.beginPath();
  for (const l of lines) {
    if (outlinedOnly && !l.outlined) continue;
    if (!overlaps(win, l.minX, l.minY, l.maxX, l.maxY)) continue;
    ctx.moveTo(l.pts[0].x, l.pts[0].y);
    for (let i = 1; i < l.pts.length; i++) ctx.lineTo(l.pts[i].x, l.pts[i].y);
  }
  ctx.stroke();
}

/** Strokes lines in one color, with a dark outline under the ones on concrete (docs/DESIGN_REVISION_2.md section 1). */
function strokeLines(ctx: Ctx, lines: readonly Line[], win: Window, color: string, widthM: number, minPx: number): void {
  const w = lineM(win, widthM, minPx);
  ctx.strokeStyle = PAINT.colors.outline;
  ctx.lineWidth = w + (2 * TW.concreteOutlinePx) / win.scale;
  drawLines(ctx, lines, win, true);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  drawLines(ctx, lines, win);
}

/** Unpaved taxiways: yellow edge markers with a dark outline, no paint. */
function paintMarkers(ctx: Ctx, markers: readonly { x: number; y: number }[], win: Window): void {
  const size = lineM(win, TW.unpavedMarkerSizeM, TW.unpavedMarkerMinPx);
  ctx.fillStyle = YELLOW;
  ctx.strokeStyle = PAINT.colors.markerOutline;
  ctx.lineWidth = 0.8 / win.scale;
  for (const m of markers) {
    if (!overlaps(win, m.x - size, m.y - size, m.x + size, m.y + size)) continue;
    ctx.fillRect(m.x - size / 2, m.y - size / 2, size, size);
    ctx.strokeRect(m.x - size / 2, m.y - size / 2, size, size);
  }
}

/** Taxiway signs: a yellow on black location box between black on yellow direction boxes, text inside each box. */
function paintSign(ctx: Ctx, sg: Sign, win: Window): void {
  const h = TW.signHeightM;
  const widths = sg.parts.map((p) => [...p.text].length * TW.signCharWidthM + h * 0.6);
  const total = widths.reduce((a, b) => a + b, 0);
  if (!overlaps(win, sg.x - total, sg.y - total, sg.x + total, sg.y + total)) return;
  ctx.save();
  ctx.translate(sg.x, sg.y);
  ctx.rotate(sg.angle);
  ctx.font = `bold ${h * 0.62}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = h * 0.06;
  let x = -total / 2;
  sg.parts.forEach((p, i) => {
    const w = widths[i];
    ctx.fillStyle = p.location ? PAINT.colors.signBlack : YELLOW;
    ctx.fillRect(x, -h / 2, w, h);
    ctx.strokeStyle = PAINT.colors.signBlack;
    ctx.strokeRect(x, -h / 2, w, h);
    ctx.fillStyle = p.location ? YELLOW : PAINT.colors.signBlack;
    ctx.fillText(p.text, x + w / 2, h * 0.04);
    x += w;
  });
  ctx.restore();
}

/** Taxiway paint from the plan: fillets, centerlines with lead-on curves, double edge lines, enhanced centerlines. */
function paintTaxiPlan(ctx: Ctx, af: AirfieldPayload, plan: Plan, win: Window): void {
  const surface = af.taxiways[0]?.surface ?? 'asphalt';
  ctx.fillStyle = pavementColor(surface);
  for (const patch of plan.patches) {
    const first = patch[0];
    if (!overlaps(win, first.x - 80, first.y - 80, first.x + 80, first.y + 80)) continue;
    ctx.beginPath();
    ctx.moveTo(patch[0].x, patch[0].y);
    for (let i = 1; i < patch.length; i++) ctx.lineTo(patch[i].x, patch[i].y);
    ctx.closePath();
    ctx.fill();
  }
  paintRoadCrossings(ctx, af, win);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  // Taxiway centerline and edge lines (docs/DESIGN_REVISION_2.md section 2.4).
  if (win.scale >= 1) {
    ctx.strokeStyle = SLAB_JOINT;
    ctx.lineWidth = 1 / win.scale;
    drawLines(ctx, plan.joints, win);
  }
  paintMarkers(ctx, plan.markers, win);
  strokeLines(ctx, plan.stripes, win, YELLOW, TW.shoulderStripeWidthM, TW.shoulderStripeMinPx);
  strokeLines(ctx, plan.centerlines, win, YELLOW, TW.centerlineWidthM, TW.centerlineMinPx);
  ctx.strokeStyle = YELLOW;
  ctx.lineWidth = lineM(win, TW.centerlineWidthM, TW.centerlineMinPx);
  strokeLines(ctx, plan.redCenterlines, win, RED, TW.centerlineWidthM, TW.centerlineMinPx);
  if (win.scale >= 1) {
    strokeLines(ctx, plan.edges, win, YELLOW, TW.edgeLineWidthM, TW.edgeLineMinPx);
    for (const sg of plan.signs) paintSign(ctx, sg, win);
    ctx.strokeStyle = YELLOW;
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
    ctx.fillStyle = shoulderColor(r.surface);
    ctx.fillRect(0, -half - r.shoulderM, r.lengthM, r.widthM + 2 * r.shoulderM);
  }
  ctx.fillStyle = pavementColor(r.surface);
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
  if (preview.stands) paintStands(ctx, af, preview.stands, win);
  if (preview.towers) paintTowers(ctx, preview.towers, win);
  if (preview.roads) {
    paintRoadSurface(ctx, preview.roads, win);
    paintRoadLines(ctx, { ...af, roads: preview.roads }, win);
  }
  if (preview.depots) paintDepots(ctx, preview.depots, win);
  if (preview.buildings) paintBuildings(ctx, preview.buildings, win);
}

const FLOOR_COLOR = ['', '#a9aeb3', '#d3dadd', '#7f90a8'];
const FIXTURE_COLOR = ['', '#3f7fd8', '#e08a2e', '#8b95a0', '#3aa89a', '#9a5cc8', '#d85c5c', '#e0a030', '#b87a4a', '#c8a8e8', '#5aa860', '#4ab0b8', '#2c3441', '#4f6d8f', '#8a9bb3', '#c49a3c', '#9c8a6c', '', '', '', '#2f6fd1', '#7a4fd0', '#3ea35a'];
const FIXTURE_LETTER = ['', 'C', 'S', 'B', '', 'WC', 'Sh', 'F', 'Cf', 'DF', 'Bk', 'Rx', 'T', 'K', 'D', 'P', 'G', '', '', '', 'X', 'E', 'Cu'];
const STAFF_DOOR_COLOR = '#d9463e';

/** Body of a fixture in meters: its footprint from the anchor along and across its direction, and the kit rotation. */
interface FixtureBody {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: Rot;
}

/** Body of the fixture whose anchor is cell (cx, cy). A footprint code 0 is one cell with no direction. */
function fixtureBody(f: number, code: number, level: number, cx: number, cy: number): FixtureBody {
  const C = TERMINAL_CELL_M;
  const rot = code === 0 ? 0 : code - 1;
  const [along, across] = footprintOf(fixtureKey(f), level);
  const [ax, ay] = ROT_STEP[rot];
  const [bx, by] = ACROSS(rot);
  const minX = cx + Math.min(0, (along - 1) * ax) + Math.min(0, (across - 1) * bx);
  const minY = cy + Math.min(0, (along - 1) * ay) + Math.min(0, (across - 1) * by);
  return {
    x: minX * C,
    y: minY * C,
    w: (along * Math.abs(ax) + across * Math.abs(bx)) * C,
    h: (along * Math.abs(ay) + across * Math.abs(by)) * C,
    rot: ((KIT_ROT[rot] + (KIT_FLOW_TURN[fixtureKey(f)] ?? 0)) % 360) as Rot,
  };
}

/** Kit asset of a fixture at a level, or undefined when it has no kit sprite. */
function kitAssetOf(key: FixtureKey, level: number): string | undefined {
  const levels = FIXTURE_LEVEL_ASSET[key];
  if (levels !== undefined) return levels[Math.max(level, 1) - 1];
  return FIXTURE_ASSET[key];
}

/** Baked kit sprite for a fixture id, level and footprint code, or null when its block drawing applies. */
function kitSpriteAt(f: number, level: number, code: number, tier: 0 | Tier, scale: number): FixtureSprite | null {
  if (tier === 0 || f === 0 || code >= 5) return null;
  const asset = kitAssetOf(fixtureKey(f), level);
  if (asset === undefined) return null;
  const turn = KIT_FLOW_TURN[fixtureKey(f)] ?? 0;
  return bakeFixture(asset, tier, (((code === 0 ? 0 : KIT_ROT[code - 1]) + turn) % 360) as Rot, scale, null);
}

/** Draws the kit sprites of the fixtures in a cell range at their footprint centers. */
function paintKitFixtures(ctx: Ctx, g: TerminalGrid, x0: number, y0: number, x1: number, y1: number, tier: 0 | Tier, scale: number): void {
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const i = cellIndex(g, cx, cy);
      const code = g.fixtureRot[i];
      const sprite = kitSpriteAt(g.fixture[i], g.fixtureLevel[i], code, tier, scale);
      if (sprite === null) continue;
      const body = fixtureBody(g.fixture[i], code, g.fixtureLevel[i], cx, cy);
      drawFixture(ctx, sprite, body.x + body.w / 2, body.y + body.h / 2, body.rot);
    }
  }
}

const WORKS_FILL = 'rgba(232,170,40,0.28)';
const WORKS_STRIPE = 'rgba(160,104,10,0.75)';
/** Stripe pitch of the works hatch in meters. */
const WORKS_PITCH_M = 0.8;

/** Hatches the body of every fixture under upgrade works (T74), so a closed desk reads at a glance. */
function paintFixtureWorks(ctx: Ctx, g: TerminalGrid, works: readonly FixtureWorks[], win: Window): void {
  for (const w of works) {
    const i = cellIndex(g, w.x, w.y);
    if (i < 0 || g.fixture[i] === 0) continue;
    const b = fixtureBody(g.fixture[i], g.fixtureRot[i], g.fixtureLevel[i], w.x, w.y);
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    ctx.fillStyle = WORKS_FILL;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = WORKS_STRIPE;
    ctx.lineWidth = lineM(win, 0.2);
    ctx.beginPath();
    for (let d = -b.h; d < b.w; d += WORKS_PITCH_M) {
      ctx.moveTo(b.x + d, b.y + b.h);
      ctx.lineTo(b.x + d + b.h, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/** Margin in meters around the window within which props are drawn, so a prop straddling the edge is not cut off. */
const PROP_MARGIN_M = 8;

/**
 * Draws the props of a floor (T76) on one layer pass, in placement order: floor layer props under the fixtures, then
 * floor, wall and desktop props, then overhead props. Each sprite sits centered in its footprint, turned by its rot.
 */
function paintProps(ctx: Ctx, g: TerminalGrid, pass: 'under' | 'body' | 'over', minM: { x: number; y: number }, maxM: { x: number; y: number }, tier: 0 | Tier, scale: number): void {
  if (tier === 0 || g.props.length === 0) return;
  for (const p of g.props) {
    const spec = propSpec(p.asset);
    if (!spec) continue;
    const layer = layerOf(spec);
    const want = layer === 'floorLayer' ? 'under' : layer === 'overhead' ? 'over' : 'body';
    if (want !== pass) continue;
    const r = propRect(p)!;
    const cx = ((r.sx0 + r.sx1) / 2) * PROP_STEP_M;
    const cy = ((r.sy0 + r.sy1) / 2) * PROP_STEP_M;
    if (cx < minM.x - PROP_MARGIN_M || cy < minM.y - PROP_MARGIN_M || cx > maxM.x + PROP_MARGIN_M || cy > maxM.y + PROP_MARGIN_M) continue;
    const rot = KIT_ROT[p.rot];
    const sprite = bakeFixture(p.asset, tier, rot, scale, null);
    if (sprite !== null) drawFixture(ctx, sprite, cx, cy, rot);
  }
}

/**
 * Paints tenant units in a cell range (T32): a leased unit gets its floor, its furnishing from the brand template, the
 * storefront sign in the brand color and the brand name when it fits; a vacant unit a dashed outline over light hatching.
 */
function paintUnits(ctx: Ctx, units: readonly TenantUnitView[], x0: number, y0: number, x1: number, y1: number, win: Window): void {
  const C = TERMINAL_CELL_M;
  const P = TENANTS.paint;
  for (const u of units) {
    if (u.x > x1 || u.y > y1 || u.x + u.w <= x0 || u.y + u.h <= y0) continue;
    const X = u.x * C;
    const Y = u.y * C;
    const W = u.w * C;
    const H = u.h * C;
    if (!u.tenant) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(X, Y, W, H);
      ctx.clip();
      ctx.strokeStyle = 'rgba(60,70,80,0.18)';
      ctx.lineWidth = lineM(win, 0.08);
      ctx.beginPath();
      for (let d = -H; d < W; d += 1.2) {
        ctx.moveTo(X + d, Y + H);
        ctx.lineTo(X + d + H, Y);
      }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(60,70,80,0.7)';
      ctx.lineWidth = lineM(win, P.outlineM);
      ctx.setLineDash([0.8, 0.5]);
      ctx.strokeRect(X + P.outlineM / 2, Y + P.outlineM / 2, W - P.outlineM, H - P.outlineM);
      ctx.setLineDash([]);
      continue;
    }
    ctx.fillStyle = P.floor;
    ctx.fillRect(X, Y, W, H);
    for (const it of u.furnish ?? []) {
      ctx.fillStyle = it.kind === 'sign' ? u.tenant.color : P[it.kind];
      ctx.fillRect(it.x0, it.y0, it.x1 - it.x0, it.y1 - it.y0);
    }
    ctx.strokeStyle = u.tenant.color;
    ctx.lineWidth = lineM(win, P.outlineM);
    ctx.strokeRect(X + P.outlineM / 2, Y + P.outlineM / 2, W - P.outlineM, H - P.outlineM);
    // The brand name in white on the sign band, turned along a side band, only when it fits the band with a margin.
    const band = (u.furnish ?? []).find((it) => it.kind === 'sign');
    if (band && win.scale >= 2) {
      const bw = band.x1 - band.x0;
      const bh = band.y1 - band.y0;
      const upright = bh > bw;
      const length = upright ? bh : bw;
      const depth = upright ? bw : bh;
      const size = depth * 0.7;
      ctx.font = `bold ${size}px sans-serif`;
      if (ctx.measureText(u.tenant.name).width <= length - 2 * P.marginM) {
        ctx.save();
        ctx.translate((band.x0 + band.x1) / 2, (band.y0 + band.y1) / 2);
        if (upright) ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(u.tenant.name, 0, size * 0.05);
        ctx.restore();
      }
    }
  }
}

/** Draws the kit staff door centered on each staff door edge in a cell range, 0.45 m into the cell below or right. */
function paintStaffDoors(ctx: Ctx, g: TerminalGrid, x0: number, y0: number, x1: number, y1: number, tier: 0 | Tier, scale: number): void {
  if (tier === 0) return;
  const C = TERMINAL_CELL_M;
  const inset = 0.45;
  const horizontal = bakeFixture(STAFF_DOOR_ASSET, tier, 0, scale, null);
  const vertical = bakeFixture(STAFF_DOOR_ASSET, tier, 90, scale, null);
  for (let y = y0; y <= y1 + 1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (horizontal !== null && g.hWall[hEdgeIndex(g, x, y)] === WALL.StaffDoor) drawFixture(ctx, horizontal, (x + 0.5) * C, y * C + inset, 0);
    }
  }
  for (let x = x0; x <= x1 + 1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (vertical !== null && g.vWall[vEdgeIndex(g, x, y)] === WALL.StaffDoor) drawFixture(ctx, vertical, x * C + inset, (y + 0.5) * C, 90);
    }
  }
}

/** A flat block of w by d meters centered on (x, y) and turned by rot degrees, the fallback without a kit sprite. */
function fillBlock(ctx: Ctx, x: number, y: number, rot: Rot, wM: number, dM: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.fillStyle = BAG_BLOCK_COLOR;
  ctx.fillRect(-wM / 2, -dM / 2, wM, dM);
  ctx.restore();
}

/** Draws one kit asset centered at a logical cell point, or a flat block of the given size when it cannot. */
function drawBagAsset(ctx: Ctx, id: string, at: readonly [number, number], rot: Rot, tier: 0 | Tier, scale: number, blockM: readonly [number, number] | null): void {
  const C = TERMINAL_CELL_M;
  const sprite = tier === 0 ? null : bakeFixture(id, tier, rot, scale, null);
  if (sprite !== null) drawFixture(ctx, sprite, at[0] * C, at[1] * C, rot);
  else if (blockM !== null) fillBlock(ctx, at[0] * C, at[1] * C, rot, blockM[0], blockM[1]);
}

/** Draws the baggage nodes of one building: machines, bays and carousels, drop ramp stubs and bay staging lanes. */
function paintBagNodes(ctx: Ctx, nodes: readonly BagDrawNode[], tier: 0 | Tier, scale: number): void {
  const C = TERMINAL_CELL_M;
  for (const n of nodes) {
    const rot = KIT_ROT[n.rot];
    if (n.kind === 'drop') {
      drawBagAsset(ctx, n.linked ? 'ramp.out' : 'ramp.unconnected', dropRampCenter(n), rot, tier, scale, [C, C]);
      continue;
    }
    const id = bagAssetId(n);
    const size = drawFootprint(n);
    const c = drawCenter(n);
    if (id === null || size === null || c === null) continue;
    drawBagAsset(ctx, id, c, rot, tier, scale, [size.w * C, size.d * C]);
    for (const lane of stagingLaneCenters(n)) drawBagAsset(ctx, 'stagingLane', lane, rot, tier, scale, null);
  }
}

/** Draws one terminal building as a cutaway: floors, walls, doors and fixtures. */
function paintTerminal(ctx: Ctx, g: TerminalGrid, win: Window): void {
  const C = TERMINAL_CELL_M;
  const tier = tierForZoom(win.scale);
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
  // Logical cells of the building's grid that fall under the window.
  const x0 = Math.max(g.x0, Math.floor(minX));
  const y0 = Math.max(g.y0, Math.floor(minY));
  const x1 = Math.min(g.x0 + g.w - 1, Math.ceil(maxX));
  const y1 = Math.min(g.y0 + g.h - 1, Math.ceil(maxY));
  if (x1 < x0 || y1 < y0) return;
  ctx.save();
  ctx.translate(g.ox, g.oy);
  ctx.rotate((g.headingDeg * Math.PI) / 180 - Math.PI / 2);
  // Cleared pad and soft edge darkening so the building looks seated on the ground. Baked into the chunk.
  const at = (cx: number, cy: number): number => cellIndex(g, cx, cy);
  const filled = (cx: number, cy: number): boolean => at(cx, cy) >= 0 && g.floor[at(cx, cy)] > 0;
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
      const f = cx <= x1 ? g.floor[at(cx, cy)] : 0;
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
        if (g.floor[at(cx, cy)] === FLOOR.None) continue;
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
  // Fixtures. A footprint can reach several cells past its anchor (a security lane is eight cells long), so the loops
  // widen by that reach to catch an anchor just outside the window whose body is inside it. Tail cells (code 5 to 8) are skipped.
  const fx0 = Math.max(g.x0, x0 - FOOTPRINT_REACH);
  const fy0 = Math.max(g.y0, y0 - FOOTPRINT_REACH);
  const fx1 = Math.min(g.x0 + g.w - 1, x1 + FOOTPRINT_REACH);
  const fy1 = Math.min(g.y0 + g.h - 1, y1 + FOOTPRINT_REACH);
  for (let cy = fy0; cy <= fy1; cy++) {
    for (let cx = fx0; cx <= fx1; cx++) {
      const i = at(cx, cy);
      const code = g.fixtureRot[i];
      const f = g.fixture[i];
      if (f === 0 || code >= 5 || isBaggageFixture(f) || kitSpriteAt(f, g.fixtureLevel[i], code, tier, win.scale) !== null) continue;
      // A short shadow under each fixture lifts it off the floor in the same cheap way.
      const body = fixtureBody(f, code, g.fixtureLevel[i], cx, cy);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(body.x + 0.45, body.y + 0.45, body.w - 0.4, body.h - 0.4);
    }
  }
  if (g.units) paintUnits(ctx, g.units, x0, y0, x1, y1, win);
  const propMin = { x: x0 * C, y: y0 * C };
  const propMax = { x: (x1 + 1) * C, y: (y1 + 1) * C };
  paintProps(ctx, g, 'under', propMin, propMax, tier, win.scale);
  paintKitFixtures(ctx, g, fx0, fy0, fx1, fy1, tier, win.scale);
  paintProps(ctx, g, 'body', propMin, propMax, tier, win.scale);
  paintProps(ctx, g, 'over', propMin, propMax, tier, win.scale);
  if (g.works) paintFixtureWorks(ctx, g, g.works, win);
  paintStaffDoors(ctx, g, x0, y0, x1, y1, tier, win.scale);
  if (g.bagNodes) paintBagNodes(ctx, g.bagNodes, tier, win.scale);
  for (let cy = fy0; cy <= fy1; cy++) {
    for (let cx = fx0; cx <= fx1; cx++) {
      const i = at(cx, cy);
      const f = g.fixture[i];
      const code = g.fixtureRot[i];
      if (f === 0 || code >= 5 || isBaggageFixture(f) || kitSpriteAt(f, g.fixtureLevel[i], code, tier, win.scale) !== null) continue;
      const body = fixtureBody(f, code, g.fixtureLevel[i], cx, cy);
      ctx.fillStyle = FIXTURE_COLOR[f];
      ctx.fillRect(body.x + 0.2, body.y + 0.2, body.w - 0.4, body.h - 0.4);
      if (f === 4 && code === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(cx * C + 0.5, cy * C + 0.7, C - 1, 0.6);
      } else if (win.scale >= 2 && FIXTURE_LETTER[f]) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 1px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(FIXTURE_LETTER[f], body.x + body.w / 2, body.y + body.h / 2);
      }
    }
  }
  // Walls, glass, doors and staff doors on grid lines, merged into runs per type.
  const wallStyle = (t: number): void => {
    ctx.strokeStyle = t === WALL.Wall ? '#37424c' : t === WALL.Glass ? '#79bde8' : t === WALL.StaffDoor ? STAFF_DOOR_COLOR : '#c58f3a';
    ctx.lineWidth = lineM(win, t === WALL.Wall ? 0.35 : t === WALL.Glass ? 0.22 : 0.3);
  };
  for (const t of [WALL.Wall, WALL.Glass, WALL.Door, WALL.StaffDoor]) {
    wallStyle(t);
    ctx.beginPath();
    for (let y = y0; y <= y1 + 1; y++) {
      let start = -1;
      for (let x = x0; x <= x1 + 1; x++) {
        const on = x <= x1 && g.hWall[hEdgeIndex(g, x, y)] === t;
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          ctx.moveTo(start * C, y * C);
          ctx.lineTo(x * C, y * C);
          start = -1;
        }
      }
    }
    for (let x = x0; x <= x1 + 1; x++) {
      let start = -1;
      for (let y = y0; y <= y1 + 1; y++) {
        const on = y <= y1 && g.vWall[vEdgeIndex(g, x, y)] === t;
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
