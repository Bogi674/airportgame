import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { BUSINESS, PROFILES } from '@data/index';
import { NEED_COUNT } from '@data/schemas/needs';
import { LEDGER_CATEGORIES, TICKS_PER_DAY } from '@shared/business';
import { VENDING_KIND, propTotals, vendingPoints } from '@shared/props';
import { Stage } from '@sim/cohorts/cohorts';
import { SAVE_VERSION } from '@sim/save/migrations';
import { Sim } from '@sim/sim';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run } from './helpers';

const WIDE = AIRCRAFT.findIndex((a) => a.id === 'a320neo');
const M = PROFILES.maxGroup;
const HUNGER = 0;

/** The test airport and terminal with gate desks, seats and toilets but no tenant unit. */
function terminalSim(seed?: string): Sim {
  const sim = ownedSim(seed);
  sim.cash = 100_000_000;
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2 })).toEqual([]);
  return sim;
}

const place = (sim: Sim, asset: string, x: number, y: number): string[] =>
  run(sim, { type: 'placeProp', building: sim.business.grids[0]!.id, asset, x, y, rot: 0 });

describe('prop effect data', () => {
  it('holds the owner values of 2026-11-23', () => {
    const P = BUSINESS.props;
    expect(P.vendingNeeds['vending.coffee']).toEqual(['hunger', 'thirst']);
    expect(P.vendingNeeds['vending.travel']).toEqual(['shop']);
    expect(P.adPerPax['screen.adTotem']).toBe(0.01);
    expect(P.adPerPax['screen.ledWall']).toBe(0.05);
    expect(P.paxPerAdSlot).toBe(500);
    expect(P.wayfindingAreaM2).toBe(400);
    // T50 appended the incidents row after these two.
    expect(LEDGER_CATEGORIES.slice(-3)).toEqual(['vending', 'ads', 'incidents']);
    expect(SAVE_VERSION).toBe(44);
  });
});

describe('vending machines', () => {
  it('give one visit point per need they meet, only on passenger floor', () => {
    const sim = terminalSim();
    expect(place(sim, 'vending.coffee', 180, 96)).toEqual([]);
    expect(place(sim, 'vending.snack', 184, 96)).toEqual([]);
    const pts = vendingPoints(sim.business.grids[0]!);
    expect(pts.map((p) => p.kind)).toEqual([VENDING_KIND.hunger, VENDING_KIND.thirst, VENDING_KIND.hunger]);
    for (const p of pts) expect(p.share).toBe(0.15);
  });

  it('a hungry passenger with no food unit buys from a snack machine and the share is booked as vending', () => {
    const sim = terminalSim();
    expect(place(sim, 'vending.snack', 180, 96)).toEqual([]);
    expect(sim.traffic.scheduleArrival(WIDE, sim.traffic.nowTick + 4100, 0, 6000, -1)).toBeGreaterThanOrEqual(0);
    const co = sim.cohorts;
    let c = -1;
    for (let t = 0; t < 6000 && c < 0; t++) {
      sim.step();
      for (let i = 0; i < co.hi; i++) if (co.stage[i] === Stage.Airside && co.size[i]! >= 1) c = i;
    }
    expect(c).toBeGreaterThanOrEqual(0);
    for (let m = 0; m < co.size[c]!; m++) co.memberNeed[(c * M + m) * NEED_COUNT + HUNGER] = 5000;
    for (let t = 0; t < 6000 && sim.business.vendingToday === 0; t++) sim.step();
    expect(sim.business.vendingToday).toBeGreaterThan(0);
    const share = sim.business.vendingToday;
    while (sim.business.vendingToday > 0) sim.step();
    const days = sim.business.payload(sim.traffic.nowTick).history;
    expect(days[days.length - 1]![LEDGER_CATEGORIES.indexOf('vending')]).toBeGreaterThanOrEqual(Math.floor(share));
  });
});

describe('ads and wayfinding', () => {
  it('ad slots grow with the daily passengers, best paying first', () => {
    const sim = terminalSim();
    expect(place(sim, 'screen.adTotem', 180, 96)).toEqual([]);
    expect(place(sim, 'screen.adTotem', 184, 96)).toEqual([]);
    expect(sim.business.adIncome(1000)).toBeCloseTo(20, 6);
    expect(sim.business.adIncome(600)).toBeCloseTo(6, 6);
    expect(sim.business.adIncome(400)).toBe(0);
    expect(place(sim, 'screen.ledWall', 170, 98)).toEqual([]);
    expect(sim.business.adIncome(600)).toBeCloseTo(30, 6);
  });

  it('flight boards raise the wayfinding score against passenger floor', () => {
    const sim = terminalSim();
    expect(sim.business.wayfindingScore).toBe(0);
    expect(place(sim, 'screen.fids3', 180, 96)).toEqual([]);
    const area = propTotals(sim.business.grids[0]!).passengerAreaM2;
    expect(sim.business.wayfindingScore).toBeCloseTo(Math.min(1, 1 / (area / BUSINESS.props.wayfindingAreaM2)), 9);
    // An ad totem carries no wayfinding.
    const one = sim.business.wayfindingScore;
    expect(place(sim, 'screen.adTotem', 186, 96)).toEqual([]);
    expect(sim.business.wayfindingScore).toBe(one);
  });
});

describe('saves and determinism', () => {
  it('two runs from one seed give identical hashes over 2000 ticks', () => {
    const make = (): number => {
      const s = terminalSim();
      expect(place(s, 'vending.coffee', 180, 96)).toEqual([]);
      expect(place(s, 'screen.adTotem', 184, 96)).toEqual([]);
      s.enqueue({ type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
      for (let t = 0; t < 2000; t++) s.step();
      return s.stateHash();
    };
    expect(make()).toBe(make());
  });

  it('a save in the middle of a day keeps the vending sales and the hash', () => {
    const a = terminalSim();
    expect(place(a, 'vending.snack', 180, 96)).toEqual([]);
    a.business.vendingSale(12.5);
    a.enqueue({ type: 'setTestTraffic', perHour: 30, turnScale: 0.1 });
    for (let t = 0; t < 1000; t++) a.step();
    const b = new Sim(a.seed, OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.business.vendingToday).toBe(a.business.vendingToday);
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 1000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });

  it('a day closes with no vending or ad row when there are none', () => {
    const s = terminalSim();
    for (let t = 0; t < TICKS_PER_DAY + 10; t++) s.step();
    const days = s.business.payload(s.traffic.nowTick).history;
    expect(days[days.length - 1]![LEDGER_CATEGORIES.indexOf('vending')]).toBe(0);
    expect(days[days.length - 1]![LEDGER_CATEGORIES.indexOf('ads')]).toBe(0);
  });
});
