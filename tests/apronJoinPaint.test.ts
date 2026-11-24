import { describe, expect, it } from 'vitest';
import { AIRFIELD, PAINT } from '@data/index';
import { buildPlan } from '@render/markings/taxiPlan';
import { ownedSim, run } from './helpers';

const TAXI_Y = 5000;
const HW = AIRFIELD.codes.C.taxiwayWidthM / 2;
const SHOULDER = AIRFIELD.codes.C.taxiwayShoulderM;

/** A code C taxiway along y 5000 and an apron south of it whose north edge is `gap` meters past the shoulder. */
function plan(gap: number): ReturnType<typeof buildPlan> {
  const sim = ownedSim();
  expect(run(sim, { type: 'buildTaxiway', points: [{ x: 3800, y: TAXI_Y }, { x: 4400, y: TAXI_Y }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 2 })).toEqual([]);
  const top = TAXI_Y + HW + SHOULDER + gap;
  expect(run(sim, { type: 'buildApron', polygon: [{ x: 4000, y: top }, { x: 4200, y: top }, { x: 4200, y: top + 150 }, { x: 4000, y: top + 150 }], surface: 'concrete', tier: 2 })).toEqual([]);
  return buildPlan(sim.airfield.data);
}

describe('apron beside a taxiway (T84)', () => {
  it('dashes the edge line and paves the shoulder where the apron is within reach', () => {
    const p = plan(PAINT.taxiway.apronTouchM - 1);
    expect(p.apronEdges.length).toBeGreaterThan(0);
    for (const l of p.apronEdges) {
      // Only on the apron side, and only along the apron.
      expect(l.minY).toBeGreaterThan(TAXI_Y);
      expect(l.minX).toBeGreaterThan(4000 - 2);
      expect(l.maxX).toBeLessThan(4200 + 2);
    }
    expect(p.apronJoins).toHaveLength(p.apronEdges.length);
    // The north edge stays a solid line.
    expect(p.edges.some((l) => l.maxY < TAXI_Y)).toBe(true);
  });

  it('keeps solid edge lines when the apron is farther away', () => {
    const p = plan(PAINT.taxiway.apronTouchM + 2);
    expect(p.apronEdges).toHaveLength(0);
    expect(p.apronJoins).toHaveLength(0);
  });
});
