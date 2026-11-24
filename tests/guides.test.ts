import { describe, expect, it } from 'vitest';
import { alignGuide } from '@shared/airfieldGeom';
import type { AirfieldPayload } from '@shared/airfield';
import { ownedSim, run } from './helpers';

/** An east west taxiway at y 5000 and a square apron from (4000, 5100) to (4200, 5300). */
function field(): AirfieldPayload {
  const sim = ownedSim();
  expect(run(sim, { type: 'buildTaxiway', points: [{ x: 3800, y: 5000 }, { x: 4400, y: 5000 }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 0 })).toEqual([]);
  expect(run(sim, { type: 'buildApron', polygon: [{ x: 4000, y: 5100 }, { x: 4200, y: 5100 }, { x: 4200, y: 5300 }, { x: 4000, y: 5300 }], surface: 'concrete', tier: 0 })).toEqual([]);
  return sim.airfield.data;
}

describe('alignment guides (T84)', () => {
  it('follows the line of an apron edge and names it', () => {
    const af = field();
    // 60 m past the apron's east edge line, 3 m off it, far from any taxiway vertex line.
    const g = alignGuide(af, [], 4203, 5360, 9);
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.p.x).toBeCloseTo(4200, 6);
    expect(g.lines).toHaveLength(1);
    expect(g.lines[0].kind).toBe('apron');
    expect(g.lines[0].square).toBe(false);
  });

  it('snaps to where two guides cross, so a point follows both at once', () => {
    const af = field();
    // The north line through a gesture point at (4100, 5600) crosses the line of the apron's south edge at (4100, 5300).
    const d = alignGuide(af, [{ x: 4100, y: 5600 }], 4103, 5302, 9);
    expect(d).not.toBeNull();
    if (!d) return;
    expect(d.lines).toHaveLength(2);
    expect(d.p.x).toBeCloseTo(4100, 6);
    expect(d.p.y).toBeCloseTo(5300, 6);
    expect(d.lines.map((l) => l.kind).sort()).toEqual(['apron', 'world']);
  });

  it('prefers a real edge over the world axes', () => {
    const af = field();
    // A gesture point at (4205, 5600): its north line runs at x 4205, the apron's east edge line at x 4200.
    // The pointer at x 4204 is closer to the world line, but the apron edge wins.
    const g = alignGuide(af, [{ x: 4205, y: 5600 }], 4204, 5450, 9);
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.lines[0].kind).toBe('apron');
    expect(g.p.x).toBeCloseTo(4200, 6);
  });
});
