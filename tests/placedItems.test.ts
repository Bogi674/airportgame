import { describe, expect, it } from 'vitest';
import { FIXTURE_KEYS } from '@shared/business';
import { cellIndex } from '@shared/terminalOps';
import type { Sim } from '@sim/sim';
import { buildTestAirport, buildTestTerminal, ownedSim, run } from './helpers';

const CHECK_IN = FIXTURE_KEYS.indexOf('checkIn') + 1;

function scene(): Sim {
  const sim = ownedSim();
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, { atc: false })).toEqual([]);
  return sim;
}

const grid = (sim: Sim) => sim.business.grids[0]!;

describe('placed fixtures and props (T85)', () => {
  it('removes a fixture, keeps its floor and gives no refund', () => {
    const sim = scene();
    const g = grid(sim);
    const cash = sim.cash;
    const checkIns = sim.business.terminals[0]!.counts.checkIn;
    expect(run(sim, { type: 'removeFixture', building: g.id, x: 42, y: 42 })).toEqual([]);
    expect(g.fixture[cellIndex(g, 42, 42)]).toBe(0);
    expect(g.floor[cellIndex(g, 42, 42)]).toBeGreaterThan(0);
    expect(sim.cash).toBe(cash);
    expect(sim.business.terminals[0]!.counts.checkIn).toBe(checkIns - 1);
    expect(run(sim, { type: 'removeFixture', building: g.id, x: 42, y: 42 })).toEqual(['nothingThere']);
  });

  it('moves and turns a fixture for free, keeping its level, and undo puts it back', () => {
    const sim = scene();
    const g = grid(sim);
    const cash = sim.cash;
    expect(run(sim, { type: 'moveFixture', building: g.id, x: 49, y: 42, toX: 56, toY: 46, rot: 2 })).toEqual([]);
    expect(g.fixture[cellIndex(g, 49, 42)]).toBe(0);
    expect(g.fixture[cellIndex(g, 56, 46)]).toBe(CHECK_IN);
    expect(g.fixtureRot[cellIndex(g, 56, 46)]).toBe(3);
    expect(g.fixtureLevel[cellIndex(g, 56, 46)]).toBe(1);
    expect(sim.cash).toBe(cash);
    expect(run(sim, { type: 'undo' })).toEqual([]);
    expect(grid(sim).fixture[cellIndex(grid(sim), 49, 42)]).toBe(CHECK_IN);
    expect(grid(sim).fixture[cellIndex(grid(sim), 56, 46)]).toBe(0);
  });

  it('refuses a move onto a blocked spot and leaves the fixture where it was', () => {
    const sim = scene();
    const g = grid(sim);
    // Right in front of the desk next door, so its use area is taken.
    expect(run(sim, { type: 'moveFixture', building: g.id, x: 49, y: 42, toX: 48, toY: 43, rot: 0 })).toEqual(['useAreaBlocked']);
    expect(g.fixture[cellIndex(g, 49, 42)]).toBe(CHECK_IN);
    expect(g.fixture[cellIndex(g, 48, 43)]).toBe(0);
  });

  it('moves and turns a prop for free', () => {
    const sim = scene();
    const g = grid(sim);
    const n = g.props.length;
    const cash = sim.cash;
    const p = g.props[0]!;
    expect(run(sim, { type: 'moveProp', building: g.id, x: p.x + 0.1, y: p.y + 0.1, toX: 120, toY: 100, rot: 1 })).toEqual([]);
    expect(g.props.length).toBe(n);
    expect(g.props[0]).toEqual({ asset: p.asset, x: 120, y: 100, rot: 1 });
    expect(sim.cash).toBe(cash);
  });

  it('is deterministic with moves and removals', () => {
    const go = (): number => {
      const sim = scene();
      const g = grid(sim);
      run(sim, { type: 'moveFixture', building: g.id, x: 49, y: 42, toX: 56, toY: 46, rot: 2 }, { type: 'removeFixture', building: g.id, x: 42, y: 42 });
      sim.enqueue({ type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
      for (let i = 0; i < 2000; i++) sim.step();
      return sim.stateHash();
    };
    expect(go()).toBe(go());
  });
});
