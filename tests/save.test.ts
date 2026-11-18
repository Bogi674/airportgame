import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { Sim } from '@sim/sim';
import { migrate, SAVE_VERSION } from '@sim/save/migrations';
import { packTyped, unpackTyped } from '@sim/save/pack';
import { FLAG_SLOW } from '@sim/cohorts/cohorts';
import { TRAIT, TRAIT_COUNT, memberSeedOf, writeTraits } from '@sim/cohorts/traits';
import { terminalIssues } from '@shared/terminalRooms';
import { gridOnLevel, newGrid } from '@shared/terminalOps';
import { buildTestAirport, buildTestControlRoom, buildTestTerminal, ownedSim, run, OPTIONS } from './helpers';

function prepared(): Sim {
  const sim = ownedSim();
  sim.cash = 80_000_000;
  buildTestAirport(sim, { standsPerRow: 6 });
  buildTestTerminal(sim, { shop: true });
  run(sim, { type: 'signAirline', airlineId: 0, sign: true });
  run(sim, { type: 'signAirline', airlineId: 1, sign: true });
  run(sim, { type: 'setTestTraffic', perHour: 20, turnScale: 0.1 });
  return sim;
}

describe('saves', () => {
  it('5000 ticks, save, load, 5000 more equals 10000 uninterrupted', () => {
    const a = prepared();
    for (let t = 0; t < 10000; t++) a.step();

    const b = prepared();
    for (let t = 0; t < 5000; t++) b.step();
    // Through JSON, as a real save would travel.
    const text = JSON.stringify(b.serialize());
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(JSON.parse(text));
    expect(c.stateHash()).toBe(b.stateHash());
    expect(c.business.grids[0].cost).toBe(b.business.grids[0].cost);
    expect(c.business.terminals[0].counts.checkIn).toBe(8);
    for (let t = 0; t < 5000; t++) c.step();
    expect(c.stateHash()).toBe(a.stateHash());
    expect(c.traffic.completedFlights).toBe(a.traffic.completedFlights);
  }, 120000);

  it('a version 10 save loads with every terminal on floor 0', () => {
    const sim = prepared();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as {
      version: number;
      business: { grids: { id: number; building?: number; level?: number }[] };
    };
    // Saves older than version 15 have their calendar waits shortened on load, so the reference is the same save
    // labelled version 14: the floor step must add nothing to that.
    const ref = new Sim('GOLDEN-0001', OPTIONS);
    ref.restore({ ...(JSON.parse(JSON.stringify(data)) as typeof data), version: 14 } as never);
    data.version = 10;
    for (const g of data.business.grids) {
      delete g.building;
      delete g.level;
    }
    const c = new Sim('GOLDEN-0001', OPTIONS);
    expect(() => c.restore(data)).not.toThrow();
    expect(sim.business.grids.length).toBeGreaterThan(0);
    expect(c.business.grids).toHaveLength(sim.business.grids.length);
    c.business.grids.forEach((g, i) => {
      expect(g.level).toBe(0);
      expect(g.building).toBe(g.id);
      expect(terminalIssues(g)).toEqual(terminalIssues(sim.business.grids[i]));
    });
    expect(c.stateHash()).toBe(ref.stateHash());
  });

  it('a version 10 save migrates each grid to its own building on floor 0', () => {
    const sim = prepared();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as {
      version: number;
      business: { grids: { id: number; building?: number; level?: number }[] };
    };
    data.version = 10;
    for (const g of data.business.grids) {
      delete g.building;
      delete g.level;
    }
    const migrated = migrate(data).business as { grids: { id: number; building: number; level: number }[] };
    expect(sim.business.grids.length).toBeGreaterThan(0);
    expect(migrated.grids).toHaveLength(sim.business.grids.length);
    migrated.grids.forEach((g) => {
      expect(g.building).toBe(g.id);
      expect(g.level).toBe(0);
    });
  });

  it('a version 13 save migrates to the current version and restores with the GA clock at zero', () => {
    const sim = prepared();
    for (let t = 0; t < 300; t++) sim.step();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as {
      version: number;
      traffic: { gaNextTick?: unknown; gaRng?: unknown };
    };
    data.version = 13;
    delete data.traffic.gaNextTick;
    delete data.traffic.gaRng;
    expect(migrate(data).version).toBe(SAVE_VERSION);
    const c = new Sim('GOLDEN-0001', OPTIONS);
    expect(() => c.restore(data)).not.toThrow();
    expect(c.tick).toBe(sim.tick);
  });

  it('a version 12 save migrates to the current version and restores with empty queues', () => {
    const sim = prepared();
    for (let t = 0; t < 300; t++) sim.step();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as {
      version: number;
      business: { service?: unknown; serviceRng?: unknown };
    };
    data.version = 12;
    delete data.business.service;
    delete data.business.serviceRng;
    expect(migrate(data).version).toBe(SAVE_VERSION);
    const c = new Sim('GOLDEN-0001', OPTIONS);
    expect(() => c.restore(data)).not.toThrow();
    expect(c.business.serviceNodes.length).toBe(sim.business.serviceNodes.length);
    expect(c.business.serviceNodes.every((sn) => sn.active === 0)).toBe(true);
  });

  it('a version 27 save with cohorts migrates to 28 with seeded members', () => {
    const sim = ownedSim();
    buildTestAirport(sim);
    expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2 })).toEqual([]);
    sim.traffic.scheduleArrival(AIRCRAFT.findIndex((a) => a.id === 'a320neo'), sim.traffic.nowTick + 100, 0, 6000, -1);
    for (let t = 0; t < 400; t++) sim.step();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as {
      version: number;
      cohorts: { hi: number; arrays: Record<string, string> };
    };
    data.version = 27;
    for (const k of ['needTick', 'parent', 'waitStart', 'target', 'visitNeed', 'memberSeed', 'memberNeed', 'memberSat']) delete data.cohorts.arrays[k];
    const out = migrate(data) as unknown as { version: number; cohorts: { hi: number; arrays: Record<string, string> } };
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.cohorts.hi).toBeGreaterThan(0);
    const seeds = unpackTyped(out.cohorts.arrays.memberSeed!, Uint32Array);
    const sat = unpackTyped(out.cohorts.arrays.memberSat!, Uint8Array);
    const recipe = unpackTyped(out.cohorts.arrays.recipeSeed!, Uint32Array);
    const parent = unpackTyped(out.cohorts.arrays.parent!, Int32Array);
    expect(seeds[0]).toBe(memberSeedOf(recipe[0]!, 0));
    expect(sat[0]).toBe(100);
    expect(parent[0]).toBe(-1);
  });

  it('a version 27 save with a slow member gets the slow flag on migration', () => {
    const sim = ownedSim();
    buildTestAirport(sim);
    expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2 })).toEqual([]);
    sim.traffic.scheduleArrival(AIRCRAFT.findIndex((a) => a.id === 'a320neo'), sim.traffic.nowTick + 100, 0, 6000, -1);
    for (let t = 0; t < 400; t++) sim.step();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as {
      version: number;
      cohorts: { hi: number; arrays: Record<string, string> };
    };
    data.version = 27;
    const traits = new Float64Array(TRAIT_COUNT);
    let slowRecipe = 0;
    while (true) {
      writeTraits(memberSeedOf(slowRecipe, 0), 0, traits);
      if (traits[TRAIT.Slow] === 1) break;
      slowRecipe++;
    }
    const recipe = unpackTyped(data.cohorts.arrays.recipeSeed!, Uint32Array);
    const size = unpackTyped(data.cohorts.arrays.size!, Uint8Array);
    const flags = unpackTyped(data.cohorts.arrays.flags!, Uint8Array);
    recipe[0] = slowRecipe;
    size[0] = 1;
    flags[0] = 0;
    data.cohorts.arrays.recipeSeed = packTyped(recipe);
    data.cohorts.arrays.size = packTyped(size);
    data.cohorts.arrays.flags = packTyped(flags);
    const out = migrate(data) as unknown as { cohorts: { arrays: Record<string, string> } };
    expect(unpackTyped(out.cohorts.arrays.flags!, Uint8Array)[0]! & FLAG_SLOW).toBe(FLAG_SLOW);
  });

  it('gridOnLevel finds the floor of a building or returns undefined', () => {
    const ground = newGrid(4, 0, 0, 0);
    const upper = { ...newGrid(5, 0, 0, 0), building: 4, level: 1 };
    const grids = [ground, upper];
    expect(gridOnLevel(grids, 4, 0)).toBe(ground);
    expect(gridOnLevel(grids, 4, 1)).toBe(upper);
    expect(gridOnLevel(grids, 4, -1)).toBeUndefined();
    expect(gridOnLevel(grids, 9, 0)).toBeUndefined();
  });

  it('refuses saves of another seed, newer versions and non saves', () => {
    const b = prepared();
    const data = JSON.parse(JSON.stringify(b.serialize()));
    expect(() => new Sim('OTHER', OPTIONS).restore(data)).toThrow(/different seed/);
    expect(() => migrate({ ...data, version: SAVE_VERSION + 1 })).toThrow(/newer version/);
    expect(() => migrate({ hello: 1 })).toThrow(/not an Airfield Tycoon save/);
  });

  it('a version 7 save with a control room and no tower warns once and loses ATC', () => {
    const sim = ownedSim();
    sim.cash = 100_000_000;
    buildTestAirport(sim);
    buildTestTerminal(sim, { atc: false });
    expect(buildTestControlRoom(sim)).toEqual([]);
    const data = JSON.parse(JSON.stringify(sim.serialize())) as { version: number; airfield: { towers?: unknown } };
    data.version = 7;
    delete data.airfield.towers;
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(data);
    const events: string[] = [];
    c.drainEvents(events);
    expect(events.filter((e) => e === 'atcLost')).toHaveLength(1);
    expect(c.business.atcOk).toBe(false);
    expect(c.airfield.data.towers).toEqual([]);
  });
});
