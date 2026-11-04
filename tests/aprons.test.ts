import { describe, expect, it } from 'vitest';
import type { Command } from '@sim/commands';
import type { Pt } from '@shared/geom';
import { apronArea, apronContains } from '@shared/apronGeom';
import { ownedSim, run } from './helpers';

/** fig7.py shapes, moved onto owned land: x + 4100, y flipped (world y is south) + 5600. */
const at = (x: number, y: number): Pt => ({ x: 4100 + x, y: 5600 - y });
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
const build = (polygon: Pt[]): Command => ({ type: 'buildApron', polygon, surface: 'concrete', tier: 0 });

describe('apron tool (revision 2 section 4, test 6)', () => {
  it('a free polygon builds the area of the reference sheet', () => {
    const sim = ownedSim();
    expect(run(sim, build([at(-80, -55), at(55, -55), at(78, -25), at(66, 40), at(-20, 58), at(-82, 28)]))).toEqual([]);
    expect(Math.round(apronArea(sim.airfield.data.aprons[0]))).toBe(15342);
  });

  it('a rectangle touching an apron merges into one apron of the summed area, and undo splits it again', () => {
    const sim = ownedSim();
    run(sim, build(box(-95, -55, -15, 40)));
    const name = sim.airfield.data.aprons[0].name;
    expect(run(sim, build(box(-15, -55, 75, 15)))).toEqual([]);
    const aprons = sim.airfield.data.aprons;
    expect(aprons).toHaveLength(1);
    expect(Math.round(apronArea(aprons[0]))).toBe(13900);
    expect(aprons[0].name).toBe(name);
    run(sim, { type: 'undo' });
    expect(sim.airfield.data.aprons).toHaveLength(1);
    expect(Math.round(apronArea(sim.airfield.data.aprons[0]))).toBe(7600);
    run(sim, { type: 'redo' });
    expect(Math.round(apronArea(sim.airfield.data.aprons[0]))).toBe(13900);
  });

  it('pays only for the new area when pieces overlap', () => {
    const sim = ownedSim();
    run(sim, build(box(0, 0, 100, 100)));
    const cash = sim.cash;
    run(sim, build(box(50, 0, 150, 100)));
    expect(Math.round(apronArea(sim.airfield.data.aprons[0]))).toBe(15000);
    expect(cash - sim.cash).toBeCloseTo(5000 * 90, -2);
  });

  it('a cut takes a piece out, leaving a hole the surface lookup respects', () => {
    const sim = ownedSim();
    run(sim, build(box(0, 0, 200, 100)));
    const cash = sim.cash;
    expect(run(sim, { type: 'cutApron', polygon: box(80, 30, 120, 70) })).toEqual([]);
    const a = sim.airfield.data.aprons[0];
    expect(a.holes).toHaveLength(1);
    expect(Math.round(apronArea(a))).toBe(20000 - 1600);
    expect(apronContains(a, at(100, 50).x, at(100, 50).y)).toBe(false);
    expect(apronContains(a, at(20, 50).x, at(20, 50).y)).toBe(true);
    expect(sim.cash).toBeGreaterThan(cash);
    // A cut across the middle leaves two aprons.
    run(sim, { type: 'cutApron', polygon: box(95, -10, 105, 110) });
    expect(sim.airfield.data.aprons).toHaveLength(2);
    run(sim, { type: 'undo' });
    run(sim, { type: 'undo' });
    expect(sim.airfield.data.aprons).toHaveLength(1);
    expect(sim.airfield.data.aprons[0].holes).toBeUndefined();
  });

  it('different surfaces do not merge', () => {
    const sim = ownedSim();
    run(sim, build(box(0, 0, 100, 100)));
    run(sim, { type: 'buildApron', polygon: box(100, 0, 200, 100), surface: 'asphalt', tier: 0 });
    expect(sim.airfield.data.aprons).toHaveLength(2);
  });
});
