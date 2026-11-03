import { describe, expect, it } from 'vitest';
import type { Command } from '@sim/commands';
import { recordReplay, runReplay } from '@sim/replay';
import { Sim } from '@sim/sim';
import { SITE_SIZE_M } from '@shared/math';
import { createSnapshotBuffer, createSnapshotViews, SnapHeader } from '@shared/snapshot';

const OPTIONS = { preset: 'flatCoastal' } as const;

function script(sim: Sim, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    if (t === 0) {
      for (let i = 0; i < 20; i++) {
        sim.enqueue({ type: 'spawnTestAircraft', x: 400 * i, y: 3000 + 50 * i, heading: i * 0.37, speed: 70 });
      }
    }
    if (t === 700) sim.enqueue({ type: 'spawnTestAircraft', x: 10, y: 10, heading: 1, speed: 50 });
    if (t === 1500) sim.enqueue({ type: 'clearTestAircraft' });
    sim.step();
  }
}

describe('Sim determinism', () => {
  it('2000 ticks twice from one seed give identical hashes', () => {
    const a = new Sim('GOLDEN-0001', OPTIONS);
    const b = new Sim('GOLDEN-0001', OPTIONS);
    script(a, 2000);
    script(b, 2000);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('different seeds diverge', () => {
    const a = new Sim('GOLDEN-0001', OPTIONS);
    const b = new Sim('GOLDEN-0002', OPTIONS);
    script(a, 300);
    script(b, 300);
    expect(a.stateHash()).not.toBe(b.stateHash());
  });

  it('step is equivalent to running subsystems then endTick', () => {
    const a = new Sim('S', OPTIONS);
    const b = new Sim('S', OPTIONS);
    const spawn: Command = { type: 'spawnTestAircraft', x: 5, y: 5, heading: 0.5, speed: 60 };
    a.enqueue(spawn);
    b.enqueue(spawn);
    for (let t = 0; t < 100; t++) {
      a.step();
      for (let i = 0; i < b.subsystemCount; i++) b.runSubsystem(i);
      b.endTick();
    }
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('keeps aircraft inside the site', () => {
    const sim = new Sim('S', OPTIONS);
    script(sim, 1400);
    for (let i = 0; i < sim.aircraftX.length; i++) {
      if (sim.aircraftActive[i] === 0) continue;
      expect(sim.aircraftX[i]).toBeGreaterThanOrEqual(0);
      expect(sim.aircraftX[i]).toBeLessThan(SITE_SIZE_M);
      expect(sim.aircraftY[i]).toBeGreaterThanOrEqual(0);
      expect(sim.aircraftY[i]).toBeLessThan(SITE_SIZE_M);
    }
  });
});

describe('Command log and replay', () => {
  it('logs commands at the tick they were applied', () => {
    const sim = new Sim('S', OPTIONS);
    sim.step();
    sim.step();
    sim.enqueue({ type: 'clearTestAircraft' });
    sim.step();
    expect(sim.log.entries).toEqual([{ tick: 2, cmd: { type: 'clearTestAircraft' } }]);
  });

  it('replaying seed plus log reproduces the live hash', () => {
    const live = new Sim('GOLDEN-0001', OPTIONS);
    script(live, 2000);
    const replay = JSON.parse(JSON.stringify(recordReplay(live))) as ReturnType<typeof recordReplay>;
    const rerun = runReplay(replay, 2000);
    expect(rerun.stateHash()).toBe(live.stateHash());
  });

  it('rejects an unknown replay version', () => {
    expect(() => runReplay({ version: 99, seed: 'S', options: OPTIONS, commands: [] }, 1)).toThrow();
  });
});

describe('Snapshot writing', () => {
  it('writes aircraft into the buffer', () => {
    const sim = new Sim('S', OPTIONS);
    sim.enqueue({ type: 'spawnTestAircraft', x: 100, y: 200, heading: 0, speed: 0 });
    sim.step();
    const views = createSnapshotViews(createSnapshotBuffer());
    sim.writeSnapshot(views);
    expect(views.header[SnapHeader.Tick]).toBe(1);
    expect(views.header[SnapHeader.AircraftCount]).toBe(1);
    expect(views.aircraftX[0]).toBeCloseTo(100);
    expect(views.aircraftY[0]).toBeCloseTo(200);
  });
});

describe('Paused command flush', () => {
  it('applies commands without advancing time and still replays identically', () => {
    const live = new Sim('S', OPTIONS);
    for (let i = 0; i < 10; i++) live.step();
    live.enqueue({ type: 'spawnTestAircraft', x: 1, y: 2, heading: 0, speed: 10 });
    live.flushCommands();
    expect(live.tick).toBe(10);
    expect(live.aircraftCount).toBe(1);
    for (let i = 0; i < 50; i++) live.step();
    const rerun = runReplay(recordReplay(live), 60);
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

  it('purchases replay deterministically', () => {
    const live = new Sim('GOLDEN-0001', OPTIONS);
    const p = firstFor(live, (t) => t !== 6);
    live.step();
    live.enqueue({ type: 'buyParcel', parcelId: p });
    for (let i = 0; i < 30; i++) live.step();
    const rerun = runReplay(recordReplay(live), 31);
    expect(rerun.stateHash()).toBe(live.stateHash());
  });
});
