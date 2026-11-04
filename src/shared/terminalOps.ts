import { BUSINESS } from '@data/index';
import type { AirfieldPayload } from './airfield';
import {
  FIXTURE_COUNT,
  FIXTURE_KEYS,
  FLOOR,
  TERMINAL_CELL_M,
  TERMINAL_GRID,
  TERMINAL_MARGIN,
  WALL,
  isShopFixture,
  fixtureKey,
  type FixtureKey,
  type Terminal,
  type TerminalGrid,
} from './business';
import { distToSegment, pointInPolygon, type Pt } from './geom';
import { cosLut, sinLut } from './trig';
import { checkPoint, type BuildContext, type Problem } from './validate';

const N = TERMINAL_GRID;
const CELL = TERMINAL_CELL_M;
const DEG = Math.PI / 180;

export type TerminalOp = 'foundation' | 'floor' | 'erase' | 'wall' | 'removeWall' | 'fixture';

export interface TerminalEdit {
  op: TerminalOp;
  /** Cell rectangle [x0, x1) by [y0, y1) for area ops, or the two grid line ends for walls. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Floor type, wall type or fixture id, depending on the op. */
  variant: number;
}

/** Unit vectors of a grid: u along cell x, v along cell y (to the right of u on a map with y down). */
export function gridAxes(headingDeg: number): { ux: number; uy: number; vx: number; vy: number } {
  const a = headingDeg * DEG;
  const ux = sinLut(a);
  const uy = -cosLut(a);
  return { ux, uy, vx: -uy, vy: ux };
}

export function newGrid(id: number, ox: number, oy: number, headingDeg: number): TerminalGrid {
  return {
    id,
    ox,
    oy,
    headingDeg,
    floor: new Uint8Array(N * N),
    fixture: new Uint8Array(N * N),
    hWall: new Uint8Array((N + 1) * N),
    vWall: new Uint8Array(N * (N + 1)),
    leased: new Uint8Array(N * N),
    cost: 0,
  };
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

export function cellCount(g: TerminalGrid): number {
  let n = 0;
  for (let i = 0; i < g.floor.length; i++) if (g.floor[i] > 0) n++;
  return n;
}

export function summarize(g: TerminalGrid): Terminal {
  const counts = Object.fromEntries(FIXTURE_KEYS.map((k) => [k, 0])) as Record<FixtureKey, number>;
  let leased = 0;
  for (let i = 0; i < g.fixture.length; i++) {
    const f = g.fixture[i];
    if (f > 0) {
      counts[fixtureKey(f)]++;
      if (g.leased[i] === 1) leased++;
    }
  }
  return { id: g.id, cells: cellCount(g), counts, leased };
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
  for (const a of af.aprons) if (pointInPolygon(x, y, a.polygon)) return false;
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
    const cx = Math.floor(c.cx);
    const cy = Math.floor(c.cy);
    if (cx >= 0 && cy >= 0 && cx < N && cy < N && o.floor[cy * N + cx] > 0) return true;
  }
  return false;
}

const hasFloor = (g: TerminalGrid, cx: number, cy: number): boolean => cx >= 0 && cy >= 0 && cx < N && cy < N && g.floor[cy * N + cx] > 0;

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

  const area = e.op === 'foundation' || e.op === 'floor' || e.op === 'erase' || e.op === 'fixture';
  if (area) {
    if (x0 < 0 || y0 < 0 || x1 > N || y1 > N || x1 <= x0 || y1 <= y0) return none({ code: 'terminalBounds' });
    if ((x1 - x0) * (y1 - y0) > 4000) return none({ code: 'terminalTooLarge' });
    let blocked: Problem | null = null;
    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) {
        const i = cy * N + cx;
        if (e.op === 'foundation') {
          if (g.floor[i] > 0) continue;
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
            g.floor[i] = FLOOR.Concrete;
          });
        } else if (e.op === 'floor') {
          if (g.floor[i] === 0 || g.floor[i] === e.variant) continue;
          cost += e.variant === FLOOR.Tile ? T.tilePerCell : e.variant === FLOOR.Carpet ? T.carpetPerCell : 0;
          writes.push(() => {
            g.floor[i] = e.variant;
          });
        } else if (e.op === 'fixture') {
          if (g.floor[i] === 0 || g.fixture[i] !== 0) continue;
          cost += FIXTURE_COST(e.variant);
          writes.push(() => {
            g.fixture[i] = e.variant;
            g.leased[i] = 0;
          });
        } else {
          // Erase clears floor, fixture and any wall that no longer has a floor beside it.
          if (g.floor[i] === 0 && g.fixture[i] === 0) continue;
          writes.push(() => {
            g.floor[i] = 0;
            g.fixture[i] = 0;
            g.leased[i] = 0;
          });
        }
      }
    }
    if (blocked && writes.length === 0) return none(blocked);
    if (e.op === 'fixture' && (e.variant < 1 || e.variant > FIXTURE_COUNT)) return none({ code: 'nothingThere' });
    if (e.op === 'floor' && e.variant !== FLOOR.Concrete && e.variant !== FLOOR.Tile && e.variant !== FLOOR.Carpet) return none({ code: 'nothingThere' });
    if (writes.length === 0) return none({ code: e.op === 'fixture' || e.op === 'floor' ? 'terminalNeedsFoundation' : 'nothingThere' });
    const plan: Plan = {
      problem: blocked,
      cost,
      changes: writes.length,
      apply: () => {
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
  if (horizontal && (e.y0 < 0 || e.y0 > N || x0 < 0 || x1 > N)) return none({ code: 'terminalBounds' });
  if (vertical && (e.x0 < 0 || e.x0 > N || y0 < 0 || y1 > N)) return none({ code: 'terminalBounds' });
  if (x1 - x0 + (y1 - y0) > 200) return none({ code: 'terminalTooLarge' });
  const type = e.op === 'removeWall' ? WALL.None : e.variant;
  if (e.op === 'wall' && type !== WALL.Wall && type !== WALL.Glass && type !== WALL.Door) return none({ code: 'nothingThere' });
  const edgeCost = type === WALL.Wall ? T.wallPerEdge : type === WALL.Glass ? T.glassPerEdge : type === WALL.Door ? T.doorPerEdge : 0;
  const count = horizontal ? x1 - x0 : y1 - y0;
  for (let k = 0; k < count; k++) {
    let arr: Uint8Array;
    let idx: number;
    let beside: boolean;
    if (horizontal) {
      const x = x0 + k;
      arr = g.hWall;
      idx = e.y0 * N + x;
      beside = hasFloor(g, x, e.y0 - 1) || hasFloor(g, x, e.y0);
    } else {
      const y = y0 + k;
      arr = g.vWall;
      idx = y * (N + 1) + e.x0;
      beside = hasFloor(g, e.x0 - 1, y) || hasFloor(g, e.x0, y);
    }
    if (arr[idx] === type) continue;
    if (type !== WALL.None && !beside) continue;
    if (type === WALL.None && arr[idx] === 0) continue;
    cost += edgeCost;
    writes.push(() => {
      arr[idx] = type;
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
  for (let y = 0; y <= N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (g.hWall[i] !== 0 && !hasFloor(g, x, y - 1) && !hasFloor(g, x, y)) g.hWall[i] = 0;
    }
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x <= N; x++) {
      const i = y * (N + 1) + x;
      if (g.vWall[i] !== 0 && !hasFloor(g, x - 1, y) && !hasFloor(g, x, y)) g.vWall[i] = 0;
    }
  }
}

/** Cell under a world point, or null when it is outside the grid. */
export function cellAtWorld(g: TerminalGrid, x: number, y: number): { cx: number; cy: number } | null {
  const c = worldToCell(g, x, y);
  const cx = Math.floor(c.cx);
  const cy = Math.floor(c.cy);
  if (cx < 0 || cy < 0 || cx >= N || cy >= N) return null;
  return { cx, cy };
}
