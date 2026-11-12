import { describe, expect, it } from 'vitest';
import type { Command } from '@sim/commands';
import type { Pt } from '@shared/geom';
import { apronArea, apronContains } from '@shared/apronGeom';
import { standBox } from '@shared/clearance';
import { standSlot } from '@shared/standGeom';
import { SURFACE_SPEC } from '@data/index';
import { Sim } from '@sim/sim';
import { REFUND_SHARE } from '@sim/airfield/airfield';
import { tierOf } from '@shared/surfaceRules';
import { cellOf, cornerWorld } from '@shared/terminalOps';
import { buildTestTerminal, ownedSim, run, OPTIONS } from './helpers';

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

describe('apron remove, extend and stand pavement (T57 D5 and D6)', () => {
  const rectPts = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const areaOf = (sim: Sim): number => sim.airfield.data.aprons.reduce((sum, a) => sum + apronArea(a), 0);

  it('a removal across a stand keeps the stand box paved and refunds the rest at the demolish share', () => {
    const sim = ownedSim();
    run(sim, build(rectPts(4000, 4000, 4200, 4300)));
    expect(run(sim, { type: 'buildStands', x: 4100, y: 4200, headingDeg: 0, count: 1, spacingM: 45, standType: 'remote', size: 'medium' })).toEqual([]);
    const stand = sim.airfield.data.stands[0];
    const slot = standSlot(stand.size);
    if (!slot) throw new Error('no slot for the medium stand');
    const bay = standBox(stand, slot);
    const centre = { x: bay.reduce((s, p) => s + p.x, 0) / 4, y: bay.reduce((s, p) => s + p.y, 0) / 4 };
    const before = areaOf(sim);
    const cash = sim.cash;
    expect(run(sim, { type: 'removeApronArea', polygon: rectPts(4050, 3950, 4150, 4350) })).toEqual([]);
    const removed = before - areaOf(sim);
    expect(Math.abs(removed - (100 * 300 - apronArea({ polygon: bay })))).toBeLessThan(5);
    expect(sim.airfield.data.aprons.some((a) => apronContains(a, centre.x, centre.y))).toBe(true);
    expect(sim.airfield.data.aprons.some((a) => apronContains(a, 4060, 4100))).toBe(false);
    expect(Math.abs(sim.cash - cash - removed * SURFACE_SPEC.concrete.costPerM2 * REFUND_SHARE)).toBeLessThan(1);
  });

  it('removing the middle of an apron leaves two aprons', () => {
    const sim = ownedSim();
    run(sim, build(rectPts(4000, 4000, 4200, 4300)));
    run(sim, { type: 'removeApronArea', polygon: rectPts(4090, 3950, 4110, 4350) });
    expect(sim.airfield.data.aprons).toHaveLength(2);
  });

  it('extending an apron from a touching piece merges it and charges only the new area', () => {
    const sim = ownedSim();
    run(sim, build(rectPts(4000, 4000, 4200, 4100)));
    const id = sim.airfield.data.aprons[0].id;
    const cash = sim.cash;
    expect(run(sim, { type: 'extendApron', apronId: id, polygon: rectPts(4200, 4000, 4300, 4100) })).toEqual([]);
    expect(sim.airfield.data.aprons).toHaveLength(1);
    expect(Math.round(apronArea(sim.airfield.data.aprons[0]))).toBe(30000);
    expect(cash - sim.cash).toBe(10000 * SURFACE_SPEC.concrete.costPerM2);
  });

  it('an extension that does not touch its apron is refused', () => {
    const sim = ownedSim();
    run(sim, build(rectPts(4000, 4000, 4200, 4100)));
    const id = sim.airfield.data.aprons[0].id;
    const cash = sim.cash;
    expect(run(sim, { type: 'extendApron', apronId: id, polygon: rectPts(4400, 4400, 4500, 4500) })).toEqual(['apron.extendNotTouching']);
    expect(sim.airfield.data.aprons).toHaveLength(1);
    expect(sim.cash).toBe(cash);
  });

  it('a removal, an extension and a save load give the same state hash', () => {
    const sim = ownedSim();
    run(sim, build(rectPts(4000, 4000, 4200, 4300)));
    run(sim, { type: 'removeApronArea', polygon: rectPts(4090, 3950, 4110, 4350) });
    run(sim, { type: 'extendApron', apronId: sim.airfield.data.aprons[0].id, polygon: rectPts(4200, 4000, 4300, 4100) });
    const loaded = new Sim('GOLDEN-0001', OPTIONS);
    loaded.restore(JSON.parse(JSON.stringify(sim.serialize())));
    expect(loaded.stateHash()).toBe(sim.stateHash());
  });

  it('a stand on bare land paves exactly its slot box in the default surface', () => {
    const sim = ownedSim();
    expect(run(sim, { type: 'buildStands', x: 4100, y: 4200, headingDeg: 0, count: 1, spacingM: 45, standType: 'remote', size: 'medium' })).toEqual([]);
    const stand = sim.airfield.data.stands[0];
    const slot = standSlot(stand.size);
    if (!slot) throw new Error('no slot for the medium stand');
    expect(stand.surface).toBe('concrete');
    expect(sim.airfield.data.aprons).toHaveLength(1);
    expect(sim.airfield.data.aprons[0].surface).toBe('concrete');
    expect(Math.abs(apronArea(sim.airfield.data.aprons[0]) - apronArea({ polygon: standBox(stand, slot) }))).toBeLessThan(5);
  });

  it('a stand takes the surface the command gives', () => {
    const sim = ownedSim();
    expect(run(sim, { type: 'buildStands', x: 4100, y: 4200, headingDeg: 0, count: 1, spacingM: 45, standType: 'remote', size: 'medium', surface: 'asphalt' })).toEqual([]);
    expect(sim.airfield.data.stands[0].surface).toBe('asphalt');
    expect(sim.airfield.data.aprons[0].surface).toBe('asphalt');
  });

  it('a stand row over bare land paves one apron, the boxes merged without seams', () => {
    const sim = ownedSim();
    expect(run(sim, { type: 'buildStands', x: 4100, y: 4200, headingDeg: 0, count: 3, spacingM: 45, standType: 'remote', size: 'medium' })).toEqual([]);
    expect(sim.airfield.data.aprons).toHaveLength(1);
    expect(sim.airfield.data.aprons[0].holes).toBeUndefined();
  });

  it('a GA block paves its block and stands into one asphalt apron', () => {
    const sim = ownedSim();
    expect(run(sim, { type: 'buildGaBlock', x: 4100, y: 4200, headingDeg: 0, count: 2 })).toEqual([]);
    expect(sim.airfield.data.stands.every((s) => s.surface === 'asphalt')).toBe(true);
    expect(sim.airfield.data.aprons).toHaveLength(1);
  });
});

describe('apron fixes from review (T57)', () => {
  const rectPts = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  /** A runway east to west at y 4200, 600 m long from x 4000. */
  const runway: Command = { type: 'buildRunway', x: 4000, y: 4200, headingDeg: 90, lengthM: 600, code: 'C', approach: 'visual', surface: 'asphalt', tier: 2 };
  const stand = (x: number, y: number, surface?: 'asphalt' | 'concrete'): Command => ({ type: 'buildStands', x, y, headingDeg: 0, count: 1, spacingM: 45, standType: 'remote', size: 'medium', surface });

  it('a stand slot that crosses a runway strip is refused', () => {
    const sim = ownedSim();
    expect(run(sim, runway)).toEqual([]);
    expect(run(sim, stand(4200, 4200))).toEqual(['onRunway']);
    expect(sim.airfield.data.stands).toHaveLength(0);
  });

  it('a removal keeps taxiway pavement inside the piece', () => {
    const sim = ownedSim();
    run(sim, build(rectPts(4000, 4000, 4300, 4300)));
    expect(run(sim, { type: 'buildTaxiway', points: [{ x: 4050, y: 4150 }, { x: 4250, y: 4150 }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 2 })).toEqual([]);
    expect(run(sim, { type: 'removeApronArea', polygon: rectPts(4090, 3950, 4110, 4350) })).toEqual([]);
    expect(sim.airfield.data.aprons.some((a) => apronContains(a, 4100, 4150))).toBe(true);
    expect(sim.airfield.data.aprons.some((a) => apronContains(a, 4100, 4050))).toBe(false);
  });

  it('the Ctrl cut takes the same path as the remove command', () => {
    const removed = ownedSim();
    const cut = ownedSim();
    for (const sim of [removed, cut]) {
      run(sim, build(rectPts(4000, 4000, 4300, 4300)));
      run(sim, stand(4150, 4200));
    }
    const cashRemoved = removed.cash;
    const cashCut = cut.cash;
    run(removed, { type: 'removeApronArea', polygon: rectPts(4090, 3950, 4110, 4350) });
    run(cut, { type: 'cutApron', polygon: rectPts(4090, 3950, 4110, 4350) });
    expect(cut.airfield.data.aprons.map((a) => apronArea(a))).toEqual(removed.airfield.data.aprons.map((a) => apronArea(a)));
    expect(cut.cash - cashCut).toBe(removed.cash - cashRemoved);
  });

  it('an extension that crosses a runway strip is refused', () => {
    const sim = ownedSim();
    run(sim, build(rectPts(4000, 4000, 4200, 4100)));
    run(sim, runway);
    const id = sim.airfield.data.aprons[0].id;
    expect(run(sim, { type: 'extendApron', apronId: id, polygon: rectPts(4000, 4100, 4200, 4190) })).toEqual(['onRunway']);
    expect(sim.airfield.data.aprons).toHaveLength(1);
  });

  it('an extension onto unowned land is refused', () => {
    const sim = ownedSim();
    run(sim, build(rectPts(4000, 4000, 4200, 4100)));
    const id = sim.airfield.data.aprons[0].id;
    sim.parcelOwner.fill(0);
    expect(run(sim, { type: 'extendApron', apronId: id, polygon: rectPts(4200, 4000, 4300, 4100) })).toEqual(['notOwned']);
  });

  it('an extension merges a second apron that it touches and pays only for its own area', () => {
    const sim = ownedSim();
    run(sim, build(rectPts(4000, 4000, 4200, 4100)), build(rectPts(4300, 4000, 4400, 4100)));
    expect(sim.airfield.data.aprons).toHaveLength(2);
    const id = sim.airfield.data.aprons.find((a) => apronArea(a) === 20000)?.id;
    if (id === undefined) throw new Error('no apron to extend');
    const cash = sim.cash;
    expect(run(sim, { type: 'extendApron', apronId: id, polygon: rectPts(4200, 4000, 4300, 4100) })).toEqual([]);
    expect(sim.airfield.data.aprons).toHaveLength(1);
    expect(Math.round(apronArea(sim.airfield.data.aprons[0]))).toBe(40000);
    expect(cash - sim.cash).toBe(10000 * SURFACE_SPEC.concrete.costPerM2);
  });

  it('a small extension is accepted with no minimum size', () => {
    const sim = ownedSim();
    run(sim, build(rectPts(4000, 4000, 4200, 4100)));
    const id = sim.airfield.data.aprons[0].id;
    const cash = sim.cash;
    expect(run(sim, { type: 'extendApron', apronId: id, polygon: rectPts(4200, 4000, 4210, 4010) })).toEqual([]);
    expect(cash - sim.cash).toBe(100 * SURFACE_SPEC.concrete.costPerM2);
  });

  it('a stand box half over a concrete apron pays only the uncovered half and leaves the concrete apron as it was', () => {
    const sim = ownedSim();
    run(sim, build(rectPts(4000, 4000, 4200, 4300)));
    const concrete = JSON.stringify(sim.airfield.data.aprons[0]);
    const cash = sim.cash;
    expect(run(sim, stand(4200, 4200, 'asphalt'))).toEqual([]);
    const s = sim.airfield.data.stands[0];
    const slot = standSlot(s.size);
    if (!slot) throw new Error('no slot for the medium stand');
    const bay = standBox(s, slot);
    const half = apronArea({ polygon: bay }) / 2;
    expect(JSON.stringify(sim.airfield.data.aprons.find((a) => a.surface === 'concrete'))).toBe(concrete);
    const asphalt = sim.airfield.data.aprons.find((a) => a.surface === 'asphalt');
    if (!asphalt) throw new Error('no asphalt apron');
    expect(Math.abs(apronArea(asphalt) - half)).toBeLessThan(5);
    const paving = cash - sim.cash - s.cost;
    expect(Math.abs(paving - half * SURFACE_SPEC.asphalt.costPerM2)).toBeLessThan(SURFACE_SPEC.asphalt.costPerM2 * 5);
  });

  it('a GA block and its stands take the surface of the apron under the block', () => {
    const sim = ownedSim();
    run(sim, build(rectPts(3900, 4000, 4300, 4400)));
    expect(run(sim, { type: 'buildGaBlock', x: 4100, y: 4200, headingDeg: 0, count: 1 })).toEqual([]);
    expect(sim.airfield.data.stands.every((x) => x.surface === 'concrete')).toBe(true);
    expect(sim.airfield.data.aprons).toHaveLength(1);
  });

  it('the largest remainder of a removal keeps the apron id, the others take fresh ids', () => {
    const sim = ownedSim();
    run(sim, build(rectPts(4000, 4000, 4200, 4300)));
    const original = sim.airfield.data.aprons[0].id;
    run(sim, { type: 'removeApronArea', polygon: rectPts(4050, 3950, 4070, 4350) });
    const west = sim.airfield.data.aprons.find((a) => Math.round(apronArea(a)) === 15000);
    const east = sim.airfield.data.aprons.find((a) => Math.round(apronArea(a)) === 39000);
    if (!west || !east) throw new Error('expected a 15000 and a 39000 m2 remainder');
    expect(east.id).toBe(original);
    expect(west.id).not.toBe(original);
  });

  it('extending a higher tier apron is priced at its tier and keeps its strength', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildApron', polygon: rectPts(4000, 4000, 4200, 4100), surface: 'concrete', tier: 2 });
    const tier = tierOf('concrete', 2);
    expect(sim.airfield.data.aprons[0].pcr).toBe(tier.pcr);
    const id = sim.airfield.data.aprons[0].id;
    const cash = sim.cash;
    expect(run(sim, { type: 'extendApron', apronId: id, polygon: rectPts(4200, 4000, 4300, 4100) })).toEqual([]);
    expect(cash - sim.cash).toBe(Math.round(10000 * SURFACE_SPEC.concrete.costPerM2 * tier.factor));
    expect(sim.airfield.data.aprons).toHaveLength(1);
    expect(sim.airfield.data.aprons[0].pcr).toBe(tier.pcr);
  });

  it('a GA block over a runway, a tower or a terminal is refused', () => {
    const runwaySim = ownedSim();
    run(runwaySim, runway);
    expect(run(runwaySim, { type: 'buildGaBlock', x: 4100, y: 4200, headingDeg: 0, count: 1 })).toEqual(['onRunway']);
    const towerSim = ownedSim();
    towerSim.cash = 80_000_000;
    run(towerSim, { type: 'buildTower', x: 4100, y: 4200, level: 1 });
    expect(run(towerSim, { type: 'buildGaBlock', x: 4100, y: 4200, headingDeg: 0, count: 1 })).toEqual(['onTower']);
    const terminalSim = ownedSim();
    terminalSim.cash = 80_000_000;
    expect(buildTestTerminal(terminalSim)).toEqual([]);
    const g = terminalSim.business.grids[0];
    let at = { x: 0, y: 0 };
    for (let i = 0; i < g.floor.length; i++) {
      if (g.floor[i] <= 0) continue;
      const c = cellOf(g, i);
      at = cornerWorld(g, c.x + 0.5, c.y + 0.5);
      break;
    }
    expect(run(terminalSim, { type: 'buildGaBlock', x: at.x, y: at.y, headingDeg: 0, count: 1 })).toEqual(['onTerminal']);
  });

  it('apron ids are the same on two identical runs after a split', () => {
    const scenario = (): number[] => {
      const sim = ownedSim();
      run(sim, build(rectPts(4000, 4000, 4200, 4300)));
      run(sim, { type: 'removeApronArea', polygon: rectPts(4090, 3950, 4110, 4350) });
      return sim.airfield.data.aprons.map((a) => a.id);
    };
    expect(scenario()).toEqual(scenario());
    expect(scenario()).toHaveLength(2);
  });

  it('a stand box over a tower is refused', () => {
    const sim = ownedSim();
    sim.cash = 80_000_000;
    expect(run(sim, { type: 'buildTower', x: 4200, y: 4200, level: 1 })).toEqual([]);
    expect(run(sim, stand(4200, 4200))).toEqual(['onTower']);
    expect(sim.airfield.data.stands).toHaveLength(0);
  });

  it('an apron extension over a tower is refused', () => {
    const sim = ownedSim();
    sim.cash = 80_000_000;
    run(sim, build(rectPts(4000, 4000, 4200, 4100)));
    expect(run(sim, { type: 'buildTower', x: 4210, y: 4050, level: 1 })).toEqual([]);
    const id = sim.airfield.data.aprons[0].id;
    expect(run(sim, { type: 'extendApron', apronId: id, polygon: rectPts(4200, 4000, 4260, 4100) })).toEqual(['onTower']);
  });

  it('a stand box over a terminal is refused, and so is an apron extension over one', () => {
    const sim = ownedSim();
    sim.cash = 80_000_000;
    expect(buildTestTerminal(sim)).toEqual([]);
    const g = sim.business.grids[0];
    let at = { x: 0, y: 0 };
    for (let i = 0; i < g.floor.length; i++) {
      if (g.floor[i] <= 0) continue;
      const c = cellOf(g, i);
      at = cornerWorld(g, c.x + 0.5, c.y + 0.5);
      break;
    }
    expect(run(sim, stand(at.x, at.y))).toEqual(['onTerminal']);
    run(sim, build(rectPts(at.x - 60, at.y - 60, at.x - 10, at.y + 60)));
    const id = sim.airfield.data.aprons[0].id;
    expect(run(sim, { type: 'extendApron', apronId: id, polygon: rectPts(at.x - 10, at.y - 60, at.x + 40, at.y + 60) })).toEqual(['onTerminal']);
  });
});
