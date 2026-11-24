import { describe, expect, it } from 'vitest';
import type { Sim } from '@sim/sim';
import type { Command } from '@sim/commands';
import { originFor } from '@shared/terminalOps';
import { buildTestAirport, buildTestTerminal, ownedSim, run } from './helpers';

/** A sim with a runway and stands, then a terminal: the terminal edits come after the airfield ones. */
function scene(): Sim {
  const sim = ownedSim();
  buildTestAirport(sim, { ground: false });
  return sim;
}

function grid(sim: Sim) {
  return sim.business.grids[0]!;
}

function terminalEdit(building: number, edit: object): Command {
  const { ox, oy } = originFor(3960, 5440, 90);
  return { type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: edit as never };
}

describe('shared undo history (T85)', () => {
  it('undoes a terminal edit before the airfield built earlier', () => {
    const sim = scene();
    const runways = sim.airfield.data.runways.length;
    const stands = sim.airfield.data.stands.length;
    expect(run(sim, terminalEdit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 50, y1: 46, variant: 0 }))).toEqual([]);
    const id = grid(sim).id;
    const cash = sim.cash;
    expect(run(sim, terminalEdit(id, { op: 'wall', x0: 40, y0: 40, x1: 50, y1: 40, variant: 1 }))).toEqual([]);
    const spent = cash - sim.cash;
    expect(spent).toBeGreaterThan(0);
    expect(run(sim, { type: 'undo' })).toEqual([]);
    expect(Array.from(grid(sim).hWall).every((v) => v === 0)).toBe(true);
    expect(sim.cash).toBe(cash);
    expect(sim.airfield.data.runways.length).toBe(runways);
    expect(sim.airfield.data.stands.length).toBe(stands);
    // The next undo removes the whole building, and only then does undo reach the airfield.
    expect(run(sim, { type: 'undo' })).toEqual([]);
    expect(sim.business.grids.length).toBe(0);
    expect(sim.airfield.data.stands.length).toBe(stands);
    expect(run(sim, { type: 'undo' })).toEqual([]);
    expect(sim.airfield.data.stands.length).toBeLessThan(stands);
  });

  it('redoes terminal steps in order and books their cost again', () => {
    const sim = scene();
    run(sim, terminalEdit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 50, y1: 46, variant: 0 }));
    const id = grid(sim).id;
    run(sim, terminalEdit(id, { op: 'floor', x0: 40, y0: 40, x1: 50, y1: 46, variant: 2 }));
    const floor = grid(sim).floor.slice();
    const cash = sim.cash;
    run(sim, { type: 'undo' }, { type: 'undo' });
    expect(sim.business.grids.length).toBe(0);
    expect(run(sim, { type: 'redo' }, { type: 'redo' })).toEqual([]);
    expect(Array.from(grid(sim).floor)).toEqual(Array.from(floor));
    expect(sim.cash).toBe(cash);
    expect(sim.canRedo).toBe(false);
  });

  it('undoes props and demolition with their refunds', () => {
    const sim = scene();
    expect(buildTestTerminal(sim, { atc: false })).toEqual([]);
    const props = grid(sim).props.length;
    const cash = sim.cash;
    expect(run(sim, { type: 'placeProp', building: grid(sim).id, asset: 'bench.beam3', x: 120, y: 100, rot: 0 })).toEqual([]);
    expect(grid(sim).props.length).toBe(props + 1);
    run(sim, { type: 'undo' });
    expect(grid(sim).props.length).toBe(props);
    expect(sim.cash).toBe(cash);
    const id = grid(sim).id;
    run(sim, { type: 'demolishTerminal', id });
    expect(sim.business.grids.length).toBe(0);
    expect(run(sim, { type: 'undo' })).toEqual([]);
    expect(grid(sim).id).toBe(id);
    expect(grid(sim).props.length).toBe(props);
    expect(sim.cash).toBe(cash);
  });

  it('a new action ends the redo branch', () => {
    const sim = scene();
    run(sim, terminalEdit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 50, y1: 46, variant: 0 }));
    run(sim, { type: 'undo' });
    expect(sim.canRedo).toBe(true);
    run(sim, terminalEdit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 44, y1: 44, variant: 0 }));
    expect(sim.canRedo).toBe(false);
  });

  it('is deterministic: the same commands with undo and redo give the same state hash', () => {
    const go = (): number => {
      const sim = scene();
      buildTestTerminal(sim, { atc: false });
      const id = grid(sim).id;
      run(sim, terminalEdit(id, { op: 'wall', x0: 60, y0: 40, x1: 60, y1: 46, variant: 2 }), { type: 'undo' }, { type: 'redo' }, { type: 'undo' });
      for (let i = 0; i < 2000; i++) sim.step();
      return sim.stateHash();
    };
    expect(go()).toBe(go());
  });
});
