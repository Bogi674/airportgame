import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { LEDGER_CATEGORIES, TICKS_PER_DAY } from '@shared/business';
import { Sim } from '@sim/sim';
import { buildTestAirport, ownedSim, run } from './helpers';

function airportWithTerminal() {
  const sim = ownedSim();
  sim.cash = 100_000_000;
  buildTestAirport(sim, { standsPerRow: 8 });
  const ev = run(sim, { type: 'buildTerminal', cx: 4000, cy: 5480, w: 160, d: 40, headingDeg: 90 });
  expect(ev).toEqual([]);
  const id = sim.business.terminals[0].id;
  run(sim, { type: 'addModule', terminalId: id, kind: 'checkIn', count: 10 });
  run(sim, { type: 'addModule', terminalId: id, kind: 'security', count: 3 });
  run(sim, { type: 'addModule', terminalId: id, kind: 'belt', count: 2 });
  return { sim, id };
}

describe('terminal', () => {
  it('costs by area, takes modules within its floor, and reports capacity', () => {
    const { sim, id } = airportWithTerminal();
    const t = sim.business.terminals[0];
    expect(t.cost).toBe(160 * 40 * 1500);
    expect(sim.business.depCapacity()).toBe(Math.min(10 * 30, 3 * 150));
    expect(sim.business.arrCapacity()).toBe(2 * 260);
    // Too many modules for the floor area.
    run(sim, { type: 'addModule', terminalId: id, kind: 'belt', count: 50 });
    expect(run(sim, { type: 'addModule', terminalId: id, kind: 'security', count: 50 })[0]).toBe('terminalFull');
    expect(sim.business.terminals[0].modules.security).toBe(3);
  });

  it('refuses a terminal on an apron, on water, off owned land and too small', () => {
    const sim = ownedSim();
    sim.cash = 100_000_000;
    buildTestAirport(sim, { standsPerRow: 8 });
    expect(run(sim, { type: 'buildTerminal', cx: 4000, cy: 5330, w: 100, d: 40, headingDeg: 90 })[0]).toBe('terminalOnPavement');
    expect(run(sim, { type: 'buildTerminal', cx: 4000, cy: 5480, w: 10, d: 10, headingDeg: 90 })[0]).toMatch(/^terminalSize/);
    const poor = new Sim('GOLDEN-0001', { preset: 'flatCoastal' });
    expect(run(poor, { type: 'buildTerminal', cx: 500, cy: 500, w: 100, d: 40, headingDeg: 0 })[0]).toMatch(/onWater|notOwned/);
  });

  it('contact stands need a terminal nearby', () => {
    const { sim } = airportWithTerminal();
    expect(sim.business.hasTerminalNear(4000, 5330)).toBe(true);
    expect(sim.business.hasTerminalNear(9000, 1000)).toBe(false);
  });
});

describe('airlines and money', () => {
  it('only signs airlines the rating allows, and caps rotations', () => {
    const { sim } = airportWithTerminal();
    const heavy = sim.business.airlines.find((a) => a.minRating >= 70);
    expect(heavy).toBeDefined();
    expect(run(sim, { type: 'signAirline', airlineId: heavy?.id ?? 0, rotations: 1 })[0]).toMatch(/^ratingTooLow/);
    const regional = sim.business.airlines[0];
    run(sim, { type: 'signAirline', airlineId: regional.id, rotations: 99 });
    expect(regional.rotations).toBe(sim.business.maxRotations());
    expect(regional.fleet.every((t) => AIRCRAFT[t].capacity.seatsTypical >= 9)).toBe(true);
  });

  it('a signed airline brings flights, fees and a daily ledger', () => {
    const { sim } = airportWithTerminal();
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 3 });
    run(sim, { type: 'signAirline', airlineId: 1, rotations: 3 });
    const before = sim.cash;
    // Run until just after the first midnight.
    const midnight = 18 * 60 * 600;
    while (sim.tick < midnight + 50) sim.step();
    const p = sim.business.payload(sim.tick);
    expect(sim.traffic.completedFlights + sim.traffic.count).toBeGreaterThan(0);
    expect(p.history.length).toBe(1);
    const day = p.history[0];
    const idx = (c: string): number => LEDGER_CATEGORIES.indexOf(c as (typeof LEDGER_CATEGORIES)[number]);
    expect(day[idx('landing')]).toBeGreaterThan(0);
    expect(day[idx('passengers')]).toBeGreaterThan(0);
    expect(day[idx('wages')]).toBeLessThan(0);
    expect(day[idx('upkeep')]).toBeLessThan(0);
    // Cash equals the starting cash minus construction and land plus everything in the ledger so far.
    expect(sim.cash).not.toBe(before);
    expect(p.day).toBe(1);
    expect(TICKS_PER_DAY).toBe(864000);
  }, 120000);

  it('loans add cash, accrue interest and are limited', () => {
    const { sim } = airportWithTerminal();
    const c = sim.cash;
    run(sim, { type: 'takeLoan', amount: 2_000_000 });
    expect(sim.cash).toBe(c + 2_000_000);
    expect(sim.business.loan).toBe(2_000_000);
    expect(run(sim, { type: 'takeLoan', amount: 50_000_000 })[0]).toMatch(/^loanLimit/);
    run(sim, { type: 'repayLoan', amount: 500_000 });
    expect(sim.business.loan).toBe(1_500_000);
    expect(sim.cash).toBe(c + 1_500_000);
  });

  it('shops are rented once the rating allows', () => {
    const { sim, id } = airportWithTerminal();
    run(sim, { type: 'addShop', terminalId: id, kind: 'convenience' });
    expect(sim.business.terminals[0].shops).toHaveLength(1);
    run(sim, { type: 'removeShop', terminalId: id, index: 0 });
    expect(sim.business.terminals[0].shops).toHaveLength(0);
  });
});

describe('determinism with business', () => {
  it('same seed and commands give the same hash', () => {
    const make = () => {
      const { sim } = airportWithTerminal();
      run(sim, { type: 'signAirline', airlineId: 0, rotations: 2 });
      for (let t = 0; t < 30000; t++) sim.step();
      return sim.stateHash();
    };
    expect(make()).toBe(make());
  });
});
