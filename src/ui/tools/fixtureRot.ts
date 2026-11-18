import { TRANSITION_KEYS, footprintOf, fixtureKey, type FixtureKey, type TerminalGrid } from '@shared/business';
import { ACROSS, planEdit, ROT_STEP, type Env, type TerminalEdit } from '@shared/terminalOps';
import { zoneAccess, zoneIssues } from '@shared/terminalZones';

/** Direction from anchor to tail of a fixture with a footprint or a flow: 0 +column, 1 +row, 2 -column, 3 -row. */
export type FixtureRot = 0 | 1 | 2 | 3;

/** Fixtures whose mode is set at placement: passport and eGate are departure or arrival, security is passenger or staff use. */
const MODE_FIXTURES: readonly FixtureKey[] = ['passport', 'eGate', 'security'];

export function nextFixtureRot(r: FixtureRot): FixtureRot {
  return ((r + 1) % 4) as FixtureRot;
}

/** True when the fixture at this level takes a rotation: a footprint larger than one cell, or a transition fixture with a flow. */
export function hasRotation(fixtureId: number, level: number): boolean {
  const key = fixtureKey(fixtureId);
  const [along, across] = footprintOf(key, level);
  return along * across > 1 || TRANSITION_KEYS.includes(key);
}

/** The level and mode a fixture edit carries. Only the security exit has levels and only mode fixtures have a mode; others carry 1 and 0. */
export function fixtureOptions(fixtureId: number, level: number, mode: number): { level: number; mode: number } {
  const key = fixtureKey(fixtureId);
  return {
    level: key === 'securityExit' ? level : 1,
    mode: MODE_FIXTURES.includes(key) ? mode : 0,
  };
}

/** Terminal fixture edit over a cell rectangle, with the level and mode the fixture takes. */
export function fixtureEdit(x0: number, y0: number, x1: number, y1: number, fixtureId: number, rot: FixtureRot, level: number, mode: number): TerminalEdit {
  return { op: 'fixture', x0, y0, x1, y1, variant: fixtureId, rot, ...fixtureOptions(fixtureId, level, mode) };
}

/** Door edit on one grid edge: a plain door (WALL.Door) or a staff door (WALL.StaffDoor). */
export function doorEdit(x0: number, y0: number, x1: number, y1: number, doorType: number): TerminalEdit {
  return { op: 'wall', x0, y0, x1, y1, variant: doorType };
}

/** Zone paint over a cell rectangle. */
export function zoneEdit(x0: number, y0: number, x1: number, y1: number, zone: number): TerminalEdit {
  return { op: 'zone', x0, y0, x1, y1, variant: zone };
}

/** Zone brush: the one cell edit painted when the pointer enters a new cell during a drag. */
export function brushCellEdit(cx: number, cy: number, zone: number): TerminalEdit {
  return zoneEdit(cx, cy, cx + 1, cy + 1, zone);
}

/**
 * Brush drag bookkeeping: true the first time a cell is entered during one drag, and records it in seen. A brush
 * paints each cell once, so a pointer that moves back and forth does not send the same edit again.
 */
export function enterBrushCell(seen: Set<string>, cx: number, cy: number): boolean {
  const key = `${cx},${cy}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

/**
 * Cells an edit covers on screen. A fixture covers its whole footprint from each anchor, so the rectangle grows
 * along and across its direction. Returns exclusive bounds, like the edit.
 */
export function footprintRect(e: TerminalEdit): { x0: number; y0: number; x1: number; y1: number } {
  if (e.op !== 'fixture') return { x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 };
  const [along, across] = footprintOf(fixtureKey(e.variant), e.level ?? 1);
  const rot = e.rot ?? 0;
  const [ax, ay] = ROT_STEP[rot];
  const [bx, by] = ACROSS(rot);
  const alongX = (along - 1) * ax;
  const alongY = (along - 1) * ay;
  const acrossX = (across - 1) * bx;
  const acrossY = (across - 1) * by;
  return {
    x0: e.x0 + Math.min(0, alongX) + Math.min(0, acrossX),
    y0: e.y0 + Math.min(0, alongY) + Math.min(0, acrossY),
    x1: e.x1 + Math.max(0, alongX) + Math.max(0, acrossX),
    y1: e.y1 + Math.max(0, alongY) + Math.max(0, acrossY),
  };
}

/**
 * Whole cells on the straight line from (ax, ay) to (bx, by), both ends included, in order from the first cell
 * (Bresenham). A fast brush drag steps over cells between two pointer moves, so the cells between are painted too.
 */
export function cellLine(ax: number, ay: number, bx: number, by: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  let x = ax;
  let y = ay;
  for (;;) {
    out.push([x, y]);
    if (x === bx && y === by) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Per grid object: whether it already has a transition orientation problem, and the verdict of each edit tried. */
interface OrientationCache {
  before: boolean;
  verdicts: Map<string, boolean>;
}

const orientationCache = new WeakMap<TerminalGrid, OrientationCache>();
/** Verdicts kept per grid before the cache starts over, so a long drag cannot grow it without limit. */
const VERDICT_LIMIT = 1024;

/**
 * True when a transition fixture placed by this edit leaves a transition orientation problem that the grid does not
 * have now (the ghost warning). The edit is applied to a copy, so the live grid never changes. Verdicts are memoised per
 * grid object and edit, because the sim sends a new grid object whenever the terminal changes.
 */
export function transitionOrientationBreaks(g: TerminalGrid, edit: TerminalEdit, env: Env): boolean {
  if (edit.op !== 'fixture' || !TRANSITION_KEYS.includes(fixtureKey(edit.variant))) return false;
  let cache = orientationCache.get(g);
  if (!cache) {
    cache = { before: zoneIssues(g, zoneAccess(g)).includes('transitionOrientation'), verdicts: new Map() };
    orientationCache.set(g, cache);
  }
  if (cache.before) return false;
  const key = [edit.x0, edit.y0, edit.x1, edit.y1, edit.variant, edit.rot ?? 0, edit.level ?? 1, edit.mode ?? 0].join(',');
  const known = cache.verdicts.get(key);
  if (known !== undefined) return known;
  const ghost = structuredClone(g);
  planEdit(ghost, edit, env).apply();
  const verdict = zoneIssues(ghost, zoneAccess(ghost)).includes('transitionOrientation');
  if (cache.verdicts.size >= VERDICT_LIMIT) cache.verdicts.clear();
  cache.verdicts.set(key, verdict);
  return verdict;
}
