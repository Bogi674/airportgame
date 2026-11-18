import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { GSE_INDEX, STAND_ACCESS, TURNAROUNDS } from '@data/index';
import { STAND_UPGRADE, type Stand } from '@shared/airfield';
import { fixtureKey } from '@shared/business';
import { VEHICLE_CAUSE } from '@shared/turnaround';
import { Stage } from '@sim/cohorts/cohorts';
import { AcState } from '@sim/ops/traffic';
import { Turnarounds } from '@sim/ops/turnaround';
import { Sim } from '@sim/sim';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run } from './helpers';

/** Gate desk assignment and far stand boarding (T66 slice 3). */

const A320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');
const BOARD = TURNAROUNDS.tasks.findIndex((t) => t.id === 'board');
const TASKS = Turnarounds.taskCount;

interface Desk {
  x: number;
  y: number;
}

/** Logical cells of the gate desk anchors of the first terminal, in cell order. */
function desks(sim: Sim): Desk[] {
  const sn = sim.business.serviceNodes[0];
  const out: Desk[] = [];
  for (let n = 0; n < sn.count; n++) if (fixtureKey(sn.kind[n]) === 'gateDesk') out.push({ x: sn.lx[n], y: sn.ly[n] });
  return out;
}

/** An airport with a terminal that has gate desks. A terminal placed south of the stands is far from them. */
function airport(at?: { x: number; y: number }): Sim {
  const sim = ownedSim();
  sim.cash = 80_000_000;
  buildTestAirport(sim, { standsPerRow: 4 });
  expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 4, at })).toEqual([]);
  return sim;
}

function distanceToGate(sim: Sim, s: Stand): number {
  const d = sim.business.gateFor(s);
  return d ? Math.hypot(d.wx - s.x, d.wy - s.y) : -1;
}

/** Docks an airline flight on a stand and steps until its task list has started. Returns the flight and aircraft slot. */
function dock(sim: Sim, stand: Stand, inTicks = 1): { f: number; a: number } {
  const f = sim.traffic.scheduleArrival(A320, sim.tick + inTicks, 0, sim.traffic.turnaroundTicks(A320), 0);
  expect(run(sim, { type: 'assignStand', flight: f, standId: stand.id })).toEqual([]);
  for (let t = 0; t < 40000; t++) {
    sim.step();
    const a = sim.traffic.fAc[f];
    if (a >= 0 && sim.turns.flightOf[a] === f) return { f, a };
  }
  throw new Error('flight never started its tasks');
}

describe('setStandGate', () => {
  it('accepts a gate desk cell, refuses another cell, and clears with building -1', () => {
    const sim = airport();
    const stand = sim.airfield.data.stands[0];
    const grid = sim.business.grids[0];
    const d = desks(sim)[0];
    expect(d).toBeDefined();
    expect(run(sim, { type: 'setStandGate', id: stand.id, building: grid.id, x: d.x, y: d.y })).toEqual([]);
    expect(stand.gate).toEqual({ building: grid.id, x: d.x, y: d.y });
    expect(run(sim, { type: 'setStandGate', id: stand.id, building: grid.id, x: 41, y: 41 })).toEqual(['notGateDesk']);
    expect(run(sim, { type: 'setStandGate', id: stand.id, building: 999, x: d.x, y: d.y })).toEqual(['notGateDesk']);
    expect(stand.gate).toEqual({ building: grid.id, x: d.x, y: d.y });
    expect(run(sim, { type: 'setStandGate', id: stand.id, building: -1, x: 0, y: 0 })).toEqual([]);
    expect(stand.gate).toBeUndefined();
  });

  it('a removed desk falls back to the nearest desk', () => {
    const sim = airport();
    const stand = sim.airfield.data.stands[0];
    const grid = sim.business.grids[0];
    const [a, b] = desks(sim);
    expect(b).toBeDefined();
    const nearest = sim.business.gateFor({ x: stand.x, y: stand.y });
    expect(nearest).not.toBeNull();
    // Assign the desk that is not the nearest one, then erase it.
    const other = nearest && nearest.x === a.x && nearest.y === a.y ? b : a;
    run(sim, { type: 'setStandGate', id: stand.id, building: grid.id, x: other.x, y: other.y });
    expect(sim.business.gateFor(stand)).toMatchObject({ x: other.x, y: other.y });
    run(sim, { type: 'terminalBuild', building: grid.id, ox: grid.ox, oy: grid.oy, headingDeg: grid.headingDeg, edit: { op: 'erase', x0: other.x, y0: other.y, x1: other.x + 1, y1: other.y + 1, variant: 0 } });
    expect(desks(sim).some((d) => d.x === other.x && d.y === other.y)).toBe(false);
    const fallback = sim.business.gateFor(stand);
    expect(fallback).not.toBeNull();
    expect(fallback && (fallback.x !== other.x || fallback.y !== other.y)).toBe(true);
    expect(sim.business.assignedGate(stand.id)).toBeNull();
  });
});

describe('cohorts board at the assigned desk', () => {
  it('walk to the assigned desk while another desk is nearer', () => {
    const sim = airport();
    const grid = sim.business.grids[0];
    const [a, b] = desks(sim);
    expect(b).toBeDefined();
    const stand = sim.airfield.data.stands[0];
    const nearest = sim.business.gateFor({ x: stand.x, y: stand.y });
    const far = nearest && nearest.x === a.x && nearest.y === a.y ? b : a;
    run(sim, { type: 'setStandGate', id: stand.id, building: grid.id, x: far.x, y: far.y });
    const f = sim.traffic.scheduleArrival(A320, sim.tick + 100, 0, 6000, -1);
    run(sim, { type: 'assignStand', flight: f, standId: stand.id });
    let seen = 0;
    for (let t = 0; t < 60000 && seen < 3; t++) {
      sim.step();
      if (t % 10 !== 0) continue;
      const co = sim.cohorts;
      const sn = sim.business.serviceNodes[0];
      for (let c = 0; c < co.hi; c++) {
        if (co.flight[c] !== f || (co.stage[c] !== Stage.ToGate && co.stage[c] !== Stage.Gate) || co.node[c] < 0) continue;
        expect({ x: sn.lx[co.node[c]], y: sn.ly[co.node[c]] }).toEqual(far);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, 120000);
});

describe('far stand boarding', () => {
  const FAR = { x: 3960, y: 5900 };

  it('a far stand with a bus bay waits for a bus with the bus cause and boards once one is owned', () => {
    const sim = airport(FAR);
    const stand = sim.airfield.data.stands[0];
    stand.upgrades = STAND_UPGRADE.busBay;
    expect(distanceToGate(sim, stand)).toBeGreaterThan(STAND_ACCESS.stairsWalkLimitM);
    sim.business.fleet[GSE_INDEX.bus] = 0;
    const { f, a } = dock(sim, stand);
    const plan = sim.traffic.timer[a];
    for (let t = 0; t < plan + 3000; t++) sim.step();
    expect(sim.traffic.state[a]).toBe(AcState.Turnaround);
    expect(sim.traffic.fCause[f]).toBe(VEHICLE_CAUSE + GSE_INDEX.bus);
    sim.business.fleet[GSE_INDEX.bus] = 1;
    for (let t = 0; t < 20000 && sim.traffic.state[a] === AcState.Turnaround && sim.traffic.fAc[f] === a; t++) sim.step();
    expect(sim.turns.phase[a * TASKS + BOARD]).toBe(3);
  }, 120000);

  it('a far stand without a bus bay boards slower and raises the alert once per day', () => {
    const near = airport();
    const nearStand = near.airfield.data.stands[0];
    expect(distanceToGate(near, nearStand)).toBeLessThanOrEqual(STAND_ACCESS.stairsWalkLimitM);
    const nearRun = dock(near, nearStand);
    const base = near.turns.left[nearRun.a * TASKS + BOARD];
    expect(base).toBe(Math.round(TURNAROUNDS.tasks[BOARD].share * near.traffic.timer[nearRun.a]));

    const sim = airport(FAR);
    const stand = sim.airfield.data.stands[0];
    expect(distanceToGate(sim, stand)).toBeGreaterThan(STAND_ACCESS.stairsWalkLimitM);
    const events: string[] = [];
    const first = dock(sim, stand);
    sim.drainEvents(events);
    const plan = sim.traffic.timer[first.a];
    expect(sim.turns.left[first.a * TASKS + BOARD]).toBe(Math.round(TURNAROUNDS.tasks[BOARD].share * (1 + STAND_ACCESS.farBoardingSlowdown) * plan));
    expect(sim.turns.left[first.a * TASKS + BOARD]).toBeGreaterThan(Math.round(TURNAROUNDS.tasks[BOARD].share * plan));
    for (let t = 0; t < 30000 && sim.traffic.fAc[first.f] >= 0; t++) sim.step();
    dock(sim, stand, 1000);
    sim.drainEvents(events);
    expect(events.filter((e) => e.startsWith('standNeedsBusBay'))).toEqual([`standNeedsBusBay|stand=${stand.number}`]);
  }, 240000);

  it('a stand with no gate desk at all boards as before', () => {
    const sim = ownedSim();
    sim.cash = 80_000_000;
    buildTestAirport(sim, { standsPerRow: 4 });
    const stand = sim.airfield.data.stands[0];
    expect(sim.business.gateFor(stand)).toBeNull();
    const { a } = dock(sim, stand);
    expect(sim.turns.left[a * TASKS + BOARD]).toBe(Math.round(TURNAROUNDS.tasks[BOARD].share * sim.traffic.timer[a]));
  }, 120000);
});

describe('stand gate saves and determinism', () => {
  it('a save with an assignment restores to the same hash', () => {
    const a = airport();
    const stand = a.airfield.data.stands[0];
    const grid = a.business.grids[0];
    const d = desks(a)[1];
    const before = a.stateHash();
    run(a, { type: 'setStandGate', id: stand.id, building: grid.id, x: d.x, y: d.y });
    expect(a.stateHash()).not.toBe(before);
    for (let t = 0; t < 200; t++) a.step();
    const b = new Sim('GOLDEN-0001', OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.airfield.data.stands[0].gate).toEqual(stand.gate);
    expect(b.stateHash()).toBe(a.stateHash());
  }, 120000);

  it('runs deterministically for 2000 ticks with assignments and a far stand', () => {
    const go = (): string => {
      const sim = airport({ x: 3960, y: 5900 });
      const grid = sim.business.grids[0];
      const d = desks(sim)[0];
      for (const s of sim.airfield.data.stands) run(sim, { type: 'setStandGate', id: s.id, building: grid.id, x: d.x, y: d.y });
      for (let n = 0; n < 3; n++) sim.traffic.scheduleArrival(A320, sim.tick + 1 + n * 600, 0, sim.traffic.turnaroundTicks(A320), 0);
      for (let t = 0; t < 2000; t++) sim.step();
      return String(sim.stateHash());
    };
    expect(go()).toBe(go());
  }, 120000);
});
