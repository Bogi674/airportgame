import type { Prop, TerminalGrid } from '@shared/business';
import { cellIndex, ensureCells, hEdgeIndex, vEdgeIndex } from '@shared/terminalOps';

/** Cell arrays an undo step restores. leased follows the tenant units, which keep their own state, so it is left out. */
const CELL_ARRAYS = ['floor', 'zone', 'fixture', 'fixtureRot', 'fixtureOff', 'fixtureLevel', 'fixtureMode', 'fixtureNo'] as const;
type CellArray = (typeof CELL_ARRAYS)[number];

/** A full copy of one terminal grid, the before or after state of an edit that made or removed the whole building. */
export type GridCopy = TerminalGrid;

/**
 * The cells, edges, cost and props one edit changed on a grid that existed before and after it. Cells and edges are
 * kept by logical coordinates, so the patch still applies after the grid grew. Values are interleaved per entry:
 * before then after for each array in CELL_ARRAYS order.
 */
export interface GridPatch {
  id: number;
  /** Logical x, y of each changed cell. */
  cells: number[];
  /** CELL_ARRAYS.length * 2 values per changed cell. */
  cellValues: number[];
  /** Logical x, y, before, after of each changed horizontal edge. */
  hEdges: number[];
  /** Logical x, y, before, after of each changed vertical edge. */
  vEdges: number[];
  costBefore: number;
  costAfter: number;
  propsBefore: Prop[];
  propsAfter: Prop[];
}

/** A deep copy of a grid with its own arrays and props. */
export function copyGrid(g: TerminalGrid): GridCopy {
  return {
    id: g.id,
    building: g.building,
    level: g.level,
    ox: g.ox,
    oy: g.oy,
    headingDeg: g.headingDeg,
    x0: g.x0,
    y0: g.y0,
    w: g.w,
    h: g.h,
    floor: g.floor.slice(),
    zone: g.zone.slice(),
    fixture: g.fixture.slice(),
    fixtureRot: g.fixtureRot.slice(),
    fixtureOff: g.fixtureOff.slice(),
    fixtureLevel: g.fixtureLevel.slice(),
    fixtureNo: g.fixtureNo.slice(),
    fixtureMode: g.fixtureMode.slice(),
    hWall: g.hWall.slice(),
    vWall: g.vWall.slice(),
    leased: g.leased.slice(),
    cost: g.cost,
    props: g.props.map((p) => ({ ...p })),
  };
}

const at = (g: TerminalGrid, name: CellArray, x: number, y: number): number => {
  const i = cellIndex(g, x, y);
  return i < 0 ? 0 : g[name][i]!;
};

const hAt = (g: TerminalGrid, x: number, y: number): number => {
  const i = hEdgeIndex(g, x, y);
  return i < 0 ? 0 : g.hWall[i]!;
};

const vAt = (g: TerminalGrid, x: number, y: number): number => {
  const i = vEdgeIndex(g, x, y);
  return i < 0 ? 0 : g.vWall[i]!;
};

const sameProps = (a: readonly Prop[], b: readonly Prop[]): boolean =>
  a.length === b.length && a.every((p, i) => p.asset === b[i]!.asset && p.x === b[i]!.x && p.y === b[i]!.y && p.rot === b[i]!.rot);

/**
 * The patch from a copy taken before an edit to the grid after it, or null when nothing changed. Cells outside a
 * grid read as empty, so growth shows up only where a cell gained content. Runs once per command, never per tick.
 */
export function diffGrid(before: GridCopy, after: TerminalGrid): GridPatch | null {
  const x0 = Math.min(before.x0, after.x0);
  const y0 = Math.min(before.y0, after.y0);
  const x1 = Math.max(before.x0 + before.w, after.x0 + after.w);
  const y1 = Math.max(before.y0 + before.h, after.y0 + after.h);
  const p: GridPatch = { id: after.id, cells: [], cellValues: [], hEdges: [], vEdges: [], costBefore: before.cost, costAfter: after.cost, propsBefore: before.props.map((q) => ({ ...q })), propsAfter: after.props.map((q) => ({ ...q })) };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < x1 && y < y1) {
        let changed = false;
        for (const name of CELL_ARRAYS) if (at(before, name, x, y) !== at(after, name, x, y)) changed = true;
        if (changed) {
          p.cells.push(x, y);
          for (const name of CELL_ARRAYS) p.cellValues.push(at(before, name, x, y), at(after, name, x, y));
        }
      }
      if (x < x1) {
        const a = hAt(before, x, y);
        const b = hAt(after, x, y);
        if (a !== b) p.hEdges.push(x, y, a, b);
      }
      if (y < y1) {
        const a = vAt(before, x, y);
        const b = vAt(after, x, y);
        if (a !== b) p.vEdges.push(x, y, a, b);
      }
    }
  }
  const empty = p.cells.length === 0 && p.hEdges.length === 0 && p.vEdges.length === 0;
  if (empty && p.costBefore === p.costAfter && sameProps(p.propsBefore, p.propsAfter)) return null;
  return p;
}

/**
 * Writes one side of a patch onto a grid: the before values to undo the edit, the after values to redo it. The grid
 * grows when a written cell lies outside it. Returns the logical bounds [x0, y0, x1, y1) the patch touched, or null.
 */
export function applyPatch(g: TerminalGrid, p: GridPatch, side: 'before' | 'after'): [number, number, number, number] | null {
  const k = side === 'before' ? 0 : 1;
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  const grow = (x: number, y: number): void => {
    bx0 = Math.min(bx0, x);
    by0 = Math.min(by0, y);
    bx1 = Math.max(bx1, x + 1);
    by1 = Math.max(by1, y + 1);
  };
  for (let i = 0; i < p.cells.length; i += 2) grow(p.cells[i]!, p.cells[i + 1]!);
  // An edge outside the grid grows it to cover the cell on its upper or left side, which makes the edge index valid.
  for (let i = 0; i < p.hEdges.length; i += 4) if (hEdgeIndex(g, p.hEdges[i]!, p.hEdges[i + 1]!) < 0) grow(p.hEdges[i]!, p.hEdges[i + 1]! - 1);
  for (let i = 0; i < p.vEdges.length; i += 4) if (vEdgeIndex(g, p.vEdges[i]!, p.vEdges[i + 1]!) < 0) grow(p.vEdges[i]! - 1, p.vEdges[i + 1]!);
  if (bx0 !== Infinity) ensureCells(g, bx0, by0, bx1, by1);
  const n = CELL_ARRAYS.length * 2;
  for (let i = 0, j = 0; i < p.cells.length; i += 2, j += n) {
    const c = cellIndex(g, p.cells[i]!, p.cells[i + 1]!);
    if (c < 0) continue;
    for (let a = 0; a < CELL_ARRAYS.length; a++) g[CELL_ARRAYS[a]!][c] = p.cellValues[j + a * 2 + k]!;
  }
  for (let i = 0; i < p.hEdges.length; i += 4) {
    const e = hEdgeIndex(g, p.hEdges[i]!, p.hEdges[i + 1]!);
    if (e >= 0) g.hWall[e] = p.hEdges[i + 2 + k]!;
  }
  for (let i = 0; i < p.vEdges.length; i += 4) {
    const e = vEdgeIndex(g, p.vEdges[i]!, p.vEdges[i + 1]!);
    if (e >= 0) g.vWall[e] = p.vEdges[i + 2 + k]!;
  }
  g.cost = side === 'before' ? p.costBefore : p.costAfter;
  g.props = (side === 'before' ? p.propsBefore : p.propsAfter).map((q) => ({ ...q }));
  return bx0 === Infinity ? null : [bx0, by0, bx1, by1];
}
