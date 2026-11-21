import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@data/index';
import { FIXTURE_KEYS, LEDGER_CATEGORIES, LEVEL_KEYS, TICKS_PER_DAY, levelOf, type LevelKey } from '@shared/business';
import { cellIndex, fixtureCost } from '@shared/terminalOps';
import { buildServiceNodes, serviceJoin, serviceUpdate } from '@sim/terminal/serviceNodes';
import { buildWalkGraph } from '@sim/terminal/walkGraph';
import { Rng } from '@sim/rng';
import { grid, paint, put } from './zoningGrid';
import { AIRCRAFT } from '@data/aircraft';
import { PROFILE_KEYS } from '@data/schemas/profiles';
import { Stage } from '@sim/cohorts/cohorts';
import { Sim } from '@sim/sim';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run } from './helpers';

const id = (key: LevelKey): number => FIXTURE_KEYS.indexOf(key) + 1;
const L = BUSINESS.fixtureLevels;

interface CatalogAsset {
  family: string;
  level?: number;
  stats?: Record<string, unknown>;
}

describe('fixture level data (T74)', () => {
  it('matches the catalog stats of every level', () => {
    const catalog = JSON.parse(readFileSync('src/data/fixtures/catalog.json', 'utf8')) as { assets: CatalogAsset[] };
    const stat = (family: string, level: number, key: string): unknown => catalog.assets.find((a) => a.family === family && a.level === level)?.stats?.[key];
    for (let lv = 1; lv <= 3; lv++) {
      expect(L.serviceSeconds.checkIn[lv - 1]).toBe(stat('checkIn', lv, 'serviceTimeS'));
      expect(L.serviceSeconds.security[lv - 1]).toBe(stat('security', lv, 'serviceTimeS'));
      expect(L.serviceSeconds.passport[lv - 1]).toBe(stat('passport', lv, 'serviceTimeS'));
      expect(L.serviceSeconds.gateDesk[lv - 1]).toBe(stat('gateDesk', lv, 'secondsPerPassenger'));
      expect(L.staffNeed.gateDesk[lv - 1]).toBe(stat('gateDesk', lv, 'agents'));
    }
  });

  it('keeps level 1 at the module values of today', () => {
    for (const key of LEVEL_KEYS) {
      expect(L.serviceSeconds[key][0]).toBe(BUSINESS.modules[key].serviceSeconds);
      expect(fixtureCost(id(key), 1)).toBe(BUSINESS.modules[key].cost);
    }
  });

  it('prices levels 2 and 3 at 1.5 and 2 times level 1', () => {
    for (const key of LEVEL_KEYS) {
      const base = BUSINESS.modules[key].cost;
      expect(fixtureCost(id(key), 2)).toBe(Math.round(base * 1.5));
      expect(fixtureCost(id(key), 3)).toBe(base * 2);
    }
  });

  it('reads a level byte of 0 as level 1', () => {
    expect([0, 1, 2, 3].map(levelOf)).toEqual([1, 1, 2, 3]);
  });
});

/** A public hall with one fixture of a key at a level, its node and an rng. */
function single(key: LevelKey, level: number) {
  const g = grid(20, 10);
  paint(g, 0, 0, 20, 10, key === 'gateDesk' ? 3 : 1);
  put(g, key, 10, 4, 1, level);
  const sn = buildServiceNodes(g, buildWalkGraph(g));
  return sn;
}

describe('service nodes by level (T74)', () => {
  it('take the mean time and the staff need of the level', () => {
    for (const key of ['checkIn', 'passport', 'gateDesk'] as const) {
      for (let lv = 1; lv <= 3; lv++) {
        const sn = single(key, lv);
        expect(sn.count).toBe(1);
        expect(sn.level[0]).toBe(lv);
        expect(sn.meanS[0]).toBeCloseTo(L.serviceSeconds[key][lv - 1]!, 5);
        expect(sn.staffNeed[0]).toBe(L.staffNeed[key][lv - 1]);
      }
    }
  });

  it('give a security lane the level need, the remote screener counted at level 3', () => {
    const g = grid(20, 10);
    paint(g, 0, 0, 10, 10, 1);
    paint(g, 10, 0, 20, 10, 3);
    put(g, 'security', 10, 2, 1, 3);
    const sn = buildServiceNodes(g, buildWalkGraph(g));
    expect(sn.count).toBe(1);
    expect(sn.staffNeed[0]).toBe(3);
    expect(sn.meanS[0]).toBe(8);
  });

  it('serve the same cohort faster at a higher level from the same draw', () => {
    const busy: number[] = [];
    for (let lv = 1; lv <= 3; lv++) {
      const sn = single('checkIn', lv);
      expect(serviceJoin(sn, 0, 7, 4)).toBe(true);
      serviceUpdate(sn, 0, new Rng(42));
      busy.push(sn.busyUntil[0]!);
    }
    expect(busy[1]).toBeLessThan(busy[0]!);
    expect(busy[2]).toBeLessThan(busy[1]!);
  });

  it('put a front cohort at the head of the queue', () => {
    const sn = single('gateDesk', 3);
    expect(serviceJoin(sn, 0, 1, 1)).toBe(true);
    expect(serviceJoin(sn, 0, 2, 1)).toBe(true);
    expect(serviceJoin(sn, 0, 3, 1, true)).toBe(true);
    const order = [0, 1, 2].map((q) => sn.qCohort[(sn.qHead[0]! + q) % sn.slots]);
    expect(order).toEqual([3, 1, 2]);
    expect(sn.qCount[0]).toBe(3);
    expect(sn.queueLen[0]).toBe(3);
  });
});

describe('premium passengers and levels in the sim (T74)', () => {
  const PREMIUM = PROFILE_KEYS.indexOf('premium');

  /** Runs one wide flight through a terminal with check in desks at a level, up to the first premium cohorts past check in. */
  function flightThrough(checkInLevel: number): Sim {
    const sim = ownedSim();
    buildTestAirport(sim);
    expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2, checkInLevel })).toEqual([]);
    sim.traffic.scheduleArrival(AIRCRAFT.findIndex((a) => a.id === 'a320neo'), sim.traffic.nowTick + 100, 0, 6000, -1);
    for (let t = 0; t < 2000; t++) sim.step();
    return sim;
  }

  /** Highest satisfaction among the premium cohorts that finished check in, -1 when there are none. */
  function premiumBest(sim: Sim): number {
    let best = -1;
    for (let c = 0; c < sim.cohorts.hi; c++) {
      const st = sim.cohorts.stage[c]!;
      if (sim.cohorts.profile[c] !== PREMIUM || st < Stage.ToSecurity || st > Stage.Boarded) continue;
      best = Math.max(best, sim.cohorts.satisfaction[c]!);
    }
    return best;
  }

  it('costs premium passengers points at a level 1 check in and none at level 3', () => {
    // Waits stay under the premium patience this early, so the only loss at check in is the level penalty.
    expect(premiumBest(flightThrough(3))).toBe(100);
    expect(premiumBest(flightThrough(1))).toBe(100 - L.premiumPoints[0]!);
  });

  it('runs a terminal of level 3 desks to the same hash twice', () => {
    const run = (): number => {
      const sim = ownedSim();
      buildTestAirport(sim, { standsPerRow: 4 });
      expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2, checkInLevel: 3, gateDeskLevel: 3 })).toEqual([]);
      sim.enqueue({ type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
      for (let t = 0; t < 2000; t++) sim.step();
      return sim.stateHash();
    };
    expect(run()).toBe(run());
  });
});

describe('upgrade works (T74)', () => {
  /** A sim with the test terminal and the cell of its first check in desk. */
  function withDesk(): { sim: Sim; id: number; x: number; y: number } {
    const sim = ownedSim();
    buildTestAirport(sim);
    expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2 })).toEqual([]);
    return { sim, id: sim.business.grids[0]!.id, x: 42, y: 42 };
  }
  const levelAt = (sim: Sim, x: number, y: number): number => {
    const g = sim.business.grids[0]!;
    return g.fixtureLevel[cellIndex(g, x, y)]!;
  };
  const nodeAt = (sim: Sim, x: number, y: number): number => {
    const sn = sim.business.serviceNodes[0]!;
    for (let k = 0; k < sn.count; k++) if (sn.lx[k] === x && sn.ly[k] === y) return k;
    return -1;
  };
  const worksTicks = BUSINESS.fixtureLevels.worksDays * TICKS_PER_DAY;

  it('pays the difference, closes the desk for the works and raises its level when they finish', () => {
    const { sim, id, x, y } = withDesk();
    const cash = sim.cash;
    expect(run(sim, { type: 'upgradeFixture', building: id, x, y })).toEqual([]);
    const price = fixtureCost(1, 2) - fixtureCost(1, 1);
    expect(sim.cash).toBe(cash - price);
    expect(sim.business.grids[0]!.works).toHaveLength(1);
    expect(nodeAt(sim, x, y)).toBe(-1);
    expect(levelAt(sim, x, y)).toBe(1);
    expect(run(sim, { type: 'upgradeFixture', building: id, x, y })).toEqual(['fixtureWorksRunning']);
    for (let t = 0; t < worksTicks; t++) sim.step();
    expect(sim.business.grids[0]!.works).toHaveLength(0);
    expect(levelAt(sim, x, y)).toBe(2);
    const k = nodeAt(sim, x, y);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(sim.business.serviceNodes[0]!.meanS[k]).toBe(BUSINESS.fixtureLevels.serviceSeconds.checkIn[1]);
  });

  it('refunds cancelled works and keeps the level', () => {
    const { sim, id, x, y } = withDesk();
    const cash = sim.cash;
    expect(run(sim, { type: 'upgradeFixture', building: id, x, y })).toEqual([]);
    expect(run(sim, { type: 'cancelFixtureWorks', building: id, x, y })).toEqual([]);
    expect(sim.cash).toBe(cash);
    expect(sim.business.grids[0]!.works).toHaveLength(0);
    expect(nodeAt(sim, x, y)).toBeGreaterThanOrEqual(0);
    expect(run(sim, { type: 'cancelFixtureWorks', building: id, x, y })).toEqual(['fixtureNoWorks']);
    for (let t = 0; t < worksTicks; t++) sim.step();
    expect(levelAt(sim, x, y)).toBe(1);
  });

  it('refuses fixtures without levels and fixtures at level 3', () => {
    const { sim, id } = withDesk();
    expect(run(sim, { type: 'upgradeFixture', building: id, x: 76, y: 46 })).toEqual(['fixtureNoLevels']);
    expect(run(sim, { type: 'upgradeFixture', building: id, x: 30, y: 30 })).toEqual(['nothingThere']);
    const g = sim.business.grids[0]!;
    for (const c of [cellIndex(g, 44, 42)]) g.fixtureLevel[c] = 3;
    expect(run(sim, { type: 'upgradeFixture', building: id, x: 44, y: 42 })).toEqual(['fixtureTopLevel']);
  });

  it('upgrades a lane from any of its cells and drops works when the fixture is erased', () => {
    const { sim, id } = withDesk();
    // The first lane spans x 65 to 72 of rows 42 and 43, its anchor at x 72.
    expect(run(sim, { type: 'upgradeFixture', building: id, x: 66, y: 43 })).toEqual([]);
    expect(sim.business.grids[0]!.works[0]).toMatchObject({ x: 72, y: 42, level: 2 });
    const g = sim.business.grids[0]!;
    run(sim, { type: 'terminalBuild', building: id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: { op: 'erase', x0: 70, y0: 42, x1: 71, y1: 43, variant: 0 } });
    expect(sim.business.grids[0]!.works).toHaveLength(0);
  });

  it('keeps running works over a save and finishes them on the same tick', () => {
    const { sim, id, x, y } = withDesk();
    expect(run(sim, { type: 'upgradeFixture', building: id, x, y })).toEqual([]);
    for (let t = 0; t < 100; t++) sim.step();
    const c = new Sim(sim.seed, OPTIONS);
    c.restore(JSON.parse(JSON.stringify(sim.serialize())));
    expect(c.business.grids[0]!.works).toEqual(sim.business.grids[0]!.works);
    expect(c.stateHash()).toBe(sim.stateHash());
    for (let t = 0; t < worksTicks; t++) {
      sim.step();
      c.step();
    }
    expect(levelAt(c, x, y)).toBe(2);
    expect(c.stateHash()).toBe(sim.stateHash());
  });

  it('charges upkeep on levels 2 and 3 only', () => {
    const one = withDesk();
    const two = withDesk();
    const g = two.sim.business.grids[0]!;
    g.fixtureLevel[cellIndex(g, 42, 42)] = 2;
    const upkeep = (s: Sim): number => {
      for (let t = 0; t < TICKS_PER_DAY + 10; t++) s.step();
      return s.business.payload(s.tick).history.at(-1)![LEDGER_CATEGORIES.indexOf('upkeep')]!;
    };
    expect(upkeep(one.sim) - upkeep(two.sim)).toBe(Math.round(fixtureCost(1, 2) * BUSINESS.fixtureLevels.upkeepShare));
  });
});
