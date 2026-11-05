import { describe, expect, it } from 'vitest';
import { STAND_SIZES } from '@data/index';
import { padCurve, padPolygon } from '@shared/turnPad';
import { pointInPolygon } from '@shared/geom';
import type { Sim } from '@sim/sim';
import { AcState } from '@sim/ops/traffic';
import { ownedSim, run } from './helpers';

/**
 * Runway 09/27 of `len` meters with one connector in the middle, a parallel taxiway and a stand row,
 * so a departure from the connector has only half the runway ahead of it.
 */
function midConnectorAirport(sim: Sim, len: number): void {
  const x0 = 3000;
  const mid = x0 + len / 2;
  const errors: string[] = [];
  const go = (c: Parameters<typeof run>[1]): void => {
    errors.push(...run(sim, c));
  };
  go({ type: 'buildRunway', x: x0, y: 5000, headingDeg: 90, lengthM: len, code: 'C', approach: 'precision', surface: 'asphalt', tier: 2 });
  go({ type: 'buildTaxiway', points: [{ x: mid - 600, y: 5190 }, { x: mid + 600, y: 5190 }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 2 });
  go({ type: 'buildTaxiway', points: [{ x: mid, y: 5000 }, { x: mid, y: 5190 }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 2 });
  go({ type: 'buildApron', polygon: [{ x: mid - 500, y: 5260 }, { x: mid + 500, y: 5260 }, { x: mid + 500, y: 5400 }, { x: mid - 500, y: 5400 }], surface: 'concrete', tier: 2 });
  go({ type: 'buildStands', x: mid + 400, y: 5330, headingDeg: 180, count: 6, spacingM: STAND_SIZES.medium.widthM, standType: 'remote', size: 'medium' });
  if (errors.length > 0) throw new Error(errors.join(', '));
}

describe('turn pads', () => {
  it('the pad lies beside the runway end and the curve stays on runway and pad pavement', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2000, code: 'C', approach: 'visual', surface: 'asphalt', tier: 2 });
    const r = sim.airfield.data.runways[0];
    const pad = padPolygon(r, 'a', 'left');
    // Left of a heading of 090 is north, smaller y.
    expect(Math.min(...pad.map((p) => p.y))).toBeLessThan(5000 - r.widthM / 2);
    expect(Math.max(...pad.map((p) => p.x))).toBeLessThan(3200);
    const runway = [{ x: 3000, y: 5000 - r.widthM / 2 - 0.01 }, { x: 5000, y: 5000 - r.widthM / 2 - 0.01 }, { x: 5000, y: 5000 + r.widthM / 2 + 0.01 }, { x: 3000, y: 5000 + r.widthM / 2 + 0.01 }];
    for (const p of padCurve(r, 'a', 'left')) expect(pointInPolygon(p.x, p.y, pad) || pointInPolygon(p.x, p.y, runway)).toBe(true);
  });

  it('building a pad costs money, closes the runway for a while and can be removed', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2000, code: 'C', approach: 'visual', surface: 'asphalt', tier: 2 });
    const cash = sim.cash;
    expect(run(sim, { type: 'turnPad', runwayId: 1, end: 'a', side: 'left' })).toEqual([]);
    expect(sim.cash).toBeLessThan(cash);
    const r = sim.airfield.data.runways[0];
    expect(r.pads).toEqual({ a: 'left' });
    expect(r.works).toBeDefined();
    expect(run(sim, { type: 'turnPad', runwayId: 1, end: 'a', side: 'left' })).toEqual(['padExists']);
    expect(run(sim, { type: 'turnPad', runwayId: 1, end: 'a', side: null })).toEqual([]);
    expect(sim.airfield.data.runways[0].pads).toBeUndefined();
  });

  it('a departure that needs the full length backtracks to the pad, turns and takes off', () => {
    const plain = ownedSim();
    midConnectorAirport(plain, 1900);
    const padded = ownedSim();
    midConnectorAirport(padded, 1900);
    for (const end of ['a', 'b'] as const) run(padded, { type: 'turnPad', runwayId: 1, end, side: 'left' });
    // Let the pad works finish before traffic starts.
    const done = padded.airfield.data.runways[0].works?.doneTick ?? 0;
    padded.airfield.update(done);
    for (const s of [plain, padded]) run(s, { type: 'setTestTraffic', perHour: 20, turnScale: 0.2 });
    let sawBacktrack = false;
    for (let k = 0; k < 40000; k++) {
      plain.step();
      padded.step();
      if (!sawBacktrack) for (let i = 0; i < padded.traffic.state.length; i++) if (padded.traffic.state[i] === AcState.Backtrack) sawBacktrack = true;
    }
    expect(sawBacktrack).toBe(true);
    expect(padded.traffic.completedFlights).toBeGreaterThan(plain.traffic.completedFlights);
  });
});
