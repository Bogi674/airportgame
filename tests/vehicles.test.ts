import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { GSE, GSE_INDEX } from '@data/index';
import { AcState } from '@sim/ops/traffic';
import { buildTestAirport, ownedSim, run } from './helpers';

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
});
