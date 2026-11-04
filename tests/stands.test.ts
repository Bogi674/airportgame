import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { STAND_MARKINGS, STAND_SIZES } from '@data/index';
import { STAND_SIZES_ORDER, type Stand, type StandSize } from '@shared/airfield';
import { standFork, standForks } from '@shared/standFork';
import { standRefusal } from '@shared/standSizes';
import { EdgeKind, TaxiNetwork } from '@sim/airfield/network';
import { cornerPolygons, polygonDistance, standLayout, typeOutlines } from '@render/markings/standLayout';
import { ownedSim, run } from './helpers';

/** A straight east west taxilane at y = 0 and a stand north of it, nose pointing north (away from it). */
const lane = [{ pts: [{ x: -500, y: 0 }, { x: 500, y: 0 }] }];
const stand = (size: StandSize, x = 0, dist = 120): Stand => ({ id: 1, cost: 0, number: '1', x, y: -dist, headingDeg: 0, type: 'contact', size, code: 'C', surface: 'concrete', pushback: 'auto' });

describe('stand lead in fork (revision 2 section 1, test 1)', () => {
  for (const size of STAND_SIZES_ORDER) {
    it(`${size}: arcs of radius D end on the taxilane at plus and minus D, tangent to it`, () => {
      const f = standFork(stand(size), lane);
      expect(f).not.toBeNull();
      if (!f) return;
      const D = STAND_SIZES[size].forkRadiusM;
      expect(f.radius).toBeCloseTo(D, 6);
      // Fork point on the stand centerline at D from the taxilane.
      expect(f.fork.x).toBeCloseTo(0, 3);
      expect(f.fork.y).toBeCloseTo(-D, 2);
      const ends = f.arcs.map((a) => a[a.length - 1].x).sort((p, q) => p - q);
      expect(ends[0]).toBeCloseTo(-D, 2);
      expect(ends[1]).toBeCloseTo(D, 2);
      for (const arc of f.arcs) {
        const end = arc[arc.length - 1];
        expect(end.y).toBeCloseTo(0, 2);
        // Every arc point lies on the circle of radius D whose center is straight above the end point,
        // so the arc meets the taxilane square to its radius: tangentially.
        for (const p of arc) expect(Math.hypot(p.x - end.x, p.y + D)).toBeCloseTo(D, 1);
        // Nothing crosses the taxilane (stand side is y < 0 in world, y > 0 in stand local).
        for (const p of arc) expect(p.y).toBeLessThanOrEqual(1e-6);
      }
    });
  }

  it('facing ends of neighbouring stands share one point on the taxilane', () => {
    const W = STAND_SIZES.medium.widthM;
    const forks = standForks([stand('medium', 0), stand('medium', W)], lane);
    const a = forks[0]?.arcs.map((p) => p[p.length - 1]) ?? [];
    const b = forks[1]?.arcs.map((p) => p[p.length - 1]) ?? [];
    const shared = a.filter((p) => b.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9));
    expect(shared.length).toBe(1);
    expect(shared[0].x).toBeCloseTo(W / 2, 6);
  });
});

describe('contact stand funnel (revision 2 section 3.3, test 4)', () => {
  for (const size of ['medium', 'large', 'xl'] as const) {
    it(`${size}: both front corners keep the clearance from every assigned type`, () => {
      const s = stand(size);
      const l = standLayout(s, standFork(s, lane));
      expect(l?.funnel).not.toBeNull();
      if (!l || !l.funnel) return;
      const [left, right] = cornerPolygons(l.W, l.top, l.funnel);
      l.types.forEach((a, k) => {
        for (const o of typeOutlines(a, l.bars[k].y + (a.stand?.noseGearM ?? 0))) {
          expect(polygonDistance(left, o)).toBeGreaterThanOrEqual(STAND_MARKINGS.funnelClearM - 1e-9);
          expect(polygonDistance(right, o)).toBeGreaterThanOrEqual(STAND_MARKINGS.funnelClearM - 1e-9);
        }
      });
      // The funnel starts above the safety line and below the nose point.
      expect(l.funnel.ys).toBeGreaterThan(l.D);
      expect(l.funnel.ys).toBeLessThan(l.funnel.yn);
    });
  }
});

describe('stand sizes and surfaces (revision 2 section 3, test 5)', () => {
  const apron = (surface: 'grass' | 'asphalt'): Parameters<typeof run>[1] => ({ type: 'buildApron', polygon: [{ x: 4000, y: 4000 }, { x: 4400, y: 4000 }, { x: 4400, y: 4200 }, { x: 4000, y: 4200 }], surface, tier: 0 });

  it('large and extra large stands refuse unpaved surfaces, medium accepts them', () => {
    for (const size of ['large', 'xl'] as const) {
      const sim = ownedSim();
      run(sim, apron('grass'));
      expect(run(sim, { type: 'buildStands', x: 4100, y: 4100, headingDeg: 0, count: 1, spacingM: STAND_SIZES[size].widthM, standType: 'remote', size })).toEqual(['standSurface']);
    }
    const sim = ownedSim();
    run(sim, apron('grass'));
    expect(run(sim, { type: 'buildStands', x: 4100, y: 4100, headingDeg: 0, count: 1, spacingM: 45, standType: 'remote', size: 'medium' })).toEqual([]);
  });

  it('an unpaved medium stand takes only types rated for its surface', () => {
    const s = { size: 'medium' as const, surface: 'gravel' as const };
    const atr = AIRCRAFT.find((a) => a.id === 'atr72_600');
    const a320 = AIRCRAFT.find((a) => a.id === 'a320neo');
    const b777 = AIRCRAFT.find((a) => a.id === 'b777_300er');
    if (!atr || !a320 || !b777) throw new Error('missing types');
    expect(standRefusal(s, atr)).toBeNull();
    expect(standRefusal(s, a320)).toBe('surface');
    expect(standRefusal({ size: 'medium', surface: 'concrete' }, b777)).toBe('span');
  });
});

describe('stand forks in the taxi network', () => {
  it('joins the taxilane on both sides and is never driven through', () => {
    const net = TaxiNetwork.build(
      {
        version: 1,
        runways: [],
        taxiways: [{ id: 1, cost: 0, kind: 'taxilane', points: lane[0].pts, code: 'C', widthM: 15, surface: 'concrete', pcr: 80, condition: 100, oneWay: false, closed: false, userMaxCode: 'C', maxCode: 'C', speedKmh: 30, name: 'A' }],
        aprons: [],
        stands: [stand('medium')],
        holding: [],
        entries: [],
      },
      0,
    );
    const forks = [0, 1].map((side) => net.forkEdge[side]);
    for (const e of forks) {
      expect(e).toBeGreaterThanOrEqual(0);
      expect(net.edgeKind[e]).toBe(EdgeKind.StandFork);
      expect(net.edgeTo[e]).toBe(net.forkNode[0]);
    }
    const tl = net.edgeFrom[forks[0]];
    const tr = net.edgeFrom[forks[1]];
    const edges = new Int32Array(40);
    const dirs = new Int8Array(40);
    const n = net.route(tl, tr, 'C', 0, 0xff, edges, dirs, 40);
    expect(n).toBeGreaterThan(0);
    for (let k = 0; k < n; k++) expect(net.edgeKind[edges[k]]).not.toBe(EdgeKind.StandFork);
    // The stand is reached through a fork, nose first.
    const m = net.route(tl, net.standNode[0], 'C', 0, 0xff, edges, dirs, 40);
    expect(m).toBe(2);
    expect(net.edgeKind[edges[0]]).toBe(EdgeKind.StandFork);
  });
});
