import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { GSE, GSE_INDEX } from '@data/index';
import { AcState } from '@sim/ops/traffic';
import { Sim } from '@sim/sim';
import { buildTestAirport, ownedSim, OPTIONS, run } from './helpers';

const idx = (id: string): number => AIRCRAFT.findIndex((a) => a.id === id);

describe('ground vehicles', () => {
  it('a crew drives to the aircraft during the turnaround and leaves after it', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 4 });
    run(sim, { type: 'testArrival', typeIdx: idx('a320neo'), inTicks: 0, turnTicks: 3000 });
    let peak = 0;
    let atAircraft = false;
    let tugSeen = false;
    for (let t = 0; t < 30000 && sim.traffic.completedFlights === 0; t++) {
      sim.step();
      peak = Math.max(peak, sim.gse.count);
      for (let a = 0; a < 256; a++) {
        if (sim.traffic.state[a] !== AcState.Turnaround) continue;
        for (let v = 0; v < 1024; v++) {
          if (sim.gse.active[v] === 1 && sim.gse.owner[v] === a && sim.gse.kind[v] === GSE_INDEX.beltloader && Math.hypot(sim.gse.x[v] - sim.traffic.x[a], sim.gse.y[v] - sim.traffic.y[a]) < 25) atAircraft = true;
        }
      }
      for (let v = 0; v < 1024; v++) if (sim.gse.active[v] === 1 && sim.gse.kind[v] === GSE_INDEX.tug) tugSeen = true;
    }
    expect(sim.traffic.completedFlights).toBe(1);
    expect(peak).toBeGreaterThanOrEqual(5);
    expect(atAircraft).toBe(true);
    expect(tugSeen).toBe(true);
    // Let the last vehicles drive off.
    for (let t = 0; t < 1200; t++) sim.step();
    expect(sim.gse.count).toBe(0);
    expect(GSE.length).toBeGreaterThan(5);
  });

  it('a save while the crew drives in restores to the same hash as an uninterrupted run', () => {
    const prepared = (): Sim => {
      const sim = ownedSim();
      buildTestAirport(sim, { standsPerRow: 4 });
      run(sim, { type: 'testArrival', typeIdx: idx('a320neo'), inTicks: 0, turnTicks: 3000 });
      return sim;
    };
    const a = prepared();
    const b = prepared();
    // Step until the first crew vehicle is driving in, so the save lands mid approach.
    let ticks = 0;
    while (ticks < 30000 && b.gse.count === 0) {
      b.step();
      ticks++;
    }
    expect(b.gse.count).toBeGreaterThan(0);
    for (let t = 0; t < ticks; t++) a.step();
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(JSON.parse(JSON.stringify(b.serialize())));
    expect(c.stateHash()).toBe(b.stateHash());
    for (let t = 0; t < 2000; t++) {
      a.step();
      c.step();
    }
    expect(c.stateHash()).toBe(a.stateHash());
  });
});
