import { describe, expect, it } from 'vitest';
import businessJson from '../src/data/business.json';
import { BUSINESS } from '@data/index';
import { businessSchema } from '../src/data/schemas';
import { Sim } from '@sim/sim';
import type { Command } from '@sim/commands';
import { levelForRunways, movementsPerHour, runwayCapOf, towerBuildCost, towerCapacity, towerLevelOf } from '@shared/towerBudget';
import { pickObject } from '@shared/airfieldGeom';
import { EMPTY_AIRFIELD, type AirfieldPayload, type Apron } from '@shared/airfield';
import { migrate, SAVE_VERSION } from '@sim/save/migrations';
import { AcState } from '@sim/ops/traffic';
import { buildTestAirport, ownedSim, run, OPTIONS } from './helpers';

const BUILD = 100_000;
const UPGRADE = 50_000;

/** Position on the owned test site, away from the test airport at y 5000 to 5400. */
const SPOT = { x: 3500, y: 4000 };

const build = (sim: Sim, level = 1, at = SPOT): string[] => run(sim, { type: 'buildTower', x: at.x, y: at.y, level });
const towers = (sim: Sim) => sim.airfield.data.towers ?? [];

describe('tower data', () => {
  it('holds the confirmed numbers of 2026-11-06', () => {
    const t = BUSINESS.tower;
    expect(t.cost).toBe(BUILD);
    expect(t.upgradeCost).toBe(UPGRADE);
    expect(t.footprintM).toBe(15);
    expect(t.levels.map((l) => l.movementsPerHour)).toEqual([20, 40, 60, 80, 100]);
    expect(t.levels.map((l) => l.maxRunways)).toEqual([1, 1, 2, 2, -1]);
  });

  it('rejects a ladder that is not five levels or has an impossible runway cap', () => {
    const tower = (businessJson as { tower: { levels: unknown[] } }).tower;
    const withLevels = (levels: unknown[]) => ({ ...businessJson, tower: { ...tower, levels } });
    expect(businessSchema.safeParse(businessJson).success).toBe(true);
    expect(businessSchema.safeParse(withLevels(tower.levels.slice(0, 4))).success).toBe(false);
    const bad = tower.levels.map((l, i) => (i === 0 ? { ...(l as object), maxRunways: 0 } : l));
    expect(businessSchema.safeParse(withLevels(bad)).success).toBe(false);
    const falling = tower.levels.map((l, i) => (i === 2 ? { ...(l as object), movementsPerHour: 10 } : l));
    expect(businessSchema.safeParse(withLevels(falling)).success).toBe(false);
  });
});

describe('tower build cost', () => {
  it('is the build cost at level 1 and one upgrade per level above 1', () => {
    expect(towerBuildCost(1)).toBe(100000);
    expect(towerBuildCost(3)).toBe(200000);
  });

  it('is what a level 3 build takes from the cash', () => {
    const sim = ownedSim();
    const cash = sim.cash;
    expect(build(sim, 3)).toEqual([]);
    expect(cash - sim.cash).toBe(towerBuildCost(3));
  });
});

describe('building a tower', () => {
  it('charges exactly the level 1 cost and stores the tower', () => {
    const sim = ownedSim();
    const cash = sim.cash;
    expect(build(sim)).toEqual([]);
    expect(cash - sim.cash).toBe(BUILD);
    expect(towers(sim)).toHaveLength(1);
    expect(towers(sim)[0]).toMatchObject({ x: SPOT.x, y: SPOT.y, level: 1 });
  });

  it('charges the upgrade cost for every level above 1 when built at a higher level', () => {
    const sim = ownedSim();
    const cash = sim.cash;
    expect(build(sim, 3)).toEqual([]);
    expect(cash - sim.cash).toBe(BUILD + 2 * UPGRADE);
    expect(towers(sim)[0].level).toBe(3);
  });

  it('refuses a level outside 1 to 5 without charging', () => {
    const sim = ownedSim();
    const cash = sim.cash;
    expect(build(sim, 0)).toEqual(['towerLevel|max=5']);
    expect(build(sim, 6)).toEqual(['towerLevel|max=5']);
    expect(build(sim, 1.5)).toEqual(['towerLevel|max=5']);
    expect(sim.cash).toBe(cash);
    expect(towers(sim)).toHaveLength(0);
  });

  it('refuses unowned land with notOwned and keeps the cash', () => {
    const sim = ownedSim();
    sim.parcelOwner.fill(0);
    const cash = sim.cash;
    expect(build(sim)).toEqual(['notOwned']);
    expect(sim.cash).toBe(cash);
    expect(towers(sim)).toHaveLength(0);
  });

  it('refuses water with onWater', () => {
    const sim = ownedSim();
    const heights = sim.site.heights;
    const cell = heights.findIndex((h) => h < 0);
    expect(cell).toBeGreaterThanOrEqual(0);
    const n = Math.round(Math.sqrt(heights.length));
    const at = { x: (cell % n) * 10 + 5, y: Math.floor(cell / n) * 10 + 5 };
    expect(build(sim, 1, at)).toEqual(['onWater']);
  });

  it('refuses a build the player cannot pay for, with the cost in the problem', () => {
    const sim = ownedSim();
    sim.cash = BUILD - 1;
    expect(build(sim)).toEqual([`insufficientFunds|cost=${BUILD}`]);
    expect(sim.cash).toBe(BUILD - 1);
    expect(towers(sim)).toHaveLength(0);
  });

  it('does not rebuild the taxi network', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 2 });
    const before = sim.airfield.version;
    build(sim);
    expect(sim.airfield.version).toBe(before);
  });
});

describe('upgrading a tower', () => {
  it('raises the level by one for exactly the upgrade cost', () => {
    const sim = ownedSim();
    build(sim);
    const id = towers(sim)[0].id;
    const cash = sim.cash;
    expect(run(sim, { type: 'upgradeTower', id })).toEqual([]);
    expect(cash - sim.cash).toBe(UPGRADE);
    expect(towers(sim)[0].level).toBe(2);
  });

  it('refuses the fifth upgrade and keeps level 5', () => {
    const sim = ownedSim();
    build(sim);
    const id = towers(sim)[0].id;
    for (let i = 0; i < 4; i++) expect(run(sim, { type: 'upgradeTower', id })).toEqual([]);
    expect(towers(sim)[0].level).toBe(5);
    const cash = sim.cash;
    expect(run(sim, { type: 'upgradeTower', id })).toEqual(['towerMaxLevel']);
    expect(sim.cash).toBe(cash);
    expect(towers(sim)[0].level).toBe(5);
  });

  it('refuses an upgrade the player cannot pay for', () => {
    const sim = ownedSim();
    build(sim);
    sim.cash = UPGRADE - 1;
    expect(run(sim, { type: 'upgradeTower', id: towers(sim)[0].id })).toEqual([`insufficientFunds|cost=${UPGRADE}`]);
    expect(towers(sim)[0].level).toBe(1);
  });

  it('refuses a tower that does not exist', () => {
    const sim = ownedSim();
    expect(run(sim, { type: 'upgradeTower', id: 99 })).toEqual(['nothingThere']);
  });

  it('is undone by undo', () => {
    const sim = ownedSim();
    build(sim);
    const cash = sim.cash;
    run(sim, { type: 'upgradeTower', id: towers(sim)[0].id });
    run(sim, { type: 'undo' });
    expect(towers(sim)[0].level).toBe(1);
    expect(sim.cash).toBe(cash);
    run(sim, { type: 'redo' });
    expect(towers(sim)[0].level).toBe(2);
    expect(sim.cash).toBe(cash - UPGRADE);
  });
});

describe('demolishing a tower', () => {
  it('refunds a quarter of the level 1 cost', () => {
    const sim = ownedSim();
    build(sim);
    const cash = sim.cash;
    expect(run(sim, { type: 'demolishTower', id: towers(sim)[0].id })).toEqual([]);
    expect(sim.cash - cash).toBe(BUILD * 0.25);
    expect(towers(sim)).toHaveLength(0);
  });

  it('refunds a quarter of everything spent on an upgraded tower', () => {
    const sim = ownedSim();
    build(sim);
    const id = towers(sim)[0].id;
    run(sim, { type: 'upgradeTower', id });
    const cash = sim.cash;
    run(sim, { type: 'demolishTower', id });
    expect(sim.cash - cash).toBe((BUILD + UPGRADE) * 0.25);
  });

  it('refuses a tower that does not exist', () => {
    const sim = ownedSim();
    expect(run(sim, { type: 'demolishTower', id: 99 })).toEqual(['nothingThere']);
  });

  it('is undone by undo and the tower comes back', () => {
    const sim = ownedSim();
    build(sim);
    const id = towers(sim)[0].id;
    run(sim, { type: 'demolishTower', id });
    run(sim, { type: 'undo' });
    expect(towers(sim).map((t) => t.id)).toEqual([id]);
  });
});

describe('several towers', () => {
  it('may stand together and each is charged', () => {
    const sim = ownedSim();
    const cash = sim.cash;
    expect(build(sim, 1, SPOT)).toEqual([]);
    expect(build(sim, 2, { x: SPOT.x + 200, y: SPOT.y })).toEqual([]);
    expect(towers(sim)).toHaveLength(2);
    expect(cash - sim.cash).toBe(BUILD + BUILD + UPGRADE);
  });

  it('refuses a tower whose footprint overlaps another tower', () => {
    const sim = ownedSim();
    expect(build(sim)).toEqual([]);
    expect(build(sim, 1, { x: SPOT.x + 10, y: SPOT.y })).toEqual(['towerOverlap']);
    expect(towers(sim)).toHaveLength(1);
  });

  it('counts the highest level when several stand', () => {
    const sim = ownedSim();
    build(sim, 1, SPOT);
    build(sim, 3, { x: SPOT.x + 200, y: SPOT.y });
    build(sim, 2, { x: SPOT.x + 400, y: SPOT.y });
    expect(towerLevelOf(sim.airfield.data)).toBe(3);
  });
});

describe('tower placement clears pavement', () => {
  const runwayAt = (y: number): Command => ({ type: 'buildRunway', x: 3000, y, headingDeg: 90, lengthM: 1800, code: 'C', approach: 'precision', surface: 'asphalt', tier: 1 });

  it('refuses a tower on a runway strip', () => {
    const sim = ownedSim();
    expect(run(sim, runwayAt(5600))).toEqual([]);
    expect(build(sim, 1, { x: 4000, y: 5600 })).toEqual(['towerOnPavement']);
    expect(towers(sim)).toHaveLength(0);
  });

  it('refuses a tower on an apron', () => {
    const sim = ownedSim();
    expect(run(sim, { type: 'buildApron', polygon: [{ x: 3400, y: 3900 }, { x: 3700, y: 3900 }, { x: 3700, y: 4200 }, { x: 3400, y: 4200 }], surface: 'asphalt', tier: 0 })).toEqual([]);
    expect(build(sim)).toEqual(['towerOnPavement']);
  });

  it('refuses a tower on a stand', () => {
    const sim = ownedSim();
    expect(run(sim, { type: 'buildApron', polygon: [{ x: 3300, y: 3900 }, { x: 3700, y: 3900 }, { x: 3700, y: 4200 }, { x: 3300, y: 4200 }], surface: 'asphalt', tier: 0 })).toEqual([]);
    expect(run(sim, { type: 'buildStands', x: 3500, y: 4000, headingDeg: 180, count: 1, spacingM: 30, standType: 'remote', size: 'small' })).toEqual([]);
    expect(build(sim)).toEqual(['towerOnPavement']);
  });

  it('allows a tower on clear grass', () => {
    const sim = ownedSim();
    expect(build(sim)).toEqual([]);
  });
});

describe('the tower ladder', () => {
  it('reads movements and runway caps from the data ladder', () => {
    expect(movementsPerHour(0)).toBe(0);
    expect(movementsPerHour(1)).toBe(20);
    expect(movementsPerHour(3)).toBe(60);
    expect(movementsPerHour(5)).toBe(100);
    expect(movementsPerHour(9)).toBe(100);
    expect(runwayCapOf(0)).toBe(-1);
    expect(runwayCapOf(1)).toBe(1);
    expect(runwayCapOf(3)).toBe(2);
    expect(runwayCapOf(5)).toBe(-1);
    expect(levelForRunways(1)).toBe(1);
    expect(levelForRunways(2)).toBe(3);
    expect(levelForRunways(3)).toBe(5);
    expect(levelForRunways(20)).toBe(5);
  });

  it('multiplies the per runway budget by the runway count', () => {
    const sim = ownedSim();
    expect(towerCapacity(sim.airfield.data)).toEqual({ hasTower: false, level: 0, perHour: 0, total: 0 });
    build(sim, 1);
    expect(towerCapacity(sim.airfield.data)).toEqual({ hasTower: true, level: 1, perHour: 20, total: 0 });
    run(sim, { type: 'buildRunway', x: 3000, y: 5600, headingDeg: 90, lengthM: 1800, code: 'C', approach: 'precision', surface: 'asphalt', tier: 1 });
    expect(towerCapacity(sim.airfield.data).total).toBe(20);
  });
});

describe('runway caps', () => {
  const runwayAt = (y: number): Command => ({ type: 'buildRunway', x: 3000, y, headingDeg: 90, lengthM: 1800, code: 'C', approach: 'precision', surface: 'asphalt', tier: 1 });

  it('refuses a second runway at level 1 and names the level needed', () => {
    const sim = ownedSim();
    build(sim);
    expect(run(sim, runwayAt(5600))).toEqual([]);
    expect(run(sim, runwayAt(5900))).toEqual(['towerRunwayCap|level=3']);
    expect(sim.airfield.data.runways).toHaveLength(1);
  });

  it('allows two runways at level 3 and refuses the third with level 5', () => {
    const sim = ownedSim();
    build(sim, 3);
    expect(run(sim, runwayAt(5600))).toEqual([]);
    expect(run(sim, runwayAt(5900))).toEqual([]);
    expect(run(sim, runwayAt(6200))).toEqual(['towerRunwayCap|level=5']);
    expect(sim.airfield.data.runways).toHaveLength(2);
  });

  it('allows any number of runways at level 5', () => {
    const sim = ownedSim();
    build(sim, 5);
    expect(run(sim, runwayAt(5600))).toEqual([]);
    expect(run(sim, runwayAt(5900))).toEqual([]);
    expect(run(sim, runwayAt(6200))).toEqual([]);
    expect(sim.airfield.data.runways).toHaveLength(3);
  });

  it('does not cap runways before a tower stands', () => {
    const sim = ownedSim();
    expect(run(sim, runwayAt(5600))).toEqual([]);
    expect(run(sim, runwayAt(5900))).toEqual([]);
    expect(build(sim)).toEqual([]);
    expect(sim.airfield.data.runways).toHaveLength(2);
  });

  it('raises the cap with an upgrade', () => {
    const sim = ownedSim();
    build(sim);
    run(sim, runwayAt(5600));
    expect(run(sim, runwayAt(5900))).toEqual(['towerRunwayCap|level=3']);
    const id = towers(sim)[0].id;
    run(sim, { type: 'upgradeTower', id });
    expect(run(sim, runwayAt(5900))).toEqual(['towerRunwayCap|level=3']);
    run(sim, { type: 'upgradeTower', id });
    expect(run(sim, runwayAt(5900))).toEqual([]);
  });
});

/** Admission ticks of arrivals and departures, read from the aircraft states the player would see. */
function admissions(sim: Sim, ticks: number): { arrivals: number[]; departures: number[] } {
  const t = sim.traffic;
  const prev = new Uint8Array(256);
  const arrivals: number[] = [];
  const departures: number[] = [];
  for (let k = 0; k < ticks; k++) {
    sim.step();
    for (let i = 0; i < 256; i++) {
      if (t.active[i] === 0) {
        prev[i] = 0;
        continue;
      }
      const s = t.state[i];
      if (s === AcState.Approach && prev[i] !== AcState.Approach) arrivals.push(sim.tick);
      if (prev[i] === AcState.Turnaround && s !== AcState.Turnaround) departures.push(sim.tick);
      prev[i] = s;
    }
  }
  return { arrivals, departures };
}

/** The test airport with one runway and a tower at the given level, so the movement budget applies. */
function metered(level: number, perHour: number): Sim {
  const sim = ownedSim();
  buildTestAirport(sim, { standsPerRow: 30 });
  expect(build(sim, level)).toEqual([]);
  run(sim, { type: 'setTestTraffic', perHour, turnScale: 0.05 });
  return sim;
}

describe('the movement budget', () => {
  it('admits at most 20 movements in any rolling hour at level 1', () => {
    const sim = metered(1, 120);
    const log = admissions(sim, 72000);
    expect(log.arrivals.length).toBeGreaterThan(20);
    const all = [...log.arrivals, ...log.departures].sort((a, b) => a - b);
    for (let i = 0; i < all.length; i++) {
      let inWindow = 1;
      for (let j = i + 1; j < all.length && all[j] - all[i] < 36000; j++) inWindow++;
      expect(inWindow).toBeLessThanOrEqual(20);
    }
  });

  it('admits the 21st movement no earlier than 60 minutes after the first', () => {
    const sim = metered(1, 120);
    const log = admissions(sim, 72000);
    const all = [...log.arrivals, ...log.departures].sort((a, b) => a - b);
    expect(all.length).toBeGreaterThan(20);
    expect(all[20] - all[0]).toBeGreaterThanOrEqual(36000);
  });

  it('diverts an arrival that waits 30 game minutes for a movement', () => {
    const sim = metered(1, 240);
    for (let k = 0; k < 12000; k++) sim.step();
    expect(sim.business.payload(sim.tick).atcQueue).toBeGreaterThan(0);
    const events: string[] = [];
    for (let k = 0; k < 28000; k++) {
      sim.step();
      sim.drainEvents(events);
    }
    const diverted = events.filter((e) => e.startsWith('flightDiverted|') && e.endsWith('|reason=noMovement'));
    expect(diverted.length).toBeGreaterThan(0);
    expect(sim.traffic.divertedFlights).toBeGreaterThanOrEqual(diverted.length);
  });

  it('keeps the ledger through a save and queues the same way after a load', () => {
    const a = metered(1, 240);
    for (let k = 0; k < 10000; k++) a.step();
    const b = metered(1, 240);
    for (let k = 0; k < 5000; k++) b.step();
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(JSON.parse(JSON.stringify(b.serialize())));
    expect(c.stateHash()).toBe(b.stateHash());
    for (let k = 0; k < 5000; k++) {
      b.step();
      c.step();
    }
    expect(c.stateHash()).toBe(a.stateHash());
  }, 60000);

  it('meters nothing without a tower, so GA and private traffic keeps moving', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 30 });
    run(sim, { type: 'setTestTraffic', perHour: 120, turnScale: 0.05 });
    const log = admissions(sim, 36000);
    expect(log.arrivals.length).toBeGreaterThan(20);
  });

  it('two runs under budget pressure give identical hashes', () => {
    const a = metered(1, 240);
    const b = metered(1, 240);
    for (let k = 0; k < 4000; k++) {
      a.step();
      b.step();
    }
    expect(a.stateHash()).toBe(b.stateHash());
  });
});

function scripted(): Sim {
  const sim = ownedSim();
  buildTestAirport(sim, { standsPerRow: 4 });
  build(sim);
  run(sim, { type: 'upgradeTower', id: towers(sim)[0].id });
  run(sim, { type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
  return sim;
}

describe('tower determinism and saves', () => {
  it('two runs from one seed give identical hashes after a build and an upgrade', () => {
    const a = scripted();
    const b = scripted();
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('a tower changes the state hash', () => {
    const a = scripted();
    const b = scripted();
    run(b, { type: 'upgradeTower', id: towers(b)[0].id });
    expect(a.stateHash()).not.toBe(b.stateHash());
  });

  it('save and load keeps the tower and matches the uninterrupted run', () => {
    const a = scripted();
    for (let t = 0; t < 2000; t++) a.step();

    const b = scripted();
    for (let t = 0; t < 1000; t++) b.step();
    const text = JSON.stringify(b.serialize());
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(JSON.parse(text));
    expect(towers(c)).toEqual(towers(b));
    expect(c.stateHash()).toBe(b.stateHash());
    for (let t = 0; t < 1000; t++) c.step();
    expect(c.stateHash()).toBe(a.stateHash());
  });

  it('a version 7 save without towers loads with none and behaves like an uninterrupted run', () => {
    expect(SAVE_VERSION).toBe(8);
    const make = (): Sim => {
      const sim = ownedSim();
      buildTestAirport(sim, { standsPerRow: 4 });
      run(sim, { type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
      return sim;
    };
    const a = make();
    for (let t = 0; t < 2000; t++) a.step();

    const b = make();
    for (let t = 0; t < 1000; t++) b.step();
    const old = JSON.parse(JSON.stringify(b.serialize())) as { version: number; airfield: { towers?: unknown } };
    old.version = 7;
    delete old.airfield.towers;
    expect(migrate(old).version).toBe(SAVE_VERSION);

    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(old);
    expect(towers(c)).toEqual([]);
    expect(c.stateHash()).toBe(b.stateHash());
    for (let t = 0; t < 1000; t++) c.step();
    expect(c.stateHash()).toBe(a.stateHash());
  });
});

describe('picking a tower in the inspector', () => {
  const TOL = 14;
  const TOWER = { id: 7, cost: BUILD, x: 1000, y: 1000, level: 1 };
  const scene = (extra: Partial<AirfieldPayload> = {}): AirfieldPayload => ({ ...EMPTY_AIRFIELD, towers: [TOWER], ...extra });

  it('picks a tower for a point inside its footprint', () => {
    expect(pickObject(scene(), 1000, 1000, TOL)).toMatchObject({ kind: 'tower', id: 7 });
    expect(pickObject(scene(), 1005, 992, TOL)).toMatchObject({ kind: 'tower', id: 7 });
  });

  it('picks the tower ahead of an apron under the same point', () => {
    const apron: Apron = {
      id: 3,
      cost: 0,
      polygon: [
        { x: 950, y: 950 },
        { x: 1050, y: 950 },
        { x: 1050, y: 1050 },
        { x: 950, y: 1050 },
      ],
      surface: 'asphalt',
      pcr: 0,
      condition: 100,
    };
    expect(pickObject(scene({ aprons: [apron] }), 1000, 1000, TOL)).toMatchObject({ kind: 'tower', id: 7 });
  });

  it('picks nothing 30 m away from the footprint', () => {
    expect(pickObject(scene(), 1030, 1000, TOL)).toBeNull();
  });
});
