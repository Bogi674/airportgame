import { describe, expect, it } from 'vitest';
import { STAND_SIZES } from '@data/index';
import { padArea, padCurve, padPolygon, padSize, padValue } from '@shared/turnPad';
import { buildPlan } from '@render/markings/taxiPlan';
import { SURFACE_SPEC } from '@data/index';
import { pointInPolygon } from '@shared/geom';
import type { Sim } from '@sim/sim';
import { AcState } from '@sim/ops/traffic';
import { ownedSim, run, buildTestAirport } from './helpers';

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
  it('the pad lies beyond the runway end with the far edge flush and the curve stays on the pad', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2000, code: 'C', approach: 'visual', surface: 'asphalt', tier: 2 });
    const r = sim.airfield.data.runways[0];
    const pad = padPolygon(r, 'a', 'left');
    const size = padSize(r);
    // A unit frame for a heading of 090: s outward from end A is west (smaller x),
    // l toward the pad side (left) is north (smaller y).
    const local = (p: { x: number; y: number }): { s: number; l: number } => ({ s: 3000 - p.x, l: 5000 - p.y });
    for (const p of pad) {
      const { s, l } = local(p);
      expect(s).toBeGreaterThanOrEqual(-1.01);
      expect(s).toBeLessThanOrEqual(size.length + 0.01);
      expect(l).toBeGreaterThanOrEqual(-r.widthM / 2 - 0.01);
      expect(l).toBeLessThanOrEqual(r.widthM / 2 + size.extra + 0.01);
    }
    // Flush far edge: the extreme l on the far side is the runway edge itself.
    expect(Math.min(...pad.map((p) => local(p).l))).toBeCloseTo(-r.widthM / 2, 6);
    for (const p of padCurve(r, 'a', 'left')) expect(pointInPolygon(p.x, p.y, pad)).toBe(true);
  });

  it('the turn curve leaves the runway centerline tangentially and returns on a straight line', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2000, code: 'C', approach: 'visual', surface: 'asphalt', tier: 2 });
    const r = sim.airfield.data.runways[0];
    const pts = padCurve(r, 'a', 'left');
    // Local frame for a heading of 090: s outward west, l toward the pad side north.
    const local = (p: { x: number; y: number }): { s: number; l: number } => ({ s: 3000 - p.x, l: 5000 - p.y });
    const first = local(pts[0]);
    const last = local(pts[pts.length - 1]);
    expect(Math.abs(first.s)).toBeLessThan(0.01);
    expect(Math.abs(first.l)).toBeLessThan(0.01);
    expect(Math.abs(last.s)).toBeLessThan(0.01);
    expect(Math.abs(last.l)).toBeLessThan(0.01);
    // The curved branch leaves the threshold along the runway centerline, as in the reference diagram.
    const head = local(pts[1]);
    expect(Math.abs(head.l - first.l) / Math.abs(head.s - first.s)).toBeLessThan(0.06);
    // The return branch is the straight diagonal of the reference: it comes back at a clear angle to the axis.
    const tail = local(pts[pts.length - 2]);
    const slope = Math.abs(tail.l - last.l) / Math.abs(tail.s - last.s);
    expect(slope).toBeGreaterThan(0.5);
  });

  it('the loop keeps a clear margin from the pad edges', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2000, code: 'C', approach: 'visual', surface: 'asphalt', tier: 2 });
    const r = sim.airfield.data.runways[0];
    const size = padSize(r);
    const local = (p: { x: number; y: number }): { s: number; l: number } => ({ s: 3000 - p.x, l: 5000 - p.y });
    const h = r.widthM / 2;
    const margin = (r.widthM + size.extra) * 0.1;
    for (const p of padCurve(r, 'a', 'left')) {
      const { s, l } = local(p);
      expect(l).toBeGreaterThanOrEqual(-h + margin - 0.01);
      expect(l).toBeLessThanOrEqual(h + size.extra - margin + 0.01);
      expect(s).toBeLessThanOrEqual(size.length - margin + 0.01);
    }
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

  it('building a pad charges exactly padValue and removing refunds the refund share of it', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2000, code: 'C', approach: 'visual', surface: 'asphalt', tier: 2 });
    const r = sim.airfield.data.runways[0];
    const value = padValue(r);
    expect(value).toBeGreaterThan(0);
    const cash = sim.cash;
    expect(run(sim, { type: 'turnPad', runwayId: 1, end: 'a', side: 'left' })).toEqual([]);
    expect(sim.cash).toBe(cash - value);
    const built = sim.cash;
    const refund = Math.round(value * SURFACE_SPEC[r.surface].refundShare);
    expect(run(sim, { type: 'turnPad', runwayId: 1, end: 'a', side: null })).toEqual([]);
    expect(sim.cash).toBe(built + refund);
  });

  it('the plan carries the turn curve and no pad edge line gap', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2000, code: 'C', approach: 'visual', surface: 'asphalt', tier: 2 });
    const r = sim.airfield.data.runways[0];
    r.pads = { a: 'left' };
    const planA = buildPlan(sim.airfield.data);
    expect((planA.runwayBreaks.get(r.id) ?? []).length).toBe(0);
    expect(planA.padCurves).toHaveLength(1);
    expect(planA.padCurves[0].pts).toEqual(padCurve(r, 'a', 'left'));
    r.pads = { b: 'right' };
    const planB = buildPlan(sim.airfield.data);
    expect((planB.runwayBreaks.get(r.id) ?? []).length).toBe(0);
    expect(planB.padCurves).toHaveLength(1);
  });

  it('padArea is the runway width plus the extra width times the pad length', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2000, code: 'C', approach: 'visual', surface: 'asphalt', tier: 2 });
    const r = sim.airfield.data.runways[0];
    const size = padSize(r);
    expect(size.extra).toBe(30);
    expect(size.length).toBe(60);
    expect(padArea(r)).toBe((r.widthM + size.extra) * size.length);
    expect(padArea(r)).toBe(3600);
  });

  it('two runs with a pad from one seed give identical hashes', () => {
    const a = ownedSim();
    const b = ownedSim();
    for (const s of [a, b]) {
      buildTestAirport(s, {});
      run(s, { type: 'turnPad', runwayId: 1, end: 'a', side: 'left' });
      s.enqueue({ type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
      for (let t = 0; t < 2000; t++) s.step();
    }
    expect(a.stateHash()).toBe(b.stateHash());
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
