import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { GSE_INDEX } from '@data/index';
import { STAND_UPGRADE } from '@shared/airfield';
import { VEHICLE_CAUSE } from '@shared/turnaround';
import { AcState } from '@sim/ops/traffic';
import type { Sim } from '@sim/sim';
import { buildTestAirport, ownedSim, run } from './helpers';

/** Stand upgrade effects on turnaround tasks and vehicles (T66 slice 2). */

const A320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');

/** A test airport whose stands all carry the upgrade bits, with an airline flight arriving. Returns the sim and flight. */
function setup(upgrades: number, flights = 1): { sim: Sim; f: number } {
  const sim = ownedSim();
  sim.cash = 80_000_000;
  buildTestAirport(sim, { standsPerRow: 4 });
  for (const s of sim.airfield.data.stands) if (upgrades !== 0) s.upgrades = upgrades;
  let f = -1;
  for (let n = 0; n < flights; n++) f = sim.traffic.scheduleArrival(A320, sim.tick + 1 + n * 600, 0, sim.traffic.turnaroundTicks(A320), 0);
  return { sim, f };
}

/** Steps until the flight leaves its turnaround. Records which kinds ever docked at any aircraft and the tick it finished. */
function runFlight(sim: Sim, f: number, limit = 60000): { dockedKinds: number; endTick: number } {
  let dockedKinds = 0;
  let seen = false;
  for (let t = 0; t < limit; t++) {
    sim.step();
    for (let i = 0; i < sim.gse.dockedMask.length; i++) dockedKinds |= sim.gse.dockedMask[i];
    const a = sim.traffic.fAc[f];
    if (a >= 0 && sim.traffic.state[a] === AcState.Turnaround) seen = true;
    if (seen && (a < 0 || sim.traffic.state[a] !== AcState.Turnaround)) return { dockedKinds, endTick: sim.tick };
  }
  return { dockedKinds, endTick: -1 };
}

describe('stand upgrade effects on turnarounds', () => {
  it('a hydrant pit fuels with a dispenser and no refueller ever docks', () => {
    const { sim, f } = setup(STAND_UPGRADE.hydrantPit);
    run(sim, { type: 'buyGse', kind: 'dispenser', count: 1 });
    const r = runFlight(sim, f);
    expect(r.endTick).toBeGreaterThan(0);
    expect(r.dockedKinds & (1 << GSE_INDEX.dispenser)).not.toBe(0);
    expect(r.dockedKinds & (1 << GSE_INDEX.refueller)).toBe(0);
  });

  it('without a dispenser the fuel task waits with the dispenser vehicle cause', () => {
    const { sim, f } = setup(STAND_UPGRADE.hydrantPit);
    sim.business.fleet[GSE_INDEX.dispenser] = 0;
    let a = -1;
    for (let t = 0; t < 40000 && a < 0; t++) {
      sim.step();
      const x = sim.traffic.fAc[f];
      if (x >= 0 && sim.traffic.state[x] === AcState.Turnaround) a = x;
    }
    expect(a).toBeGreaterThanOrEqual(0);
    const plan = sim.traffic.timer[a];
    for (let t = 0; t < plan + 3000; t++) sim.step();
    expect(sim.traffic.state[a]).toBe(AcState.Turnaround);
    expect(sim.traffic.fCause[f]).toBe(VEHICLE_CAUSE + GSE_INDEX.dispenser);
    expect(sim.gse.dockedMask[a] & (1 << GSE_INDEX.refueller)).toBe(0);
  });

  it('fixed ground power finishes the power task with no GPU docked and none owned', () => {
    const { sim, f } = setup(STAND_UPGRADE.fixedPower);
    sim.business.fleet[GSE_INDEX.gpu] = 0;
    const r = runFlight(sim, f);
    expect(r.endTick).toBeGreaterThan(0);
    expect(r.dockedKinds & (1 << GSE_INDEX.gpu)).toBe(0);
  });

  it('a stand with an upgrade that touches neither fuel nor power turns exactly as a plain stand', () => {
    const plain = setup(0);
    const bay = setup(STAND_UPGRADE.busBay);
    const a = runFlight(plain.sim, plain.f);
    const b = runFlight(bay.sim, bay.f);
    expect(a.endTick).toBeGreaterThan(0);
    expect(b.endTick).toBe(a.endTick);
    expect(b.dockedKinds).toBe(a.dockedKinds);
  });

  it('runs deterministically on a busy stand with both upgrades', () => {
    const go = (): string => {
      const { sim } = setup(STAND_UPGRADE.hydrantPit | STAND_UPGRADE.fixedPower, 4);
      run(sim, { type: 'buyGse', kind: 'dispenser', count: 2 });
      for (let t = 0; t < 2000; t++) sim.step();
      return String(sim.stateHash());
    };
    expect(go()).toBe(go());
  });
});
