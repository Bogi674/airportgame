import { describe, expect, it } from 'vitest';
import { cellIndex } from '@shared/terminalOps';
import { footprintRect, fixtureEdit, nextFixtureRot } from '@ui/tools/fixtureRot';
import { buildTestAirport, buildTestTerminal, ownedSim, run } from './helpers';

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
    expect(footprintRect(fixtureEdit(80, 46, 81, 47, 16, 0))).toEqual({ x0: 80, y0: 46, x1: 82, y1: 47 });
    expect(footprintRect(fixtureEdit(80, 46, 81, 47, 16, 2))).toEqual({ x0: 79, y0: 46, x1: 81, y1: 47 });
    expect(footprintRect(fixtureEdit(80, 46, 81, 47, 16, 3))).toEqual({ x0: 80, y0: 45, x1: 81, y1: 47 });
    expect(footprintRect(fixtureEdit(80, 46, 81, 47, 1, 1))).toEqual({ x0: 80, y0: 46, x1: 81, y1: 47 });
  });
});

describe('fixture place command carries rotation', () => {
  it('lays a two cell fixture with its tail in the rotated direction', () => {
    const sim = ownedSim();
    sim.cash = 100_000_000;
    buildTestAirport(sim, { standsPerRow: 8 });
    expect(buildTestTerminal(sim)).toEqual([]);
    const g = sim.business.grids[0];
    expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: fixtureEdit(84, 44, 85, 45, 16, 1) })).toEqual([]);
    const anchor = cellIndex(g, 84, 44);
    const tail = cellIndex(g, 84, 45);
    expect(g.fixture[anchor]).toBe(16);
    expect(g.fixtureRot[anchor]).toBe(2);
    expect(g.fixture[tail]).toBe(16);
    expect(g.fixtureRot[tail]).toBe(6);
    expect(g.fixture[cellIndex(g, 85, 44)]).toBe(0);
  });
});
