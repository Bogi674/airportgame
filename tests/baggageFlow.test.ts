import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { BAGGAGE, TURNAROUNDS } from '@data/index';
import { AcState } from '@sim/ops/traffic';
import { Turnarounds } from '@sim/ops/turnaround';
import { Sim } from '@sim/sim';
import { TICKS_PER_MINUTE, WALL } from '../src/shared/business';
import { CAUSE_BAGS } from '../src/shared/turnaround';
import { cellIndex, hEdgeIndex, originFor, vEdgeIndex } from '../src/shared/terminalOps';
import { buildTestAirport, ownedSim, OPTIONS, run } from './helpers';

const { ox, oy } = originFor(3960, 5440, 90);
const A320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');
const UNLOAD = TURNAROUNDS.tasks.findIndex((t) => t.id === 'unload');
/** Task phase 2 in ops/turnaround.ts, a task that is running. */
const RUNNING = 2;

interface Flow {
  sim: Sim;
  building: number;
  bay: number;
  /** Array cell index of the check in anchor at logical (60, 41). */
  anchor: number;
}

type Edit = { op: 'foundation' | 'floor' | 'zone' | 'fixture' | 'erase'; x0: number; y0: number; x1: number; y1: number; variant: number };

/**
 * A hall with a check in desk, a closed staff room with a door for the machine, a carousel and a bay on the south wall,
 * the bay serving the first stand. With `openMachine` the machine stands in the public hall, so no screening room is valid.
 */
function flow(o: { machine?: 'room' | 'open' | 'none'; secondBay?: boolean } = {}): Flow {
  const sim = ownedSim();
  buildTestAirport(sim);
  const edit = (building: number, e: Edit): string[] => run(sim, { type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e });
  expect(edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 70, y1: 53, variant: 0 })).toEqual([]);
  const building = sim.business.grids[0].id;
  expect(edit(building, { op: 'floor', x0: 40, y0: 40, x1: 70, y1: 53, variant: 2 })).toEqual([]);
  expect(edit(building, { op: 'zone', x0: 40, y0: 46, x1: 60, y1: 53, variant: 4 })).toEqual([]);
  const g = sim.business.grids[0];
  for (let x = 41; x <= 45; x++) {
    g.hWall[hEdgeIndex(g, x, 47)] = WALL.Wall;
    g.hWall[hEdgeIndex(g, x, 50)] = x === 43 ? WALL.Door : WALL.Wall;
  }
  for (let y = 47; y <= 49; y++) {
    g.vWall[vEdgeIndex(g, 41, y)] = WALL.Wall;
    g.vWall[vEdgeIndex(g, 46, y)] = WALL.Wall;
  }
  for (let x = 50; x <= 57; x++) g.hWall[hEdgeIndex(g, x, 53)] = WALL.Wall;
  expect(edit(building, { op: 'fixture', x0: 60, y0: 41, x1: 61, y1: 42, variant: 1 })).toEqual([]);
  const place = (kind: 'machine' | 'bay' | 'carousel', cx: number, cy: number): void => {
    expect(run(sim, { type: 'placeBaggageNode', building, kind, cx, cy, rot: 0, widthCells: 4 })).toEqual([]);
  };
  const machine = o.machine ?? 'room';
  if (machine === 'room') place('machine', 42, 48);
  if (machine === 'open') place('machine', 56, 44);
  place('carousel', 42, 42);
  place('bay', 50, 49);
  if (o.secondBay) place('bay', 54, 49);
  const bays = sim.baggage.nodesOf(building).filter((r) => r.kind === 'bay');
  const stands = sim.airfield.data.stands;
  expect(run(sim, { type: 'setStandBay', standId: stands[0].id, bayId: bays[0].id })).toEqual([]);
  if (o.secondBay) expect(run(sim, { type: 'setStandBay', standId: stands[1].id, bayId: bays[1].id })).toEqual([]);
  return { sim, building, bay: bays[0].id, anchor: cellIndex(g, 60, 41) };
}

/** An airline flight due now, parked on the stand with the given index. */
function flight(l: Flow, standIndex = 0): number {
  const t = l.sim.traffic;
  const f = t.scheduleArrival(A320, l.sim.tick + 1, 0, t.turnaroundTicks(A320), 0);
  t.fStand[f] = l.sim.airfield.data.stands[standIndex].id;
  return f;
}

const checkIn = (l: Flow, f: number, bags: number): void => l.sim.baggage.checkIn(l.building, l.anchor, l.sim.traffic.serialOf(f), bags);

const inSystem = (l: Flow, serial: number): number => [1, 2, 3, 4, 5].reduce((n, s) => n + l.sim.baggage.bagsOf(serial, s), 0);

/** Steps until the flight's aircraft is in its turnaround, and returns the aircraft slot. */
function untilDocked(sim: Sim, f: number): number {
  for (let t = 0; t < 40000; t++) {
    sim.step();
    const a = sim.traffic.fAc[f];
    if (a >= 0 && sim.traffic.state[a] === AcState.Turnaround) return a;
  }
  throw new Error('flight never docked');
}

describe('departure bag flow (T43)', () => {
  it('delivers a flight\'s bags to its bay, conserves the count and lets loading proceed', () => {
    const l = flow();
    const f = flight(l);
    const serial = l.sim.traffic.serialOf(f);
    checkIn(l, f, 3);
    checkIn(l, f, 2);
    expect(l.sim.baggage.checkedToday).toBe(5);
    let reached = -1;
    for (let t = 0; t < 1500 && reached < 0; t++) {
      l.sim.step();
      expect(inSystem(l, serial) + l.sim.baggage.missingToday + l.sim.baggage.loadedTotal).toBe(5);
      if (l.sim.baggage.bagsOf(serial, 5) === 5) reached = l.sim.baggage.bayOfBags(serial);
    }
    expect(reached).toBe(l.bay);
    const a = untilDocked(l.sim, f);
    let cause = 0;
    for (let t = 0; t < 12000 && l.sim.traffic.state[a] === AcState.Turnaround; t++) {
      l.sim.step();
      cause = l.sim.traffic.fCause[f] === CAUSE_BAGS ? CAUSE_BAGS : cause;
    }
    expect(l.sim.traffic.state[a]).not.toBe(AcState.Turnaround);
    expect(cause).toBe(0);
    expect(l.sim.baggage.loadedTotal).toBe(5);
    expect(l.sim.baggage.missingToday).toBe(0);
    expect(l.sim.baggage.batchCount).toBe(0);
  });

  it('counts the bags missing at once when the drop point has no machine', () => {
    const l = flow({ machine: 'none' });
    const f = flight(l);
    checkIn(l, f, 5);
    expect(l.sim.baggage.batchCount).toBe(0);
    expect(l.sim.baggage.missingToday).toBe(5);
    expect(l.sim.baggage.missingFor(l.sim.traffic.serialOf(f))).toBe(5);
    expect(l.sim.baggage.checkedToday).toBe(5);
  });

  it('halts a machine in an invalid screening room, holds the load task, and counts the bags missing after the hold', () => {
    const l = flow({ machine: 'open' });
    const f = flight(l);
    const serial = l.sim.traffic.serialOf(f);
    checkIn(l, f, 4);
    const a = untilDocked(l.sim, f);
    const departAt = l.sim.traffic.fEta[f] + l.sim.traffic.fTurn[f];
    const holdEnd = departAt + Math.round(BAGGAGE.lateBagHoldMin * TICKS_PER_MINUTE);
    let held = false;
    for (let t = 0; t < 30000 && l.sim.traffic.state[a] === AcState.Turnaround; t++) {
      l.sim.step();
      if (l.sim.tick < holdEnd) expect(l.sim.baggage.bagsOf(serial, 5)).toBe(0);
      if (l.sim.turns.lastBlock[a] === CAUSE_BAGS) held = true;
    }
    expect(held).toBe(true);
    expect(l.sim.traffic.state[a]).not.toBe(AcState.Turnaround);
    expect(l.sim.tick).toBeGreaterThanOrEqual(holdEnd);
    expect(l.sim.baggage.missingToday).toBe(4);
    expect(l.sim.baggage.loadedTotal).toBe(0);
    expect(l.sim.baggage.batchCount).toBe(0);
  });

  it('holds the load task for a late batch, then loads it once it reaches the bay', () => {
    const l = flow();
    const f = flight(l);
    const serial = l.sim.traffic.serialOf(f);
    const a = untilDocked(l.sim, f);
    const unload = a * Turnarounds.taskCount + UNLOAD;
    for (let t = 0; t < 4000 && !(l.sim.turns.phase[unload] === RUNNING && l.sim.turns.left[unload] <= 40); t++) l.sim.step();
    checkIn(l, f, 3);
    let held = false;
    for (let t = 0; t < 12000 && l.sim.traffic.state[a] === AcState.Turnaround; t++) {
      l.sim.step();
      if (l.sim.turns.lastBlock[a] === CAUSE_BAGS && l.sim.baggage.bagsOf(serial, 5) === 0) held = true;
    }
    expect(held).toBe(true);
    expect(l.sim.baggage.loadedTotal).toBe(3);
    expect(l.sim.baggage.missingToday).toBe(0);
  });

  it('blocks the drop point and its desk when the machine is saturated', () => {
    const l = flow({ machine: 'open' });
    const f = flight(l);
    const serial = l.sim.traffic.serialOf(f);
    for (let k = 0; k < 10; k++) checkIn(l, f, 5);
    for (let t = 0; t < 200; t++) l.sim.step();
    expect(l.sim.baggage.dropBlocked(l.building, l.anchor)).toBe(false);
    for (let k = 0; k < 8; k++) checkIn(l, f, 5);
    for (let t = 0; t < 20; t++) l.sim.step();
    expect(l.sim.baggage.bagsOf(serial, 1)).toBeGreaterThan(BAGGAGE.dropPoint.bufferBags);
    expect(l.sim.baggage.dropBlocked(l.building, l.anchor)).toBe(true);
    const table = l.sim.business.serviceTable(l.building);
    if (!table) throw new Error('no service table');
    expect(table.blocked.some((v) => v === 1)).toBe(true);
  });

  it('delivers a batch only to the bay of its own flight\'s stand', () => {
    const l = flow({ secondBay: true });
    const a = flight(l, 0);
    const b = flight(l, 1);
    const bays = l.sim.baggage.nodesOf(l.building).filter((r) => r.kind === 'bay');
    checkIn(l, a, 3);
    checkIn(l, b, 4);
    checkIn(l, a, 2);
    const serialA = l.sim.traffic.serialOf(a);
    const serialB = l.sim.traffic.serialOf(b);
    for (let t = 0; t < 1500 && !(l.sim.baggage.bagsOf(serialA, 5) === 5 && l.sim.baggage.bagsOf(serialB, 5) === 4); t++) l.sim.step();
    expect(l.sim.baggage.bagsOf(serialA, 5)).toBe(5);
    expect(l.sim.baggage.bagsOf(serialB, 5)).toBe(4);
    expect(l.sim.baggage.bayOfBags(serialA)).toBe(bays[0].id);
    expect(l.sim.baggage.bayOfBags(serialB)).toBe(bays[1].id);
  });

  it('restores to the same hash after a save in the middle of the flow', () => {
    const l = flow();
    const f = flight(l);
    checkIn(l, f, 3);
    checkIn(l, f, 4);
    for (let t = 0; t < 40; t++) l.sim.step();
    expect(l.sim.baggage.batchCount).toBeGreaterThan(0);
    const data = JSON.parse(JSON.stringify(l.sim.serialize())) as unknown;
    const copy = new Sim('GOLDEN-0001', OPTIONS);
    copy.restore(data);
    expect(copy.stateHash()).toBe(l.sim.stateHash());
    for (let t = 0; t < 600; t++) {
      l.sim.step();
      copy.step();
    }
    expect(copy.stateHash()).toBe(l.sim.stateHash());
    expect(copy.baggage.saveState()).toEqual(l.sim.baggage.saveState());
  });

  it('is deterministic over 2000 ticks', () => {
    const hashes = [0, 1].map(() => {
      const l = flow();
      const f = flight(l);
      checkIn(l, f, 6);
      for (let t = 0; t < 2000; t++) {
        if (t === 700) checkIn(l, f, 2);
        l.sim.step();
      }
      return l.sim.stateHash();
    });
    expect(hashes[0]).toBe(hashes[1]);
  });
});
