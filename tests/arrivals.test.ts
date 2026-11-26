import { describe, expect, it } from 'vitest';
import { AIRCRAFT, standGeometry } from '@data/aircraft';
import { ARRIVALS, NEEDS, PROFILES } from '@data/index';
import { Sim } from '@sim/sim';
import { DAY, Stage, arrivalStage } from '@sim/cohorts/cohorts';
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
  for (let c = 0; c < sim.cohorts.hi; c++) if (arrivalStage(sim.cohorts.stage[c]!)) out.push(c);
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
      if (!arrivalStage(st)) continue;
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

/** A flight of airline 0 on stand 0, whose turnaround unloads the bags. Steps until its passengers were counted. */
function dockAirlineFlight(sim: Sim): { f: number; serial: number } {
  const t = sim.traffic;
  const f = t.scheduleArrival(A320, t.nowTick + 1, 0, t.turnaroundTicks(A320), 0);
  t.fStand[f] = sim.airfield.data.stands[0]!.id;
  for (let i = 0; i < 8000 && sim.business.flightPaxOf(f) === 0; i++) sim.step();
  expect(sim.business.flightPaxOf(f)).toBeGreaterThan(0);
  return { f, serial: t.serialOf(f) };
}

describe('baggage claim (T20 slice 7)', () => {
  it('cohorts with bags wait in Claim until the bags are delivered and cohorts without bags never enter it', () => {
    const sim = arrivalHall({ carousel: true });
    const { serial } = dockAirlineFlight(sim);
    const co = sim.cohorts;
    const slots = arrivalSlots(sim);
    const hasBags = new Map(slots.map((c) => [c, co.bags[c]! > 0]));
    expect([...hasBags.values()].some((b) => b)).toBe(true);
    expect([...hasBags.values()].some((b) => !b)).toBe(true);
    const was = new Uint8Array(co.cap);
    const left = new Map<number, number>();
    const seen = new Set<number>();
    for (let t = 0; t < 40000 && co.arrActive > 0; t++) {
      sim.step();
      for (const c of slots) {
        const st = co.stage[c]!;
        if (st === Stage.Claim) seen.add(c);
        if (was[c] === Stage.Claim && st !== Stage.Claim) left.set(c, sim.tick);
        was[c] = st;
      }
    }
    expect(co.arrActive).toBe(0);
    const delivered = sim.baggage.deliveredAt(serial);
    expect(delivered).toBeGreaterThanOrEqual(0);
    expect(co.arrExited).toBe(co.arrGenerated);
    for (const c of slots) expect(seen.has(c), `slot ${c}`).toBe(hasBags.get(c));
    for (const c of slots.filter((x) => hasBags.get(x))) {
      expect(left.get(c)!, `slot ${c}`).toBeGreaterThanOrEqual(delivered);
      expect(left.get(c)!).toBeLessThanOrEqual(Math.max(delivered, co.born[c]!) + gameSecondsToTicks(ARRIVALS.claim.pollS) + 10);
    }
    expect(co.day[DAY.NoBags] + co.lastDay[DAY.NoBags]).toBe(0);
  });

  it('a stand with no bay gives every cohort with bags the missing bag points', () => {
    const sim = arrivalHall();
    dockRoute(sim, false);
    const co = sim.cohorts;
    let withBags = 0;
    for (const c of arrivalSlots(sim)) if (co.bags[c]! > 0) withBags += co.size[c]!;
    expect(withBags).toBeGreaterThan(0);
    runJourney(sim);
    expect(co.arrExited).toBe(co.arrGenerated);
    expect(co.day[DAY.NoBags]).toBe(withBags);
    expect(co.day[DAY.PenMissingBag]).toBe(ARRIVALS.satisfaction.missingBagPoints * withBags);
  });

  it('a carousel that never gets the bags makes the cohorts give up at the limit with the missing bag points', () => {
    const sim = arrivalHall({ carousel: true });
    dockRoute(sim, false);
    const co = sim.cohorts;
    const slots = arrivalSlots(sim);
    let withBags = 0;
    for (const c of slots) if (co.bags[c]! > 0) withBags += co.size[c]!;
    const born = co.born[slots[0]!]!;
    runJourney(sim);
    expect(sim.baggage.deliveredAt(sim.traffic.serialOf(0))).toBe(-1);
    expect(co.arrExited).toBe(co.arrGenerated);
    expect(co.day[DAY.NoBags]).toBe(withBags);
    expect(co.day[DAY.PenMissingBag]).toBe(ARRIVALS.satisfaction.missingBagPoints * withBags);
    expect(sim.tick).toBeGreaterThanOrEqual(born + ARRIVALS.claim.giveUpMin * TICKS_PER_MINUTE);
  });

  it('a claim wait of 15 game minutes with a patience of 600 seconds costs 5 queue minutes of points', () => {
    const sim = arrivalHall({ carousel: true });
    dockRoute(sim, false);
    const co = sim.cohorts;
    const c = arrivalSlots(sim)[0]!;
    co.profile[c] = PROFILE_KEYS.indexOf('business');
    const before = co.memberSat[c * PROFILES.maxGroup]!;
    const members = co.size[c]!;
    const wait = gameSecondsToTicks(900);
    const queueBefore = co.day[DAY.PenQueue]!;
    const waitBefore = co.day[DAY.ClaimWaitS]!;
    const countBefore = co.day[DAY.ClaimCount]!;
    co.waitStart[c] = sim.tick - wait;
    co.stage[c] = Stage.Claim;
    (co as unknown as { leaveClaim(c: number, missing: boolean): void }).leaveClaim(c, false);
    const points = Math.round(5 * NEEDS.satisfaction.queuePerMin);
    expect(before - co.memberSat[c * PROFILES.maxGroup]!).toBe(points);
    expect(co.day[DAY.PenQueue]! - queueBefore).toBe(points * members);
    expect(co.day[DAY.ClaimWaitS]! - waitBefore).toBeCloseTo(900, -1);
    expect(co.day[DAY.ClaimCount]! - countBefore).toBe(1);
  });

  it('saves in the middle of the flow with the delivery rows and restores the same hash', () => {
    const a = arrivalHall({ carousel: true });
    const { serial } = dockAirlineFlight(a);
    for (let t = 0; t < 40000 && a.baggage.deliveredAt(serial) < 0; t++) a.step();
    expect(a.baggage.deliveredAt(serial)).toBeGreaterThanOrEqual(0);
    const b = new Sim('GOLDEN-0001', OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.baggage.deliveredAt(serial)).toBe(a.baggage.deliveredAt(serial));
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });
});

/** The cohort flag bits of an arrival that is done with immigration, as cohorts.ts sets them. */
const FLAG_PASSED = 64;

/** An international flight whose arrivals pass immigration, then fail to find their carousel and retry the claim walk. */
function retryingClaim(): { sim: Sim; c: number } {
  const sim = arrivalHall({ carousel: true });
  dockRoute(sim, true);
  const co = sim.cohorts;
  const grid = sim.business.grids[0]!.id;
  for (const c of arrivalSlots(sim)) {
    co.bags[c] = 1;
    co.recipeSeed[c] = seedWithReferral(false);
    co.profile[c] = ADULT;
  }
  // A carousel cell outside the hall: the claim walk finds no node, so the step retries on the wheel.
  co.bagLookup = {
    deliveredAt: () => -1,
    arrivalCarousel: (_serial, out) => {
      out[0] = grid;
      out[1] = -500;
      out[2] = -500;
      return true;
    },
  };
  for (let t = 0; t < 30000; t++) {
    sim.step();
    for (let c = 0; c < co.hi; c++) if (co.stage[c] === Stage.ToImmigration && co.flags[c]! & FLAG_PASSED) return { sim, c };
  }
  throw new Error('no cohort reached the retry');
}

describe('immigration retry is a wheel stage (T20 slice 7 review)', () => {
  it('leaves the queued stage and holds no node while it retries', () => {
    const { sim, c } = retryingClaim();
    expect(sim.cohorts.node[c]).toBe(-1);
    expect(sim.cohorts.stage[c]).toBe(Stage.ToImmigration);
  });

  it('demolishing the grid during the retry strands the cohort and leaves the free list intact', () => {
    const { sim } = retryingClaim();
    const co = sim.cohorts;
    run(sim, { type: 'demolishTerminal', id: sim.business.grids[0]!.id });
    expect(co.arrActive).toBe(0);
    expect(co.arrGenerated).toBe(co.arrExited + co.arrStranded);
    const seen = new Set<number>();
    for (let c = co.freeHead; c >= 0; c = co.next[c]!) {
      expect(seen.has(c)).toBe(false);
      seen.add(c);
      expect(co.stage[c]).toBe(Stage.Free);
    }
    for (let t = 0; t < 500; t++) sim.step();
    expect(co.arrActive).toBe(0);
  });

  it('renumbering the service table during the retry keeps the cohort node free and it strands at the limit', () => {
    const { sim, c } = retryingClaim();
    const co = sim.cohorts;
    const grid = sim.business.grids[0]!;
    // The check in desk has the lowest cell, so erasing it renumbers every node after it.
    const nodes = sim.business.serviceNodes[0]!.count;
    run(sim, { type: 'terminalBuild', building: grid.id, ox: grid.ox, oy: grid.oy, headingDeg: 90, edit: { op: 'erase', x0: 42, y0: 42, x1: 43, y1: 43, variant: 0 } });
    expect(sim.business.serviceNodes[0]!.count).toBe(nodes - 1);
    sim.step();
    expect(co.node[c]).toBe(-1);
    for (let t = 0; t < 30000 && co.arrActive > 0; t++) sim.step();
    expect(co.arrActive).toBe(0);
    expect(co.arrGenerated).toBe(co.arrExited + co.arrStranded);
    expect(co.arrStranded).toBeGreaterThan(0);
  });
});

/** Stages each slot passed through, in order, while the journey runs. */
function stageSequences(sim: Sim, ticks: number, each?: (t: number) => void): number[][] {
  const co = sim.cohorts;
  const seq: number[][] = Array.from({ length: co.cap }, () => []);
  for (let t = 0; t < ticks && co.arrActive > 0; t++) {
    sim.step();
    for (let c = 0; c < co.hi; c++) {
      const st = co.stage[c]!;
      const list = seq[c]!;
      if (st >= Stage.Deboard && list[list.length - 1] !== st) list.push(st);
    }
    each?.(t);
  }
  return seq;
}

/** A hall with a carousel and customs, an international airline flight on stand 0 and a domestic one on stand 1. */
function twoFlights(): Sim {
  const sim = arrivalHall({ carousel: true, customs: true });
  const market = sim.business.market;
  const dest = market.destinations.find((d) => d.international)!;
  market.series.push({ id: 9001, airline: 0, dest: dest.id, typeIdx: A320, days: 127, winMin: 0, startDay: 0, endDay: 100, standId: -1, minute: -1, turnMin: 30 });
  const t = sim.traffic;
  const intl = t.scheduleArrival(A320, t.nowTick + 1, 0, t.turnaroundTicks(A320), 0, 0, 9001);
  t.fStand[intl] = sim.airfield.data.stands[0]!.id;
  const home = t.scheduleArrival(A320, t.nowTick + 1, 0, t.turnaroundTicks(A320), 0);
  t.fStand[home] = sim.airfield.data.stands[1]!.id;
  return sim;
}

/** A recipe seed whose red channel draw is below (red) or above the customs share. */
function seedWithRed(red: boolean): number {
  for (let seed = 1; ; seed++) if ((traitU(seed, COHORT_DRAW.Red) < ARRIVALS.service.customs.redShare) === red) return seed;
}

describe('customs (T20 slice 8)', () => {
  it('international cohorts queue at customs after the claim and domestic ones never do', () => {
    const sim = arrivalHall({ carousel: true, customs: true });
    dockRoute(sim, true);
    const slots = arrivalSlots(sim);
    const seq = stageSequences(sim, 30000, () => undefined);
    for (const c of slots) {
      const list = seq[c]!;
      expect(list, `slot ${c}`).toContain(Stage.Customs);
      expect(list.indexOf(Stage.Customs), `slot ${c}`).toBeGreaterThan(list.indexOf(Stage.Immigration));
      if (list.includes(Stage.Claim)) expect(list.indexOf(Stage.Customs)).toBeGreaterThan(list.indexOf(Stage.Claim));
    }
    expect(sim.cohorts.arrExited).toBe(sim.cohorts.arrGenerated);

    const home = arrivalHall({ carousel: true, customs: true });
    dockRoute(home, false);
    const homeSeq = stageSequences(home, 30000);
    for (let c = 0; c < home.cohorts.cap; c++) {
      expect(homeSeq[c]).not.toContain(Stage.Customs);
      expect(homeSeq[c]).not.toContain(Stage.ToCustoms);
    }
  }, 30000);

  it('draws the red channel for about 5 percent of 2000 seeds and a red cohort stands 120 game seconds', () => {
    let red = 0;
    for (let i = 1; i <= 2000; i++) if (traitU(Math.imul(i, 2654435761) >>> 0, COHORT_DRAW.Red) < ARRIVALS.service.customs.redShare) red++;
    expect(Math.abs(red / 2000 - ARRIVALS.service.customs.redShare)).toBeLessThan(0.02);

    const sim = arrivalHall({ carousel: true, customs: true });
    dockRoute(sim, true);
    const co = sim.cohorts;
    const slots = arrivalSlots(sim);
    for (const c of slots) {
      co.recipeSeed[c] = seedWithRed(c === slots[0]);
      co.bags[c] = 0;
    }
    let from = -1;
    let to = -1;
    for (let t = 0; t < 30000 && to < 0; t++) {
      sim.step();
      if (from < 0 && co.stage[slots[0]!] === Stage.CustomsRed) from = sim.tick;
      if (from >= 0 && co.stage[slots[0]!] === Stage.ToExit) to = sim.tick;
    }
    expect(from).toBeGreaterThanOrEqual(0);
    const stood = gameSecondsToTicks(ARRIVALS.service.customs.redServiceSeconds);
    expect(to - from).toBeGreaterThanOrEqual(stood);
    expect(to - from).toBeLessThanOrEqual(stood + 10);
  }, 30000);

  it('with no customs fixture the international cohorts exit straight after the claim', () => {
    const sim = arrivalHall({ carousel: true });
    dockRoute(sim, true);
    const seq = stageSequences(sim, 30000);
    for (const list of seq) {
      expect(list).not.toContain(Stage.Customs);
      expect(list).not.toContain(Stage.ToCustoms);
    }
    expect(sim.cohorts.arrExited).toBe(sim.cohorts.arrGenerated);
  }, 30000);

  it('two sims from one seed with both flights stay equal, pass immigration, claim and customs, and conserve over 8000 ticks', () => {
    const a = twoFlights();
    const b = twoFlights();
    const seen = new Set<number>();
    for (let t = 0; t < 8000; t++) {
      a.step();
      b.step();
      for (let c = 0; c < a.cohorts.hi; c++) seen.add(a.cohorts.stage[c]!);
      if (t % 50 === 0) {
        const co = a.cohorts;
        expect(co.arrGenerated).toBe(co.arrExited + co.arrStranded + co.arrActive);
        expect(co.generated).toBe(co.boarded + co.missed + co.active);
      }
    }
    expect(b.stateHash()).toBe(a.stateHash());
    for (const st of [Stage.Immigration, Stage.Claim, Stage.Customs]) expect(seen.has(st), `stage ${st}`).toBe(true);
    expect(a.cohorts.arrGenerated).toBeGreaterThan(0);
  }, 30000);

  it('restores a save with a cohort queued at immigration and one waiting at claim to the same hash 2000 ticks later', () => {
    const a = twoFlights();
    const co = a.cohorts;
    let found = false;
    for (let t = 0; t < 20000 && !found; t++) {
      a.step();
      let queued = false;
      let claiming = false;
      for (let c = 0; c < co.hi; c++) {
        if (co.stage[c] === Stage.Immigration) queued = true;
        if (co.stage[c] === Stage.Claim) claiming = true;
      }
      found = queued && claiming;
    }
    expect(found).toBe(true);
    const b = new Sim('GOLDEN-0001', OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  }, 30000);
});
