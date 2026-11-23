import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@data/index';
import { FIXTURE_KEYS, ZONE, type TerminalGrid } from '@shared/business';
import { cellIndex, fixtureCost } from '@shared/terminalOps';
import { zoneAccess, zoneIssues } from '@shared/terminalZones';
import { rideLengthM, travelatorCostOf, travelatorLanes, travelatorLengthM, TRAVELATOR } from '@shared/travelator';
import { effectiveZones } from '@shared/terminalZones';
import { buildWalkGraph, updateWalkGraph, WALK_NODE, type WalkGraph } from '@sim/terminal/walkGraph';
import { nearestNode, walkDistance } from '@sim/terminal/walkDistance';
import { Sim } from '@sim/sim';
import { grid, paint, put, wall } from './zoningGrid';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run } from './helpers';

/** Walking distance in meters between the nodes nearest two logical cells. */
function walk(g: TerminalGrid, wg: WalkGraph, a: [number, number], b: [number, number]): number {
  const from = nearestNode(wg, cellIndex(g, a[0], a[1]));
  const to = nearestNode(wg, cellIndex(g, b[0], b[1]));
  return walkDistance(wg, from, to);
}

/** A 24 by 8 cell public hall. */
function hall(): TerminalGrid {
  const g = grid(24, 8);
  paint(g, 0, 0, 24, 8, ZONE.Public);
  return g;
}

describe('travelator data', () => {
  it('is appended at the end of the fixture keys', () => {
    expect(FIXTURE_KEYS[FIXTURE_KEYS.length - 1]).toBe('travelator');
    expect(TRAVELATOR).toBe(23);
  });

  it('prices the three lengths and rides at the belt speed', () => {
    expect([1, 2, 3].map((l) => fixtureCost(TRAVELATOR, l))).toEqual([60000, 110000, 160000]);
    expect([1, 2, 3].map(travelatorLengthM)).toEqual([8, 16, 24]);
    const ref = BUSINESS.terminal.walk.travelatorRefWalkMps;
    expect(rideLengthM(3)).toBeCloseTo((24 * ref) / (ref + 0.65), 6);
  });
});

describe('travelator walking', () => {
  it('shortens a measured walk along its axis', () => {
    const plain = hall();
    const before = walk(plain, buildWalkGraph(plain), [4, 2], [17, 2]);
    const g = hall();
    // Level 3 is 24 m: columns 5 to 16, rows 2 and 3. Its belts end at columns 4 and 17.
    put(g, 'travelator', 5, 2, 0, 3);
    const wg = buildWalkGraph(g);
    const after = walk(g, wg, [4, 2], [17, 2]);
    expect(before).toBeGreaterThanOrEqual(24);
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(rideLengthM(3), 3);
    expect(walk(g, wg, [17, 3], [4, 3])).toBeCloseTo(rideLengthM(3), 3);
    expect(wg.nodeKind[wg.cellNode[cellIndex(g, 4, 2)]!]).toBe(WALK_NODE.Ride);
    expect(wg.nodeKind[wg.cellNode[cellIndex(g, 17, 3)]!]).toBe(WALK_NODE.Ride);
  });

  it('closes its cells to walking, so crossing it goes round an end', () => {
    const g = hall();
    put(g, 'travelator', 5, 2, 0, 3);
    const wg = buildWalkGraph(g);
    for (let x = 5; x <= 16; x++) {
      expect(wg.blocked[cellIndex(g, x, 2)]).toBe(1);
      expect(wg.cellMain[cellIndex(g, x, 3)]).toBe(-1);
    }
    // Straight across is 6 m; round the nearer end is far longer.
    expect(walk(g, wg, [10, 0], [10, 5])).toBeGreaterThan(14);
  });

  it('leaves out a belt whose ends lie in different zones', () => {
    const g = hall();
    paint(g, 12, 0, 24, 8, ZONE.Secure);
    put(g, 'travelator', 5, 2, 0, 3);
    expect(travelatorLanes(g, effectiveZones(g))).toEqual([]);
    const ok = hall();
    put(ok, 'travelator', 5, 2, 0, 3);
    expect(travelatorLanes(ok, effectiveZones(ok))).toHaveLength(2);
  });

  it('links its two ends in the zone floods', () => {
    // Public west of column 9, secure east of it behind a wall with an exit. A wall at column 20 leaves only the belt.
    const pier = (belt: boolean): TerminalGrid => {
      const g = grid(30, 6);
      paint(g, 0, 0, 9, 6, ZONE.Public);
      paint(g, 9, 0, 30, 6, ZONE.Secure);
      for (const y of [0, 1, 2, 3]) wall(g, false, 9, y, 1);
      put(g, 'securityExit', 9, 5, 3);
      for (const y of [0, 1, 4, 5]) wall(g, false, 20, y, 1);
      if (belt) put(g, 'travelator', 14, 2, 0, 3);
      else for (const y of [2, 3]) wall(g, false, 20, y, 1);
      return g;
    };
    expect(zoneIssues(pier(false), zoneAccess(pier(false)))).toContain('paxCannotLeave');
    const g = pier(true);
    expect(zoneIssues(g, zoneAccess(g))).not.toContain('paxCannotLeave');
  });

  it('a regional rebuild after placing and removing it equals a fresh build', () => {
    const g = hall();
    let wg = buildWalkGraph(g);
    put(g, 'travelator', 5, 2, 0, 2);
    wg = updateWalkGraph(wg, g, 5, 2, 12, 3);
    const fresh = buildWalkGraph(g);
    expect(Array.from(wg.edgeLen)).toEqual(Array.from(fresh.edgeLen));
    expect(Array.from(wg.edgeTo)).toEqual(Array.from(fresh.edgeTo));
    expect(Array.from(wg.nodeKind)).toEqual(Array.from(fresh.nodeKind));
  });

  it('is left out of the building upkeep base', () => {
    const g = hall();
    put(g, 'travelator', 5, 2, 0, 1);
    put(g, 'travelator', 5, 5, 0, 2);
    expect(travelatorCostOf(g)).toBe(170000);
  });
});

/** The test airport and terminal with a 16 m travelator in the public hall, west of the check in row. */
function travelatorSim(): Sim {
  const sim = ownedSim('GOLDEN-0001');
  sim.cash = 100_000_000;
  buildTestAirport(sim, { standsPerRow: 6 });
  expect(buildTestTerminal(sim, { gateDesk: 2 })).toEqual([]);
  const g = sim.business.grids[0]!;
  expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op: 'fixture', x0: 50, y0: 46, x1: 51, y1: 47, variant: TRAVELATOR, rot: 0, level: 2 } })).toEqual([]);
  return sim;
}

describe('travelator in the sim', () => {
  it('charges the build cost and stores the length as the level', () => {
    const sim = travelatorSim();
    const g = sim.business.grids[0]!;
    expect(g.fixture[cellIndex(g, 57, 47)]).toBe(TRAVELATOR);
    expect(g.fixtureLevel[cellIndex(g, 50, 46)]).toBe(2);
  });

  it('two runs from one seed give identical hashes', () => {
    const a = travelatorSim();
    const b = travelatorSim();
    for (const s of [a, b]) {
      s.enqueue({ type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
      for (let t = 0; t < 2000; t++) s.step();
    }
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('a save restores the travelator and runs on to the same hash', () => {
    const a = travelatorSim();
    for (let t = 0; t < 500; t++) a.step();
    const b = new Sim('GOLDEN-0001', OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 500; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });
});
