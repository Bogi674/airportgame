import { describe, expect, it } from 'vitest';
import { AcState } from '@sim/ops/traffic';
import { Sim } from '@sim/sim';
import type { Sim as SimT } from '@sim/sim';
import { OPTIONS, ownedSim, run } from './helpers';

/**
 * The layout of the owner's report of 2026-11-24 (T87): a connector from the parallel taxiway joined end to
 * end with an apron taxilane, general aviation stands off the taxilane, so arrivals and departures share one
 * two way stretch from both ends.
 */
function ownerLayout(): SimT {
  const sim = ownedSim();
  const problems: string[] = [];
  const go = (c: Parameters<typeof run>[1]): void => {
    problems.push(...run(sim, c).filter((e) => !e.startsWith('cash')));
  };
  go({ type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 1600, code: 'B', approach: 'visual', surface: 'asphalt', tier: 1 });
  go({ type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 120, code: 'B', connectors: 3, surface: 'asphalt', tier: 1 });
  go({ type: 'buildTaxiway', points: [{ x: 3800, y: 5120 }, { x: 3780, y: 5250 }], code: 'B', kind: 'taxiway', surface: 'asphalt', tier: 1 });
  go({ type: 'buildApron', polygon: [{ x: 3600, y: 5250 }, { x: 4000, y: 5250 }, { x: 4000, y: 5400 }, { x: 3600, y: 5400 }], surface: 'asphalt', tier: 1 });
  go({ type: 'buildTaxiway', points: [{ x: 3780, y: 5250 }, { x: 3770, y: 5300 }, { x: 3620, y: 5300 }], code: 'B', kind: 'taxilane', surface: 'asphalt', tier: 1 });
  go({ type: 'buildGaBlock', x: 3700, y: 5400, headingDeg: 180, count: 4 });
  go({ type: 'buildTower', x: 3300, y: 4700, level: 2 });
  if (problems.length > 0) throw new Error(`owner layout failed: ${problems.join(', ')}`);
  return sim;
}

const GROUND: readonly number[] = [AcState.TaxiIn, AcState.TaxiOut, AcState.Pushback, AcState.Holding, AcState.TowBack];

/** Largest time any ground aircraft spent standing still, in ticks, over a run. */
function runFor(sim: SimT, ticks: number, each?: (t: number) => void): { stillest: number; towed: number } {
  const tr = sim.traffic;
  let stillest = 0;
  let towed = 0;
  for (let t = 0; t < ticks; t++) {
    each?.(t);
    sim.step();
    if (t % 50 !== 0) continue;
    for (let i = 0; i < 256; i++) {
      if (tr.active[i] === 0) continue;
      if (tr.state[i] === AcState.TowBack) towed++;
      if (GROUND.includes(tr.state[i]) && tr.state[i] !== AcState.Holding) stillest = Math.max(stillest, tr.stuckTicks[i]);
    }
  }
  return { stillest, towed };
}

describe('two way stretches are claimed whole (T87)', () => {
  it('arrivals and departures share the connector and apron taxilane without a deadlock', () => {
    const sim = ownerLayout();
    const r = runFor(sim, 400_000);
    expect(sim.traffic.deadlocks).toBe(0);
    expect(sim.traffic.completedFlights).toBeGreaterThan(20);
    // Nobody waits more than ten game minutes on the ground (the old layout stalled for good).
    expect(r.stillest).toBeLessThan(6000);
  }, 120_000);

  it('an airfield edit keeps taxiing aircraft where they are and loses none', () => {
    const sim = ownerLayout();
    const tr = sim.traffic;
    let checked = 0;
    const lost: string[] = [];
    for (let t = 0; t < 200_000 && checked < 6; t++) {
      sim.step();
      if (t % 997 !== 0) continue;
      const moving: number[] = [];
      for (let i = 0; i < 256; i++) if (tr.active[i] === 1 && (tr.state[i] === AcState.TaxiIn || tr.state[i] === AcState.TaxiOut) && tr.speed[i] > 1) moving.push(i);
      if (moving.length === 0) continue;
      const before = moving.map((i) => [tr.x[i], tr.y[i]]);
      const ev = run(sim, { type: 'buildTaxiway', points: [{ x: 4300 + checked * 30, y: 5300 }, { x: 4300 + checked * 30, y: 5500 }], code: 'B', kind: 'taxiway', surface: 'asphalt', tier: 1 });
      lost.push(...ev.filter((e) => e.startsWith('flightLost')));
      moving.forEach((i, k) => {
        expect(tr.active[i]).toBe(1);
        // One tick of driving at most, plus the gap between the 2 m samples and the drawn line.
        expect(Math.hypot(tr.x[i] - before[k][0], tr.y[i] - before[k][1])).toBeLessThan(2);
      });
      checked++;
    }
    expect(checked).toBe(6);
    expect(lost).toEqual([]);
  }, 60_000);

  it('a pair already nose to nose is resolved by towing one back', () => {
    const sim = ownerLayout();
    const tr = sim.traffic;
    // Recreate the old fault: arrivals on the connector lose their claim, so departures drive into them.
    const drop = (tr as unknown as { dropClaim(i: number): void }).dropClaim.bind(tr);
    const sabotage = (): void => {
      for (let i = 0; i < 256; i++) {
        if (tr.active[i] === 1 && tr.state[i] === AcState.TaxiIn && tr.y[i] > 5130 && tr.y[i] < 5300) drop(i);
      }
    };
    const first = runFor(sim, 150_000, sabotage);
    expect(first.towed).toBeGreaterThan(0);
    const done = tr.completedFlights;
    const after = runFor(sim, 150_000);
    expect(tr.completedFlights).toBeGreaterThan(done);
    expect(after.stillest).toBeLessThan(6000);
  }, 120_000);

  it('is deterministic over 2 000 ticks of shared traffic', () => {
    const hashes: number[] = [];
    for (let k = 0; k < 2; k++) {
      const sim = ownerLayout();
      run(sim, { type: 'setTestTraffic', perHour: 30, turnScale: 0.1 });
      for (let t = 0; t < 2000; t++) sim.step();
      hashes.push(sim.stateHash());
    }
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('a save restores the claims and the hash, and a save from before T87 claims again', () => {
    const a = ownerLayout();
    for (let t = 0; t < 30_000; t++) a.step();
    const raw = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Sim(a.seed, OPTIONS);
    b.restore(JSON.parse(JSON.stringify(raw)));
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
    // The older shape: version 42 with the per block counters and no claims.
    const old = JSON.parse(JSON.stringify(raw));
    old.version = 42;
    for (const k of ['claimFrom', 'claimTo', 'oppWait', 'towIdx', 'towClearM', 'towState']) delete old.traffic.arrays[k];
    old.traffic.arrays.curBlock = old.traffic.arrays.heldNode;
    const c = new Sim(a.seed, OPTIONS);
    c.restore(old);
    const before = c.traffic.completedFlights;
    const r = runFor(c, 100_000);
    expect(r.stillest).toBeLessThan(6000);
    expect(c.traffic.completedFlights).toBeGreaterThan(before);
  }, 60_000);
});
