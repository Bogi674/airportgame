import { describe, expect, it } from 'vitest';
import { AIRFIELD } from '@data/index';
import { runwaySide } from '@shared/airfield';
import { buildTestAirport, ownedSim, run } from './helpers';

/** The connector holds of runway 1 on the side of the parallel taxiway. */
const holds = (sim: ReturnType<typeof ownedSim>) => sim.airfield.data.holding.filter((h) => h.runwayId === 1);

describe('holding points', () => {
  it('sit at the default distance and record their side and minimum', () => {
    const sim = ownedSim();
    buildTestAirport(sim);
    const min = AIRFIELD.holdingDistanceM.precision;
    const hs = holds(sim);
    expect(hs.length).toBeGreaterThan(0);
    for (const h of hs) {
      expect(h.minM).toBe(min);
      expect(Math.abs(h.distM - min)).toBeLessThanOrEqual(2);
      const r = sim.airfield.data.runways[0];
      expect(h.side).toBe(runwaySide(r, h.x, h.y));
    }
  });

  it('move further out but never closer, with undo and redo', () => {
    const sim = ownedSim();
    buildTestAirport(sim);
    const h = holds(sim)[0];
    const min = h.minM;
    expect(run(sim, { type: 'moveHolding', runwayId: 1, taxiwayId: h.taxiwayId, side: h.side, distM: min - 10 })).toEqual(['holdTooClose|min=' + min]);
    expect(run(sim, { type: 'moveHolding', runwayId: 1, taxiwayId: h.taxiwayId, side: h.side, distM: min + 40 })).toEqual([]);
    const moved = holds(sim).find((x) => x.taxiwayId === h.taxiwayId && x.side === h.side);
    expect(moved?.distM).toBeGreaterThanOrEqual(min + 38);
    expect(sim.airfield.data.taxiways.find((t) => t.id === h.taxiwayId)?.holds).toEqual([{ runwayId: 1, side: h.side, distM: min + 40 }]);
    run(sim, { type: 'undo' });
    expect(holds(sim).find((x) => x.taxiwayId === h.taxiwayId && x.side === h.side)?.distM).toBeLessThanOrEqual(min + 2);
    run(sim, { type: 'redo' });
    expect(holds(sim).find((x) => x.taxiwayId === h.taxiwayId && x.side === h.side)?.distM).toBeGreaterThanOrEqual(min + 38);
  });

  it('refuses a distance the taxiway does not reach', () => {
    const sim = ownedSim();
    buildTestAirport(sim);
    const h = holds(sim)[0];
    // The connectors end on the parallel taxiway 190 m out, so 300 m is off the connector.
    expect(run(sim, { type: 'moveHolding', runwayId: 1, taxiwayId: h.taxiwayId, side: h.side, distM: 300 })).toEqual(['holdBeyondTaxiway']);
    expect(sim.airfield.data.taxiways.find((t) => t.id === h.taxiwayId)?.holds).toBeUndefined();
  });

  it('aircraft still flow with a moved holding point', () => {
    const sim = ownedSim();
    buildTestAirport(sim);
    for (const h of holds(sim)) run(sim, { type: 'moveHolding', runwayId: 1, taxiwayId: h.taxiwayId, side: h.side, distM: h.minM + 30 });
    run(sim, { type: 'setTestTraffic', perHour: 20, turnScale: 0.3 });
    for (let i = 0; i < 30000; i++) sim.step();
    expect(sim.traffic.completedFlights).toBeGreaterThan(0);
  });
});
