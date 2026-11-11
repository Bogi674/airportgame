import { BUSINESS } from '@data/index';
import { FIXTURE_KEYS, TERMINAL_CELL_M, WALL, type TerminalGrid } from '@shared/business';
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
/**
 * Block offsets that sight edges may span, as flat (dx, dy) pairs: the block itself, its 8 neighbours and
 * the 8 knight moves.
 */
const SIGHT_OFFSETS = [
  0, 0, -1, -1, 0, -1, 1, -1, -1, 0, 1, 0, -1, 1, 0, 1, 1, 1,
  -1, -2, 1, -2, -1, 2, 1, 2, -2, -1, 2, -1, -2, 1, 2, 1,
];
/** Scratch for one block of at most L by L cells. Reused across blocks so no block allocates. */
const blockQueue = new Int32Array(L * L);
const blockDone = new Uint8Array(L * L);
/** Scratch for cellPath, grown on demand. Distances are -1 for unvisited cells and reset after each search. */
let pathQueue = new Int32Array(0);
let pathDist = new Int32Array(0);

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

/**
 * True when a person can walk in a straight line from array cell a to array cell b. The line is a supercover
 * walk between the cell centres, and every cell edge it crosses must be open to a person.
 */
export function lineOfSight(g: TerminalGrid, a: number, b: number): boolean {
  const W = g.w;
  const ax = a % W;
  const ay = (a - ax) / W;
  const bx = b % W;
  const by = (b - bx) / W;
  const dx = bx - ax;
  const dy = by - ay;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  const dirX = sx < 0 ? 0 : 1;
  const dirY = sy < 0 ? 2 : 3;
  let x = ax;
  let y = ay;
  let ix = 0;
  let iy = 0;
  while (ix < nx || iy < ny) {
    const p = (1 + 2 * ix) * ny;
    const q = (1 + 2 * iy) * nx;
    if (p === q) {
      // The line passes a corner, so both cells beside it must be open as well.
      if (!canStep(g, x, y, dirX) || !canStep(g, x + sx, y, dirY) || !canStep(g, x, y, dirY) || !canStep(g, x, y + sy, dirX)) return false;
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (p < q) {
      if (!canStep(g, x, y, dirX)) return false;
      x += sx;
      ix++;
    } else {
      if (!canStep(g, x, y, dirY)) return false;
      y += sy;
      iy++;
    }
  }
  return true;
}

/**
 * Walking length in metres from cell from to cell to, over the cells of the two lattice groups they belong
 * to. Returns Infinity when no such path exists.
 */
function cellPath(g: TerminalGrid, wg: WalkGraph, from: number, to: number): number {
  const W = g.w;
  const n = W * g.h;
  if (pathDist.length < n) {
    pathQueue = new Int32Array(n);
    pathDist = new Int32Array(n).fill(-1);
  }
  const m1 = wg.cellMain[from]!;
  const m2 = wg.cellMain[to]!;
  let head = 0;
  let tail = 0;
  pathQueue[tail++] = from;
  pathDist[from] = 0;
  let steps = -1;
  while (head < tail) {
    const c = pathQueue[head++]!;
    if (c === to) {
      steps = pathDist[c]!;
      break;
    }
    const x = c % W;
    const y = (c - x) / W;
    for (let d = 0; d < 4; d++) {
      if (!canStep(g, x, y, d)) continue;
      const nc = (y + DY[d]!) * W + x + DX[d]!;
      const mc = wg.cellMain[nc]!;
      if (pathDist[nc] !== -1 || (mc !== m1 && mc !== m2)) continue;
      pathDist[nc] = pathDist[c]! + 1;
      pathQueue[tail++] = nc;
    }
  }
  for (let i = 0; i < tail; i++) pathDist[pathQueue[i]!] = -1;
  return steps < 0 ? Infinity : steps * TERMINAL_CELL_M;
}

/** Array index of local cell k of block (bx, by), or -1 when that cell lies outside the grid. */
function blockCell(g: TerminalGrid, bx: number, by: number, k: number): number {
  const ax = bx * L - g.x0 + (k % L);
  const ay = by * L - g.y0 + Math.floor(k / L);
  return ax < 0 || ay < 0 || ax >= g.w || ay >= g.h ? -1 : ay * g.w + ax;
}

const blockXOf = (g: TerminalGrid, c: number): number => Math.floor(((c % g.w) + g.x0) / L);
const blockYOf = (g: TerminalGrid, c: number): number => Math.floor((Math.floor(c / g.w) + g.y0) / L);
const inRect = (bx: number, by: number, r: BlockRect): boolean => bx >= r.bx0 && bx <= r.bx1 && by >= r.by0 && by <= r.by1;

/**
 * Pushes the edges that touch the blocks of r as triples (cellA, cellB, lengthM) with cellA below cellB, each
 * pair once. Sight edges join nodes in nearby blocks, and the fallbacks join a node to its lattice node and
 * neighbouring lattice groups to each other, so the graph follows the same walks as canStep.
 */
function collectEdges(g: TerminalGrid, wg: WalkGraph, r: BlockRect, out: number[]): void {
  const W = g.w;
  const n = W * g.h;
  const seen = new Set<number>();
  // Sight edges: a node sees nodes in the same block and in the blocks at the sight offsets.
  for (let by = r.by0 - 2; by <= r.by1 + 2; by++) {
    for (let bx = r.bx0 - 2; bx <= r.bx1 + 2; bx++) {
      for (let k = 0; k < L * L; k++) {
        const a = blockCell(g, bx, by, k);
        if (a < 0 || wg.cellKind[a] === 0) continue;
        for (let o = 0; o < SIGHT_OFFSETS.length; o += 2) {
          const tx = bx + SIGHT_OFFSETS[o]!;
          const ty = by + SIGHT_OFFSETS[o + 1]!;
          if (!inRect(bx, by, r) && !inRect(tx, ty, r)) continue;
          for (let k2 = 0; k2 < L * L; k2++) {
            const b = blockCell(g, tx, ty, k2);
            if (b <= a || wg.cellKind[b] === 0) continue;
            const key = a * n + b;
            if (seen.has(key) || !lineOfSight(g, a, b)) continue;
            seen.add(key);
            const dx = (b % W) - (a % W);
            const dy = Math.floor(b / W) - Math.floor(a / W);
            out.push(a, b, TERMINAL_CELL_M * Math.sqrt(dx * dx + dy * dy));
          }
        }
      }
    }
  }
  // Extra node fallback: a node that is not its group's lattice node walks to that lattice node.
  for (let by = r.by0; by <= r.by1; by++) {
    for (let bx = r.bx0; bx <= r.bx1; bx++) {
      for (let k = 0; k < L * L; k++) {
        const x = blockCell(g, bx, by, k);
        if (x < 0 || wg.cellKind[x] === 0) continue;
        const m = wg.cellMain[x]!;
        if (m < 0 || m === x) continue;
        const lo = Math.min(x, m);
        const hi = Math.max(x, m);
        const key = lo * n + hi;
        if (seen.has(key)) continue;
        const len = cellPath(g, wg, x, m);
        if (!Number.isFinite(len)) continue;
        seen.add(key);
        out.push(lo, hi, len);
      }
    }
  }
  // Group fallback: two lattice groups that touch across an open edge are joined.
  for (let by = r.by0 - 1; by <= r.by1 + 1; by++) {
    for (let bx = r.bx0 - 1; bx <= r.bx1 + 1; bx++) {
      for (let k = 0; k < L * L; k++) {
        const c = blockCell(g, bx, by, k);
        if (c < 0 || g.floor[c]! <= 0) continue;
        const x = c % W;
        const y = (c - x) / W;
        for (let d = 1; d < 4; d += 2) {
          if (!canStep(g, x, y, d)) continue;
          const nc = d === 1 ? c + 1 : c + W;
          const m1 = wg.cellMain[c]!;
          const m2 = wg.cellMain[nc]!;
          if (m1 === m2) continue;
          if (!inRect(blockXOf(g, m1), blockYOf(g, m1), r) && !inRect(blockXOf(g, m2), blockYOf(g, m2), r)) continue;
          const lo = Math.min(m1, m2);
          const hi = Math.max(m1, m2);
          const key = lo * n + hi;
          if (seen.has(key)) continue;
          const len = cellPath(g, wg, m1, m2);
          if (!Number.isFinite(len)) continue;
          seen.add(key);
          out.push(lo, hi, len);
        }
      }
    }
  }
}

/** Writes the undirected triples as directed edges between node ids, sorted by from then to. */
function packEdges(wg: WalkGraph, triples: number[]): void {
  const pairs = triples.length / 3;
  const m = pairs * 2;
  const from = new Int32Array(m);
  const to = new Int32Array(m);
  const len = new Float32Array(m);
  for (let p = 0; p < pairs; p++) {
    const a = wg.cellNode[triples[3 * p]!]!;
    const b = wg.cellNode[triples[3 * p + 1]!]!;
    const l = triples[3 * p + 2]!;
    from[2 * p] = a;
    to[2 * p] = b;
    len[2 * p] = l;
    from[2 * p + 1] = b;
    to[2 * p + 1] = a;
    len[2 * p + 1] = l;
  }
  const order = Array.from({ length: m }, (_, i) => i);
  order.sort((i, j) => from[i]! - from[j]! || to[i]! - to[j]!);
  wg.edgeStart = new Int32Array(wg.nodeCount + 1);
  wg.edgeTo = new Int32Array(m);
  wg.edgeLen = new Float32Array(m);
  for (let e = 0; e < m; e++) wg.edgeStart[from[e]! + 1]! += 1;
  for (let i = 1; i <= wg.nodeCount; i++) wg.edgeStart[i]! += wg.edgeStart[i - 1]!;
  for (let k = 0; k < m; k++) {
    const e = order[k]!;
    wg.edgeTo[k] = to[e]!;
    wg.edgeLen[k] = len[e]!;
  }
}

/** Builds the walk nodes and the edges of one grid. */
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
  const triples: number[] = [];
  collectEdges(g, wg, rect, triples);
  packEdges(wg, triples);
  return wg;
}
