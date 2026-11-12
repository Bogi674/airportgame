import { describe, expect, it } from 'vitest';
import { Sim } from '@sim/sim';
import { AcState, FlState, GA_AIRLINE } from '@sim/ops/traffic';
import { buildTestAirport, OPTIONS, ownedSim, run } from './helpers';

/** Game ticks in two game hours at 0.1 s per tick. */
const TWO_HOURS = 72000;

/** Flights ever scheduled for general aviation that still hold a slot. */
function gaFlights(sim: Sim): number {
  let n = 0;
  for (let f = 0; f < sim.traffic.fState.length; f++) {
    if (sim.traffic.fAirline[f] === GA_AIRLINE && sim.traffic.fState[f] !== FlState.Free) n++;
  }
  return n;
}

/** Steps until a GA flight is scheduled or the limit runs out. Returns the ticks taken. */
function stepUntilGaSpawn(sim: Sim, limit: number): number {
  let ticks = 0;
  while (ticks < limit && gaFlights(sim) === 0) {
    sim.step();
    ticks++;
  }
  return ticks;
}

function gaAirport(seed?: string, standCode: 'A' | 'C' = 'A'): Sim {
  const sim = ownedSim(seed);
  buildTestAirport(sim, { standCode, standType: 'remote' });
  return sim;
}

describe('general aviation arrivals', () => {
  it('a GA flight docks and later departs within two game hours of daytime', () => {
    const sim = gaAirport();
    const docked = new Set<number>();
    const departed = new Set<number>();
    let ticks = 0;
    while (ticks < TWO_HOURS && departed.size === 0) {
      sim.step();
      ticks++;
      for (let f = 0; f < sim.traffic.fState.length; f++) {
        if (sim.traffic.fAirline[f] !== GA_AIRLINE) continue;
        if (sim.traffic.fState[f] === FlState.OnGround) docked.add(f);
        if (sim.traffic.fState[f] === FlState.Done && docked.has(f)) departed.add(f);
      }
    }
    expect(docked.size).toBeGreaterThan(0);
    expect(departed.size).toBeGreaterThan(0);
  });

  it('spawns nothing without a runway', () => {
    const sim = ownedSim();
    for (let t = 0; t < 10000; t++) sim.step();
    expect(gaFlights(sim)).toBe(0);
  });

  it('spawns nothing when every stand is commercial usage', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standCode: 'A', standType: 'remote' });
    for (const s of sim.airfield.data.stands) run(sim, { type: 'setStandProps', id: s.id, usage: 'commercial' });
    for (let t = 0; t < 10000; t++) sim.step();
    expect(gaFlights(sim)).toBe(0);
  });

  it('spawns nothing when the only stands are code C with default usage', () => {
    const sim = gaAirport(undefined, 'C');
    for (let t = 0; t < 10000; t++) sim.step();
    expect(gaFlights(sim)).toBe(0);
  });

  it('takes a code C stand set to GA usage', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standCode: 'C', standType: 'remote' });
    for (const s of sim.airfield.data.stands) run(sim, { type: 'setStandProps', id: s.id, usage: 'ga' });
    const ticks = stepUntilGaSpawn(sim, 10000);
    expect(ticks).toBeLessThan(10000);
    expect(gaFlights(sim)).toBeGreaterThan(0);
  });

  it('a GA flight takes only GA eligible stands, also after a stand command', () => {
    const sim = ownedSim('GOLDEN-0004');
    buildTestAirport(sim, { standCode: 'C', standType: 'remote' });
    const ids = sim.airfield.data.stands.map((s) => s.id);
    // Code C stands are barred for GA unless set to GA usage. The first four stay barred and the lowest index.
    const gaIds = new Set(ids.slice(4));
    for (const id of gaIds) run(sim, { type: 'setStandProps', id, usage: 'ga' });
    stepUntilGaSpawn(sim, 10000);
    // The stand command makes the automatic assigner run on the flight that is still waiting for a stand.
    run(sim, { type: 'setStandProps', id: ids[7], usage: 'ga' });
    const used = new Set<number>();
    let ticks = 0;
    // A flight that holds a barred stand stays scheduled until it diverts, far past this window.
    while (ticks < 6000 && used.size === 0) {
      sim.step();
      ticks++;
      for (let k = 0; k < sim.traffic.active.length; k++) {
        if (sim.traffic.active[k] !== 1) continue;
        const f = sim.traffic.flight[k];
        if (f >= 0 && sim.traffic.fAirline[f] === GA_AIRLINE && sim.traffic.state[k] === AcState.Turnaround) used.add(sim.traffic.standId[k]);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const id of used) expect(gaIds.has(id)).toBe(true);
  });

  it('two sims from one seed agree 2000 ticks after the first GA spawn', () => {
    const a = gaAirport('GOLDEN-0002');
    const b = gaAirport('GOLDEN-0002');
    const spawnA = stepUntilGaSpawn(a, 10000);
    const spawnB = stepUntilGaSpawn(b, 10000);
    expect(spawnA).toBe(spawnB);
    expect(gaFlights(a)).toBeGreaterThan(0);
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('a save taken mid run restores to the same hash as an uninterrupted run', () => {
    const a = gaAirport('GOLDEN-0003');
    stepUntilGaSpawn(a, 10000);
    for (let t = 0; t < 1000; t++) a.step();
    expect(gaFlights(a)).toBeGreaterThan(0);
    const data = JSON.parse(JSON.stringify(a.serialize())) as unknown;
    const b = new Sim('GOLDEN-0003', OPTIONS);
    b.restore(data);
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });
});
