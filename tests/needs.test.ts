import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { PROFILES } from '@data/index';
import { FIXTURE_KEYS, ZONE } from '@shared/business';
import type { Sim } from '@sim/sim';
import { Stage, type Cohorts } from '@sim/cohorts/cohorts';
import { NEED_COUNT } from '@data/schemas/needs';
import { buildTestAirport, buildTestTerminal, ownedSim, run } from './helpers';

const WIDE = AIRCRAFT.findIndex((a) => a.id === 'a320neo');
const QUICK_FOOD = FIXTURE_KEYS.indexOf('quickFood') + 1;
const M = PROFILES.maxGroup;
const HUNGER = 0;
const FOOD_X = 88;
const FOOD_Y = 46;
/** Far over the threshold, so hunger outranks a shop want of at most 500 over. */
const STARVING = 5000;
const SUB = 1;

/** A terminal with no seating or toilet and one quick food fixture in the secure hall. */
function foodSim(seed?: string, withFood = true): Sim {
  const sim = ownedSim(seed);
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2, seating: 0, toilet: 0 })).toEqual([]);
  if (withFood) {
    const g = sim.business.grids[0]!;
    const edit = (op: 'zone' | 'fixture', variant: number): string[] =>
      run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op, x0: FOOD_X, y0: FOOD_Y, x1: FOOD_X + 1, y1: FOOD_Y + 1, variant } });
    expect(edit('zone', ZONE.Commercial)).toEqual([]);
    expect(edit('fixture', QUICK_FOOD)).toEqual([]);
  }
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
  function splitOff(sim: Sim): { c: number; size: number; v: number } {
    scheduleLong(sim);
    const co = sim.cohorts;
    let c = -1;
    for (let t = 0; t < 6000 && c < 0; t++) {
      sim.step();
      for (let i = 0; i < co.hi; i++) if (co.stage[i] === Stage.Airside && co.size[i]! >= 2 && (co.flags[i]! & SUB) === 0) c = i;
    }
    expect(c).toBeGreaterThanOrEqual(0);
    const size = co.size[c]!;
    co.memberNeed[c * M * NEED_COUNT + HUNGER] = STARVING;
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
    expect(co.day[0]).toBe(1);
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
    for (let t = 0; t < 8000 && co.stage[v] !== Stage.Free; t++) sim.step();
    expect(co.stage[v]).toBe(Stage.Free);
    expect(co.boarded).toBeGreaterThan(boardedBefore);
    expect(co.size[c] === size - 1 || co.stage[c] === Stage.Free).toBe(true);
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
      const sim = foodSim('NEEDS');
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
