import { describe, expect, it } from 'vitest';
import { Sim } from '@sim/sim';
import { migrate, SAVE_VERSION } from '@sim/save/migrations';
import { buildTestAirport, ownedSim, run, OPTIONS } from './helpers';

function prepared(): Sim {
  const sim = ownedSim();
  sim.cash = 80_000_000;
  buildTestAirport(sim, { standsPerRow: 6 });
  run(sim, { type: 'buildTerminal', cx: 4000, cy: 5480, w: 120, d: 40, headingDeg: 90 });
  const id = sim.business.terminals[0].id;
  run(sim, { type: 'addModule', terminalId: id, kind: 'checkIn', count: 8 });
  run(sim, { type: 'addModule', terminalId: id, kind: 'security', count: 3 });
  run(sim, { type: 'addModule', terminalId: id, kind: 'belt', count: 2 });
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
    for (let t = 0; t < 5000; t++) c.step();
    expect(c.stateHash()).toBe(a.stateHash());
    expect(c.traffic.completedFlights).toBe(a.traffic.completedFlights);
  }, 120000);

  it('refuses saves of another seed, newer versions and non saves', () => {
    const b = prepared();
    const data = JSON.parse(JSON.stringify(b.serialize()));
    expect(() => new Sim('OTHER', OPTIONS).restore(data)).toThrow(/different seed/);
    expect(() => migrate({ ...data, version: SAVE_VERSION + 1 })).toThrow(/newer version/);
    expect(() => migrate({ hello: 1 })).toThrow(/not an Airfield Tycoon save/);
  });
});
