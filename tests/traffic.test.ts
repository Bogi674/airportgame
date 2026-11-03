import { describe, expect, it } from 'vitest';
import { AIRCRAFT, wakeSeparationSec, WAKE_ORDER } from '@data/aircraft';
import { AcState } from '@sim/ops/traffic';
import { buildTestAirport, ownedSim, run } from './helpers';

const idx = (id: string): number => AIRCRAFT.findIndex((a) => a.id === id);

describe('single flight', () => {
  it('lands, taxis to a stand, turns around, pushes back, taxis out and takes off', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 4 });
    run(sim, { type: 'testArrival', typeIdx: idx('a320neo'), inTicks: 0, turnTicks: 1200 });
    const seen = new Set<number>();
    let ticks = 0;
    while (ticks < 30000 && sim.traffic.completedFlights === 0) {
      sim.step();
      ticks++;
      for (let k = 0; k < 256; k++) if (sim.traffic.active[k] === 1) seen.add(sim.traffic.state[k]);
    }
    expect(sim.traffic.completedFlights).toBe(1);
    expect(sim.traffic.count).toBe(0);
    for (const s of [AcState.Approach, AcState.Rollout, AcState.TaxiIn, AcState.Turnaround, AcState.Pushback, AcState.TaxiOut, AcState.Holding, AcState.LineUp, AcState.Takeoff]) {
      expect(seen.has(s), `state ${s}`).toBe(true);
    }
  });

  it('refuses a flight the runway cannot take and names the limit', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { runwayLengthM: 1100, standsPerRow: 2, standCode: 'E' });
    run(sim, { type: 'testArrival', typeIdx: idx('b777_300er'), inTicks: 0, turnTicks: 600 });
    const events: string[] = [];
    for (let t = 0; t < 2000; t++) {
      sim.step();
      sim.drainEvents(events);
    }
    expect(events.some((e) => e.startsWith('flightRefused|type=b777_300er|reason=landingLength'))).toBe(true);
    expect(sim.traffic.count).toBe(0);
  });
});

describe('busy airport', () => {
  function simulate(seconds: number) {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 10 });
    run(sim, { type: 'setTestTraffic', perHour: 40, turnScale: 0.1 });
    const t = sim.traffic;
    let minGap = Infinity;
    let maxOnRunway = 0;
    let peak = 0;
    const uses: { tick: number; cat: number }[] = [];
    const wasUsing = new Uint8Array(256);
    for (let tick = 0; tick < seconds * 10; tick++) {
      sim.step();
      peak = Math.max(peak, t.count);
      let onRwy = 0;
      for (let i = 0; i < 256; i++) {
        if (t.active[i] === 0) {
          wasUsing[i] = 0;
          continue;
        }
        const st = t.state[i];
        const using = st === AcState.Rollout || st === AcState.Takeoff || st === AcState.LineUp;
        if ((st === AcState.Rollout || st === AcState.Takeoff) && t.x[i] >= 3000 && t.x[i] <= 5600 && Math.abs(t.y[i] - 5000) < 30) onRwy++;
        if ((st === AcState.Rollout || st === AcState.Takeoff) && wasUsing[i] === 0) {
          uses.push({ tick: sim.tick, cat: WAKE_ORDER.indexOf(AIRCRAFT[t.type[i]].derivedForReading.wake) });
        }
        wasUsing[i] = using || st === AcState.Takeoff ? 1 : 0;
        if (st === AcState.TaxiIn || st === AcState.TaxiOut || st === AcState.Pushback || st === AcState.Holding || st === AcState.Turnaround) {
          for (let j = i + 1; j < 256; j++) {
            if (t.active[j] === 0) continue;
            const sj = t.state[j];
            if (sj !== AcState.TaxiIn && sj !== AcState.TaxiOut && sj !== AcState.Pushback && sj !== AcState.Holding && sj !== AcState.Turnaround) continue;
            minGap = Math.min(minGap, Math.hypot(t.x[i] - t.x[j], t.y[i] - t.y[j]));
          }
        }
      }
      maxOnRunway = Math.max(maxOnRunway, onRwy);
    }
    return { sim, minGap, maxOnRunway, peak, uses };
  }

  it('keeps aircraft apart, uses the runway one at a time and completes flights', () => {
    const r = simulate(3600);
    expect(r.sim.traffic.completedFlights).toBeGreaterThan(6);
    expect(r.peak).toBeGreaterThan(3);
    expect(r.maxOnRunway).toBeLessThanOrEqual(1);
    // Ground aircraft never sit on top of each other (stands are 45 m apart).
    // Deadlock resolution may let two aircraft briefly overlap, so the floor is lower than the stand spacing.
    expect(r.minGap).toBeGreaterThan(5);
    expect(r.sim.traffic.deadlocks).toBeLessThan(10);
  });

  it('respects wake separation between consecutive runway uses', () => {
    const r = simulate(3600);
    for (let k = 1; k < r.uses.length; k++) {
      const need = wakeSeparationSec(WAKE_ORDER[r.uses[k - 1].cat], WAKE_ORDER[r.uses[k].cat]) * 10;
      expect(r.uses[k].tick - r.uses[k - 1].tick).toBeGreaterThanOrEqual(need);
    }
  });

  it('is deterministic', () => {
    expect(simulate(900).sim.stateHash()).toBe(simulate(900).sim.stateHash());
  });
});

describe('airfield edits while traffic moves', () => {
  it('re-plans after a new taxiway is built and keeps flying', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 4 });
    run(sim, { type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
    for (let t = 0; t < 6000; t++) sim.step();
    run(sim, { type: 'buildTaxiway', points: [{ x: 5000, y: 5400 }, { x: 5300, y: 5400 }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 1 });
    for (let t = 0; t < 12000; t++) sim.step();
    expect(sim.traffic.completedFlights).toBeGreaterThan(0);
  });
});
