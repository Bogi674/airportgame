import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { Sim } from '@sim/sim';
import { migrate, SAVE_VERSION } from '@sim/save/migrations';
import { packTyped, unpackTyped } from '@sim/save/pack';
import { FLAG_SLOW, Stage } from '@sim/cohorts/cohorts';
import { TRAIT, TRAIT_COUNT, memberSeedOf, writeTraits } from '@sim/cohorts/traits';
import { FIXTURE_KEYS, FLOOR } from '@shared/business';
import { SERVICE_KEYS, type ServiceSave } from '@sim/terminal/serviceNodes';
import { terminalIssues } from '@shared/terminalRooms';
import { cellIndex, ensureCells, gridOnLevel, newGrid } from '@shared/terminalOps';
import { buildArrivalTerminal, buildTestAirport, buildTestControlRoom, buildTestTerminal, ownedSim, run, OPTIONS } from './helpers';

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

  it('a version 27 save migrates fixture offsets, levels and security lane direction', () => {
    const sim = ownedSim();
    const g = newGrid(7, 0, 0, 0);
    ensureCells(g, 0, 0, 32, 32);
    g.floor.fill(FLOOR.Tile);
    const gate = FIXTURE_KEYS.indexOf('gateDesk') + 1;
    const security = FIXTURE_KEYS.indexOf('security') + 1;
    const at = (x: number, y: number): number => cellIndex(g, x, y);
    g.fixture[at(3, 3)] = gate;
    g.fixtureRot[at(3, 3)] = 1;
    g.fixture[at(4, 3)] = gate;
    g.fixtureRot[at(4, 3)] = 5;
    g.fixture[at(10, 3)] = security;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) g.zone[at(x, y)] = x <= 10 ? 1 : 3;
    sim.business.grids.push(g);
    const data = JSON.parse(JSON.stringify(sim.serialize())) as { version: number; business: { grids: Record<string, string | number>[] } };
    data.version = 27;
    for (const sg of data.business.grids) {
      delete sg.fixtureOff;
      delete sg.fixtureLevel;
      delete sg.fixtureMode;
    }
    const zonesBefore = data.business.grids.map((sg) => sg.zone);
    const migrated = migrate(data);
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(data.business.grids.map((sg) => sg.zone)).toEqual(zonesBefore);
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(migrated);
    const loaded = c.business.grids.find((x) => x.id === 7);
    if (!loaded) throw new Error('grid 7 missing');
    expect(Array.from(loaded.zone)).toEqual(Array.from(g.zone));
    expect(loaded.fixtureOff[at(4, 3)]).toBe(1);
    expect(loaded.fixtureOff[at(3, 3)]).toBe(0);
    expect(loaded.fixtureLevel[at(3, 3)]).toBe(1);
    expect(loaded.fixtureLevel[at(4, 3)]).toBe(1);
    expect(loaded.fixtureLevel[at(5, 5)]).toBe(0);
    expect(loaded.fixtureRot[at(10, 3)]).toBe(2);
    const d = new Sim('GOLDEN-0001', OPTIONS);
    d.restore(JSON.parse(JSON.stringify(c.serialize())));
    expect(d.stateHash()).toBe(c.stateHash());
  });

  it('a version 26 save with cohorts and a security lane migrates through all three steps to the current version', () => {
    const sim = ownedSim();
    buildTestAirport(sim);
    expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2 })).toEqual([]);
    sim.traffic.scheduleArrival(AIRCRAFT.findIndex((a) => a.id === 'a320neo'), sim.traffic.nowTick + 100, 0, 6000, -1);
    for (let t = 0; t < 400; t++) sim.step();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as {
      version: number;
      business: { grids: Record<string, string>[] };
      cohorts: { hi: number; arrays: Record<string, string> };
    };
    data.version = 26;
    const securityId = FIXTURE_KEYS.indexOf('security') + 1;
    const lanes: { grid: number; cell: number }[] = [];
    data.business.grids.forEach((sg, k) => {
      const fixture = unpackTyped(sg.fixture!, Uint8Array);
      const rot = unpackTyped(sg.fixtureRot!, Uint8Array);
      for (let i = 0; i < fixture.length; i++) {
        if (fixture[i] !== securityId) continue;
        rot[i] = 0;
        lanes.push({ grid: k, cell: i });
      }
      sg.fixtureRot = packTyped(rot);
      delete sg.fixtureOff;
      delete sg.fixtureLevel;
      delete sg.fixtureMode;
    });
    expect(lanes.length).toBeGreaterThan(0);
    for (const k of ['walkStart', 'needTick', 'parent', 'waitStart', 'target', 'visitNeed', 'memberSeed', 'memberNeed', 'memberSat']) delete data.cohorts.arrays[k];
    const out = migrate(data) as unknown as typeof data;
    expect(out.version).toBe(SAVE_VERSION);
    const walkStart = unpackTyped(out.cohorts.arrays.walkStart!, Int32Array);
    expect(walkStart.length).toBe(out.cohorts.hi);
    expect(walkStart.every((v) => v === -1)).toBe(true);
    for (const { grid, cell } of lanes) {
      const sg = out.business.grids[grid]!;
      const rot = unpackTyped(sg.fixtureRot!, Uint8Array);
      expect(rot[cell]).toBeGreaterThanOrEqual(1);
      expect(rot[cell]).toBeLessThanOrEqual(4);
      expect(unpackTyped(sg.fixtureOff!, Uint8Array).length).toBe(rot.length);
      expect(unpackTyped(sg.fixtureLevel!, Uint8Array)[cell]).toBe(1);
      expect(unpackTyped(sg.fixtureMode!, Uint8Array)[cell]).toBe(0);
    }
    const seeds = unpackTyped(out.cohorts.arrays.memberSeed!, Uint32Array);
    const recipe = unpackTyped(out.cohorts.arrays.recipeSeed!, Uint32Array);
    expect(seeds[0]).toBe(memberSeedOf(recipe[0]!, 0));
    expect(unpackTyped(out.cohorts.arrays.parent!, Int32Array)[0]).toBe(-1);
    const c = new Sim(sim.seed, OPTIONS);
    c.restore(out);
    expect(c.cohorts.hi).toBe(out.cohorts.hi);
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

  it('a version 28 save with cohorts migrates to 29 with seeded members', () => {
    const sim = ownedSim();
    buildTestAirport(sim);
    expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2 })).toEqual([]);
    sim.traffic.scheduleArrival(AIRCRAFT.findIndex((a) => a.id === 'a320neo'), sim.traffic.nowTick + 100, 0, 6000, -1);
    for (let t = 0; t < 400; t++) sim.step();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as {
      version: number;
      cohorts: { hi: number; arrays: Record<string, string> };
    };
    data.version = 28;
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

  it('a version 28 save with a slow member gets the slow flag on migration', () => {
    const sim = ownedSim();
    buildTestAirport(sim);
    expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2 })).toEqual([]);
    sim.traffic.scheduleArrival(AIRCRAFT.findIndex((a) => a.id === 'a320neo'), sim.traffic.nowTick + 100, 0, 6000, -1);
    for (let t = 0; t < 400; t++) sim.step();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as {
      version: number;
      cohorts: { hi: number; arrays: Record<string, string> };
    };
    data.version = 28;
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

  it('a version 31 save migrates with no staff field and loads with no staff', () => {
    const sim = ownedSim();
    for (let t = 0; t < 20; t++) sim.step();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as { version: number; staff?: unknown };
    data.version = 31;
    delete data.staff;
    const out = migrate(data);
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.staff).toBeUndefined();
    const c = new Sim(sim.seed, OPTIONS);
    c.restore(data);
    expect(c.staff.hi).toBe(0);
  });
});

type ServiceData = { version: number; business: { grids: { fixture: string; fixtureRot: string }[]; service: ServiceSave[] }; cohorts?: { arrays: Record<string, string> } };

/**
 * Rewrites a save whose service table in grid 0 holds the anchors of `present` as an older one that holds only the
 * anchors of `keep`: the rows of the other anchors are dropped. With `remap`, the node index of every cohort in grid
 * 0 moves back to its old row, as the migration to version 34 expects; the migration to 31 never remapped them.
 */
function dropServiceRows(data: ServiceData, version: number, present: readonly string[], keep: readonly string[], remap: boolean): void {
  data.version = version;
  const fixture = unpackTyped(data.business.grids[0]!.fixture, Uint8Array);
  const rot = unpackTyped(data.business.grids[0]!.fixtureRot, Uint8Array);
  const s = data.business.service[0]!;
  const kept: number[] = [];
  const oldOfNew = new Int32Array(s.count).fill(-1);
  let node = 0;
  for (let c = 0; c < fixture.length; c++) {
    const key = FIXTURE_KEYS[fixture[c]! - 1] ?? '';
    if (rot[c]! >= 5 || !present.includes(key)) continue;
    if (keep.includes(key)) {
      oldOfNew[node] = kept.length;
      kept.push(node);
    }
    node++;
  }
  const slots = unpackTyped(s.qCohort, Int32Array).length / s.count;
  const pick = (text: string, ctor: Int32ArrayConstructor | Uint16ArrayConstructor, per: number): string => {
    const src = unpackTyped(text, ctor as Int32ArrayConstructor);
    const out = new ctor(kept.length * per);
    kept.forEach((from, k) => {
      for (let j = 0; j < per; j++) out[k * per + j] = src[from * per + j]!;
    });
    return packTyped(out);
  };
  data.business.service[0] = {
    ...s,
    count: kept.length,
    queueLen: pick(s.queueLen, Int32Array, 1),
    busyUntil: pick(s.busyUntil, Int32Array, 1),
    serving: pick(s.serving, Int32Array, 1),
    servingSize: pick(s.servingSize, Int32Array, 1),
    qCohort: pick(s.qCohort, Int32Array, slots),
    qSize: pick(s.qSize, Int32Array, slots),
    qHead: pick(s.qHead, Uint16Array, 1),
    qCount: pick(s.qCount, Uint16Array, 1),
  };
  const arrays = data.cohorts?.arrays;
  if (remap && arrays?.node !== undefined && arrays.building !== undefined) {
    const nodes = unpackTyped(arrays.node, Int32Array);
    const building = unpackTyped(arrays.building, Uint8Array);
    for (let c = 0; c < nodes.length; c++) if (building[c] === 0 && nodes[c]! >= 0) nodes[c] = oldOfNew[nodes[c]!]!;
    arrays.node = packTyped(nodes);
  }
}

describe('save 30 to 31 service rows (T20)', () => {
  const NEW_IDS = [FIXTURE_KEYS.indexOf('eGate') + 1, FIXTURE_KEYS.indexOf('customs') + 1];

  /** A sim with a queue at the check in desks and an eGate and a customs fixture in the public hall. */
  function withArrivalFixtures(): Sim {
    const sim = ownedSim();
    sim.cash = 80_000_000;
    buildTestAirport(sim, { standsPerRow: 6 });
    // No legacy belts: a save from before version 33 turns them into carousels on load, which is not the subject here.
    expect(buildTestTerminal(sim, { gateDesk: 2, belt: 0 })).toEqual([]);
    const id = sim.business.grids[0]!.id;
    const edit = (x0: number, y0: number, x1: number, y1: number, variant: number): string[] =>
      run(sim, { type: 'terminalBuild', building: id, ox: sim.business.grids[0]!.ox, oy: sim.business.grids[0]!.oy, headingDeg: 90, edit: { op: 'fixture', x0, y0, x1, y1, variant } });
    expect(edit(46, 48, 47, 49, NEW_IDS[0]!)).toEqual([]);
    expect(edit(50, 48, 52, 50, NEW_IDS[1]!)).toEqual([]);
    run(sim, { type: 'signAirline', airlineId: 0, sign: true });
    run(sim, { type: 'signAirline', airlineId: 1, sign: true });
    run(sim, { type: 'setTestTraffic', perHour: 20, turnScale: 0.1 });
    return sim;
  }

  /** Rewrites a version 31 save as version 30 by dropping the rows of the eGate, customs and security exit anchors. */
  function asVersion30(data: ServiceData): void {
    dropServiceRows(data, 33, SERVICE_KEYS, SERVICE_KEYS.slice(0, 9), true);
    dropServiceRows(data, 30, SERVICE_KEYS.slice(0, 9), SERVICE_KEYS.slice(0, 7), false);
  }
  it('a version 30 save with an eGate and a customs fixture keeps its queued cohort and the same hash', () => {
    const a = withArrivalFixtures();
    for (let t = 0; t < 8000 && a.business.serviceNodes[0]!.active === 0; t++) a.step();
    expect(a.business.serviceNodes[0]!.active).toBeGreaterThan(0);
    const data = JSON.parse(JSON.stringify(a.serialize())) as ServiceData;
    const before = a.business.serviceNodes[0]!;
    const queued = Array.from(before.qCohort);
    asVersion30(data);
    expect(data.business.service[0]!.count).toBe(before.count - 3);
    const b = new Sim('GOLDEN-0001', OPTIONS);
    b.restore(data as never);
    const after = b.business.serviceNodes[0]!;
    expect(after.count).toBe(before.count);
    expect(Array.from(after.qCohort)).toEqual(queued);
    expect(Array.from(after.qCount)).toEqual(Array.from(before.qCount));
    expect(Array.from(after.serving)).toEqual(Array.from(before.serving));
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });

  it('a version 30 save with no eGate or customs migrates with an identical service block', () => {
    const sim = prepared();
    for (let t = 0; t < 500; t++) sim.step();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as ServiceData;
    const service = JSON.stringify(data.business.service);
    data.version = 30;
    const migrated = migrate(data) as unknown as ServiceData;
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(JSON.stringify(migrated.business.service)).toBe(service);
  });

  it('a version 30 save whose saved count does not match the grid anchors keeps its table unchanged', () => {
    const a = withArrivalFixtures();
    for (let t = 0; t < 200; t++) a.step();
    const data = JSON.parse(JSON.stringify(a.serialize())) as ServiceData;
    asVersion30(data);
    data.business.service[0]!.count += 1;
    const before = JSON.stringify(data.business.service);
    migrate(data);
    expect(JSON.stringify(data.business.service)).toBe(before);
  });
});

describe('save 33 to 34 security exit rows (T80)', () => {
  const SEC_EXIT = FIXTURE_KEYS.indexOf('securityExit') + 1;
  const A320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');

  /** The arrival hall with an international airline flight on stand 0, whose cohorts queue at immigration past the exit row and never at the exit. */
  function hallWithArrivals(): Sim {
    const sim = ownedSim();
    sim.cash = 1_000_000_000;
    buildTestAirport(sim, { standsPerRow: 8 });
    expect(buildArrivalTerminal(sim, { carousel: true, customs: true })).toEqual([]);
    const market = sim.business.market;
    const dest = market.destinations.find((d) => d.international)!;
    market.series.push({ id: 9001, airline: 0, dest: dest.id, typeIdx: A320, days: 127, winMin: 0, startDay: 0, endDay: 100, standId: -1, minute: -1, turnMin: 30 });
    const f = sim.traffic.scheduleArrival(A320, sim.traffic.nowTick + 100, 0, 600, -1, 0, 9001);
    sim.traffic.fStand[f] = sim.airfield.data.stands[0]!.id;
    return sim;
  }

  /** Index of the security exit node in grid 0. */
  function exitNode(sim: Sim): number {
    const t = sim.business.serviceNodes[0]!;
    return Array.from(t.kind).indexOf(SEC_EXIT);
  }

  it('a version 33 save with cohorts at nodes after the exit keeps their nodes and the same hash', () => {
    const a = hallWithArrivals();
    const co = a.cohorts;
    // Stop while a cohort holds a node whose index is past the exit row, so the remap is exercised.
    let found = false;
    for (let t = 0; t < 20000 && !found; t++) {
      a.step();
      const ex = exitNode(a);
      for (let c = 0; c < co.hi && !found; c++) found = co.stage[c] === Stage.Immigration && co.node[c]! > ex;
    }
    expect(found).toBe(true);
    const data = JSON.parse(JSON.stringify(a.serialize())) as ServiceData;
    const before = a.business.serviceNodes[0]!;
    // The exit is idle, as it must be for a version 33 save to exist.
    const ex = exitNode(a);
    expect(before.qCount[ex]).toBe(0);
    expect(before.serving[ex]).toBe(-1);
    dropServiceRows(data, 33, SERVICE_KEYS, SERVICE_KEYS.slice(0, 9), true);
    expect(data.business.service[0]!.count).toBe(before.count - 1);
    const b = new Sim('GOLDEN-0001', OPTIONS);
    b.restore(data as never);
    expect(b.business.serviceNodes[0]!.count).toBe(before.count);
    expect(Array.from(b.cohorts.node.subarray(0, co.hi))).toEqual(Array.from(co.node.subarray(0, co.hi)));
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  }, 60000);

  it('a version 33 save with no security exit migrates with an identical service block', () => {
    const sim = prepared();
    for (let t = 0; t < 500; t++) sim.step();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as ServiceData;
    const fixture = unpackTyped(data.business.grids[0]!.fixture, Uint8Array);
    if (fixture.includes(SEC_EXIT)) dropServiceRows(data, 33, SERVICE_KEYS, SERVICE_KEYS.slice(0, 9), true);
    else data.version = 33;
    const service = JSON.stringify(data.business.service);
    const migrated = migrate(data) as unknown as ServiceData;
    expect(migrated.version).toBe(SAVE_VERSION);
    if (!fixture.includes(SEC_EXIT)) expect(JSON.stringify(migrated.business.service)).toBe(service);
    else expect(migrated.business.service[0]!.count).toBe(JSON.parse(service)[0].count + 1);
  });
});

