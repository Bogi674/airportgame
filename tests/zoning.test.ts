import { describe, expect, it } from 'vitest';
import { FIXTURE_FOOTPRINT, FIXTURE_KEYS, FLOOR, footprintOf, type TerminalGrid } from '@shared/business';
import { cellIndex, ensureCells, fixtureAnchor, fixtureCells, newGrid, planEdit } from '@shared/terminalOps';
import type { AirfieldPayload } from '@shared/airfield';
import type { BuildContext } from '@shared/validate';

describe('zoning constants', () => {
  it('appends the new fixture keys after the old ones', () => {
    expect(FIXTURE_KEYS.indexOf('securityExit') + 1).toBe(20);
    expect(FIXTURE_KEYS.indexOf('eGate') + 1).toBe(21);
    expect(FIXTURE_KEYS.indexOf('customs') + 1).toBe(22);
    expect(FIXTURE_KEYS[0]).toBe('checkIn');
    expect(FIXTURE_KEYS[18]).toBe('carousel');
  });

  it('has a footprint entry per key', () => {
    for (const k of FIXTURE_KEYS) expect(FIXTURE_FOOTPRINT[k].length).toBeGreaterThan(0);
  });

  it('picks the footprint by level', () => {
    expect(footprintOf('securityExit', 2)).toEqual([1, 3]);
    expect(footprintOf('securityExit', 0)).toEqual([2, 2]);
    expect(footprintOf('customs', 3)).toEqual([2, 2]);
  });
});

describe('footprint helpers', () => {
  it('finds the anchor from every cell and erases all four cells', () => {
    const env = { ctx: {} as BuildContext, af: {} as AirfieldPayload, others: [] as TerminalGrid[] };
    const g = newGrid(1, 0, 0, 0);
    ensureCells(g, 0, 0, 32, 32);
    for (let i = 0; i < g.floor.length; i++) g.floor[i] = FLOOR.Tile;
    const anchor = cellIndex(g, 2, 2);
    g.fixture[anchor] = FIXTURE_KEYS.indexOf('customs') + 1;
    g.fixtureRot[anchor] = 2;
    g.fixtureLevel[anchor] = 1;
    // Rot 1 runs along +row, across is -column: cells (2,2) (2,3) (1,2) (1,3).
    const tails: [number, number, number][] = [[2, 3, 1], [1, 2, 1 << 4], [1, 3, 1 | (1 << 4)]];
    for (const [x, y, off] of tails) {
      const c = cellIndex(g, x, y);
      g.fixture[c] = g.fixture[anchor];
      g.fixtureRot[c] = 6;
      g.fixtureOff[c] = off;
      g.fixtureLevel[c] = 1;
    }
    const cells = fixtureCells(g, anchor);
    expect(cells.length).toBe(4);
    for (const c of cells) expect(fixtureAnchor(g, c)).toBe(anchor);
    expect(fixtureAnchor(g, cellIndex(g, 5, 5))).toBe(-1);
    const plan = planEdit(g, { op: 'erase', x0: 1, y0: 3, x1: 2, y1: 4, variant: 0 }, env);
    expect(plan.problem).toBeNull();
    plan.apply();
    for (const c of cells) expect(g.fixture[c]).toBe(0);
  });
});
