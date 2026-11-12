import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { FlState } from '@sim/ops/traffic';
import { AcState } from '@sim/ops/traffic';
import { WORK_STATE } from '@sim/vehicles/gse';
import type { Command } from '@sim/commands';
import type { Sim } from '@sim/sim';
import { ownedSim, run } from './helpers';

const idx = (id: string): number => AIRCRAFT.findIndex((a) => a.id === id);

/** Code E runway, parallel taxiway, one apron connected to it, and one stand per size: small, medium, large. */
function buildSceneAirport(sim: Sim): void {
  const errors: string[] = [];
  const go = (...cmds: Command[]): void => {
    errors.push(...run(sim, ...cmds));
  };
  go(
    { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 3300, code: 'E', approach: 'precision', surface: 'asphalt', tier: 2 },
    { type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 200, code: 'E', connectors: 4, surface: 'asphalt', tier: 2 },
    { type: 'buildApron', polygon: [{ x: 3400, y: 5205 }, { x: 4900, y: 5205 }, { x: 4900, y: 5460 }, { x: 3400, y: 5460 }], surface: 'concrete', tier: 2 },
    { type: 'buildStands', x: 3600, y: 5340, headingDeg: 180, count: 1, spacingM: 30, standType: 'remote', size: 'small' },
    { type: 'buildStands', x: 3900, y: 5340, headingDeg: 180, count: 1, spacingM: 45, standType: 'remote', size: 'medium' },
    { type: 'buildStands', x: 4350, y: 5340, headingDeg: 180, count: 1, spacingM: 80, standType: 'remote', size: 'large' },
  );
  if (errors.length > 0) throw new Error(`scene airport failed: ${errors.join(', ')}`);
}

/** Runs ticks until the flight's aircraft is in its turnaround with a vehicle docked, or the limit. Returns the ticks used, or -1. */
function runUntilDocked(sim: Sim, flight: number, limit: number): number {
  for (let t = 0; t < limit; t++) {
    sim.step();
    const ac = sim.traffic.fAc[flight];
    if (ac < 0 || sim.traffic.state[ac] !== AcState.Turnaround) continue;
    let docked = 0;
    for (let v = 0; v < sim.gse.active.length; v++) if (sim.gse.active[v] === 1 && sim.gse.state[v] === WORK_STATE) docked++;
    if (docked > 0) return t + 1;
  }
  return -1;
}

/** The flight that took this stand. */
function flightAt(sim: Sim, standId: number): number {
  for (let f = 0; f < sim.traffic.fStand.length; f++) {
    if (sim.traffic.fStand[f] === standId && sim.traffic.fState[f] !== FlState.Done && sim.traffic.fState[f] !== FlState.Free) return f;
  }
  return -1;
}

describe('testDockAt', () => {
  it('docks the given type on the given stand within 6000 ticks', () => {
    const sim = ownedSim();
    buildSceneAirport(sim);
    const stand = sim.airfield.data.stands.find((s) => s.size === 'large');
    expect(stand).toBeDefined();
    const id = stand?.id ?? -1;
    run(sim, { type: 'testDockAt', standId: id, typeIdx: idx('b787_9'), turnTicks: 1200 });
    const f = flightAt(sim, id);
    expect(f).toBeGreaterThanOrEqual(0);
    const used = runUntilDocked(sim, f, 6000);
    expect(used).toBeGreaterThan(0);
    expect(sim.traffic.fStand[f]).toBe(id);
  });

  it('refuses a type that does not fit the stand and names the refusal', () => {
    const sim = ownedSim();
    buildSceneAirport(sim);
    const small = sim.airfield.data.stands.find((s) => s.size === 'small');
    const id = small?.id ?? -1;
    const events = run(sim, { type: 'testDockAt', standId: id, typeIdx: idx('b787_9'), turnTicks: 1200 });
    expect(events).toContain('standSpan');
    expect(sim.traffic.count).toBe(0);
    expect(flightAt(sim, id)).toBe(-1);
  });

  it('refuses an unknown stand id', () => {
    const sim = ownedSim();
    buildSceneAirport(sim);
    const events = run(sim, { type: 'testDockAt', standId: -999, typeIdx: idx('a320neo'), turnTicks: 1200 });
    expect(events).toContain('standNoLink');
    expect(sim.traffic.count).toBe(0);
  });

  it('gives identical hashes on two runs from one seed', () => {
    const play = (): number => {
      const sim = ownedSim();
      buildSceneAirport(sim);
      const id = sim.airfield.data.stands.find((s) => s.size === 'medium')?.id ?? -1;
      run(sim, { type: 'testDockAt', standId: id, typeIdx: idx('a320neo'), turnTicks: 1200 });
      for (let t = 0; t < 2000; t++) sim.step();
      return sim.stateHash();
    };
    expect(play()).toBe(play());
  });
});
