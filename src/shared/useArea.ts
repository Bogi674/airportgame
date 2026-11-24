import { BUSINESS } from '@data/index';
import { FIXTURE_COUNT, TERMINAL_CELL_M, WALL, fixtureKey, footprintOf, type FixtureKey, type Prop, type TerminalGrid } from './business';
import { PROP_STEP_M, layerOf, planProp, propRect, propSpec, type PropCategory, type PropPlan, type StepRect } from './props';
import type { Problem } from './validate';

/**
 * Use areas (T85, owner 2026-11-24): the floor a fixture or prop needs clear around it. A fixture's front lies on the
 * side people use, which is the bottom edge of its sprite and, once placed, one quarter turn after its direction; its
 * back is the staff side opposite. A transition fixture's entry is its front and its exit its back. A prop needs a
 * strip in front of the side people use. Placement is refused when a use area holds a wall, another item or no floor,
 * or when the new item lands on the use area of one already placed.
 */
const U = BUSINESS.useAreas;
const SUB = TERMINAL_CELL_M / PROP_STEP_M;
/** Column and row step per direction, as ROT_STEP in terminalOps (kept here so this module has no import cycle). */
const STEP: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

const solid = (w: number): boolean => w === WALL.Wall || w === WALL.Glass;

/** Front and back depth in cells of a fixture, zero for fixtures without a use area. */
export function useDepth(key: FixtureKey): { front: number; back: number } {
  return U.fixtures[key] ?? { front: 0, back: 0 };
}

/** Cell step toward the front of a fixture placed with direction rot. */
export function frontStep(rot: number): readonly [number, number] {
  return STEP[(rot + 1) % 4]!;
}

/** One use cell: its logical position and the cell it is reached from, for the wall check on the edge between. */
export interface UseCell {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  /** True on the staff or exit side. */
  back: boolean;
}

/** Logical cells of a fixture footprint from its anchor, in along then across order. */
export function footprintCells(key: FixtureKey, level: number, x: number, y: number, rot: number): [number, number][] {
  const [along, across] = footprintOf(key, level);
  const [ax, ay] = STEP[rot]!;
  const [bx, by] = STEP[(rot + 1) % 4]!;
  const out: [number, number][] = [];
  for (let a = 0; a < along; a++) for (let b = 0; b < across; b++) out.push([x + a * ax + b * bx, y + a * ay + b * by]);
  return out;
}

/** Use cells of a fixture anchored at logical (x, y), front first. Empty for a fixture without a use area. */
export function fixtureUseCells(key: FixtureKey, level: number, x: number, y: number, rot: number): UseCell[] {
  const { front, back } = useDepth(key);
  if (front === 0 && back === 0) return [];
  const cells = footprintCells(key, level, x, y, rot);
  const inside = new Set(cells.map(([cx, cy]) => cx * 65536 + cy));
  const out: UseCell[] = [];
  const [fx, fy] = frontStep(rot);
  for (const [depth, dx, dy, isBack] of [
    [front, fx, fy, false],
    [back, -fx, -fy, true],
  ] as const) {
    for (const [cx, cy] of cells) {
      for (let k = 1; k <= depth; k++) {
        const ux = cx + k * dx;
        const uy = cy + k * dy;
        if (inside.has(ux * 65536 + uy)) break;
        out.push({ x: ux, y: uy, fromX: ux - dx, fromY: uy - dy, back: isBack });
      }
    }
  }
  return out;
}

const cellAt = (g: TerminalGrid, x: number, y: number): number => {
  const ax = x - g.x0;
  const ay = y - g.y0;
  return ax < 0 || ay < 0 || ax >= g.w || ay >= g.h ? -1 : ay * g.w + ax;
};

/** Wall type on the edge between two side by side logical cells, 0 outside the grid. */
export function edgeWall(g: TerminalGrid, ax: number, ay: number, bx: number, by: number): number {
  if (ay === by) {
    const x = Math.max(ax, bx) - g.x0;
    const y = ay - g.y0;
    return x < 0 || y < 0 || x > g.w || y >= g.h ? 0 : g.vWall[y * (g.w + 1) + x]!;
  }
  const x = ax - g.x0;
  const y = Math.max(ay, by) - g.y0;
  return x < 0 || y < 0 || x >= g.w || y > g.h ? 0 : g.hWall[y * g.w + x]!;
}

/** Front strip of a prop in prop steps, null when its category needs none or it is not a floor prop. */
export function propUseRect(p: Prop): StepRect | null {
  const spec = propSpec(p.asset);
  const r = propRect(p);
  if (!spec || !r || layerOf(spec) !== 'floor') return null;
  const m = U.propFrontM[spec.category as PropCategory] ?? 0;
  if (m <= 0) return null;
  const d = Math.max(1, Math.round(m / PROP_STEP_M));
  if (p.rot === 0) return { sx0: r.sx0, sy0: r.sy1, sx1: r.sx1, sy1: r.sy1 + d };
  if (p.rot === 1) return { sx0: r.sx0 - d, sy0: r.sy0, sx1: r.sx0, sy1: r.sy1 };
  if (p.rot === 2) return { sx0: r.sx0, sy0: r.sy0 - d, sx1: r.sx1, sy1: r.sy0 };
  return { sx0: r.sx1, sy0: r.sy0, sx1: r.sx1 + d, sy1: r.sy1 };
}

const overlap = (a: StepRect, b: StepRect): boolean => a.sx0 < b.sx1 && b.sx0 < a.sx1 && a.sy0 < b.sy1 && b.sy0 < a.sy1;

/** The step rectangle of one whole logical cell. */
const cellRect = (x: number, y: number): StepRect => ({ sx0: x * SUB, sy0: y * SUB, sx1: (x + 1) * SUB, sy1: (y + 1) * SUB });

/** True when a floor prop other than `skip` covers part of a logical cell. */
function propOnCell(g: TerminalGrid, x: number, y: number, skip: number): boolean {
  const c = cellRect(x, y);
  for (let i = 0; i < g.props.length; i++) {
    if (i === skip) continue;
    const q = g.props[i]!;
    const s = propSpec(q.asset);
    const r = propRect(q);
    if (s && r && layerOf(s) === 'floor' && overlap(c, r)) return true;
  }
  return false;
}

/**
 * Per array cell, 1 where the use area of a placed fixture or the front strip of a placed prop lies. The fixture
 * anchored at array cell `skipAnchor` and the prop at index `skipProp` are left out, for a move of that item.
 */
export function useMask(g: TerminalGrid, skipAnchor = -1, skipProp = -1, withProps = true): Uint8Array {
  const mask = new Uint8Array(g.w * g.h);
  for (let i = 0; i < g.fixture.length; i++) {
    const f = g.fixture[i]!;
    if (f === 0 || f > FIXTURE_COUNT || g.fixtureRot[i]! >= 5 || i === skipAnchor) continue;
    const code = g.fixtureRot[i]!;
    const x = g.x0 + (i % g.w);
    const y = g.y0 + Math.floor(i / g.w);
    for (const u of fixtureUseCells(fixtureKey(f), g.fixtureLevel[i]!, x, y, code === 0 ? 0 : code - 1)) {
      const j = cellAt(g, u.x, u.y);
      if (j >= 0) mask[j] = 1;
    }
  }
  for (let k = 0; withProps && k < g.props.length; k++) {
    if (k === skipProp) continue;
    const r = propUseRect(g.props[k]!);
    if (!r) continue;
    for (let y = Math.floor(r.sy0 / SUB); y < Math.ceil(r.sy1 / SUB); y++) {
      for (let x = Math.floor(r.sx0 / SUB); x < Math.ceil(r.sx1 / SUB); x++) {
        const j = cellAt(g, x, y);
        if (j >= 0) mask[j] = 1;
      }
    }
  }
  return mask;
}

/**
 * Why the use area of a fixture to be placed at logical (x, y) is blocked, or null when it is clear. `own` holds the
 * array cells of the fixture's footprint (and, for a move, the cells it leaves), which never block.
 */
export function fixtureUseProblem(g: TerminalGrid, key: FixtureKey, level: number, x: number, y: number, rot: number, own: ReadonlySet<number> = new Set()): Problem | null {
  for (const u of fixtureUseCells(key, level, x, y, rot)) if (useCellBlocked(g, u, own)) return { code: 'useAreaBlocked' };
  return null;
}

/** True when one use cell holds no floor, a solid wall on its edge, a fixture outside `own`, or a floor prop. */
export function useCellBlocked(g: TerminalGrid, u: UseCell, own: ReadonlySet<number> = new Set()): boolean {
  const j = cellAt(g, u.x, u.y);
  if (j < 0 || g.floor[j] === 0) return true;
  if (solid(edgeWall(g, u.fromX, u.fromY, u.x, u.y))) return true;
  if (g.fixture[j] !== 0 && !own.has(j)) return true;
  return propOnCell(g, u.x, u.y, -1);
}

/** True when a prop footprint or strip runs over a solid wall edge inside it. */
function stripCrossesWall(g: TerminalGrid, r: StepRect): boolean {
  for (let x = Math.floor(r.sx0 / SUB) + 1; x * SUB < r.sx1; x++) {
    if (x * SUB <= r.sx0) continue;
    for (let y = Math.floor(r.sy0 / SUB); y * SUB < r.sy1; y++) if (solid(edgeWall(g, x - 1, y, x, y))) return true;
  }
  for (let y = Math.floor(r.sy0 / SUB) + 1; y * SUB < r.sy1; y++) {
    if (y * SUB <= r.sy0) continue;
    for (let x = Math.floor(r.sx0 / SUB); x * SUB < r.sx1; x++) if (solid(edgeWall(g, x, y - 1, x, y))) return true;
  }
  return false;
}

/**
 * Why a prop's use area is blocked, or null. Its strip needs floor, no fixture, no other floor prop and no solid wall
 * between it and the prop; and the prop must not land on another item's use area. `skip` is the index of a prop being
 * moved, left out of every check.
 */
export function propUseProblem(g: TerminalGrid, p: Prop, skip = -1): Problem | null {
  const spec = propSpec(p.asset);
  const r = propRect(p);
  if (!spec || !r) return null;
  const strip = propUseRect(p);
  if (strip) {
    const union: StepRect = { sx0: Math.min(r.sx0, strip.sx0), sy0: Math.min(r.sy0, strip.sy0), sx1: Math.max(r.sx1, strip.sx1), sy1: Math.max(r.sy1, strip.sy1) };
    if (stripCrossesWall(g, union)) return { code: 'useAreaBlocked' };
    for (let y = Math.floor(strip.sy0 / SUB); y < Math.ceil(strip.sy1 / SUB); y++) {
      for (let x = Math.floor(strip.sx0 / SUB); x < Math.ceil(strip.sx1 / SUB); x++) {
        const j = cellAt(g, x, y);
        if (j < 0 || g.floor[j] === 0 || g.fixture[j] !== 0) return { code: 'useAreaBlocked' };
      }
    }
    for (let i = 0; i < g.props.length; i++) {
      if (i === skip) continue;
      const q = g.props[i]!;
      const s = propSpec(q.asset);
      const qr = propRect(q);
      if (s && qr && layerOf(s) === 'floor' && overlap(strip, qr)) return { code: 'useAreaBlocked' };
    }
  }
  if (layerOf(spec) !== 'floor') return null;
  // The prop itself must stay off the use areas of the fixtures and the strips of the other props.
  for (let i = 0; i < g.props.length; i++) {
    if (i === skip) continue;
    const qs = propUseRect(g.props[i]!);
    if (qs && overlap(r, qs)) return { code: 'useAreaBlocked' };
  }
  const fixtures = useMask(g, -1, -1, false);
  for (let y = Math.floor(r.sy0 / SUB); y < Math.ceil(r.sy1 / SUB); y++) {
    for (let x = Math.floor(r.sx0 / SUB); x < Math.ceil(r.sx1 / SUB); x++) {
      const j = cellAt(g, x, y);
      if (j >= 0 && fixtures[j] === 1) return { code: 'useAreaBlocked' };
    }
  }
  return null;
}

/** planProp with the use area check (T85): the plan every prop placement goes through. */
export function planPropWithUse(g: TerminalGrid, p: Prop, skip = -1): PropPlan {
  const plan = planProp(g, p);
  if (plan.problem) return plan;
  const use = propUseProblem(g, p, skip);
  return use ? { problem: use, cost: 0 } : plan;
}
