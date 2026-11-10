import { apronContains } from '@shared/apronGeom';
import { AIRFIELD, PAINT, STAND_SIZES, SURFACE_SPEC, SURFACE_DATA } from '@data/index';
import { sizeCode } from '@shared/standSizes';
import { codeIndex, compassVector, CODES, runwaySide, type AirfieldPayload, type CodeLetter, type HoldingPoint, type PadSide, type Runway, type Stand, type StandSize, type Taxiway } from '@shared/airfield';
import {
  frameHeadings,
  pickObject,
  runwayFrame as frameOf,
  rapidExitPoints,
  runwayFrame,
  snapToCenterline,
  snapToRunwayEdge,
  alignGuide,
  snapToVertex,
  suggestedExitDistance,
} from '@shared/airfieldGeom';
import type { Ghost, GhostShape } from '@shared/ghost';
import { closestOnSegment, distToSegment, type Pt } from '@shared/geom';
import { windBand, type SitePayload } from '@shared/site';
import { WALL, type TerminalGrid } from '@shared/business';
import { cellAtWorld, cellIndex, floorBounds, newGrid, originFor, planEdit, rectWorld, worldToCell, cornerWorld, type TerminalEdit } from '@shared/terminalOps';
import { checkPolygon, checkStrip, estimateStripCost, polygonArea, unownedParcelsUnder, type BuildContext, type Problem } from '@shared/validate';
import type { Command } from '@sim/commands';
import { planFor, smoothCorners } from '@render/markings/taxiPlan';
import { findSnap, TAXI_TOOL, taxiNodes, type SnapHit, type TaxiNode } from '@shared/pavement/snap';
import { envelopeType, taxiClashes } from '@shared/clearance';
import { runwayWorksDays } from '@shared/surfaceRules';
import { padArea, padCurve, padPolygon, padValue } from '@shared/turnPad';
import { previewPenetrations, surfaceOutlines, type Penetration } from '@shared/obstacles';
import { typeOutlines } from '@render/markings/standLayout';
import { gridById, gridsFor, snapToGrid, type ConstructionGrid } from '@shared/constructionGrid';
import { formatMoney, formatNumber } from '../format';
import { tFormat, type StringKey } from '../strings';
import { useGameStore } from '../stores/gameStore';
import { GRID_TOOLS, snapModeOf, useToolStore } from '../stores/toolStore';

export interface Mods {
  shift: boolean;
  alt: boolean;
  /** Ctrl or Cmd: the apron tool cuts instead of building. */
  ctrl?: boolean;
}

interface Deps {
  send(cmd: Command): void;
  setGhost(g: Ghost | null): void;
  zoom(): number;
  setHighlight(hover: GhostShape[] | null, selected: GhostShape[] | null): void;
  setCursor(cursor: string): void;
  setGuide(from: Pt | null, to: Pt | null): void;
}

const compassOf = (dx: number, dy: number): number => ((Math.round((Math.atan2(dx, -dy) * 180) / Math.PI) % 360) + 360) % 360;

/** How close the cursor must come to a runway threshold before a turn pad previews (task T01 spec). */
const TURN_PAD_REACH_M = 150;

/**
 * Turns pointer input into previews and build commands for the active tool. It holds
 * only the in progress gesture, everything else lives in the tool and game stores.
 */
export class ToolController {
  private start: Pt | null = null;
  private pts: Pt[] = [];
  private cursor: Pt = { x: 0, y: 0 };
  private dragging = false;
  /** The polygon being laid out cuts instead of building (Ctrl held on a click). */
  private cutting = false;
  /** After a refused drag the preview and its buy offer stay up until the next press. */
  private frozen = false;
  /** Alignment frame of the apron rectangle in progress, captured at the press. */
  private rectFrame: number | null = null;

  constructor(private readonly deps: Deps) {}

  private get af(): AirfieldPayload {
    return useGameStore.getState().airfield;
  }

  private ctx(): BuildContext | null {
    const { site, owner } = useGameStore.getState();
    if (!site || !owner) return null;
    return { heights: site.heights, parcelId: site.parcelId, parcelOwner: owner };
  }

  private site(): SitePayload | null {
    return useGameStore.getState().site;
  }

  /**
   * True while a drag gesture is waiting for its end point. The runway and terminal tools take a
   * start click and an end click, or a press and drag, so the player does not have to hold the mouse.
   */
  get armed(): boolean {
    const st = useToolStore.getState();
    if (st.tool === 'runway') return this.dragging && this.start !== null;
    if (st.tool === 'terminal') return this.dragging && this.tStart !== null;
    return false;
  }

  /** True for the tools where a plain click only sets the start point. */
  get twoClick(): boolean {
    const st = useToolStore.getState();
    return st.tool === 'runway' || (st.tool === 'terminal' && st.tSub !== 'door');
  }

  /** True while any gesture is in progress, so the map should scroll when the pointer reaches an edge. */
  get gestureActive(): boolean {
    return this.armed || this.dragging || this.pts.length > 0;
  }

  /** Outline shapes of an airfield object or terminal, for the hover and selection highlights. */
  shapesFor(kind: string, id: number): GhostShape[] {
    const af = this.af;
    if (kind === 'runway') {
      const r = af.runways.find((x) => x.id === id);
      return r ? [{ k: 'box', x: r.x1, y: r.y1, headingDeg: r.headingDeg, len: r.lengthM, w: r.widthM + 2 * r.shoulderM }] : [];
    }
    if (kind === 'taxiway') {
      const t = af.taxiways.find((x) => x.id === id);
      // The smoothed centerline, so the outline follows the pavement that is actually drawn.
      return t ? [{ k: 'strip', pts: planFor(af).smooth.get(t.id) ?? t.points, w: t.widthM }] : [];
    }
    if (kind === 'apron') {
      const a = af.aprons.find((x) => x.id === id);
      return a ? [{ k: 'poly', pts: a.polygon }] : [];
    }
    if (kind === 'stand') {
      const s = af.stands.find((x) => x.id === id);
      if (!s) return [];
      const row = AIRFIELD.codes[s.code];
      const d = compassVector(s.headingDeg);
      // The stand box runs from the aircraft nose position back over its length.
      return [{ k: 'box', x: s.x - d.x * row.standLengthM, y: s.y - d.y * row.standLengthM, headingDeg: s.headingDeg, len: row.standLengthM, w: row.spanM + 6 }];
    }
    if (kind === 'terminal') {
      const g = useGameStore.getState().terminalGrids.find((x) => x.id === id);
      if (!g) return [];
      const b = floorBounds(g);
      return b ? [{ k: 'poly', pts: rectWorld(g, b.x0, b.y0, b.x1 + 1, b.y1 + 1) }] : [];
    }
    return [];
  }

  private hovered = '';
  /** The runway end or taxiway being edited between the first and second click. */
  private resize: { id: number; end: 'a' | 'b' } | null = null;
  private tEdit: { id: number; end: 'start' | 'end' | null; at: Pt | null } | null = null;

  /** A holding point being dragged in the select tool, and where it would go. */
  private holdDrag: { h: HoldingPoint; t: Taxiway; r: Runway; d: number } | null = null;

  private holdingAt(p: Pt): HoldingPoint | null {
    const reach = Math.max(10, 16 / this.deps.zoom());
    let best: HoldingPoint | null = null;
    let bestD = reach;
    for (const h of this.af.holding) {
      const d = Math.hypot(h.x - p.x, h.y - p.y);
      if (d < bestD) {
        best = h;
        bestD = d;
      }
    }
    return best;
  }

  /** Starts dragging a holding point under the pointer in the select tool. True when one was grabbed. */
  grab(p: Pt): boolean {
    const h = this.holdingAt(p);
    if (!h) return false;
    const t = this.af.taxiways.find((x) => x.id === h.taxiwayId);
    const r = this.af.runways.find((x) => x.id === h.runwayId);
    if (!t || !r) return false;
    this.holdDrag = { h, t, r, d: h.distM };
    this.previewHold(p);
    return true;
  }

  /** The holding point at the pointer's place along its taxiway, kept on its side and out of the minimum. */
  private previewHold(p: Pt): void {
    const g = this.holdDrag;
    if (!g) return;
    const c = { x: 0, y: 0, t: 0 };
    let best: { x: number; y: number; dx: number; dy: number } | null = null;
    let bestD = Infinity;
    for (let i = 1; i < g.t.points.length; i++) {
      const a = g.t.points[i - 1];
      const b = g.t.points[i];
      closestOnSegment(p.x, p.y, a.x, a.y, b.x, b.y, c);
      const dd = Math.hypot(p.x - c.x, p.y - c.y);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      if (dd < bestD && runwaySide(g.r, c.x, c.y) === g.h.side) {
        bestD = dd;
        best = { x: c.x, y: c.y, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len };
      }
    }
    if (!best) return;
    const raw = distToSegment(best.x, best.y, g.r.x1, g.r.y1, g.r.x2, g.r.y2);
    const d = Math.max(g.h.minM, Math.min(g.h.minM + 250, Math.round(raw)));
    g.d = d;
    // Below the minimum the bar stays at the default place.
    const at = raw < g.h.minM ? { x: g.h.x, y: g.h.y } : best;
    const heading = compassOf(best.dx, best.dy);
    const shapes: GhostShape[] = [{ k: 'box', x: at.x - best.dx * 2, y: at.y - best.dy * 2, headingDeg: heading, len: 4, w: g.t.widthM + 6 }];
    this.show({ valid: raw >= g.h.minM - 0.5, shapes, label: { x: at.x, y: at.y, text: tFormat('ghost.holding', { d, min: g.h.minM }) } }, null, 'hint.holdDrag');
  }

  private commitHold(): void {
    const g = this.holdDrag;
    this.holdDrag = null;
    this.deps.setGhost(null);
    useToolStore.getState().set({ hint: null, problem: null });
    if (!g || Math.abs(g.d - g.h.distM) < 1) return;
    this.deps.send({ type: 'moveHolding', runwayId: g.r.id, taxiwayId: g.t.id, side: g.h.side, distM: g.d });
  }

  /** Highlights what a click would select and shows a pointer cursor over it. */
  private hoverAt(p: Pt): void {
    if (this.holdingAt(p)) {
      this.hovered = '';
      this.deps.setCursor('grab');
      return;
    }
    const hit = pickObject(this.af, p.x, p.y, Math.max(8, 14 / this.deps.zoom()));
    const term = hit ? null : this.terminalAt(p);
    const kind = hit ? hit.kind : term !== null ? 'terminal' : '';
    const id = hit ? hit.id : term ?? 0;
    const key = kind ? `${kind}:${id}` : '';
    if (key === this.hovered) return;
    this.hovered = key;
    this.deps.setHighlight(kind ? this.shapesFor(kind, id) : null, this.selectedShapes());
    this.deps.setCursor(kind ? 'pointer' : 'default');
  }

  selectedShapes(): GhostShape[] | null {
    const sel = useToolStore.getState().selection;
    if (!sel) return null;
    const shapes = this.shapesFor(sel.kind, sel.id);
    // A selected runway shows its obstacle surfaces and where they are penetrated.
    const r = sel.kind === 'runway' ? this.af.runways.find((x) => x.id === sel.id) : undefined;
    if (r) shapes.push(this.surfacesShape(r, this.af.obstacles?.find((o) => o.runwayId === r.id)?.penetrations ?? []));
    return shapes;
  }

  private surfacesShape(r: Runway, hits: readonly Penetration[]): GhostShape {
    const o = surfaceOutlines(r, r.approach);
    return { k: 'surfaces', approachA: o.approachA, approachB: o.approachB, transitional: o.transitional, hits: hits.map((h) => ({ x: h.x, y: h.y })) };
  }

  /** Penetrations of a runway being drawn, from the land the player owns now. */
  private previewHits(r: Runway): Penetration[] {
    const { site, owner, terminalGrids } = useGameStore.getState();
    if (!site || !owner) return [];
    return previewPenetrations(r, { heights: site.heights, landClass: site.landClass, parcelId: site.parcelId, parcelOwner: owner, buildings: this.buildingBoxes(terminalGrids) });
  }

  /** Called when the selection or the airfield changes, so the selected outline follows. */
  refreshSelection(): void {
    this.deps.setHighlight(null, this.selectedShapes());
    this.hovered = '';
  }

  reset(): void {
    this.hovered = '';
    this.deps.setGuide(null, null);
    this.deps.setHighlight(null, this.selectedShapes());
    this.deps.setCursor('default');
    useToolStore.getState().set({ confirmAt: null });
    this.start = null;
    this.resize = null;
    this.tEdit = null;
    this.pts = [];
    this.dragging = false;
    this.frozen = false;
    this.rectFrame = null;
    this.tStart = null;
    this.tGrid = null;
    this.deps.setGhost(null);
    useToolStore.getState().set({ hint: null, problem: null, buy: null });
  }

  private nodeCache: { af: AirfieldPayload; nodes: TaxiNode[] } | null = null;
  /** The taxiway tool's current snap target, shown as a marker with a tooltip. */
  private snapHit: SnapHit | null = null;

  private taxiNodes(): TaxiNode[] {
    if (!this.nodeCache || this.nodeCache.af !== this.af) this.nodeCache = { af: this.af, nodes: taxiNodes(this.af.taxiways) };
    return this.nodeCache.nodes;
  }

  /**
   * Taxiway tool snapping (docs/DESIGN_REVISION_2.md section 2.2): existing node, open end, segment,
   * then angle guides every 15 degrees with the alignment frames. Shift forces the steps, Alt is free.
   */
  private taxiSnap(p: Pt, prev: Pt | null, mods: Mods): Pt {
    this.snapHit = null;
    if (mods.alt) {
      this.deps.setGuide(null, null);
      return p;
    }
    const hit = findSnap(this.af.taxiways, this.taxiNodes(), p);
    if (hit) {
      this.snapHit = hit;
      this.deps.setGuide(null, null);
      return hit.p;
    }
    return this.snap(p, prev, mods, true, TAXI_TOOL.angleStepDeg);
  }

  /** Snaps to vertices, centerlines and the alignment frame. Shift gives 15 degree steps, Alt is free. */
  private snap(p: Pt, prev: Pt | null, mods: Mods, centerlines: boolean, stepDeg = 90): Pt {
    const radius = Math.max(6, 12 / this.deps.zoom());
    const v = snapToVertex(this.af, p.x, p.y, radius);
    if (v) return v;
    if (centerlines) {
      const edge = snapToRunwayEdge(this.af, p.x, p.y, radius * 1.2, prev);
      if (edge) return edge;
      const c = snapToCenterline(this.af, p.x, p.y, radius * 0.7);
      if (c) return c;
    }
    if (!mods.alt) {
      const g = alignGuide(this.af, this.pts.length > 0 ? this.pts : this.start ? [this.start] : [], p.x, p.y, Math.max(4, 9 / this.deps.zoom()));
      if (g) {
        this.deps.setGuide(g.from, g.p);
        return g.p;
      }
    }
    // The grid is the lowest priority snap: vertices, runway edges, centerlines and guides win (T42 R3).
    const grid = this.snapGrid(mods);
    if (grid) {
      this.deps.setGuide(null, null);
      return snapToGrid(p, grid).p;
    }
    this.deps.setGuide(null, null);
    if (!prev || mods.alt) return p;
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return p;
    const site = this.site();
    const frames = frameHeadings(this.af, site ? site.corridor.headingDeg : 0);
    const step = mods.shift ? 15 : stepDeg;
    // Shift forces the steps; otherwise a heading near a step is pulled onto it.
    const tol = mods.shift ? 7.5 : stepDeg === 90 ? 6 : TAXI_TOOL.angleTolDeg;
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    let best = Infinity;
    let target = angle;
    for (const f of frames) {
      for (let k = 0; k < 360 / step; k++) {
        const cand = f + k * step;
        const diff = Math.abs(((angle - cand + 540) % 360) - 180);
        if (diff < best) {
          best = diff;
          target = cand;
        }
      }
    }
    if (best > tol) return p;
    const dir = compassVector(target);
    return { x: prev.x + dir.x * len, y: prev.y + dir.y * len };
  }

  // Construction grid ------------------------------------------------------

  /**
   * The grid the tools snap to right now: the one offered near the cursor, when the active tool
   * places on the grid and its snap mode is grid. Alt is the live override, so holding it returns
   * null (T42 R2, R3, R4).
   */
  private snapGrid(mods: Mods): ConstructionGrid | null {
    const st = useToolStore.getState();
    if (mods.alt) return null;
    if (!GRID_TOOLS.includes(st.tool)) return null;
    if (snapModeOf(st.snapMode, st.tool) !== 'grid') return null;
    return gridById(this.af, st.gridId ?? '');
  }

  /**
   * The runway or taxiway segment grid under the cursor, measured to the centerline against half
   * the pavement width plus shoulder and a screen scaled margin, so any point on the pavement counts.
   * It cannot reuse `pickObject`, which biases stands above runways (T42 R2). The nearest centerline wins.
   */
  private gridUnder(p: Pt): ConstructionGrid | null {
    const slack = Math.max(4, 8 / this.deps.zoom());
    let best: ConstructionGrid | null = null;
    let bestD = Infinity;
    for (const g of gridsFor(this.af)) {
      const d = distToSegment(p.x, p.y, g.origin.x, g.origin.y, g.origin.x + g.ax * g.lengthM, g.origin.y + g.ay * g.lengthM);
      if (d <= this.gridReach(g) + slack && d < bestD) {
        best = g;
        bestD = d;
      }
    }
    return best;
  }

  /** Half the pavement width plus shoulder of the object a grid runs along. */
  private gridReach(g: ConstructionGrid): number {
    const [, idText] = g.id.split(':');
    if (g.kind === 'runway') {
      const r = this.af.runways.find((x) => String(x.id) === idText);
      return r ? r.widthM / 2 + r.shoulderM : 0;
    }
    const t = this.af.taxiways.find((x) => String(x.id) === idText);
    return t ? t.widthM / 2 : 0;
  }

  /**
   * Offers the grid near the cursor, as Cities Skylines offers its grid to a hovering ghost: the
   * grid of the runway or taxiway segment within reach is drawn, and snapped to unless the mode is
   * free or Alt is held. Away from every grid there is none and placement is free. The grid already
   * offered is kept while it is still in reach, so two close grids do not flicker (T42 R2).
   */
  private offerGrid(p: Pt): void {
    const st = useToolStore.getState();
    if (!GRID_TOOLS.includes(st.tool)) return;
    const kept = st.gridId === null ? null : gridById(this.af, st.gridId);
    const g = kept && this.gridInReach(kept, p) ? kept : this.gridUnder(p);
    const id = g ? g.id : null;
    if (id !== st.gridId) st.set({ gridId: id });
  }

  /** True when the cursor is within the pavement edge plus margin of the grid's centerline. */
  private gridInReach(g: ConstructionGrid, p: Pt): boolean {
    const slack = Math.max(4, 8 / this.deps.zoom());
    return distToSegment(p.x, p.y, g.origin.x, g.origin.y, g.origin.x + g.ax * g.lengthM, g.origin.y + g.ay * g.lengthM) <= this.gridReach(g) + slack;
  }

  /**
   * The point a tool places at: the nearest node of the picked grid in grid mode, else the raw
   * cursor point (T42 R4).
   */
  private placeAt(p: Pt, mods: Mods): Pt {
    const g = this.snapGrid(mods);
    return g ? snapToGrid(p, g).p : p;
  }

  /**
   * Heading a row, a block or a new terminal squares up to: the grid heading in grid mode, so the
   * placed object runs along the grid, else the alignment frame as today (T42 R4).
   */
  private rowHeadingAt(p: Pt, mods: Mods): number {
    const g = this.snapGrid(mods);
    if (g) return g.headingDeg;
    return (((this.frameAt(p) + useToolStore.getState().rowHeading) % 360) + 360) % 360;
  }

  /** Checks land and ownership, and fills the buy offer when land is what is missing. */
  private landProblem(strip: { pts: Pt[]; widthM: number } | { polygon: Pt[] }): Problem | null {
    const ctx = this.ctx();
    if (!ctx) return null;
    const problem = 'polygon' in strip ? checkPolygon(ctx, strip.polygon) : checkStrip(ctx, strip.pts, strip.widthM);
    if (problem && problem.code === 'notOwned') {
      const ids = unownedParcelsUnder(ctx, strip);
      const site = this.site();
      let cost = 0;
      if (site) for (const id of ids) cost += site.parcelPrice[id];
      useToolStore.getState().set({ buy: { ids, cost } });
    } else {
      useToolStore.getState().set({ buy: null });
    }
    return problem;
  }

  private show(g: Ghost, problem: Problem | null, hint: string | null): void {
    this.deps.setGhost(g);
    useToolStore.getState().set({ problem, hint });
  }

  down(p: Pt, mods: Mods): void {
    this.cursor = p;
    this.offerGrid(p);
    this.frozen = false;
    const tool = useToolStore.getState().tool;
    if (tool === 'runway' && useToolStore.getState().runwayMode !== 'new') {
      const end = this.runwayEndAt(p);
      if (end) {
        this.resize = { id: end.id, end: end.end };
        this.start = end.pt;
        this.dragging = true;
      } else useToolStore.getState().set({ problem: { code: 'pickRunwayEnd' } });
    } else if (tool === 'runway') {
      this.start = this.snap(p, null, mods, false);
      this.dragging = true;
    } else if (tool === 'apron' && useToolStore.getState().apronMode === 'rect') {
      this.rectFrame = null;
      this.start = this.rectCorner(p, this.apronFrame(p, mods), mods);
      this.dragging = true;
    } else if (tool === 'terminal') {
      this.terminalDown(p, mods);
    }
  }

  move(p: Pt, mods: Mods): void {
    this.cursor = p;
    this.deps.setGuide(null, null);
    this.offerGrid(p);
    const st = useToolStore.getState();
    switch (st.tool) {
      case 'runway':
        this.previewRunway(p, mods);
        break;
      case 'taxiway':
      case 'taxilane':
        if (st.taxiMode !== 'new' && !(st.taxiMode === 'extend' && this.tEdit)) this.previewTaxiEdit(p);
        else this.previewTaxiway(p, mods, st.tool === 'taxilane');
        break;
      case 'rapidExit':
        this.previewRapidExit(p);
        break;
      case 'turnPad':
        this.previewTurnPad(p);
        break;
      case 'parallel':
        this.previewParallel(p);
        break;
      case 'apron':
        if (st.apronMode === 'rect') {
          if (this.dragging && this.start) this.previewApronRect(p, mods);
          else this.show({ valid: true, shapes: [] }, null, 'hint.apronRect');
        } else this.previewApron(p, mods);
        break;
      case 'stands':
      case 'gaBlock':
        this.previewStands(p, mods);
        break;
      case 'terminal':
        this.previewTerminal(p, mods);
        break;
      case 'demolish':
        this.previewDemolish(p);
        break;
      case 'select':
        if (this.holdDrag) this.previewHold(p);
        else this.hoverAt(p);
        break;
      default:
        break;
    }
  }

  up(p: Pt, mods: Mods): void {
    const st = useToolStore.getState();
    this.cursor = p;
    if (this.holdDrag) {
      this.previewHold(p);
      this.commitHold();
      return;
    }
    switch (st.tool) {
      case 'runway':
        this.finishRunway(p, mods);
        break;
      case 'taxiway':
      case 'taxilane': {
        if (st.taxiMode !== 'new' && !(st.taxiMode === 'extend' && this.tEdit)) {
          this.taxiEditClick(p);
          break;
        }
        const prev = this.pts.length > 0 ? this.pts[this.pts.length - 1] : null;
        const q = this.taxiSnap(p, prev, mods);
        if (prev && Math.hypot(q.x - prev.x, q.y - prev.y) < 3) break;
        this.pts.push(q);
        this.previewTaxiway(p, mods, st.tool === 'taxilane');
        break;
      }
      case 'apron': {
        if (st.apronMode === 'rect') {
          this.commitApronRect(p, mods);
          break;
        }
        const prev = this.pts.length > 0 ? this.pts[this.pts.length - 1] : null;
        this.pts.push(this.apronCorner(p, prev, mods));
        this.cutting = mods.ctrl === true;
        this.previewApron(p, mods);
        break;
      }
      case 'rapidExit':
        this.commitRapidExit(p);
        break;
      case 'turnPad':
        this.commitTurnPad(p);
        break;
      case 'parallel':
        this.commitParallel(p);
        break;
      case 'stands':
      case 'gaBlock':
        this.commitStands(p, mods);
        break;
      case 'terminal':
        this.finishTerminal(p);
        break;
      case 'demolish': {
        const hit = pickObject(this.af, p.x, p.y, Math.max(8, 14 / this.deps.zoom()));
        if (hit) this.deps.send({ type: 'demolish', kind: hit.kind, id: hit.id });
        break;
      }
      case 'select': {
        const hit = pickObject(this.af, p.x, p.y, Math.max(8, 14 / this.deps.zoom()));
        const term = hit ? null : this.terminalAt(p);
        useToolStore.getState().set({ selection: hit ? { kind: hit.kind, id: hit.id } : term ? { kind: 'terminal', id: term } : null });
        break;
      }
    }
    this.dragging = false;
  }

  /** Builds what is being laid out: finishes a polyline or completes an armed drag at the pointer. */
  confirm(): void {
    useToolStore.getState().set({ confirmAt: null });
    const tool = useToolStore.getState().tool;
    if (this.armed) {
      this.up(this.cursor, { shift: false, alt: false });
      return;
    }
    if (tool === 'taxiway' || tool === 'taxilane' || tool === 'apron') this.finish();
  }

  /** Drops the gesture in progress and keeps the tool. */
  cancel(): void {
    useToolStore.getState().set({ confirmAt: null });
    this.reset();
  }

  /** Double click finishes polylines. */
  finish(): void {
    const tool = useToolStore.getState().tool;
    if (tool === 'taxiway' || tool === 'taxilane') this.commitTaxiway(tool === 'taxilane');
    else if (tool === 'apron') this.commitApron();
  }

  key(e: KeyboardEvent): boolean {
    const st = useToolStore.getState();
    if (e.key === 'Escape') {
      // The first Escape cancels what is being laid out, the next one leaves the tool.
      const busy = this.gestureActive;
      this.cancel();
      if (!busy) st.set({ tool: 'select', selection: null });
      return true;
    }
    if (e.key === 'Enter') {
      this.confirm();
      return true;
    }
    if (e.key === 'Backspace' && this.pts.length > 0) {
      this.pts.pop();
      this.move(this.cursor, { shift: false, alt: false });
      return true;
    }
    if ((e.key === 'a' || e.key === 'A') && st.tool === 'apron' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.cancel();
      st.set({ apronMode: st.apronMode === 'rect' ? 'polygon' : 'rect' });
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && (st.tool === 'stands' || st.tool === 'gaBlock' || st.tool === 'terminal')) {
      st.set({ rowHeading: (st.rowHeading + (e.shiftKey ? 15 : 90)) % 360 });
      this.move(this.cursor, { shift: false, alt: false });
      return true;
    }
    return false;
  }

  // Runway extend and shorten -------------------------------------------

  private runwayEndAt(p: Pt): { id: number; end: 'a' | 'b'; pt: Pt } | null {
    const tol = Math.max(40, 30 / this.deps.zoom());
    let best: { id: number; end: 'a' | 'b'; pt: Pt } | null = null;
    let bestD = tol;
    for (const r of this.af.runways) {
      for (const [end, pt] of [['a', { x: r.x1, y: r.y1 }], ['b', { x: r.x2, y: r.y2 }]] as const) {
        const d = Math.hypot(pt.x - p.x, pt.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = { id: r.id, end, pt };
        }
      }
    }
    return best;
  }

  /** Signed change in length for a pointer position: positive extends, negative shortens. */
  private resizeDelta(p: Pt): { r: Runway; delta: number; outward: Pt; from: Pt } | null {
    const target = this.resize;
    const r = target ? this.af.runways.find((x) => x.id === target.id) : undefined;
    if (!target || !r) return null;
    const d = compassVector(r.headingDeg);
    const sign = target.end === 'b' ? 1 : -1;
    const outward = { x: d.x * sign, y: d.y * sign };
    const from = target.end === 'b' ? { x: r.x2, y: r.y2 } : { x: r.x1, y: r.y1 };
    const proj = (p.x - from.x) * outward.x + (p.y - from.y) * outward.y;
    const mode = useToolStore.getState().runwayMode;
    const amount = Math.round(Math.abs(proj) / 5) * 5;
    const delta = mode === 'extend' ? (proj > 0 ? amount : 0) : proj < 0 ? -amount : 0;
    return { r, delta, outward, from };
  }

  private previewResize(p: Pt): void {
    const st = useToolStore.getState();
    if (this.frozen && !this.dragging) return;
    if (!this.resize || !this.dragging) {
      // Ring every runway end so the player sees what can be picked.
      const shapes: GhostShape[] = [];
      for (const r of this.af.runways) {
        shapes.push({ k: 'ring', x: r.x1, y: r.y1, r: 22 }, { k: 'ring', x: r.x2, y: r.y2, r: 22 });
      }
      this.deps.setGhost({ valid: true, shapes });
      st.set({ hint: st.runwayMode === 'extend' ? 'hint.runwayExtendPick' : 'hint.runwayShortenPick', problem: null, buy: null });
      return;
    }
    const m = this.resizeDelta(p);
    if (!m) return;
    const fullW = m.r.widthM + 2 * m.r.shoulderM;
    const newLen = m.r.lengthM + m.delta;
    const sign = m.delta >= 0 ? 1 : -1;
    const amt = Math.abs(m.delta);
    const a = sign > 0 ? m.from : { x: m.from.x - m.outward.x * amt, y: m.from.y - m.outward.y * amt };
    const heading = ((Math.atan2(m.outward.x, -m.outward.y) * 180) / Math.PI + 360) % 360;
    let problem: Problem | null = null;
    let label = tFormat('ghost.runwayResize', { len: newLen, delta: `${m.delta >= 0 ? '+' : ''}${m.delta}`, cost: '' });
    if (m.delta === 0) problem = { code: 'resizeNothing' };
    else if (newLen < 300 || newLen > 5000) problem = { code: 'runwayLength', args: { min: 300, max: 5000 } };
    else if (m.delta > 0) {
      const to = { x: m.from.x + m.outward.x * amt, y: m.from.y + m.outward.y * amt };
      problem = this.landProblem({ pts: [m.from, to], widthM: fullW });
      const ctx = this.ctx();
      const cost = ctx ? estimateStripCost(ctx, [m.from, to], fullW, m.r.surface, 1) : 0;
      label = tFormat('ghost.runwayResize', { len: newLen, delta: `+${m.delta}`, cost: formatMoney(cost) });
    } else {
      for (const t of this.af.taxiways) {
        for (const q of t.points) {
          const f = frameOf(m.r, q.x, q.y);
          const outwardEnd = this.resize.end === 'b';
          if (Math.abs(f.lateral) <= fullW / 2 + 8 && (outwardEnd ? f.s > newLen - 5 : f.s < amt + 5) && f.s >= -5 && f.s <= m.r.lengthM + 5) problem = { code: 'runwayInUse' };
        }
      }
    }
    // The runway closes while the works run, shown before the click that confirms.
    const days = m.delta !== 0 ? runwayWorksDays(m.r, { lengthDeltaM: m.delta }) : 0;
    if (days > 0) label += `. ${tFormat('inspector.runwayWorksPreview', { days })}`;
    this.show(
      {
        valid: problem === null,
        shapes: [{ k: 'box', x: a.x, y: a.y, headingDeg: heading, len: amt, w: fullW }, { k: 'ring', x: m.from.x, y: m.from.y, r: 22 }],
        label: { x: p.x, y: p.y, text: label },
      },
      problem,
      'hint.runwayResize',
    );
  }

  private commitResize(p: Pt): void {
    const m = this.resizeDelta(p);
    const target = this.resize;
    this.start = null;
    this.dragging = false;
    this.resize = null;
    if (!m || !target || m.delta === 0) {
      this.deps.setGhost(null);
      return;
    }
    if (useToolStore.getState().problem) {
      this.frozen = true;
      this.resize = target;
      this.start = m.from;
      return;
    }
    this.deps.send({ type: 'resizeRunway', id: target.id, end: target.end, deltaM: m.delta });
    this.deps.setGhost(null);
  }

  // Runway ---------------------------------------------------------------

  private runwayShape(a: Pt, heading: number, length: number): { shapes: GhostShape[]; pts: Pt[]; width: number } {
    const st = useToolStore.getState();
    const row = AIRFIELD.codes[st.code];
    const paved = st.surface === 'asphalt' || st.surface === 'concrete';
    const width = row.runwayWidthM + (paved ? 2 * row.runwayShoulderM : 0);
    const d = compassVector(heading);
    const b = { x: a.x + d.x * length, y: a.y + d.y * length };
    const strip = AIRFIELD.stripWidthM[st.approach];
    return {
      shapes: [
        { k: 'box', x: a.x, y: a.y, headingDeg: heading, len: length, w: strip },
        { k: 'box', x: a.x, y: a.y, headingDeg: heading, len: length, w: width },
      ],
      pts: [a, b],
      width,
    };
  }

  private runwayGeometry(p: Pt, mods: Mods): { heading: number; length: number } | null {
    if (!this.start) return null;
    const dx = p.x - this.start.x;
    const dy = p.y - this.start.y;
    const heading = mods.alt ? compassOf(dx, dy) : compassOf(dx, dy);
    return { heading, length: Math.min(5000, Math.round(Math.hypot(dx, dy))) };
  }

  private previewRunway(p: Pt, mods: Mods): void {
    if (useToolStore.getState().runwayMode !== 'new') {
      this.previewResize(p);
      return;
    }
    const st = useToolStore.getState();
    if (this.frozen && !this.dragging) return;
    const g = this.runwayGeometry(p, mods);
    if (!this.start || !this.dragging || !g) {
      this.deps.setGhost({ valid: true, shapes: [{ k: 'ring', x: p.x, y: p.y, r: 15 }] });
      st.set({ hint: 'hint.runway', problem: null, buy: null });
      return;
    }
    const shape = this.runwayShape(this.start, g.heading, g.length);
    let problem: Problem | null;
    if (g.length < 300) problem = { code: 'runwayLength', args: { min: 300, max: 5000 } };
    else if (st.approach !== 'visual' && st.surface !== 'asphalt' && st.surface !== 'concrete') problem = { code: 'approachNeedsPaved' };
    else problem = this.landProblem({ pts: shape.pts, widthM: shape.width });
    const site = this.site();
    const band = site ? windBand(g.heading % 180, site.idealHeadingDeg) : 'acceptable';
    const ctx = this.ctx();
    const cost = ctx ? estimateStripCost(ctx, shape.pts, shape.width, st.surface, st.tier) : 0;
    // The runway as it will be built: pavement, shoulders and markings, with only the safety strip outlined.
    const paved = st.surface === 'asphalt' || st.surface === 'concrete';
    const row = AIRFIELD.codes[st.code];
    const end = shape.pts[1];
    const tmp: Runway = {
      id: -1,
      cost: 0,
      x1: this.start.x,
      y1: this.start.y,
      x2: end.x,
      y2: end.y,
      headingDeg: g.heading,
      lengthM: g.length,
      widthM: row.runwayWidthM,
      shoulderM: paved ? row.runwayShoulderM : 0,
      code: st.code,
      approach: st.approach,
      surface: st.surface,
      pcr: 0,
      condition: 100,
      nameA: '',
      nameB: '',
    };
    const des = (h: number): string => String(Math.round((((h % 360) + 360) % 360) / 10) % 36 || 36).padStart(2, '0');
    tmp.nameA = des(g.heading);
    tmp.nameB = des(g.heading + 180);
    const hits = g.length >= 300 ? this.previewHits(tmp) : [];
    this.show(
      {
        valid: problem === null,
        shapes: g.length >= 300 ? [...shape.shapes.slice(0, 1), this.surfacesShape(tmp, hits)] : shape.shapes.slice(0, 1),
        preview: g.length >= 50 ? { runway: tmp } : undefined,
        label: {
          x: p.x,
          y: p.y,
          text:
            tFormat('ghost.runway', { len: g.length, hdg: String(g.heading).padStart(3, '0'), band: tFormat(`wind.${band}` as StringKey, {}), cost: formatMoney(cost) }) +
            (hits.length > 0 ? `. ${tFormat('ghost.obstacles', { n: hits.length })}` : ''),
        },
      },
      problem,
      'hint.runwayDrag',
    );
  }

  private finishRunway(p: Pt, mods: Mods): void {
    if (useToolStore.getState().runwayMode !== 'new') {
      this.commitResize(p);
      return;
    }
    const st = useToolStore.getState();
    const g = this.runwayGeometry(p, mods);
    const start = this.start;
    this.start = null;
    this.dragging = false;
    if (!start || !g || g.length < 300) {
      this.deps.setGhost(null);
      return;
    }
    // A refused runway keeps its preview and the reason on screen, so land can be bought first.
    if (useToolStore.getState().problem) {
      this.frozen = true;
      return;
    }
    this.deps.setGhost(null);
    this.deps.send({ type: 'buildRunway', x: start.x, y: start.y, headingDeg: g.heading, lengthM: g.length, code: st.code, approach: st.approach, surface: st.surface, tier: st.tier });
  }

  // Taxiways -------------------------------------------------------------

  private previewTaxiway(p: Pt, mods: Mods, lane: boolean): void {
    const st = useToolStore.getState();
    const prev = this.pts.length > 0 ? this.pts[this.pts.length - 1] : null;
    const q = this.taxiSnap(p, prev, mods);
    const width = AIRFIELD.codes[st.code].taxiwayWidthM;
    const pts = [...this.pts, q];
    const shapes: GhostShape[] = [];
    // Every node shows while the tool is open, and the active target gets its own marker.
    for (const n of this.taxiNodes()) shapes.push({ k: 'marker', x: n.p.x, y: n.p.y, shape: 'dot', label: n.arms >= 3 ? n.label : undefined });
    const hit = this.snapHit;
    if (hit) shapes.push({ k: 'marker', x: hit.p.x, y: hit.p.y, shape: hit.kind === 'node' ? 'ring' : hit.kind === 'end' ? 'square' : 'diamond', label: hit.label || undefined });
    let problem: Problem | null = null;
    if (pts.length >= 2) {
      // Corners are rounded as they will be built, so the preview matches the pavement.
      shapes.unshift({ k: 'strip', pts: smoothCorners(pts, AIRFIELD.codes[st.code].turnRadiusM), w: width });
      problem = this.landProblem({ pts, widthM: width });
      if (!problem && prev && Math.hypot(q.x - prev.x, q.y - prev.y) < TAXI_TOOL.minNodeGapM) problem = { code: 'segmentTooShort', args: { min: TAXI_TOOL.minNodeGapM } };
    }
    // The wingtip envelope: the largest type of the code at the cursor, and red bands where it clashes.
    let clash = false;
    let clashTip: string | null = null;
    if (pts.length >= 2) {
      const c = taxiClashes(pts, st.code, this.af, { buildings: this.buildingBoxes() });
      for (const r of c.runs) shapes.push({ k: 'clash', pts: r, w: width });
      clash = c.runs.length > 0;
      const row = AIRFIELD.codes[st.code];
      if (c.object) clashTip = tFormat('ghost.clearance', { m: row.taxiObjectM });
      else if (c.taxiway) clashTip = tFormat('ghost.taxiSeparation', { m: row.taxiSepM });
    }
    const env = this.envelopeAt(q, prev, st.code, clash);
    if (env) shapes.push(env);
    const tip = hit ? (hit.kind === 'node' ? tFormat('ghost.snapNode', { label: hit.label }) : hit.kind === 'end' ? tFormat('ghost.snapEnd', {}) : tFormat('ghost.snapSegment', {})) : clashTip;
    const ctx = this.ctx();
    const cost = ctx && pts.length >= 2 ? estimateStripCost(ctx, pts, width, st.surface, st.tier) : 0;
    this.show(
      { valid: problem === null, shapes, tone: 'snap', tip: tip ? { x: q.x, y: q.y, text: tip } : undefined, label: { x: q.x, y: q.y, text: tFormat('ghost.taxiway', { seg: prev ? Math.round(Math.hypot(q.x - prev.x, q.y - prev.y)) : 0, total: Math.round(pts.reduce((l, pt, i) => (i > 0 ? l + Math.hypot(pt.x - pts[i - 1].x, pt.y - pts[i - 1].y) : l), 0)), code: st.code, w: width, cost: formatMoney(cost) }) } },
      problem,
      lane ? 'hint.taxilane' : 'hint.taxiway',
    );
  }

  /** Footprints of every terminal, for clearance checks while drawing. */
  private buildingBoxes(grids: readonly TerminalGrid[] = useGameStore.getState().terminalGrids): Pt[][] {
    const out: Pt[][] = [];
    for (const g of grids) {
      const b = this.floorBox(g);
      if (b) out.push(rectWorld(g, b.x0, b.y0, b.x1 + 1, b.y1 + 1));
    }
    return out;
  }

  /** The largest type of the code with its nose at the cursor, heading along the last segment. */
  private envelopeAt(q: Pt, prev: Pt | null, code: CodeLetter, clash: boolean): GhostShape | null {
    const a = envelopeType(code);
    if (!a) return null;
    const len = prev ? Math.hypot(q.x - prev.x, q.y - prev.y) : 0;
    // Outlines are in meters with the nose at y = 0 and the tail at y = minus the length, x to one wing.
    const ux = len > 0.5 && prev ? (q.x - prev.x) / len : 0;
    const uy = len > 0.5 && prev ? (q.y - prev.y) / len : -1;
    const rx = -uy;
    const ry = ux;
    const polys = typeOutlines(a, 0).map((poly) => poly.map((p) => ({ x: q.x + rx * p.x + ux * p.y, y: q.y + ry * p.x + uy * p.y })));
    return { k: 'envelope', polys, clash };
  }

  private commitTaxiway(lane: boolean): void {
    const st = useToolStore.getState();
    if (this.pts.length < 2) return;
    if (st.taxiMode === 'extend' && this.tEdit) {
      this.deps.send({ type: 'editTaxiway', id: this.tEdit.id, op: 'extend', end: this.tEdit.end ?? 'end', points: this.pts.slice(1) });
      this.pts = [];
      this.tEdit = null;
      this.deps.setGhost(null);
      return;
    }
    this.deps.send({ type: 'buildTaxiway', points: this.pts.slice(), code: st.code, kind: lane ? 'taxilane' : 'taxiway', surface: st.surface, tier: st.tier });
    this.pts = [];
    this.deps.setGhost(null);
  }

  // Taxiway extend, trim and cut -----------------------------------------

  private taxiEndAt(p: Pt): { t: Taxiway; end: 'start' | 'end'; pt: Pt } | null {
    const tol = Math.max(30, 24 / this.deps.zoom());
    let best: { t: Taxiway; end: 'start' | 'end'; pt: Pt } | null = null;
    let bestD = tol;
    for (const t of this.af.taxiways) {
      for (const [end, pt] of [['start', t.points[0]], ['end', t.points[t.points.length - 1]]] as const) {
        const d = Math.hypot(pt.x - p.x, pt.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = { t, end, pt };
        }
      }
    }
    return best;
  }

  /** Nearest point of a taxiway centerline and its arc length, within a few taxiway widths. */
  private taxiArc(t: Taxiway, p: Pt): { arc: number; pt: Pt } | null {
    let best = Infinity;
    let arc = 0;
    let run = 0;
    let pt: Pt = t.points[0];
    const c = { x: 0, y: 0, t: 0 };
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1];
      const b = t.points[i];
      closestOnSegment(p.x, p.y, a.x, a.y, b.x, b.y, c);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      const sl = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < best) {
        best = d;
        arc = run + sl * c.t;
        pt = { x: c.x, y: c.y };
      }
      run += sl;
    }
    return best <= Math.max(t.widthM * 1.5, 20 / this.deps.zoom()) ? { arc, pt } : null;
  }

  /** The part of a taxiway between two arc lengths. */
  private taxiSlice(t: Taxiway, s0: number, s1: number): Pt[] {
    const lo = Math.min(s0, s1);
    const hi = Math.max(s0, s1);
    const out: Pt[] = [];
    let run = 0;
    const at = (a: Pt, b: Pt, s: number): Pt => {
      const sl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const k = (s - run) / sl;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    };
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1];
      const b = t.points[i];
      const sl = Math.hypot(b.x - a.x, b.y - a.y);
      const e = run + sl;
      if (e >= lo && run <= hi) {
        if (out.length === 0) out.push(at(a, b, Math.max(lo, run)));
        if (hi <= e) {
          out.push(at(a, b, hi));
          break;
        }
        out.push(b);
      }
      run = e;
    }
    return out;
  }

  private previewTaxiEdit(p: Pt): void {
    const st = useToolStore.getState();
    const mode = st.taxiMode;
    const shapes: GhostShape[] = [];
    let valid = true;
    let problem: Problem | null = null;
    let hint = mode === 'extend' ? 'hint.taxiExtendPick' : mode === 'trim' ? 'hint.taxiTrimPick' : 'hint.taxiCutPick';
    if (mode === 'extend' || (mode === 'trim' && !this.tEdit)) {
      for (const t of this.af.taxiways) {
        shapes.push({ k: 'ring', x: t.points[0].x, y: t.points[0].y, r: 14 }, { k: 'ring', x: t.points[t.points.length - 1].x, y: t.points[t.points.length - 1].y, r: 14 });
      }
    } else {
      const t = this.af.taxiways.find((x) => x.id === (this.tEdit ? this.tEdit.id : -1));
      const hit = t ? this.taxiArc(t, p) : null;
      if (mode === 'trim' && t && this.tEdit && this.tEdit.end) {
        hint = 'hint.taxiTrimTo';
        const total = this.arcTotal(t);
        if (hit) shapes.push({ k: 'strip', pts: this.taxiSlice(t, this.tEdit.end === 'start' ? 0 : total, hit.arc), w: t.widthM }, { k: 'ring', x: hit.pt.x, y: hit.pt.y, r: 10 });
        else valid = false;
      } else if (mode === 'cut') {
        const t0 = this.tEdit ? t : this.af.taxiways.find((x) => this.taxiArc(x, p) !== null);
        const h0 = t0 ? this.taxiArc(t0, p) : null;
        if (!this.tEdit) {
          if (h0) shapes.push({ k: 'ring', x: h0.pt.x, y: h0.pt.y, r: 10 });
          else valid = false;
        } else if (t0 && this.tEdit.at && h0) {
          const a = this.taxiArc(t0, this.tEdit.at);
          if (a) shapes.push({ k: 'strip', pts: this.taxiSlice(t0, a.arc, h0.arc), w: t0.widthM }, { k: 'ring', x: a.pt.x, y: a.pt.y, r: 10 });
          hint = 'hint.taxiCutTo';
        } else valid = false;
      }
    }
    if (!valid) problem = null;
    this.deps.setGhost({ valid: true, shapes });
    st.set({ hint, problem, buy: null });
  }

  private arcTotal(t: Taxiway): number {
    let l = 0;
    for (let i = 1; i < t.points.length; i++) l += Math.hypot(t.points[i].x - t.points[i - 1].x, t.points[i].y - t.points[i - 1].y);
    return l;
  }

  private taxiEditClick(p: Pt): void {
    const st = useToolStore.getState();
    const mode = st.taxiMode;
    if (mode === 'extend') {
      const e = this.taxiEndAt(p);
      if (!e) return;
      this.tEdit = { id: e.t.id, end: e.end, at: null };
      this.pts = [e.pt];
      this.previewTaxiway(p, { shift: false, alt: false }, st.tool === 'taxilane');
      return;
    }
    if (mode === 'trim') {
      if (!this.tEdit) {
        const e = this.taxiEndAt(p);
        if (e) this.tEdit = { id: e.t.id, end: e.end, at: null };
        return;
      }
      const t = this.af.taxiways.find((x) => x.id === this.tEdit?.id);
      const hit = t ? this.taxiArc(t, p) : null;
      if (!t || !hit || !this.tEdit.end) return;
      this.deps.send({ type: 'editTaxiway', id: t.id, op: 'trim', end: this.tEdit.end, at: hit.pt });
      this.tEdit = null;
      this.deps.setGhost(null);
      return;
    }
    // Cut: the first click picks the taxiway and one end of the section, the second the other end.
    if (!this.tEdit) {
      const t = this.af.taxiways.find((x) => this.taxiArc(x, p) !== null);
      const hit = t ? this.taxiArc(t, p) : null;
      if (t && hit) this.tEdit = { id: t.id, end: null, at: hit.pt };
      return;
    }
    const t = this.af.taxiways.find((x) => x.id === this.tEdit?.id);
    const hit = t ? this.taxiArc(t, p) : null;
    if (!t || !hit || !this.tEdit.at) return;
    this.deps.send({ type: 'editTaxiway', id: t.id, op: 'cut', at: this.tEdit.at, at2: hit.pt });
    this.tEdit = null;
    this.deps.setGhost(null);
  }

  // Rapid exit and parallel taxiway -------------------------------------

  private nearestRunway(p: Pt): Runway | null {
    let best: Runway | null = null;
    let bestD = 400;
    for (const r of this.af.runways) {
      const f = runwayFrame(r, p.x, p.y);
      if (f.s < -50 || f.s > r.lengthM + 50) continue;
      const d = Math.abs(f.lateral);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  private exitPlan(p: Pt): { r: Runway; dist: number; side: 'left' | 'right' } | null {
    const r = this.nearestRunway(p);
    if (!r) return null;
    const f = runwayFrame(r, p.x, p.y);
    return { r, dist: Math.max(200, Math.min(r.lengthM - 200, Math.round(f.s))), side: f.lateral >= 0 ? 'left' : 'right' };
  }

  private previewRapidExit(p: Pt): void {
    const st = useToolStore.getState();
    const plan = this.exitPlan(p);
    if (!plan) {
      this.deps.setGhost(null);
      st.set({ hint: 'hint.needRunway', problem: null, buy: null });
      return;
    }
    const pts = rapidExitPoints(plan.r, plan.dist, plan.side, st.exitAngle);
    const width = AIRFIELD.codes[st.code].taxiwayWidthM;
    const problem = this.landProblem({ pts, widthM: width });
    this.show(
      {
        valid: problem === null,
        shapes: [{ k: 'strip', pts, w: width }],
        label: { x: pts[0].x, y: pts[0].y, text: tFormat('ghost.exit', { dist: plan.dist, angle: st.exitAngle, suggest: suggestedExitDistance(plan.r.lengthM) }) },
      },
      problem,
      'hint.exit',
    );
  }

  private commitRapidExit(p: Pt): void {
    const st = useToolStore.getState();
    const plan = this.exitPlan(p);
    if (!plan) return;
    this.deps.send({ type: 'buildRapidExit', runwayId: plan.r.id, distM: plan.dist, side: plan.side, angleDeg: st.exitAngle, code: st.code, surface: st.surface, tier: st.tier });
  }

  /** A pad previews within this reach of a runway threshold, flat in world meters (task T01 spec). */
  private padPlan(p: Pt): { r: Runway; end: 'a' | 'b'; side: PadSide } | null {
    let best: { r: Runway; end: 'a' | 'b' } | null = null;
    let bestD = TURN_PAD_REACH_M;
    for (const r of this.af.runways) {
      for (const [end, pt] of [['a', { x: r.x1, y: r.y1 }], ['b', { x: r.x2, y: r.y2 }]] as const) {
        const d = Math.hypot(pt.x - p.x, pt.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = { r, end };
        }
      }
    }
    if (!best) return null;
    return { r: best.r, end: best.end, side: runwaySide(best.r, p.x, p.y) === 1 ? 'left' : 'right' };
  }

  /** Turn pad preview (docs/GAME_DESIGN.md section 6, UI_DESIGN section 6): the same checks the sim runs. */
  private previewTurnPad(p: Pt): void {
    const plan = this.padPlan(p);
    if (!plan) {
      this.deps.setGhost(null);
      useToolStore.getState().set({ hint: 'hint.needRunway', problem: null, buy: null });
      return;
    }
    const { r, end, side } = plan;
    const poly = padPolygon(r, end, side);
    const value = padValue(r);
    let problem = this.landProblem({ polygon: poly });
    if (!problem && r.pads?.[end] === side) problem = { code: 'padExists' };
    if (!problem && value > useGameStore.getState().cash) problem = { code: 'insufficientFunds', args: { cost: value } };
    const curve = padCurve(r, end, side);
    const at = poly[1];
    this.show(
      {
        valid: problem === null,
        shapes: [{ k: 'poly', pts: poly }, { k: 'strip', pts: curve, w: PAINT.taxiway.centerlineWidthM }],
        label: { x: at.x, y: at.y, text: `${tFormat('ghost.turnPad', { cost: formatMoney(value) })}. ${tFormat('inspector.runwayWorksPreview', { days: runwayWorksDays(r, { areaM2: padArea(r) }) })}` },
      },
      problem,
      'hint.turnPad',
    );
  }

  private commitTurnPad(p: Pt): void {
    const plan = this.padPlan(p);
    if (!plan) return;
    this.deps.send({ type: 'turnPad', runwayId: plan.r.id, end: plan.end, side: plan.side });
  }

  private parallelPlan(p: Pt): { r: Runway; side: 'left' | 'right'; offset: number; pts: Pt[]; conn: Pt[][]; cap: CodeLetter } | null {
    const st = useToolStore.getState();
    const r = this.nearestRunway(p);
    if (!r) return null;
    const f = runwayFrame(r, p.x, p.y);
    const side = f.lateral >= 0 ? 'left' : 'right';
    const row = AIRFIELD.codes[st.code];
    const minOffset = Math.ceil(r.widthM / 2 + r.shoulderM + row.taxiwayWidthM / 2 + 15);
    const offset = Math.max(minOffset, Math.round(Math.abs(f.lateral)));
    const d = compassVector(r.headingDeg);
    const sign = side === 'left' ? 1 : -1;
    const n = { x: d.y * sign, y: -d.x * sign };
    const at = (s: number, off: number): Pt => ({ x: r.x1 + d.x * s + n.x * off, y: r.y1 + d.y * s + n.y * off });
    const edge = r.widthM / 2 + r.shoulderM;
    const count = Math.max(1, st.connectors);
    const inset = Math.min(60, r.lengthM / 4);
    const conn: Pt[][] = [];
    for (let i = 0; i < count; i++) {
      const s = count === 1 ? r.lengthM / 2 : inset + (i * (r.lengthM - 2 * inset)) / (count - 1);
      conn.push([at(s, offset), at(s, edge)]);
    }
    let cap: CodeLetter = 'A';
    for (const c of CODES) if (AIRFIELD.runwayToTaxiwaySepM[r.approach][c] <= offset) cap = c;
    if (codeIndex(cap) > codeIndex(st.code)) cap = st.code;
    return { r, side, offset, pts: [at(0, offset), at(r.lengthM, offset)], conn, cap };
  }

  private previewParallel(p: Pt): void {
    const st = useToolStore.getState();
    const plan = this.parallelPlan(p);
    if (!plan) {
      this.deps.setGhost(null);
      st.set({ hint: 'hint.needRunway', problem: null, buy: null });
      return;
    }
    const width = AIRFIELD.codes[st.code].taxiwayWidthM;
    let problem = this.landProblem({ pts: plan.pts, widthM: width });
    for (const c of plan.conn) problem = problem ?? this.landProblem({ pts: c, widthM: width });
    this.show(
      {
        valid: problem === null,
        shapes: [{ k: 'strip', pts: plan.pts, w: width }, ...plan.conn.map((c): GhostShape => ({ k: 'strip', pts: c, w: width }))],
        label: { x: plan.pts[0].x, y: plan.pts[0].y, text: tFormat('ghost.parallel', { offset: plan.offset, cap: plan.cap }) },
      },
      problem,
      'hint.parallel',
    );
  }

  private commitParallel(p: Pt): void {
    const st = useToolStore.getState();
    const plan = this.parallelPlan(p);
    if (!plan) return;
    this.deps.send({ type: 'buildParallelTaxiway', runwayId: plan.r.id, side: plan.side, offsetM: plan.offset, code: st.code, connectors: st.connectors, surface: st.surface, tier: st.tier });
  }

  // Apron ----------------------------------------------------------------

  /** Free polygon apron (docs/DESIGN_REVISION_2.md section 4): live edge lengths and area, Ctrl cuts. */
  private previewApron(p: Pt, mods: Mods): void {
    const prev = this.pts.length > 0 ? this.pts[this.pts.length - 1] : null;
    const q = this.apronCorner(p, prev, mods);
    const pts = [...this.pts, q];
    const cut = mods.ctrl === true || this.cutting;
    const shapes: GhostShape[] = pts.length >= 3 ? [{ k: 'poly', pts }] : [{ k: 'strip', pts, w: 1 }];
    let problem: Problem | null = null;
    let area = 0;
    if (pts.length >= 3) {
      area = polygonArea(pts);
      if (!cut) problem = area < 400 ? { code: 'apronTooSmall', args: { min: 400 } } : this.landProblem({ polygon: pts });
    }
    const tags = pts.slice(1).map((b, i) => ({ x: (pts[i].x + b.x) / 2, y: (pts[i].y + b.y) / 2, text: `${Math.round(Math.hypot(b.x - pts[i].x, b.y - pts[i].y))} m` }));
    this.show({ valid: problem === null, shapes, tone: 'snap', tags, label: { x: q.x, y: q.y, text: this.apronReadout(area, cut) } }, problem, 'hint.apron');
  }

  private apronReadout(area: number, cut: boolean): string {
    const st = useToolStore.getState();
    if (cut) return tFormat('ghost.apronCut', { area: formatNumber(Math.round(area)) });
    const tierIdx = Math.min(st.tier, SURFACE_SPEC[st.surface].pcrTiers.length - 1);
    const cost = Math.round(area * SURFACE_SPEC[st.surface].costPerM2 * (SURFACE_DATA.tierCostFactor[tierIdx] ?? 1));
    return tFormat('ghost.apron', { area: formatNumber(Math.round(area)), cost: formatMoney(cost) });
  }

  private commitApron(): void {
    const st = useToolStore.getState();
    if (this.pts.length < 3) return;
    if (this.cutting) this.deps.send({ type: 'cutApron', polygon: this.pts.slice() });
    else this.deps.send({ type: 'buildApron', polygon: this.pts.slice(), surface: st.surface, tier: st.tier });
    this.pts = [];
    this.cutting = false;
    this.deps.setGhost(null);
  }

  /**
   * Snaps a rectangle corner in the alignment frame (heading `frame`): each frame axis snaps to the
   * nearest apron edge, apron corner or taxiway edge parallel to it within a few meters. Alt is free.
   */
  private rectSnap(p: Pt, frame: number, mods: Mods): Pt {
    if (mods.alt) return p;
    const u = compassVector(frame);
    const v = { x: -u.y, y: u.x };
    const tol = Math.max(3, 10 / this.deps.zoom());
    const pu = p.x * u.x + p.y * u.y;
    const pv = p.x * v.x + p.y * v.y;
    let bu = pu;
    let bv = pv;
    let du = tol;
    let dv = tol;
    const take = (q: Pt): void => {
      const qu = q.x * u.x + q.y * u.y;
      const qv = q.x * v.x + q.y * v.y;
      if (Math.abs(qu - pu) < du) {
        du = Math.abs(qu - pu);
        bu = qu;
      }
      if (Math.abs(qv - pv) < dv) {
        dv = Math.abs(qv - pv);
        bv = qv;
      }
    };
    for (const a of this.af.aprons) for (const r of [a.polygon, ...(a.holes ?? [])]) for (const q of r) take(q);
    for (const t of this.af.taxiways) {
      for (let i = 1; i < t.points.length; i++) {
        const a = t.points[i - 1];
        const b = t.points[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / len;
        const ny = (b.x - a.x) / len;
        for (const side of [1, -1]) for (const q of [a, b]) take({ x: q.x + nx * side * (t.widthM / 2), y: q.y + ny * side * (t.widthM / 2) });
      }
    }
    return { x: u.x * bu + v.x * bv, y: u.y * bu + v.y * bv };
  }

  /**
   * Alignment frame of an apron rectangle: the runway frame, or without a runway the direction of the
   * nearest apron edge, so new pieces square up with the apron they extend, else the site axis.
   */
  private apronFrame(p: Pt, mods: Mods): number {
    const g = this.snapGrid(mods);
    if (g) return g.headingDeg;
    if (this.af.runways.length > 0) return this.frameAt(p);
    let best = 100;
    let heading = this.frameAt(p);
    const c = { x: 0, y: 0, t: 0 };
    for (const a of this.af.aprons) {
      for (let i = 0; i < a.polygon.length; i++) {
        const u = a.polygon[i];
        const v = a.polygon[(i + 1) % a.polygon.length];
        closestOnSegment(p.x, p.y, u.x, u.y, v.x, v.y, c);
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d < best) {
          best = d;
          heading = compassOf(v.x - u.x, v.y - u.y);
        }
      }
    }
    return heading;
  }

  /**
   * A corner of a free polygon apron: the nearest grid node in grid mode, else the shared snap with
   * its vertex, centerline and angle guide steps (T42 R3, R4).
   */
  private apronCorner(p: Pt, prev: Pt | null, mods: Mods): Pt {
    const g = this.snapGrid(mods);
    if (!g) return this.snap(p, prev, mods, false);
    // The grid wins, so no alignment guide is drawn for a snapped corner.
    this.deps.setGuide(null, null);
    return snapToGrid(p, g).p;
  }

  /**
   * A corner of an apron rectangle: the nearest grid node in grid mode, else the edge snap in the
   * alignment frame (T42 R3, R4).
   */
  private rectCorner(p: Pt, frame: number, mods: Mods): Pt {
    const g = this.snapGrid(mods);
    return g ? snapToGrid(p, g).p : this.rectSnap(p, frame, mods);
  }

  /** The rectangle from the drag start to p, aligned to the frame captured at the press. */
  private apronRect(p: Pt, mods: Mods): { pts: Pt[]; w: number; h: number } | null {
    const s0 = this.start;
    if (!s0) return null;
    // The frame is captured at the press, so holding Alt mid drag cannot flip the rectangle under the player.
    if (this.rectFrame === null) this.rectFrame = this.apronFrame(s0, mods);
    const frame = this.rectFrame;
    const g = this.snapGrid(mods);
    const q = this.rectCorner(p, frame, mods);
    const u = g ? { x: g.ax, y: g.ay } : compassVector(frame);
    const v = g ? { x: g.cx, y: g.cy } : { x: -u.y, y: u.x };
    const du = (q.x - s0.x) * u.x + (q.y - s0.y) * u.y;
    const dv = (q.x - s0.x) * v.x + (q.y - s0.y) * v.y;
    const pts = [s0, { x: s0.x + u.x * du, y: s0.y + u.y * du }, { x: s0.x + u.x * du + v.x * dv, y: s0.y + u.y * du + v.y * dv }, { x: s0.x + v.x * dv, y: s0.y + v.y * dv }];
    return { pts, w: Math.abs(du), h: Math.abs(dv) };
  }

  /** Rectangle apron: live width, height and area; Ctrl cuts. */
  private previewApronRect(p: Pt, mods: Mods): void {
    const r = this.apronRect(p, mods);
    if (!r) return;
    const cut = mods.ctrl === true;
    const area = r.w * r.h;
    let problem: Problem | null = null;
    if (!cut) problem = area < 400 ? { code: 'apronTooSmall', args: { min: 400 } } : this.landProblem({ polygon: r.pts });
    const [a, b, c] = r.pts;
    const tags = [
      { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, text: `${Math.round(r.w)} m` },
      { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2, text: `${Math.round(r.h)} m` },
    ];
    this.show({ valid: problem === null, shapes: [{ k: 'poly', pts: r.pts }], tone: 'snap', tags, label: { x: c.x, y: c.y, text: this.apronReadout(area, cut) } }, problem, 'hint.apronRect');
  }

  private commitApronRect(p: Pt, mods: Mods): void {
    const st = useToolStore.getState();
    const r = this.apronRect(p, mods);
    this.dragging = false;
    this.start = null;
    this.deps.setGhost(null);
    if (!r || r.w < 1 || r.h < 1) return;
    if (mods.ctrl) this.deps.send({ type: 'cutApron', polygon: r.pts });
    else this.deps.send({ type: 'buildApron', polygon: r.pts, surface: st.surface, tier: st.tier });
  }

  // Stands ---------------------------------------------------------------

  /** Heading of the runway nearest a point, or the site axis when there is none. Rows and buildings square up to it. */
  private frameAt(p: Pt): number {
    let best = Infinity;
    let heading = this.site()?.corridor.headingDeg ?? 0;
    for (const r of this.af.runways) {
      const f = frameOf(r, p.x, p.y);
      const d = Math.hypot(f.s < 0 ? f.s : f.s > r.lengthM ? f.s - r.lengthM : 0, f.lateral);
      if (d < best) {
        best = d;
        heading = r.headingDeg;
      }
    }
    return heading;
  }

  private standPlan(p: Pt, mods: Mods): { x: number; y: number; count: number; spacing: number; heading: number; size: StandSize; ga: boolean } {
    const st = useToolStore.getState();
    const ga = st.tool === 'gaBlock';
    const size: StandSize = ga ? 'small' : st.standSize;
    const q = this.placeAt(p, mods);
    // Stands sit side by side at the size's width (docs/DESIGN_REVISION_2.md table 3.2).
    return { x: q.x, y: q.y, count: ga ? st.gaCount : st.standCount, spacing: STAND_SIZES[size].widthM, heading: this.rowHeadingAt(p, mods), size, ga };
  }

  private previewStands(p: Pt, mods: Mods): void {
    const plan = this.standPlan(p, mods);
    const d = compassVector(plan.heading);
    const perp = { x: -d.y, y: d.x };
    const shapes: GhostShape[] = [];
    // The stands as they will be built: lead-in lines and curves to the taxiway, stop bars, boxes and numbers.
    const st = useToolStore.getState();
    const cands: Stand[] = [];
    for (let i = 0; i < plan.count; i++) {
      cands.push({
        id: -1 - i,
        cost: 0,
        number: String(this.af.stands.length + i + 1),
        x: plan.x + perp.x * plan.spacing * i,
        y: plan.y + perp.y * plan.spacing * i,
        headingDeg: plan.heading,
        type: plan.ga || plan.size === 'small' ? 'remote' : st.standType,
        size: plan.size,
        code: sizeCode(plan.size),
        surface: plan.ga ? 'gravel' : 'concrete',
        pushback: 'auto',
      });
    }
    let problem: Problem | null = null;
    if (this.ctx()) {
      const last = { x: plan.x + perp.x * plan.spacing * (plan.count - 1), y: plan.y + perp.y * plan.spacing * (plan.count - 1) };
      problem = this.landProblem({ pts: [{ x: plan.x, y: plan.y }, last], widthM: STAND_SIZES[plan.size].maxSpanM });
      if (!problem && !plan.ga) {
        let onApron = true;
        for (let i = 0; i < plan.count && onApron; i++) {
          const sx = plan.x + perp.x * plan.spacing * i;
          const sy = plan.y + perp.y * plan.spacing * i;
          onApron = this.af.aprons.some((a) => apronContains(a, sx, sy));
        }
        if (!onApron) problem = { code: 'standNeedsApron' };
      }
    }
    this.show({ valid: problem === null, shapes, preview: { stands: cands }, label: { x: plan.x, y: plan.y, text: tFormat('ghost.stands', { n: plan.count, hdg: String(plan.heading).padStart(3, '0') }) } }, problem, plan.ga ? 'hint.gaBlock' : 'hint.stands');
  }

  private commitStands(p: Pt, mods: Mods): void {
    const st = useToolStore.getState();
    const plan = this.standPlan(p, mods);
    if (plan.ga) this.deps.send({ type: 'buildGaBlock', x: plan.x, y: plan.y, headingDeg: plan.heading, count: plan.count });
    else this.deps.send({ type: 'buildStands', x: plan.x, y: plan.y, headingDeg: plan.heading, count: plan.count, spacingM: plan.spacing, standType: st.standType, size: plan.size });
  }

  // Terminal ---------------------------------------------------------------

  private tStart: { cx: number; cy: number } | null = null;
  private tGrid: TerminalGrid | null = null;
  private tTemp: TerminalGrid | null = null;
  private readonly bboxCache = new WeakMap<TerminalGrid, { x0: number; y0: number; x1: number; y1: number } | null>();

  private floorBox(g: TerminalGrid): { x0: number; y0: number; x1: number; y1: number } | null {
    if (this.bboxCache.has(g)) return this.bboxCache.get(g) ?? null;
    const box = floorBounds(g);
    this.bboxCache.set(g, box);
    return box;
  }

  /** The existing building a point belongs to: inside or within four cells of its floor. */
  private buildingAt(p: Pt): TerminalGrid | null {
    for (const g of useGameStore.getState().terminalGrids) {
      const box = this.floorBox(g);
      if (!box) continue;
      const c = worldToCell(g, p.x, p.y);
      if (c.cx >= box.x0 - 4 && c.cx <= box.x1 + 5 && c.cy >= box.y0 - 4 && c.cy <= box.y1 + 5) return g;
    }
    return null;
  }

  /**
   * The grid an edit at this point goes to: an existing building, or a fresh one that starts here.
   * A fresh foundation starts on a grid node in grid mode, and keeps the 2 m local cell grid inside
   * the building either way (T42 R5).
   */
  private gridFor(p: Pt, mods: Mods): TerminalGrid {
    const existing = this.buildingAt(p);
    if (existing) return existing;
    const st = useToolStore.getState();
    const heading = this.rowHeadingAt(p, mods);
    const g = st.tSub === 'foundation' ? this.snapGrid(mods) : null;
    const q = g ? snapToGrid(p, g).p : { x: Math.round(p.x / 2) * 2, y: Math.round(p.y / 2) * 2 };
    const o = originFor(q.x, q.y, heading);
    const t = this.tTemp;
    if (t && t.ox === o.ox && t.oy === o.oy && t.headingDeg === heading) return t;
    this.tTemp = newGrid(-1, o.ox, o.oy, heading);
    return this.tTemp;
  }

  private terminalAt(p: Pt): number | null {
    for (const g of useGameStore.getState().terminalGrids) {
      const c = cellAtWorld(g, p.x, p.y);
      const i = cellIndex(g, c.cx, c.cy);
      if (i >= 0 && g.floor[i] > 0) return g.id;
    }
    return null;
  }

  private env() {
    const ctx = this.ctx();
    if (!ctx) return null;
    return { ctx, af: this.af, others: useGameStore.getState().terminalGrids };
  }

  /** Builds the edit for the current drag in the cell space of the grid. */
  private terminalEdit(g: TerminalGrid, a: { cx: number; cy: number }, b: { cx: number; cy: number }): TerminalEdit | null {
    const st = useToolStore.getState();
    const sub = st.tSub;
    if (sub === 'wall' || sub === 'door') {
      // Grid lines: horizontal when the drag is mostly along x.
      let x0 = Math.round(a.cx);
      let y0 = Math.round(a.cy);
      let x1 = Math.round(b.cx);
      let y1 = Math.round(b.cy);
      if (sub === 'door') {
        const e = this.nearestEdge(a);
        return { op: 'wall', x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, variant: WALL.Door };
      }
      if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) y1 = y0;
      else x1 = x0;
      if (x0 === x1 && y0 === y1) {
        const e = this.nearestEdge(a);
        x0 = e.x0;
        y0 = e.y0;
        x1 = e.x1;
        y1 = e.y1;
      }
      return { op: 'wall', x0, y0, x1, y1, variant: st.wallType };
    }
    void g;
    const x0 = Math.floor(Math.min(a.cx, b.cx));
    const y0 = Math.floor(Math.min(a.cy, b.cy));
    const x1 = Math.floor(Math.max(a.cx, b.cx)) + 1;
    const y1 = Math.floor(Math.max(a.cy, b.cy)) + 1;
    if (sub === 'foundation') return { op: 'foundation', x0, y0, x1, y1, variant: 0 };
    if (sub === 'floor') return { op: 'floor', x0, y0, x1, y1, variant: st.floorType };
    if (sub === 'erase') return { op: 'erase', x0, y0, x1, y1, variant: 0 };
    if (sub === 'zone') return { op: 'zone', x0, y0, x1, y1, variant: st.zoneType };
    return { op: 'fixture', x0, y0, x1, y1, variant: st.fixtureId };
  }

  /** The grid edge closest to a fractional cell position. */
  private nearestEdge(c: { cx: number; cy: number }): { x0: number; y0: number; x1: number; y1: number } {
    const ry = Math.round(c.cy);
    const rx = Math.round(c.cx);
    if (Math.abs(c.cy - ry) <= Math.abs(c.cx - rx)) return { x0: Math.floor(c.cx), y0: ry, x1: Math.floor(c.cx) + 1, y1: ry };
    return { x0: rx, y0: Math.floor(c.cy), x1: rx, y1: Math.floor(c.cy) + 1 };
  }

  private terminalDown(p: Pt, mods: Mods): void {
    this.frozen = false;
    const g = this.gridFor(p, mods);
    this.tGrid = g;
    const c = worldToCell(g, p.x, p.y);
    this.tStart = { cx: c.cx, cy: c.cy };
    this.dragging = true;
  }

  private previewTerminal(p: Pt, mods: Mods): void {
    if (this.frozen && !this.dragging) return;
    const st = useToolStore.getState();
    const hint = `hint.terminal.${st.tSub}`;
    const g = this.dragging && this.tGrid ? this.tGrid : this.gridFor(p, mods);
    const c = worldToCell(g, p.x, p.y);
    const a = this.dragging && this.tStart ? this.tStart : c;
    const edit = this.terminalEdit(g, a, c);
    const env = this.env();
    if (!edit || !env) {
      this.deps.setGhost(null);
      return;
    }
    const plan = planEdit(g, edit, env);
    const isWall = edit.op === 'wall';
    const shapes: GhostShape[] = [];
    let label: string;
    if (isWall) {
      const a0 = cornerWorld(g, edit.x0, edit.y0);
      const a1 = cornerWorld(g, edit.x1, edit.y1);
      shapes.push({ k: 'strip', pts: [a0, a1], w: 0.8 });
      label = tFormat('ghost.terminalWall', { n: plan.changes, cost: formatMoney(plan.cost) });
    } else {
      shapes.push({ k: 'poly', pts: rectWorld(g, edit.x0, edit.y0, edit.x1, edit.y1) });
      label = tFormat('ghost.terminal', { n: plan.changes, cost: formatMoney(plan.cost) });
    }
    // Before a drag starts, a hovered cell with nothing to do is not an error.
    const idle = !this.dragging && plan.changes === 0;
    let problem: Problem | null = idle ? null : plan.problem;
    if (!problem && !idle && plan.changes === 0) problem = { code: 'terminalNeedsFoundation' };
    if (problem && problem.code === 'notOwned' && edit.op === 'foundation') {
      const ids = unownedParcelsUnder(env.ctx, { polygon: rectWorld(g, edit.x0, edit.y0, edit.x1, edit.y1) });
      const site = this.site();
      let cost = 0;
      if (site) for (const id of ids) cost += site.parcelPrice[id];
      useToolStore.getState().set({ buy: { ids, cost } });
    } else {
      useToolStore.getState().set({ buy: null });
    }
    this.show({ valid: problem === null && !idle, shapes, label: { x: p.x, y: p.y, text: label } }, problem, hint);
  }

  private finishTerminal(p: Pt): void {
    const g = this.tGrid;
    const a = this.tStart;
    this.dragging = false;
    this.tStart = null;
    this.tGrid = null;
    if (!g || !a) return;
    const c = worldToCell(g, p.x, p.y);
    const edit = this.terminalEdit(g, a, c);
    const env = this.env();
    if (!edit || !env) return;
    const plan = planEdit(g, edit, env);
    if (plan.problem || plan.changes === 0) {
      // Keep the preview and the reason up, so missing land can be bought first.
      this.frozen = true;
      return;
    }
    this.deps.send({ type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit });
    this.deps.setGhost(null);
  }

  // Demolish -------------------------------------------------------------

  private previewDemolish(p: Pt): void {
    const hit = pickObject(this.af, p.x, p.y, Math.max(8, 14 / this.deps.zoom()));
    if (!hit) {
      this.deps.setGhost(null);
      useToolStore.getState().set({ hint: 'hint.demolish', problem: null, buy: null });
      return;
    }
    const af = this.af;
    const shapes: GhostShape[] = [];
    if (hit.kind === 'runway') {
      const r = af.runways.find((x) => x.id === hit.id);
      if (r) shapes.push({ k: 'box', x: r.x1, y: r.y1, headingDeg: r.headingDeg, len: r.lengthM, w: r.widthM + 2 * r.shoulderM });
    } else if (hit.kind === 'taxiway') {
      const t = af.taxiways.find((x) => x.id === hit.id);
      if (t) shapes.push({ k: 'strip', pts: t.points, w: t.widthM });
    } else if (hit.kind === 'apron') {
      const a = af.aprons.find((x) => x.id === hit.id);
      if (a) shapes.push({ k: 'poly', pts: a.polygon });
    } else {
      const s = af.stands.find((x) => x.id === hit.id);
      if (s) shapes.push({ k: 'ring', x: s.x, y: s.y, r: 8 });
    }
    this.show({ valid: false, shapes }, null, 'hint.demolishConfirm');
  }
}
