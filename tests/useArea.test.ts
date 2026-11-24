import { describe, expect, it } from 'vitest';
import { EMPTY_AIRFIELD } from '@shared/airfield';
import { FIXTURE_KEYS, FLOOR, WALL, type TerminalGrid } from '@shared/business';
import type { BuildContext } from '@shared/validate';
import { cellIndex, ensureCells, hEdgeIndex, newGrid, planEdit } from '@shared/terminalOps';
import { fixtureUseCells, frontStep, planPropWithUse, propUseRect } from '@shared/useArea';
import { buildTestAirport, buildTestTerminal, ownedSim, run } from './helpers';

const env = { ctx: {} as BuildContext, af: EMPTY_AIRFIELD, others: [] as TerminalGrid[] };
const CHECK_IN = FIXTURE_KEYS.indexOf('checkIn') + 1;
const KIOSK = FIXTURE_KEYS.indexOf('kiosk') + 1;
const GATE_DESK = FIXTURE_KEYS.indexOf('gateDesk') + 1;

function floorGrid(): TerminalGrid {
  const g = newGrid(1, 0, 0, 90);
  ensureCells(g, 0, 0, 32, 32);
  g.floor.fill(FLOOR.Concrete);
  return g;
}

const fixture = (g: TerminalGrid, x: number, y: number, variant: number, rot: 0 | 1 | 2 | 3 = 0) => planEdit(g, { op: 'fixture', x0: x, y0: y, x1: x + 1, y1: y + 1, variant, rot }, env);

describe('use areas (T85)', () => {
  it('puts the front one quarter turn after the direction, so it turns with the fixture', () => {
    expect(frontStep(0)).toEqual([0, 1]);
    expect(frontStep(1)).toEqual([-1, 0]);
    expect(frontStep(2)).toEqual([0, -1]);
    expect(frontStep(3)).toEqual([1, 0]);
    const cells = fixtureUseCells('checkIn', 1, 10, 10, 0);
    expect(cells.filter((c) => !c.back).map((c) => [c.x, c.y])).toEqual([[10, 11]]);
    expect(cells.filter((c) => c.back).map((c) => [c.x, c.y])).toEqual([[10, 9]]);
    const gate = fixtureUseCells('gateDesk', 1, 10, 10, 1);
    expect(gate.filter((c) => !c.back).map((c) => [c.x, c.y])).toEqual([[9, 10], [9, 11]]);
  });

  it('refuses a fixture whose use area holds a wall, a fixture or no floor', () => {
    const walled = floorGrid();
    walled.hWall[hEdgeIndex(walled, 10, 11)] = WALL.Wall;
    expect(fixture(walled, 10, 10, CHECK_IN).problem?.code).toBe('useAreaBlocked');
    // A kiosk has no staff side, so turned away from the wall it fits; a desk still needs its back clear.
    expect(fixture(walled, 10, 10, KIOSK, 2).problem).toBeNull();
    expect(fixture(walled, 10, 10, CHECK_IN, 2).problem?.code).toBe('useAreaBlocked');
    const edge = floorGrid();
    expect(fixture(edge, 10, 0, CHECK_IN).problem?.code).toBe('useAreaBlocked');
    const g = floorGrid();
    fixture(g, 10, 11, CHECK_IN).apply();
    expect(fixture(g, 10, 10, CHECK_IN).problem?.code).toBe('useAreaBlocked');
  });

  it('refuses a fixture that lands on the use area of one already placed, and lets a row of desks fill side by side', () => {
    const g = floorGrid();
    fixture(g, 10, 10, CHECK_IN).apply();
    expect(fixture(g, 10, 9, GATE_DESK).problem?.code).toBe('useAreaBlocked');
    const row = planEdit(g, { op: 'fixture', x0: 11, y0: 10, x1: 16, y1: 11, variant: CHECK_IN, rot: 0 }, env);
    expect(row.problem).toBeNull();
    expect(row.changes).toBe(5);
  });

  it('a drag over two rows facing each other places only the first row, with no problem', () => {
    const g = floorGrid();
    const plan = planEdit(g, { op: 'fixture', x0: 10, y0: 10, x1: 13, y1: 12, variant: CHECK_IN, rot: 0 }, env);
    expect(plan.problem).toBeNull();
    expect(plan.changes).toBe(3);
  });

  it('gives a seat a front strip and refuses another item on it', () => {
    const g = floorGrid();
    const bench = { asset: 'bench.beam3', x: 20, y: 20, rot: 0 as const };
    expect(propUseRect(bench)).not.toBeNull();
    g.props.push(bench);
    const strip = propUseRect(bench)!;
    expect(planPropWithUse(g, { asset: 'bench.beam3', x: 20, y: strip.sy0 * 0.5, rot: 0 }).problem?.code).toBe('useAreaBlocked');
    expect(planPropWithUse(g, { asset: 'bench.beam3', x: 20, y: strip.sy1 * 0.5, rot: 0 }).problem).toBeNull();
  });

  it('stores the direction of one cell desks placed by the test terminal', () => {
    const sim = ownedSim();
    buildTestAirport(sim);
    expect(buildTestTerminal(sim, { atc: false })).toEqual([]);
    const g = sim.business.grids[0]!;
    const desk = cellIndex(g, 42, 42);
    expect(g.fixtureRot[desk]).toBe(1);
  });

  it('is deterministic with rotated one cell fixtures', () => {
    const go = (): number => {
      const sim = ownedSim();
      buildTestAirport(sim);
      buildTestTerminal(sim, { atc: false });
      const g = sim.business.grids[0]!;
      run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: { op: 'fixture', x0: 56, y0: 46, x1: 58, y1: 47, variant: CHECK_IN, rot: 2 } });
      sim.enqueue({ type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
      for (let i = 0; i < 2000; i++) sim.step();
      return sim.stateHash();
    };
    expect(go()).toBe(go());
  });
});
