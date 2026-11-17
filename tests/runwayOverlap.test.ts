import { describe, expect, it } from 'vitest';
import { ownedSim, run } from './helpers';

/** User report of 2026-11-17: a stand far from every runway was refused as sitting on a runway shoulder. */
describe('stand placement far from a runway', () => {
  it('accepts a rotated stand far from an oblique runway', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 160, lengthM: 2500, code: 'C', approach: 'visual', surface: 'asphalt', tier: 1 });
    run(sim, { type: 'buildApron', polygon: [{ x: 3400, y: 4400 }, { x: 3800, y: 4400 }, { x: 3800, y: 4900 }, { x: 3400, y: 4900 }], surface: 'asphalt', tier: 1 });
    for (const [i, h] of [0, 81, 90, 170, 261].entries()) {
      expect(run(sim, { type: 'buildStands', x: 3450 + i * 80, y: 4500 + (i % 2) * 200, headingDeg: h, count: 1, spacingM: 45, standType: 'contact', size: 'medium' }), `heading ${h}`).toEqual([]);
    }
  });

  it('still refuses a stand on the runway', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 160, lengthM: 2500, code: 'C', approach: 'visual', surface: 'asphalt', tier: 1 });
    expect(run(sim, { type: 'buildStands', x: 3200, y: 5600, headingDeg: 81, count: 1, spacingM: 45, standType: 'remote', size: 'medium' })).toEqual(['onRunway']);
  });
});
