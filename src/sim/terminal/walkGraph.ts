import { BUSINESS } from '@data/index';
import { FIXTURE_KEYS, TERMINAL_CELL_M, WALL, type TerminalGrid } from '@shared/business';
import { labelRooms } from '@shared/terminalRooms';
import { effectiveZones, stepAud, walkBlockMask, zoneAccess, type ZoneAccess } from '@shared/terminalZones';
import { travelatorLanes, type TravelatorLane } from '@shared/travelator';
import { newWalkCache, type WalkCache } from './walkDistance';

/** Kinds of walk node. A node is a cell that walking routes must know about. */
/** Ride is the floor cell at either end of a travelator belt (T77). */
export const WALK_NODE = { Lattice: 1, Door: 2, Fixture: 3, Gate: 4, Ride: 5 } as const;

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
/** Scratch for pathPoint: the cell each visited cell was reached from. */
let pathFrom = new Int32Array(0);

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
  /** Per edge: the audiences that may take it, AUD bits. The graph is directed, so an edge and its reverse can differ. */
  edgeMask: Uint8Array;
  /** Who may cross each cell edge of the grid, kept from the last rebuild. Never recomputed per tick. */
  access: ZoneAccess;
  /** 1 on floor cells that props block (T76) or a travelator covers (T77): no node and no walking there. From the last rebuild. */
  blocked: Uint8Array;
  /** Travelator belts from the last rebuild (T77), each a ride edge both ways between its two end cells. */
  lanes: TravelatorLane[];
  /** Per array cell, 1 on the end cell of a travelator belt, which is always a node. From the last rebuild. */
  rideEnd: Uint8Array;
  /** Effective zone per array cell from the last rebuild, 0 without floor. Read by the curb and the queue cells. */
  effective: Uint8Array;
  /** Cached walking distance rows for passengers over the edges above, see walkDistance. */
  cache: WalkCache;
  /** The same for staff, over the edges staff may take. */
  staffCache: WalkCache;
}

/** True when everyone may cross the edge from array cell (x, y) in direction d, both ways. */
function full(acc: ZoneAccess, g: TerminalGrid, x: number, y: number, d: number): boolean {
  if (stepAud(acc, g, x, y, d) !== 3) return false;
  return stepAud(acc, g, x + DX[d]!, y + DY[d]!, d ^ 1) === 3;
}

/** True when an edge lets some audience or direction through but not all of them. */
const restricted = (ab: number, ba: number): boolean => ab + ba > 0 && !(ab === 3 && ba === 3);

/** True when any edge of array cell (ax, ay) is restricted, so the cell is a gate node. */
function gateBeside(acc: ZoneAccess, g: TerminalGrid, ax: number, ay: number): boolean {
  for (let d = 0; d < 4; d++) {
    if (restricted(stepAud(acc, g, ax, ay, d), stepAud(acc, g, ax + DX[d]!, ay + DY[d]!, d ^ 1))) return true;
  }
  return false;
}

/** Collects the floor cells of the block that start at (ax0, ay0) and connect to the start in blockQueue. */
function floodGroup(g: TerminalGrid, acc: ZoneAccess, ax0: number, ay0: number, start: number): number {
  let head = 0;
  let tail = 0;
  blockQueue[tail++] = start;
  blockDone[start] = 1;
  while (head < tail) {
    const q = blockQueue[head++]!;
    const qx = ax0 + (q % L);
    const qy = ay0 + Math.floor(q / L);
    for (let d = 0; d < 4; d++) {
      if (!full(acc, g, qx, qy, d)) continue;
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

/** True when the edge on any side of floor cell (ax, ay) is a door, including an outer door with bare ground beyond. */
function doorBeside(g: TerminalGrid, ax: number, ay: number): boolean {
  const W = g.w;
  return (
    g.vWall[ay * (W + 1) + ax] === WALL.Door ||
    g.vWall[ay * (W + 1) + ax + 1] === WALL.Door ||
    g.hWall[ay * W + ax] === WALL.Door ||
    g.hWall[(ay + 1) * W + ax] === WALL.Door
  );
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
    if (g.floor[ay * W + ax]! <= 0 || wg.blocked[ay * W + ax] === 1 || blockDone[k] === 1) continue;
    const tail = floodGroup(g, wg.access, ax0, ay0, k);
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
    if (g.floor[c]! <= 0 || wg.blocked[c] === 1) continue;
    const fixture = g.fixture[c]!;
    if (fixture > 0 && fixture !== SEATING && g.fixtureRot[c]! < TAIL_ROT) wg.cellKind[c] = WALK_NODE.Fixture;
    // A door cell that is also its group's lattice node must still read as a door, or the terminal loses its curb.
    else if ((wg.cellKind[c] === 0 || wg.cellKind[c] === WALK_NODE.Lattice) && doorBeside(g, ax, ay)) wg.cellKind[c] = WALK_NODE.Door;
    else if (wg.cellKind[c] === 0 && wg.rideEnd[c] === 1) wg.cellKind[c] = WALK_NODE.Ride;
    else if (wg.cellKind[c] !== WALK_NODE.Door && gateBeside(wg.access, g, ax, ay)) wg.cellKind[c] = WALK_NODE.Gate;
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
 * walk between the cell centres, and every cell edge it crosses must be open to everyone both ways.
 */
export function lineOfSight(g: TerminalGrid, a: number, b: number, acc: ZoneAccess = zoneAccess(g)): boolean {
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
      if (!full(acc, g, x, y, dirX) || !full(acc, g, x + sx, y, dirY) || !full(acc, g, x, y, dirY) || !full(acc, g, x, y + sy, dirX)) return false;
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (p < q) {
      if (!full(acc, g, x, y, dirX)) return false;
      x += sx;
      ix++;
    } else {
      if (!full(acc, g, x, y, dirY)) return false;
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
      if (!full(wg.access, g, x, y, d)) continue;
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

/**
 * Point d metres along the walk from array cell a to array cell b over the floor cells of their two lattice groups,
 * for an edge between them that has no straight line of sight, so a figure walks around the wall instead of through
 * it. Writes the point in logical cell units (cell centre) to out[0] and out[1] and the cell step in use to out[2] and
 * out[3]. Returns false when the two cells see each other or no such path exists, and the caller walks straight.
 * Searches at most the cells of two groups, so it stays small. Allocates only when the grid grew.
 */
export function pathPoint(g: TerminalGrid, wg: WalkGraph, a: number, b: number, d: number, out: Float64Array): boolean {
  if (lineOfSight(g, a, b, wg.access)) return false;
  const W = g.w;
  const n = W * g.h;
  if (pathDist.length < n) {
    pathQueue = new Int32Array(n);
    pathDist = new Int32Array(n).fill(-1);
  }
  if (pathFrom.length < n) pathFrom = new Int32Array(n);
  const m1 = wg.cellMain[a]!;
  const m2 = wg.cellMain[b]!;
  let head = 0;
  let tail = 0;
  pathQueue[tail++] = a;
  pathDist[a] = 0;
  pathFrom[a] = -1;
  let found = false;
  while (head < tail) {
    const c = pathQueue[head++]!;
    if (c === b) {
      found = true;
      break;
    }
    const x = c % W;
    const y = (c - x) / W;
    for (let k = 0; k < 4; k++) {
      if (!full(wg.access, g, x, y, k)) continue;
      const nc = (y + DY[k]!) * W + x + DX[k]!;
      const mc = wg.cellMain[nc]!;
      if (pathDist[nc] !== -1 || (mc !== m1 && mc !== m2)) continue;
      pathDist[nc] = pathDist[c]! + 1;
      pathFrom[nc] = c;
      pathQueue[tail++] = nc;
    }
  }
  if (found) {
    // Walk back from b to the cell at step floor(d / cell), then blend toward the next cell on the way to b.
    const steps = pathDist[b]!;
    const at = Math.min(Math.max(d / TERMINAL_CELL_M, 0), steps);
    const i = Math.min(Math.floor(at), steps - 1);
    let next = b;
    for (let k = steps; k > i + 1; k--) next = pathFrom[next]!;
    const here = pathFrom[next]!;
    const hx = here % W;
    const hy = (here - hx) / W;
    const ex = (next % W) - hx;
    const ey = Math.floor(next / W) - hy;
    const f = at - i;
    out[0] = hx + ex * f + g.x0 + 0.5;
    out[1] = hy + ey * f + g.y0 + 0.5;
    out[2] = ex;
    out[3] = ey;
  }
  for (let k = 0; k < tail; k++) pathDist[pathQueue[k]!] = -1;
  return found;
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

/** Block range that covers every cell of the grid. */
function gridRect(g: TerminalGrid): BlockRect {
  return {
    bx0: Math.floor(g.x0 / L),
    by0: Math.floor(g.y0 / L),
    bx1: Math.floor((g.x0 + g.w - 1) / L),
    by1: Math.floor((g.y0 + g.h - 1) / L),
  };
}

/** True when array cell c of the graph lies in a block of r. */
function cellInRect(wg: WalkGraph, c: number, r: BlockRect): boolean {
  const ax = c % wg.w;
  const ay = (c - ax) / wg.w;
  return inRect(Math.floor((ax + wg.x0) / L), Math.floor((ay + wg.y0) / L), r);
}

/**
 * Pushes the edges of the old graph whose two cells both lie outside the blocks of r, as tuples over cells.
 * Must run before the nodes are refilled, because it reads the old node cells.
 */
function keptEdges(wg: WalkGraph, r: BlockRect, out: number[]): void {
  for (let a = 0; a < wg.nodeCount; a++) {
    const ca = wg.nodeCell[a]!;
    if (cellInRect(wg, ca, r)) continue;
    for (let e = wg.edgeStart[a]!; e < wg.edgeStart[a + 1]!; e++) {
      const b = wg.edgeTo[e]!;
      if (b <= a) continue;
      const cb = wg.nodeCell[b]!;
      if (cellInRect(wg, cb, r)) continue;
      let back = 0;
      for (let r2 = wg.edgeStart[b]!; r2 < wg.edgeStart[b + 1]!; r2++) {
        if (wg.edgeTo[r2] === a) {
          back = wg.edgeMask[r2]!;
          break;
        }
      }
      out.push(ca, cb, wg.edgeLen[e]!, wg.edgeMask[e]!, back);
    }
  }
}

/**
 * Pushes the edges that touch the blocks of r as tuples (cellA, cellB, lengthM, audiences A to B, audiences B to A)
 * with cellA below cellB, each pair once. Open edges carry everyone both ways. Sight edges join nodes in nearby blocks, and the fallbacks join a node to its lattice node and
 * neighbouring lattice groups to each other, so the graph follows the walks the zone access table allows.
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
            if (seen.has(key) || !lineOfSight(g, a, b, wg.access)) continue;
            seen.add(key);
            const dx = (b % W) - (a % W);
            const dy = Math.floor(b / W) - Math.floor(a / W);
            out.push(a, b, TERMINAL_CELL_M * Math.sqrt(dx * dx + dy * dy), 3, 3);
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
        out.push(lo, hi, len, 3, 3);
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
          if (!full(wg.access, g, x, y, d)) continue;
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
          out.push(lo, hi, len, 3, 3);
        }
      }
    }
  }
  // Ride edges: a travelator belt joins its two end cells both ways, with the shorter length of the faster walk (T77).
  for (const l of wg.lanes) {
    if (wg.cellNode[l.a]! < 0 || wg.cellNode[l.b]! < 0) continue;
    if (!cellInRect(wg, l.a, r) && !cellInRect(wg, l.b, r)) continue;
    out.push(l.a, l.b, l.lenM, 3, 3);
  }
  // Restricted edges: a staff door or a transition joins its two gate cells one way or for some audiences only.
  for (let by = r.by0 - 1; by <= r.by1 + 1; by++) {
    for (let bx = r.bx0 - 1; bx <= r.bx1 + 1; bx++) {
      for (let k = 0; k < L * L; k++) {
        const c = blockCell(g, bx, by, k);
        if (c < 0 || g.floor[c]! <= 0) continue;
        const x = c % W;
        const y = (c - x) / W;
        for (let d = 1; d < 4; d += 2) {
          const nc = d === 1 ? c + 1 : c + W;
          if (d === 1 ? x >= W - 1 : y >= g.h - 1) continue;
          if (!inRect(bx, by, r) && !inRect(blockXOf(g, nc), blockYOf(g, nc), r)) continue;
          const ab = stepAud(wg.access, g, x, y, d);
          const ba = stepAud(wg.access, g, x + DX[d]!, y + DY[d]!, d ^ 1);
          if (!restricted(ab, ba) || wg.cellNode[c]! < 0 || wg.cellNode[nc]! < 0) continue;
          out.push(c, nc, TERMINAL_CELL_M, ab, ba);
        }
      }
    }
  }
}

/** Writes the tuples as directed edges between node ids, sorted by from then to. */
function packEdges(wg: WalkGraph, tuples: number[]): void {
  const pairs = tuples.length / 5;
  const m = pairs * 2;
  const n = wg.nodeCount;
  wg.edgeStart = new Int32Array(n + 1);
  wg.edgeTo = new Int32Array(m);
  wg.edgeLen = new Float32Array(m);
  wg.edgeMask = new Uint8Array(m);
  // Counting sort by from node: count each node's degree, prefix sum, then place each edge at its node's cursor.
  const start = wg.edgeStart;
  for (let p = 0; p < pairs; p++) {
    start[wg.cellNode[tuples[5 * p]!]! + 1]! += 1;
    start[wg.cellNode[tuples[5 * p + 1]!]! + 1]! += 1;
  }
  for (let i = 1; i <= n; i++) start[i]! += start[i - 1]!;
  const cursor = start.slice(0, n);
  for (let p = 0; p < pairs; p++) {
    const a = wg.cellNode[tuples[5 * p]!]!;
    const b = wg.cellNode[tuples[5 * p + 1]!]!;
    const l = tuples[5 * p + 2]!;
    wg.edgeTo[cursor[a]!] = b;
    wg.edgeLen[cursor[a]!] = l;
    wg.edgeMask[cursor[a]!] = tuples[5 * p + 3]!;
    cursor[a]! += 1;
    wg.edgeTo[cursor[b]!] = a;
    wg.edgeLen[cursor[b]!] = l;
    wg.edgeMask[cursor[b]!] = tuples[5 * p + 4]!;
    cursor[b]! += 1;
  }
  // Each node's range is short, so an insertion sort by target id, moving the lengths with it, is cheapest.
  for (let a = 0; a < n; a++) {
    for (let e = start[a]! + 1; e < start[a + 1]!; e++) {
      const to = wg.edgeTo[e]!;
      const len = wg.edgeLen[e]!;
      const mask = wg.edgeMask[e]!;
      let k = e;
      while (k > start[a]! && wg.edgeTo[k - 1]! > to) {
        wg.edgeTo[k] = wg.edgeTo[k - 1]!;
        wg.edgeLen[k] = wg.edgeLen[k - 1]!;
        wg.edgeMask[k] = wg.edgeMask[k - 1]!;
        k--;
      }
      wg.edgeTo[k] = to;
      wg.edgeLen[k] = len;
      wg.edgeMask[k] = mask;
    }
  }
}

/** Empties every cached row and source in place, for a graph whose node count did not change. */
function resetCache(c: WalkCache): void {
  c.rowSource.fill(-1);
  c.sourceRow.fill(-1);
  c.clock = 0;
}

/** Reads the travelator belts of the grid and marks their end cells. */
function setLanes(g: TerminalGrid, wg: WalkGraph): void {
  wg.lanes = travelatorLanes(g, wg.effective);
  wg.rideEnd.fill(0);
  for (const l of wg.lanes) {
    wg.rideEnd[l.a] = 1;
    wg.rideEnd[l.b] = 1;
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
    edgeMask: new Uint8Array(0),
    access: zoneAccess(g),
    blocked: walkBlockMask(g),
    lanes: [],
    rideEnd: new Uint8Array(n),
    effective: effectiveZones(g),
    cache: newWalkCache(0),
    staffCache: newWalkCache(0),
  };
  setLanes(g, wg);
  const rect = gridRect(g);
  fillNodes(g, wg, rect);
  compactNodes(g, wg);
  const tuples: number[] = [];
  collectEdges(g, wg, rect, tuples);
  packEdges(wg, tuples);
  wg.cache = newWalkCache(wg.nodeCount);
  wg.staffCache = newWalkCache(wg.nodeCount);
  return wg;
}

/** Grows box, in logical cells, to cover both cells of every edge whose access differs between the two tables. */
function widenToChanges(g: TerminalGrid, before: ZoneAccess, after: ZoneAccess, box: { x0: number; y0: number; x1: number; y1: number }): void {
  const W = g.w;
  const cover = (x: number, y: number): void => {
    box.x0 = Math.min(box.x0, x + g.x0);
    box.y0 = Math.min(box.y0, y + g.y0);
    box.x1 = Math.max(box.x1, x + g.x0);
    box.y1 = Math.max(box.y1, y + g.y0);
  };
  for (let e = 0; e < after.h.length; e++) {
    if (before.h[e] === after.h[e]) continue;
    const x = e % W;
    const y = (e - x) / W;
    cover(x, y);
    cover(x, Math.max(0, y - 1));
  }
  for (let e = 0; e < after.v.length; e++) {
    if (before.v[e] === after.v[e]) continue;
    const x = e % (W + 1);
    const y = (e - x) / (W + 1);
    cover(x, y);
    cover(Math.max(0, x - 1), y);
  }
}

/**
 * Brings wg up to date after an edit that touched the logical cells from (lx0, ly0) to (lx1, ly1), both
 * inclusive. The blocks within dirtyMarginCells of the edit are recomputed in place, and the other nodes and
 * edges are kept. Every cached row is dropped on any rebuild: a shortest path tree spans every reachable node,
 * and node ids held by callers are stale after any rebuild.
 */
export function updateWalkGraph(wg: WalkGraph, g: TerminalGrid, lx0: number, ly0: number, lx1: number, ly1: number): WalkGraph {
  if (wg.x0 !== g.x0 || wg.y0 !== g.y0 || wg.w !== g.w || wg.h !== g.h) return buildWalkGraph(g);
  const M = BUSINESS.terminal.walk.dirtyMarginCells;
  const whole = gridRect(g);
  // Zone changes can reach far from the edit, so the rect also covers every edge whose access changed.
  const next = zoneAccess(g);
  const box = { x0: lx0, y0: ly0, x1: lx1, y1: ly1 };
  widenToChanges(g, wg.access, next, box);
  wg.access = next;
  wg.blocked = walkBlockMask(g);
  wg.effective = effectiveZones(g);
  const oldLanes = wg.lanes;
  setLanes(g, wg);
  // A belt reaches far past the edit, so the rect also covers both ends of every belt that changed.
  for (const l of [...oldLanes, ...wg.lanes]) {
    if (oldLanes.some((o) => o.a === l.a && o.b === l.b && o.lenM === l.lenM) && wg.lanes.some((o) => o.a === l.a && o.b === l.b && o.lenM === l.lenM)) continue;
    for (const c of [l.a, l.b]) {
      const x = (c % g.w) + g.x0;
      const y = Math.floor(c / g.w) + g.y0;
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x);
      box.y1 = Math.max(box.y1, y);
    }
  }
  const rect: BlockRect = {
    bx0: Math.max(whole.bx0, Math.floor((box.x0 - M) / L)),
    by0: Math.max(whole.by0, Math.floor((box.y0 - M) / L)),
    bx1: Math.min(whole.bx1, Math.floor((box.x1 + M) / L)),
    by1: Math.min(whole.by1, Math.floor((box.y1 + M) / L)),
  };
  const blockCount = (r: BlockRect): number => Math.max(0, r.bx1 - r.bx0 + 1) * Math.max(0, r.by1 - r.by0 + 1);
  if (blockCount(rect) * 4 > blockCount(whole)) return buildWalkGraph(g);
  const tuples: number[] = [];
  const oldNodeCount = wg.nodeCount;
  keptEdges(wg, rect, tuples);
  fillNodes(g, wg, rect);
  compactNodes(g, wg);
  collectEdges(g, wg, rect, tuples);
  packEdges(wg, tuples);
  if (wg.nodeCount === oldNodeCount) {
    resetCache(wg.cache);
    resetCache(wg.staffCache);
  } else {
    wg.cache = newWalkCache(wg.nodeCount);
    wg.staffCache = newWalkCache(wg.nodeCount);
  }
  return wg;
}
