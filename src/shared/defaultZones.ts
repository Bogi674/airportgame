import { ZONE, type TerminalGrid } from './business';
import { cornerWorld } from './terminalOps';

/** Neighbour steps in cell space: +column, +row, -column, -row. */
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

/**
 * The zone an unzoned floor cell defaults to (T95, owner 2026-11-24): the side of its nearest outer wall. An outer
 * edge of the floor faces the airside when a point straight out from its middle, at any probe step up to `probeM`,
 * lies on an apron or a stand (`airside`). Every floored cell then takes Secure when the nearest seeding outer edge,
 * counted in steps through floored cells, faces the airside, and Public when it faces away from the apron. Ties go
 * to the cell met first in index order, so the result is deterministic. Cells without floor are 0. With no airside around, every cell is Public, as
 * unzoned floor behaved before.
 */
export function defaultZones(g: TerminalGrid, airside: (x: number, y: number) => boolean, probeM: number, stepM: number): Uint8Array {
  const W = g.w;
  const n = W * g.h;
  const out = new Uint8Array(n);
  const queue = new Int32Array(n);
  // Per floored cell: bit d set when its edge in direction d is outer, bit 4 + d when that edge faces the airside.
  const edges = new Uint8Array(n);
  let airDirs = 0;
  for (let i = 0; i < n; i++) {
    if (g.floor[i] === 0) continue;
    const ax = i % W;
    const ay = (i - ax) / W;
    for (let d = 0; d < 4; d++) {
      const nx = ax + DX[d];
      const ny = ay + DY[d];
      if (nx >= 0 && ny >= 0 && nx < W && ny < g.h && g.floor[ny * W + nx] !== 0) continue;
      edges[i] |= 1 << d;
      // The middle of the outer edge, then straight out from it.
      const mid = cornerWorld(g, g.x0 + ax + 0.5 + DX[d] * 0.5, g.y0 + ay + 0.5 + DY[d] * 0.5);
      const far = cornerWorld(g, g.x0 + ax + 0.5 + DX[d] * 1.5, g.y0 + ay + 0.5 + DY[d] * 1.5);
      const len = Math.hypot(far.x - mid.x, far.y - mid.y);
      const ux = (far.x - mid.x) / len;
      const uy = (far.y - mid.y) / len;
      let faces = false;
      for (let s = stepM; s <= probeM && !faces; s += stepM) faces = airside(mid.x + ux * s, mid.y + uy * s);
      if (faces) {
        edges[i] |= 1 << (4 + d);
        airDirs |= 1 << d;
      }
    }
  }
  // Landside walls are those facing away from the apron. Side walls, square to it, seed nothing, so a hall splits
  // straight across instead of in a staircase. A floor with no wall facing away from the apron uses all its other walls.
  let landDirs = 0;
  for (let d = 0; d < 4; d++) if ((airDirs & (1 << d)) !== 0) landDirs |= 1 << ((d + 2) % 4);
  landDirs &= ~airDirs;
  let landSeen = false;
  for (let i = 0; i < n && !landSeen; i++) if ((edges[i]! & landDirs & ~(edges[i]! >> 4)) !== 0) landSeen = true;
  if (!landSeen) landDirs = 0xf & ~airDirs;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    const e = edges[i]!;
    if (e === 0) continue;
    const air = e >> 4;
    if (air !== 0) out[i] = ZONE.Secure;
    else if ((e & landDirs) !== 0 || airDirs === 0) out[i] = ZONE.Public;
    else continue;
    queue[tail++] = i;
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head]!;
    const ax = i % W;
    const ay = (i - ax) / W;
    for (let d = 0; d < 4; d++) {
      const nx = ax + DX[d];
      const ny = ay + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= g.h) continue;
      const j = ny * W + nx;
      if (g.floor[j] === 0 || out[j] !== 0) continue;
      out[j] = out[i]!;
      queue[tail++] = j;
    }
  }
  // Floor no seed reached (only side walls around it) behaves as Public, as unzoned floor did before.
  for (let i = 0; i < n; i++) if (g.floor[i] !== 0 && out[i] === 0) out[i] = ZONE.Public;
  return out;
}
