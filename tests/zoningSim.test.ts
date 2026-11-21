import { describe, expect, it } from 'vitest';
import { Sim } from '@sim/sim';
import { FIXTURE_KEYS, WALL } from '@shared/business';
import { cellIndex, type TerminalEdit } from '@shared/terminalOps';
import { AUD, zoneBreaches } from '@shared/terminalZones';
import { Stage } from '@sim/cohorts/cohorts';
import { buildTestAirport, buildTestTerminal, ownedSim, run, OPTIONS } from './helpers';

const SECURITY = FIXTURE_KEYS.indexOf('security') + 1;

function edit(sim: Sim, e: TerminalEdit): string[] {
  const g = sim.business.grids[0]!;
  return run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: e });
}

/**
 * The shared test terminal is a zoned layout: lanes into the secure hall and one security exit out of it. This adds a
 * staff door inside the public hall and a staff use lane in the wall, so the staff layer has something to walk.
 */
function prepared(): Sim {
  const sim = ownedSim();
  sim.cash = 80_000_000;
  buildTestAirport(sim, { standsPerRow: 6 });
  // Two passenger lanes fill rows 42 to 45; the staff lane (8 by 2 cells, T74) takes rows 46 and 47.
  expect(buildTestTerminal(sim, { shop: true, gateDesk: 1, security: 2 })).toEqual([]);
  expect(edit(sim, { op: 'wall', x0: 60, y0: 46, x1: 60, y1: 47, variant: WALL.StaffDoor })).toEqual([]);
  expect(edit(sim, { op: 'removeWall', x0: 72, y0: 46, x1: 72, y1: 48, variant: 0 })).toEqual([]);
  expect(edit(sim, { op: 'fixture', x0: 72, y0: 46, x1: 73, y1: 47, variant: SECURITY, rot: 1, mode: 1 })).toEqual([]);
  run(sim, { type: 'signAirline', airlineId: 0, sign: true });
  run(sim, { type: 'signAirline', airlineId: 1, sign: true });
  run(sim, { type: 'setTestTraffic', perHour: 20, turnScale: 0.1 });
  return sim;
}

/** Steps a sim and returns the highest cohort stage seen on the way. */
function stepTop(sim: Sim, ticks: number): number {
  let top = 0;
  for (let t = 0; t < ticks; t++) {
    sim.step();
    for (let c = 0; c < sim.cohorts.hi; c++) top = Math.max(top, sim.cohorts.stage[c]!);
  }
  return top;
}

describe('zoned terminal in the sim', () => {
  it('exercises lanes, the exit and the staff layer, and hashes the same over 2000 ticks', () => {
    const a = prepared();
    const b = prepared();
    expect(a.business.readiness()).toEqual([]);
    const g = a.business.grids[0]!;
    const wg = a.business.walkGraphs[0]!;
    const at = (x: number, y: number): number => a.business.nearestNode(g.id, cellIndex(g, x, y));
    const curb = a.business.curbNode(0);
    const seat = at(76, 46);
    expect(curb).toBeGreaterThanOrEqual(0);
    // Passengers walk in through a lane and out through the exit.
    expect(Number.isFinite(a.business.walkDistance(g.id, curb, seat))).toBe(true);
    expect(Number.isFinite(a.business.walkDistance(g.id, seat, curb))).toBe(true);
    // Staff walk into the secure hall too, and their layer holds a cached row.
    expect(Number.isFinite(a.business.walkDistance(g.id, at(70, 45), at(74, 45), AUD.Staff))).toBe(true);
    expect(wg.staffCache.rowSource.some((s) => s >= 0)).toBe(true);
    const topA = stepTop(a, 2000);
    const topB = stepTop(b, 2000);
    expect(a.cohorts.generated).toBeGreaterThan(0);
    expect(topA).toBeGreaterThanOrEqual(Stage.Airside);
    expect(topB).toBe(topA);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('restores from a save at tick 1000 and runs on to the same hash', () => {
    const a = prepared();
    for (let t = 0; t < 1000; t++) a.step();
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(c.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 1000; t++) {
      a.step();
      c.step();
    }
    expect(c.stateHash()).toBe(a.stateHash());
  });

  it('lists zoneBreach for a plain door joining two zones and clears it with a wall', () => {
    const sim = prepared();
    const g = sim.business.grids[0]!;
    const breaches = (): number => zoneBreaches(g, sim.business.walkGraphs[0]!.access).length;
    expect(sim.business.readiness()).not.toContain('zoneBreach');
    expect(breaches()).toBe(0);
    expect(edit(sim, { op: 'wall', x0: 72, y0: 48, x1: 72, y1: 49, variant: WALL.Door })).toEqual([]);
    expect(sim.business.readiness()).toContain('zoneBreach');
    expect(breaches()).toBe(1);
    expect(edit(sim, { op: 'wall', x0: 72, y0: 48, x1: 72, y1: 49, variant: WALL.Wall })).toEqual([]);
    expect(sim.business.readiness()).not.toContain('zoneBreach');
    expect(breaches()).toBe(0);
  });
});
