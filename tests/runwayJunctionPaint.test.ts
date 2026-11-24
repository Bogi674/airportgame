import { describe, expect, it } from 'vitest';
import { buildPlan } from '@render/markings/taxiPlan';
import { ownedSim, run } from './helpers';

/** A runway on y 5000 and one taxiway from the north ending at `endY`. */
function plan(endY: number): ReturnType<typeof buildPlan> {
  const sim = ownedSim();
  expect(run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2000, code: 'C', approach: 'visual', surface: 'asphalt', tier: 2 })).toEqual([]);
  expect(run(sim, { type: 'buildTaxiway', points: [{ x: 4000, y: 4700 }, { x: 4000, y: endY }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 2 })).toEqual([]);
  return buildPlan(sim.airfield.data);
}

/** Lead in centerlines that reach the runway centerline (y 5000) on either side of the taxiway. */
function leadIns(p: ReturnType<typeof buildPlan>): number {
  return p.centerlines.filter((l) => {
    const last = l.pts[l.pts.length - 1];
    return Math.abs(last.y - 5000) < 0.5 && Math.abs(last.x - 4000) > 5;
  }).length;
}

describe('runway junction paint (T84)', () => {
  it('gives a taxiway drawn onto the runway centerline the same lead ins as one ending at the edge', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2000, code: 'C', approach: 'visual', surface: 'asphalt', tier: 2 });
    const r = sim.airfield.data.runways[0];
    const edge = r.widthM / 2 + r.shoulderM;
    expect(leadIns(plan(5000))).toBe(2);
    expect(leadIns(plan(5000 - edge))).toBe(2);
  });

  it('paves the shoulder between the taxiway and the runway edge stripe', () => {
    const p = plan(5000);
    // The throat patch: four corners, two on the full strength edge of the runway and two beyond its shoulder.
    const throats = p.patches.filter((q) => q.length === 4);
    expect(throats).toHaveLength(1);
    const ys = throats[0].map((q) => q.y).sort((a, b) => a - b);
    expect(ys[0]).toBeLessThan(ys[3]);
  });
});
