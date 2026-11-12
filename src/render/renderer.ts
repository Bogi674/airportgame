import { CHUNK_SIZE_M } from '@shared/math';
import { CELL_M, GRID_N } from '@shared/site';
import { SNAPSHOT_VEHICLE_CAPACITY, SnapHeader, type SnapshotViews } from '@shared/snapshot';
import type { SitePayload } from '@shared/site';
import { EMPTY_AIRFIELD, type AirfieldPayload } from '@shared/airfield';
import { AIRFIELD, GSE, PAINT } from '@data/index';
import { paintGhostObjects } from './markings/airfieldPaint';
import type { Ghost, GhostShape } from '@shared/ghost';
import { TERMINAL_CELL_M, type TerminalGrid } from '@shared/business';
import type { ConstructionGrid } from '@shared/constructionGrid';
import { OVERLAY_MAX, type OverlayData, type OverlayKind } from '@shared/overlay';
import type { WalkGraphView } from '@shared/protocol';
import { cornerWorld } from '@shared/terminalOps';
import { Camera } from './camera';
import { createChunkBaker, type ChunkBaker } from './bake/chunkBaker';
import { ParcelOverlay } from './overlay';
import { SpriteCache, tierForZoom } from './sprites/aircraftSprite';
import { People } from './people';
import { QualityGovernor, type QualityPreset } from './quality';
import { vehicleSprite } from './sprites/vehicleSprite';
import { bandForZoom, ChunkCache, chunkKey, chunkPixelSize, BAND_RASTER_SCALE, CHUNKS_PER_SIDE } from './chunks';
import { buildRamp, overlayMax, rampIndex, withAlpha } from './overlayRamp';

const MAX_BACKING = 4096;

/** Vehicle ground shadow length per metre of vehicle height, same direction as the aircraft shadow. */
const VEHICLE_SHADOW_M_PER_M = 0.12;
const VEHICLE_SHADOW_FILL = 'rgba(0, 0, 0, 0.22)';

/** Gap in CSS pixels between the cursor and a build readout box. */
const READOUT_GAP_PX = 16;

/**
 * Top left corner of a build readout box that follows the cursor. The box sits right and below the
 * cursor, flips to its left past the right viewport edge and above the cursor past the bottom edge.
 * All values share one unit. The result is written into `out`, so no object is allocated per frame.
 */
export function readoutPosition(
  cursorX: number,
  cursorY: number,
  boxW: number,
  boxH: number,
  viewportW: number,
  viewportH: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  out.x = cursorX + READOUT_GAP_PX + boxW > viewportW ? cursorX - READOUT_GAP_PX - boxW : cursorX + READOUT_GAP_PX;
  out.y = cursorY + READOUT_GAP_PX + boxH > viewportH ? cursorY - READOUT_GAP_PX - boxH : cursorY + READOUT_GAP_PX;
  return out;
}

/**
 * Top left corner of a build readout placed under a snap tip box, with the same left edge and `gap` between
 * them. Past the bottom edge the readout goes above the tip instead. Past the right edge its right edge aligns
 * with the tip's right edge, kept inside the viewport. The readout always lies fully above or fully below the
 * tip's vertical span, so the two never intersect. All values share one unit, written into `out`.
 */
export function readoutBelowTip(
  tipX: number,
  tipY: number,
  tipW: number,
  tipH: number,
  gap: number,
  boxW: number,
  boxH: number,
  viewportW: number,
  viewportH: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  const below = tipY + tipH + gap;
  out.y = below + boxH > viewportH ? tipY - gap - boxH : below;
  const x = tipX + boxW > viewportW ? tipX + tipW - boxW : tipX;
  out.x = Math.max(0, Math.min(x, viewportW - boxW));
  return out;
}

/** Construction grid line strokes: screen pixel widths and opacities, and the smallest drawn gap in CSS pixels. */
const GRID_MINOR_PX = 1;
const GRID_MAJOR_PX = 1.5;
const GRID_MINOR_ALPHA = 0.2;
const GRID_MAJOR_ALPHA = 0.5;
const GRID_MINOR_MIN_GAP_PX = 2;
const GRID_MAJOR_MIN_GAP_PX = 3;

/** Walking graph overlay: edge stroke and node radius in CSS pixels, and the colours of each node kind. */
const WALK_EDGE_PX = 1;
const WALK_NODE_PX = 2.5;
const WALK_EDGE_COLOR = 'rgba(120, 190, 255, 0.55)';
/** Node kinds in WALK_NODE order: 1 lattice, 2 door, 3 fixture. */
const WALK_NODE_COLORS = ['', 'rgba(120, 190, 255, 0.9)', '#f2b33d', '#5fd08a'] as const;

/** Terminal overlay: fill alpha of the colour ramp, and the smallest cell in CSS pixels that gets a label. */
const OVERLAY_ALPHA = 0.6;
const OVERLAY_LABEL_MIN_PX = 14;
const OVERLAY_LABEL_PX = 11;
const OVERLAY_LABEL_COLOR = '#10161c';

/** Canvas 2D renderer. Static layer from baked chunks, dynamic layer from interpolated snapshots. */
export class Renderer {
  readonly camera = new Camera();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly chunks: ChunkCache;
  private readonly baker: ChunkBaker;
  private site: SitePayload | null = null;
  private overlay: ParcelOverlay | null = null;
  private pendingOwner: Uint8Array | null = null;
  private pendingSelected = -1;
  private showParcels = false;
  private ghost: Ghost | null = null;
  /** Last pointer position over the canvas in CSS pixels. `known` is false until the first move. */
  private readonly pointer = { x: 0, y: 0, known: false };
  private readonly readoutAt = { x: 0, y: 0 };
  /** Snap tip box in device pixels, rewritten each frame while a tip shows. */
  private readonly tipRect = { x: 0, y: 0, w: 0, h: 0 };
  private guide: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
  private grid: ConstructionGrid | null = null;
  private readonly gridPoint = { x: 0, y: 0 };
  private hover: GhostShape[] | null = null;
  private selected: GhostShape[] | null = null;
  private readonly sprites = new SpriteCache();
  private readonly people = new People();
  private debug = false;
  private readonly governor = new QualityGovernor();
  private lastRender = 0;
  private readonly bounds = new Float64Array(4);
  /** Interpolated vehicle poses for the current frame, reused every frame. */
  private readonly vehicleIdx = new Int32Array(SNAPSHOT_VEHICLE_CAPACITY);
  private readonly vehicleXs = new Float64Array(SNAPSHOT_VEHICLE_CAPACITY);
  private readonly vehicleYs = new Float64Array(SNAPSHOT_VEHICLE_CAPACITY);
  private readonly vehicleHs = new Float64Array(SNAPSHOT_VEHICLE_CAPACITY);
  private readonly resizeObserver: ResizeObserver;
  private dpr = 1;
  private qualityDprCap = 2;
  /** Walking graph of the selected terminal, with world and screen positions per node (x, y pairs). */
  private walk: WalkGraphView | null = null;
  private walkWorld = new Float32Array(0);
  private walkScreen = new Float32Array(0);
  private overlayKind: OverlayKind = 'none';
  private overlayData: OverlayData[] | null = null;
  private overlayGrids: TerminalGrid[] = [];
  /** Per overlay grid, six numbers: the world position of logical cell (0, 0), then the world step of one cell in x and in y. */
  private overlayAxes = new Float64Array(0);
  private readonly overlayMatrix = new Float64Array(6);
  private overlayScale = 1;
  /** Label text per building, per node or gate cell, built with the scale so drawing never builds strings. */
  private overlayLabels: string[][] = [];
  private overlayRamp: string[] = [];
  private overlayThemeKey = '';
  /** Fill of unreachable gates, the muted token at the overlay alpha. */
  private overlayMutedFill = '';

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.baker = createChunkBaker((key, image) => this.chunks.deliver(key, image));
    this.chunks = new ChunkCache(this.baker);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  /** True once every chunk in view has been baked, for screenshots and tests. */
  chunksReady = false;

  setQualityPreset(p: QualityPreset): void {
    this.governor.setPreset(p);
    this.applyQuality();
  }

  get qualityLevel(): number {
    return this.governor.level;
  }

  private applyQuality(): void {
    const level = this.governor.level;
    this.people.setCap(level >= 1 ? 1500 : 3000);
    this.setQualityDprCap(level >= 3 ? 1 : 2);
  }

  setQualityDprCap(cap: number): void {
    if (cap === this.qualityDprCap) return;
    this.qualityDprCap = cap;
    this.resize();
  }

  /** Starts a new site: re-bakes terrain from scratch and rebuilds the parcel overlay. */
  setSite(site: SitePayload): void {
    this.site = site;
    this.pendingOwner = null;
    this.prevOwner = null;
    this.baker.setSite({ seed: site.seed, heights: site.heights, landClass: site.landClass, parcelId: site.parcelId });
    this.chunks.clear();
    this.overlay = new ParcelOverlay(site);
    if (this.pendingOwner) this.overlay.setOwner(this.pendingOwner);
    this.overlay.setSelected(this.pendingSelected);
  }

  /** New airfield geometry: send it to the baker and re-bake visible chunks. */
  private af: AirfieldPayload = EMPTY_AIRFIELD;

  setAirfield(airfield: AirfieldPayload): void {
    this.af = airfield;
    this.baker.setAirfield(airfield);
    this.chunks.markAllDirty();
  }

  setTerminals(terminals: TerminalGrid[]): void {
    this.baker.setTerminals(terminals);
    this.chunks.markAllDirty();
  }

  /** Shows rings around aircraft that wait on a reservation or were part of a deadlock. */
  setDebugOverlay(on: boolean): void {
    this.debug = on;
  }

  private prevOwner: Uint8Array | null = null;

  /**
   * Only chunks that touch a parcel whose owner changed need a new bake. Re-baking everything after
   * every purchase made the map go blank for a long time on big screens.
   */
  private markOwnershipDirty(owner: Uint8Array): void {
    const prev = this.prevOwner;
    this.prevOwner = owner.slice();
    if (!prev || prev.length !== owner.length || !this.site) {
      this.chunks.markAllDirty();
      return;
    }
    const changed = new Uint8Array(owner.length);
    let any = false;
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] !== prev[i]) {
        changed[i] = 1;
        any = true;
      }
    }
    if (!any) return;
    const pid = this.site.parcelId;
    const seen = new Set<number>();
    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N; i++) {
        if (changed[pid[j * GRID_N + i]] === 0) continue;
        const cx = Math.floor((i * CELL_M) / CHUNK_SIZE_M);
        const cy = Math.floor((j * CELL_M) / CHUNK_SIZE_M);
        const key = cy * CHUNKS_PER_SIDE + cx;
        if (seen.has(key)) continue;
        seen.add(key);
        this.chunks.markDirty(cx, cy);
      }
    }
  }

  setOwnership(owner: Uint8Array): void {
    this.pendingOwner = owner;
    this.baker.setOwner(owner);
    this.markOwnershipDirty(owner);
    this.overlay?.setOwner(owner);
  }

  setSelectedParcel(id: number): void {
    this.pendingSelected = id;
    this.overlay?.setSelected(id);
  }

  /** Dashed alignment guide from an anchor to the snapped point, or none. */
  setGuide(a: { x: number; y: number } | null, b: { x: number; y: number } | null): void {
    this.guide = a && b ? { a, b } : null;
  }

  /** The construction grid to draw under the ghost preview, or none (handoff/tasks/T42-grid-snapping.md, R6). */
  setGrid(grid: ConstructionGrid | null): void {
    this.grid = grid;
  }

  /** Outlines for what the pointer is over and what is selected. */
  setHighlight(hover: GhostShape[] | null, selected: GhostShape[] | null): void {
    this.hover = hover;
    this.selected = selected;
  }

  /** Shows the walking graph of one terminal grid, or hides it with nulls. Node positions are computed here, not per frame. */
  setWalkGraph(view: WalkGraphView | null, grid: TerminalGrid | null): void {
    if (!view || !grid) {
      this.walk = null;
      return;
    }
    const n = view.nodeX.length;
    this.walkWorld = new Float32Array(n * 2);
    this.walkScreen = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const p = cornerWorld(grid, view.nodeX[i]! + 0.5, view.nodeY[i]! + 0.5);
      this.walkWorld[2 * i] = p.x;
      this.walkWorld[2 * i + 1] = p.y;
    }
    this.walk = view;
  }

  /** Colours of the terminal overlay from the theme tokens. The ramp is rebuilt only when one of them changes. */
  setOverlayTheme(ok: string, warn: string, bad: string, muted: string): void {
    const key = `${ok}|${warn}|${bad}|${muted}`;
    if (key === this.overlayThemeKey) return;
    this.overlayThemeKey = key;
    this.overlayRamp = buildRamp(ok, warn, bad, OVERLAY_ALPHA);
    this.overlayMutedFill = withAlpha(muted, OVERLAY_ALPHA);
  }

  /**
   * Shows one terminal overlay, or none. The scale is recomputed only when new data or a new kind arrives. The cell
   * frames of the grids are recomputed whenever the grids or the data change, never per frame.
   */
  setOverlay(kind: OverlayKind, data: OverlayData[] | null, grids: TerminalGrid[]): void {
    if (data !== this.overlayData || kind !== this.overlayKind) {
      this.overlayScale = overlayMax(kind, data ?? []);
      this.rebuildOverlayLabels(kind, data ?? []);
    }
    this.overlayKind = kind;
    this.overlayData = data;
    this.overlayGrids = grids;
    this.overlayAxes = new Float64Array(6 * grids.length);
    for (let i = 0; i < grids.length; i++) {
      const g = grids[i]!;
      const p0 = cornerWorld(g, 0, 0);
      const px = cornerWorld(g, 1, 0);
      const py = cornerWorld(g, 0, 1);
      const o = 6 * i;
      this.overlayAxes[o] = p0.x;
      this.overlayAxes[o + 1] = p0.y;
      this.overlayAxes[o + 2] = px.x - p0.x;
      this.overlayAxes[o + 3] = px.y - p0.y;
      this.overlayAxes[o + 4] = py.x - p0.x;
      this.overlayAxes[o + 5] = py.y - p0.y;
    }
  }

  /** Label text of every node or gate cell of every building. Unreachable gates get an empty label and no text. */
  private rebuildOverlayLabels(kind: OverlayKind, data: readonly OverlayData[]): void {
    this.overlayLabels.length = data.length;
    for (let k = 0; k < data.length; k++) {
      const d = data[k]!;
      const values = kind === 'queue' ? d.nodeQueue : kind === 'walk' ? d.gateDistM : null;
      const labels = this.overlayLabels[k] ?? [];
      labels.length = values ? values.length : 0;
      for (let n = 0; values && n < values.length; n++) {
        const v = values[n]!;
        labels[n] = kind === 'queue' ? String(v) : v === OVERLAY_MAX ? '' : `${v} m`;
      }
      this.overlayLabels[k] = labels;
    }
  }

  setGhost(ghost: Ghost | null): void {
    this.ghost = ghost;
  }

  /** Cursor position in CSS pixels over the canvas. The build readout follows it. */
  setPointer(x: number, y: number): void {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.known = true;
  }

  setParcelOverlayVisible(visible: boolean): void {
    this.showParcels = visible;
  }

  /** Parcel id under a screen position, or -1 outside the site. */
  parcelAt(sx: number, sy: number): number {
    if (!this.site) return -1;
    const p = { x: 0, y: 0 };
    this.camera.screenToWorld(sx, sy, p);
    const i = Math.floor(p.x / CELL_M);
    const j = Math.floor(p.y / CELL_M);
    if (i < 0 || j < 0 || i >= GRID_N || j >= GRID_N) return -1;
    return this.site.parcelId[j * GRID_N + i];
  }

  /** Re-reads size and pixel ratio. Caps each backing dimension at 4096. */
  resize(): void {
    const cssW = Math.max(1, this.canvas.clientWidth);
    const cssH = Math.max(1, this.canvas.clientHeight);
    let dpr = Math.min(window.devicePixelRatio || 1, this.qualityDprCap);
    dpr = Math.min(dpr, MAX_BACKING / cssW, MAX_BACKING / cssH);
    this.dpr = dpr;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.camera.setViewport(cssW, cssH);
  }

  /**
   * Draws one frame. `alpha` is the interpolation factor between `prev` and `curr`.
   * `prev` may be null before the second snapshot arrives.
   */
  render(prev: SnapshotViews | null, curr: SnapshotViews | null, alpha: number): void {
    const t0 = performance.now();
    if (this.lastRender > 0 && this.governor.frame(t0 - this.lastRender, t0)) this.applyQuality();
    this.lastRender = t0;
    const ctx = this.ctx;
    const cam = this.camera;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#10161c';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const c = Math.cos(cam.rotation);
    const s = Math.sin(cam.rotation);
    const z = cam.zoom * this.dpr;
    const e = (cam.width / 2) * this.dpr - z * (c * cam.x - s * cam.y);
    const f = (cam.height / 2) * this.dpr - z * (s * cam.x + c * cam.y);

    if (!this.site) return;
    this.drawChunks(z * c, z * s, -z * s, z * c, e, f);
    if (this.overlay) {
      this.overlay.draw(ctx, { a: z * c, b: z * s, c: -z * s, d: z * c, e, f }, cam.zoom, this.showParcels);
    }
    if (this.overlayKind !== 'none') this.drawOverlay(z * c, z * s, -z * s, z * c, e, f);
    if (this.walk) this.drawWalkGraph(ctx, z * c, z * s, -z * s, z * c, e, f);
    if (this.hover || this.selected) this.drawHighlights(z * c, z * s, -z * s, z * c, e, f);
    if (this.grid) this.drawGrid(this.grid, z * c, z * s, -z * s, z * c, e, f);
    if (this.guide) this.drawGuide(z * c, z * s, -z * s, z * c, e, f);
    if (this.ghost) this.drawGhost(this.ghost, z * c, z * s, -z * s, z * c, e, f);
    if (curr) this.drawVehicles(prev, curr, alpha, z * c, z * s, -z * s, z * c, e, f);
    if (curr) this.drawAircraft(prev, curr, alpha, z * c, z * s, -z * s, z * c, e, f);
    this.drawPeople(curr, z * c, z * s, -z * s, z * c, e, f);
  }

  /**
   * Device matrix of one overlay grid's logical cells, written into overlayMatrix: the camera matrix applied to the
   * grid's world axes. Logical cell (x, y) maps to device (m0 x + m2 y + m4, m1 x + m3 y + m5).
   */
  private overlayMatrixFor(grid: number, a: number, b: number, cc: number, d: number, e: number, f: number): Float64Array {
    const o = 6 * grid;
    const ax = this.overlayAxes;
    const p0x = ax[o]!;
    const p0y = ax[o + 1]!;
    const uxx = ax[o + 2]!;
    const uxy = ax[o + 3]!;
    const uyx = ax[o + 4]!;
    const uyy = ax[o + 5]!;
    const m = this.overlayMatrix;
    m[0] = a * uxx + cc * uxy;
    m[1] = b * uxx + d * uxy;
    m[2] = a * uyx + cc * uyy;
    m[3] = b * uyx + d * uyy;
    m[4] = a * p0x + cc * p0y + e;
    m[5] = b * p0x + d * p0y + f;
    return m;
  }

  /**
   * One terminal overlay as a colour ramp over the cells of each building. Density fills cells with people, queue
   * fills service node cells by their wait and labels the queue length, walk fills gate cells by their walking
   * distance and labels the metres. Labels only show once a cell is at least OVERLAY_LABEL_MIN_PX on screen, so they
   * never overlap.
   */
  /** Label font, rebuilt only when the device pixel ratio changes. */
  private overlayFont = '';
  private overlayFontDpr = 0;

  private drawOverlay(a: number, b: number, cc: number, d: number, e: number, f: number): void {
    const data = this.overlayData;
    if (!data || this.overlayRamp.length === 0) return;
    const ctx = this.ctx;
    const kind = this.overlayKind;
    const scale = this.overlayScale;
    const ramp = this.overlayRamp;
    const labelled = this.camera.zoom * TERMINAL_CELL_M >= OVERLAY_LABEL_MIN_PX;
    for (let k = 0; k < data.length; k++) {
      const d0 = data[k]!;
      const g = this.overlayGrids[d0.building];
      if (!g || g.w !== d0.w || g.h !== d0.h) continue;
      const m = this.overlayMatrixFor(d0.building, a, b, cc, d, e, f);
      ctx.setTransform(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!);
      if (kind === 'density') {
        for (let i = 0; i < d0.density.length; i++) {
          const v = d0.density[i]!;
          if (v > 0) this.fillOverlayCell(g, i, ramp[rampIndex(v, scale)]!);
        }
      } else if (kind === 'queue') {
        for (let n = 0; n < d0.nodeCell.length; n++) {
          const i = d0.nodeCell[n]!;
          if (i >= 0) this.fillOverlayCell(g, i, ramp[rampIndex(d0.nodeWaitS[n]!, scale)]!);
        }
      } else if (kind === 'walk') {
        for (let n = 0; n < d0.gateCell.length; n++) {
          const i = d0.gateCell[n]!;
          if (i < 0) continue;
          const dist = d0.gateDistM[n]!;
          this.fillOverlayCell(g, i, dist === OVERLAY_MAX ? this.overlayMutedFill : ramp[rampIndex(dist, scale)]!);
        }
      }
      if (labelled && (kind === 'queue' || kind === 'walk')) this.labelOverlayCells(d0, kind, m, this.overlayLabels[k]!);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Fills one array cell of a grid. The transform must already map logical cells to device pixels. */
  private fillOverlayCell(g: TerminalGrid, index: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(g.x0 + (index % g.w), g.y0 + Math.floor(index / g.w), 1, 1);
  }

  /** Prebuilt labels at the centre of each node or gate cell, in screen pixels. */
  private labelOverlayCells(d: OverlayData, kind: OverlayKind, m: Float64Array, labels: string[]): void {
    const ctx = this.ctx;
    const g = this.overlayGrids[d.building]!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.overlayFontDpr !== this.dpr) {
      this.overlayFontDpr = this.dpr;
      this.overlayFont = `${OVERLAY_LABEL_PX * this.dpr}px system-ui, sans-serif`;
    }
    ctx.font = this.overlayFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = OVERLAY_LABEL_COLOR;
    const cells = kind === 'queue' ? d.nodeCell : d.gateCell;
    for (let n = 0; n < cells.length; n++) {
      const i = cells[n]!;
      const text = labels[n];
      if (i < 0 || !text) continue;
      const lx = g.x0 + (i % g.w) + 0.5;
      const ly = g.y0 + Math.floor(i / g.w) + 0.5;
      ctx.fillText(text, m[0]! * lx + m[2]! * ly + m[4]!, m[1]! * lx + m[3]! * ly + m[5]!);
    }
  }

  /**
   * Edges as one stroke and nodes as one fill per kind, in device pixels so the lines keep a fixed
   * width at every zoom. The world to screen mapping is the same matrix the other layers use.
   */
  private drawWalkGraph(ctx: CanvasRenderingContext2D, a: number, b: number, cc: number, d: number, e: number, f: number): void {
    const view = this.walk;
    if (!view) return;
    const n = view.nodeX.length;
    const world = this.walkWorld;
    const screen = this.walkScreen;
    for (let i = 0; i < n; i++) {
      const x = world[2 * i]!;
      const y = world[2 * i + 1]!;
      screen[2 * i] = a * x + cc * y + e;
      screen[2 * i + 1] = b * x + d * y + f;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      for (let k = view.edgeStart[i]!; k < view.edgeStart[i + 1]!; k++) {
        const j = view.edgeTo[k]!;
        if (j <= i) continue;
        ctx.moveTo(screen[2 * i]!, screen[2 * i + 1]!);
        ctx.lineTo(screen[2 * j]!, screen[2 * j + 1]!);
      }
    }
    ctx.lineWidth = WALK_EDGE_PX * this.dpr;
    ctx.strokeStyle = WALK_EDGE_COLOR;
    ctx.stroke();
    const r = WALK_NODE_PX * this.dpr;
    for (let kind = 1; kind < WALK_NODE_COLORS.length; kind++) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (view.nodeKind[i] !== kind) continue;
        const x = screen[2 * i]!;
        const y = screen[2 * i + 1]!;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = WALK_NODE_COLORS[kind]!;
      ctx.fill();
    }
  }

  private drawGuide(a: number, b: number, cc: number, d: number, e: number, f: number): void {
    const g = this.guide;
    if (!g) return;
    const ctx = this.ctx;
    const zoom = this.camera.zoom;
    ctx.setTransform(a, b, cc, d, e, f);
    ctx.strokeStyle = 'rgba(255,90,77,0.9)';
    ctx.lineWidth = Math.max(1.5 / zoom, 0.3);
    ctx.setLineDash([10 / zoom, 6 / zoom]);
    ctx.beginPath();
    ctx.moveTo(g.a.x, g.a.y);
    ctx.lineTo(g.b.x, g.b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(g.a.x, g.a.y, 4 / zoom, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * Construction grid lines in the snapping cyan (handoff/tasks/T42-grid-snapping.md, R6). The lattice has
   * no extent: the four viewport corners are mapped into the grid frame and only the lines that cross that
   * range are drawn. Endpoints are projected to device pixels by hand so the strokes keep a fixed screen
   * width at every zoom (PITFALLS 15). Minor lines closer than GRID_MINOR_MIN_GAP_PX on screen are dropped,
   * and the whole grid goes below GRID_MAJOR_MIN_GAP_PX, so a zoomed out view never turns into a wash. No text.
   */
  private drawGrid(g: ConstructionGrid, a: number, b: number, cc: number, d: number, e: number, f: number): void {
    const zoom = this.camera.zoom;
    const minor = g.spacingMinorM;
    const major = g.spacingMajorM;
    const showMinor = minor * zoom >= GRID_MINOR_MIN_GAP_PX;
    if (!showMinor && major * zoom < GRID_MAJOR_MIN_GAP_PX) return;
    const cam = this.camera;
    const p = this.gridPoint;
    let alongMin = Infinity;
    let alongMax = -Infinity;
    let acrossMin = Infinity;
    let acrossMax = -Infinity;
    for (let k = 0; k < 4; k++) {
      cam.screenToWorld(k % 2 === 0 ? 0 : cam.width, k < 2 ? 0 : cam.height, p);
      const dx = p.x - g.origin.x;
      const dy = p.y - g.origin.y;
      const along = dx * g.ax + dy * g.ay;
      const across = dx * g.cx + dy * g.cy;
      if (along < alongMin) alongMin = along;
      if (along > alongMax) alongMax = along;
      if (across < acrossMin) acrossMin = across;
      if (across > acrossMax) acrossMax = across;
    }
    const ctx = this.ctx;
    const k = this.dpr;
    const step = Math.round(major / minor);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = PAINT.colors.snap;
    ctx.lineCap = 'butt';
    ctx.setLineDash([]);
    for (let pass = 0; pass < 2; pass++) {
      const isMajor = pass === 1;
      if (!isMajor && !showMinor) continue;
      ctx.globalAlpha = isMajor ? GRID_MAJOR_ALPHA : GRID_MINOR_ALPHA;
      ctx.lineWidth = (isMajor ? GRID_MAJOR_PX : GRID_MINOR_PX) * k;
      ctx.beginPath();
      // Lines of constant along coordinate run across the grid, lines of constant across coordinate run along it.
      for (let axis = 0; axis < 2; axis++) {
        const lo = axis === 0 ? alongMin : acrossMin;
        const hi = axis === 0 ? alongMax : acrossMax;
        const from = axis === 0 ? acrossMin : alongMin;
        const to = axis === 0 ? acrossMax : alongMax;
        const ux = axis === 0 ? g.cx : g.ax;
        const uy = axis === 0 ? g.cy : g.ay;
        const nx = axis === 0 ? g.ax : g.cx;
        const ny = axis === 0 ? g.ay : g.cy;
        for (let i = Math.ceil(lo / minor); i <= Math.floor(hi / minor); i++) {
          if ((i % step === 0) !== isMajor) continue;
          const bx = g.origin.x + nx * i * minor;
          const by = g.origin.y + ny * i * minor;
          const x1 = bx + ux * from;
          const y1 = by + uy * from;
          const x2 = bx + ux * to;
          const y2 = by + uy * to;
          ctx.moveTo(a * x1 + cc * y1 + e, b * x1 + d * y1 + f);
          ctx.lineTo(a * x2 + cc * y2 + e, b * x2 + d * y2 + f);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Hover and selection outlines. Hover is a soft tint with a thin outline. The selection is a stronger
   * tint with an outline whose brightness pulses slowly, so it reads as active. A few shapes per frame.
   */
  private drawHighlights(a: number, b: number, cc: number, d: number, e: number, f: number): void {
    const ctx = this.ctx;
    const zoom = this.camera.zoom;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 380);
    const paint = (shapes: GhostShape[], fill: string, stroke: string, lw: number): void => {
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineJoin = 'round';
      for (const sh of shapes) {
        ctx.setTransform(a, b, cc, d, e, f);
        ctx.lineWidth = Math.max(lw / zoom, 0.3);
        if (sh.k === 'strip') {
          if (sh.pts.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(sh.pts[0].x, sh.pts[0].y);
          for (let i = 1; i < sh.pts.length; i++) ctx.lineTo(sh.pts[i].x, sh.pts[i].y);
          ctx.lineCap = 'butt';
          ctx.lineWidth = sh.w;
          ctx.strokeStyle = fill;
          ctx.stroke();
          ctx.strokeStyle = stroke;
        } else if (sh.k === 'poly') {
          if (sh.pts.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(sh.pts[0].x, sh.pts[0].y);
          for (let i = 1; i < sh.pts.length; i++) ctx.lineTo(sh.pts[i].x, sh.pts[i].y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (sh.k === 'box') {
          ctx.translate(sh.x, sh.y);
          ctx.rotate((sh.headingDeg * Math.PI) / 180 - Math.PI / 2);
          ctx.fillRect(0, -sh.w / 2, sh.len, sh.w);
          ctx.strokeRect(0, -sh.w / 2, sh.len, sh.w);
        } else if (sh.k === 'surfaces') {
          this.drawSurfaces(sh, a, b, cc, d, e, f);
          ctx.fillStyle = fill;
          ctx.strokeStyle = stroke;
        }
      }
    };
    if (this.hover) paint(this.hover, 'rgba(110,190,255,0.16)', 'rgba(150,215,255,0.85)', 1.5);
    if (this.selected) paint(this.selected, `rgba(90,170,255,${0.14 + 0.1 * pulse})`, `rgba(130,205,255,${0.6 + 0.4 * pulse})`, 2.5);
  }

  /** Build tool preview. A handful of shapes per frame, so plain path drawing is fine here. */
  private drawGhost(g: Ghost, a: number, b: number, cc: number, d: number, e: number, f: number): void {
    const ctx = this.ctx;
    if (g.preview) {
      // The object as it will be built, half transparent, with a red wash when it cannot be built.
      ctx.setTransform(a, b, cc, d, e, f);
      ctx.globalAlpha = 0.6;
      paintGhostObjects(ctx, this.af, g.preview, this.camera.zoom * this.dpr);
      ctx.globalAlpha = 1;
      if (!g.valid) {
        ctx.fillStyle = 'rgba(255,70,60,0.28)';
        for (const s of g.preview.stands ?? []) {
          const row = AIRFIELD.codes[s.code];
          ctx.setTransform(a, b, cc, d, e, f);
          ctx.translate(s.x, s.y);
          ctx.rotate((s.headingDeg * Math.PI) / 180 - Math.PI / 2);
          ctx.fillRect(-row.standLengthM - 6, -row.spanM / 2 - 3, row.standLengthM + 10, row.spanM + 6);
        }
      }
    }
    // The taxiway tool shows the new arm in snapping cyan at 30 percent (docs/DESIGN_REVISION_2.md section 2.2).
    const fill = !g.valid ? 'rgba(255,90,80,0.40)' : g.tone === 'snap' ? 'rgba(60,200,234,0.30)' : 'rgba(120,210,255,0.35)';
    const stroke = !g.valid ? 'rgba(255,120,110,0.95)' : g.tone === 'snap' ? PAINT.colors.snap : 'rgba(160,230,255,0.95)';
    const zoom = this.camera.zoom;
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineJoin = 'round';
    for (const sh of g.shapes) {
      ctx.setTransform(a, b, cc, d, e, f);
      ctx.lineWidth = Math.max(1.2 / zoom, 0.3);
      if (sh.k === 'strip') {
        if (sh.pts.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(sh.pts[0].x, sh.pts[0].y);
        for (let i = 1; i < sh.pts.length; i++) ctx.lineTo(sh.pts[i].x, sh.pts[i].y);
        ctx.strokeStyle = fill;
        ctx.lineWidth = sh.w;
        ctx.stroke();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(1.2 / zoom, 0.3);
        ctx.setLineDash([6 / zoom, 6 / zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (sh.k === 'poly') {
        if (sh.pts.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(sh.pts[0].x, sh.pts[0].y);
        for (let i = 1; i < sh.pts.length; i++) ctx.lineTo(sh.pts[i].x, sh.pts[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (sh.k === 'box') {
        ctx.translate(sh.x, sh.y);
        ctx.rotate((sh.headingDeg * Math.PI) / 180 - Math.PI / 2);
        ctx.fillRect(0, -sh.w / 2, sh.len, sh.w);
        ctx.strokeRect(0, -sh.w / 2, sh.len, sh.w);
      } else if (sh.k === 'ring') {
        ctx.beginPath();
        ctx.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (sh.k === 'surfaces') {
        this.drawSurfaces(sh, a, b, cc, d, e, f);
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
      } else if (sh.k === 'envelope') {
        ctx.beginPath();
        for (const poly of sh.polys) {
          if (poly.length < 2) continue;
          ctx.moveTo(poly[0].x, poly[0].y);
          for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
          ctx.closePath();
        }
        ctx.fillStyle = sh.clash ? 'rgba(255,90,80,0.22)' : 'rgba(255,255,255,0.10)';
        ctx.strokeStyle = sh.clash ? 'rgba(255,110,100,0.95)' : 'rgba(255,255,255,0.75)';
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
      } else if (sh.k === 'clash') {
        if (sh.pts.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(sh.pts[0].x, sh.pts[0].y);
        for (let i = 1; i < sh.pts.length; i++) ctx.lineTo(sh.pts[i].x, sh.pts[i].y);
        ctx.strokeStyle = 'rgba(255,80,70,0.55)';
        ctx.lineWidth = sh.w;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.strokeStyle = stroke;
      } else {
        this.drawMarker(sh.shape, a * sh.x + cc * sh.y + e, b * sh.x + d * sh.y + f, sh.label);
      }
    }
    if (g.tags) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const k = this.dpr;
      ctx.font = `bold ${11 * k}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (const tg of g.tags) {
        const sx = a * tg.x + cc * tg.y + e;
        const sy = b * tg.x + d * tg.y + f;
        const w = ctx.measureText(tg.text).width + 10 * k;
        ctx.fillStyle = 'rgba(16,22,28,0.9)';
        ctx.fillRect(sx - w / 2, sy - 9 * k, w, 18 * k);
        ctx.fillStyle = '#f4f4f4';
        ctx.fillText(tg.text, sx, sy + 0.5 * k);
      }
      ctx.textAlign = 'start';
    }
    if (g.tip) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const k = this.dpr;
      const sx = a * g.tip.x + cc * g.tip.y + e + 34 * k;
      const sy = b * g.tip.x + d * g.tip.y + f + 44 * k;
      ctx.font = `bold ${13 * k}px system-ui, sans-serif`;
      const w = ctx.measureText(g.tip.text).width + 24 * k;
      const h = 28 * k;
      ctx.fillStyle = 'rgba(16,22,28,0.92)';
      ctx.strokeStyle = PAINT.colors.snap;
      ctx.lineWidth = 1.5 * k;
      ctx.beginPath();
      ctx.roundRect(sx, sy - h / 2, w, h, 5 * k);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PAINT.colors.snap;
      ctx.textBaseline = 'middle';
      ctx.fillText(g.tip.text, sx + 12 * k, sy);
    }
    if (g.label) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const sx = a * g.label.x + cc * g.label.y + e;
      const sy = b * g.label.x + d * g.label.y + f;
      const k = this.dpr;
      // The snap tip box is drawn at +34/+44 px with a height of 28 px, so its top sits at +30 px.
      const hasTip = g.tip !== undefined;
      if (g.tip) {
        ctx.font = `bold ${13 * k}px system-ui, sans-serif`;
        this.tipRect.x = a * g.tip.x + cc * g.tip.y + e + 34 * k;
        this.tipRect.y = b * g.tip.x + d * g.tip.y + f + 30 * k;
        this.tipRect.w = ctx.measureText(g.tip.text).width + 24 * k;
        this.tipRect.h = 28 * k;
      }
      ctx.font = `${12 * k}px system-ui, sans-serif`;
      const w = ctx.measureText(g.label.text).width + 12 * k;
      const h = 20 * k;
      // The box follows the cursor, flipped to stay inside the viewport. Before the first pointer move it stays at the ghost point.
      let boxX = sx + 14 * k;
      let boxY = sy - 10 * k;
      if (hasTip) {
        // With a snap tip the readout sits under the tip box, never over it.
        const t = this.tipRect;
        readoutBelowTip(t.x, t.y, t.w, t.h, 6 * k, w, h, this.canvas.width, this.canvas.height, this.readoutAt);
        boxX = this.readoutAt.x;
        boxY = this.readoutAt.y;
      } else if (this.pointer.known) {
        const at = readoutPosition(this.pointer.x, this.pointer.y, w / k, h / k, this.camera.width, this.camera.height, this.readoutAt);
        boxX = at.x * k;
        boxY = at.y * k;
      }
      ctx.fillStyle = 'rgba(16,22,28,0.88)';
      ctx.fillRect(boxX, boxY, w, h);
      ctx.fillStyle = g.valid ? '#e6f7ff' : '#ffb4ad';
      ctx.textBaseline = 'middle';
      ctx.fillText(g.label.text, boxX + 6 * k, boxY + h / 2);
    }
  }

  /** Obstacle surfaces: dashed amber outlines and a red dot of fixed screen size per penetration. */
  private drawSurfaces(sh: Extract<GhostShape, { k: 'surfaces' }>, a: number, b: number, cc: number, d: number, e: number, f: number): void {
    const ctx = this.ctx;
    const zoom = this.camera.zoom;
    ctx.setTransform(a, b, cc, d, e, f);
    ctx.lineWidth = Math.max(1.2 / zoom, 0.3);
    ctx.setLineDash([8 / zoom, 6 / zoom]);
    ctx.strokeStyle = 'rgba(255,196,80,0.85)';
    ctx.fillStyle = 'rgba(255,196,80,0.06)';
    for (const poly of [sh.approachA, sh.approachB]) {
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    for (const line of sh.transitional) {
      ctx.moveTo(line[0].x, line[0].y);
      for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const r = 3.5 * this.dpr;
    ctx.fillStyle = 'rgba(255,70,60,0.95)';
    ctx.strokeStyle = 'rgba(40,0,0,0.8)';
    ctx.lineWidth = this.dpr;
    // Dots closer than their own size on screen are drawn once, so they never pile up.
    const drawn: number[] = [];
    for (const p of sh.hits) {
      const sx = a * p.x + cc * p.y + e;
      const sy = b * p.x + d * p.y + f;
      let near = false;
      for (let i = 0; i < drawn.length && !near; i += 2) near = Math.abs(drawn[i] - sx) < 3 * r && Math.abs(drawn[i + 1] - sy) < 3 * r;
      if (near) continue;
      drawn.push(sx, sy);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** A snap marker at screen position (x, y): node dots, and the ring, square or diamond of the active target. */
  private drawMarker(shape: 'dot' | 'ring' | 'square' | 'diamond', x: number, y: number, label?: string): void {
    const ctx = this.ctx;
    const k = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineWidth = 2 * k;
    ctx.strokeStyle = PAINT.colors.snap;
    ctx.fillStyle = PAINT.colors.snap;
    ctx.beginPath();
    if (shape === 'dot') {
      // A junction shows its label inside the circle, sized to fit the text.
      ctx.font = `bold ${11 * k}px system-ui, sans-serif`;
      const r = label ? Math.max(11 * k, ctx.measureText(label).width / 2 + 5 * k) : 4 * k;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#f4f4f4';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,24,30,0.9)';
      ctx.lineWidth = 1.2 * k;
      ctx.stroke();
      if (label) {
        ctx.fillStyle = '#1d2128';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y + 0.5 * k);
        ctx.textAlign = 'start';
      }
      return;
    }
    if (shape === 'ring') {
      // The target node: a cyan ring around a cyan dot, or around the node's badge when it has a label.
      ctx.font = `bold ${11 * k}px system-ui, sans-serif`;
      const inner = label ? Math.max(11 * k, ctx.measureText(label).width / 2 + 5 * k) : 5 * k;
      ctx.arc(x, y, inner + 13 * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, inner, 0, Math.PI * 2);
      ctx.fill();
      if (label) {
        ctx.fillStyle = '#1d2128';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y + 0.5 * k);
        ctx.textAlign = 'start';
      }
      return;
    }
    if (shape === 'square') ctx.rect(x - 10 * k, y - 10 * k, 20 * k, 20 * k);
    else {
      ctx.moveTo(x, y - 12 * k);
      ctx.lineTo(x + 12 * k, y);
      ctx.lineTo(x, y + 12 * k);
      ctx.lineTo(x - 12 * k, y);
      ctx.closePath();
    }
    ctx.stroke();
  }

  private drawChunks(a: number, b: number, cc: number, d: number, e: number, f: number): void {
    const cam = this.camera;
    const band = bandForZoom(cam.zoom);
    cam.visibleBounds(this.bounds);
    const minCx = Math.floor(this.bounds[0] / CHUNK_SIZE_M);
    const minCy = Math.floor(this.bounds[1] / CHUNK_SIZE_M);
    const maxCx = Math.floor(this.bounds[2] / CHUNK_SIZE_M);
    const maxCy = Math.floor(this.bounds[3] / CHUNK_SIZE_M);
    this.chunksReady = this.chunks.update(band, minCx, minCy, maxCx, maxCy);

    const ctx = this.ctx;
    const px = chunkPixelSize(band);
    const inv = 1 / BAND_RASTER_SCALE[band];
    for (let cy = Math.max(0, minCy); cy <= Math.min(CHUNKS_PER_SIDE - 1, maxCy); cy++) {
      for (let cx = Math.max(0, minCx); cx <= Math.min(CHUNKS_PER_SIDE - 1, maxCx); cx++) {
        const entry = this.chunks.get(chunkKey(band, cx, cy));
        if (!entry || !entry.image) continue;
        // One transform per chunk: world meters, chunk origin, raster scale folded in.
        ctx.setTransform(
          a * inv,
          b * inv,
          cc * inv,
          d * inv,
          a * cx * CHUNK_SIZE_M + cc * cy * CHUNK_SIZE_M + e,
          b * cx * CHUNK_SIZE_M + d * cy * CHUNK_SIZE_M + f,
        );
        ctx.drawImage(entry.image, 0, 0, px, px);
      }
    }
  }

  private drawAircraft(
    prev: SnapshotViews | null,
    curr: SnapshotViews,
    alpha: number,
    a: number,
    b: number,
    cc: number,
    d: number,
    e: number,
    f: number,
  ): void {
    const ctx = this.ctx;
    const n = curr.header[SnapHeader.AircraftCount];
    const pn = prev ? prev.header[SnapHeader.AircraftCount] : 0;
    const tier = Math.max(0, tierForZoom(this.camera.zoom) - (this.governor.level >= 2 ? 1 : 0));
    let pi = 0;
    for (let i = 0; i < n; i++) {
      const sprite = this.sprites.get(curr.aircraftType[i], curr.aircraftLivery[i], tier);
      let x = curr.aircraftX[i];
      let y = curr.aircraftY[i];
      let h = curr.aircraftHeading[i];
      // Both snapshots list aircraft by ascending id, so a moving pointer finds the previous entry.
      if (prev) {
        const id = curr.aircraftId[i];
        while (pi < pn && prev.aircraftId[pi] < id) pi++;
        if (pi < pn && prev.aircraftId[pi] === id) {
          const px = prev.aircraftX[pi];
          const py = prev.aircraftY[pi];
          if (Math.abs(x - px) < 400 && Math.abs(y - py) < 400) {
            x = px + (x - px) * alpha;
            y = py + (y - py) * alpha;
            let dh = h - prev.aircraftHeading[pi];
            while (dh > Math.PI) dh -= 2 * Math.PI;
            while (dh < -Math.PI) dh += 2 * Math.PI;
            h = prev.aircraftHeading[pi] + dh * alpha;
          }
        }
      }
      const ch = Math.cos(h);
      const sh = Math.sin(h);
      const k = 1 / sprite.ppm;
      const ma = (a * ch + cc * sh) * k;
      const mb = (b * ch + d * sh) * k;
      const mc = (-a * sh + cc * ch) * k;
      const md = (-b * sh + d * ch) * k;
      const wx = a * x + cc * y + e;
      const wy = b * x + d * y + f;
      ctx.setTransform(ma, mb, mc, md, wx - (ma + mc) * (sprite.width / 2), wy - (mb + md) * (sprite.height / 2));
      ctx.drawImage(sprite.canvas, 0, 0);
    }
  }

  private drawPeople(curr: SnapshotViews | null, a: number, b: number, cc: number, d: number, e: number, f: number): void {
    if (!curr) return;
    this.camera.visibleBounds(this.bounds);
    this.ctx.setTransform(a, b, cc, d, e, f);
    const bo = this.bounds;
    this.people.draw(this.ctx, curr, this.camera.zoom, this.camera.x, this.camera.y, a, b, cc, d, e, f, bo[0], bo[1], bo[2], bo[3]);
  }

  /**
   * Ground vehicles, drawn under the aircraft. Poses interpolate like aircraft: vehicles are written in ascending slot
   * id, so a moving pointer finds the previous entry. Each shadow is the footprint pushed along the aircraft shadow
   * direction by heightM times VEHICLE_SHADOW_M_PER_M, and all shadows go under all bodies.
   */
  private drawVehicles(
    prev: SnapshotViews | null,
    curr: SnapshotViews,
    alpha: number,
    a: number,
    b: number,
    cc: number,
    d: number,
    e: number,
    f: number,
  ): void {
    const ctx = this.ctx;
    const n = curr.header[SnapHeader.VehicleCount];
    const pn = prev ? prev.header[SnapHeader.VehicleCount] : 0;
    this.camera.visibleBounds(this.bounds);
    const bo = this.bounds;
    const idx = this.vehicleIdx;
    const xs = this.vehicleXs;
    const ys = this.vehicleYs;
    const hs = this.vehicleHs;
    let pi = 0;
    let m = 0;
    for (let i = 0; i < n; i++) {
      let x = curr.vehicleX[i];
      let y = curr.vehicleY[i];
      let h = curr.vehicleHeading[i];
      if (prev) {
        const id = curr.vehicleId[i];
        while (pi < pn && prev.vehicleId[pi] < id) pi++;
        if (pi < pn && prev.vehicleId[pi] === id && prev.vehicleKind[pi] === curr.vehicleKind[i]) {
          const px = prev.vehicleX[pi];
          const py = prev.vehicleY[pi];
          if (Math.abs(x - px) < 400 && Math.abs(y - py) < 400) {
            x = px + (x - px) * alpha;
            y = py + (y - py) * alpha;
            let dh = h - prev.vehicleHeading[pi];
            while (dh > Math.PI) dh -= 2 * Math.PI;
            while (dh < -Math.PI) dh += 2 * Math.PI;
            h = prev.vehicleHeading[pi] + dh * alpha;
          }
        }
      }
      if (x < bo[0] - 20 || x > bo[2] + 20 || y < bo[1] - 20 || y > bo[3] + 20) continue;
      idx[m] = i;
      xs[m] = x;
      ys[m] = y;
      hs[m] = h;
      m++;
    }

    ctx.fillStyle = VEHICLE_SHADOW_FILL;
    for (let k = 0; k < m; k++) {
      const spec = GSE[curr.vehicleKind[idx[k]]];
      const x = xs[k];
      const y = ys[k];
      const h = hs[k];
      const ch = Math.cos(h);
      const sh = Math.sin(h);
      // Body frame offset, same as the aircraft sprite shadow: equal along nose and wing axes.
      const lx = spec.heightM * VEHICLE_SHADOW_M_PER_M * Math.SQRT1_2;
      const ly = lx;
      ctx.setTransform(a * ch + cc * sh, b * ch + d * sh, -a * sh + cc * ch, -b * sh + d * ch, a * x + cc * y + e, b * x + d * y + f);
      ctx.fillRect(-spec.lengthM / 2 + lx, -spec.widthM / 2 + ly, spec.lengthM, spec.widthM);
    }

    for (let k = 0; k < m; k++) {
      const sprite = vehicleSprite(curr.vehicleKind[idx[k]]);
      const x = xs[k];
      const y = ys[k];
      const h = hs[k];
      const ch = Math.cos(h);
      const sh = Math.sin(h);
      const k2 = 1 / sprite.ppm;
      const ma = (a * ch + cc * sh) * k2;
      const mb = (b * ch + d * sh) * k2;
      const mc = (-a * sh + cc * ch) * k2;
      const md = (-b * sh + d * ch) * k2;
      const wx = a * x + cc * y + e;
      const wy = b * x + d * y + f;
      ctx.setTransform(ma, mb, mc, md, wx - (ma + mc) * (sprite.width / 2), wy - (mb + md) * (sprite.height / 2));
      ctx.drawImage(sprite.canvas, 0, 0);
    }
    if (this.debug) this.drawFlags(curr, a, b, cc, d, e, f);
  }

  private drawFlags(curr: SnapshotViews, a: number, b: number, cc: number, d: number, e: number, f: number): void {
    const ctx = this.ctx;
    const n = curr.header[SnapHeader.AircraftCount];
    ctx.setTransform(a, b, cc, d, e, f);
    ctx.lineWidth = Math.max(2 / this.camera.zoom, 0.8);
    for (let i = 0; i < n; i++) {
      const fl = curr.aircraftFlags[i];
      if (fl === 0) continue;
      ctx.strokeStyle = (fl & 2) !== 0 ? '#ff3b30' : '#ffb020';
      ctx.beginPath();
      ctx.arc(curr.aircraftX[i], curr.aircraftY[i], 28, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.baker.dispose();
    this.chunks.dispose();
  }
}
