import { describe, expect, it } from 'vitest';
import { AIRCRAFT, standGeometry } from '@data/aircraft';
import { ARRIVALS } from '@data/index';
import { Sim } from '@sim/sim';
import { DAY, Stage } from '@sim/cohorts/cohorts';
import { FIXTURE_KEYS, TICKS_PER_MINUTE } from '@shared/business';
import { gameSecondsToTicks } from '@shared/time';
import { COHORT_DRAW, traitU } from '@sim/cohorts/traits';
import { PROFILE_KEYS } from '@data/schemas/profiles';
import { buildArrivalTerminal, buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run, type TerminalOptions } from './helpers';

const A320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');

/** A sim with an airport and a terminal that has a curb, check in, security and gate desks. */
function terminalSim(seed?: string, o: TerminalOptions = { checkIn: 4, security: 2, gateDesk: 2 }): Sim {
  const sim = ownedSim(seed);
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, o)).toEqual([]);
  return sim;
}

/** Schedules a flight and steps until it docked and its passengers were counted. */
function dockFlight(sim: Sim): number {
  const f = sim.traffic.scheduleArrival(A320, sim.traffic.nowTick + 100, 0, 600, -1);
  expect(f).toBeGreaterThanOrEqual(0);
  for (let t = 0; t < 8000 && sim.business.flightPaxOf(f) === 0; t++) sim.step();
  expect(sim.business.flightPaxOf(f)).toBeGreaterThan(0);
  return f;
}

/** Arrival cohort slots in slot order. */
function arrivalSlots(sim: Sim): number[] {
  const out: number[] = [];
  for (let c = 0; c < sim.cohorts.hi; c++) if (sim.cohorts.stage[c]! >= Stage.Deboard) out.push(c);
  return out;
}

describe('arrival cohorts (T20 slice 5)', () => {
  it('a domestic flight docks, its cohorts leave the aircraft in turn and every passenger exits at the curb', () => {
    const sim = terminalSim();
    const f = dockFlight(sim);
    const co = sim.cohorts;
    expect(co.arrGenerated).toBe(sim.business.flightPaxOf(f));
    const slots = arrivalSlots(sim);
    expect(slots.length).toBeGreaterThan(1);
    const timers = slots.map((c) => co.timer[c]!);
    expect(timers).toEqual([...timers].sort((a, b) => a - b));
    const born = co.born[slots[0]!]!;
    expect(born - sim.tick).toBeGreaterThanOrEqual(gameSecondsToTicks(ARRIVALS.doorOpenS) - 2);
    const doors = Math.max(1, standGeometry(AIRCRAFT[A320]!).doorStationsM.length);
    const last = slots[slots.length - 1]!;
    const ahead = co.arrGenerated - co.size[last]!;
    expect(Math.abs(co.timer[last]! - (born + gameSecondsToTicks((ahead * ARRIVALS.deboardSecondsPerPax) / doors)))).toBeLessThanOrEqual(1);
    const generatedBefore = co.generated;
    for (let t = 0; t < 20000 && co.arrActive > 0; t++) sim.step();
    expect(co.arrActive).toBe(0);
    expect(co.arrExited).toBe(co.arrGenerated);
    expect(co.arrStranded).toBe(0);
    expect(co.day[DAY.ArrExited]).toBe(co.arrGenerated);
    expect(co.generated).toBe(generatedBefore);
    expect(co.generated).toBe(sim.business.paxFor(f));
    expect(arrivalSlots(sim)).toEqual([]);
  });

  it('with the curb door removed the cohorts strand after the limit and take the stranded points', () => {
    const sim = terminalSim();
    const f = dockFlight(sim);
    const co = sim.cohorts;
    const g = sim.business.grids[0]!;
    expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: { op: 'removeWall', x0: 70, y0: 52, x1: 72, y1: 52, variant: 0 } })).toEqual([]);
    expect(sim.business.curbNode(0)).toBe(-1);
    const born = co.born[arrivalSlots(sim)[0]!]!;
    const limit = ARRIVALS.strandedMin * TICKS_PER_MINUTE;
    for (let t = 0; t < 20000 && co.arrActive > 0; t++) sim.step();
    expect(co.arrActive).toBe(0);
    expect(co.arrExited).toBe(0);
    expect(co.arrStranded).toBe(sim.business.flightPaxOf(f));
    expect(sim.tick).toBeGreaterThanOrEqual(born + limit);
    expect(co.day[DAY.PenStranded]).toBe(ARRIVALS.satisfaction.strandedPoints * co.arrStranded);
    expect(co.day[DAY.ArrStranded]).toBe(co.arrStranded);
  });

  it('keeps arrGenerated equal to exited plus stranded plus active over 8000 ticks of traffic', () => {
    const sim = terminalSim();
    run(sim, { type: 'setTestTraffic', perHour: 20, turnScale: 0.1 });
    const co = sim.cohorts;
    for (let t = 0; t < 8000; t++) {
      sim.step();
      if (t % 50 === 0) {
        expect(co.arrGenerated).toBe(co.arrExited + co.arrStranded + co.arrActive);
        expect(co.generated).toBe(co.boarded + co.missed + co.active);
      }
    }
    expect(co.arrGenerated).toBeGreaterThan(0);
  });

  it('leaves the arrival cohorts alone when the flight pushes back', () => {
    const sim = terminalSim();
    const f = dockFlight(sim);
    const co = sim.cohorts;
    const before = arrivalSlots(sim);
    const active = co.arrActive;
    co.onPushback(f);
    expect(arrivalSlots(sim)).toEqual(before);
    expect(co.arrActive).toBe(active);
    expect(before.every((c) => co.stage[c] === Stage.Deboard)).toBe(true);
  });

  it('saves and restores in the middle of deboarding to the same hash after 2000 ticks', () => {
    const a = terminalSim();
    dockFlight(a);
    for (let t = 0; t < 20; t++) a.step();
    expect(a.cohorts.arrActive).toBeGreaterThan(0);
    const b = new Sim('GOLDEN-0001', OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.cohorts.arrActive).toBe(a.cohorts.arrActive);
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.cohorts.arrExited).toBe(a.cohorts.arrExited);
  });

  it('demolishing the grid strands the arrivals still in it, mid deboard and mid walk', () => {
    const deboard = terminalSim();
    dockFlight(deboard);
    for (let t = 0; t < 20; t++) deboard.step();
    const co = deboard.cohorts;
    const total = co.arrGenerated;
    expect(arrivalSlots(deboard).every((c) => co.stage[c] === Stage.Deboard)).toBe(true);
    expect(run(deboard, { type: 'demolishTerminal', id: deboard.business.grids[0]!.id })).toEqual([]);
    expect(co.arrStranded).toBe(total);
    expect(co.arrExited).toBe(0);
    expect(co.arrActive).toBe(0);
    expect(co.day[DAY.PenStranded]).toBe(ARRIVALS.satisfaction.strandedPoints * total);
    expect(arrivalSlots(deboard)).toEqual([]);

    const walk = terminalSim();
    dockFlight(walk);
    const w = walk.cohorts;
    for (let t = 0; t < 20000 && !arrivalSlots(walk).some((c) => w.stage[c] === Stage.ToExit); t++) walk.step();
    expect(arrivalSlots(walk).some((c) => w.stage[c] === Stage.ToExit)).toBe(true);
    const inside = w.arrActive;
    const exited = w.arrExited;
    expect(inside).toBeGreaterThan(0);
    run(walk, { type: 'demolishTerminal', id: walk.business.grids[0]!.id });
    expect(w.arrActive).toBe(0);
    expect(w.arrStranded).toBeGreaterThanOrEqual(inside);
    expect(w.arrGenerated).toBe(w.arrExited + w.arrStranded);
    expect(w.arrExited).toBeGreaterThanOrEqual(exited);
    expect(w.day[DAY.PenStranded]).toBe(ARRIVALS.satisfaction.strandedPoints * w.arrStranded);
    expect(arrivalSlots(walk)).toEqual([]);
  });
});

const IMMIGRATION_KINDS = { passport: FIXTURE_KEYS.indexOf('passport') + 1, eGate: FIXTURE_KEYS.indexOf('eGate') + 1 };
const FAMILY = PROFILE_KEYS.indexOf('family');
const ADULT = PROFILE_KEYS.findIndex((k) => k !== 'family');
const REFERRAL = ARRIVALS.service.eGate.referralShare;

/** A seed whose cohort draw is below (referred) or above (never referred) the eGate referral share. */
function seedWithReferral(referred: boolean): number {
  for (let seed = 1; ; seed++) if ((traitU(seed, COHORT_DRAW.Referral) < REFERRAL) === referred) return seed;
}

function arrivalHall(o: Parameters<typeof buildArrivalTerminal>[1] = {}): Sim {
  const sim = ownedSim();
  sim.cash = 1_000_000_000;
  buildTestAirport(sim, { standsPerRow: 8 });
  expect(buildArrivalTerminal(sim, o)).toEqual([]);
  return sim;
}

/** Docks a flight whose series destination is international (or domestic) and returns its slot. */
function dockRoute(sim: Sim, international: boolean): number {
  const market = sim.business.market;
  const dest = market.destinations.find((d) => d.international === international)!;
  const id = international ? 9001 : 9002;
  market.series.push({ id, airline: 0, dest: dest.id, typeIdx: A320, days: 127, winMin: 0, startDay: 0, endDay: 100, standId: -1, minute: -1, turnMin: 30 });
  const f = sim.traffic.scheduleArrival(A320, sim.traffic.nowTick + 100, 0, 600, -1, 0, id);
  sim.traffic.fStand[f] = sim.airfield.data.stands[0]!.id;
  for (let t = 0; t < 8000 && sim.business.flightPaxOf(f) === 0; t++) sim.step();
  expect(sim.business.flightPaxOf(f)).toBeGreaterThan(0);
  return f;
}

/** Steps until no arrival is active, recording per slot the stages seen and the immigration node kinds visited in order. */
function runJourney(sim: Sim, maxTicks = 30000, each?: () => void): { stages: Uint32Array; kinds: number[][] } {
  const co = sim.cohorts;
  const stages = new Uint32Array(co.cap);
  const kinds: number[][] = Array.from({ length: co.cap }, () => []);
  for (let t = 0; t < maxTicks && co.arrActive > 0; t++) {
    sim.step();
    const nodes = sim.business.serviceNodes[0]!;
    for (let c = 0; c < co.hi; c++) {
      const st = co.stage[c]!;
      if (st < Stage.Deboard) continue;
      stages[c] = stages[c]! | (1 << st);
      if (st === Stage.Immigration && co.node[c]! >= 0) {
        const kind = nodes.kind[co.node[c]!]!;
        const seen = kinds[c]!;
        if (seen[seen.length - 1] !== kind) seen.push(kind);
      }
    }
    each?.();
  }
  return { stages, kinds };
}

describe('immigration (T20 slice 6)', () => {
  it('every cohort of an international flight passes immigration and none does on a domestic flight', () => {
    const intl = arrivalHall();
    dockRoute(intl, true);
    const slots = arrivalSlots(intl);
    const a = runJourney(intl);
    expect(intl.cohorts.arrExited).toBe(intl.cohorts.arrGenerated);
    for (const c of slots) expect(a.stages[c]! & (1 << Stage.Immigration), `slot ${c}`).not.toBe(0);

    const home = arrivalHall();
    dockRoute(home, false);
    const b = runJourney(home);
    expect(home.cohorts.arrExited).toBe(home.cohorts.arrGenerated);
    for (let c = 0; c < home.cohorts.cap; c++) expect(b.stages[c]! & ((1 << Stage.Immigration) | (1 << Stage.ToImmigration))).toBe(0);
  });

  it('with only eGates, families and referred cohorts strand and the others exit', () => {
    const sim = arrivalHall({ passport: false });
    dockRoute(sim, true);
    const co = sim.cohorts;
    let expectedStranded = 0;
    for (const c of arrivalSlots(sim)) {
      if (co.profile[c] === FAMILY || traitU(co.recipeSeed[c]!, COHORT_DRAW.Referral) < REFERRAL) expectedStranded += co.size[c]!;
    }
    expect(expectedStranded).toBeGreaterThan(0);
    expect(expectedStranded).toBeLessThan(co.arrGenerated);
    runJourney(sim);
    expect(co.arrStranded).toBe(expectedStranded);
    expect(co.arrExited).toBe(co.arrGenerated - expectedStranded);
  });

  it('sends a referred cohort from the eGate to a passport booth', () => {
    const sim = arrivalHall();
    dockRoute(sim, true);
    const co = sim.cohorts;
    const slots = arrivalSlots(sim);
    for (const c of slots) {
      co.recipeSeed[c] = seedWithReferral(true);
      co.profile[c] = ADULT;
    }
    const { kinds } = runJourney(sim);
    expect(co.arrExited).toBe(co.arrGenerated);
    const viaGate = slots.filter((c) => kinds[c]![0] === IMMIGRATION_KINDS.eGate);
    expect(viaGate.length).toBeGreaterThan(0);
    for (const c of viaGate) expect(kinds[c], `slot ${c}`).toEqual([IMMIGRATION_KINDS.eGate, IMMIGRATION_KINDS.passport]);
    for (const c of slots.filter((x) => kinds[x]![0] === IMMIGRATION_KINDS.passport)) expect(kinds[c]).toEqual([IMMIGRATION_KINDS.passport]);
  });

  it('never picks a booth in departure mode', () => {
    const sim = arrivalHall({ eGate: false });
    sim.business.grids[0]!.fixtureMode.fill(0);
    dockRoute(sim, true);
    const { stages } = runJourney(sim);
    const co = sim.cohorts;
    expect(co.arrStranded).toBe(co.arrGenerated);
    for (let c = 0; c < co.cap; c++) expect(stages[c]! & (1 << Stage.Immigration)).toBe(0);
  });

  it('sends a cohort back to ToImmigration when its booth is removed mid queue, and it still exits', () => {
    const sim = arrivalHall();
    dockRoute(sim, true);
    const co = sim.cohorts;
    const slots = arrivalSlots(sim);
    for (const c of slots) {
      co.recipeSeed[c] = seedWithReferral(false);
      co.profile[c] = ADULT;
    }
    const grid = sim.business.grids[0]!;
    let erased = false;
    let evicted = 0;
    const { stages } = runJourney(sim, 30000, () => {
      if (erased) return;
      const nodes = sim.business.serviceNodes[0]!;
      for (let c = 0; c < co.hi; c++) {
        if (co.stage[c] !== Stage.Immigration || co.node[c]! < 0 || nodes.kind[co.node[c]!] !== IMMIGRATION_KINDS.passport) continue;
        erased = true;
        evicted = nodes.qCount[co.node[c]!]! + (nodes.serving[co.node[c]!]! >= 0 ? 1 : 0);
        run(sim, { type: 'terminalBuild', building: grid.id, ox: grid.ox, oy: grid.oy, headingDeg: 90, edit: { op: 'erase', x0: 72, y0: 52, x1: 73, y1: 53, variant: 0 } });
        return;
      }
    });
    expect(erased).toBe(true);
    expect(evicted).toBeGreaterThan(0);
    expect(co.arrExited).toBe(co.arrGenerated);
    expect(slots.some((c) => stages[c]! & (1 << Stage.ToImmigration))).toBe(true);
  });

  it('charges the immigration queue wait through waitStart', () => {
    const sim = arrivalHall({ eGate: false });
    dockRoute(sim, true);
    const co = sim.cohorts;
    let waiting = 0;
    runJourney(sim, 30000, () => {
      for (let c = 0; c < co.hi; c++) {
        if (co.stage[c] === Stage.Immigration) {
          expect(co.waitStart[c]!).toBeGreaterThanOrEqual(0);
          waiting++;
        } else if (co.stage[c] === Stage.ToExit) expect(co.waitStart[c]).toBe(-1);
      }
    });
    expect(waiting).toBeGreaterThan(0);
    const home = arrivalHall({ eGate: false });
    dockRoute(home, false);
    runJourney(home);
    expect(co.day[DAY.PenQueue]).toBeGreaterThan(home.cohorts.day[DAY.PenQueue]!);
  });
});
