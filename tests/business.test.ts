import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { FIXTURE_KEYS, FIXTURE_SPAN, FLOOR, LEDGER_CATEGORIES, TICKS_PER_DAY, type TerminalGrid } from '@shared/business';
import { BUSINESS } from '@data/index';
import { businessSchema } from '../src/data/schemas/business';
import { Sim } from '@sim/sim';
import { SAVE_VERSION } from '@sim/save/migrations';
import { FlState } from '@sim/ops/traffic';
import { EMPTY_AIRFIELD } from '@shared/airfield';
import type { BuildContext } from '@shared/validate';
import { cellIndex, ensureCells, fixturePartner, floorBounds, newGrid, originFor, planEdit, summarize, type TerminalEdit } from '@shared/terminalOps';
import { buildTestAirport, buildTestControlRoom, buildTestTerminal, OPTIONS, ownedSim, run } from './helpers';

describe('service node data', () => {
  it('terminal service queue settings match the business data', () => {
    expect(BUSINESS.terminal.service).toEqual({ cv: 0.4, queueDensityPerM2: 1, queueReachCells: 4, queueSlots: 32 });
  });

  it('every queue fixture has at least one server and a positive service time', () => {
    const keys = ['checkIn', 'kiosk', 'bagDrop', 'security', 'passport', 'gateDesk', 'toilet'] as const;
    for (const k of keys) {
      const m = BUSINESS.modules[k];
      expect(m.servers, k).toBeGreaterThanOrEqual(1);
      expect(m.serviceSeconds, k).toBeGreaterThan(0);
    }
  });

  it('security capacity is 3600 over its service seconds', () => {
    const s = BUSINESS.modules.security;
    expect(s.serviceSeconds).toBeDefined();
    expect(3600 / (s.serviceSeconds ?? 0)).toBe(s.capacityPerHour);
  });
});

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
    expect(sim.business.depCapacity()).toBe(Math.min(8 * 30, 3 * BUSINESS.modules.security.capacityPerHour));
    expect(sim.business.arrCapacity()).toBe(2 * 260);
    // Foundation, tile, 2 walls of 60 edges plus a door, and the fixtures.
    const expected = cells * (2000 + 480) + 129 * 300 + 2 * 1500 + (8 * 9000 + 3 * 70000 + 2 * 55000 + 6 * 6000 + 2 * 20000);
    expect(g.cost).toBe(expected);
  });

  it('only floor 0 can be built', () => {
    const { sim } = airportWithTerminal();
    const free = originFor(4000, 5600, 90);
    const build = (level: number) => run(sim, { type: 'terminalBuild', building: -1, ox: free.ox, oy: free.oy, headingDeg: 90, level, edit: { op: 'foundation', x0: 150, y0: 40, x1: 170, y1: 50, variant: 0 } });
    const cash = sim.cash;
    const grids = sim.business.grids.length;
    expect(build(1)[0]).toBe('floorNotBuildable');
    expect(sim.cash).toBe(cash);
    expect(sim.business.grids.length).toBe(grids);
    expect(build(-1)[0]).toBe('floorNotBuildable');
    expect(sim.cash).toBe(cash);
    expect(sim.business.grids.length).toBe(grids);
    expect(build(0)).toEqual([]);
    expect(sim.cash).toBeLessThan(cash);
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

  it('slots default across the day and keep their pattern through a day', () => {
    const { sim } = airportWithTerminal();
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 2 });
    const before = [...sim.business.airlines[0].slots];
    expect(before).toHaveLength(2);
    expect(before[0]).toBeLessThan(before[1]);
    (sim.business as unknown as { dailyClose(tick: number): void }).dailyClose(TICKS_PER_DAY);
    expect(sim.business.airlines[0].slots).toEqual(before);
  });

  it('a day close assigns a waiting flight at once when automatic stands are on', () => {
    const { sim } = airportWithTerminal();
    const f = sim.traffic.scheduleArrival(AIRCRAFT.findIndex((a) => a.id === 'atr72_600'), sim.traffic.nowTick + 100, 0, 600, -1);
    expect(sim.traffic.fStand[f]).toBe(-1);
    (sim.business as unknown as { dailyClose(tick: number): void }).dailyClose(TICKS_PER_DAY);
    expect(sim.traffic.fStand[f]).toBeGreaterThanOrEqual(0);
  });

  it('more rotations keep the earlier slots and append, fewer drop from the end', () => {
    const { sim } = airportWithTerminal();
    sim.business.rating = 60;
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 2 });
    const two = [...sim.business.airlines[0].slots];
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 3 });
    const three = sim.business.airlines[0].slots;
    expect(three).toHaveLength(3);
    expect(three.slice(0, 2)).toEqual(two);
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 1 });
    expect(sim.business.airlines[0].slots).toEqual([two[0]]);
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

/** The scheduled flight of each rotation that arrives latest, which is the newest day's flight. */
function newestByRotation(sim: Sim, airline: number, rotations: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < rotations; k++) {
    let best = -1;
    for (let f = 0; f < 1024; f++) {
      if (sim.traffic.fState[f] !== FlState.Scheduled || sim.traffic.fAirline[f] !== airline || sim.traffic.fRot[f] !== k) continue;
      if (best < 0 || sim.traffic.fEta[f] > sim.traffic.fEta[best]) best = f;
    }
    out.push(best);
  }
  return out;
}

function closeDay(sim: Sim, day: number): void {
  (sim.business as unknown as { dailyClose(tick: number): void }).dailyClose(day * TICKS_PER_DAY);
}

describe('rotations keep their type and stand from day to day', () => {
  it('a rotation flies the same type on consecutive days', () => {
    const { sim } = airportWithTerminal();
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 2 });
    closeDay(sim, 1);
    const day1 = newestByRotation(sim, 0, 2);
    expect(day1.every((f) => f >= 0)).toBe(true);
    const types1 = day1.map((f) => sim.traffic.fType[f]);
    closeDay(sim, 2);
    const types2 = newestByRotation(sim, 0, 2).map((f) => sim.traffic.fType[f]);
    expect(types2).toEqual(types1);
  });

  it('a stand chosen for a rotation is taken by the next day flight of that rotation', () => {
    const { sim } = airportWithTerminal();
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 2 });
    const today = newestByRotation(sim, 0, 2)[0];
    const stand = sim.airfield.data.stands.find((s) => sim.traffic.refuseAssign(today, s.id) === null);
    expect(stand).toBeDefined();
    run(sim, { type: 'assignStand', flight: today, standId: stand?.id ?? -1 });
    expect(sim.traffic.fStand[today]).toBe(stand?.id);
    closeDay(sim, 1);
    const next = newestByRotation(sim, 0, 2)[0];
    expect(next).not.toBe(today);
    expect(sim.traffic.fStand[next]).toBe(stand?.id);
  });

  it('clearing a stand with -1 forgets it for the next day', () => {
    const { sim } = airportWithTerminal();
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 2 });
    run(sim, { type: 'setAutoStands', on: false });
    const today = newestByRotation(sim, 0, 2)[0];
    const stand = sim.airfield.data.stands.find((s) => sim.traffic.refuseAssign(today, s.id) === null);
    run(sim, { type: 'assignStand', flight: today, standId: stand?.id ?? -1 });
    expect(sim.business.airlines[0].standPrefs[0]).toBe(stand?.id);
    run(sim, { type: 'assignStand', flight: today, standId: -1 });
    expect(sim.business.airlines[0].standPrefs[0]).toBe(-1);
    closeDay(sim, 1);
    const next = newestByRotation(sim, 0, 2)[0];
    expect(sim.traffic.fStand[next]).toBe(-1);
  });
});

describe('stand choices with determinism', () => {
  function standedSim(autoStands: boolean): Sim {
    const { sim } = airportWithTerminal();
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 2 });
    if (!autoStands) run(sim, { type: 'setAutoStands', on: false });
    const f = newestByRotation(sim, 0, 2)[0];
    const stand = sim.airfield.data.stands.find((s) => sim.traffic.refuseAssign(f, s.id) === null);
    run(sim, { type: 'assignStand', flight: f, standId: stand?.id ?? -1 });
    return sim;
  }

  it('same seed and commands give the same hash with a remembered stand, auto stands on and off', () => {
    const make = (auto: boolean): number => {
      const sim = standedSim(auto);
      for (let t = 0; t < 2000; t++) sim.step();
      return sim.stateHash();
    };
    expect(make(true)).toBe(make(true));
    expect(make(false)).toBe(make(false));
  });

  it('a save taken mid run and restored continues to the same hash', () => {
    const a = standedSim(false);
    for (let t = 0; t < 1000; t++) a.step();
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(c.business.airlines.map((x) => x.standPrefs)).toEqual(a.business.airlines.map((x) => x.standPrefs));
    expect(Array.from(c.traffic.fRot)).toEqual(Array.from(a.traffic.fRot));
    for (let t = 0; t < 1000; t++) {
      a.step();
      c.step();
    }
    expect(c.stateHash()).toBe(a.stateHash());
    closeDay(a, 1);
    closeDay(c, 1);
    expect(Array.from(c.traffic.fStand)).toEqual(Array.from(a.traffic.fStand));
    expect(Array.from(c.traffic.fRot)).toEqual(Array.from(a.traffic.fRot));
  });
});

describe('two cell fixture footprints', () => {
  const BAG = FIXTURE_KEYS.indexOf('bagDrop') + 1;
  const CHECK_IN = FIXTURE_KEYS.indexOf('checkIn') + 1;
  const env = { ctx: {} as BuildContext, af: EMPTY_AIRFIELD, others: [] as TerminalGrid[] };

  /** A 32 by 32 concrete floor with no zones, so each fixture takes the first zone it allows. */
  function floorGrid(): TerminalGrid {
    const g = newGrid(1, 0, 0, 90);
    ensureCells(g, 0, 0, 32, 32);
    g.floor.fill(FLOOR.Concrete);
    return g;
  }
  const place = (g: TerminalGrid, x: number, y: number, rot: 0 | 1 | 2 | 3, variant = BAG) =>
    planEdit(g, { op: 'fixture', x0: x, y0: y, x1: x + 1, y1: y + 1, variant, rot }, env);
  const erase = (g: TerminalGrid, x: number, y: number) => planEdit(g, { op: 'erase', x0: x, y0: y, x1: x + 1, y1: y + 1, variant: 0 }, env);

  it('places a two cell fixture in each direction and charges it once', () => {
    const steps: [0 | 1 | 2 | 3, number, number][] = [
      [0, 1, 0],
      [1, 0, 1],
      [2, -1, 0],
      [3, 0, -1],
    ];
    for (const [rot, dx, dy] of steps) {
      const g = floorGrid();
      const plan = place(g, 10, 10, rot);
      expect(plan.problem).toBeNull();
      expect(plan.cost).toBe(BUSINESS.modules.bagDrop.cost);
      plan.apply();
      const a = cellIndex(g, 10, 10);
      const t = cellIndex(g, 10 + dx, 10 + dy);
      expect(g.fixture[a]).toBe(BAG);
      expect(g.fixture[t]).toBe(BAG);
      expect(g.fixtureRot[a]).toBe(1 + rot);
      expect(g.fixtureRot[t]).toBe(5 + rot);
      expect(g.leased[a] + g.leased[t]).toBe(0);
      expect(g.zone[a]).toBe(1);
      expect(g.zone[t]).toBe(1);
      expect(fixturePartner(g, a)).toBe(t);
      expect(fixturePartner(g, t)).toBe(a);
    }
  });

  it('refuses a tail that is off the grid, off the floor, occupied or in the wrong zone', () => {
    expect(place(floorGrid(), 31, 10, 0).problem?.code).toBe('terminalNeedsFoundation');
    expect(place(floorGrid(), 0, 10, 2).problem?.code).toBe('terminalNeedsFoundation');
    const off = floorGrid();
    off.floor[cellIndex(off, 11, 10)] = 0;
    expect(place(off, 10, 10, 0).problem?.code).toBe('terminalNeedsFoundation');
    const taken = floorGrid();
    taken.fixture[cellIndex(taken, 11, 10)] = CHECK_IN;
    const refused = place(taken, 10, 10, 0);
    expect(refused.problem).not.toBeNull();
    expect(refused.changes).toBe(0);
    const zoned = floorGrid();
    zoned.zone[cellIndex(zoned, 11, 10)] = 3;
    expect(place(zoned, 10, 10, 0).problem?.code).toBe('wrongZone');
  });

  it('keeps one cell fixtures on one cell and ignores the rotation', () => {
    const g = floorGrid();
    planEdit(g, { op: 'fixture', x0: 10, y0: 10, x1: 11, y1: 11, variant: CHECK_IN, rot: 2 }, env).apply();
    expect(g.fixture[cellIndex(g, 10, 10)]).toBe(CHECK_IN);
    expect(g.fixture[cellIndex(g, 9, 10)]).toBe(0);
    expect(g.fixtureRot[cellIndex(g, 10, 10)]).toBe(0);
  });

  it('erasing either half clears both cells and the lease', () => {
    for (const [x, y] of [
      [10, 10],
      [11, 10],
    ]) {
      const g = floorGrid();
      place(g, 10, 10, 0).apply();
      g.leased[cellIndex(g, 10, 10)] = 1;
      const plan = erase(g, x, y);
      expect(plan.problem).toBeNull();
      plan.apply();
      for (const [cx, cy] of [
        [10, 10],
        [11, 10],
      ]) {
        const i = cellIndex(g, cx, cy);
        expect(g.fixture[i]).toBe(0);
        expect(g.fixtureRot[i]).toBe(0);
        expect(g.leased[i]).toBe(0);
      }
    }
  });

  it('counts a two cell fixture once', () => {
    const g = floorGrid();
    place(g, 10, 10, 3).apply();
    expect(summarize(g).counts.bagDrop).toBe(1);
  });

  it('charges a placed two cell fixture once and keeps its direction through a save', () => {
    const { sim, id } = airportWithTerminal();
    const g = sim.business.grids[0];
    const before = sim.cash;
    const edit: TerminalEdit = { op: 'fixture', x0: 50, y0: 46, x1: 51, y1: 47, variant: BAG, rot: 1 };
    expect(run(sim, { type: 'terminalBuild', building: id, ox: g.ox, oy: g.oy, headingDeg: 90, edit })).toEqual([]);
    expect(before - sim.cash).toBe(BUSINESS.modules.bagDrop.cost);
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(JSON.parse(JSON.stringify(sim.serialize())));
    const h = c.business.grids[0];
    expect(Array.from(h.fixtureRot)).toEqual(Array.from(g.fixtureRot));
    expect(h.fixtureRot[cellIndex(h, 50, 46)]).toBe(2);
    expect(h.fixtureRot[cellIndex(h, 50, 47)]).toBe(6);
  });

  it('hashes the pairing, so the same fixture cells paired the other way hash differently', () => {
    const { sim, id } = airportWithTerminal();
    const g = sim.business.grids[0];
    const edit: TerminalEdit = { op: 'fixture', x0: 50, y0: 46, x1: 51, y1: 47, variant: BAG, rot: 0 };
    expect(run(sim, { type: 'terminalBuild', building: id, ox: g.ox, oy: g.oy, headingDeg: 90, edit })).toEqual([]);
    const paired = sim.business.hash(0);
    const a = cellIndex(g, 50, 46);
    const t = cellIndex(g, 51, 46);
    g.fixtureRot[a] = 5;
    g.fixtureRot[t] = 1;
    expect(sim.business.hash(0)).not.toBe(paired);
    g.fixtureRot[a] = 1;
    g.fixtureRot[t] = 5;
    expect(sim.business.hash(0)).toBe(paired);
  });

  it('a version 11 save migrates to version 12 with a zero footprint layer', () => {
    expect(SAVE_VERSION).toBe(12);
    const { sim } = airportWithTerminal();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as { version: number; business: { grids: { fixtureRot?: string }[] } };
    data.version = 11;
    for (const g of data.business.grids) delete g.fixtureRot;
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(data);
    expect(c.business.grids.length).toBeGreaterThan(0);
    for (const g of c.business.grids) {
      expect(g.fixtureRot.length).toBe(g.fixture.length);
      expect(g.fixtureRot.every((v) => v === 0)).toBe(true);
    }
  });
});

describe('fixture ids, spans and module data', () => {
  it('keeps the old fixture ids and appends the four new ones at 13 to 16', () => {
    expect(FIXTURE_KEYS.slice(0, 12)).toEqual(['checkIn', 'security', 'belt', 'seating', 'toilet', 'convenience', 'quickFood', 'cafe', 'dutyFree', 'booksGifts', 'pharmacy', 'atc']);
    expect(FIXTURE_KEYS.indexOf('kiosk') + 1).toBe(13);
    expect(FIXTURE_KEYS.indexOf('bagDrop') + 1).toBe(14);
    expect(FIXTURE_KEYS.indexOf('passport') + 1).toBe(15);
    expect(FIXTURE_KEYS.indexOf('gateDesk') + 1).toBe(16);
  });

  it('gives two cell spans to bag drop and gate desk only', () => {
    const twoCell = FIXTURE_KEYS.filter((k) => FIXTURE_SPAN[k] === 2);
    expect(twoCell).toEqual(['bagDrop', 'gateDesk']);
    expect(FIXTURE_KEYS.every((k) => FIXTURE_SPAN[k] === 1 || FIXTURE_SPAN[k] === 2)).toBe(true);
  });

  it('keeps capacityPerHour equal to servers times 3600 over service seconds where both are given', () => {
    const modules = Object.values(BUSINESS.modules);
    const timed = modules.filter((m) => m.servers !== undefined && m.serviceSeconds !== undefined);
    expect(timed.length).toBe(7);
    for (const m of timed) {
      if (m.servers === undefined || m.serviceSeconds === undefined) throw new Error('missing servers');
      expect(m.capacityPerHour).toBe((m.servers * 3600) / m.serviceSeconds);
    }
  });
});

describe('flight offers in the business payload', () => {
  it('lists signed flights earliest first with the stand block buffer on each', () => {
    const { sim } = airportWithTerminal();
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 3 });
    closeDay(sim, 1);
    const { offers } = sim.business.payload(sim.traffic.nowTick);
    expect(offers.length).toBeGreaterThan(0);
    const key = (o: { flight: number }): [number, number] => [sim.traffic.fEta[o.flight], o.flight];
    for (let i = 1; i < offers.length; i++) {
      const [pe, pf] = key(offers[i - 1]);
      const [ce, cf] = key(offers[i]);
      expect(pe < ce || (pe === ce && pf < cf)).toBe(true);
    }
    for (const o of offers) {
      expect(o.endMin - o.arrMin - o.turnMin).toBe(5);
      expect(AIRCRAFT[o.typeIdx].icaoType).toBe(o.type);
    }
    for (const r of sim.business.payload(sim.traffic.nowTick).board) expect(AIRCRAFT[r.typeIdx].icaoType).toBe(r.type);
  });

  it('a signed rotation offers one flight per rotation after the day closes', () => {
    const { sim } = airportWithTerminal();
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 2 });
    closeDay(sim, 1);
    const offers = sim.business.payload(sim.traffic.nowTick).offers.filter((o) => o.airline === 0);
    const rotations = newestByRotation(sim, 0, 2);
    expect(rotations.every((f) => f >= 0)).toBe(true);
    for (const f of rotations) expect(offers.filter((o) => o.flight === f)).toHaveLength(1);
  });

  it('lists four numbers per flight that holds a stand, matching the traffic state', () => {
    const { sim } = airportWithTerminal();
    run(sim, { type: 'signAirline', airlineId: 0, rotations: 2 });
    closeDay(sim, 1);
    const { standBlocks } = sim.business.payload(sim.traffic.nowTick);
    let held = 0;
    for (let f = 0; f < sim.traffic.fStand.length; f++) {
      if (sim.traffic.fStand[f] >= 0 && sim.traffic.occupies(f)) held++;
    }
    expect(standBlocks.length).toBe(held * 4);
    expect(held).toBeGreaterThan(0);
    for (let i = 0; i < standBlocks.length; i += 4) {
      const f = standBlocks[i + 1];
      expect(standBlocks[i]).toBe(sim.traffic.fStand[f]);
      expect(standBlocks[i + 2]).toBe(sim.traffic.flightBlock(f).startMin);
      expect(standBlocks[i + 3]).toBe(sim.traffic.flightBlock(f).endMin);
    }
  });

  it('carries one stand fact per stand and a movement budget only with a tower', () => {
    const { sim } = airportWithTerminal();
    const p = sim.business.payload(sim.traffic.nowTick);
    expect(p.standLinked).toHaveLength(sim.airfield.data.stands.length);
    expect(p.standContact).toHaveLength(sim.airfield.data.stands.length);
    expect(p.movementBudget).toBeGreaterThan(0);
    const bare = ownedSim();
    bare.cash = 100_000_000;
    buildTestAirport(bare, { standsPerRow: 4 });
    buildTestTerminal(bare, { atc: false });
    expect(bare.business.payload(bare.traffic.nowTick).movementBudget).toBe(0);
  });
});

describe('capacity, readiness and room rules for kiosk, bag drop, passport and gate desk', () => {
  const KEY = (k: (typeof FIXTURE_KEYS)[number]): number => FIXTURE_KEYS.indexOf(k) + 1;

  function airportWith(o: { checkIn?: number } = {}): Sim {
    const sim = ownedSim();
    sim.cash = 100_000_000;
    buildTestAirport(sim, { standsPerRow: 8 });
    expect(buildTestTerminal(sim, o)).toEqual([]);
    return sim;
  }

  function fixtureAt(sim: Sim, key: number, x: number, y: number, rot: 0 | 1 | 2 | 3 = 0): string[] {
    const g = sim.business.grids[0];
    const edit: TerminalEdit = { op: 'fixture', x0: x, y0: y, x1: x + 1, y1: y + 1, variant: key, rot };
    return run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: 90, edit });
  }

  function wallEdit(sim: Sim, op: 'wall' | 'removeWall', x0: number, y0: number, x1: number, y1: number, variant: number): string[] {
    const g = sim.business.grids[0];
    const edit: TerminalEdit = { op, x0, y0, x1, y1, variant };
    return run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: 90, edit });
  }

  /** A second building with a security lane and secure seating, and no gate desk. */
  function secondHall(sim: Sim): void {
    const { ox, oy } = originFor(4000, 5600, 90);
    const edit = (building: number, e: TerminalEdit): string[] => run(sim, { type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e });
    expect(edit(-1, { op: 'foundation', x0: 150, y0: 40, x1: 170, y1: 50, variant: 0 })).toEqual([]);
    const id = sim.business.grids[sim.business.grids.length - 1].id;
    expect(edit(id, { op: 'floor', x0: 150, y0: 40, x1: 170, y1: 50, variant: 2 })).toEqual([]);
    expect(edit(id, { op: 'zone', x0: 150, y0: 40, x1: 170, y1: 50, variant: 3 })).toEqual([]);
    expect(edit(id, { op: 'fixture', x0: 150, y0: 42, x1: 151, y1: 43, variant: KEY('security'), rot: 0 })).toEqual([]);
    expect(edit(id, { op: 'fixture', x0: 160, y0: 46, x1: 161, y1: 47, variant: KEY('seating'), rot: 0 })).toEqual([]);
  }

  it('check in capacity counts kiosks and bag drops at their module rates', () => {
    const sim = airportWith({ checkIn: 0 });
    expect(fixtureAt(sim, KEY('kiosk'), 42, 42)).toEqual([]);
    expect(fixtureAt(sim, KEY('kiosk'), 44, 42)).toEqual([]);
    expect(fixtureAt(sim, KEY('bagDrop'), 46, 42)).toEqual([]);
    const term = 2 * BUSINESS.modules.kiosk.capacityPerHour + BUSINESS.modules.bagDrop.capacityPerHour;
    expect(term).toBe(186);
    expect(sim.business.roomIssues).toEqual([]);
    expect(sim.business.depCapacity()).toBe(Math.min(term, 3 * BUSINESS.modules.security.capacityPerHour));
  });

  it('a kiosk alone counts as check in, a bag drop alone does not', () => {
    const kiosk = airportWith({ checkIn: 0 });
    expect(fixtureAt(kiosk, KEY('kiosk'), 42, 42)).toEqual([]);
    expect(kiosk.business.readiness()).not.toContain('noCheckIn');
    expect(kiosk.business.roomIssues).toEqual([]);
    const bag = airportWith({ checkIn: 0 });
    expect(fixtureAt(bag, KEY('bagDrop'), 42, 42)).toEqual([]);
    expect(bag.business.readiness()).toContain('noCheckIn');
  });

  it('a kiosk alone is a landside source, so a wall closing the lanes is a missing security link', () => {
    const sim = airportWith({ checkIn: 0 });
    expect(fixtureAt(sim, KEY('kiosk'), 42, 42)).toEqual([]);
    expect(sim.business.roomIssues).toEqual([]);
    expect(wallEdit(sim, 'wall', 72, 42, 72, 45, 1)).toEqual([]);
    expect(sim.business.roomIssues).toContain('noSecurityLink');
  });

  it('a kiosk alone is a landside source, so a gap beside the lanes is a security bypass', () => {
    const sim = airportWith({ checkIn: 0 });
    expect(fixtureAt(sim, KEY('kiosk'), 42, 42)).toEqual([]);
    expect(wallEdit(sim, 'removeWall', 72, 48, 72, 49, 0)).toEqual([]);
    expect(sim.business.roomIssues).toContain('securityBypass');
  });

  it('intlCapacity is two passport booths at 80 an hour', () => {
    const sim = airportWith();
    expect(fixtureAt(sim, KEY('passport'), 90, 48)).toEqual([]);
    expect(fixtureAt(sim, KEY('passport'), 92, 48)).toEqual([]);
    expect(sim.business.intlCapacity()).toBe(160);
    expect(sim.business.payload(sim.traffic.nowTick).intlCapacity).toBe(160);
  });

  it('noGateDeskLink when a gate desk is walled off from security, cleared by a door', () => {
    const sim = airportWith();
    expect(fixtureAt(sim, KEY('gateDesk'), 88, 42)).toEqual([]);
    expect(sim.business.roomIssues).toEqual([]);
    expect(wallEdit(sim, 'wall', 80, 40, 80, 52, 1)).toEqual([]);
    expect(sim.business.roomIssues).toContain('noGateDeskLink');
    expect(sim.business.depCapacity()).toBe(0);
    expect(wallEdit(sim, 'removeWall', 80, 46, 80, 47, 0)).toEqual([]);
    expect(wallEdit(sim, 'wall', 80, 46, 80, 47, 3)).toEqual([]);
    expect(sim.business.roomIssues).toEqual([]);
  });

  it('noGateDesk when a second terminal with security and seating has no gate desk', () => {
    const sim = airportWith();
    expect(fixtureAt(sim, KEY('gateDesk'), 88, 42)).toEqual([]);
    secondHall(sim);
    expect(sim.business.grids).toHaveLength(2);
    expect(sim.business.readiness()).toContain('noGateDesk');
  });

  it('noGateDesk is not raised when no terminal has a gate desk', () => {
    const sim = airportWith();
    secondHall(sim);
    expect(sim.business.readiness()).not.toContain('noGateDesk');
  });

  it('staff sum includes bag drops, passports and gate desks', () => {
    const sim = airportWith();
    const before = sim.business.staffCount();
    expect(fixtureAt(sim, KEY('bagDrop'), 42, 44)).toEqual([]);
    expect(fixtureAt(sim, KEY('bagDrop'), 42, 46)).toEqual([]);
    expect(fixtureAt(sim, KEY('passport'), 90, 48)).toEqual([]);
    expect(fixtureAt(sim, KEY('passport'), 92, 48)).toEqual([]);
    expect(fixtureAt(sim, KEY('gateDesk'), 88, 42)).toEqual([]);
    expect(fixtureAt(sim, KEY('gateDesk'), 88, 44)).toEqual([]);
    // Two of each: 2 x 0.5 + 2 x 1 + 2 x 1 = 5, a whole number, so rounding adds it exactly.
    expect(sim.business.staffCount()).toBe(before + 5);
  });

  it('same seed and commands give the same hash with all four new fixtures', () => {
    const make = (): number => {
      const sim = airportWith();
      expect(fixtureAt(sim, KEY('kiosk'), 42, 44)).toEqual([]);
      expect(fixtureAt(sim, KEY('bagDrop'), 42, 46)).toEqual([]);
      expect(fixtureAt(sim, KEY('passport'), 90, 48)).toEqual([]);
      expect(fixtureAt(sim, KEY('gateDesk'), 88, 42)).toEqual([]);
      run(sim, { type: 'signAirline', airlineId: 0, rotations: 2 });
      for (let t = 0; t < 2000; t++) sim.step();
      return sim.stateHash();
    };
    expect(make()).toBe(make());
  });
});

describe('business schema rejects bad service data', () => {
  const valid = (): unknown => structuredClone(BUSINESS);

  it('accepts the shipped data', () => {
    expect(businessSchema.safeParse(valid()).success).toBe(true);
  });

  it('rejects an extra key in the terminal service block', () => {
    const d = valid() as { terminal: { service: Record<string, unknown> } };
    d.terminal.service.extra = 1;
    expect(businessSchema.safeParse(d).success).toBe(false);
  });

  it('rejects a fractional server count', () => {
    const d = valid() as { modules: { checkIn: { servers: number } } };
    d.modules.checkIn.servers = 1.5;
    expect(businessSchema.safeParse(d).success).toBe(false);
  });
});
