import { BUSINESS } from '@data/index';
import { FIXTURE_KEYS, WALL, type TerminalGrid } from '@shared/business';
import { canStep, labelRooms } from '@shared/terminalRooms';

/** Kinds of walk node. A node is a cell that walking routes must know about. */
export const WALK_NODE = { Lattice: 1, Door: 2, Fixture: 3 } as const;

/** Side of a block in logical cells. */
const L = BUSINESS.terminal.walk.latticeCells;
const SEATING = FIXTURE_KEYS.indexOf('seating') + 1;
/** A fixtureRot below this marks the anchor of a fixture, see TerminalGrid. */
const TAIL_ROT = 5;
/** Local offset of the lattice centre inside its block, the logical cell 1 of each block. */
const CENTRE = 1;
const DX = [-1, 1, 0, 0];
const DY = [0, 0, -1, 1];
/** Scratch for one block of at most L by L cells. Reused across blocks so no block allocates. */
const blockQueue = new Int32Array(L * L);
const blockDone = new Uint8Array(L * L);

/** Inclusive range of blocks in logical block coordinates. */
export interface BlockRect {
  bx0: number;
  by0: number;
  bx1: number;
  by1: number;
}

export interface WalkGraph {
  /** Id of the grid this graph was built from. */
  grid: number;
  /** Logical cell of array cell (0, 0), copied from the grid. */
  x0: number;
  y0: number;
  /** Array size in cells, copied from the grid. */
  w: number;
  h: number;
  /** Per array cell: 0 for no node, otherwise a WALK_NODE kind. */
  cellKind: Uint8Array;
  /** Per array cell: array index of the lattice node of the cell's group, -1 without floor. */
  cellMain: Int32Array;
  /** Per array cell: compact node id, -1 when the cell is not a node. */
  cellNode: Int32Array;
  nodeCount: number;
  /** Per node: array index of its cell. Ascending. */
  nodeCell: Int32Array;
  /** Per node: logical cell x. */
  nodeX: Int16Array;
  /** Per node: logical cell y. */
  nodeY: Int16Array;
  /** Per node: a WALK_NODE kind. */
  nodeKind: Uint8Array;
  /** Per node: room id of its cell from labelRooms, -1 without floor. */
  nodeRoom: Int32Array;
  /** Per node: first index into edgeTo and edgeLen, with one extra entry at the end. */
  edgeStart: Int32Array;
  /** Per edge: target node id. */
  edgeTo: Int32Array;
  /** Per edge: walking length in metres. */
  edgeLen: Float32Array;
}

/** Collects the floor cells of the block that start at (ax0, ay0) and connect to the start in blockQueue. */
function floodGroup(g: TerminalGrid, ax0: number, ay0: number, start: number): number {
  let head = 0;
  let tail = 0;
  blockQueue[tail++] = start;
  blockDone[start] = 1;
  while (head < tail) {
    const q = blockQueue[head++]!;
    const qx = ax0 + (q % L);
    const qy = ay0 + Math.floor(q / L);
    for (let d = 0; d < 4; d++) {
      if (!canStep(g, qx, qy, d)) continue;
      const lx = qx + DX[d]! - ax0;
      const ly = qy + DY[d]! - ay0;
      if (lx < 0 || ly < 0 || lx >= L || ly >= L) continue;
      const k = ly * L + lx;
      if (blockDone[k] === 1) continue;
      blockDone[k] = 1;
      blockQueue[tail++] = k;
    }
  }
  return tail;
}

/** True when the edge on any side of floor cell (ax, ay) is a door with floor on its far side. */
function doorBeside(g: TerminalGrid, ax: number, ay: number): boolean {
  const W = g.w;
  if (ax > 0 && g.vWall[ay * (W + 1) + ax] === WALL.Door && g.floor[ay * W + ax - 1]! > 0) return true;
  if (ax < W - 1 && g.vWall[ay * (W + 1) + ax + 1] === WALL.Door && g.floor[ay * W + ax + 1]! > 0) return true;
  if (ay > 0 && g.hWall[ay * W + ax] === WALL.Door && g.floor[(ay - 1) * W + ax]! > 0) return true;
  return ay < g.h - 1 && g.hWall[(ay + 1) * W + ax] === WALL.Door && g.floor[(ay + 1) * W + ax]! > 0;
}

/** Marks the nodes of one block. Its cells are the array cells whose logical block is (bx, by). */
function fillBlock(g: TerminalGrid, wg: WalkGraph, bx: number, by: number): void {
  const W = g.w;
  const ax0 = bx * L - g.x0;
  const ay0 = by * L - g.y0;
  for (let ly = 0; ly < L; ly++) {
    const ay = ay0 + ly;
    if (ay < 0 || ay >= g.h) continue;
    for (let lx = 0; lx < L; lx++) {
      const ax = ax0 + lx;
      if (ax < 0 || ax >= W) continue;
      wg.cellKind[ay * W + ax] = 0;
      wg.cellMain[ay * W + ax] = -1;
    }
  }
  blockDone.fill(0);
  // Local index order is array index order inside a block, so each group starts at its first cell.
  for (let k = 0; k < L * L; k++) {
    const ax = ax0 + (k % L);
    const ay = ay0 + Math.floor(k / L);
    if (ax < 0 || ay < 0 || ax >= W || ay >= g.h) continue;
    if (g.floor[ay * W + ax]! <= 0 || blockDone[k] === 1) continue;
    const tail = floodGroup(g, ax0, ay0, k);
    const centreK = CENTRE * L + CENTRE;
    let main = (ay0 + Math.floor(k / L)) * W + ax0 + (k % L);
    for (let i = 0; i < tail; i++) {
      if (blockQueue[i] === centreK) {
        main = (ay0 + CENTRE) * W + ax0 + CENTRE;
        break;
      }
    }
    for (let i = 0; i < tail; i++) {
      const q = blockQueue[i]!;
      wg.cellMain[(ay0 + Math.floor(q / L)) * W + ax0 + (q % L)] = main;
    }
    wg.cellKind[main] = WALK_NODE.Lattice;
  }
  for (let k = 0; k < L * L; k++) {
    const ax = ax0 + (k % L);
    const ay = ay0 + Math.floor(k / L);
    if (ax < 0 || ay < 0 || ax >= W || ay >= g.h) continue;
    const c = ay * W + ax;
    if (g.floor[c]! <= 0) continue;
    const fixture = g.fixture[c]!;
    if (fixture > 0 && fixture !== SEATING && g.fixtureRot[c]! < TAIL_ROT) wg.cellKind[c] = WALK_NODE.Fixture;
    else if (wg.cellKind[c] === 0 && doorBeside(g, ax, ay)) wg.cellKind[c] = WALK_NODE.Door;
  }
}

/**
 * Marks the walk nodes of every block in r. A block is an L by L square of logical cells. Floor cells that
 * connect inside their block form one group that shares a lattice node, placed on the block centre when
 * the group holds it. Fixture anchors and cells beside a door are nodes of their own.
 */
function fillNodes(g: TerminalGrid, wg: WalkGraph, r: BlockRect): void {
  for (let by = r.by0; by <= r.by1; by++) {
    for (let bx = r.bx0; bx <= r.bx1; bx++) fillBlock(g, wg, bx, by);
  }
}

/** Gives every node a compact id in index order and fills the per node arrays. */
function compactNodes(g: TerminalGrid, wg: WalkGraph): void {
  const n = g.w * g.h;
  const rooms = labelRooms(g);
  let count = 0;
  for (let c = 0; c < n; c++) if (wg.cellKind[c]! > 0) count++;
  wg.nodeCount = count;
  wg.nodeCell = new Int32Array(count);
  wg.nodeX = new Int16Array(count);
  wg.nodeY = new Int16Array(count);
  wg.nodeKind = new Uint8Array(count);
  wg.nodeRoom = new Int32Array(count);
  let id = 0;
  for (let c = 0; c < n; c++) {
    if (wg.cellKind[c] === 0) {
      wg.cellNode[c] = -1;
      continue;
    }
    const ax = c % g.w;
    const ay = (c - ax) / g.w;
    wg.cellNode[c] = id;
    wg.nodeCell[id] = c;
    wg.nodeX[id] = ax + g.x0;
    wg.nodeY[id] = ay + g.y0;
    wg.nodeKind[id] = wg.cellKind[c]!;
    wg.nodeRoom[id] = rooms[c]!;
    id++;
  }
}

/** Builds the walk nodes of one grid. Edges are not built here yet, so the edge arrays are empty. */
export function buildWalkGraph(g: TerminalGrid): WalkGraph {
  const n = g.w * g.h;
  const wg: WalkGraph = {
    grid: g.id,
    x0: g.x0,
    y0: g.y0,
    w: g.w,
    h: g.h,
    cellKind: new Uint8Array(n),
    cellMain: new Int32Array(n).fill(-1),
    cellNode: new Int32Array(n).fill(-1),
    nodeCount: 0,
    nodeCell: new Int32Array(0),
    nodeX: new Int16Array(0),
    nodeY: new Int16Array(0),
    nodeKind: new Uint8Array(0),
    nodeRoom: new Int32Array(0),
    edgeStart: new Int32Array(1),
    edgeTo: new Int32Array(0),
    edgeLen: new Float32Array(0),
  };
  const rect: BlockRect = {
    bx0: Math.floor(g.x0 / L),
    by0: Math.floor(g.y0 / L),
    bx1: Math.floor((g.x0 + g.w - 1) / L),
    by1: Math.floor((g.y0 + g.h - 1) / L),
  };
  fillNodes(g, wg, rect);
  compactNodes(g, wg);
  wg.edgeStart = new Int32Array(wg.nodeCount + 1);
  return wg;
}
