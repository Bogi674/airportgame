import { describe, expect, it } from 'vitest';
import { BUSINESS, STAFF } from '@data/index';
import catalog from '@data/fixtures/catalog.json';
import { Sim } from '@sim/sim';
import { migrate } from '@sim/save/migrations';
import { packTyped, unpackTyped } from '@sim/save/pack';
import { buildServiceNodes, serviceJoin, type ServiceNodes } from '@sim/terminal/serviceNodes';
import { checkInPenalty } from '@sim/cohorts/cohorts';
import { PROFILE_KEYS } from '@data/schemas/profiles';
import { FIXTURE_KEYS, TICKS_PER_DAY, type TerminalGrid } from '@shared/business';
import { LEVELED_KEYS, levelCost, upgradeCost } from '@shared/fixtureLevels';
import { cellIndex } from '@shared/terminalOps';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run } from './helpers';

const CHECK_IN = FIXTURE_KEYS.indexOf('checkIn') + 1;
const SECURITY = FIXTURE_KEYS.indexOf('security') + 1;
const GATE_DESK = FIXTURE_KEYS.indexOf('gateDesk') + 1;
/** The first check in desk of the test terminal. */
const DESK = { x: 42, y: 42 } as const;

function terminal(seed?: string): Sim {
  const sim = ownedSim(seed);
  sim.cash = 50_000_000;
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2 })).toEqual([]);
  return sim;
}

const grid = (sim: Sim): TerminalGrid => sim.business.grids[0]!;
const table = (sim: Sim): ServiceNodes => sim.business.serviceNodes[0]!;

function nodeAt(sn: ServiceNodes, x: number, y: number): number {
  for (let k = 0; k < sn.count; k++) if (sn.lx[k] === x && sn.ly[k] === y) return k;
  return -1;
}

const upgrade = (sim: Sim, x: number, y: number): string[] => run(sim, { type: 'upgradeFixture', building: grid(sim).id, x, y });
const cancel = (sim: Sim, x: number, y: number): string[] => run(sim, { type: 'cancelFixtureUpgrade', building: grid(sim).id, x, y });

/** Brings every running works to its end tick, so a test need not step a whole game day. */
function dueNow(sim: Sim): void {
  for (const w of sim.business.fixtureWorks) w.doneTick = sim.tick + 1;
  sim.step();
  sim.step();
}

describe('fixture level data (T74)', () => {
  it('keeps level 1 at the module values and levels 2 and 3 at the catalog values', () => {
    for (const key of LEVELED_KEYS) {
      const lv = BUSINESS.fixtureLevels[key];
      expect(lv.cost[0]).toBe(BUSINESS.modules[key].cost);
      expect(lv.serviceSeconds[0]).toBe(BUSINESS.modules[key].serviceSeconds);
      for (const level of [2, 3]) {
        const asset = catalog.assets.find((a) => a.id === `${key}.l${level}`)!;
        const stats = asset.stats as { serviceTimeS?: number; secondsPerPassenger?: number };
        expect(lv.serviceSeconds[level - 1]).toBe(stats.serviceTimeS ?? stats.secondsPerPassenger);
      }
    }
  });

  it('prices an upgrade as the difference of the two levels', () => {
    expect(upgradeCost('checkIn', 1)).toBe(14400 - 9000);
    expect(upgradeCost('security', 2)).toBe(175000 - 112000);
    expect(levelCost('gateDesk', 3)).toBe(30000);
  });

  it('staffs a gate desk with two agents and a security lane with three officers at level 2', () => {
    expect(STAFF.stations.gateDesk?.needByLevel).toEqual([1, 2, 2]);
    expect(STAFF.stations.security?.needByLevel).toEqual([2, 3, 2]);
  });
});

describe('placing a fixture at a level (T74)', () => {
  it('charges the level cost and serves at the level time', () => {
    const sim = terminal();
    const g = grid(sim);
    const before = sim.cash;
    expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op: 'fixture', x0: 50, y0: 42, x1: 51, y1: 43, variant: CHECK_IN, level: 2 } })).toEqual([]);
    expect(before - sim.cash).toBe(levelCost('checkIn', 2));
    expect(g.fixtureLevel[cellIndex(g, 50, 42)]).toBe(2);
    const sn = table(sim);
    expect(sn.meanS[nodeAt(sn, 50, 42)]).toBe(105);
    expect(sn.meanS[nodeAt(sn, DESK.x, DESK.y)]).toBe(120);
  });

  it('gives a security lane the 2 by 8 cell kit footprint at every level', () => {
    const sim = terminal();
    const g = grid(sim);
    let cells = 0;
    for (let i = 0; i < g.fixture.length; i++) if (g.fixture[i] === SECURITY) cells++;
    expect(cells).toBe(2 * 16);
  });
});

describe('upgrade works (T74)', () => {
  it('closes the desk, raises its level when the works end and serves faster', () => {
    const sim = terminal();
    const g = grid(sim);
    const before = sim.cash;
    expect(upgrade(sim, DESK.x, DESK.y)).toEqual([]);
    expect(before - sim.cash).toBe(upgradeCost('checkIn', 1));
    const w = sim.business.worksAt(g.id, DESK.x, DESK.y)!;
    expect(w.to).toBe(2);
    expect(w.doneTick - sim.tick).toBeLessThanOrEqual(BUSINESS.fixtureLevels.checkIn.worksDays * TICKS_PER_DAY);
    let sn = table(sim);
    let k = nodeAt(sn, DESK.x, DESK.y);
    expect(sn.closed[k]).toBe(1);
    expect(sn.queueCap[k]).toBe(0);
    expect(sn.staffNeed[k]).toBe(0);
    expect(serviceJoin(sn, k, 999, 1)).toBe(false);
    expect(g.fixtureLevel[cellIndex(g, DESK.x, DESK.y)]).toBe(1);
    expect(upgrade(sim, DESK.x, DESK.y)).toEqual(['fixtureWorksRunning']);
    dueNow(sim);
    expect(sim.business.fixtureWorks).toEqual([]);
    expect(g.fixtureLevel[cellIndex(g, DESK.x, DESK.y)]).toBe(2);
    sn = table(sim);
    k = nodeAt(sn, DESK.x, DESK.y);
    expect(sn.closed[k]).toBe(0);
    expect(sn.queueCap[k]).toBeGreaterThan(0);
    expect(sn.meanS[k]).toBe(105);
  });

  it('finishes on its own after the works days', () => {
    const sim = terminal();
    expect(upgrade(sim, DESK.x, DESK.y)).toEqual([]);
    const due = sim.business.fixtureWorks[0]!.doneTick;
    while (sim.tick <= due) sim.step();
    const ev: string[] = [];
    sim.drainEvents(ev);
    expect(ev).toContain('fixtureUpgraded|level=2');
    expect(grid(sim).fixtureLevel[cellIndex(grid(sim), DESK.x, DESK.y)]).toBe(2);
  }, 60000);

  it('cancels with a full refund and keeps the old level', () => {
    const sim = terminal();
    const before = sim.cash;
    expect(upgrade(sim, DESK.x, DESK.y)).toEqual([]);
    expect(cancel(sim, DESK.x, DESK.y)).toEqual([]);
    expect(sim.cash).toBe(before);
    expect(sim.business.fixtureWorks).toEqual([]);
    const sn = table(sim);
    expect(sn.closed[nodeAt(sn, DESK.x, DESK.y)]).toBe(0);
    expect(cancel(sim, DESK.x, DESK.y)).toEqual(['noWorks']);
  });

  it('refuses a fixture without levels, one at the top level and one the player cannot pay', () => {
    const sim = terminal();
    expect(upgrade(sim, 76, 46)).toEqual(['notLeveled']);
    const g = grid(sim);
    expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op: 'fixture', x0: 50, y0: 42, x1: 51, y1: 43, variant: CHECK_IN, level: 3 } })).toEqual([]);
    expect(upgrade(sim, 50, 42)).toEqual(['fixtureMaxLevel']);
    sim.cash = 10;
    expect(upgrade(sim, DESK.x, DESK.y)).toEqual([`insufficientFunds|cost=${upgradeCost('checkIn', 1)}`]);
  });

  it('upgrades a security lane from any of its cells and staffs it at the new level', () => {
    const sim = terminal();
    const g = grid(sim);
    // The first lane: anchor (72, 42), cells on columns 65 to 72, rows 42 and 43.
    expect(upgrade(sim, 66, 43)).toEqual([]);
    expect(sim.business.worksAt(g.id, 72, 42)).toBeDefined();
    dueNow(sim);
    for (let x = 65; x <= 72; x++) for (const y of [42, 43]) expect(g.fixtureLevel[cellIndex(g, x, y)]).toBe(2);
    const sn = table(sim);
    expect(sn.staffNeed[nodeAt(sn, 72, 42)]).toBe(3);
    expect(sn.meanS[nodeAt(sn, 72, 42)]).toBe(10);
  });

  it('drops the works of a fixture the player erases', () => {
    const sim = terminal();
    const g = grid(sim);
    expect(upgrade(sim, DESK.x, DESK.y)).toEqual([]);
    expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op: 'erase', x0: DESK.x, y0: DESK.y, x1: DESK.x + 1, y1: DESK.y + 1, variant: 0 } })).toEqual([]);
    expect(sim.business.fixtureWorks).toEqual([]);
  });
});

describe('premium passengers (T74)', () => {
  const premium = PROFILE_KEYS.indexOf('premium');
  const leisure = PROFILE_KEYS.indexOf('leisure');

  it('lose points at a check in below level 3 only', () => {
    expect(checkInPenalty(premium, 1)).toBe(BUSINESS.fixtureLevels.premiumPenalty);
    expect(checkInPenalty(premium, 2)).toBe(BUSINESS.fixtureLevels.premiumPenalty);
    expect(checkInPenalty(premium, 3)).toBe(0);
    expect(checkInPenalty(leisure, 1)).toBe(0);
  });

  it('join a priority lane behind the priority cohorts already waiting', () => {
    const sim = terminal();
    const sn = buildServiceNodes(grid(sim), sim.business.walkGraphs[0]!);
    const k = nodeAt(sn, DESK.x, DESK.y);
    const vip = new Set([3, 4]);
    const ahead = (c: number): boolean => vip.has(c);
    expect(serviceJoin(sn, k, 1, 1)).toBe(true);
    expect(serviceJoin(sn, k, 2, 1)).toBe(true);
    expect(serviceJoin(sn, k, 3, 1, ahead)).toBe(true);
    expect(serviceJoin(sn, k, 4, 1, ahead)).toBe(true);
    const order: number[] = [];
    for (let q = 0; q < sn.qCount[k]!; q++) order.push(sn.qCohort[k * sn.slots + ((sn.qHead[k]! + q) % sn.slots)]!);
    expect(order).toEqual([3, 4, 1, 2]);
    expect(sn.queueLen[k]).toBe(4);
  });
});

describe('levels in saves and replays (T74)', () => {
  it('two runs with an upgrade agree over 2000 ticks', () => {
    const go = (): Sim => {
      const sim = terminal();
      run(sim, { type: 'signAirline', airlineId: 0, sign: true });
      run(sim, { type: 'setTestTraffic', perHour: 20, turnScale: 0.1 });
      expect(upgrade(sim, DESK.x, DESK.y)).toEqual([]);
      for (let t = 0; t < 1000; t++) sim.step();
      dueNow(sim);
      for (let t = 0; t < 1000; t++) sim.step();
      return sim;
    };
    const a = go();
    const b = go();
    expect(a.stateHash()).toBe(b.stateHash());
  }, 60000);

  it('restores a save taken during works and runs on to the same hash', () => {
    const a = terminal();
    expect(upgrade(a, DESK.x, DESK.y)).toEqual([]);
    for (let t = 0; t < 200; t++) a.step();
    const b = new Sim(a.seed, OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.business.fixtureWorks).toEqual(a.business.fixtureWorks);
    expect(b.stateHash()).toBe(a.stateHash());
    const sn = table(b);
    expect(sn.closed[nodeAt(sn, DESK.x, DESK.y)]).toBe(1);
    for (let t = 0; t < 500; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });

  it('a version 34 save loses its one cell security lanes with a refund', () => {
    const sim = terminal();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as { version: number; cash: number; business: { grids: { fixture: string; fixtureRot: string; fixtureOff: string; fixtureLevel: string }[] } };
    // Rewrite the saved grid to the old shape: every lane cell but the anchors cleared, as a one cell lane was.
    const sg = data.business.grids[0]!;
    const fixture = unpackTyped(sg.fixture, Uint8Array);
    const rot = unpackTyped(sg.fixtureRot, Uint8Array);
    const off = unpackTyped(sg.fixtureOff, Uint8Array);
    const level = unpackTyped(sg.fixtureLevel, Uint8Array);
    let lanes = 0;
    for (let i = 0; i < fixture.length; i++) {
      if (fixture[i] !== SECURITY) continue;
      if (rot[i]! >= 5) {
        fixture[i] = 0;
        rot[i] = 0;
        off[i] = 0;
        level[i] = 0;
      } else lanes++;
    }
    expect(lanes).toBe(2);
    sg.fixture = packTyped(fixture);
    sg.fixtureRot = packTyped(rot);
    sg.fixtureOff = packTyped(off);
    sg.fixtureLevel = packTyped(level);
    data.version = 34;
    const cash = data.cash;
    const c = new Sim(sim.seed, OPTIONS);
    c.restore(migrate(data));
    const g = c.business.grids[0]!;
    expect(g.fixture.some((f) => f === SECURITY)).toBe(false);
    expect(g.fixture.some((f) => f === GATE_DESK)).toBe(true);
    expect(c.cash).toBe(cash + lanes * levelCost('security', 1));
    const ev: string[] = [];
    c.drainEvents(ev);
    expect(ev).toContain('lanesRemoved|n=2');
  });
});
