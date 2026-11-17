import { describe, expect, it } from 'vitest';
import { AcState } from '@sim/ops/traffic';
import { EdgeKind } from '@sim/airfield/network';
import type { Sim } from '@sim/sim';
import { buildTestAirport, ownedSim, run } from './helpers';

/**
 * Pass through stands (T72): the test airport's stands face south off taxiway A, and a second taxiway
 * B runs ahead of their noses, so each stand gets a lead out and departs forward.
 */
function throughAirport(withFront: boolean, seed?: string): Sim {
  const sim = ownedSim(seed);
  buildTestAirport(sim, { standType: 'through', standsPerRow: 4 });
  if (withFront) {
    const ev = run(sim, {
      type: 'buildTaxiway',
      points: [
        { x: 3700, y: 5190 },
        { x: 3700, y: 5375 },
        { x: 4200, y: 5375 },
        { x: 4200, y: 5190 },
      ],
      code: 'C',
      kind: 'taxiway',
      surface: 'asphalt',
      tier: 2,
    });
    if (ev.some((e) => e.startsWith('problem'))) throw new Error(ev.join(', '));
  }
  return sim;
}

/** Runs the sim with test traffic and records the states seen by aircraft on the through stands. */
function runTraffic(sim: Sim, ticks: number): { pushbacks: number; departures: number } {
  run(sim, { type: 'setTestTraffic', perHour: 30, turnScale: 0.1 });
  const tr = sim.traffic;
  const onStand = new Set<number>();
  let pushbacks = 0;
  let departures = 0;
  const wasParked = new Uint8Array(tr.state.length);
  for (let t = 0; t < ticks; t++) {
    sim.step();
    for (let i = 0; i < tr.state.length; i++) {
      if (tr.active[i] !== 1) continue;
      const s = tr.state[i];
      if (s === AcState.Turnaround) {
        wasParked[i] = 1;
        onStand.add(i);
      } else if (wasParked[i] === 1) {
        if (s === AcState.Pushback) pushbacks++;
        if (s === AcState.TaxiOut) {
          departures++;
          wasParked[i] = 0;
        }
      }
    }
  }
  return { pushbacks, departures };
}

describe('pass through stands', () => {
  it('get a lead out only with a taxiway ahead of the nose', () => {
    const front = throughAirport(true);
    expect(front.airfield.data.stands.every((s) => s.type === 'through')).toBe(true);
    expect(front.airfield.data.clearanceBreaches ?? []).toEqual([]);
    const net = front.traffic.net;
    expect(Array.from(net.standOut)).toEqual([1, 1, 1, 1]);
    expect(Array.from(net.edgeKind).filter((k) => k === EdgeKind.StandLeadOut).length).toBe(12);
    const plain = throughAirport(false);
    expect(Array.from(plain.traffic.net.standOut)).toEqual([0, 0, 0, 0]);
  });

  it('depart forward with no push back when a lead out exists', () => {
    const { pushbacks, departures } = runTraffic(throughAirport(true), 30000);
    expect(departures).toBeGreaterThan(2);
    expect(pushbacks).toBe(0);
  });

  it('push back when no taxiway lies ahead', () => {
    const { pushbacks, departures } = runTraffic(throughAirport(false), 30000);
    expect(departures).toBeGreaterThan(2);
    expect(pushbacks).toBeGreaterThan(0);
  });

  it('is deterministic over 2 000 ticks', () => {
    const hash = (): number => {
      const sim = throughAirport(true, 'GOLDEN-0072');
      run(sim, { type: 'setTestTraffic', perHour: 60, turnScale: 0.05 });
      for (let t = 0; t < 2000; t++) sim.step();
      return sim.stateHash();
    };
    expect(hash()).toBe(hash());
  });
});
