import { TRANSITION_KEYS, WALL, fixtureKey, type FixtureKey, type TerminalGrid } from './business';
import { ROT_STEP, fixtureCells } from './terminalOps';

/** Audience bits of an edge mask: passengers and staff. */
export const AUD = { Pax: 1, Staff: 2 } as const;

/**
 * Who may cross each cell edge, indexed like hWall and vWall. Four bits per edge: the low two are the audiences
 * going from the left or upper cell (A) to the right or lower cell (B), the next two go from B to A.
 */
export interface ZoneAccess {
  h: Uint8Array;
  v: Uint8Array;
}

/** Zone a transition fixture leads from and to, and who may use it. */
export interface Transition {
  from: number;
  to: number;
  aud: number;
}

const PUBLIC = 1;
const COMMERCIAL = 2;
const SECURE = 3;
const INTERNATIONAL = 5;
const BOTH = AUD.Pax | AUD.Staff;

/** The zone change a fixture makes in its flow direction, or null for a fixture that is no transition. */
export function transitionOf(key: FixtureKey, mode: number): Transition | null {
  if (!TRANSITION_KEYS.includes(key)) return null;
  if (key === 'security') return { from: PUBLIC, to: SECURE, aud: mode === 1 ? AUD.Staff : BOTH };
  if (key === 'securityExit') return { from: SECURE, to: PUBLIC, aud: BOTH };
  return mode === 1 ? { from: INTERNATIONAL, to: PUBLIC, aud: BOTH } : { from: SECURE, to: INTERNATIONAL, aud: BOTH };
}

/** Column and row step of the flow of a fixture, from its anchor code. Rotation 0 flows toward the lower row index. */
export function flowStep(code: number): readonly [number, number] {
  return ROT_STEP[((code ? code - 1 : 0) + 3) % 4];
}

const isPlain = (wall: number): boolean => wall === WALL.None || wall === WALL.Door;

/**
 * The zone each cell behaves as. Unzoned floor counts as public. A commercial region (commercial cells joined by
 * open edges or plain doors) takes the one zone among public, secure and international it touches through open edges
 * or plain doors, and stays commercial when it touches none or more than one. Cells without floor are 0.
 */
export function effectiveZones(g: TerminalGrid): Uint8Array {
  const W = g.w;
  const n = W * g.h;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (g.floor[i] > 0) out[i] = g.zone[i] === 0 ? PUBLIC : g.zone[i];
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const members: number[] = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] === 1 || out[start] !== COMMERCIAL) continue;
    stack.length = 0;
    members.length = 0;
    stack.push(start);
    seen[start] = 1;
    let touched = 0;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      members.push(i);
      const x = i % W;
      const y = (i - x) / W;
      for (let d = 0; d < 4; d++) {
        const j = neighbourOf(g, x, y, d);
        if (j < 0 || out[j] === 0 || !isPlain(edgeWall(g, x, y, d))) continue;
        if (out[j] === COMMERCIAL) {
          if (seen[j] === 0) {
            seen[j] = 1;
            stack.push(j);
          }
        } else if (out[j] === PUBLIC || out[j] === SECURE || out[j] === INTERNATIONAL) touched |= 1 << out[j];
      }
    }
    if (touched !== 0 && (touched & (touched - 1)) === 0) {
      const zone = 31 - Math.clz32(touched);
      for (const i of members) out[i] = zone;
    }
  }
  return out;
}

/** Array index of the neighbour of array cell (x, y) in direction d (0 left, 1 right, 2 up, 3 down), or -1 outside. */
function neighbourOf(g: TerminalGrid, x: number, y: number, d: number): number {
  if (d === 0) return x > 0 ? y * g.w + x - 1 : -1;
  if (d === 1) return x < g.w - 1 ? y * g.w + x + 1 : -1;
  if (d === 2) return y > 0 ? (y - 1) * g.w + x : -1;
  return y < g.h - 1 ? (y + 1) * g.w + x : -1;
}

/** Wall type on the edge of array cell (x, y) in direction d. */
function edgeWall(g: TerminalGrid, x: number, y: number, d: number): number {
  if (d === 0) return g.vWall[y * (g.w + 1) + x];
  if (d === 1) return g.vWall[y * (g.w + 1) + x + 1];
  if (d === 2) return g.hWall[y * g.w + x];
  return g.hWall[(y + 1) * g.w + x];
}

/**
 * The edge table of a grid. Walls and glass are closed. A staff door lets staff through both ways. Equal effective
 * zones are open to all. An edge between different zones is open only one way through a transition fixture whose flow
 * crosses it from its from zone to its to zone, and every other such edge is a breach with no access.
 */
export function zoneAccess(g: TerminalGrid): ZoneAccess {
  const W = g.w;
  const eff = effectiveZones(g);
  const acc: ZoneAccess = { h: new Uint8Array((g.h + 1) * W), v: new Uint8Array(g.h * (W + 1)) };
  const staffBoth = AUD.Staff | (AUD.Staff << 2);
  for (let y = 0; y < g.h; y++) {
    for (let x = 1; x < W; x++) {
      const e = y * (W + 1) + x;
      acc.v[e] = edgeMask(g.vWall[e], eff[y * W + x - 1], eff[y * W + x], staffBoth);
    }
  }
  for (let y = 1; y < g.h; y++) {
    for (let x = 0; x < W; x++) {
      const e = y * W + x;
      acc.h[e] = edgeMask(g.hWall[e], eff[e - W], eff[e], staffBoth);
    }
  }
  for (let i = 0; i < g.fixture.length; i++) {
    if (g.fixture[i] === 0 || g.fixtureRot[i] >= 5) continue;
    const t = transitionOf(fixtureKey(g.fixture[i]), g.fixtureMode[i]);
    if (!t) continue;
    const [fx, fy] = flowStep(g.fixtureRot[i]);
    for (const c of fixtureCells(g, i)) {
      const cx = c % W;
      const cy = (c - cx) / W;
      openFlow(g, acc, eff, t, cx - fx, cy - fy, cx, cy);
      openFlow(g, acc, eff, t, cx, cy, cx + fx, cy + fy);
    }
  }
  return acc;
}

/** Mask of an edge from its wall and the effective zones of its two cells, before transitions. */
function edgeMask(wall: number, zoneA: number, zoneB: number, staffBoth: number): number {
  if (zoneA === 0 || zoneB === 0) return 0;
  if (wall === WALL.Wall || wall === WALL.Glass) return 0;
  if (wall === WALL.StaffDoor) return staffBoth;
  return zoneA === zoneB ? 15 : 0;
}

/** Opens the edge from array cell (ax, ay) to the adjacent cell (bx, by) for a transition, when both zones fit. */
function openFlow(g: TerminalGrid, acc: ZoneAccess, eff: Uint8Array, t: Transition, ax: number, ay: number, bx: number, by: number): void {
  const W = g.w;
  if (ax < 0 || ay < 0 || bx < 0 || by < 0 || ax >= W || bx >= W || ay >= g.h || by >= g.h) return;
  if (eff[ay * W + ax] !== t.from || eff[by * W + bx] !== t.to) return;
  if (bx > ax) {
    const e = by * (W + 1) + bx;
    if (isPlain(g.vWall[e])) acc.v[e] |= t.aud;
  } else if (bx < ax) {
    const e = ay * (W + 1) + ax;
    if (isPlain(g.vWall[e])) acc.v[e] |= t.aud << 2;
  } else if (by > ay) {
    const e = by * W + bx;
    if (isPlain(g.hWall[e])) acc.h[e] |= t.aud;
  } else {
    const e = ay * W + ax;
    if (isPlain(g.hWall[e])) acc.h[e] |= t.aud << 2;
  }
}

/** Audience bits of one step from array cell (x, y) in direction d (0 left, 1 right, 2 up, 3 down, as canStep). */
export function stepAud(acc: ZoneAccess, g: TerminalGrid, x: number, y: number, d: number): number {
  const W = g.w;
  if (d === 0) return x > 0 ? (acc.v[y * (W + 1) + x] >> 2) & 3 : 0;
  if (d === 1) return x < W - 1 ? acc.v[y * (W + 1) + x + 1] & 3 : 0;
  if (d === 2) return y > 0 ? (acc.h[y * W + x] >> 2) & 3 : 0;
  return y < g.h - 1 ? acc.h[(y + 1) * W + x] & 3 : 0;
}
