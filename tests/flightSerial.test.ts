import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { Sim } from '@sim/sim';
import { FlState } from '@sim/ops/traffic';
import { buildTestAirport, OPTIONS, ownedSim } from './helpers';

const ATR = AIRCRAFT.findIndex((a) => a.id === 'atr72_600');

function airport(): Sim {
  const sim = ownedSim();
  sim.cash = 500_000_000;
  buildTestAirport(sim, { standsPerRow: 4 });
  return sim;
}

function schedule(sim: Sim, offset: number): number {
  return sim.traffic.scheduleArrival(ATR, sim.traffic.nowTick + offset, 0, 600, -1);
}

function roundTrip(sim: Sim, edit?: (traffic: Record<string, unknown>) => void): Sim {
  const data = JSON.parse(JSON.stringify(sim.serialize())) as { traffic: Record<string, unknown> };
  edit?.(data.traffic);
  const copy = new Sim('GOLDEN-0001', OPTIONS);
  copy.restore(data as never);
  return copy;
}

describe('flight serials', () => {
  it('number flights from 1 and never reuse a serial for a reused slot', () => {
    const sim = airport();
    const a = schedule(sim, 100);
    const b = schedule(sim, 200);
    expect(sim.traffic.serialOf(a)).toBe(1);
    expect(sim.traffic.serialOf(b)).toBe(2);
    expect(sim.traffic.serialOf(-1)).toBe(0);
    sim.traffic.fState[a] = FlState.Done;
    const c = schedule(sim, 300);
    expect(c).toBe(a);
    expect(sim.traffic.serialOf(c)).toBe(3);
  });

  it('finds live flights by serial and not finished ones', () => {
    const sim = airport();
    const a = schedule(sim, 100);
    const b = schedule(sim, 200);
    expect(sim.traffic.flightOfSerial(1)).toBe(a);
    expect(sim.traffic.flightOfSerial(2)).toBe(b);
    sim.traffic.fState[a] = FlState.Done;
    expect(sim.traffic.flightOfSerial(1)).toBe(-1);
    expect(sim.traffic.flightOfSerial(99)).toBe(-1);
  });

  it('keeps serials and the counter through a save and restore mid run', () => {
    const sim = airport();
    schedule(sim, 100);
    schedule(sim, 200);
    for (let t = 0; t < 300; t++) sim.step();
    const copy = roundTrip(sim);
    expect(Array.from(copy.traffic.fSerial)).toEqual(Array.from(sim.traffic.fSerial));
    expect(copy.traffic.nextSerial).toBe(sim.traffic.nextSerial);
    expect(copy.stateHash()).toBe(sim.stateHash());
  }, 120000);

  it('derives serials in slot order for a save without them', () => {
    const sim = airport();
    schedule(sim, 100);
    schedule(sim, 200);
    schedule(sim, 300);
    const copy = roundTrip(sim, (traffic) => {
      delete traffic.nextSerial;
      delete (traffic.arrays as Record<string, unknown>).fSerial;
    });
    expect(copy.traffic.serialOf(0)).toBe(1);
    expect(copy.traffic.serialOf(1)).toBe(2);
    expect(copy.traffic.serialOf(2)).toBe(3);
    expect(copy.traffic.nextSerial).toBe(4);
  });

  it('runs the same twice from one seed', () => {
    const hashes = [0, 1].map(() => {
      const sim = airport();
      for (let k = 0; k < 4; k++) schedule(sim, 100 + k * 200);
      for (let t = 0; t < 2000; t++) sim.step();
      return sim.stateHash();
    });
    expect(hashes[0]).toBe(hashes[1]);
  }, 120000);
});
