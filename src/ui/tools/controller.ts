import { footprintCells, fixtureUseCells, planPropWithUse, propUseRect, useCellBlocked } from '@shared/useArea';
import { apronContains, touches } from '@shared/apronGeom';
import { extendUnitPrice, gaBlockPricing, keptPavement, mergePiece, removePlan, roundApronPoly, standHeading, standRowPricing, type RemovePlan } from '@shared/apronPricing';
import { AIRFIELD, BUSINESS, GROUND, PAINT, STAND_PLACEMENT, STAND_SIZES, SURFACE_SPEC, SURFACE_DATA } from '@data/index';
import { buildingDoor, buildingRect, depotExit, depotRect, headingVec, roadSnapTargets, type RoadTarget } from '@shared/roadGraph';
import { defaultAccepts, sizeCode } from '@shared/standSizes';
import { ACCEPT_GA, codeIndex, compassVector, CODES, runwaySide, towerRect, type AirfieldPayload, type Apron, type CodeLetter, type HoldingPoint, type PadSide, type Runway, type Stand, type StandSize, type StandType, type Surface, type Taxiway } from '@shared/airfield';
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
import { closestOnSegment, distToSegment, polylineLength, type Pt } from '@shared/geom';
import { windBand, type SitePayload } from '@shared/site';
import { fixtureKey, isBaggageFixture, TERMINAL_CELL_M, type FixtureKey, type Prop, type TerminalGrid } from '@shared/business';
import { dropOutCell, screeningRoomOk, validateBagNode, type BagNodeSpec } from '@shared/baggageNodes';
import { padTarget, padsBackwards, transitionOf, transitionPads } from '@shared/transitionPads';
import { footprintSteps, propAt, propCost, propRect, propSpec, PROP_STEP_M } from '@shared/props';
import { unitProblem } from '@shared/tenants';
import { TENANT_CATEGORY_KEYS } from '@data/schemas/tenants';
import { cellAtWorld, cellIndex, fixtureAnchor, fixtureCells, floorBounds, newGrid, originFor, planEdit, rectWorld, worldToCell, cornerWorld, type TerminalEdit } from '@shared/terminalOps';
import { bagNodeAt } from '../standInspector';
import { checkPolygon, checkStrip, estimateStripCost, polygonArea, unownedParcelsUnder, type BuildContext, type Problem } from '@shared/validate';
import type { Command } from '@sim/commands';
import { planFor, smoothCorners } from '@render/markings/taxiPlan';
import { findSnap, TAXI_TOOL, taxiNodes, type SnapHit, type TaxiNode } from '@shared/pavement/snap';
import { envelopeType, standBox, standTaxiwayClash, taxiClashes } from '@shared/clearance';
import { standSlot } from '@shared/standGeom';
import { standLeadTaxiways } from '@shared/standFork';
import { snapStandRow } from '@shared/standSnap';
import { runwayWorksDays } from '@shared/surfaceRules';
import { padArea, padCurve, padPolygon, padValue } from '@shared/turnPad';
import { previewPenetrations, surfaceOutlines, type Penetration } from '@shared/obstacles';
import { typeOutlines } from '@render/markings/standLayout';
import { gridById, gridsFor, snapToGrid, type ConstructionGrid } from '@shared/constructionGrid';
import { towerBuildCost } from '@shared/towerBudget';
import { towerBlocked, towersOverlap } from '@shared/towerGeom';
import { formatMoney, formatNumber } from '../format';
import { tDynamic, tFormat, type StringKey } from '../strings';
import { useGameStore } from '../stores/gameStore';
import { GRID_TOOLS, snapModeOf, useToolStore, type MovingItem, type Tool } from '../stores/toolStore';
import { bagCost, bagGhostCells, bagOrigin, nextBagRot } from './baggageTool';
import { brushCellEdit, cellLine, doorEdit, enterBrushCell, fixtureEdit, footprintRect, hasRotation, nextFixtureRot, transitionOrientationBreaks, zoneEdit } from './fixtureRot';
import { guideTip, markShape, markTip, type SnapMark } from './snapMark';

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
  setGuide(from: Pt | null, to: Pt | null, from2?: Pt, to2?: Pt): void;
}

/** The tools that draw an apron piece: build, remove (cut out) and extend the selected apron. */
const isApronTool = (t: Tool): boolean => t === 'apron' || t === 'apronRemove' || t === 'apronExtend';

/** The surface a stand of this size is paved in: the picked one when the size allows it, else the size's first. */
export function pickedStandSurface(picked: Surface, size: StandSize): Surface {
  const list = STAND_SIZES[size].surfaces;
  return list.includes(picked) ? picked : list[0];
}

const compassOf = (dx: number, dy: number): number => ((Math.round((Math.atan2(dx, -dy) * 180) / Math.PI) % 360) + 360) % 360;

/** How close the cursor must come to a runway threshold before a turn pad previews (task T01 spec). */
const TURN_PAD_REACH_M = 150;
/** Kit asset of the bag chute a desk or bag drop ghost shows behind it: the unconnected ramp, as a new desk has no link. */
const DROP_GHOST_ASSET = 'ramp.unconnected';
/** A laid taxiway point within this distance of a node, end or centerline counts as joined to it. */
const JOINED_M = 0.5;

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
  /** The grid copy the moved item was lifted from, kept while the same item moves over the same grid (T85). */
  private lifted: { src: TerminalGrid; item: MovingItem; grid: TerminalGrid } | null = null;
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
    if (this.apronRectTool()) return this.dragging && this.start !== null;
    return false;
  }

  /** True for the tools where a plain click only sets the start point. */
  get twoClick(): boolean {
    const st = useToolStore.getState();
    // The apron rectangle counts only once its press started a rectangle: a press of the extend tool may pick the apron instead (T84).
    if (this.apronRectTool()) return this.dragging;
    return st.tool === 'runway' || (st.tool === 'terminal' && st.tSub !== 'door' && st.tSub !== 'bagNode' && st.tSub !== 'prop' && st.tSub !== 'propRemove' && st.tSub !== 'move');
  }

  /**
   * True when the end of the gesture waits for the build confirmation instead of building at once
   * (T84): the rectangle tools, which are the apron in rectangle mode and the terminal's foundation,
   * floor, zone and tenant unit rectangles.
   */
  get confirmsEnd(): boolean {
    const st = useToolStore.getState();
    if (this.apronRectTool()) return this.dragging && this.start !== null;
    if (st.tool !== 'terminal' || !this.dragging || this.tStart === null) return false;
    return st.tSub === 'foundation' || st.tSub === 'floor' || st.tSub === 'unit' || (st.tSub === 'zone' && !st.zoneBrush);
  }

  /** True while any gesture is in progress, so the map should scroll when the pointer reaches an edge. */
  get gestureActive(): boolean {
    return this.armed || this.dragging || this.pts.length > 0;
  }

  private apronRectTool(): boolean {
    const st = useToolStore.getState();
    return isApronTool(st.tool) && st.apronMode === 'rect';
  }

  /** The end point of a rectangle waiting for the build confirmation, or null (T84). */
  private pendingEnd: { p: Pt; mods: Mods } | null = null;

  /** Shows the rectangle ending at p and holds it until the player confirms or cancels it (T84). */
  holdEnd(p: Pt, mods: Mods): void {
    this.pendingEnd = null;
    this.move(p, mods);
    this.pendingEnd = { p, mods };
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
    if (kind === 'bagNode') {
      const node = useGameStore.getState().business?.baggage.nodes.find((x) => x.id === id);
      const g = node ? useGameStore.getState().terminalGrids.find((x) => x.id === node.building) : undefined;
      if (!node || !g) return [];
      const xs = node.cells.map((c) => c[0]);
      const ys = node.cells.map((c) => c[1]);
      return [{ k: 'poly', pts: rectWorld(g, Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1) }];
    }
    if (kind === 'tower') {
      const tw = af.towers?.find((x) => x.id === id);
      return tw ? [{ k: 'poly', pts: towerRect(tw.x, tw.y, BUSINESS.tower.footprintM) }] : [];
    }
    if (kind === 'depot') {
      const d = af.depots?.find((x) => x.id === id);
      return d ? [{ k: 'poly', pts: depotRect(d) }] : [];
    }
    if (kind === 'building') {
      const b = af.buildings?.find((x) => x.id === id);
      return b ? [{ k: 'poly', pts: buildingRect(b) }] : [];
    }
    if (kind === 'road') {
      const r = af.roads?.find((x) => x.id === id);
      return r ? [{ k: 'strip', pts: r.points, w: GROUND.road.widthM }] : [];
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
    // Over a fixture or prop the hover outlines that item, as a click selects only it (T88).
    const propHit = term !== null ? this.propUnder(p) : null;
    const pc = propHit ? worldToCell(propHit.g, p.x, p.y) : null;
    const propPick = propHit && pc ? { building: propHit.g.id, x: pc.cx * TERMINAL_CELL_M, y: pc.cy * TERMINAL_CELL_M } : null;
    const fixturePick = term !== null && !propPick ? this.fixtureAt(p, term) : null;
    const item = term !== null && (propPick || fixturePick) ? this.pickedItemShape(term, fixturePick, propPick) : null;
    const key = item ? `item:${propPick ? `p${propPick.x}:${propPick.y}` : `f${fixturePick?.x}:${fixturePick?.y}`}` : kind ? `${kind}:${id}` : '';
    if (key === this.hovered) return;
    this.hovered = key;
    this.deps.setHighlight(item ? [item] : kind ? this.shapesFor(kind, id) : null, this.selectedShapes());
    this.deps.setCursor(kind ? 'pointer' : 'default');
  }

  selectedShapes(): GhostShape[] | null {
    const st = useToolStore.getState();
    const sel = st.selection;
    if (!sel) return null;
    // A picked fixture or prop is the selection itself (T88): only its footprint is outlined, not the whole terminal.
    if (sel.kind === 'terminal') {
      const item = this.pickedItemShape(sel.id, st.fixturePick, st.propPick);
      if (item) return [item];
    }
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

  /** Footprint outline of the fixture or prop picked in a terminal, or null when none is picked there. */
  private pickedItemShape(building: number, fixturePick: { building: number; x: number; y: number } | null, propPick: { building: number; x: number; y: number } | null): GhostShape | null {
    const g = useGameStore.getState().terminalGrids.find((x) => x.id === building);
    if (!g) return null;
    if (propPick?.building === building) {
      const i = propAt(g.props, propPick.x, propPick.y);
      const r = i >= 0 ? propRect(g.props[i]!) : null;
      const k = PROP_STEP_M / TERMINAL_CELL_M;
      return r ? { k: 'poly', pts: rectWorld(g, r.sx0 * k, r.sy0 * k, r.sx1 * k, r.sy1 * k) } : null;
    }
    if (fixturePick?.building !== building) return null;
    const cells = fixtureCells(g, fixtureAnchor(g, cellIndex(g, fixturePick.x, fixturePick.y)));
    if (cells.length === 0) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of cells) {
      const x = (c % g.w) + g.x0;
      const y = Math.floor(c / g.w) + g.y0;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
    return { k: 'poly', pts: rectWorld(g, x0, y0, x1, y1) };
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
    this.mark = null;
    this.taxiPress = null;
    this.pendingEnd = null;
    this.deps.setGhost(null);
    useToolStore.getState().set({ hint: null, problem: null, buy: null });
  }

  private nodeCache: { af: AirfieldPayload; nodes: TaxiNode[] } | null = null;
  /** The taxiway tool's current snap target, shown as a marker with a tooltip. */
  private snapHit: SnapHit | null = null;
  /** What the last snap of any drawing tool locked onto, shown as a marker with a tooltip (T70). */
  private mark: SnapMark | null = null;
  /** Where a press in the taxiway tool started, so a drag adds a segment (T70). */
  private taxiPress: Pt | null = null;

  /** The snap radius of the drawing tools in meters: a fixed size on screen with a floor (T70). */
  private snapRadius(): number {
    return Math.max(AIRFIELD.snapTool.minRadiusM, AIRFIELD.snapTool.radiusPx / this.deps.zoom());
  }

  /** Pushes the marker of the current snap target and returns its tooltip, or null when nothing snapped. */
  private markDecor(shapes: GhostShape[]): string | null {
    if (!this.mark) return null;
    shapes.push(markShape(this.mark));
    return markTip(this.mark);
  }

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
    this.mark = null;
    if (mods.alt) {
      this.deps.setGuide(null, null);
      return p;
    }
    const hit = findSnap(this.af.taxiways, this.taxiNodes(), p);
    if (hit) {
      this.snapHit = hit;
      this.mark = { kind: hit.kind, p: hit.p, label: hit.label || undefined };
      this.deps.setGuide(null, null);
      return hit.p;
    }
    return this.snap(p, prev, mods, true, TAXI_TOOL.angleStepDeg);
  }

  /** Snaps to vertices, centerlines and the alignment frame. Shift gives 15 degree steps, Alt is free. */
  private snap(p: Pt, prev: Pt | null, mods: Mods, centerlines: boolean, stepDeg = 90): Pt {
    this.mark = null;
    const radius = this.snapRadius();
    const v = snapToVertex(this.af, p.x, p.y, radius);
    if (v) {
      this.mark = { kind: 'vertex', p: v };
      return v;
    }
    if (centerlines) {
      const edge = snapToRunwayEdge(this.af, p.x, p.y, radius * 1.2, prev);
      if (edge) {
        this.mark = { kind: 'runwayEdge', p: edge };
        return edge;
      }
      const c = snapToCenterline(this.af, p.x, p.y, radius * 0.7);
      if (c) {
        this.mark = { kind: 'centerline', p: c };
        return c;
      }
    }
    if (!mods.alt) {
      const g = alignGuide(this.af, this.pts.length > 0 ? this.pts : this.start ? [this.start] : [], p.x, p.y, Math.max(4, 9 / this.deps.zoom()));
      if (g) {
        const [l1, l2] = g.lines;
        this.deps.setGuide(l1.from, l1.to, l2?.from, l2?.to);
        this.mark = { kind: 'guide', p: g.p, label: guideTip(g.lines) };
        return g.p;
      }
    }
    // The grid is the lowest priority snap: vertices, runway edges, centerlines and guides win (T42 R3).
    const grid = this.snapGrid(mods);
    if (grid) {
      this.deps.setGuide(null, null);
      const q = snapToGrid(p, grid).p;
      this.mark = { kind: 'grid', p: q };
      return q;
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
    const q = { x: prev.x + dir.x * len, y: prev.y + dir.y * len };
    this.mark = { kind: 'angle', p: q, label: String(Math.round((((target % 360) + 360) % 360)) % 360).padStart(3, '0') };
    return q;
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
    } else if (isApronTool(tool) && useToolStore.getState().apronMode === 'rect' && (tool !== 'apronExtend' || this.extendTarget())) {
      this.rectFrame = null;
      this.start = this.rectCorner(p, this.apronFrame(p, mods), mods);
      this.dragging = true;
    } else if (tool === 'terminal') {
      this.terminalDown(p, mods);
    } else if ((tool === 'taxiway' || tool === 'taxilane') && this.taxiDrawing()) {
      this.taxiPress = p;
    }
  }

  /** True while the taxiway tool lays out a polyline: a new taxiway, or the extension of a picked one. */
  private taxiDrawing(): boolean {
    const st = useToolStore.getState();
    return st.taxiMode === 'new' || (st.taxiMode === 'extend' && this.tEdit !== null);
  }

  /**
   * The points laid out so far, plus the snapped press point while the pointer drags away from it, so
   * one press and drag draws a whole segment (T70). A plain click adds only the release point.
   */
  private taxiBase(p: Pt, mods: Mods): Pt[] {
    const press = this.taxiPress;
    if (!press || Math.hypot(p.x - press.x, p.y - press.y) * this.deps.zoom() <= AIRFIELD.snapTool.dragStartPx) return this.pts;
    const last = this.pts.length > 0 ? this.pts[this.pts.length - 1] : null;
    const a = this.taxiSnap(press, last, mods);
    return last && Math.hypot(a.x - last.x, a.y - last.y) < 3 ? this.pts : [...this.pts, a];
  }

  move(p: Pt, mods: Mods): void {
    // A rectangle waiting for its confirmation stays as it is until the player answers (T84).
    if (this.pendingEnd) return;
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
        if (!this.taxiDrawing()) this.previewTaxiEdit(p);
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
      case 'apronRemove':
      case 'apronExtend':
        if (st.tool === 'apronExtend' && !this.extendTarget()) this.show({ valid: true, shapes: [] }, null, 'hint.apronExtendPick');
        else if (st.apronMode === 'rect') {
          if (this.dragging && this.start) this.previewApronRect(p, mods);
          else this.previewApronHover(p, mods);
        } else this.previewApron(p, mods);
        break;
      case 'stands':
      case 'gaBlock':
        this.previewStands(p, mods);
        break;
      case 'tower':
        this.previewTower(p, mods);
        break;
      case 'road':
        this.previewRoad(p, mods);
        break;
      case 'depot':
        this.previewDepot(p, mods);
        break;
      case 'building':
        this.previewBuilding(p, mods);
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
        if (!this.taxiDrawing()) {
          this.taxiEditClick(p);
          break;
        }
        this.pts = [...this.taxiBase(p, mods)];
        this.taxiPress = null;
        const prev = this.pts.length > 0 ? this.pts[this.pts.length - 1] : null;
        const q = this.taxiSnap(p, prev, mods);
        if (prev && Math.hypot(q.x - prev.x, q.y - prev.y) < 3) break;
        this.pts.push(q);
        this.previewTaxiway(p, mods, st.tool === 'taxilane');
        break;
      }
      case 'apron':
      case 'apronRemove':
      case 'apronExtend': {
        if (st.tool === 'apronExtend' && !this.extendTarget()) {
          this.pickExtend(p);
          break;
        }
        if (st.apronMode === 'rect') {
          this.commitApronRect(p, mods);
          break;
        }
        const prev = this.pts.length > 0 ? this.pts[this.pts.length - 1] : null;
        this.pts.push(this.apronCorner(p, prev, mods));
        this.cutting = this.apronCuts(mods);
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
      case 'tower':
        this.commitTower(p, mods);
        break;
      case 'road': {
        const prev = this.pts.length > 0 ? this.pts[this.pts.length - 1] : null;
        const q = this.roadPoint(p, mods);
        if (!prev || Math.hypot(q.x - prev.x, q.y - prev.y) >= GROUND.road.minSegmentM) this.pts.push(q);
        this.previewRoad(p, mods);
        break;
      }
      case 'depot':
        this.commitDepot(p, mods);
        break;
      case 'building': {
        const q = this.placeAt(p, mods);
        const st2 = useToolStore.getState();
        this.deps.send({ type: 'buildBuilding', kind: st2.buildingKind, x: q.x, y: q.y, headingDeg: st2.depotHeading });
        break;
      }
      case 'terminal':
        this.finishTerminal(p);
        break;
      case 'demolish': {
        // A terminal prop or fixture right under the cursor wins over an airfield object within the pick radius.
        if (this.propUnder(p) || this.fixtureUnder(p)) {
          this.removePropAt(p);
          break;
        }
        const hit = pickObject(this.af, p.x, p.y, Math.max(8, 14 / this.deps.zoom()));
        if (hit?.kind === 'tower') this.deps.send({ type: 'demolishTower', id: hit.id });
        else if (hit) this.deps.send({ type: 'demolish', kind: hit.kind, id: hit.id });
        break;
      }
      case 'select': {
        const hit = pickObject(this.af, p.x, p.y, Math.max(8, 14 / this.deps.zoom()));
        const term = hit ? null : this.terminalAt(p);
        const bag = hit ? null : this.bagNodeAt(p);
        // A prop under the cursor wins over the fixture, since the two never share a cell (T85).
        const propHit = term !== null && bag === null ? this.propUnder(p) : null;
        const pc = propHit ? worldToCell(propHit.g, p.x, p.y) : null;
        const propPick = propHit && pc ? { building: propHit.g.id, x: pc.cx * TERMINAL_CELL_M, y: pc.cy * TERMINAL_CELL_M } : null;
        const fixturePick = term !== null && bag === null && !propPick ? this.fixtureAt(p, term) : null;
        useToolStore.getState().set({ selection: hit ? { kind: hit.kind, id: hit.id } : bag !== null ? { kind: 'bagNode', id: bag } : term ? { kind: 'terminal', id: term } : null, fixturePick, propPick });
        break;
      }
    }
    this.dragging = false;
  }

  /** Builds what is being laid out: finishes a polyline or completes an armed drag at the pointer. */
  confirm(): void {
    useToolStore.getState().set({ confirmAt: null });
    const tool = useToolStore.getState().tool;
    const held = this.pendingEnd;
    if (held) {
      this.pendingEnd = null;
      this.up(held.p, held.mods);
      return;
    }
    if (this.armed) {
      this.up(this.cursor, { shift: false, alt: false });
      return;
    }
    if (tool === 'taxiway' || tool === 'taxilane' || tool === 'road' || isApronTool(tool)) this.finish();
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
    else if (tool === 'road') this.commitRoad();
    else if (isApronTool(tool)) this.commitApron();
  }

  key(e: KeyboardEvent): boolean {
    const st = useToolStore.getState();
    if (e.key === 'Escape' && st.tool === 'stands' && st.standHeading !== null) {
      // The first Escape gives a turned stand back to auto facing, the next one leaves the tool.
      st.set({ standHeading: null });
      this.move(this.cursor, { shift: false, alt: false });
      return true;
    }
    const moving = st.tool === 'terminal' && st.tSub === 'move' ? st.moving : null;
    if (e.key === 'Escape' && moving) {
      // Escape puts a moved item down where it was and goes back to selecting it (T85).
      st.set({ moving: null, tool: 'select' });
      this.lifted = null;
      this.deps.setGhost(null);
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && moving && !e.ctrlKey && !e.metaKey) {
      st.set({ moving: { ...moving, rot: ((moving.rot + 1) % 4) as 0 | 1 | 2 | 3 } });
      this.move(this.cursor, { shift: false, alt: false });
      return true;
    }
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
    if ((e.key === 'a' || e.key === 'A') && isApronTool(st.tool) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.cancel();
      st.set({ apronMode: st.apronMode === 'rect' ? 'polygon' : 'rect' });
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && (st.tool === 'depot' || st.tool === 'building') && !e.ctrlKey && !e.metaKey) {
      st.set({ depotHeading: (st.depotHeading + 90) % 360 });
      this.move(this.cursor, { shift: false, alt: false });
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && st.tool === 'terminal' && st.tSub === 'prop' && !e.ctrlKey && !e.metaKey) {
      st.set({ propRot: ((st.propRot + 1) % 4) as 0 | 1 | 2 | 3 });
      this.move(this.cursor, { shift: false, alt: false });
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && st.tool === 'terminal' && st.tSub === 'bagNode' && !e.ctrlKey && !e.metaKey) {
      st.set({ bagRot: nextBagRot(st.bagRot) });
      this.move(this.cursor, { shift: false, alt: false });
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && st.tool === 'terminal' && st.tSub === 'fixture' && hasRotation(st.fixtureId)) {
      st.set({ fixtureRot: nextFixtureRot(st.fixtureRot) });
      this.move(this.cursor, { shift: false, alt: false });
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && st.tool === 'rapidExit') {
      // R flips the exit to serve landings from the other threshold.
      st.set({ exitFrom: st.exitFrom === 'a' ? 'b' : 'a' });
      this.move(this.cursor, { shift: false, alt: false });
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && st.tool === 'stands') {
      // R turns the stand by the rotation step from where it faces now, Shift+R by the fine step (D4).
      const step = e.shiftKey ? STAND_PLACEMENT.fineStepDeg : STAND_PLACEMENT.rotateStepDeg;
      st.set({ standHeading: (this.standFacing + step) % 360 });
      this.move(this.cursor, { shift: false, alt: false });
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && (st.tool === 'gaBlock' || st.tool === 'terminal')) {
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
      // The hover point snaps as the press will, so the marker shows where the runway would start.
      const q = this.snap(p, null, mods, false);
      const shapes: GhostShape[] = [{ k: 'ring', x: q.x, y: q.y, r: 15 }];
      const tip = this.markDecor(shapes);
      this.deps.setGhost({ valid: true, shapes, tone: 'snap', tip: tip ? { x: q.x, y: q.y, text: tip } : undefined });
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
    const base = this.taxiBase(p, mods);
    const prev = base.length > 0 ? base[base.length - 1] : null;
    const q = this.taxiSnap(p, prev, mods);
    const width = AIRFIELD.codes[st.code].taxiwayWidthM;
    const pts = [...base, q];
    const shapes: GhostShape[] = [];
    // Every node shows while the tool is open, and the active target gets its own marker.
    for (const n of this.taxiNodes()) shapes.push({ k: 'marker', x: n.p.x, y: n.p.y, shape: 'dot', label: n.arms >= 3 ? n.label : undefined });
    // Points already laid keep the marker of what they joined, so a joined end never looks loose (T84).
    for (const b of base) {
      const hit = findSnap(this.af.taxiways, this.taxiNodes(), b, JOINED_M);
      if (hit) shapes.push(markShape({ kind: hit.kind, p: hit.p, label: hit.label || undefined }));
    }
    const snapTip = this.markDecor(shapes);
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
    // A taxiway node, end or segment names itself first; a clearance warning outranks the softer guide, angle and grid snaps.
    const tip = this.snapHit ? snapTip : (clashTip ?? snapTip);
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

  /** Distance and side of the exit at the pointer, counted from the threshold landings come over and along their direction. */
  private exitPlan(p: Pt): { r: Runway; dist: number; side: 'left' | 'right'; from: 'a' | 'b' } | null {
    const r = this.nearestRunway(p);
    if (!r) return null;
    const from = useToolStore.getState().exitFrom;
    const f = runwayFrame(r, p.x, p.y);
    const s = from === 'b' ? r.lengthM - f.s : f.s;
    const left = from === 'b' ? f.lateral < 0 : f.lateral >= 0;
    return { r, dist: Math.max(200, Math.min(r.lengthM - 200, Math.round(s))), side: left ? 'left' : 'right', from };
  }

  private previewRapidExit(p: Pt): void {
    const st = useToolStore.getState();
    const plan = this.exitPlan(p);
    if (!plan) {
      this.deps.setGhost(null);
      st.set({ hint: 'hint.needRunway', problem: null, buy: null });
      return;
    }
    const pts = rapidExitPoints(plan.r, plan.dist, plan.side, st.exitAngle, plan.from);
    const width = AIRFIELD.codes[st.code].taxiwayWidthM;
    const problem = this.landProblem({ pts, widthM: width });
    this.show(
      {
        valid: problem === null,
        shapes: [{ k: 'strip', pts, w: width }],
        label: { x: pts[0].x, y: pts[0].y, text: tFormat('ghost.exit', { rwy: plan.from === 'b' ? plan.r.nameB : plan.r.nameA, dist: plan.dist, angle: st.exitAngle, suggest: suggestedExitDistance(plan.r.lengthM) }) },
      },
      problem,
      'hint.exit',
    );
  }

  private commitRapidExit(p: Pt): void {
    const st = useToolStore.getState();
    const plan = this.exitPlan(p);
    if (!plan) return;
    this.deps.send({ type: 'buildRapidExit', runwayId: plan.r.id, distM: plan.dist, side: plan.side, angleDeg: st.exitAngle, code: st.code, surface: st.surface, tier: st.tier, landingEnd: plan.from });
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

  /** The apron the extend tool adds to: the selected one, or null until the player picks it. */
  private extendTarget(): Apron | null {
    const sel = useToolStore.getState().selection;
    if (sel?.kind !== 'apron') return null;
    return this.af.aprons.find((a) => a.id === sel.id) ?? null;
  }

  /** The extend tool's first click: the apron under the pointer becomes the one to extend. */
  private pickExtend(p: Pt): void {
    const a = this.af.aprons.find((x) => apronContains(x, p.x, p.y));
    if (!a) {
      this.show({ valid: true, shapes: [] }, { code: 'apron.pickNone' }, 'hint.apronExtendPick');
      return;
    }
    useToolStore.getState().set({ selection: { kind: 'apron', id: a.id }, problem: null });
    this.refreshSelection();
    this.show({ valid: true, shapes: [] }, null, 'hint.apronExtend');
  }

  /** Whether a drawn apron piece cuts: the remove tool always does, the apron tool while Ctrl is held. */
  private apronCuts(mods: Mods): boolean {
    return useToolStore.getState().tool === 'apronRemove' || mods.ctrl === true;
  }

  private apronHint(rect: boolean): string {
    const tool = useToolStore.getState().tool;
    if (tool === 'apronRemove') return rect ? 'hint.apronRemoveRect' : 'hint.apronRemove';
    if (tool === 'apronExtend') return rect ? 'hint.apronExtendRect' : 'hint.apronExtend';
    return rect ? 'hint.apronRect' : 'hint.apron';
  }

  /** Free polygon apron (docs/DESIGN_REVISION_2.md section 4): live edge lengths and area, Ctrl cuts. */
  private previewApron(p: Pt, mods: Mods): void {
    const prev = this.pts.length > 0 ? this.pts[this.pts.length - 1] : null;
    const q = this.apronCorner(p, prev, mods);
    const pts = [...this.pts, q];
    const tags = pts.slice(1).map((b, i) => ({ x: (pts[i].x + b.x) / 2, y: (pts[i].y + b.y) / 2, text: `${Math.round(Math.hypot(b.x - pts[i].x, b.y - pts[i].y))} m` }));
    this.showApron(pts, q, this.apronCuts(mods) || this.cutting, tags, this.apronHint(false));
  }

  /** The live preview of an apron piece: its outline, readout, and the reason it cannot be drawn. */
  private showApron(pts: Pt[], anchor: Pt, cut: boolean, tags: { x: number; y: number; text: string }[], hint: string): void {
    const st = useToolStore.getState();
    const target = this.extendTarget();
    const area = pts.length >= 3 ? polygonArea(pts) : 0;
    const problem = pts.length >= 3 ? this.apronProblem(pts, area, cut, target) : null;
    const shapes: GhostShape[] = pts.length >= 3 ? [{ k: 'poly', pts }] : [{ k: 'strip', pts, w: 1 }];
    const tip = this.markDecor(shapes);
    this.show(
      {
        valid: problem === null,
        shapes,
        // A legal cut reads amber, distinct from the red of an invalid placement.
        tone: st.tool === 'apronRemove' ? 'remove' : 'snap',
        tip: tip && this.mark ? { x: this.mark.p.x, y: this.mark.p.y, text: tip } : undefined,
        tags,
        label: pts.length >= 3 ? { x: anchor.x, y: anchor.y, text: this.apronLabel(pts, area, cut, target) } : undefined,
      },
      problem,
      hint,
    );
  }

  private apronProblem(pts: Pt[], area: number, cut: boolean, target: Apron | null): Problem | null {
    if (useToolStore.getState().tool === 'apronExtend') {
      if (!target || !touches(target, { polygon: roundApronPoly(pts) })) return { code: 'apron.extendNotTouching' };
      return this.landProblem({ polygon: pts });
    }
    if (cut) return this.cutPlan(pts).pieces.length > 0 ? null : { code: 'nothingThere' };
    if (area < 400) return { code: 'apronTooSmall', args: { min: 400 } };
    return this.landProblem({ polygon: pts });
  }

  private apronLabel(pts: Pt[], area: number, cut: boolean, target: Apron | null): string {
    const st = useToolStore.getState();
    if (st.tool === 'apronRemove') {
      const plan = this.cutPlan(pts);
      return tFormat('ghost.apronRemove', { area: formatNumber(Math.round(plan.area)), refund: formatMoney(Math.round(plan.refund)) });
    }
    if (st.tool === 'apronExtend' && target) {
      // Only the new area is paid for, as the sim charges it.
      const merge = mergePiece(this.af.aprons, roundApronPoly(pts), target.surface, extendUnitPrice(target));
      return tFormat('ghost.apron', { area: formatNumber(Math.round(merge.added)), cost: formatMoney(merge.cost) });
    }
    return this.apronReadout(area, cut);
  }

  /** The removal a cut of this piece would make, priced by the sim's own plan. */
  private cutPlan(pts: Pt[]): RemovePlan<Apron> {
    return removePlan(this.af.aprons, roundApronPoly(pts), keptPavement(this.af.stands, this.af.taxiways));
  }

  private apronReadout(area: number, cut: boolean): string {
    const st = useToolStore.getState();
    if (cut) return tFormat('ghost.apronCut', { area: formatNumber(Math.round(area)) });
    const tierIdx = Math.min(st.tier, SURFACE_SPEC[st.surface].pcrTiers.length - 1);
    const cost = Math.round(area * SURFACE_SPEC[st.surface].costPerM2 * (SURFACE_DATA.tierCostFactor[tierIdx] ?? 1));
    return tFormat('ghost.apron', { area: formatNumber(Math.round(area)), cost: formatMoney(cost) });
  }

  private commitApron(): void {
    if (this.pts.length < 3) return;
    this.sendApron(this.pts.slice(), this.cutting);
    this.pts = [];
    this.cutting = false;
    this.deps.setGhost(null);
  }

  /** Sends a drawn apron piece as its tool's command: extend the selected apron, cut it out, or build it. */
  private sendApron(polygon: Pt[], cut: boolean): void {
    const st = useToolStore.getState();
    if (st.tool === 'apronExtend') {
      const target = this.extendTarget();
      if (target) this.deps.send({ type: 'extendApron', apronId: target.id, polygon });
    } else if (cut) this.deps.send({ type: 'removeApronArea', polygon });
    else this.deps.send({ type: 'buildApron', polygon, surface: st.surface, tier: st.tier });
  }

  /**
   * Snaps a rectangle corner in the alignment frame (heading `frame`): each frame axis snaps to the
   * nearest apron edge, apron corner or taxiway edge parallel to it within a few meters. Alt is free.
   */
  private rectSnap(p: Pt, frame: number, mods: Mods): Pt {
    this.mark = null;
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
    const q = { x: u.x * bu + v.x * bv, y: u.y * bu + v.y * bv };
    if (du < tol || dv < tol) this.mark = { kind: 'apronEdge', p: q };
    return q;
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
    return this.gridMark(p, g);
  }

  /**
   * A corner of an apron rectangle: the nearest grid node in grid mode, else the edge snap in the
   * alignment frame (T42 R3, R4).
   */
  private rectCorner(p: Pt, frame: number, mods: Mods): Pt {
    const g = this.snapGrid(mods);
    return g ? this.gridMark(p, g) : this.rectSnap(p, frame, mods);
  }

  /** Snaps to the nearest node of a grid and records it as the quiet grid marker. */
  private gridMark(p: Pt, g: ConstructionGrid): Pt {
    const q = snapToGrid(p, g).p;
    this.mark = { kind: 'grid', p: q };
    return q;
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

  /** Before the press of a rectangle apron: the marker of the corner the press would snap to. */
  private previewApronHover(p: Pt, mods: Mods): void {
    this.rectCorner(p, this.apronFrame(p, mods), mods);
    const shapes: GhostShape[] = [];
    const tip = this.markDecor(shapes);
    const m = this.mark;
    this.show({ valid: true, shapes, tone: 'snap', tip: tip && m ? { x: m.p.x, y: m.p.y, text: tip } : undefined }, null, this.apronHint(true));
  }

  /** Rectangle apron: live width, height and area; Ctrl cuts. */
  private previewApronRect(p: Pt, mods: Mods): void {
    const r = this.apronRect(p, mods);
    if (!r) return;
    const [a, b, c] = r.pts;
    const tags = [
      { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, text: `${Math.round(r.w)} m` },
      { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2, text: `${Math.round(r.h)} m` },
    ];
    this.showApron(r.pts, c, this.apronCuts(mods), tags, this.apronHint(true));
  }

  private commitApronRect(p: Pt, mods: Mods): void {
    const r = this.apronRect(p, mods);
    this.dragging = false;
    this.start = null;
    this.deps.setGhost(null);
    if (!r || r.w < 1 || r.h < 1) return;
    this.sendApron(r.pts, this.apronCuts(mods));
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

  /** Heading the stand ghost faced last, so R turns it from where the player sees it. */
  private standFacing = 0;
  /** The last stand plan and ghost, reused while the pointer stays on the same snapped spot. */
  private standCache: { key: string; ghost: Ghost; problem: Problem | null } | null = null;

  private standPlan(p: Pt, mods: Mods): { x: number; y: number; count: number; spacing: number; heading: number; size: StandSize; ga: boolean; surface: Surface; type: StandType; leadIn: boolean } {
    const st = useToolStore.getState();
    const ga = st.tool === 'gaBlock';
    const size: StandSize = ga ? 'small' : st.standSize;
    const grid = this.snapGrid(mods);
    const q = grid ? this.gridMark(p, grid) : p;
    if (!grid) this.mark = null;
    const base = { count: ga ? st.gaCount : 1, spacing: STAND_SIZES[size].widthM, size, ga, surface: pickedStandSurface(st.surface, size), type: ga ? 'remote' : st.standType };
    if (ga) return { ...base, x: q.x, y: q.y, heading: this.rowHeadingAt(p, mods), leadIn: true };
    // A single stand faces the nearest centerline and slides onto its lead in (docs/DESIGN_REVISION_4.md section 2.2).
    // On the grid it keeps the grid heading unless the player turned it. Beside a built stand it abuts it with the roads lined up.
    const heading = st.standHeading ?? (grid ? grid.headingDeg : null);
    const snap = snapStandRow(q, size, this.af.taxiways, this.af.stands, heading);
    if (snap) {
      this.mark = { kind: 'leadIn', p: snap.join, label: this.af.taxiways.find((t) => t.id === snap.taxiwayId)?.name || undefined };
      return { ...base, x: snap.x, y: snap.y, heading: snap.headingDeg, leadIn: true };
    }
    return { ...base, x: q.x, y: q.y, heading: standHeading(heading ?? this.rowHeadingAt(p, mods)), leadIn: false };
  }

  /** The first rule a single stand ghost breaks that the sim checks too: taxiway clearance, then overlap with a built stand. */
  private standProblem(s: Stand): Problem | null {
    const slot = standSlot(s.size);
    if (!slot) return { code: 'stand.taxiwayClearance' };
    if (standTaxiwayClash(standBox(s, slot), standLeadTaxiways(s, this.af.taxiways), this.af.taxiways, AIRFIELD.codes, STAND_SIZES[s.size].wingtipClearanceM)) return { code: 'stand.taxiwayClearance' };
    const half = STAND_SIZES[s.size].widthM / 2;
    for (const o of this.af.stands) {
      if (Math.hypot(o.x - s.x, o.y - s.y) < STAND_SIZES[o.size].widthM / 2 + half - 0.5) return { code: 'standOverlap' };
    }
    return null;
  }

  private previewStands(p: Pt, mods: Mods): void {
    const st = useToolStore.getState();
    const plan = this.standPlan(p, mods);
    this.standFacing = plan.heading;
    // The same snapped spot gives the same ghost, so pointer jitter does not redo the pricing and the forks.
    const key = `${this.af.version}|${plan.x.toFixed(2)}|${plan.y.toFixed(2)}|${plan.heading}|${plan.size}|${plan.type}|${plan.surface}|${plan.count}|${plan.ga}|${st.gridId ?? ''}`;
    if (this.standCache && this.standCache.key === key) {
      this.show(this.standCache.ghost, this.standCache.problem, plan.ga ? 'hint.gaBlock' : 'hint.stands');
      return;
    }
    // The sim's own row or block pricing, so the ghost shows the cash the command takes.
    const pricing = plan.ga
      ? gaBlockPricing(this.af.aprons, plan.x, plan.y, plan.heading, plan.count, plan.surface)
      : standRowPricing(this.af.aprons, { x: plan.x, y: plan.y, headingDeg: plan.heading, count: plan.count, spacingM: plan.spacing, size: plan.size, type: plan.type, surface: plan.surface });
    // The stands as they will be built: lead-in lines and curves to the taxiway, stop bars, boxes and numbers.
    const cands: Stand[] = pricing.slots.map((c, i) => ({
      id: -1 - i,
      cost: STAND_SIZES[plan.size].cost[plan.type],
      number: String(this.af.stands.length + i + 1),
      x: c.x,
      y: c.y,
      headingDeg: plan.heading,
      type: plan.size === 'small' && plan.type === 'contact' ? 'remote' : plan.type,
      size: plan.size,
      code: sizeCode(plan.size),
      surface: plan.surface,
      pushback: 'auto',
      accepts: plan.ga ? ACCEPT_GA : defaultAccepts(plan.size),
    }));
    // The slot box is always drawn, so a stand far from any taxiway still shows where it would go.
    const shapes: GhostShape[] = [];
    const slot = standSlot(plan.size);
    if (slot) for (const c of cands) shapes.push({ k: 'poly', pts: standBox(c, slot) });
    const tip = this.markDecor(shapes);
    const m = this.mark;
    let problem: Problem | null = null;
    if (this.ctx()) {
      const first = pricing.slots[0];
      const last = pricing.slots[pricing.slots.length - 1];
      problem = this.landProblem({ pts: [first, last], widthM: STAND_SIZES[plan.size].maxSpanM });
      if (!problem && !plan.leadIn) problem = { code: 'stand.noLeadIn', args: { m: STAND_PLACEMENT.leadInReachM } };
      if (!problem && !plan.ga) problem = this.standProblem(cands[0]);
      if (!problem && pricing.tooLarge) problem = { code: 'apronTooLarge' };
    }
    const ghost: Ghost = {
      valid: problem === null,
      shapes,
      tip: tip && m ? { x: m.p.x, y: m.p.y, text: tip } : undefined,
      preview: { stands: cands },
      label: {
        x: plan.x,
        y: plan.y,
        text: plan.ga
          ? tFormat('ghost.stands', { n: plan.count, hdg: String(plan.heading).padStart(3, '0'), cost: formatMoney(Math.round(pricing.total)) })
          : tFormat('ghost.stand', { hdg: String(plan.heading).padStart(3, '0'), cost: formatMoney(Math.round(pricing.total)) }),
      },
    };
    this.standCache = { key, ghost, problem };
    this.show(ghost, problem, plan.ga ? 'hint.gaBlock' : 'hint.stands');
  }

  private commitStands(p: Pt, mods: Mods): void {
    const st = useToolStore.getState();
    const plan = this.standPlan(p, mods);
    if (plan.ga) this.deps.send({ type: 'buildGaBlock', x: plan.x, y: plan.y, headingDeg: plan.heading, count: plan.count, surface: plan.surface });
    else if (plan.leadIn) this.deps.send({ type: 'buildStands', x: plan.x, y: plan.y, headingDeg: plan.heading, count: 1, spacingM: plan.spacing, standType: st.standType, size: plan.size, surface: plan.surface });
  }

  // ATC tower --------------------------------------------------------------

  /** Ghost of a tower: its footprint, the tower as it will look, and the cost of the chosen level. */
  private previewTower(p: Pt, mods: Mods): void {
    const level = useToolStore.getState().towerLevel;
    const q = this.placeAt(p, mods);
    const side = BUSINESS.tower.footprintM;
    const rect = towerRect(q.x, q.y, side);
    let problem = this.landProblem({ polygon: rect });
    if (!problem && towerBlocked(this.af, rect)) problem = { code: 'towerOnPavement' };
    if (!problem && (this.af.towers ?? []).some((t) => towersOverlap(rect, towerRect(t.x, t.y, side)))) problem = { code: 'towerOverlap' };
    this.show(
      {
        valid: problem === null,
        shapes: [{ k: 'poly', pts: rect }],
        preview: { towers: [{ id: -1, cost: 0, x: q.x, y: q.y, level }] },
        label: { x: q.x, y: q.y, text: tFormat('ghost.tower', { level, cost: formatMoney(towerBuildCost(level)) }) },
      },
      problem,
      'hint.tower',
    );
  }

  private commitTower(p: Pt, mods: Mods): void {
    const q = this.placeAt(p, mods);
    this.deps.send({ type: 'buildTower', x: q.x, y: q.y, level: useToolStore.getState().towerLevel });
  }

  // Service roads and depots (T60) ------------------------------------------

  /** A road point: the nearest depot exit, stand connection point, strip end or road end within reach, else the grid or the pointer. */
  private roadPoint(p: Pt, mods: Mods): Pt {
    return this.roadSnap(p, mods).p;
  }

  /** The road point at the cursor and the target it snapped to, if any (T84). */
  private roadSnap(p: Pt, mods: Mods): { p: Pt; target: RoadTarget | null } {
    const reach = Math.max(GROUND.road.snapM, 16 / this.deps.zoom());
    let best: RoadTarget | null = null;
    let bestD = reach;
    for (const t of roadSnapTargets(this.af)) {
      const d = Math.hypot(t.p.x - p.x, t.p.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best ? { p: { x: best.p.x, y: best.p.y }, target: best } : { p: this.placeAt(p, mods), target: null };
  }

  /** Markers on the road snap points near the cursor, so the player sees where a road can join (T84). */
  private nearbyRoadMarkers(at: Pt, shapes: GhostShape[]): void {
    for (const t of roadSnapTargets(this.af)) {
      if (Math.hypot(t.p.x - at.x, t.p.y - at.y) <= GROUND.road.nearbyM) shapes.push({ k: 'marker', x: t.p.x, y: t.p.y, shape: 'dot' });
    }
  }

  /** A short road piece leaving `from` along `dir`, or along the grid or runway frame when no direction is given. */
  private roadStub(from: Pt, dir: Pt | null, mods: Mods): Pt[] {
    let d = dir;
    if (!d) {
      const grid = this.snapGrid(mods);
      const v = headingVec(grid ? grid.headingDeg : this.frameAt(from));
      d = { x: v.x, y: v.y };
    }
    return [from, { x: from.x + d.x * GROUND.road.stubM, y: from.y + d.y * GROUND.road.stubM }];
  }

  /** Ghost of the road being drawn: the road as it will look, a marker on every point near the cursor it can join, and its cost. */
  private previewRoad(p: Pt, mods: Mods): void {
    const snap = this.roadSnap(p, mods);
    const q = snap.p;
    const shapes: GhostShape[] = [];
    this.nearbyRoadMarkers(q, shapes);
    let tip: string | undefined;
    if (snap.target) {
      shapes.push({ k: 'marker', x: q.x, y: q.y, shape: 'ring' });
      tip = tDynamic(`ghost.roadTarget.${snap.target.kind}`);
    }
    if (this.pts.length === 0) {
      // Before the first click a road stub follows the cursor, leaving a snapped point the way a road would (T84).
      const stub = this.roadStub(q, snap.target?.dir ?? null, mods);
      const problem = this.landProblem({ pts: stub, widthM: GROUND.road.widthM });
      this.show({ valid: problem === null, shapes, preview: { roads: [{ id: -1, cost: 0, points: stub }] }, tip: tip ? { x: q.x, y: q.y, text: tip } : undefined }, problem, 'hint.roadStart');
      return;
    }
    const pts = [...this.pts, q];
    const problem = this.landProblem({ pts, widthM: GROUND.road.widthM });
    const len = polylineLength(pts);
    const label = { x: q.x, y: q.y, text: tFormat('ghost.road', { len: Math.round(len), cost: formatMoney(Math.round(len * GROUND.road.widthM * SURFACE_SPEC[GROUND.road.surface].costPerM2)) }) };
    this.show({ valid: problem === null, shapes, preview: { roads: [{ id: -1, cost: 0, points: pts }] }, label, tip: tip ? { x: q.x, y: q.y, text: tip } : undefined }, problem, 'hint.road');
  }

  private commitRoad(): void {
    if (this.pts.length >= 2) this.deps.send({ type: 'buildRoad', points: this.pts });
    this.pts = [];
    this.move(this.cursor, { shift: false, alt: false });
  }

  /** Ghost of a depot: its footprint, the shed as it will look with its doors on the heading side, and the cost. */
  private previewDepot(p: Pt, mods: Mods): void {
    const q = this.placeAt(p, mods);
    const d = { id: -1, cost: GROUND.depot.cost, x: q.x, y: q.y, headingDeg: useToolStore.getState().depotHeading };
    const rect = depotRect(d);
    let problem = this.landProblem({ polygon: rect });
    if (!problem && towerBlocked(this.af, rect)) problem = { code: 'depotOnPavement' };
    if (!problem && (this.af.depots ?? []).some((o) => towersOverlap(rect, depotRect(o)))) problem = { code: 'onDepot' };
    if (!problem && (this.af.towers ?? []).some((t) => towersOverlap(rect, towerRect(t.x, t.y, BUSINESS.tower.footprintM)))) problem = { code: 'onTower' };
    const exit = depotExit(d);
    this.show(
      { valid: problem === null, shapes: this.doorShapes(rect, exit), preview: { depots: [d], roads: [{ id: -1, cost: 0, points: this.roadStub(exit, headingVec(d.headingDeg), mods) }] }, label: { x: q.x, y: q.y, text: tFormat('ghost.depot', { cost: formatMoney(GROUND.depot.cost) }) } },
      problem,
      'hint.depot',
    );
  }

  /** Footprint outline, the door's road point and the road points near it, for the depot and building ghosts (T84). */
  private doorShapes(rect: Pt[], door: Pt): GhostShape[] {
    const shapes: GhostShape[] = [{ k: 'poly', pts: rect }];
    this.nearbyRoadMarkers(door, shapes);
    shapes.push({ k: 'marker', x: door.x, y: door.y, shape: 'ring' });
    return shapes;
  }

  /** Ghost of a supporting building: its footprint and look with the doors on the heading side, and its cost. */
  private previewBuilding(p: Pt, mods: Mods): void {
    const q = this.placeAt(p, mods);
    const st = useToolStore.getState();
    const b = { id: -1, cost: GROUND.buildings[st.buildingKind].cost, kind: st.buildingKind, x: q.x, y: q.y, headingDeg: st.depotHeading };
    const rect = buildingRect(b);
    let problem = this.landProblem({ polygon: rect });
    if (!problem && towerBlocked(this.af, rect)) problem = { code: 'depotOnPavement' };
    if (!problem && (this.af.depots ?? []).some((o) => towersOverlap(rect, depotRect(o)))) problem = { code: 'onDepot' };
    if (!problem && (this.af.buildings ?? []).some((o) => towersOverlap(rect, buildingRect(o)))) problem = { code: 'onBuilding' };
    this.show(
      {
        valid: problem === null,
        shapes: this.doorShapes(rect, buildingDoor(b)),
        preview: { buildings: [b], roads: [{ id: -1, cost: 0, points: this.roadStub(buildingDoor(b), headingVec(b.headingDeg), mods) }] },
        label: { x: q.x, y: q.y, text: tFormat('ghost.building', { name: tDynamic(`building.${st.buildingKind}`), cost: formatMoney(b.cost) }) },
      },
      problem,
      'hint.building',
    );
  }

  private commitDepot(p: Pt, mods: Mods): void {
    const q = this.placeAt(p, mods);
    this.deps.send({ type: 'buildDepot', x: q.x, y: q.y, headingDeg: useToolStore.getState().depotHeading });
  }

  // Terminal ---------------------------------------------------------------

  private tStart: { cx: number; cy: number } | null = null;
  private tGrid: TerminalGrid | null = null;
  /** Cells a zone brush has painted in the current drag, as "x,y", and the last cell the pointer was on. */
  private brushSeen = new Set<string>();
  private brushLast: { cx: number; cy: number } | null = null;
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

  /** Id of the baggage node under the point, a drop excepted, from the derived node cells of the business payload. */
  private bagNodeAt(p: Pt): number | null {
    const st = useGameStore.getState();
    const nodes = st.business?.baggage.nodes ?? [];
    for (const g of st.terminalGrids) {
      const c = cellAtWorld(g, p.x, p.y);
      const node = bagNodeAt(nodes, g.id, c.cx, c.cy);
      // A drop sits on its desk's anchor cell, so a click there picks the desk and its edit actions (T86).
      if (node && node.kind !== 'drop') return node.id;
    }
    return null;
  }

  /** The anchor cell of the fixture under the pointer in one terminal, or null when that cell holds no fixture. */
  private fixtureAt(p: Pt, building: number): { building: number; x: number; y: number } | null {
    const g = useGameStore.getState().terminalGrids.find((x) => x.id === building);
    if (!g) return null;
    const c = cellAtWorld(g, p.x, p.y);
    const anchor = fixtureAnchor(g, cellIndex(g, c.cx, c.cy));
    if (anchor < 0) return null;
    return { building, x: g.x0 + (anchor % g.w), y: g.y0 + Math.floor(anchor / g.w) };
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
        return doorEdit(e.x0, e.y0, e.x1, e.y1, st.doorType);
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
    if (sub === 'zone') return zoneEdit(x0, y0, x1, y1, st.zoneType);
    return fixtureEdit(x0, y0, x1, y1, st.fixtureId, st.fixtureRot, st.fixtureLevel, st.fixtureMode);
  }

  /** The unit rectangle of a drag in logical cells, corners in any order. */
  private unitRect(a: { cx: number; cy: number }, b: { cx: number; cy: number }): { x: number; y: number; w: number; h: number } {
    const x = Math.floor(Math.min(a.cx, b.cx));
    const y = Math.floor(Math.min(a.cy, b.cy));
    return { x, y, w: Math.floor(Math.max(a.cx, b.cx)) + 1 - x, h: Math.floor(Math.max(a.cy, b.cy)) + 1 - y };
  }

  /** The reason a unit cannot be zoned over the rectangle, from the same check the sim runs, or null. */
  private unitCheck(g: TerminalGrid, r: { x: number; y: number; w: number; h: number }): Problem | null {
    const st = useToolStore.getState();
    const units = useGameStore.getState().business?.tenants.units ?? [];
    const code = unitProblem(g, r.x, r.y, r.w, r.h, st.unitCategory, units);
    if (!code) return null;
    const [c, ...args] = code.split('|');
    return { code: c!, args: Object.fromEntries(args.map((kv) => kv.split('=') as [string, string])) };
  }

  /** Ghost of the unit tool (T32): the rectangle, its category and area, red with the reason when it cannot be zoned. */
  private previewUnit(g: TerminalGrid, a: { cx: number; cy: number }, b: { cx: number; cy: number }, p: Pt): void {
    const st = useToolStore.getState();
    const r = this.unitRect(a, b);
    const problem = this.dragging ? this.unitCheck(g, r) : null;
    const label = tFormat('ghost.unit', { category: tDynamic(`menu.terminal.shops.${TENANT_CATEGORY_KEYS[st.unitCategory]}`), m2: r.w * r.h * TERMINAL_CELL_M * TERMINAL_CELL_M });
    this.show({ valid: this.dragging && problem === null, shapes: [{ k: 'poly', pts: rectWorld(g, r.x, r.y, r.x + r.w, r.y + r.h) }], label: { x: p.x, y: p.y, text: label } }, problem, 'hint.terminal.unit');
  }

  private commitUnit(g: TerminalGrid, a: { cx: number; cy: number }, b: { cx: number; cy: number }): void {
    const r = this.unitRect(a, b);
    if (this.unitCheck(g, r)) {
      this.frozen = true;
      return;
    }
    this.deps.send({ type: 'zoneUnit', building: g.id, x: r.x, y: r.y, w: r.w, h: r.h, category: useToolStore.getState().unitCategory });
    this.deps.setGhost(null);
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
    const click = useToolStore.getState().tSub;
    if (click === 'bagNode' || click === 'prop' || click === 'propRemove' || click === 'move') return;
    const g = this.gridFor(p, mods);
    this.tGrid = g;
    const c = worldToCell(g, p.x, p.y);
    this.tStart = { cx: c.cx, cy: c.cy };
    this.dragging = true;
    const st = useToolStore.getState();
    if (st.tSub === 'zone' && st.zoneBrush) {
      this.brushSeen.clear();
      this.brushLast = null;
      this.paintBrushLine(g, { cx: Math.floor(c.cx), cy: Math.floor(c.cy) });
    }
  }

  /** The baggage node under the cursor on an existing building, or null off every building. */
  private bagSpecAt(p: Pt): { g: TerminalGrid; spec: BagNodeSpec } | null {
    const st = useToolStore.getState();
    const g = this.buildingAt(p);
    if (!g) return null;
    const width = st.bagKind === 'carousel' ? st.bagCarousel : st.bagWidth;
    const origin = bagOrigin(cellAtWorld(g, p.x, p.y), st.bagKind, st.bagRot, width);
    if (!origin) return null;
    return { g, spec: { kind: st.bagKind, cx: origin.cx, cy: origin.cy, rot: st.bagRot, widthCells: width } };
  }

  private previewBagNode(p: Pt): void {
    const st = useToolStore.getState();
    const at = this.bagSpecAt(p);
    if (!at) {
      this.deps.setGhost(null);
      st.set({ hint: 'hint.terminal.bagNode', problem: null, buy: null, bagRoomWarn: false });
      return;
    }
    const { g, spec } = at;
    const code = validateBagNode(g, spec);
    const ghost = bagGhostCells(spec);
    const shapes: GhostShape[] = ghost.cells.map(([x, y]) => ({ k: 'poly', pts: rectWorld(g, x, y, x + 1, y + 1) }));
    // Ramps are markers, a diamond for the in ramp and a square for the out ramp, so they stand out over the footprint.
    for (const [ramp, shape] of [[ghost.rampIn, 'diamond'], [ghost.rampOut, 'square']] as const) {
      if (!ramp) continue;
      const c = cornerWorld(g, ramp[0] + 0.5, ramp[1] + 0.5);
      shapes.push({ k: 'marker', x: c.x, y: c.y, shape });
    }
    const roomWarn = code === null && spec.kind === 'machine' && !screeningRoomOk(g, spec);
    this.show({ valid: code === null, shapes, label: { x: p.x, y: p.y, text: tFormat('ghost.bagNode', { cost: formatMoney(bagCost(spec.kind, spec.widthCells)) }) } }, code ? { code } : null, 'hint.terminal.bagNode');
    st.set({ buy: null, bagRoomWarn: roomWarn });
  }

  private placeBagNode(p: Pt): void {
    const at = this.bagSpecAt(p);
    if (!at || validateBagNode(at.g, at.spec) !== null) return;
    const { g, spec } = at;
    this.deps.send({ type: 'placeBaggageNode', building: g.id, kind: spec.kind, cx: spec.cx, cy: spec.cy, rot: spec.rot, widthCells: spec.widthCells });
  }

  // Props (T76) -------------------------------------------------------------

  /** The prop the tool would place under the cursor, centered on it and snapped to the 0.5 m grid, or null off every building. */
  private propAtCursor(p: Pt): { g: TerminalGrid; prop: Prop } | null {
    const st = useToolStore.getState();
    const g = this.buildingAt(p);
    const spec = propSpec(st.propAsset);
    if (!g || !spec) return null;
    const c = worldToCell(g, p.x, p.y);
    const [w, d] = footprintSteps(spec, st.propRot);
    const sx = Math.round((c.cx * TERMINAL_CELL_M) / PROP_STEP_M - w / 2);
    const sy = Math.round((c.cy * TERMINAL_CELL_M) / PROP_STEP_M - d / 2);
    return { g, prop: { asset: st.propAsset, x: sx * PROP_STEP_M, y: sy * PROP_STEP_M, rot: st.propRot } };
  }

  /** Footprint polygon of a prop in world meters, and the point in front of the side people use. */
  private propShapes(g: TerminalGrid, prop: Prop): GhostShape[] {
    const r = propRect(prop);
    if (!r) return [];
    const k = PROP_STEP_M / TERMINAL_CELL_M;
    const shapes: GhostShape[] = [];
    // The strip in front that must stay clear, hatched, and the prop's kit sprite at true size (T85).
    const strip = propUseRect(prop);
    if (strip) shapes.push({ k: 'hatch', pts: rectWorld(g, strip.sx0 * k, strip.sy0 * k, strip.sx1 * k, strip.sy1 * k), blocked: false });
    const mid = cornerWorld(g, ((r.sx0 + r.sx1) / 2) * k, ((r.sy0 + r.sy1) / 2) * k);
    shapes.push({ k: 'prop', asset: prop.asset, rot: prop.rot, x: mid.x, y: mid.y, headingDeg: g.headingDeg });
    shapes.push({ k: 'poly', pts: rectWorld(g, r.sx0 * k, r.sy0 * k, r.sx1 * k, r.sy1 * k) });
    const mx = ((r.sx0 + r.sx1) / 2) * k;
    const my = ((r.sy0 + r.sy1) / 2) * k;
    const front = prop.rot === 0 ? [mx, r.sy1 * k] : prop.rot === 1 ? [r.sx0 * k, my] : prop.rot === 2 ? [mx, r.sy0 * k] : [r.sx1 * k, my];
    const f = cornerWorld(g, front[0]!, front[1]!);
    shapes.push({ k: 'marker', x: f.x, y: f.y, shape: 'diamond' });
    return shapes;
  }

  private previewProp(p: Pt): void {
    const st = useToolStore.getState();
    const at = this.propAtCursor(p);
    if (!at) {
      this.deps.setGhost(null);
      st.set({ hint: 'hint.terminal.prop', problem: null, buy: null });
      return;
    }
    const plan = planPropWithUse(at.g, at.prop);
    const name = propSpec(at.prop.asset)?.name ?? at.prop.asset;
    this.show({ valid: plan.problem === null, shapes: this.propShapes(at.g, at.prop), label: { x: p.x, y: p.y, text: tFormat('ghost.prop', { name, cost: formatMoney(propCost(at.prop.asset)) }) } }, plan.problem, 'hint.terminal.prop');
    st.set({ buy: null });
  }

  private placeProp(p: Pt): void {
    const at = this.propAtCursor(p);
    if (!at || planPropWithUse(at.g, at.prop).problem !== null) return;
    const { g, prop } = at;
    this.deps.send({ type: 'placeProp', building: g.id, asset: prop.asset, x: prop.x, y: prop.y, rot: prop.rot });
  }

  /** The building and the index of the topmost prop under the cursor, or null. */
  private propUnder(p: Pt): { g: TerminalGrid; i: number } | null {
    const g = this.buildingAt(p);
    if (!g) return null;
    const c = worldToCell(g, p.x, p.y);
    const i = propAt(g.props, c.cx * TERMINAL_CELL_M, c.cy * TERMINAL_CELL_M);
    return i < 0 ? null : { g, i };
  }

  /** The fixture under the cursor that the remove card or Move can take: its grid, anchor cell and footprint. */
  private fixtureUnder(p: Pt): { g: TerminalGrid; x: number; y: number; cells: number[] } | null {
    const term = this.terminalAt(p);
    if (term === null) return null;
    const at = this.fixtureAt(p, term);
    const g = useGameStore.getState().terminalGrids.find((x) => x.id === term);
    if (!at || !g) return null;
    const anchor = cellIndex(g, at.x, at.y);
    if (isBaggageFixture(g.fixture[anchor]!)) return null;
    return { g, x: at.x, y: at.y, cells: fixtureCells(g, anchor) };
  }

  /** Outline of the footprint cells of a placed fixture, one square per cell. */
  private cellShapes(g: TerminalGrid, cells: readonly number[]): GhostShape[] {
    return cells.map((c) => {
      const x = g.x0 + (c % g.w);
      const y = g.y0 + Math.floor(c / g.w);
      return { k: 'poly' as const, pts: rectWorld(g, x, y, x + 1, y + 1) };
    });
  }

  /** The remove card (T85): the prop under the cursor, or else the fixture, with what removing it pays back. */
  private previewPropRemove(p: Pt): void {
    const hit = this.propUnder(p);
    if (hit) {
      const prop = hit.g.props[hit.i]!;
      const name = propSpec(prop.asset)?.name ?? prop.asset;
      this.show({ valid: true, tone: 'remove', shapes: this.propShapes(hit.g, prop), label: { x: p.x, y: p.y, text: tFormat('ghost.propRemove', { name, cost: formatMoney(propCost(prop.asset)) }) } }, null, 'hint.terminal.propRemove');
      return;
    }
    const fx = this.fixtureUnder(p);
    if (!fx) {
      this.deps.setGhost(null);
      useToolStore.getState().set({ hint: 'hint.terminal.propRemove', problem: null, buy: null });
      return;
    }
    const f = fx.g.fixture[cellIndex(fx.g, fx.x, fx.y)]!;
    this.show({ valid: true, tone: 'remove', shapes: this.cellShapes(fx.g, fx.cells), label: { x: p.x, y: p.y, text: tFormat('ghost.fixtureRemove', { name: tDynamic(`fixture.${f}`) }) } }, null, 'hint.terminal.propRemove');
  }

  private removePropAt(p: Pt): void {
    const hit = this.propUnder(p);
    if (hit) {
      const c = worldToCell(hit.g, p.x, p.y);
      this.deps.send({ type: 'removeProp', building: hit.g.id, x: c.cx * TERMINAL_CELL_M, y: c.cy * TERMINAL_CELL_M });
      return;
    }
    const fx = this.fixtureUnder(p);
    if (fx) this.deps.send({ type: 'removeFixture', building: fx.g.id, x: fx.x, y: fx.y });
  }

  // Move (T85) ---------------------------------------------------------------

  /** Copy of a grid without the item being moved, so the ghost checks the new spot as if the item had left. */
  private liftedGrid(m: MovingItem): TerminalGrid | null {
    const g = useGameStore.getState().terminalGrids.find((x) => x.id === m.building);
    if (!g) return null;
    if (this.lifted && this.lifted.src === g && this.lifted.item === m) return this.lifted.grid;
    let out: TerminalGrid;
    if (m.kind === 'prop') {
      const i = propAt(g.props, m.x, m.y);
      out = { ...g, props: g.props.filter((_, k) => k !== i) };
    } else {
      out = { ...g, fixture: g.fixture.slice(), fixtureRot: g.fixtureRot.slice(), fixtureOff: g.fixtureOff.slice(), fixtureLevel: g.fixtureLevel.slice(), fixtureMode: g.fixtureMode.slice() };
      for (const c of fixtureCells(g, cellIndex(g, m.x, m.y))) {
        out.fixture[c] = 0;
        out.fixtureRot[c] = 0;
        out.fixtureOff[c] = 0;
        out.fixtureLevel[c] = 0;
        out.fixtureMode[c] = 0;
      }
    }
    this.lifted = { src: g, item: m, grid: out };
    return out;
  }

  /** Where the moved item would land under the cursor, and whether it fits there. */
  private moveTarget(p: Pt): { m: MovingItem; g: TerminalGrid; shapes: GhostShape[]; problem: Problem | null; toX: number; toY: number } | null {
    const m = useToolStore.getState().moving;
    if (!m) return null;
    const g = this.liftedGrid(m);
    const env = this.env();
    if (!g || !env) return null;
    const c = worldToCell(g, p.x, p.y);
    if (m.kind === 'fixture') {
      const cx = Math.floor(c.cx);
      const cy = Math.floor(c.cy);
      const edit: TerminalEdit = { op: 'fixture', x0: cx, y0: cy, x1: cx + 1, y1: cy + 1, variant: m.f, rot: m.rot, level: m.level, mode: m.mode };
      const plan = planEdit(g, edit, { ...env, others: env.others.filter((o) => o.id !== g.id) });
      const problem = plan.problem ?? (plan.changes === 0 ? { code: 'nothingThere' } : null);
      const fp = footprintRect(edit);
      return { m, g, shapes: [...this.fixtureGhost(g, edit, plan.anchors ?? []), { k: 'poly', pts: rectWorld(g, fp.x0, fp.y0, fp.x1, fp.y1) }], problem, toX: cx, toY: cy };
    }
    const spec = propSpec(m.asset);
    if (!spec) return null;
    const [w, d] = footprintSteps(spec, m.rot);
    const toX = Math.round((c.cx * TERMINAL_CELL_M) / PROP_STEP_M - w / 2) * PROP_STEP_M;
    const toY = Math.round((c.cy * TERMINAL_CELL_M) / PROP_STEP_M - d / 2) * PROP_STEP_M;
    const prop: Prop = { asset: m.asset, x: toX, y: toY, rot: m.rot };
    return { m, g, shapes: this.propShapes(g, prop), problem: planPropWithUse(g, prop).problem, toX, toY };
  }

  private previewMove(p: Pt): void {
    const t = this.moveTarget(p);
    if (!t) {
      this.deps.setGhost(null);
      return;
    }
    const name = t.m.kind === 'prop' ? (propSpec(t.m.asset)?.name ?? t.m.asset) : tDynamic(`fixture.${t.m.f}`);
    this.show({ valid: t.problem === null, shapes: t.shapes, label: { x: p.x, y: p.y, text: tFormat('ghost.move', { name }) } }, t.problem, 'hint.terminal.move');
    useToolStore.getState().set({ buy: null });
  }

  /** Drops the moved item where it fits, then goes back to selecting it at its new spot. */
  private dropMove(p: Pt): void {
    const t = this.moveTarget(p);
    if (!t || t.problem) return;
    const { m } = t;
    const st = useToolStore.getState();
    if (m.kind === 'fixture') {
      this.deps.send({ type: 'moveFixture', building: m.building, x: m.x, y: m.y, toX: t.toX, toY: t.toY, rot: m.rot });
      st.set({ moving: null, tool: 'select', selection: { kind: 'terminal', id: m.building }, fixturePick: { building: m.building, x: t.toX, y: t.toY }, propPick: null });
    } else {
      this.deps.send({ type: 'moveProp', building: m.building, x: m.x, y: m.y, toX: t.toX, toY: t.toY, rot: m.rot });
      st.set({ moving: null, tool: 'select', selection: { kind: 'terminal', id: m.building }, fixturePick: null, propPick: { building: m.building, x: t.toX + PROP_STEP_M / 2, y: t.toY + PROP_STEP_M / 2 } });
    }
    this.lifted = null;
    this.deps.setGhost(null);
  }

  /**
   * Zone brush: sends one 1 by 1 zone edit for each cell from the last pointer cell to this one that the drag has not
   * painted yet. The first call of a drag passes the start cell, so a click paints it.
   */
  private paintBrushLine(g: TerminalGrid, to: { cx: number; cy: number }): void {
    const env = this.env();
    const from = this.brushLast ?? to;
    this.brushLast = to;
    if (!env) return;
    const zone = useToolStore.getState().zoneType;
    for (const [cx, cy] of cellLine(from.cx, from.cy, to.cx, to.cy)) {
      if (!enterBrushCell(this.brushSeen, cx, cy)) continue;
      const edit = brushCellEdit(cx, cy, zone);
      const plan = planEdit(g, edit, env);
      if (plan.problem || plan.changes === 0) continue;
      this.deps.send({ type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit });
    }
  }

  private previewTerminal(p: Pt, mods: Mods): void {
    if (useToolStore.getState().tSub === 'bagNode') {
      this.previewBagNode(p);
      return;
    }
    if (useToolStore.getState().tSub === 'prop') {
      this.previewProp(p);
      return;
    }
    if (useToolStore.getState().tSub === 'propRemove') {
      this.previewPropRemove(p);
      return;
    }
    if (useToolStore.getState().tSub === 'move') {
      this.previewMove(p);
      return;
    }
    if (this.frozen && !this.dragging) return;
    const st = useToolStore.getState();
    const hint = `hint.terminal.${st.tSub}`;
    const g = this.dragging && this.tGrid ? this.tGrid : this.gridFor(p, mods);
    const c = worldToCell(g, p.x, p.y);
    if (st.tSub === 'unit') {
      this.previewUnit(g, this.dragging && this.tStart ? this.tStart : c, c, p);
      return;
    }
    const brush = st.tSub === 'zone' && st.zoneBrush;
    const a = this.dragging && this.tStart ? this.tStart : c;
    // A zone brush shows only the cell under the cursor, the same cell it paints.
    const edit = brush ? brushCellEdit(Math.floor(c.cx), Math.floor(c.cy), st.zoneType) : this.terminalEdit(g, a, c);
    const env = this.env();
    if (!edit || !env) {
      this.deps.setGhost(null);
      return;
    }
    const plan = planEdit(g, edit, env);
    if (this.dragging && brush) this.paintBrushLine(g, { cx: Math.floor(c.cx), cy: Math.floor(c.cy) });
    const isWall = edit.op === 'wall';
    const shapes: GhostShape[] = [];
    let label: string;
    if (isWall) {
      const a0 = cornerWorld(g, edit.x0, edit.y0);
      const a1 = cornerWorld(g, edit.x1, edit.y1);
      shapes.push({ k: 'strip', pts: [a0, a1], w: 0.8 });
      label = tFormat('ghost.terminalWall', { n: plan.changes, cost: formatMoney(plan.cost) });
    } else {
      const fp = footprintRect(edit);
      if (edit.op === 'fixture') shapes.push(...this.fixtureGhost(g, edit, plan.anchors ?? []));
      shapes.push({ k: 'poly', pts: rectWorld(g, fp.x0, fp.y0, fp.x1, fp.y1) });
      label = tFormat('ghost.terminal', { n: plan.changes, cost: formatMoney(plan.cost) });
    }
    // Before a drag starts, a hovered cell with nothing to do is not an error.
    const idle = !this.dragging && plan.changes === 0;
    let problem: Problem | null = idle ? null : plan.problem;
    if (!problem && !idle && plan.changes === 0) problem = { code: 'terminalNeedsFoundation' };
    // A wrong way round transition fixture is a warning: the ghost stays valid and the reason shows.
    const warning: Problem | null = !problem && !idle && transitionOrientationBreaks(g, edit, env) ? { code: 'transitionOrientation' } : null;
    if (problem && problem.code === 'notOwned' && edit.op === 'foundation') {
      const ids = unownedParcelsUnder(env.ctx, { polygon: rectWorld(g, edit.x0, edit.y0, edit.x1, edit.y1) });
      const site = this.site();
      let cost = 0;
      if (site) for (const id of ids) cost += site.parcelPrice[id];
      useToolStore.getState().set({ buy: { ids, cost } });
    } else {
      useToolStore.getState().set({ buy: null });
    }
    this.show({ valid: problem === null && !idle, shapes, label: { x: p.x, y: p.y, text: label } }, problem ?? warning, hint);
  }

  /**
   * Sprites and hatched use areas of the fixtures an edit places, at true size (T85). With no anchor to place, the
   * hovered cell shows the fixture anyway, so a refused spot still shows what blocks it.
   */
  private fixtureGhost(g: TerminalGrid, edit: TerminalEdit, anchors: readonly { x: number; y: number }[]): GhostShape[] {
    const key = fixtureKey(edit.variant);
    if (key === undefined) return [];
    const level = edit.level ?? 1;
    const rot = edit.rot ?? 0;
    const list = anchors.length > 0 ? anchors : [{ x: edit.x0, y: edit.y0 }];
    const shapes: GhostShape[] = [];
    for (const a of list) {
      for (const u of fixtureUseCells(key, level, a.x, a.y, rot)) shapes.push({ k: 'hatch', pts: rectWorld(g, u.x, u.y, u.x + 1, u.y + 1), blocked: useCellBlocked(g, u) });
      const cells = footprintCells(key, level, a.x, a.y, rot);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [cx, cy] of cells) {
        x0 = Math.min(x0, cx);
        y0 = Math.min(y0, cy);
        x1 = Math.max(x1, cx + 1);
        y1 = Math.max(y1, cy + 1);
      }
      const c = cornerWorld(g, (x0 + x1) / 2, (y0 + y1) / 2);
      shapes.push({ k: 'fixture', f: edit.variant, level, code: 1 + rot, x: c.x, y: c.y, headingDeg: g.headingDeg });
      shapes.push(...this.padGhost(g, key, level, edit.mode ?? 0, a.x, a.y, rot));
      // A desk or bag drop places its bag chute on the cell behind it, so the ghost shows that chute too (T86).
      if (key === 'checkIn' || key === 'bagDrop') {
        const [ox, oy] = dropOutCell(a.x, a.y, rot as 0 | 1 | 2 | 3);
        const m = cornerWorld(g, ox + 0.5, oy + 0.5);
        shapes.push({ k: 'prop', asset: DROP_GHOST_ASSET, rot, x: m.x, y: m.y, headingDeg: g.headingDeg });
      }
    }
    return shapes;
  }

  /**
   * The zone blocks a transition fixture will paint (T88), tinted in their zone, with an Intake label before the
   * fixture and an Exit label past it. Cells that will not take the zone (no floor, another zone, a fixture that
   * refuses it) are left out unless they already hold it.
   */
  private padGhost(g: TerminalGrid, key: FixtureKey, level: number, mode: number, x: number, y: number, rot: number): GhostShape[] {
    const pads = transitionPads(key, level, mode, x, y, rot);
    if (!pads) return [];
    const out: GhostShape[] = [];
    const over = padsBackwards(g, pads) ? 0 : pads.from;
    const side = (cells: readonly [number, number][], zone: number, overZone: number, text: string): void => {
      let sx = 0;
      let sy = 0;
      for (const [cx, cy] of cells) {
        sx += cx + 0.5;
        sy += cy + 0.5;
        const i = cellIndex(g, cx, cy);
        if (padTarget(g, cx, cy, zone, overZone) >= 0 || (i >= 0 && g.floor[i] !== 0 && g.zone[i] === zone)) out.push({ k: 'zoneCell', pts: rectWorld(g, cx, cy, cx + 1, cy + 1), zone });
      }
      if (cells.length === 0) return;
      const c = cornerWorld(g, sx / cells.length, sy / cells.length);
      const o = cornerWorld(g, 0, 0);
      const t = cornerWorld(g, pads.flow[0], pads.flow[1]);
      out.push({ k: 'zoneTag', x: c.x, y: c.y, text, zone, dx: t.x - o.x, dy: t.y - o.y });
    };
    side(pads.intake, pads.from, 0, tFormat('ghost.intake', { zone: tDynamic(`zone.${pads.from}`) }));
    side(pads.exit, pads.to, over, tFormat('ghost.exit', { zone: tDynamic(`zone.${pads.to}`) }));
    return out;
  }

  private finishTerminal(p: Pt): void {
    if (useToolStore.getState().tSub === 'bagNode') {
      this.placeBagNode(p);
      return;
    }
    if (useToolStore.getState().tSub === 'prop') {
      this.placeProp(p);
      return;
    }
    if (useToolStore.getState().tSub === 'propRemove') {
      this.removePropAt(p);
      return;
    }
    if (useToolStore.getState().tSub === 'move') {
      this.dropMove(p);
      return;
    }
    const g = this.tGrid;
    const a = this.tStart;
    this.dragging = false;
    this.tStart = null;
    this.tGrid = null;
    if (!g || !a) return;
    const st = useToolStore.getState();
    // A zone brush already painted while the pointer moved, so the release sends nothing.
    if (st.tSub === 'zone' && st.zoneBrush) {
      this.brushLast = null;
      this.deps.setGhost(null);
      return;
    }
    const c = worldToCell(g, p.x, p.y);
    if (st.tSub === 'unit') {
      this.commitUnit(g, a, c);
      return;
    }
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
    // Every transition fixture placed reminds the player to carry its exit zone on (T88).
    const t = edit.op === 'fixture' ? transitionOf(fixtureKey(edit.variant), edit.mode ?? 0) : null;
    if (t) {
      const gs = useGameStore.getState();
      const text = tFormat('alert.transitionPlaced', { name: tDynamic(`fixture.${edit.variant}`), from: tDynamic(`zone.${t.from}`), to: tDynamic(`zone.${t.to}`) });
      // The same reminder twice in a row would only stack up, so a repeat of the latest one is left out.
      if (gs.alerts[gs.alerts.length - 1]?.text !== text) gs.pushAlert(text, 'info');
    }
  }

  // Demolish -------------------------------------------------------------

  private previewDemolish(p: Pt): void {
    if (this.propUnder(p) || this.fixtureUnder(p)) {
      this.previewPropRemove(p);
      return;
    }
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
    } else if (hit.kind === 'tower' || hit.kind === 'road' || hit.kind === 'depot' || hit.kind === 'building') {
      shapes.push(...this.shapesFor(hit.kind, hit.id));
    } else {
      const s = af.stands.find((x) => x.id === hit.id);
      if (s) shapes.push({ k: 'ring', x: s.x, y: s.y, r: 8 });
    }
    this.show({ valid: false, shapes }, null, 'hint.demolishConfirm');
  }
}
