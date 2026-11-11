import { apronContains } from '@shared/apronGeom';
import { BUSINESS } from '@data/index';
import type { AirfieldPayload } from './airfield';
import {
  FIXTURE_COUNT,
  FIXTURE_KEYS,
  FIXTURE_SPAN,
  FLOOR,
  TERMINAL_CELL_M,
  TERMINAL_CHUNK,
  TERMINAL_MARGIN,
  WALL,
  FIXTURE_ZONES,
  isShopFixture,
  fixtureKey,
  type FixtureKey,
  type Terminal,
  type TerminalGrid,
} from './business';
import { distToSegment, type Pt } from './geom';
import { cosLut, sinLut } from './trig';
import { checkPoint, type BuildContext, type Problem } from './validate';

const CELL = TERMINAL_CELL_M;
/** A wall edit spans at most this many edges, a guard against runaway input only. */
const MAX_WALL_EDGES = 2000;
const DEG = Math.PI / 180;

export type TerminalOp = 'foundation' | 'floor' | 'erase' | 'wall' | 'removeWall' | 'fixture' | 'zone';

export interface TerminalEdit {
  op: TerminalOp;
  /** Cell rectangle [x0, x1) by [y0, y1) for area ops, or the two grid line ends for walls. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Floor type, wall type or fixture id, depending on the op. */
  variant: number;
  /** Direction from anchor to tail of a two cell fixture, default 0. Ignored for one cell fixtures. */
  rot?: 0 | 1 | 2 | 3;
}

/** Column and row step from anchor to tail for each fixture rotation. */
const ROT_STEP: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/** Cell index of the other half of a two cell fixture, or -1 when the cell has none or it is outside the grid. */
export function fixturePartner(g: TerminalGrid, cell: number): number {
  const code = g.fixtureRot[cell];
  if (code === 0) return -1;
  const tail = code >= 5;
  const [dx, dy] = ROT_STEP[tail ? code - 5 : code - 1];
  const sign = tail ? -1 : 1;
  const c = cellOf(g, cell);
  return cellIndex(g, c.x + sign * dx, c.y + sign * dy);
}

/** Clears one cell's fixture, its footprint and its lease. */
function clearFixtureCell(g: TerminalGrid, i: number): void {
  g.fixture[i] = 0;
  g.fixtureRot[i] = 0;
  g.leased[i] = 0;
}

const cellKey = (x: number, y: number): string => `${x},${y}`;

/** Unit vectors of a grid: u along cell x, v along cell y (to the right of u on a map with y down). */
export function gridAxes(headingDeg: number): { ux: number; uy: number; vx: number; vy: number } {
  const a = headingDeg * DEG;
  const ux = sinLut(a);
  const uy = -cosLut(a);
  return { ux, uy, vx: -uy, vy: ux };
}

/** An empty building. Its grid is allocated as edits reach into it. */
export function newGrid(id: number, ox: number, oy: number, headingDeg: number): TerminalGrid {
  return { id, building: id, level: 0, ox, oy, headingDeg, x0: 0, y0: 0, w: 0, h: 0, floor: new Uint8Array(0), zone: new Uint8Array(0), fixture: new Uint8Array(0), fixtureRot: new Uint8Array(0), hWall: new Uint8Array(0), vWall: new Uint8Array(0), leased: new Uint8Array(0), cost: 0 };
}

/** The grid of one floor of one building, or undefined. */
export function gridOnLevel(grids: readonly TerminalGrid[], building: number, level: number): TerminalGrid | undefined {
  for (const g of grids) {
    if (g.building === building && g.level === level) return g;
  }
  return undefined;
}

/** Array index of a logical cell, or -1 outside the grid. */
export function cellIndex(g: TerminalGrid, x: number, y: number): number {
  const ax = x - g.x0;
  const ay = y - g.y0;
  return ax < 0 || ay < 0 || ax >= g.w || ay >= g.h ? -1 : ay * g.w + ax;
}

/** Index of the horizontal edge above logical cell (x, y), or -1 outside. y may equal the bottom row + 1. */
export function hEdgeIndex(g: TerminalGrid, x: number, y: number): number {
  const ax = x - g.x0;
  const ay = y - g.y0;
  return ax < 0 || ay < 0 || ax >= g.w || ay > g.h ? -1 : ay * g.w + ax;
}

/** Index of the vertical edge left of logical cell (x, y), or -1 outside. x may equal the right column + 1. */
export function vEdgeIndex(g: TerminalGrid, x: number, y: number): number {
  const ax = x - g.x0;
  const ay = y - g.y0;
  return ax < 0 || ay < 0 || ax > g.w || ay >= g.h ? -1 : ay * (g.w + 1) + ax;
}

/** Logical cell of an array index. */
export const cellOf = (g: TerminalGrid, i: number): { x: number; y: number } => ({ x: g.x0 + (i % g.w), y: g.y0 + Math.floor(i / g.w) });

/**
 * Grows the grid to cover logical cells [x0, x1) by [y0, y1), in whole 64 m chunks aligned to the
 * logical origin. Existing cells keep their logical coordinates.
 */
export function ensureCells(g: TerminalGrid, x0: number, y0: number, x1: number, y1: number): void {
  const C = TERMINAL_CHUNK;
  const nx0 = Math.floor(Math.min(x0, g.w > 0 ? g.x0 : x0) / C) * C;
  const ny0 = Math.floor(Math.min(y0, g.h > 0 ? g.y0 : y0) / C) * C;
  const nx1 = Math.ceil(Math.max(x1, g.w > 0 ? g.x0 + g.w : x1) / C) * C;
  const ny1 = Math.ceil(Math.max(y1, g.h > 0 ? g.y0 + g.h : y1) / C) * C;
  if (g.w > 0 && nx0 === g.x0 && ny0 === g.y0 && nx1 === g.x0 + g.w && ny1 === g.y0 + g.h) return;
  const w = nx1 - nx0;
  const h = ny1 - ny0;
  const dx = g.x0 - nx0;
  const dy = g.y0 - ny0;
  const cells = (src: Uint8Array): Uint8Array => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < g.h; y++) out.set(src.subarray(y * g.w, (y + 1) * g.w), (y + dy) * w + dx);
    return out;
  };
  const hEdges = new Uint8Array((h + 1) * w);
  for (let y = 0; y <= g.h && g.w > 0; y++) hEdges.set(g.hWall.subarray(y * g.w, (y + 1) * g.w), (y + dy) * w + dx);
  const vEdges = new Uint8Array(h * (w + 1));
  for (let y = 0; y < g.h; y++) vEdges.set(g.vWall.subarray(y * (g.w + 1), (y + 1) * (g.w + 1)), (y + dy) * (w + 1) + dx);
  g.floor = cells(g.floor);
  g.zone = cells(g.zone);
  g.fixture = cells(g.fixture);
  g.fixtureRot = cells(g.fixtureRot);
  g.leased = cells(g.leased);
  g.hWall = hEdges;
  g.vWall = vEdges;
  g.x0 = nx0;
  g.y0 = ny0;
  g.w = w;
  g.h = h;
}

/** Grid origin so that cell (cx, cy) has its corner at the world point (px, py). */
export function originFor(px: number, py: number, headingDeg: number, cx = TERMINAL_MARGIN, cy = TERMINAL_MARGIN): { ox: number; oy: number } {
  const ax = gridAxes(headingDeg);
  return { ox: px - (ax.ux * cx + ax.vx * cy) * CELL, oy: py - (ax.uy * cx + ax.vy * cy) * CELL };
}

/** World position of a grid corner (cell coordinates may be fractional). */
export function cornerWorld(g: Pick<TerminalGrid, 'ox' | 'oy' | 'headingDeg'>, cx: number, cy: number): Pt {
  const a = gridAxes(g.headingDeg);
  return { x: g.ox + (a.ux * cx + a.vx * cy) * CELL, y: g.oy + (a.uy * cx + a.vy * cy) * CELL };
}

/** Fractional cell coordinates of a world point. */
export function worldToCell(g: Pick<TerminalGrid, 'ox' | 'oy' | 'headingDeg'>, x: number, y: number): { cx: number; cy: number } {
  const a = gridAxes(g.headingDeg);
  const dx = x - g.ox;
  const dy = y - g.oy;
  return { cx: (dx * a.ux + dy * a.uy) / CELL, cy: (dx * a.vx + dy * a.vy) / CELL };
}

/** Corners of a cell rectangle in world space. */
export function rectWorld(g: Pick<TerminalGrid, 'ox' | 'oy' | 'headingDeg'>, x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [cornerWorld(g, x0, y0), cornerWorld(g, x1, y0), cornerWorld(g, x1, y1), cornerWorld(g, x0, y1)];
}

/** Inclusive logical bounds of the floor cells, or null for a building with no floor. */
export function floorBounds(g: TerminalGrid): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < g.floor.length; i++) {
    if (g.floor[i] === 0) continue;
    const c = cellOf(g, i);
    if (c.x < x0) x0 = c.x;
    if (c.y < y0) y0 = c.y;
    if (c.x > x1) x1 = c.x;
    if (c.y > y1) y1 = c.y;
  }
  return x1 < x0 ? null : { x0, y0, x1, y1 };
}

export function cellCount(g: TerminalGrid): number {
  let n = 0;
  for (let i = 0; i < g.floor.length; i++) if (g.floor[i] > 0) n++;
  return n;
}

export function summarize(g: TerminalGrid): Terminal {
  const counts = Object.fromEntries(FIXTURE_KEYS.map((k) => [k, 0])) as Record<FixtureKey, number>;
  let leased = 0;
  const zones = [0, 0, 0, 0, 0];
  for (let i = 0; i < g.zone.length; i++) if (g.floor[i] > 0) zones[g.zone[i]]++;
  for (let i = 0; i < g.fixture.length; i++) {
    const f = g.fixture[i];
    // The tail of a two cell fixture is not counted again.
    if (f > 0 && g.fixtureRot[i] < 5) {
      counts[fixtureKey(f)]++;
      if (g.leased[i] === 1) leased++;
    }
  }
  return { id: g.id, cells: cellCount(g), counts, zones, leased };
}

const FIXTURE_COST = (id: number): number => (isShopFixture(id) ? BUSINESS.shops[fixtureKey(id) as keyof typeof BUSINESS.shops].cost : BUSINESS.modules[fixtureKey(id) as keyof typeof BUSINESS.modules].cost);

export interface Env {
  ctx: BuildContext;
  af: AirfieldPayload;
  /** Other buildings, so two terminals never share a cell. */
  others: readonly TerminalGrid[];
}

export interface Plan {
  problem: Problem | null;
  cost: number;
  /** Cells or edges that would change. */
  changes: number;
  /** Writes the edit into the grid. Only call it on a plan without a problem. */
  apply(): void;
}

/** True when a world point is clear of runways, taxiways and aprons, so a foundation may sit there. */
function clearOfPavement(af: AirfieldPayload, x: number, y: number): boolean {
  for (const a of af.aprons) if (apronContains(a, x, y)) return false;
  for (const r of af.runways) if (distToSegment(x, y, r.x1, r.y1, r.x2, r.y2) < r.widthM / 2 + r.shoulderM + 12) return false;
  for (const t of af.taxiways) {
    for (let i = 1; i < t.points.length; i++) if (distToSegment(x, y, t.points[i - 1].x, t.points[i - 1].y, t.points[i].x, t.points[i].y) < t.widthM / 2 + 4) return false;
  }
  return true;
}

function otherHasCell(others: readonly TerminalGrid[], self: number, x: number, y: number): boolean {
  for (const o of others) {
    if (o.id === self) continue;
    const c = worldToCell(o, x, y);
    if (hasFloor(o, Math.floor(c.cx), Math.floor(c.cy))) return true;
  }
  return false;
}

const hasFloor = (g: TerminalGrid, cx: number, cy: number): boolean => {
  const i = cellIndex(g, cx, cy);
  return i >= 0 && g.floor[i] > 0;
};

/** Per cell layers of a logical cell, all zero outside the grid. */
function cellAt(g: TerminalGrid, x: number, y: number): { floor: number; zone: number; fixture: number } {
  const i = cellIndex(g, x, y);
  return i < 0 ? { floor: 0, zone: 0, fixture: 0 } : { floor: g.floor[i], zone: g.zone[i], fixture: g.fixture[i] };
}

/**
 * Works out what an edit would cost and whether it is allowed, without changing the grid.
 * The sim and the UI previews both call this, so a preview turns red exactly when the sim refuses.
 */
export function planEdit(g: TerminalGrid, e: TerminalEdit, env: Env): Plan {
  const none = (problem: Problem): Plan => ({ problem, cost: 0, changes: 0, apply: () => undefined });
  const T = BUSINESS.terminal;
  const writes: (() => void)[] = [];
  let cost = 0;
  const x0 = Math.min(e.x0, e.x1);
  const x1 = Math.max(e.x0, e.x1);
  const y0 = Math.min(e.y0, e.y1);
  const y1 = Math.max(e.y0, e.y1);

  const area = e.op === 'foundation' || e.op === 'floor' || e.op === 'erase' || e.op === 'fixture' || e.op === 'zone';
  if (area) {
    if (x1 <= x0 || y1 <= y0) return none({ code: 'terminalBounds' });
    let blocked: Problem | null = null;
    const span = e.op === 'fixture' ? (FIXTURE_SPAN[fixtureKey(e.variant)] ?? 1) : 1;
    const rot = e.rot ?? 0;
    if (span === 2 && (!Number.isInteger(rot) || rot < 0 || rot > 3)) return none({ code: 'nothingThere' });
    // Cells a fixture of this edit already takes, so two anchors never claim one tail.
    const claimed = new Set<string>();
    // Cells are written by logical coordinates, after the grid has grown to cover the edit.
    const at = (cx: number, cy: number): number => cellIndex(g, cx, cy);
    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) {
        const cur = cellAt(g, cx, cy);
        if (e.op === 'foundation') {
          if (cur.floor > 0) continue;
          const c = cornerWorld(g, cx + 0.5, cy + 0.5);
          const site = checkPoint(env.ctx, c.x, c.y);
          if (site) {
            blocked = blocked ?? site;
            continue;
          }
          if (!clearOfPavement(env.af, c.x, c.y)) {
            blocked = blocked ?? { code: 'terminalOnPavement' };
            continue;
          }
          if (otherHasCell(env.others, g.id, c.x, c.y)) {
            blocked = blocked ?? { code: 'terminalOverlap' };
            continue;
          }
          cost += T.foundationPerCell;
          writes.push(() => {
            g.floor[at(cx, cy)] = FLOOR.Concrete;
          });
        } else if (e.op === 'floor') {
          if (cur.floor === 0 || cur.floor === e.variant) continue;
          cost += e.variant === FLOOR.Tile ? T.tilePerCell : e.variant === FLOOR.Carpet ? T.carpetPerCell : 0;
          writes.push(() => {
            g.floor[at(cx, cy)] = e.variant;
          });
        } else if (e.op === 'fixture') {
          if (cur.floor === 0 || cur.fixture !== 0 || claimed.has(cellKey(cx, cy))) continue;
          const allowed = FIXTURE_ZONES[fixtureKey(e.variant)] ?? [];
          if (cur.zone !== 0 && !allowed.includes(cur.zone)) {
            blocked = blocked ?? { code: 'wrongZone', args: {} };
            continue;
          }
          let tail: { x: number; y: number } | null = null;
          if (span === 2) {
            const [dx, dy] = ROT_STEP[rot];
            const tx = cx + dx;
            const ty = cy + dy;
            const t = cellAt(g, tx, ty);
            // A tail outside the grid or off the floor has nothing to stand on.
            if (t.floor === 0) {
              blocked = blocked ?? { code: 'terminalNeedsFoundation' };
              continue;
            }
            if (t.fixture !== 0 || claimed.has(cellKey(tx, ty))) continue;
            if (t.zone !== 0 && !allowed.includes(t.zone)) {
              blocked = blocked ?? { code: 'wrongZone', args: {} };
              continue;
            }
            claimed.add(cellKey(tx, ty));
            tail = { x: tx, y: ty };
          }
          claimed.add(cellKey(cx, cy));
          cost += FIXTURE_COST(e.variant);
          writes.push(() => {
            const i = at(cx, cy);
            g.fixture[i] = e.variant;
            g.fixtureRot[i] = tail ? 1 + rot : 0;
            g.leased[i] = 0;
            if (g.zone[i] === 0) g.zone[i] = allowed[0] ?? 0;
            if (tail) {
              const j = at(tail.x, tail.y);
              g.fixture[j] = e.variant;
              g.fixtureRot[j] = 5 + rot;
              g.leased[j] = 0;
              if (g.zone[j] === 0) g.zone[j] = allowed[0] ?? 0;
            }
          });
        } else if (e.op === 'zone') {
          if (cur.floor === 0 || cur.zone === e.variant) continue;
          if (cur.fixture !== 0 && e.variant !== 0 && !(FIXTURE_ZONES[fixtureKey(cur.fixture)] ?? []).includes(e.variant)) {
            blocked = blocked ?? { code: 'zoneHasFixture', args: {} };
            continue;
          }
          writes.push(() => {
            g.zone[at(cx, cy)] = e.variant;
          });
        } else {
          // Erase clears floor, fixture and any wall that no longer has a floor beside it.
          if (cur.floor === 0 && cur.fixture === 0) continue;
          writes.push(() => {
            const i = at(cx, cy);
            // A two cell fixture leaves with its other half, which may lie outside the erased rectangle.
            const partner = fixturePartner(g, i);
            g.floor[i] = 0;
            g.zone[i] = 0;
            clearFixtureCell(g, i);
            if (partner >= 0) clearFixtureCell(g, partner);
          });
        }
      }
    }
    if (blocked && writes.length === 0) return none(blocked);
    if (e.op === 'fixture' && (e.variant < 1 || e.variant > FIXTURE_COUNT)) return none({ code: 'nothingThere' });
    if (e.op === 'zone' && (e.variant < 0 || e.variant > 4)) return none({ code: 'nothingThere' });
    if (e.op === 'floor' && e.variant !== FLOOR.Concrete && e.variant !== FLOOR.Tile && e.variant !== FLOOR.Carpet) return none({ code: 'nothingThere' });
    if (writes.length === 0) return none({ code: e.op === 'fixture' || e.op === 'floor' || e.op === 'zone' ? 'terminalNeedsFoundation' : 'nothingThere' });
    const plan: Plan = {
      problem: blocked,
      cost,
      changes: writes.length,
      apply: () => {
        if (e.op === 'foundation') ensureCells(g, x0, y0, x1, y1);
        for (const w of writes) w();
        if (e.op === 'erase') pruneWalls(g);
        g.cost += cost;
      },
    };
    // A partly blocked foundation still builds the cells that are fine, but the preview shows the problem.
    return plan;
  }

  // Walls follow grid lines: horizontal when y0 === y1, vertical when x0 === x1.
  const horizontal = e.y0 === e.y1;
  const vertical = e.x0 === e.x1;
  if (horizontal === vertical) return none({ code: 'wallStraight' });
  if (x1 - x0 + (y1 - y0) > MAX_WALL_EDGES) return none({ code: 'terminalTooLarge' });
  const type = e.op === 'removeWall' ? WALL.None : e.variant;
  if (e.op === 'wall' && type !== WALL.Wall && type !== WALL.Glass && type !== WALL.Door) return none({ code: 'nothingThere' });
  const edgeCost = type === WALL.Wall ? T.wallPerEdge : type === WALL.Glass ? T.glassPerEdge : type === WALL.Door ? T.doorPerEdge : 0;
  const count = horizontal ? x1 - x0 : y1 - y0;
  for (let k = 0; k < count; k++) {
    // A wall only sits next to floor, so its edge is always inside the grid.
    let idx: number;
    let beside: boolean;
    if (horizontal) {
      const x = x0 + k;
      idx = hEdgeIndex(g, x, e.y0);
      beside = hasFloor(g, x, e.y0 - 1) || hasFloor(g, x, e.y0);
    } else {
      const y = y0 + k;
      idx = vEdgeIndex(g, e.x0, y);
      beside = hasFloor(g, e.x0 - 1, y) || hasFloor(g, e.x0, y);
    }
    if (idx < 0) continue;
    const arr = horizontal ? g.hWall : g.vWall;
    if (arr[idx] === type) continue;
    if (type !== WALL.None && !beside) continue;
    if (type === WALL.None && arr[idx] === 0) continue;
    cost += edgeCost;
    const at = idx;
    writes.push(() => {
      arr[at] = type;
    });
  }
  if (writes.length === 0) return none({ code: type === WALL.None ? 'nothingThere' : 'terminalNeedsFoundation' });
  return {
    problem: null,
    cost,
    changes: writes.length,
    apply: () => {
      for (const w of writes) w();
      g.cost += cost;
    },
  };
}

/** Removes wall edges that have no floor on either side. */
export function pruneWalls(g: TerminalGrid): void {
  for (let y = g.y0; y <= g.y0 + g.h; y++) {
    for (let x = g.x0; x < g.x0 + g.w; x++) {
      const i = hEdgeIndex(g, x, y);
      if (g.hWall[i] !== 0 && !hasFloor(g, x, y - 1) && !hasFloor(g, x, y)) g.hWall[i] = 0;
    }
  }
  for (let y = g.y0; y < g.y0 + g.h; y++) {
    for (let x = g.x0; x <= g.x0 + g.w; x++) {
      const i = vEdgeIndex(g, x, y);
      if (g.vWall[i] !== 0 && !hasFloor(g, x - 1, y) && !hasFloor(g, x, y)) g.vWall[i] = 0;
    }
  }
}

/** Logical cell under a world point. Grids grow, so every point has a cell. */
export function cellAtWorld(g: TerminalGrid, x: number, y: number): { cx: number; cy: number } {
  const c = worldToCell(g, x, y);
  return { cx: Math.floor(c.cx), cy: Math.floor(c.cy) };
}
