import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { FIXTURE_KEYS, FIXTURE_SPAN, FLOOR, LEDGER_CATEGORIES, TICKS_PER_DAY, TICKS_PER_MINUTE, type FlightSeries, type TerminalGrid } from '@shared/business';
import { frequency, inWindow, operatesOn, seriesClash, weekdayOf } from '@shared/seriesPlan';
import { BUSINESS, MARKET } from '@data/index';
import { businessSchema } from '../src/data/schemas/business';
import { Sim } from '@sim/sim';
import { SAVE_VERSION } from '@sim/save/migrations';
import { FlState } from '@sim/ops/traffic';
import { EMPTY_AIRFIELD } from '@shared/airfield';
import type { BuildContext } from '@shared/validate';
import { cellIndex, ensureCells, fixtureCost, fixturePartner, floorBounds, newGrid, originFor, planEdit, summarize, type TerminalEdit } from '@shared/terminalOps';
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
    expect(sim.business.terminals[0].counts.belt).toBe(2);
    // Foundation, tile, 2 walls of 60 edges plus a door, and the fixtures. The test terminal gained a security exit in a gap of its wall, two edges fewer, and the 2 by 8 cell lanes (T74) leave a six edge opening, three edges fewer.
    const expected = cells * (2000 + 480) + 124 * 300 + 2 * 1500 + (8 * 9000 + 3 * 70000 + 2 * 55000 + 6 * 6000 + 2 * 20000) + fixtureCost(FIXTURE_KEYS.indexOf('securityExit') + 1, 1);
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

  it('is custom: a different layout gives different arrival capacity and cost', () => {
    const a = ownedSim();
    a.cash = 100_000_000;
    buildTestAirport(a, { standsPerRow: 4 });
    buildTestTerminal(a, { checkIn: 2, security: 1, belt: 1 });
    const b = airportWithTerminal().sim;
    expect(a.business.terminals[0].counts.belt).toBeLessThan(b.business.terminals[0].counts.belt);
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
  it('only signs airlines the rating allows, and signing brings the series offer', () => {
    const { sim } = airportWithTerminal();
    const heavy = sim.business.airlines.find((a) => a.minRating >= 70);
    expect(heavy).toBeDefined();
    expect(run(sim, { type: 'signAirline', airlineId: heavy?.id ?? 0, sign: true })[0]).toMatch(/^ratingTooLow/);
    const regional = sim.business.airlines[0];
    run(sim, { type: 'signAirline', airlineId: regional.id, sign: true });
    expect(regional.signed).toBe(true);
    const series = sim.business.market.series.filter((x) => x.airline === regional.id);
    expect(series.length).toBe(MARKET.series.onSigning[regional.scope] + MARKET.series.perStar * sim.business.stars());
    expect(regional.fleet.every((t) => AIRCRAFT[t].capacity.seatsTypical >= 9)).toBe(true);
  });

  it('a signed airline brings flights, fees and a daily ledger', () => {
    const { sim } = airportWithTerminal();
    run(sim, { type: 'signAirline', airlineId: 0, sign: true });
    run(sim, { type: 'signAirline', airlineId: 1, sign: true });
    const before = sim.cash;
    // Run until just after the first midnight.
    const midnight = 18 * 60 * TICKS_PER_MINUTE;
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
    expect(TICKS_PER_DAY).toBe(72000);
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
      run(sim, { type: 'signAirline', airlineId: 0, sign: true });
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

  it('flights need an ATC tower', () => {
    const a = ownedSim();
    a.cash = 100_000_000;
    buildTestAirport(a, { standsPerRow: 4 });
    buildTestTerminal(a, { atc: false });
    expect(a.business.readiness()).toContain('noAtc');
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

  it('a day close assigns a waiting flight at once when automatic stands are on', () => {
    const { sim } = airportWithTerminal();
    const f = sim.traffic.scheduleArrival(AIRCRAFT.findIndex((a) => a.id === 'atr72_600'), sim.traffic.nowTick + 100, 0, 600, -1);
    expect(sim.traffic.fStand[f]).toBe(-1);
    (sim.business as unknown as { dailyClose(tick: number): void }).dailyClose(TICKS_PER_DAY);
    expect(sim.traffic.fStand[f]).toBeGreaterThanOrEqual(0);
  });

});

describe('room validation', () => {
  it('a lane in the wall opening works, a gap in the wall is a security bypass, a walled lane passes no one', () => {
    const { sim, id } = airportWithTerminal();
    expect(sim.business.roomIssues).toEqual([]);
    const g = sim.business.grids[0];
    const at = (e: object) => run(sim, { type: 'terminalBuild', building: id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: e as never });
    // Open another gap in the wall beside the lanes: passengers can bypass security.
    at({ op: 'removeWall', x0: 72, y0: 48, x1: 72, y1: 49, variant: 0 });
    expect(sim.business.roomIssues).toContain('securityBypass');
    at({ op: 'wall', x0: 72, y0: 48, x1: 72, y1: 49, variant: 1 });
    expect(sim.business.roomIssues).toEqual([]);
    // Close the opening in the wall: the lanes still start in the public hall, but none can pass anyone into the
    // secure hall (T74 lanes are 2 by 8 cells), so the lane transition is reported.
    at({ op: 'wall', x0: 72, y0: 42, x1: 72, y1: 48, variant: 1 });
    expect(sim.business.roomIssues).toContain('transitionOrientation');
  });
});

/** Scheduled flights of one series, latest arrival first. */
function flightsOf(sim: Sim, seriesId: number): number[] {
  const out: number[] = [];
  for (let f = 0; f < 1024; f++) if (sim.traffic.fState[f] === FlState.Scheduled && sim.traffic.fRot[f] === seriesId) out.push(f);
  return out.sort((p, q) => sim.traffic.fEta[q] - sim.traffic.fEta[p]);
}

function closeDay(sim: Sim, day: number): void {
  (sim.business as unknown as { dailyClose(tick: number): void }).dailyClose(day * TICKS_PER_DAY);
}

/** A signed regional airline with the auto planner off, so its series wait unplaced. */
function signedManual(): { sim: Sim; series: FlightSeries[] } {
  const { sim } = airportWithTerminal();
  run(sim, { type: 'setAutoStands', on: false });
  run(sim, { type: 'signAirline', airlineId: 0, sign: true });
  return { sim, series: sim.business.market.series.filter((s) => s.airline === 0) };
}

/** The first stand that takes the series' type. */
function standFor(sim: Sim, s: FlightSeries): number {
  const st = sim.airfield.data.stands.find((x) => sim.traffic.refuseStandType(s.typeIdx, x.id) === null);
  if (!st) throw new Error('no stand fits');
  return st.id;
}

describe('flight series and the weekly planner (T61, T62)', () => {
  it('a seed has 80 named destinations between 150 and 4 000 km, the same on every run', () => {
    const a = ownedSim().business.market.destinations;
    const b = ownedSim().business.market.destinations;
    expect(a).toHaveLength(MARKET.destinations.count);
    expect(new Set(a.map((d) => d.name)).size).toBe(a.length);
    for (const d of a) {
      expect(d.km).toBeGreaterThanOrEqual(150);
      expect(d.km).toBeLessThanOrEqual(4000);
      expect(d.size).toBeGreaterThanOrEqual(1);
      expect(d.size).toBeLessThanOrEqual(5);
    }
    expect(b).toEqual(a);
    expect(ownedSim('OTHER-SEED').business.market.destinations.map((d) => d.name)).not.toEqual(a.map((d) => d.name));
  });

  it('every series has fixed weekdays, a 26 week contract and starts unplaced without the auto planner', () => {
    const { sim, series } = signedManual();
    expect(series.length).toBe(MARKET.series.onSigning.regional + MARKET.series.perStar * sim.business.stars());
    for (const s of series) {
      expect(s.days).toBeGreaterThan(0);
      expect(s.endDay - s.startDay).toBe(26 * 7);
      expect(s.minute).toBe(-1);
      expect(sim.business.market.destinations[s.dest]).toBeDefined();
    }
  });

  it('one drop places a series on all its operating days at the same time and stand', () => {
    const { sim, series } = signedManual();
    const s = series[0];
    const stand = standFor(sim, s);
    expect(run(sim, { type: 'placeSeries', seriesId: s.id, standId: stand, minute: 600 })).toEqual([]);
    let flown = 0;
    for (let day = 1; day <= 7; day++) {
      const before = flightsOf(sim, s.id).length;
      closeDay(sim, day);
      const after = flightsOf(sim, s.id);
      const flies = operatesOn(s.days, weekdayOf(day));
      expect(after.length - before).toBe(flies ? 1 : 0);
      if (flies) {
        expect(sim.traffic.fStand[after[0]]).toBe(stand);
        flown++;
      }
    }
    expect(flown).toBe(frequency(s.days));
  });

  it('refuses a second series that overlaps a placed one on a shared day', () => {
    const { sim, series } = signedManual();
    const daily = series.find((x) => x.days === 0b1111111) ?? series[0];
    const other = series.find((x) => x !== daily && (x.days & daily.days) !== 0 && sim.traffic.refuseStandType(x.typeIdx, standFor(sim, daily)) === null);
    const stand = standFor(sim, daily);
    expect(run(sim, { type: 'placeSeries', seriesId: daily.id, standId: stand, minute: 600 })).toEqual([]);
    if (!other) return;
    expect(run(sim, { type: 'placeSeries', seriesId: other.id, standId: stand, minute: 610 })[0]).toMatch(/^seriesBusy/);
    expect(seriesClash(other.days, other.turnMin, 600 + daily.turnMin + 30, stand, sim.business.market.series, other.id)).toBeNull();
  });

  it('unplaced frequency costs the airline 2 satisfaction per operating day', () => {
    const { sim, series } = signedManual();
    const a = sim.business.airlines[0];
    const before = a.happiness;
    closeDay(sim, 1);
    const wd = weekdayOf(1);
    const flying = series.filter((s) => operatesOn(s.days, wd)).length;
    expect(a.happiness).toBe(Math.max(0, before - 2 * flying));
  });

  it('the auto planner places every series inside its preferred window', () => {
    const { sim } = airportWithTerminal();
    run(sim, { type: 'signAirline', airlineId: 0, sign: true });
    const mine = sim.business.market.series.filter((s) => s.airline === 0);
    expect(mine.some((s) => s.minute >= 0)).toBe(true);
    for (const s of mine) if (s.minute >= 0) expect(inWindow(s.winMin, MARKET.series.windowMin, s.minute)).toBe(true);
  });

  it('cancel and unplace remove the series flight of today', () => {
    const { sim, series } = signedManual();
    const s = series[0];
    run(sim, { type: 'placeSeries', seriesId: s.id, standId: standFor(sim, s), minute: 1430 });
    run(sim, { type: 'unplaceSeries', seriesId: s.id });
    expect(flightsOf(sim, s.id)).toEqual([]);
    run(sim, { type: 'cancelSeries', seriesId: s.id });
    expect(sim.business.market.series.some((x) => x.id === s.id)).toBe(false);
  });

  it('a version 17 save turns each rotation into a daily series at its old slot and stand', () => {
    const { sim } = airportWithTerminal();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as { version: number; business: { airlines: Record<string, unknown>[]; market?: unknown } };
    data.version = 17;
    delete data.business.market;
    const stand = sim.airfield.data.stands[0].id;
    Object.assign(data.business.airlines[0], { rotations: 2, slots: [420, 900], standPrefs: [stand, -1] });
    for (const a of data.business.airlines) for (const k of ['signed', 'hub', 'happiness', 'lowWeeks', 'veryLowWeeks']) if (a !== data.business.airlines[0]) delete a[k];
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(data);
    const s = c.business.market.series.filter((x) => x.airline === 0);
    expect(s).toHaveLength(2);
    expect(s.every((x) => x.days === 0b1111111)).toBe(true);
    expect([s[0].standId, s[0].minute]).toEqual([stand, 420]);
    expect(s[1].minute).toBe(-1);
    expect(c.business.airlines[0].signed).toBe(true);
    expect(s[0].turnMin).toBeGreaterThan(0);
  });
});

describe('series with determinism', () => {
  function placed(): Sim {
    const { sim, series } = signedManual();
    run(sim, { type: 'placeSeries', seriesId: series[0].id, standId: standFor(sim, series[0]), minute: 400 });
    return sim;
  }

  it('same seed and commands give the same hash over 2 000 ticks', () => {
    const make = (): number => {
      const sim = placed();
      for (let t = 0; t < 2000; t++) sim.step();
      return sim.stateHash();
    };
    expect(make()).toBe(make());
  });

  it('a save taken mid run and restored continues to the same hash', () => {
    const a = placed();
    for (let t = 0; t < 1000; t++) a.step();
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(c.business.market.series).toEqual(a.business.market.series);
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
    expect(SAVE_VERSION).toBe(35);
    const { sim } = airportWithTerminal();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as { version: number; business: { grids: { fixtureRot?: string }[] } };
    data.version = 11;
    for (const g of data.business.grids) delete g.fixtureRot;
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(data);
    expect(c.business.grids.length).toBeGreaterThan(0);
    for (const g of c.business.grids) {
      expect(g.fixtureRot.length).toBe(g.fixture.length);
      // Only security lanes gain a direction in the version 27 to 28 step (T75). No cell pairs with a tail.
      expect(g.fixtureRot.every((v, i) => v === 0 || (g.fixture[i] === FIXTURE_KEYS.indexOf('security') + 1 && v <= 4))).toBe(true);
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

  it('gives two cell spans to bag drop, gate desk, security exit and customs', () => {
    const twoCell = FIXTURE_KEYS.filter((k) => FIXTURE_SPAN[k] === 2);
    expect(twoCell).toEqual(['bagDrop', 'gateDesk', 'securityExit', 'customs']);
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

describe('stand blocks in the business payload', () => {
  it('lists four numbers per flight that holds a stand, matching the traffic state', () => {
    const { sim } = airportWithTerminal();
    run(sim, { type: 'signAirline', airlineId: 0, sign: true });
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
    expect(sim.business.payload(sim.traffic.nowTick)).not.toHaveProperty('depCapacity');
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

  it('a kiosk alone is a landside source, so a wall closing the lanes leaves a lane that passes no one', () => {
    const sim = airportWith({ checkIn: 0 });
    expect(fixtureAt(sim, KEY('kiosk'), 42, 42)).toEqual([]);
    expect(sim.business.roomIssues).toEqual([]);
    expect(wallEdit(sim, 'wall', 72, 42, 72, 48, 1)).toEqual([]);
    expect(sim.business.roomIssues).toContain('transitionOrientation');
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
      run(sim, { type: 'signAirline', airlineId: 0, sign: true });
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

describe('departure revenue', () => {
  it('a terminal flight pays only for the passengers the boarded hook reports, the rest miss the flight', () => {
    const { sim } = airportWithTerminal();
    const f = sim.traffic.scheduleArrival(AIRCRAFT.findIndex((a) => a.id === 'a320neo'), sim.traffic.nowTick + 100, 0, 600, -1);
    const pax = sim.business.paxFor(f);
    expect(pax).toBeGreaterThan(3);
    sim.business.boarded = () => pax - 3;
    const flights = sim.business.payload(sim.traffic.nowTick).flightsToday;
    (sim.business as unknown as { onPushback(f: number): void }).onPushback(f);
    expect(sim.business.paxToday).toBe(pax - 3);
    expect(sim.business.lostToday).toBe(3);
    expect(sim.business.payload(sim.traffic.nowTick).flightsToday).toBe(flights + 1);
  });
});

describe('passenger day for the finance sheet (T67)', () => {
  it('after a day with boarded cohorts the payload lists eleven numbers, the first a satisfaction from 0 to 100', () => {
    const sim = ownedSim();
    sim.cash = 100_000_000;
    buildTestAirport(sim, { standsPerRow: 8 });
    expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2, seating: 0, toilet: 0 })).toEqual([]);
    expect(sim.business.payload(sim.traffic.nowTick).paxDay).toEqual([]);
    sim.traffic.scheduleArrival(AIRCRAFT.findIndex((a) => a.id === 'a320neo'), sim.traffic.nowTick + 100, 0, 6000, -1);
    for (let t = 0; t < 16000 && sim.cohorts.boarded === 0; t++) sim.step();
    expect(sim.cohorts.boarded).toBeGreaterThan(0);
    (sim.business as unknown as { dailyClose(tick: number): void }).dailyClose(sim.tick + TICKS_PER_DAY);
    const day = sim.business.payload(sim.traffic.nowTick).paxDay;
    expect(day).toHaveLength(11);
    expect(day[0]).toBeGreaterThanOrEqual(0);
    expect(day[0]).toBeLessThanOrEqual(100);
  });
});

describe('international destinations (T20)', () => {
  it('about 35 percent of the destinations of three seeds are international', () => {
    for (const seed of ['GOLDEN-0001', 'GOLDEN-0002', 'GOLDEN-0003']) {
      const list = ownedSim(seed).business.market.destinations;
      const share = list.filter((d) => d.international).length / list.length;
      expect(Math.abs(share - MARKET.destinations.internationalShare), seed).toBeLessThan(0.15);
    }
  });

  it('the names and distances of GOLDEN-0001 did not move', () => {
    const list = ownedSim('GOLDEN-0001').business.market.destinations;
    expect(list.map((d) => d.name).join('|')).toBe(
      'Coromont|Fareton|Naredale|Dunhaven|Karorburg|Rosiwick|Torton|Linerholm|Narerford|Calerhaven|Moroholm|Eskilgate|Quenordale|Torehaven|Rosilholm|Corwick|Wenawick|Moremont|Eskwick|Haloford|Brananton|Linaholm|Dunerby|Galburg|Branerfield|Valorstad|Ardanmouth|Rosilton|Ardoby|Linorburg|Morhaven|Torormouth|Corby|Ostaby|Rosastad|Istiford|Belobridge|Galanhaven|Delerdale|Branorwick|Brananburg|Branimouth|Pelilmont|Dunadale|Caliburg|Naroport|Eskilfield|Rosiby|Ardanhaven|Belordale|Delerburg|Branilbridge|Osteby|Farhaven|Galilgate|Istahaven|Moroby|Liniburg|Eskaholm|Delport|Nariford|Calanwick|Linerfield|Karofield|Galadale|Rosport|Halgate|Morivik|Corowick|Delangate|Istmouth|Linilburg|Valiwick|Karburg|Valaburg|Beleport|Eskeholm|Eskibridge|Galbridge|Morilholm',
    );
    expect(list.reduce((sum, d) => sum + d.km, 0)).toBe(149159);
  });

  it('isInternational is false without a series and follows the destination of the series otherwise', () => {
    const sim = ownedSim();
    const market = sim.business.market;
    const type = AIRCRAFT.findIndex((a) => a.id === 'a320neo');
    const plain = sim.traffic.scheduleArrival(type, sim.traffic.nowTick + 100, 0, 600, -1);
    expect(market.isInternational(plain)).toBe(false);
    const base = market.series[0] ?? { id: 0, airline: 0, dest: 0, typeIdx: type, days: 127, winMin: 0, startDay: 0, endDay: 100, standId: -1, minute: -1, turnMin: 30 };
    const intl = market.destinations.find((d) => d.international)!;
    const home = market.destinations.find((d) => !d.international)!;
    market.series.push({ ...base, id: 9001, dest: intl.id }, { ...base, id: 9002, dest: home.id });
    const a = sim.traffic.scheduleArrival(type, sim.traffic.nowTick + 100, 0, 600, -1, 0, 9001);
    const b = sim.traffic.scheduleArrival(type, sim.traffic.nowTick + 100, 0, 600, -1, 0, 9002);
    expect(market.isInternational(a)).toBe(true);
    expect(market.isInternational(b)).toBe(false);
  });
});

describe('arrival entry desk (T20)', () => {
  const A320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');

  /** Docks one flight and returns the events of the run. rot is the series id of an international flight, -1 for a plain one. */
  function dock(sim: Sim, rot: number): { f: number; events: string[] } {
    const f = sim.traffic.scheduleArrival(A320, sim.traffic.nowTick + 100, 0, 6000, -1, 0, rot);
    sim.traffic.fStand[f] = sim.airfield.data.stands[0]!.id;
    const events: string[] = [];
    for (let t = 0; t < 6000 && sim.business.flightPaxOf(f) === 0; t++) {
      sim.step();
      sim.drainEvents(events);
    }
    return { f, events };
  }

  function addInternationalSeries(sim: Sim): number {
    const market = sim.business.market;
    const intl = market.destinations.find((d) => d.international)!;
    market.series.push({ id: 9001, airline: 0, dest: intl.id, typeIdx: A320, days: 127, winMin: 0, startDay: 0, endDay: 100, standId: -1, minute: -1, turnMin: 30 });
    return 9001;
  }

  function terminalSim(gateDesk: number): Sim {
    const sim = ownedSim();
    sim.cash = 100_000_000;
    buildTestAirport(sim, { standsPerRow: 8 });
    expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk })).toEqual([]);
    return sim;
  }

  it('a domestic flight docking at a terminal with gate desks is served with all its passengers', () => {
    const sim = terminalSim(2);
    const { f, events } = dock(sim, -1);
    expect(sim.business.flightPaxOf(f)).toBeGreaterThan(0);
    expect(sim.business.flightPaxOf(f)).toBe(sim.business.paxFor(f));
    expect(sim.business.arrivalEntry(f)).toBe(true);
    expect(sim.business.entryOut[0]).toBe(0);
    expect(sim.business.entryOut[1]).toBeGreaterThanOrEqual(0);
    expect(sim.business.entryOut[2]).toBe(0);
    expect(events.some((e) => e.startsWith('arrivalNoGate'))).toBe(false);
  });

  it('without a gate desk the passengers are lost and arrivalNoGate is emitted', () => {
    const sim = terminalSim(0);
    const { f, events } = dock(sim, -1);
    expect(sim.business.arrivalEntry(f)).toBe(false);
    expect(sim.business.flightPaxOf(f)).toBe(0);
    expect(sim.business.lostToday).toBeGreaterThan(0);
    expect(events.some((e) => e.startsWith('arrivalNoGate|stand='))).toBe(true);
  });

  it('an international flight with only secure desks takes the domestic route and emits intlNoImmigration', () => {
    const sim = terminalSim(2);
    const { f, events } = dock(sim, addInternationalSeries(sim));
    expect(sim.business.market.isInternational(f)).toBe(true);
    expect(sim.business.arrivalEntry(f)).toBe(true);
    expect(sim.business.entryOut[2]).toBe(0);
    expect(sim.business.flightPaxOf(f)).toBe(sim.business.paxFor(f));
    expect(events.some((e) => e.startsWith('intlNoImmigration|stand='))).toBe(true);
  });

  it('an international flight with a gate desk in an International zone gets the international route', () => {
    const sim = terminalSim(2);
    const g = sim.business.grids[0]!;
    const paint = run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: { op: 'zone', x0: 76, y0: 42, x1: 78, y1: 43, variant: 5 } });
    expect(paint).toEqual([]);
    const { f, events } = dock(sim, addInternationalSeries(sim));
    expect(sim.business.arrivalEntry(f)).toBe(true);
    expect(sim.business.entryOut[2]).toBe(1);
    expect(events.some((e) => e.startsWith('intlNoImmigration'))).toBe(false);
  });
});
