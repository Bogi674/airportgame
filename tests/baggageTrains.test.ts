import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { GSE_INDEX } from '@data/index';
import { bookBagFlights, buildBaggageTerminal, buildTestAirport, ownedSim, run } from './helpers';

const A320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');

describe('baggage trains on a far bay (T78)', () => {
  it('a crew train that docks after the belt loader finished the unload still takes the arriving bags, and the flight loads all its bags', () => {
    const sim = ownedSim('STRESS-BAGGAGE');
    buildTestAirport(sim, { standsPerRow: 20 });
    expect(buildBaggageTerminal(sim)).toEqual([]);
    run(sim, { type: 'signAirline', airlineId: 0, sign: true }, { type: 'buildTower', x: 2700, y: 4800, level: 5 });
    const serials = new Int32Array(sim.airfield.data.stands.length);
    expect(bookBagFlights(sim, A320, 20, serials)).toBe(20 * serials.length);
    const serial = serials[3];
    let unloadedFirst = false;
    for (let t = 0; t < 40000 && sim.traffic.flightOfSerial(serial) >= 0; t++) {
      sim.step();
      const f = sim.traffic.flightOfSerial(serial);
      const a = f >= 0 ? sim.traffic.fAc[f] : -1;
      // The unload is done while no train is docked: the case this test guards.
      if (a >= 0 && sim.turns.unloadDone(a) && (sim.gse.dockedMask[a] & (1 << GSE_INDEX.tractor)) === 0) unloadedFirst = true;
    }
    expect(sim.traffic.flightOfSerial(serial)).toBe(-1);
    expect(unloadedFirst).toBe(true);
    expect(sim.baggage.missingFor(serial)).toBe(0);
    expect(sim.baggage.loadedTotal).toBeGreaterThanOrEqual(20);
  });
});
