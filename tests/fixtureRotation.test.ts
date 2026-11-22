import { describe, expect, it } from 'vitest';
import { cellIndex, type Env } from '@shared/terminalOps';
import { brushCellEdit, cellLine, doorEdit, enterBrushCell, footprintRect, fixtureEdit, fixtureOptions, hasRotation, nextFixtureRot, transitionOrientationBreaks, zoneEdit } from '@ui/tools/fixtureRot';
import { buildTestAirport, buildTestTerminal, ownedSim, run } from './helpers';
import { grid, paint } from './zoningGrid';

const ENV: Env = { ctx: {} as Env['ctx'], af: {} as Env['af'], others: [] };

/** Fixture ids of FIXTURE_KEYS: id = index + 1. */
const CHECK_IN = 1;
const SECURITY = 2;
const PASSPORT = 15;
const GATE_DESK = 16;
const TOILET = 5;
const SECURITY_EXIT = 20;
const E_GATE = 21;

describe('fixture rotation', () => {
  it('cycles the rotation by one step modulo four', () => {
    const seen: number[] = [];
    let r = nextFixtureRot(0);
    for (let i = 0; i < 5; i++) {
      seen.push(r);
      r = nextFixtureRot(r);
    }
    expect(seen).toEqual([1, 2, 3, 0, 1]);
  });

  it('covers both cells of a two cell fixture in the ghost, toward the tail', () => {
    expect(footprintRect(fixtureEdit(80, 46, 81, 47, GATE_DESK, 0, 1, 0))).toEqual({ x0: 80, y0: 46, x1: 82, y1: 47 });
    expect(footprintRect(fixtureEdit(80, 46, 81, 47, GATE_DESK, 2, 1, 0))).toEqual({ x0: 79, y0: 46, x1: 81, y1: 47 });
    expect(footprintRect(fixtureEdit(80, 46, 81, 47, GATE_DESK, 3, 1, 0))).toEqual({ x0: 80, y0: 45, x1: 81, y1: 47 });
    expect(footprintRect(fixtureEdit(80, 46, 81, 47, CHECK_IN, 1, 1, 0))).toEqual({ x0: 80, y0: 46, x1: 81, y1: 47 });
  });

  it('spans the whole footprint of a security exit at each level and direction', () => {
    expect(footprintRect(fixtureEdit(80, 46, 81, 47, SECURITY_EXIT, 1, 2, 0))).toEqual({ x0: 78, y0: 46, x1: 81, y1: 47 });
    expect(footprintRect(fixtureEdit(80, 46, 81, 47, SECURITY_EXIT, 0, 1, 0))).toEqual({ x0: 80, y0: 46, x1: 82, y1: 48 });
  });

  it('gives rotation to every footprint larger than one cell and to transition fixtures', () => {
    expect(hasRotation(SECURITY_EXIT, 1)).toBe(true);
    expect(hasRotation(SECURITY_EXIT, 2)).toBe(true);
    expect(hasRotation(E_GATE, 1)).toBe(true);
    expect(hasRotation(SECURITY, 1)).toBe(true);
    expect(hasRotation(GATE_DESK, 1)).toBe(true);
    expect(hasRotation(CHECK_IN, 1)).toBe(false);
  });
});

describe('terminal edit command fields', () => {
  it('carries the level for the security exit and the leveled fixtures only', () => {
    expect(fixtureEdit(0, 0, 1, 1, SECURITY_EXIT, 0, 3, 0)).toMatchObject({ op: 'fixture', variant: SECURITY_EXIT, level: 3 });
    expect(fixtureOptions(CHECK_IN, 3, 1)).toEqual({ level: 3, mode: 0 });
    expect(fixtureOptions(GATE_DESK, 2, 0)).toEqual({ level: 2, mode: 0 });
    expect(fixtureOptions(TOILET, 3, 1)).toEqual({ level: 1, mode: 0 });
  });

  it('carries the mode for passport, eGate and security only', () => {
    expect(fixtureEdit(0, 0, 1, 1, PASSPORT, 0, 1, 1)).toMatchObject({ variant: PASSPORT, mode: 1 });
    expect(fixtureEdit(0, 0, 1, 1, E_GATE, 0, 1, 1)).toMatchObject({ variant: E_GATE, mode: 1 });
    expect(fixtureEdit(0, 0, 1, 1, SECURITY, 0, 1, 1)).toMatchObject({ variant: SECURITY, mode: 1 });
    expect(fixtureEdit(0, 0, 1, 1, GATE_DESK, 0, 1, 1)).toMatchObject({ variant: GATE_DESK, mode: 0 });
  });

  it('carries the door type as the variant of a wall edit', () => {
    expect(doorEdit(3, 4, 5, 4, 3)).toEqual({ op: 'wall', x0: 3, y0: 4, x1: 5, y1: 4, variant: 3 });
    expect(doorEdit(3, 4, 5, 4, 4)).toEqual({ op: 'wall', x0: 3, y0: 4, x1: 5, y1: 4, variant: 4 });
  });

  it('carries the zone as the variant of a zone edit, including international', () => {
    expect(zoneEdit(0, 0, 2, 1, 5)).toEqual({ op: 'zone', x0: 0, y0: 0, x1: 2, y1: 1, variant: 5 });
  });

  it('paints one 1 by 1 zone edit per brush cell and only once per drag', () => {
    expect(brushCellEdit(3, 4, 2)).toEqual({ op: 'zone', x0: 3, y0: 4, x1: 4, y1: 5, variant: 2 });
    const seen = new Set<string>();
    expect([enterBrushCell(seen, 3, 4), enterBrushCell(seen, 3, 4), enterBrushCell(seen, 4, 4)]).toEqual([true, false, true]);
  });
});

describe('zone brush line', () => {
  it('paints every cell between two pointer cells, both ends included, in order', () => {
    expect(cellLine(0, 0, 3, 1)).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ]);
    expect(cellLine(2, 2, 2, 2)).toEqual([[2, 2]]);
  });

  it('walks backwards and vertically as well', () => {
    expect(cellLine(4, 0, 0, 0)).toEqual([
      [4, 0],
      [3, 0],
      [2, 0],
      [1, 0],
      [0, 0],
    ]);
    expect(cellLine(1, 1, 1, 4)).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
    ]);
  });
});

describe('transition orientation of a ghost', () => {
  const split = () => {
    const g = grid(10, 5);
    paint(g, 0, 0, 5, 5, 1);
    paint(g, 5, 0, 10, 5, 3);
    return g;
  };
  // A security lane is 2 by 8 cells (T74): a hall 16 wide split at column 9.
  const wide = () => {
    const g = grid(16, 5);
    paint(g, 0, 0, 9, 5, 1);
    paint(g, 9, 0, 16, 5, 3);
    return g;
  };

  it('warns about a security lane placed the wrong way round', () => {
    // Rotation 3 flows west, from the secure side into public: the lane on columns 2 to 9 opens no transition edge that way.
    expect(transitionOrientationBreaks(wide(), fixtureEdit(2, 2, 3, 3, SECURITY, 3, 1, 0), ENV)).toBe(true);
  });

  it('does not warn about a security lane placed the right way round', () => {
    // Rotation 1 flows east, from public into secure.
    expect(transitionOrientationBreaks(wide(), fixtureEdit(9, 2, 10, 3, SECURITY, 1, 1, 0), ENV)).toBe(false);
  });

  it('never warns about a fixture that is not a transition', () => {
    expect(transitionOrientationBreaks(split(), fixtureEdit(5, 2, 6, 3, GATE_DESK, 3, 1, 0), ENV)).toBe(false);
  });
});

describe('fixture place command carries rotation', () => {
  it('lays a two cell fixture with its tail in the rotated direction', () => {
    const sim = ownedSim();
    sim.cash = 100_000_000;
    buildTestAirport(sim, { standsPerRow: 8 });
    expect(buildTestTerminal(sim)).toEqual([]);
    const g = sim.business.grids[0];
    expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: fixtureEdit(84, 44, 85, 45, GATE_DESK, 1, 1, 0) })).toEqual([]);
    const anchor = cellIndex(g, 84, 44);
    const tail = cellIndex(g, 84, 45);
    expect(g.fixture[anchor]).toBe(GATE_DESK);
    expect(g.fixtureRot[anchor]).toBe(2);
    expect(g.fixture[tail]).toBe(GATE_DESK);
    expect(g.fixtureRot[tail]).toBe(6);
    expect(g.fixture[cellIndex(g, 85, 44)]).toBe(0);
  });
});
