import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { LEDGER_CATEGORIES, TICKS_PER_DAY } from '@shared/business';
import { Sim } from '@sim/sim';
import { cellIndex, floorBounds, originFor } from '@shared/terminalOps';
import { buildTestAirport, buildTestControlRoom, buildTestTerminal, ownedSim, run } from './helpers';

function airportWithTerminal() {
  const sim = ownedSim();
  sim.cash = 100_000_000;
  buildTestAirport(sim, { standsPerRow: 8 });
  expect(buildTestTerminal(sim)).toEqual([]);
  return { sim, id: sim.business.grids[0].id };
}

describe('terminal built from foundations, flooring, walls and fixtures', () => {
  it('prices every layer, and capacity comes from the fixtures laid', () => {
    const { sim } = airportWithTerminal();
    const g = sim.business.grids[0];
    const cells = 60 * 12;
    expect(sim.business.terminals[0].cells).toBe(cells);
    expect(sim.business.terminals[0].counts.checkIn).toBe(8);
    expect(sim.business.depCapacity()).toBe(Math.min(8 * 30, 3 * 150));
    expect(sim.business.arrCapacity()).toBe(2 * 260);
    // Foundation, tile, 2 walls of 60 edges plus a door, and the fixtures.
    const expected = cells * (2000 + 480) + 129 * 300 + 2 * 1500 + (8 * 9000 + 3 * 70000 + 2 * 55000 + 6 * 6000 + 2 * 20000);
    expect(g.cost).toBe(expected);
  });

  it('is custom: a different layout gives different capacity and cost', () => {
    const a = ownedSim();
    a.cash = 100_000_000;
    buildTestAirport(a, { standsPerRow: 4 });
    buildTestTerminal(a, { checkIn: 2, security: 1, belt: 1 });
    const b = airportWithTerminal().sim;
    expect(a.business.depCapacity()).toBeLessThan(b.business.depCapacity());
    expect(a.business.grids[0].cost).toBeLessThan(b.business.grids[0].cost);
  });

  it('fixtures need a foundation, and erasing removes them and their walls', () => {
    const { sim, id } = airportWithTerminal();
    const at = (e: object) => run(sim, { type: 'terminalBuild', building: id, ox: sim.business.grids[0].ox, oy: sim.business.grids[0].oy, headingDeg: 90, edit: e as never });
    expect(at({ op: 'fixture', x0: 10, y0: 10, x1: 12, y1: 11, variant: 1 })[0]).toBe('terminalNeedsFoundation');
    at({ op: 'erase', x0: 42, y0: 42, x1: 50, y1: 43, variant: 0 });
    expect(sim.business.terminals[0].counts.checkIn).toBe(0);
    expect(sim.business.terminals[0].cells).toBe(60 * 12 - 8);
    // Erase the whole foundation: the building goes away.
    at({ op: 'erase', x0: 40, y0: 40, x1: 100, y1: 52, variant: 0 });
    expect(sim.business.grids).toHaveLength(0);
  });

  it('refuses a foundation on a pavement and on unowned land, but not past the old grid edge', () => {
    const sim = ownedSim();
    sim.cash = 100_000_000;
    buildTestAirport(sim, { standsPerRow: 8 });
    const { ox, oy } = originFor(4000, 5330, 90);
    expect(run(sim, { type: 'terminalBuild', building: -1, ox, oy, headingDeg: 90, edit: { op: 'foundation', x0: 40, y0: 40, x1: 50, y1: 46, variant: 0 } })[0]).toBe('terminalOnPavement');
    const free = originFor(4000, 5600, 90);
    // The fixed 160 cell grid is gone (docs/DESIGN_REVISION_2.md section 5): this reaches past its old edge.
    expect(run(sim, { type: 'terminalBuild', building: -1, ox: free.ox, oy: free.oy, headingDeg: 90, edit: { op: 'foundation', x0: 150, y0: 40, x1: 170, y1: 50, variant: 0 } })).toEqual([]);
    const poor = new Sim('GOLDEN-0001', { preset: 'flatCoastal' });
    const o2 = originFor(500, 500, 0);
    expect(run(poor, { type: 'terminalBuild', building: -1, ox: o2.ox, oy: o2.oy, headingDeg: 0, edit: { op: 'foundation', x0: 40, y0: 40, x1: 50, y1: 50, variant: 0 } })[0]).toMatch(/onWater|notOwned/);
  });

  it('builds a 640 by 120 m terminal and extends it in every direction (revision 2 test 7)', () => {
    const sim = ownedSim();
    sim.cash = 500_000_000;
    const { ox, oy } = originFor(3000, 6300, 90);
    const edit = (building: number, e: object): string[] => run(sim, { type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e as never });
    expect(edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 360, y1: 100, variant: 0 })).toEqual([]);
    const g = sim.business.grids[0];
    expect(sim.business.terminals[0].cells).toBe(320 * 60);
    expect(sim.business.terminals[0].cells * 4).toBe(76800);
    // Extending left and up past the original corner keeps every existing cell where it was.
    expect(edit(g.id, { op: 'foundation', x0: -20, y0: 30, x1: 40, y1: 40, variant: 0 })).toEqual([]);
    expect(sim.business.terminals[0].cells).toBe(320 * 60 + 60 * 10);
    expect(g.x0).toBeLessThanOrEqual(-20);
    expect(edit(g.id, { op: 'fixture', x0: 350, y0: 90, x1: 352, y1: 91, variant: 1 })).toEqual([]);
    expect(sim.business.terminals[0].counts.checkIn).toBe(2);
    // The grid grows in 64 m chunks and allocates only the bounds it needs, not a fixed square.
    expect(g.w % 32).toBe(0);
    expect(g.h % 32).toBe(0);
    const b = floorBounds(g);
    if (!b) throw new Error('no floor');
    expect(g.w * g.h).toBeLessThanOrEqual((b.x1 - b.x0 + 1 + 64) * (b.y1 - b.y0 + 1 + 64));
  });

  it('two buildings cannot share a cell', () => {
    const { sim } = airportWithTerminal();
    const { ox, oy } = originFor(4000, 5450, 90);
    expect(run(sim, { type: 'terminalBuild', building: -1, ox, oy, headingDeg: 90, edit: { op: 'foundation', x0: 40, y0: 40, x1: 46, y1: 44, variant: 0 } })[0]).toBe('terminalOverlap');
  });

  it('walls and doors are laid on grid lines and priced per edge', () => {
    const { sim, id } = airportWithTerminal();
    const g = sim.business.grids[0];
    const before = sim.cash;
    run(sim, { type: 'terminalBuild', building: id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: { op: 'wall', x0: 60, y0: 40, x1: 60, y1: 46, variant: 2 } });
    expect(before - sim.cash).toBe(6 * 700);
    expect(run(sim, { type: 'terminalBuild', building: id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: { op: 'wall', x0: 60, y0: 40, x1: 62, y1: 42, variant: 1 } })[0]).toBe('wallStraight');
  });

  it('contact stands need a terminal building nearby', () => {
    const { sim } = airportWithTerminal();
    expect(sim.business.hasTerminalNear(4000, 5420)).toBe(true);
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

  it('shop fixtures are rented once the rating allows', () => {
    const sim = ownedSim();
    sim.cash = 100_000_000;
    buildTestAirport(sim, { standsPerRow: 8 });
    buildTestTerminal(sim, { shop: true });
    expect(sim.business.terminals[0].counts.convenience).toBe(1);
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

describe('zones, control room and slots', () => {
  it('fixtures take the zone they belong in and refuse a conflicting one', () => {
    const { sim, id } = airportWithTerminal();
    const g = sim.business.grids[0];
    const zoneAt = (x: number, y: number): number => g.zone[cellIndex(g, x, y)];
    expect(zoneAt(42, 42)).toBe(1);
    expect(zoneAt(76, 46)).toBe(3);
    const at = (e: object) => run(sim, { type: 'terminalBuild', building: id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: e as never });
    expect(at({ op: 'zone', x0: 60, y0: 44, x1: 64, y1: 46, variant: 2 })).toEqual([]);
    expect(zoneAt(60, 44)).toBe(2);
    // A check in desk does not fit the commercial zone.
    expect(at({ op: 'fixture', x0: 60, y0: 44, x1: 61, y1: 45, variant: 1 })[0]).toBe('wrongZone');
    // Painting staff only over a check in desk is refused.
    expect(at({ op: 'zone', x0: 42, y0: 42, x1: 43, y1: 43, variant: 4 })[0]).toBe('zoneHasFixture');
  });

  it('flights need an ATC tower, and zones decide capacity', () => {
    const a = ownedSim();
    a.cash = 100_000_000;
    buildTestAirport(a, { standsPerRow: 4 });
    buildTestTerminal(a, { atc: false });
    expect(a.business.readiness()).toContain('noAtc');
    const full = a.business.depCapacity();
    expect(full).toBeGreaterThan(0);
    const b = ownedSim();
    b.cash = 100_000_000;
    buildTestAirport(b, { standsPerRow: 4 });
    buildTestTerminal(b);
    expect(b.business.readiness()).toEqual([]);
    expect(b.business.atcOk).toBe(true);
  });

  it('a legacy control room grants no ATC coverage', () => {
    const sim = ownedSim();
    sim.cash = 100_000_000;
    buildTestAirport(sim, { standsPerRow: 4 });
    buildTestTerminal(sim, { atc: false });
    expect(buildTestControlRoom(sim)).toEqual([]);
    expect(sim.business.atcCells).toBeGreaterThanOrEqual(4);
    expect(sim.business.atcOk).toBe(false);
    expect(sim.business.readiness()).toContain('noAtc');
  });

  it('slots default across the day, can be moved, and survive fewer rotations', () => {
    const { sim } = airportWithTerminal();
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 2 });
    const al = sim.business.airlines[0];
    expect(al.slots).toHaveLength(2);
    expect(al.slots[0]).toBeLessThan(al.slots[1]);
    run(sim, { type: 'setSlot', airlineId: 0, index: 0, minute: 13 * 60 + 15 });
    expect(sim.business.airlines[0].slots[0]).toBe(13 * 60 + 15);
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 1 });
    expect(sim.business.airlines[0].slots).toEqual([13 * 60 + 15]);
  });
});

describe('room validation', () => {
  it('a lane in the wall opening works, a gap in the wall is a security bypass, no lane is a missing link', () => {
    const { sim, id } = airportWithTerminal();
    expect(sim.business.roomIssues).toEqual([]);
    expect(sim.business.depCapacity()).toBeGreaterThan(0);
    const g = sim.business.grids[0];
    const at = (e: object) => run(sim, { type: 'terminalBuild', building: id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: e as never });
    // Open another gap in the wall beside the lanes: passengers can bypass security.
    at({ op: 'removeWall', x0: 72, y0: 48, x1: 72, y1: 49, variant: 0 });
    expect(sim.business.roomIssues).toContain('securityBypass');
    expect(sim.business.depCapacity()).toBe(0);
    at({ op: 'wall', x0: 72, y0: 48, x1: 72, y1: 49, variant: 1 });
    expect(sim.business.roomIssues).toEqual([]);
    // Close the opening in the wall and the lanes can no longer be reached.
    at({ op: 'wall', x0: 72, y0: 42, x1: 72, y1: 45, variant: 1 });
    expect(sim.business.roomIssues).toContain('noSecurityLink');
  });
});
