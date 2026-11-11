import { describe, expect, it } from 'vitest';
import { FIXTURE_KEYS, FIXTURE_SPAN, WALL, type FixtureKey, type TerminalGrid } from '../src/shared/business';
import { cellIndex, ensureCells, hEdgeIndex, newGrid, vEdgeIndex } from '../src/shared/terminalOps';
import { buildServiceNodes, serviceJoin, serviceUpdate, serviceWait, type ServiceNodes } from '../src/sim/terminal/serviceNodes';
import { buildWalkGraph } from '../src/sim/terminal/walkGraph';
import { Rng } from '../src/sim/rng';

/** A grid with logical cells from (0, 0) to (w, h), rounded to whole chunks by ensureCells. */
function handGrid(w: number, h: number): TerminalGrid {
  const g = newGrid(1, 0, 0, 0);
  ensureCells(g, 0, 0, w, h);
  return g;
}

/** Puts a fixture at (x, y). Two cell fixtures get a tail at (x + 1, y), rot 0. */
function placeFixture(g: TerminalGrid, x: number, y: number, key: FixtureKey): void {
  const id = FIXTURE_KEYS.indexOf(key) + 1;
  const a = cellIndex(g, x, y);
  g.fixture[a] = id;
  if (FIXTURE_SPAN[key] === 2) {
    const t = cellIndex(g, x + 1, y);
    g.fixtureRot[a] = 1;
    g.fixture[t] = id;
    g.fixtureRot[t] = 5;
  }
}

/** Nodes of an open w by h floor with the given fixtures. */
function placedNodes(w: number, h: number, placements: [FixtureKey, number, number][]): ServiceNodes {
  const g = handGrid(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g.floor[cellIndex(g, x, y)] = 1;
  for (const [key, x, y] of placements) placeFixture(g, x, y, key);
  return buildServiceNodes(g, buildWalkGraph(g));
}

/** Nodes of a 20 by 20 open room with one fixture at its centre. Its queue cap is 160 people. */
const singleNodes = (key: FixtureKey): ServiceNodes => placedNodes(20, 20, [[key, 10, 10]]);

/** The service stream of a seed, as the sim forks it. */
const rngFor = (seed: number): Rng => new Rng(seed).fork('service');

/**
 * Keeps one node saturated: each update call, the node takes cohorts of `size` until the queue refuses. Sums the
 * people finished. sizeOf maps cohort id to size so finished cohorts can be counted.
 */
function saturate(sn: ServiceNodes, node: number, size: number, ticks: number, every: number, rng: Rng): number {
  const sizeOf: number[] = [];
  let done = 0;
  let next = 0;
  for (let t = 0; t <= ticks; t += every) {
    serviceUpdate(sn, t, rng);
    for (let d = 0; d < sn.doneCount; d++) done += sizeOf[sn.doneCohort[d]!]!;
    for (;;) {
      sizeOf[next] = size;
      if (!serviceJoin(sn, node, next, size)) break;
      next++;
    }
  }
  return done;
}

describe('service queue saturation', () => {
  it('a security lane of single people finishes about 300 an hour', () => {
    const sn = singleNodes('security');
    const done = saturate(sn, 0, 1, 36000, 10, rngFor(1));
    expect(done).toBeGreaterThanOrEqual(270);
    expect(done).toBeLessThanOrEqual(330);
  });

  it('a security lane of cohorts of 5 finishes about 300 an hour over four hours', () => {
    const sn = singleNodes('security');
    const hours = 4;
    const done = saturate(sn, 0, 5, 36000 * hours, 10, rngFor(2));
    const perHour = done / hours;
    expect(perHour).toBeGreaterThanOrEqual(270);
    expect(perHour).toBeLessThanOrEqual(330);
  });

  it('a toilet block of 6 servers finishes about 240 people an hour', () => {
    const sn = singleNodes('toilet');
    const done = saturate(sn, 0, 6, 36000, 10, rngFor(3));
    expect(done).toBeGreaterThanOrEqual(216);
    expect(done).toBeLessThanOrEqual(264);
  });
});

describe('service queue join', () => {
  it('refuses once the queue cap is reached, and an empty queue takes any size', () => {
    const sn = singleNodes('checkIn');
    let accepted = 0;
    for (let i = 0; i < 40; i++) if (serviceJoin(sn, 0, i, 10)) accepted++;
    expect(accepted).toBe(16);
    expect(sn.queueLen[0]).toBe(160);
  });

  it('only the first cohort may exceed the queue cap', () => {
    const sn = singleNodes('checkIn');
    expect(serviceJoin(sn, 0, 0, 200)).toBe(true);
    expect(sn.queueLen[0]).toBeGreaterThan(sn.queueCap[0]!);
    expect(serviceJoin(sn, 0, 1, 1)).toBe(false);
  });

  it('the ring of slots refuses a cohort past its size', () => {
    const sn = singleNodes('checkIn');
    let accepted = 0;
    for (let i = 0; i < 40; i++) if (serviceJoin(sn, 0, i, 1)) accepted++;
    expect(accepted).toBe(sn.slots);
    expect(sn.queueLen[0]).toBeLessThanOrEqual(sn.queueCap[0]!);
  });

  it('a join succeeds again once a service completes and frees the queue', () => {
    const sn = singleNodes('checkIn');
    const rng = rngFor(4);
    for (let i = 0; i < 16; i++) serviceJoin(sn, 0, i, 10);
    expect(serviceJoin(sn, 0, 99, 10)).toBe(false);
    serviceUpdate(sn, 0, rng);
    serviceUpdate(sn, sn.busyUntil[0]!, rng);
    expect(sn.doneCount).toBe(1);
    expect(serviceJoin(sn, 0, 99, 10)).toBe(true);
  });

  it('a node with no queue cap refuses everyone', () => {
    const g = handGrid(20, 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) g.floor[cellIndex(g, x, y)] = 1;
    placeFixture(g, 10, 10, 'checkIn');
    const wall = (x: number, y: number) => {
      g.vWall[vEdgeIndex(g, x, y)] = WALL.Wall;
    };
    wall(10, 10);
    wall(11, 10);
    g.hWall[hEdgeIndex(g, 10, 10)] = WALL.Wall;
    g.hWall[hEdgeIndex(g, 10, 11)] = WALL.Wall;
    const sn = buildServiceNodes(g, buildWalkGraph(g));
    expect(sn.queueCap[0]).toBe(0);
    expect(serviceJoin(sn, 0, 0, 1)).toBe(false);
  });

  it('a bad node or an empty cohort is refused', () => {
    const sn = singleNodes('checkIn');
    expect(serviceJoin(sn, -1, 0, 1)).toBe(false);
    expect(serviceJoin(sn, 1, 0, 1)).toBe(false);
    expect(serviceJoin(sn, 0, 0, 0)).toBe(false);
    expect(sn.active).toBe(0);
  });
});

describe('service queue order and wait', () => {
  it('finishes cohorts in the order they joined', () => {
    const sn = singleNodes('checkIn');
    const rng = rngFor(5);
    for (let i = 0; i < 5; i++) expect(serviceJoin(sn, 0, i, 1)).toBe(true);
    const order: number[] = [];
    for (let t = 0; sn.active > 0 && t < 100000; t += 10) {
      serviceUpdate(sn, t, rng);
      for (let d = 0; d < sn.doneCount; d++) order.push(sn.doneCohort[d]!);
    }
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('wait is zero on an idle empty node and grows by size times mean service per joined cohort', () => {
    const sn = singleNodes('security');
    expect(serviceWait(sn, 0, 0)).toBe(0);
    serviceJoin(sn, 0, 0, 2);
    expect(serviceWait(sn, 0, 0)).toBeCloseTo((2 * 12) / 1, 6);
    serviceJoin(sn, 0, 1, 3);
    expect(serviceWait(sn, 0, 0)).toBeCloseTo((5 * 12) / 1, 6);
  });

  it('wait falls as a serving cohort uses up its time', () => {
    const sn = singleNodes('security');
    const rng = rngFor(6);
    serviceJoin(sn, 0, 0, 2);
    serviceJoin(sn, 0, 1, 3);
    serviceUpdate(sn, 0, rng);
    expect(sn.serving[0]).toBe(0);
    const early = serviceWait(sn, 0, 0);
    const later = serviceWait(sn, 0, 50);
    expect(later).toBeLessThan(early);
    expect(later).toBeCloseTo(Math.max(0, sn.busyUntil[0]! - 50) / 10 + 3 * 12, 6);
  });

  it('wait is infinity for a node out of range', () => {
    const sn = singleNodes('security');
    expect(serviceWait(sn, 3, 0)).toBe(Infinity);
    expect(serviceWait(sn, -1, 0)).toBe(Infinity);
  });
});

describe('service queue determinism and drain', () => {
  /** Four mixed nodes on one floor, a join script over 6000 ticks, and the done list as (cohort, node, tick). */
  function script(seed: number) {
    const sn = placedNodes(40, 20, [
      ['checkIn', 5, 10],
      ['kiosk', 15, 10],
      ['passport', 25, 10],
      ['toilet', 35, 10],
    ]);
    const rng = rngFor(seed);
    const done: number[] = [];
    let next = 0;
    for (let t = 0; t <= 6000; t += 10) {
      serviceUpdate(sn, t, rng);
      for (let d = 0; d < sn.doneCount; d++) done.push(sn.doneCohort[d]!, sn.doneNode[d]!, t);
      for (let n = 0; n < sn.count; n++) {
        const size = 1 + ((t / 10 + n) % 3);
        if (serviceJoin(sn, n, next, size)) next++;
      }
    }
    return { done, queueLen: Array.from(sn.queueLen), busyUntil: Array.from(sn.busyUntil), serving: Array.from(sn.serving), active: sn.active };
  }

  it('the same seed and script give identical done sequences and final arrays', () => {
    const a = script(11);
    const b = script(11);
    expect(a.done.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it('a different seed gives a different done sequence', () => {
    expect(script(11).done).not.toEqual(script(12).done);
  });

  it('active returns to zero once everything drains', () => {
    const sn = placedNodes(40, 20, [
      ['checkIn', 5, 10],
      ['passport', 25, 10],
    ]);
    const rng = rngFor(8);
    for (let i = 0; i < 6; i++) serviceJoin(sn, i % 2, i, 2);
    for (let t = 0; sn.active > 0 && t < 100000; t += 10) serviceUpdate(sn, t, rng);
    expect(sn.active).toBe(0);
    expect(Array.from(sn.queueLen).every((q) => q === 0)).toBe(true);
  });

  it('an update with nothing active draws nothing from the stream', () => {
    const sn = singleNodes('checkIn');
    const drawn = rngFor(7);
    const untouched = rngFor(7);
    serviceUpdate(sn, 100, drawn);
    expect(drawn.next()).toBe(untouched.next());
  });

  it('a gate desk chain finishes every cohort, at most 16 per call', () => {
    const sn = singleNodes('gateDesk');
    const rng = rngFor(9);
    for (let i = 0; i < 20; i++) expect(serviceJoin(sn, 0, i, 1)).toBe(true);
    serviceUpdate(sn, 0, rng);
    serviceUpdate(sn, 10000, rng);
    expect(sn.doneCount).toBe(16);
    let total = sn.doneCount;
    serviceUpdate(sn, 10001, rng);
    total += sn.doneCount;
    expect(total).toBe(20);
    expect(sn.active).toBe(0);
  });

  it('ten gate desk cohorts all finish in one call 10000 ticks later', () => {
    const sn = singleNodes('gateDesk');
    const rng = rngFor(10);
    for (let i = 0; i < 10; i++) serviceJoin(sn, 0, i, 1);
    serviceUpdate(sn, 0, rng);
    serviceUpdate(sn, 10000, rng);
    expect(sn.doneCount).toBe(10);
    expect(sn.active).toBe(0);
  });
});
