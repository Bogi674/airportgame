import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { PROFILES } from '@data/index';
import { Stage, queuePoints, unmetPoints, walkPoints, type Cohorts } from '@sim/cohorts/cohorts';
import { memberSeedOf, writeTraits, TRAIT_COUNT } from '@sim/cohorts/traits';
import { TICKS_PER_DAY } from '@shared/business';
import { NEED_COUNT } from '@data/schemas/needs';
import { Sim } from '@sim/sim';
import { buildTestAirport, buildTestTerminal, leaseUnit, OPTIONS, ownedSim, run } from './helpers';

const WIDE = AIRCRAFT.findIndex((a) => a.id === 'a320neo');
const SMALL = AIRCRAFT.findIndex((a) => a.id === 'atr72_600');
const THIRST = 1;
const M = PROFILES.maxGroup;
const HUNGER = 0;
const FOOD_X = 88;
const FOOD_Y = 46;
/** Far over the threshold, so hunger outranks a shop want of at most 500 over. */
const STARVING = 5000;
const SUB = 1;

/** A terminal with no seating or toilet and one leased quick food unit (5 by 2 cells) in the secure hall, centered on FOOD_X, FOOD_Y. */
function foodSim(seed?: string, withFood = true, desks = { checkIn: 4, security: 2, gateDesk: 2 }, category: 'quickFood' | 'cafe' = 'quickFood'): Sim {
  const sim = ownedSim(seed);
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, { ...desks, seating: 0, toilet: 0 })).toEqual([]);
  if (withFood) expect(leaseUnit(sim, FOOD_X - 2, FOOD_Y, 5, category === 'cafe' ? 1 : 2, category)).toEqual([]);
  return sim;
}

function scheduleLong(sim: Sim): void {
  const f = sim.traffic.scheduleArrival(WIDE, sim.traffic.nowTick + 100, 0, 6000, -1);
  expect(f).toBeGreaterThanOrEqual(0);
}

function foodCell(sim: Sim): number {
  const g = sim.business.grids[0]!;
  return (FOOD_Y - g.y0) * g.w + (FOOD_X - g.x0);
}

/** Makes member 0 of every airside main cohort of two or more starving. Returns how many it touched. */
function starve(sim: Sim): number {
  const co = sim.cohorts;
  let touched = 0;
  for (let c = 0; c < co.hi; c++) {
    if (co.stage[c] !== Stage.Airside || co.size[c]! < 2 || (co.flags[c]! & SUB) !== 0) continue;
    co.memberNeed[c * M * NEED_COUNT + HUNGER] = STARVING;
    touched++;
  }
  return touched;
}

function subOf(co: Cohorts, parent: number): number {
  for (let c = 0; c < co.hi; c++) if (co.stage[c] !== Stage.Free && co.parent[c] === parent && (co.flags[c]! & SUB) !== 0) return c;
  return -1;
}

describe('needs and sub cohorts', () => {
  /** Runs a foodSim until a group of two or more is airside, makes member 0 starve and returns the group, its size and its new sub cohort. */
  function splitOff(sim: Sim, need = HUNGER): { c: number; size: number; v: number } {
    // The aircraft lands 4000 ticks later than usual, so the group is still airside when the member comes back.
    expect(sim.traffic.scheduleArrival(WIDE, sim.traffic.nowTick + 4100, 0, 6000, -1)).toBeGreaterThanOrEqual(0);
    const co = sim.cohorts;
    let c = -1;
    for (let t = 0; t < 6000 && c < 0; t++) {
      sim.step();
      for (let i = 0; i < co.hi; i++) if (co.stage[i] === Stage.Airside && co.size[i]! >= 2 && (co.flags[i]! & SUB) === 0) c = i;
    }
    expect(c).toBeGreaterThanOrEqual(0);
    const size = co.size[c]!;
    co.memberNeed[c * M * NEED_COUNT + need] = STARVING;
    co.needTick[c] = sim.traffic.nowTick;
    let v = -1;
    for (let t = 0; t < 200 && v < 0; t++) {
      sim.step();
      v = subOf(co, c);
    }
    expect(v).toBeGreaterThanOrEqual(0);
    expect(co.size[v]).toBe(1);
    expect(co.size[c]).toBe(size - 1);
    expect(co.stage[v]).toBe(Stage.ToVisit);
    expect(co.target[v]).toBe(foodCell(sim));
    return { c, size, v };
  }

  /** Steps until the sub cohort leaves the Visit stage. */
  function untilVisitEnds(sim: Sim, v: number): void {
    const co = sim.cohorts;
    for (let t = 0; t < 3000 && co.stage[v] !== Stage.Visit; t++) sim.step();
    expect(co.stage[v]).toBe(Stage.Visit);
    for (let t = 0; t < 3000 && co.stage[v] === Stage.Visit; t++) sim.step();
    expect(co.stage[v]).not.toBe(Stage.Visit);
  }

  it('a hungry member splits off, visits the quick food fixture, resets and rejoins its group', () => {
    const sim = foodSim();
    const co = sim.cohorts;
    const { c, size, v } = splitOff(sim);
    untilVisitEnds(sim, v);
    expect(co.memberNeed[v * M * NEED_COUNT + HUNGER]).toBe(0);
    expect(co.day[HUNGER]).toBe(1);
    expect(co.stage[v]).toBe(Stage.Rejoin);
    for (let t = 0; t < 3000 && co.stage[v] !== Stage.Free; t++) sim.step();
    expect(co.stage[v]).toBe(Stage.Free);
    expect(co.stage[c]).toBe(Stage.Airside);
    expect(co.size[c]).toBe(size);
  });

  it('a thirsty member has a short visit at a cafe and rejoins the group that waited airside', () => {
    const sim = foodSim(undefined, true, undefined, 'cafe');
    const co = sim.cohorts;
    const { c, size, v } = splitOff(sim, THIRST);
    untilVisitEnds(sim, v);
    expect(co.memberNeed[v * M * NEED_COUNT + THIRST]).toBe(0);
    expect(co.day[THIRST]).toBe(1);
    expect(co.stage[v]).toBe(Stage.Rejoin);
    for (let t = 0; t < 3000 && co.stage[v] !== Stage.Free; t++) sim.step();
    expect(co.stage[v]).toBe(Stage.Free);
    expect(co.stage[c]).toBe(Stage.Airside);
    expect(co.size[c]).toBe(size);
  });

  it('a sub cohort whose group is gone carries on airside alone and boards separately', () => {
    const sim = foodSim();
    const co = sim.cohorts;
    const { c, size, v } = splitOff(sim);
    co.parent[v] = -1;
    untilVisitEnds(sim, v);
    expect(co.memberNeed[v * M * NEED_COUNT + HUNGER]).toBe(0);
    expect(co.stage[v]).toBe(Stage.Airside);
    const boardedBefore = co.boarded;
    // The group never takes the member back: while it lives it keeps the size it had without them.
    let groupSize = size - 1;
    let boardedWhenFree = -1;
    for (let t = 0; t < 14000 && co.stage[v] !== Stage.Free; t++) {
      sim.step();
      if (co.stage[c] !== Stage.Free) groupSize = co.size[c]!;
      boardedWhenFree = co.boarded;
    }
    expect(co.stage[v]).toBe(Stage.Free);
    expect(groupSize).toBe(size - 1);
    expect(co.stage[c]).toBe(Stage.Free);
    expect(boardedWhenFree).toBeGreaterThan(boardedBefore);
    expect(co.generated).toBe(co.boarded + co.missed + co.active);
  });

  it('keeps generated equal to boarded plus missed plus active with splits', () => {
    const sim = foodSim();
    scheduleLong(sim);
    const co = sim.cohorts;
    let splits = 0;
    for (let t = 0; t < 6000; t++) {
      sim.step();
      if (t % 50 === 0) {
        starve(sim);
        let subs = 0;
        for (let c = 0; c < co.hi; c++) if (co.stage[c] !== Stage.Free && (co.flags[c]! & SUB) !== 0) subs++;
        splits = Math.max(splits, subs);
        expect(co.generated).toBe(co.boarded + co.missed + co.active);
      }
    }
    expect(splits).toBeGreaterThan(0);
    expect(co.generated).toBe(co.boarded + co.missed + co.active);
  });

  it('is deterministic over 2000 ticks with forced hunger', () => {
    const make = (): Sim => {
      const sim = foodSim('NEEDS2');
      scheduleLong(sim);
      let seenSub = false;
      for (let t = 0; t < 2000; t++) {
        sim.step();
        if (t % 50 === 0) starve(sim);
        for (let c = 0; c < sim.cohorts.hi && !seenSub; c++) seenSub = sim.cohorts.stage[c] !== Stage.Free && (sim.cohorts.flags[c]! & SUB) !== 0;
      }
      expect(seenSub).toBe(true);
      return sim;
    };
    const a = make();
    const b = make();
    expect(b.stateHash()).toBe(a.stateHash());
  });
});

const TOILET_NEED = 2;

/** A terminal with two toilets in the secure hall. */
function toiletSim(seed?: string): Sim {
  const sim = ownedSim(seed);
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2, toilet: 2 })).toEqual([]);
  scheduleLong(sim);
  return sim;
}

/** Steps until a toilet sub cohort of one member is queued at a toilet node. Returns its slot. */
function queueAtToilet(sim: Sim): number {
  const co = sim.cohorts;
  let c = -1;
  for (let t = 0; t < 6000 && c < 0; t++) {
    sim.step();
    for (let i = 0; i < co.hi; i++) if (co.stage[i] === Stage.Airside && co.size[i]! >= 2 && (co.flags[i]! & SUB) === 0) c = i;
  }
  expect(c).toBeGreaterThanOrEqual(0);
  co.memberNeed[c * M * NEED_COUNT + TOILET_NEED] = STARVING;
  co.needTick[c] = sim.traffic.nowTick;
  let v = -1;
  for (let t = 0; t < 600 && v < 0; t++) {
    sim.step();
    const sub = subOf(co, c);
    if (sub >= 0 && co.stage[sub] === Stage.VisitQueue) v = sub;
  }
  expect(v).toBeGreaterThanOrEqual(0);
  return v;
}

describe('toilet visits', () => {
  it('a member who needs the toilet queues at a toilet node, is served and starts the need over', () => {
    const sim = toiletSim();
    const co = sim.cohorts;
    const v = queueAtToilet(sim);
    expect(co.waitStart[v]).toBeGreaterThanOrEqual(0);
    expect(co.node[v]).toBeGreaterThanOrEqual(0);
    for (let t = 0; t < 1000 && co.stage[v] === Stage.VisitQueue; t++) sim.step();
    expect(co.stage[v]).not.toBe(Stage.VisitQueue);
    expect(co.memberNeed[v * M * NEED_COUNT + TOILET_NEED]).toBe(0);
    expect(co.day[TOILET_NEED]).toBe(1);
  });

  it('erasing the toilets with a sub cohort queued keeps the books', () => {
    const sim = toiletSim();
    const co = sim.cohorts;
    const v = queueAtToilet(sim);
    const g = sim.business.grids[0]!;
    expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op: 'erase', x0: 84, y0: 40, x1: 86, y1: 41, variant: 0 } })).toEqual([]);
    for (let t = 0; t < 10; t++) sim.step();
    expect(co.stage[v]).not.toBe(Stage.VisitQueue);
    for (let t = 0; t < 6000; t++) {
      sim.step();
      if (t % 50 === 0) expect(co.generated).toBe(co.boarded + co.missed + co.active);
    }
    expect(co.generated).toBe(co.boarded + co.missed + co.active);
  });

  it('a save taken while queued at a toilet restores to the same hash', () => {
    const a = toiletSim();
    queueAtToilet(a);
    const b = new Sim(a.seed, OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 1000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });

  it('a toilet sub cohort still queued at push back misses the flight', () => {
    const sim = toiletSim();
    const co = sim.cohorts;
    const v = queueAtToilet(sim);
    const f = co.flight[v]!;
    co.onPushback(f);
    expect(co.generated).toBe(co.boarded + co.missed + co.active);
    expect(co.stage[v] === Stage.Missed || co.stage[v] === Stage.Free).toBe(true);
  });
});

/** Day counter indexes, as the cohorts store lays them out. */
const DAY_SAT_SUM = 6;
const DAY_SAT_COUNT = 7;
const DAY_PEN_UNMET = 10;
const DAY_PEN_MISSED = 11;

describe('member satisfaction', () => {
  it('queue, walk and unmet need points are hand computed', () => {
    // 15 game minutes is 750 ticks, 900 s, 300 s over a patience of 600 s: 5 minutes at one point each.
    expect(queuePoints(750, 600)).toBeCloseTo(5, 9);
    expect(queuePoints(100, 600)).toBe(0);
    expect(walkPoints(400)).toBeCloseTo(2, 9);
    expect(walkPoints(250)).toBe(0);
    // Hunger falls due after 3 game hours at factor 1, so two hours over is 2000 / 3 levels over: 20 points.
    expect(unmetPoints(1000 + 2000 / 3, 0, 1)).toBeCloseTo(20, 9);
    expect(unmetPoints(900, 0, 1)).toBe(0);
  });

  /** A sim stepped once, so that its cohorts exist at the curb, and the first cohort. */
  function firstCohort(): { sim: Sim; c: number } {
    const sim = foodSim();
    scheduleLong(sim);
    sim.step();
    expect(sim.cohorts.hi).toBeGreaterThan(0);
    return { sim, c: 0 };
  }

  it('a member two game hours over its hunger threshold loses 20 points at boarding', () => {
    const { sim, c } = firstCohort();
    const co = sim.cohorts;
    const traits = new Float64Array(TRAIT_COUNT);
    writeTraits(memberSeedOf(co.recipeSeed[c]!, 0), co.profile[c]!, traits);
    co.memberNeed[c * M * NEED_COUNT + HUNGER] = Math.round(1000 + (2000 * traits[HUNGER]!) / 3);
    // A need tick far ahead means no growth is added before the rating.
    co.needTick[c] = 2 ** 30;
    co.rollUp(c, false);
    expect(co.memberSat[c * M]).toBe(80);
    expect(co.day[DAY_PEN_UNMET]).toBe(20);
    expect(co.day[DAY_SAT_COUNT]).toBe(co.size[c]);
  });

  it('a missed flight costs 40 points per member', () => {
    const { sim, c } = firstCohort();
    const co = sim.cohorts;
    co.needTick[c] = 2 ** 30;
    co.rollUp(c, true);
    expect(co.memberSat[c * M]).toBe(60);
    expect(co.day[DAY_PEN_MISSED]).toBe(40 * co.size[c]!);
    expect(co.satisfaction[c]).toBe(60);
  });

  it('the ring drops the first day at the 31st close', () => {
    const co = foodSim().cohorts;
    co.day[DAY_SAT_SUM] = 100;
    co.day[DAY_SAT_COUNT] = 1;
    expect(co.closeDay()).toBe(100);
    let mean = 0;
    for (let d = 0; d < 29; d++) {
      co.day[DAY_SAT_SUM] = 50;
      co.day[DAY_SAT_COUNT] = 1;
      mean = co.closeDay();
    }
    expect(mean).toBeGreaterThan(50);
    co.day[DAY_SAT_SUM] = 50;
    co.day[DAY_SAT_COUNT] = 1;
    expect(co.closeDay()).toBe(50);
    expect(co.lastDay[DAY_SAT_SUM]).toBe(50);
    expect(co.day[DAY_SAT_SUM]).toBe(0);
  });

  /** Runs one flight with the starving members forced every 50 ticks, then closes the day. */
  function dayWithFood(withFood: boolean): Sim {
    const sim = foodSim('PART-B', withFood, { checkIn: 16, security: 3, gateDesk: 4 });
    expect(sim.traffic.scheduleArrival(SMALL, sim.traffic.nowTick + 100, 0, 12000, -1)).toBeGreaterThanOrEqual(0);
    const co = sim.cohorts;
    // Each group is made hungry once, the first time it is airside.
    const forced = new Set<number>();
    for (let t = 0; t < 16000; t++) {
      sim.step();
      for (let c = 0; c < co.hi; c++) {
        if (co.stage[c] !== Stage.Airside || co.size[c]! < 2 || (co.flags[c]! & SUB) !== 0 || forced.has(co.recipeSeed[c]!)) continue;
        forced.add(co.recipeSeed[c]!);
        co.memberNeed[c * M * NEED_COUNT + HUNGER] = STARVING;
        co.needTick[c] = sim.traffic.nowTick;
      }
    }
    expect(forced.size).toBeGreaterThan(0);
    expect(sim.cohorts.active).toBe(0);
    expect(sim.cohorts.boarded).toBeGreaterThan(0);
    const close = sim.business as unknown as { dailyClose(tick: number): void };
    close.dailyClose(sim.tick + TICKS_PER_DAY);
    return sim;
  }

  it('with a quick food fixture the rated satisfaction, the rating input and the pax score are higher', () => {
    const fed = dayWithFood(true);
    const hungry = dayWithFood(false);
    expect(fed.cohorts.lastDay[DAY_PEN_UNMET]).toBeLessThan(hungry.cohorts.lastDay[DAY_PEN_UNMET]!);
    const mean = (sim: Sim): number => sim.cohorts.lastDay[DAY_SAT_SUM]! / sim.cohorts.lastDay[DAY_SAT_COUNT]!;
    expect(mean(fed)).toBeGreaterThan(mean(hungry));
    expect(fed.business.satisfaction).toBeGreaterThan(hungry.business.satisfaction);
    expect(fed.business.paxScore).toBeGreaterThan(hungry.business.paxScore);
  });

  it('a save restores the counters and the ring to the same hash', () => {
    const a = dayWithFood(true);
    const b = new Sim(a.seed, OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.stateHash()).toBe(a.stateHash());
  });
});

describe('restore keeps the cohort clock', () => {
  it('a pushback in the first tick after a restore rates the same as in the uninterrupted run', () => {
    const a = foodSim('RESTORE-CLOCK');
    scheduleLong(a);
    for (let t = 0; t < 1500; t++) a.step();
    const b = new Sim(a.seed, OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.stateHash()).toBe(a.stateHash());
    expect(a.cohorts.active).toBeGreaterThan(0);
    // The flight leaves while its passengers are still inside, which brings their needs up to date and rates them.
    a.cohorts.onPushback(0);
    b.cohorts.onPushback(0);
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 500; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
    expect(a.cohorts.day[DAY_SAT_COUNT]).toBeGreaterThan(0);
  });
});
