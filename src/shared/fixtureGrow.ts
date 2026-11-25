import { FIXTURE_CATALOG } from '@data/index';
import { FIXTURE_ZONES, TERMINAL_CELL_M, fixtureKey, footprintOf, type FixtureKey, type TerminalGrid } from './business';
import { ACROSS, cellIndex, cellOf, ROT_STEP } from './terminalOps';
import { edgeWall, fixtureUseCells, propOnCell, solid, useCellBlocked, useMask } from './useArea';

/** A cell a fixture gains when it grows: logical position and its along and across offsets from the anchor. */
export interface GrowCell {
  x: number;
  y: number;
  along: number;
  across: number;
}

/** Direction of the fixture at an anchor, from its footprint code. Code 0 is a desk from before T85, direction 0. */
const rotOf = (g: TerminalGrid, anchor: number): number => (g.fixtureRot[anchor]! > 0 ? g.fixtureRot[anchor]! - 1 : 0);

/**
 * Cells the fixture anchored at array cell `anchor` gains when it takes the footprint of level `to` (Revision 6: the
 * check in desk grows to the right of its anchor along its direction). Empty when the footprint does not grow. `from`
 * is the level whose footprint the grid holds now: the desk's own level, or 1 for a desk saved before Revision 6.
 */
export function growCells(g: TerminalGrid, anchor: number, to: number, from: number = g.fixtureLevel[anchor]!): GrowCell[] {
  const key = fixtureKey(g.fixture[anchor]!);
  const [oa, ob] = footprintOf(key, Math.max(from, 1));
  const [na, nb] = footprintOf(key, to);
  const rot = rotOf(g, anchor);
  const [ax, ay] = ROT_STEP[rot]!;
  const [bx, by] = ACROSS(rot);
  const at = cellOf(g, anchor);
  const out: GrowCell[] = [];
  for (let a = 0; a < na; a++) {
    for (let b = 0; b < nb; b++) {
      if (a < oa && b < ob) continue;
      out.push({ x: at.x + a * ax + b * bx, y: at.y + a * ay + b * by, along: a, across: b });
    }
  }
  return out;
}

/**
 * Logical cells that stop the fixture at `anchor` from taking the footprint of level `to`, empty when it fits. A new
 * cell needs floor, no fixture, no floor prop, a zone the fixture allows, no solid wall between it and the cell it
 * joins and no place on the use area of another fixture; the use area of the larger footprint must be clear too. The
 * blocked cells are what the ghost paints red.
 */
export function growBlocked(g: TerminalGrid, anchor: number, to: number, from: number = g.fixtureLevel[anchor]!): [number, number][] {
  const grow = growCells(g, anchor, to, from);
  if (grow.length === 0) return [];
  const key = fixtureKey(g.fixture[anchor]!);
  const rot = rotOf(g, anchor);
  const [ax, ay] = ROT_STEP[rot]!;
  const [bx, by] = ACROSS(rot);
  const allowed = FIXTURE_ZONES[key] ?? [];
  const others = useMask(g, anchor);
  const at = cellOf(g, anchor);
  const own = new Set<number>();
  for (const c of grow) own.add(cellIndex(g, c.x, c.y));
  const [na, nb] = footprintOf(key, to);
  for (let a = 0; a < na; a++) for (let b = 0; b < nb; b++) own.add(cellIndex(g, at.x + a * ax + b * bx, at.y + a * ay + b * by));
  const seen = new Set<number>();
  const out: [number, number][] = [];
  const mark = (x: number, y: number): void => {
    const k = x * 65536 + y;
    if (seen.has(k)) return;
    seen.add(k);
    out.push([x, y]);
  };
  for (const c of grow) {
    const j = cellIndex(g, c.x, c.y);
    // The cell the new one joins: one step back along the fixture, or across when it is on the first row.
    const [fx, fy] = c.along > 0 ? [c.x - ax, c.y - ay] : [c.x - bx, c.y - by];
    const bad =
      j < 0 ||
      g.floor[j] === 0 ||
      g.fixture[j] !== 0 ||
      (g.zone[j] !== 0 && !allowed.includes(g.zone[j]!)) ||
      propOnCell(g, c.x, c.y, -1) ||
      solid(edgeWall(g, fx, fy, c.x, c.y)) ||
      others[j] === 1;
    if (bad) mark(c.x, c.y);
  }
  if (out.length > 0) return out;
  for (const u of fixtureUseCells(key, to, at.x, at.y, rot)) if (useCellBlocked(g, u, own)) mark(u.x, u.y);
  return out;
}

/** Writes the larger footprint of level `to` into the grid: the gained cells become tails, every cell takes the level. */
export function growFixture(g: TerminalGrid, anchor: number, to: number, from: number = g.fixtureLevel[anchor]!): void {
  const rot = rotOf(g, anchor);
  for (const c of growCells(g, anchor, to, from)) {
    const j = cellIndex(g, c.x, c.y);
    g.fixture[j] = g.fixture[anchor]!;
    g.fixtureRot[j] = 5 + rot;
    g.fixtureOff[j] = c.along | (c.across << 4);
    g.fixtureNo[j] = g.fixtureNo[anchor]!;
    g.fixtureMode[j] = g.fixtureMode[anchor]!;
    g.leased[j] = 0;
    if (g.zone[j] === 0) g.zone[j] = FIXTURE_ZONES[fixtureKey(g.fixture[anchor]!)]?.[0] ?? 0;
  }
  const key = fixtureKey(g.fixture[anchor]!);
  const [na, nb] = footprintOf(key, to);
  const [ax, ay] = ROT_STEP[rot]!;
  const [bx, by] = ACROSS(rot);
  const at = cellOf(g, anchor);
  for (let a = 0; a < na; a++) for (let b = 0; b < nb; b++) g.fixtureLevel[cellIndex(g, at.x + a * ax + b * bx, at.y + a * ay + b * by)] = to;
}

/** Fixtures whose art can be shorter than their footprint and then starts at the anchor end instead of being centered. */
const ANCHOR_END_ART: readonly FixtureKey[] = ['checkIn'];

/**
 * Shift of the sprite center from the footprint center in cells along the fixture direction, negative toward the
 * anchor. The level 2 check in desk is 3 m of art on a 4 m footprint (Revision 6), so its free meter lies at the tail.
 */
export function artShiftCells(key: FixtureKey, level: number): number {
  if (!ANCHOR_END_ART.includes(key)) return 0;
  const size = FIXTURE_CATALOG.assets.find((a) => a.id === `${key}.l${Math.min(Math.max(level, 1), 3)}`)?.size;
  if (size === undefined) return 0;
  return (size[0] - footprintOf(key, level)[0] * TERMINAL_CELL_M) / (2 * TERMINAL_CELL_M);
}
