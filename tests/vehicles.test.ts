import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { GROUND, GSE, GSE_INDEX } from '@data/index';
import { AcState } from '@sim/ops/traffic';
import { Sim } from '@sim/sim';
import { buildTestAirport, ownedSim, OPTIONS, run } from './helpers';
import { depotExit } from '@shared/roadGraph';
import { WORK_STATE } from '@sim/vehicles/gse';

/** Carts hanging behind a cart. */
function chainBehind(sim: Sim, v: number): number {
  let n = 0;
  for (let c = sim.gse.tail[v]; c >= 0; c = sim.gse.tail[c]) n++;
  return n;
}

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
    // Let the last vehicles drive home to the depot.
    for (let t = 0; t < 8000 && sim.gse.count > 0; t++) sim.step();
    expect(sim.gse.count).toBe(0);
    expect(GSE.length).toBeGreaterThan(5);
  });

  it('with a depot and a road the crew leaves the depot exit and tows its carts (T60)', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 4 });
    const exit = depotExit(sim.airfield.data.depots![0]);
    expect(sim.roads.standRoad.every((r) => r === 1)).toBe(true);
    run(sim, { type: 'testArrival', typeIdx: idx('a320neo'), inTicks: 0, turnTicks: 3000 });
    let fromDepot = false;
    let carts = 0;
    let docked = false;
    for (let t = 0; t < 30000 && sim.traffic.completedFlights === 0; t++) {
      sim.step();
      for (let v = 0; v < 1024; v++) {
        if (sim.gse.active[v] !== 1) continue;
        if (Math.hypot(sim.gse.x[v] - exit.x, sim.gse.y[v] - exit.y) < 6) fromDepot = true;
        if (sim.gse.kind[v] === GSE_INDEX.cart && sim.gse.lead[v] >= 0) carts = Math.max(carts, 1 + chainBehind(sim, v));
        if (sim.gse.state[v] === WORK_STATE) docked = true;
      }
    }
    expect(fromDepot).toBe(true);
    expect(docked).toBe(true);
    // A medium stand gets a train of its size (user, 2026-11-18).
    expect(carts).toBe(GROUND.cartsPerTrain.medium);
  });

  it('without a depot the crew appears at the stand, and the turnaround pays the no road penalty', () => {
    const turnOf = (ground: boolean): number => {
      const sim = ownedSim();
      buildTestAirport(sim, { standsPerRow: 4, ground });
      run(sim, { type: 'testArrival', typeIdx: idx('a320neo'), inTicks: 0, turnTicks: 3000 });
      for (let t = 0; t < 30000; t++) {
        sim.step();
        for (let a = 0; a < 256; a++) if (sim.traffic.state[a] === AcState.Turnaround) return sim.traffic.timer[a];
      }
      return -1;
    };
    const roads = turnOf(true);
    const bare = turnOf(false);
    expect(roads).toBeGreaterThan(0);
    // The bare airport has no vehicles either, so the short fleet slows it on top of the road penalty.
    expect(bare).toBeGreaterThanOrEqual(Math.round(roads * GROUND.noRoadTurnaroundFactor) - 1);
  });

  it('runs the same road traffic twice from one seed', () => {
    const hashes = (): number[] => {
      const sim = ownedSim();
      buildTestAirport(sim, { standsPerRow: 4 });
      run(sim, { type: 'setTestTraffic', perHour: 20, turnScale: 1 });
      const out: number[] = [];
      for (let t = 0; t < 2000; t++) {
        sim.step();
        if (t % 250 === 0) out.push(sim.stateHash(), sim.gse.count, Math.round(sim.gse.x[0] * 100));
      }
      return out;
    };
    expect(hashes()).toEqual(hashes());
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
