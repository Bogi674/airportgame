import { BUSINESS } from '@data/index';
import { FIXTURE_ZONES, TRANSITION_KEYS, fixtureKey, type FixtureKey, type TerminalGrid } from './business';
import { footprintCells, frontStep } from './useArea';

/** Audience bits of an edge mask: passengers and staff. */
export const AUD = { Pax: 1, Staff: 2 } as const;

/** Zone a transition fixture leads from and to, and who may use it. */
export interface Transition {
  from: number;
  to: number;
  aud: number;
}

const PUBLIC = 1;
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

/**
 * The zone blocks a transition fixture carries (T87, owner 2026-11-24): the cells right before its intake, painted
 * with its from zone, and right past its exit, painted with its to zone, as wide as the fixture and
 * `transitionPadCells` deep. The intake is the front of the fixture (the side people use) and the exit its back.
 */
export interface TransitionPads {
  from: number;
  to: number;
  /** Logical cells before the intake, nearest first. */
  intake: [number, number][];
  /** Logical cells past the exit, nearest first. */
  exit: [number, number][];
  /** Unit cell step of the flow, from intake to exit. */
  flow: readonly [number, number];
}

/** The zone blocks of a transition fixture anchored at logical (x, y), or null for any other fixture. */
export function transitionPads(key: FixtureKey, level: number, mode: number, x: number, y: number, rot: number): TransitionPads | null {
  const t = transitionOf(key, mode);
  if (!t) return null;
  const depth = BUSINESS.terminal.transitionPadCells;
  const cells = footprintCells(key, level, x, y, rot);
  const inside = new Set(cells.map(([cx, cy]) => cx * 65536 + cy));
  const [fx, fy] = frontStep(rot);
  const intake: [number, number][] = [];
  const exit: [number, number][] = [];
  for (let k = 1; k <= depth; k++) {
    for (const [cx, cy] of cells) {
      // Only the outer row of the footprint on each side steps out, so every pad cell is listed once.
      if (!inside.has((cx + fx) * 65536 + cy + fy)) intake.push([cx + k * fx, cy + k * fy]);
      if (!inside.has((cx - fx) * 65536 + cy - fy)) exit.push([cx - k * fx, cy - k * fy]);
    }
  }
  return { from: t.from, to: t.to, intake, exit, flow: [-fx, -fy] };
}

const cellAt = (g: TerminalGrid, x: number, y: number): number => {
  const ax = x - g.x0;
  const ay = y - g.y0;
  return ax < 0 || ay < 0 || ax >= g.w || ay >= g.h ? -1 : ay * g.w + ax;
};

/** True when a fixture standing on cell i may stand in zone z, or the cell holds no fixture. */
const fixtureAllows = (g: TerminalGrid, i: number, z: number): boolean => g.fixture[i] === 0 || (FIXTURE_ZONES[fixtureKey(g.fixture[i])] ?? []).includes(z);

/**
 * Whether a pad cell takes its zone: a floored cell whose fixture allows the zone. The exit block paints over unzoned
 * cells and cells of the from zone; the intake block paints over unzoned cells only, so it never undoes a zone the
 * player chose. Returns the cell index to paint, or -1.
 */
export function padTarget(g: TerminalGrid, x: number, y: number, zone: number, over: number): number {
  const i = cellAt(g, x, y);
  if (i < 0 || g.floor[i] === 0) return -1;
  const z = g.zone[i];
  if (z === zone || (z !== 0 && z !== over)) return -1;
  return fixtureAllows(g, i, zone) ? i : -1;
}

/**
 * True when the intake already lies in the zone the fixture leads into, the sign of a fixture placed backwards. Its
 * exit block then paints unzoned cells only, so the player's zones stay and the orientation warning shows.
 */
export function padsBackwards(g: TerminalGrid, pads: TransitionPads): boolean {
  for (const [x, y] of pads.intake) {
    const i = cellAt(g, x, y);
    if (i >= 0 && g.floor[i] !== 0 && g.zone[i] === pads.to) return true;
  }
  return false;
}

/** Paints the zone blocks of a transition fixture just placed. Deterministic: cells in pad order. */
export function paintTransitionPads(g: TerminalGrid, pads: TransitionPads): void {
  const over = padsBackwards(g, pads) ? 0 : pads.from;
  for (const [x, y] of pads.intake) {
    const i = padTarget(g, x, y, pads.from, 0);
    if (i >= 0) g.zone[i] = pads.from;
  }
  for (const [x, y] of pads.exit) {
    const i = padTarget(g, x, y, pads.to, over);
    if (i >= 0) g.zone[i] = pads.to;
  }
}
