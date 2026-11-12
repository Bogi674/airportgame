import { describe, expect, it } from 'vitest';
import type { Command } from '@sim/commands';
import type { Pt } from '@shared/geom';
import { apronContains } from '@shared/apronGeom';
import { standBox } from '@shared/clearance';
import { standSlot } from '@shared/standGeom';
import { extendUnitPrice, gaBlockPricing, keptPavement, mergePiece, removePlan, roundApronPoly, standRowPricing } from '@shared/apronPricing';
import { ownedSim, run } from './helpers';

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const apron = (polygon: Pt[], surface: 'asphalt' | 'concrete'): Command => ({ type: 'buildApron', polygon, surface, tier: 0 });

/** The preview and the sim must charge the same cash: the sim's cash moves by exactly the shared number. */
describe('apron and stand pricing shared by the sim and the preview', () => {
  it('a removal refunds what the shared plan says, with a stand and a taxiway kept inside the cut', () => {
    const sim = ownedSim();
    expect(run(sim, apron(rect(4000, 4000, 4300, 4300), 'concrete'))).toEqual([]);
    expect(run(sim, { type: 'buildStands', x: 4150, y: 4150, headingDeg: 0, count: 1, spacingM: 45, standType: 'remote', size: 'medium' })).toEqual([]);
    expect(run(sim, { type: 'buildTaxiway', points: [{ x: 4050, y: 4050 }, { x: 4250, y: 4050 }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 2 })).toEqual([]);
    const cut = rect(4100, 3950, 4200, 4350);
    const kept = keptPavement(sim.airfield.data.stands, sim.airfield.data.taxiways);
    const plan = removePlan(sim.airfield.data.aprons, roundApronPoly(cut), kept);
    expect(plan.pieces.length).toBeGreaterThan(0);
    const cash = sim.cash;
    expect(run(sim, { type: 'removeApronArea', polygon: cut })).toEqual([]);
    expect(sim.cash - cash).toBe(Math.round(plan.refund));
    // The stand box is still paved after the cut.
    expect(sim.airfield.data.aprons.some((a) => apronContains(a, sim.airfield.data.stands[0].x, sim.airfield.data.stands[0].y))).toBe(true);
  });

  it('an extension that overlaps an apron of another surface pays the shared merge charge', () => {
    const sim = ownedSim();
    expect(run(sim, apron(rect(4000, 4000, 4200, 4200), 'concrete'))).toEqual([]);
    expect(run(sim, apron(rect(4200, 4000, 4400, 4200), 'asphalt'))).toEqual([]);
    const target = sim.airfield.data.aprons.find((a) => a.surface === 'concrete');
    if (!target) throw new Error('no concrete apron');
    const poly = rect(4150, 4050, 4300, 4150);
    const preview = mergePiece(sim.airfield.data.aprons, roundApronPoly(poly), 'concrete', extendUnitPrice(target));
    expect(preview.cost).toBeGreaterThan(0);
    const cash = sim.cash;
    expect(run(sim, { type: 'extendApron', apronId: target.id, polygon: poly })).toEqual([]);
    expect(cash - sim.cash).toBe(preview.cost);
  });

  it('a stand row whose slot box overlaps an apron of another surface pays only the uncovered paving', () => {
    const sim = ownedSim();
    const slot = standSlot('medium');
    if (!slot) throw new Error('no slot for the medium stand');
    const box = standBox({ x: 4100, y: 4200, headingDeg: 0 }, slot);
    const xs = box.map((p) => p.x);
    const ys = box.map((p) => p.y);
    const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(run(sim, apron(rect(Math.min(...xs) - 60, Math.min(...ys) - 60, midX, Math.max(...ys) + 60), 'asphalt'))).toEqual([]);
    const row = { x: 4100, y: 4200, headingDeg: 0, count: 1, spacingM: 45, size: 'medium' as const, type: 'remote' as const, surface: 'concrete' as const };
    const preview = standRowPricing(sim.airfield.data.aprons, row);
    expect(preview.paving).toBeGreaterThan(0);
    const cash = sim.cash;
    expect(run(sim, { type: 'buildStands', x: 4100, y: 4200, headingDeg: 0, count: 1, spacingM: 45, standType: 'remote', size: 'medium', surface: 'concrete' })).toEqual([]);
    expect(cash - sim.cash).toBe(preview.total);
  });

  it('a GA block on bare land pays for its block and stands once, the stands inside the block adding nothing', () => {
    const sim = ownedSim();
    const preview = gaBlockPricing(sim.airfield.data.aprons, 4100, 4200, 0, 2, 'asphalt');
    expect(preview.tooLarge).toBe(false);
    const cash = sim.cash;
    expect(run(sim, { type: 'buildGaBlock', x: 4100, y: 4200, headingDeg: 0, count: 2, surface: 'asphalt' })).toEqual([]);
    expect(cash - sim.cash).toBe(preview.total);
    expect(sim.airfield.data.aprons).toHaveLength(1);
  });
});
