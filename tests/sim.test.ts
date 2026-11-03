import { describe, expect, it } from 'vitest';
import type { Command } from '@sim/commands';
import { recordReplay } from '@sim/replay';
import { Sim } from '@sim/sim';
import { createSnapshotBuffer, createSnapshotViews, SnapHeader } from '@shared/snapshot';
import { buildTestAirport, OPTIONS, ownedSim, run } from './helpers';

function scripted(sim: Sim, ticks: number): void {
  buildTestAirport(sim, { standsPerRow: 4 });
  sim.enqueue({ type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
  for (let t = 0; t < ticks; t++) sim.step();
}

describe('Sim determinism', () => {
  it('2000 ticks twice from one seed give identical hashes', () => {
    const a = ownedSim();
    const b = ownedSim();
    scripted(a, 2000);
    scripted(b, 2000);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.traffic.count + a.traffic.completedFlights).toBeGreaterThan(0);
  });

  it('different seeds diverge', () => {
    const a = new Sim('GOLDEN-0001', OPTIONS);
    const b = new Sim('GOLDEN-0002', OPTIONS);
    for (let t = 0; t < 50; t++) {
      a.step();
      b.step();
    }
    expect(a.stateHash()).not.toBe(b.stateHash());
  });

  it('step is equivalent to running subsystems then endTick', () => {
    const a = new Sim('S', OPTIONS);
    const b = new Sim('S', OPTIONS);
    for (let t = 0; t < 100; t++) {
      a.step();
      for (let i = 0; i < b.subsystemCount; i++) b.runSubsystem(i);
      b.endTick();
    }
    expect(a.stateHash()).toBe(b.stateHash());
  });
});

describe('Command log and replay', () => {
  it('logs commands at the tick they were applied', () => {
    const sim = new Sim('S', OPTIONS);
    sim.step();
    sim.step();
    sim.enqueue({ type: 'setTestTraffic', perHour: 0, turnScale: 1 });
    sim.step();
    expect(sim.log.entries).toEqual([{ tick: 2, cmd: { type: 'setTestTraffic', perHour: 0, turnScale: 1 } }]);
  });

  it('replaying seed plus log reproduces the live hash', () => {
    const live = ownedSim();
    scripted(live, 1500);
    const replay = JSON.parse(JSON.stringify(recordReplay(live))) as ReturnType<typeof recordReplay>;
    // Ownership is test setup, so the replay applies it too.
    const rerun = new Sim(replay.seed, replay.options);
    rerun.parcelOwner.fill(1);
    let next = 0;
    for (let t = 0; t < live.tick; t++) {
      while (next < replay.commands.length && replay.commands[next].tick === t) rerun.enqueue(replay.commands[next++].cmd);
      rerun.step();
    }
    expect(rerun.stateHash()).toBe(live.stateHash());
  });
});

describe('Snapshot writing', () => {
  it('writes aircraft into the buffer', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 2 });
    run(sim, { type: 'testArrival', typeIdx: 1, inTicks: 0, turnTicks: 600 });
    for (let t = 0; t < 400; t++) sim.step();
    const views = createSnapshotBuffer();
    const v = createSnapshotViews(views);
    sim.writeSnapshot(v);
    expect(v.header[SnapHeader.Tick]).toBe(sim.tick);
    expect(v.header[SnapHeader.AircraftCount]).toBe(sim.traffic.count);
    expect(sim.traffic.count).toBe(1);
    expect(v.aircraftX[0]).toBeGreaterThan(0);
  });
});

describe('Paused command flush', () => {
  it('applies commands without advancing time and still replays identically', () => {
    const live = new Sim('S', OPTIONS);
    for (let i = 0; i < 10; i++) live.step();
    live.enqueue({ type: 'setTestTraffic', perHour: 30, turnScale: 1 });
    live.flushCommands();
    expect(live.tick).toBe(10);
    for (let i = 0; i < 50; i++) live.step();
    const rerun = new Sim('S', OPTIONS);
    let next = 0;
    const log = recordReplay(live).commands;
    for (let t = 0; t < 60; t++) {
      while (next < log.length && log[next].tick === t) rerun.enqueue(log[next++].cmd as Command);
      rerun.step();
    }
    expect(rerun.stateHash()).toBe(live.stateHash());
  });
});

describe('Parcel purchase', () => {
  const firstFor = (sim: Sim, pred: (type: number) => boolean): number => {
    for (let p = 0; p < sim.site.parcelCount; p++) if (sim.parcelOwner[p] === 0 && pred(sim.site.parcelType[p])) return p;
    return -1;
  };

  it('starts with three owned parcels and the starting cash', () => {
    const sim = new Sim('GOLDEN-0001', OPTIONS);
    let owned = 0;
    for (let p = 0; p < sim.site.parcelCount; p++) owned += sim.parcelOwner[p];
    expect(owned).toBe(3);
    expect(sim.cash).toBe(30_000_000);
  });

  it('buying deducts the price and marks the parcel owned', () => {
    const sim = new Sim('GOLDEN-0001', OPTIONS);
    const p = firstFor(sim, (t) => t !== 6);
    const price = sim.site.parcelPrice[p];
    sim.enqueue({ type: 'buyParcel', parcelId: p });
    sim.step();
    expect(sim.parcelOwner[p]).toBe(1);
    expect(sim.cash).toBe(30_000_000 - price);
    expect(sim.takeOwnershipDirty()).toBe(true);
    expect(sim.takeOwnershipDirty()).toBe(false);
  });

  it('refuses protected land and reports it', () => {
    const sim = new Sim('GOLDEN-0001', OPTIONS);
    const p = firstFor(sim, (t) => t === 6);
    expect(p).toBeGreaterThanOrEqual(0);
    sim.enqueue({ type: 'buyParcel', parcelId: p });
    sim.step();
    expect(sim.parcelOwner[p]).toBe(0);
    const events: string[] = [];
    sim.drainEvents(events);
    expect(events).toEqual(['parcelNotForSale']);
  });

  it('refuses a purchase the player cannot afford', () => {
    const sim = new Sim('GOLDEN-0001', OPTIONS);
    sim.cash = 10;
    const p = firstFor(sim, (t) => t !== 6);
    sim.enqueue({ type: 'buyParcel', parcelId: p });
    sim.step();
    expect(sim.parcelOwner[p]).toBe(0);
    expect(sim.cash).toBe(10);
    const events: string[] = [];
    sim.drainEvents(events);
    expect(events).toEqual(['insufficientFunds']);
  });

  it('ignores invalid ids and repeat purchases', () => {
    const sim = new Sim('GOLDEN-0001', OPTIONS);
    sim.enqueue({ type: 'buyParcel', parcelId: -5 });
    sim.enqueue({ type: 'buyParcel', parcelId: 1e9 });
    sim.enqueue({ type: 'buyParcel', parcelId: sim.site.startParcels[0] });
    sim.step();
    expect(sim.cash).toBe(30_000_000);
  });

  it('buys several parcels at once or none', () => {
    const sim = new Sim('GOLDEN-0001', OPTIONS);
    const ids: number[] = [];
    for (let p = 0; p < sim.site.parcelCount && ids.length < 3; p++) if (sim.parcelOwner[p] === 0 && sim.site.parcelType[p] !== 6) ids.push(p);
    const total = ids.reduce((s, id) => s + sim.site.parcelPrice[id], 0);
    sim.enqueue({ type: 'buyParcels', ids });
    sim.step();
    expect(sim.cash).toBe(30_000_000 - total);
    expect(ids.every((id) => sim.parcelOwner[id] === 1)).toBe(true);
    const poor = new Sim('GOLDEN-0001', OPTIONS);
    poor.cash = 1;
    poor.enqueue({ type: 'buyParcels', ids });
    poor.step();
    expect(ids.every((id) => poor.parcelOwner[id] === 0)).toBe(true);
  });
});
