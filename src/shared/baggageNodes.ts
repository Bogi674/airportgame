/** Baggage network nodes: footprints from data and pure placement validation, docs/BAGGAGE.md. */

import { BAGGAGE } from '@data/index';
import { FIXTURE_ZONES, TERMINAL_CELL_M, WALL, ZONE, type FixtureKey, type TerminalGrid } from './business';
import { cellIndex, hEdgeIndex, vEdgeIndex } from './terminalOps';
import { labelRooms } from './terminalRooms';

export type BagKind = 'machine' | 'bay' | 'carousel';

export interface BagNodeSpec {
  kind: BagKind;
  /** Logical cell of local (0, 0). */
  cx: number;
  cy: number;
  rot: 0 | 1 | 2 | 3;
  /** Bay width in cells, or the carousel length in cells (its size), ignored for a machine. */
  widthCells: number;
}

type Cell = [number, number];

/** Logical step of local u (A) and local v (B) for each rotation. */
const AXES: readonly { a: Cell; b: Cell }[] = [
  { a: [1, 0], b: [0, 1] },
  { a: [0, 1], b: [-1, 0] },
  { a: [-1, 0], b: [0, -1] },
  { a: [0, -1], b: [1, 0] },
];

const KEYS: Record<BagKind, FixtureKey> = { machine: 'screeningMachine', bay: 'baggageBay', carousel: 'carousel' };

export const bagKey = (kind: BagKind): FixtureKey => KEYS[kind];

/** Carousel size of a length in cells (T78). A length the data does not list, as in saves before sizes, is the default size. */
export function carouselSize(widthCells: number): (typeof BAGGAGE.carousel.sizes)[number] {
  const sizes = BAGGAGE.carousel.sizes;
  return sizes.find((z) => z.w === widthCells) ?? sizes[BAGGAGE.carousel.defaultSize];
}

/** Price of one node in cash, from the baggage data: a bay by its width, a carousel by its size. */
export function bagNodeCost(kind: BagKind, widthCells: number): number {
  const c = BAGGAGE.costs;
  if (kind === 'machine') return c.machine;
  if (kind === 'carousel') return carouselSize(widthCells).cost;
  return c.bayPerCell * widthCells;
}

/** Footprint size in cells along u and v, or null for a bay width the data does not list. */
export function nodeSize(spec: BagNodeSpec): { w: number; d: number } | null {
  const F = BAGGAGE.footprints;
  if (spec.kind === 'machine') return { w: F.machine.w, d: F.machine.d };
  if (spec.kind === 'carousel') return { w: carouselSize(spec.widthCells).w, d: F.carousel.d };
  return F.bay.widths.includes(spec.widthCells) ? { w: spec.widthCells, d: F.bay.d } : null;
}

const toLogical = (spec: BagNodeSpec, u: number, v: number): Cell => {
  const { a, b } = AXES[spec.rot];
  return [spec.cx + u * a[0] + v * b[0], spec.cy + u * a[1] + v * b[1]];
};

/** Logical cells of the footprint, row major over v then u. */
export function nodeCells(spec: BagNodeSpec): Cell[] {
  const size = nodeSize(spec);
  if (!size) return [];
  const out: Cell[] = [];
  for (let v = 0; v < size.d; v++) for (let u = 0; u < size.w; u++) out.push(toLogical(spec, u, v));
  return out;
}

/** Logical cell of the input or output ramp, or null when the kind has none (a carousel has no output). */
export function rampCell(spec: BagNodeSpec, dir: 'in' | 'out'): Cell | null {
  const F = BAGGAGE.footprints;
  const size = nodeSize(spec);
  if (!size) return null;
  if (spec.kind === 'machine') {
    const c = dir === 'in' ? F.machine.in : F.machine.out;
    return toLogical(spec, c[0], c[1]);
  }
  if (spec.kind === 'bay') return dir === 'in' ? toLogical(spec, F.bay.in[0], F.bay.in[1]) : toLogical(spec, size.w - 1 - F.bay.outFromRight, 0);
  return dir === 'in' ? toLogical(spec, F.carousel.in[0], F.carousel.in[1]) : null;
}

/** Cell where a drop point sends bags: local (0, -1) of the anchor in the frame of its rotation. */
export function dropOutCell(anchorX: number, anchorY: number, rot: 0 | 1 | 2 | 3): Cell {
  return toLogical({ kind: 'machine', cx: anchorX, cy: anchorY, rot, widthCells: 0 }, 0, -1);
}

/** The truck side of a bay: the cells of row v = d - 1 and the outward step B. */
export function truckEdge(spec: BagNodeSpec): { cells: Cell[]; out: Cell } {
  const size = nodeSize(spec);
  const cells: Cell[] = [];
  if (size) for (let u = 0; u < size.w; u++) cells.push(toLogical(spec, u, size.d - 1));
  return { cells, out: AXES[spec.rot].b };
}

/** One baggage node as the painter draws it. Drops sit on their anchor cell, the others on their footprint origin. */
export interface BagDrawNode {
  building: number;
  kind: 'drop' | 'machine' | 'bay' | 'carousel';
  cx: number;
  cy: number;
  rot: 0 | 1 | 2 | 3;
  widthCells: number;
  /** For a drop: true when a screening machine is linked to it. Always false for the other kinds. */
  linked: boolean;
}

/** Footprint size in cells along u and v, null for a drop (it has no footprint of its own) or an unlisted bay width. */
export function drawFootprint(n: BagDrawNode): { w: number; d: number } | null {
  if (n.kind === 'drop') return null;
  return nodeSize({ kind: n.kind, cx: n.cx, cy: n.cy, rot: n.rot, widthCells: n.widthCells });
}

/**
 * Logical position in cells (fractions allowed) of the point at local cell edge coordinates (u, v), where
 * (0, 0) is the outer corner of the origin cell in the node's own frame.
 */
export function drawPoint(n: BagDrawNode, u: number, v: number): Cell {
  const { a, b } = AXES[n.rot];
  const du = u - 0.5;
  const dv = v - 0.5;
  return [n.cx + 0.5 + du * a[0] + dv * b[0], n.cy + 0.5 + du * a[1] + dv * b[1]];
}

/** Center of the footprint in logical cells, or null for a drop or an unlisted width. */
export function drawCenter(n: BagDrawNode): Cell | null {
  const size = drawFootprint(n);
  return size ? drawPoint(n, size.w / 2, size.d / 2) : null;
}

/** Center in logical cells of the out ramp cell of a drop. */
export function dropRampCenter(n: BagDrawNode): Cell {
  const [x, y] = dropOutCell(n.cx, n.cy, n.rot);
  return [x + 0.5, y + 0.5];
}

/** Centers in logical cells of the staging lanes of a bay, one per truck slot, outside the truck edge (docs/BAGGAGE.md 3.4). */
export function stagingLaneCenters(n: BagDrawNode): Cell[] {
  const size = drawFootprint(n);
  if (n.kind !== 'bay' || !size) return [];
  const slotCells = BAGGAGE.bay.slotWidthM / TERMINAL_CELL_M;
  const laneCells = BAGGAGE.bay.stagingLaneM / TERMINAL_CELL_M;
  const out: Cell[] = [];
  for (let k = 0; k < Math.floor(size.w / slotCells); k++) out.push(drawPoint(n, slotCells * k + slotCells / 2, size.d + laneCells / 2));
  return out;
}

/** Wall value on the edge between two orthogonally adjacent logical cells, or -1 outside the edge arrays. */
function edgeBetween(g: TerminalGrid, x: number, y: number, dx: number, dy: number): number {
  if (dx !== 0) {
    const i = vEdgeIndex(g, dx > 0 ? x + 1 : x, y);
    return i < 0 ? -1 : g.vWall[i];
  }
  const i = hEdgeIndex(g, x, dy > 0 ? y + 1 : y);
  return i < 0 ? -1 : g.hWall[i];
}

/** The first problem code that stops a node from standing on the grid, or null when it fits. */
export function validateBagNode(g: TerminalGrid, spec: BagNodeSpec): string | null {
  if (!nodeSize(spec)) return 'bagBadWidth';
  const cells = nodeCells(spec);
  const allowed = FIXTURE_ZONES[bagKey(spec.kind)];
  for (const [x, y] of cells) {
    const i = cellIndex(g, x, y);
    if (i < 0 || g.floor[i] === 0) return 'bagOffFloor';
  }
  for (const [x, y] of cells) if (g.fixture[cellIndex(g, x, y)] !== 0) return 'bagCellTaken';
  for (const [x, y] of cells) {
    const z = g.zone[cellIndex(g, x, y)];
    if (z !== 0 && !allowed.includes(z)) return 'bagWrongZone';
  }
  const inside = new Set(cells.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of cells) {
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      if (!inside.has(`${x + dx},${y + dy}`)) continue;
      if (edgeBetween(g, x, y, dx, dy) !== WALL.None) return 'bagWallInside';
    }
  }
  if (spec.kind === 'bay') {
    const { cells: edge, out } = truckEdge(spec);
    for (const [x, y] of edge) {
      const n = cellIndex(g, x + out[0], y + out[1]);
      if (n >= 0 && g.floor[n] > 0) return 'bayNoExteriorWall';
      if (edgeBetween(g, x, y, out[0], out[1]) === WALL.None) return 'bayNoExteriorWall';
    }
  }
  return null;
}

/**
 * True when the machine stands in one closed staff room that is big enough and has a door,
 * so officers can reach it without crossing public floor.
 */
export function screeningRoomOk(g: TerminalGrid, spec: BagNodeSpec): boolean {
  const cells = nodeCells(spec);
  if (cells.length === 0) return false;
  const label = labelRooms(g);
  const first = cellIndex(g, cells[0][0], cells[0][1]);
  if (first < 0) return false;
  const room = label[first];
  if (room < 0) return false;
  for (const [x, y] of cells) {
    const i = cellIndex(g, x, y);
    if (i < 0 || label[i] !== room) return false;
  }
  let count = 0;
  let door = false;
  for (let i = 0; i < label.length; i++) {
    if (label[i] !== room) continue;
    if (g.zone[i] !== ZONE.Staff) return false;
    count++;
    const x = g.x0 + (i % g.w);
    const y = g.y0 + Math.floor(i / g.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (edgeBetween(g, x, y, dx, dy) === WALL.Door) door = true;
    }
  }
  return count * TERMINAL_CELL_M * TERMINAL_CELL_M >= BAGGAGE.screeningRoom.minAreaM2 && door;
}
