import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { BAGGAGE, BUSINESS, PROFILES } from '@data/index';
import { PROFILE_KEYS } from '@data/schemas/profiles';
import { BagStage } from '@sim/ops/baggage/baggage';
import { Sim } from '@sim/sim';
import { WALL } from '../src/shared/business';
import { hEdgeIndex, originFor, vEdgeIndex } from '../src/shared/terminalOps';
import { buildTestAirport, ownedSim, OPTIONS, run } from './helpers';

const { ox, oy } = originFor(3960, 5440, 90);
const A320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');

const MEAN_BAGS = PROFILE_KEYS.reduce((n, k) => n + PROFILES.profiles[k].mix * PROFILES.profiles[k].bagsPerPax, 0) / PROFILE_KEYS.reduce((n, k) => n + PROFILES.profiles[k].mix, 0);
const bagsOf = (pax: number): number => Math.round(pax * MEAN_BAGS);

interface Rig {
  sim: Sim;
  building: number;
  bays: number[];
}

type Edit = { op: 'foundation' | 'floor' | 'zone' | 'fixture' | 'erase'; x0: number; y0: number; x1: number; y1: number; variant: number };

/**
 * A hall with carousels and bays on the south wall. `carousels` is how many carousels stand (0 to 2), `bays` how many bays,
 * the bays serving the first stands in order. With `assign` false no stand has a bay.
 */
function rig(o: { carousels?: number; bays?: number; assign?: boolean } = {}): Rig {
  const sim = ownedSim();
  buildTestAirport(sim);
  const edit = (building: number, e: Edit): string[] => run(sim, { type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e });
  expect(edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 70, y1: 53, variant: 0 })).toEqual([]);
  const building = sim.business.grids[0].id;
  expect(edit(building, { op: 'floor', x0: 40, y0: 40, x1: 70, y1: 53, variant: 2 })).toEqual([]);
  expect(edit(building, { op: 'zone', x0: 40, y0: 46, x1: 60, y1: 53, variant: 4 })).toEqual([]);
  const g = sim.business.grids[0];
  for (let x = 50; x <= 57; x++) g.hWall[hEdgeIndex(g, x, 53)] = WALL.Wall;
  for (let y = 47; y <= 49; y++) g.vWall[vEdgeIndex(g, 46, y)] = WALL.Wall;
  const place = (kind: 'bay' | 'carousel', cx: number, cy: number): void => {
    expect(run(sim, { type: 'placeBaggageNode', building, kind, cx, cy, rot: 0, widthCells: 4 })).toEqual([]);
  };
  const carousels = o.carousels ?? 1;
  const bayCount = o.bays ?? 1;
  if (carousels >= 1) place('carousel', 42, 42);
  if (bayCount >= 1) place('bay', 50, 49);
  if (carousels >= 2) place('carousel', 42, 44);
  if (bayCount >= 2) place('bay', 54, 49);
  const bays = sim.baggage.nodesOf(building).filter((r) => r.kind === 'bay').map((r) => r.id);
  const stands = sim.airfield.data.stands;
  if (o.assign !== false) {
    for (let i = 0; i < bays.length; i++) expect(run(sim, { type: 'setStandBay', standId: stands[i].id, bayId: bays[i] })).toEqual([]);
  }
  return { sim, building, bays };
}

/** An airline flight on the stand with the given index. */
function flight(r: Rig, standIndex = 0): number {
  const t = r.sim.traffic;
  const f = t.scheduleArrival(A320, r.sim.tick + 1, 0, t.turnaroundTicks(A320), 0);
  t.fStand[f] = r.sim.airfield.data.stands[standIndex].id;
  return f;
}

const serialOf = (r: Rig, f: number): number => r.sim.traffic.serialOf(f);
const unload = (r: Rig, f: number, pax: number): void => r.sim.baggage.unloaded(serialOf(r, f), pax, r.sim.tick);
const inSystem = (r: Rig, serial: number): number => Object.values(BagStage).reduce<number>((n, s) => n + (s === 0 ? 0 : r.sim.baggage.bagsOf(serial, s)), 0);

describe('arrival bag flow (T43)', () => {
  it('moves a flight\'s arrival bags from its bay to the carousel, claims them and conserves the count', () => {
    const r = rig();
    const f = flight(r);
    const serial = serialOf(r, f);
    const bags = bagsOf(150);
    unload(r, f, 150);
    expect(r.sim.baggage.bagsOf(serial, BagStage.BayIn)).toBe(bags);
    expect(r.sim.baggage.nodeOfBags(serial, BagStage.BayIn)).toBe(r.bays[0]);
    let onCarousel = false;
    for (let t = 0; t < 1500 && r.sim.baggage.batchCount > 0; t++) {
      r.sim.step();
      expect(inSystem(r, serial) + r.sim.baggage.missingToday + r.sim.baggage.claimedTotal).toBe(bags);
      if (r.sim.baggage.bagsOf(serial, BagStage.Carousel) > 0) {
        onCarousel = true;
        expect(r.sim.baggage.nodeOfBags(serial, BagStage.Carousel)).toBe(r.sim.baggage.carouselOf(r.bays[0]));
      }
    }
    expect(onCarousel).toBe(true);
    expect(r.sim.baggage.claimedTotal).toBe(bags);
    expect(r.sim.baggage.missingToday).toBe(0);
    expect(r.sim.baggage.batchCount).toBe(0);
  });

  it('creates the arrival bags in a live sim when the unload task completes and they reach the carousel', () => {
    const r = rig();
    const f = flight(r);
    for (let t = 0; t < 40000 && r.sim.baggage.claimedTotal === 0; t++) r.sim.step();
    expect(r.sim.business.flightPaxOf(f)).toBeGreaterThan(0);
    expect(r.sim.baggage.claimedTotal).toBe(bagsOf(r.sim.business.flightPaxOf(f)));
    expect(r.sim.baggage.claimFlights).toBe(1);
    expect(r.sim.baggage.checkedToday).toBe(r.sim.baggage.claimedTotal);
    expect(r.sim.baggage.missingToday).toBe(0);
  });

  it('counts the bags missing when the stand has no bay, and none for a flight without passengers', () => {
    const r = rig({ assign: false });
    const f = flight(r);
    unload(r, f, 120);
    expect(r.sim.baggage.missingFor(serialOf(r, f))).toBe(bagsOf(120));
    expect(r.sim.baggage.missingToday).toBe(bagsOf(120));
    expect(r.sim.baggage.batchCount).toBe(0);
    const g = flight(r, 1);
    unload(r, g, 0);
    expect(r.sim.baggage.missingFor(serialOf(r, g))).toBe(0);
    expect(r.sim.baggage.batchCount).toBe(0);
  });

  it('holds the bags in a bay with no carousel and warns', () => {
    const r = rig({ carousels: 0 });
    const f = flight(r);
    const serial = serialOf(r, f);
    unload(r, f, 100);
    for (let t = 0; t < 600; t++) r.sim.step();
    expect(r.sim.baggage.bagsOf(serial, BagStage.BayIn)).toBe(bagsOf(100));
    expect(r.sim.baggage.warnings()).toContainEqual({ id: r.bays[0], code: 'bayNoCarousel' });
    expect(r.sim.baggage.claimedTotal).toBe(0);
  });

  it('keeps a batch on its link while the carousel is full', () => {
    const r = rig({ bays: 2 });
    const a = flight(r, 0);
    const b = flight(r, 1);
    expect(r.sim.baggage.carouselOf(r.bays[0])).toBe(r.sim.baggage.carouselOf(r.bays[1]));
    expect(bagsOf(200)).toBeGreaterThan(BAGGAGE.carousel.capacityBags);
    unload(r, a, 200);
    unload(r, b, 200);
    let held = false;
    for (let t = 0; t < 3000 && r.sim.baggage.batchCount > 0; t++) {
      r.sim.step();
      const full = r.sim.baggage.bagsOf(serialOf(r, a), BagStage.Carousel) + r.sim.baggage.bagsOf(serialOf(r, b), BagStage.Carousel) > 0;
      const waiting = r.sim.baggage.bagsOf(serialOf(r, a), BagStage.ToCarousel) + r.sim.baggage.bagsOf(serialOf(r, b), BagStage.ToCarousel) > 0;
      if (full && waiting) held = true;
    }
    expect(held).toBe(true);
    expect(r.sim.baggage.claimedTotal).toBe(2 * bagsOf(200));
  });

  it('records the claim wait of a flight', () => {
    const r = rig();
    const f = flight(r);
    const start = r.sim.tick;
    unload(r, f, 150);
    expect(r.sim.baggage.claimFlights).toBe(0);
    for (let t = 0; t < 1500 && r.sim.baggage.claimFlights === 0; t++) r.sim.step();
    expect(r.sim.baggage.claimFlights).toBe(1);
    expect(r.sim.baggage.claimWaitSumS).toBeGreaterThan(0);
    expect(r.sim.baggage.claimWaitSumS).toBeLessThanOrEqual(Math.round(((r.sim.tick - start) * 12) / 10));
    r.sim.baggage.resetDay();
    expect(r.sim.baggage.claimFlights).toBe(0);
    expect(r.sim.baggage.claimWaitSumS).toBe(0);
  });

  it('never mixes the bags of two flights on two stands with two bays and two carousels', () => {
    const r = rig({ bays: 2, carousels: 2 });
    const carouselA = r.sim.baggage.carouselOf(r.bays[0]);
    const carouselB = r.sim.baggage.carouselOf(r.bays[1]);
    expect(carouselA).not.toBeNull();
    expect(carouselB).not.toBeNull();
    expect(carouselA).not.toBe(carouselB);
    const a = flight(r, 0);
    const b = flight(r, 1);
    unload(r, a, 90);
    unload(r, b, 70);
    expect(r.sim.baggage.nodeOfBags(serialOf(r, a), BagStage.BayIn)).toBe(r.bays[0]);
    expect(r.sim.baggage.nodeOfBags(serialOf(r, b), BagStage.BayIn)).toBe(r.bays[1]);
    for (let t = 0; t < 1500 && r.sim.baggage.batchCount > 0; t++) {
      r.sim.step();
      for (const [f, carousel] of [[a, carouselA], [b, carouselB]] as const) {
        for (const stage of [BagStage.ToCarousel, BagStage.Carousel]) {
          const node = r.sim.baggage.nodeOfBags(serialOf(r, f), stage);
          if (node >= 0) expect(node).toBe(carousel);
        }
      }
    }
    expect(r.sim.baggage.claimedTotal).toBe(bagsOf(90) + bagsOf(70));
    expect(r.sim.baggage.missingToday).toBe(0);
  });

  it('counts a carousel for arrival capacity and the belt check', () => {
    const none = rig({ carousels: 0, bays: 0 });
    expect(none.sim.business.arrCapacity()).toBe(0);
    expect(none.sim.business.readiness()).toContain('noBelt');
    const one = rig();
    expect(one.sim.business.arrCapacity()).toBe(BUSINESS.modules.belt.capacityPerHour);
    expect(one.sim.business.readiness()).not.toContain('noBelt');
    const two = rig({ carousels: 2, bays: 0 });
    expect(two.sim.business.arrCapacity()).toBe(2 * BUSINESS.modules.belt.capacityPerHour);
  });

  it('restores to the same hash after a save in the middle of the flow', () => {
    const r = rig({ bays: 2 });
    unload(r, flight(r, 0), 200);
    unload(r, flight(r, 1), 150);
    for (let t = 0; t < 30; t++) r.sim.step();
    expect(r.sim.baggage.batchCount).toBeGreaterThan(0);
    const data = JSON.parse(JSON.stringify(r.sim.serialize())) as unknown;
    const copy = new Sim('GOLDEN-0001', OPTIONS);
    copy.restore(data);
    expect(copy.stateHash()).toBe(r.sim.stateHash());
    for (let t = 0; t < 600; t++) {
      r.sim.step();
      copy.step();
    }
    expect(copy.stateHash()).toBe(r.sim.stateHash());
    expect(copy.baggage.saveState()).toEqual(r.sim.baggage.saveState());
  });

  it('is deterministic over 2000 ticks', () => {
    const hashes = [0, 1].map(() => {
      const r = rig({ bays: 2 });
      const a = flight(r, 0);
      const b = flight(r, 1);
      unload(r, a, 180);
      for (let t = 0; t < 2000; t++) {
        if (t === 300) unload(r, b, 120);
        r.sim.step();
      }
      return r.sim.stateHash();
    });
    expect(hashes[0]).toBe(hashes[1]);
  });
});
