import { describe, expect, it } from 'vitest';
import { AIRCRAFT, standGeometry } from '@data/aircraft';
import { ARRIVALS } from '@data/index';
import { Sim } from '@sim/sim';
import { DAY, Stage } from '@sim/cohorts/cohorts';
import { TICKS_PER_MINUTE } from '@shared/business';
import { gameSecondsToTicks } from '@shared/time';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run, type TerminalOptions } from './helpers';

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
