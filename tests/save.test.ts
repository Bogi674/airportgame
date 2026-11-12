import { describe, expect, it } from 'vitest';
import { Sim } from '@sim/sim';
import { migrate, SAVE_VERSION } from '@sim/save/migrations';
import { terminalIssues } from '@shared/terminalRooms';
import { gridOnLevel, newGrid } from '@shared/terminalOps';
import { buildTestAirport, buildTestControlRoom, buildTestTerminal, ownedSim, run, OPTIONS } from './helpers';

function prepared(): Sim {
  const sim = ownedSim();
  sim.cash = 80_000_000;
  buildTestAirport(sim, { standsPerRow: 6 });
  buildTestTerminal(sim, { shop: true });
  run(sim, { type: 'signAirline', airlineId: 0, rotations: 3 });
  run(sim, { type: 'signAirline', airlineId: 1, rotations: 3 });
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

  it('a version 9 save loads with no remembered stands per rotation', () => {
    const sim = prepared();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as {
      version: number;
      business: { airlines: { standPrefs?: number[] }[] };
      traffic: { arrays: Record<string, string> };
    };
    data.version = 9;
    for (const a of data.business.airlines) delete a.standPrefs;
    delete data.traffic.arrays.fRot;
    const c = new Sim('GOLDEN-0001', OPTIONS);
    expect(() => c.restore(data)).not.toThrow();
    for (const a of c.business.airlines) expect(a.standPrefs).toEqual(new Array<number>(a.rotations).fill(-1));
  });

  it('a version 10 save loads with every terminal on floor 0', () => {
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
    const c = new Sim('GOLDEN-0001', OPTIONS);
    expect(() => c.restore(data)).not.toThrow();
    expect(sim.business.grids.length).toBeGreaterThan(0);
    expect(c.business.grids).toHaveLength(sim.business.grids.length);
    c.business.grids.forEach((g, i) => {
      expect(g.level).toBe(0);
      expect(g.building).toBe(g.id);
      expect(terminalIssues(g)).toEqual(terminalIssues(sim.business.grids[i]));
    });
    expect(c.stateHash()).toBe(sim.stateHash());
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
