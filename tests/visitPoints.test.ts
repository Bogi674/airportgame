import { describe, expect, it } from 'vitest';
import { FIXTURE_KEYS, ZONE } from '@shared/business';
import { Sim } from '@sim/sim';
import { SIDE, findPoint, type VisitPoints } from '@sim/terminal/visitPoints';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run } from './helpers';

const SEATING = FIXTURE_KEYS.indexOf('seating') + 1;
const CONVENIENCE = FIXTURE_KEYS.indexOf('convenience') + 1;
const CAFE = FIXTURE_KEYS.indexOf('cafe') + 1;

function shopSim(): Sim {
  const sim = ownedSim();
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, { shop: true })).toEqual([]);
  paint(sim, 'zone', 40, 40, 72, 52, ZONE.Public);
  return sim;
}

/** Paints a zone and a fixture over a logical cell range of the first grid. */
function paint(sim: Sim, op: 'zone' | 'fixture' | 'erase' | 'removeWall', x0: number, y0: number, x1: number, y1: number, variant: number): string[] {
  const g = sim.business.grids[0]!;
  return run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op, x0, y0, x1, y1, variant } });
}

function pointAt(sim: Sim, lx: number, ly: number): { vp: VisitPoints; k: number } {
  const vp = sim.cohorts.visitTable(0)!;
  for (let k = 0; k < vp.count; k++) if (vp.lx[k] === lx && vp.ly[k] === ly) return { vp, k };
  throw new Error(`no visit point at ${lx},${ly}`);
}

describe('visit points', () => {
  it('seating and a shop in the secure hall are air side with a walk node', () => {
    const sim = shopSim();
    const shop = pointAt(sim, 86, 46);
    expect(shop.vp.kind[shop.k]).toBe(CONVENIENCE);
    expect(shop.vp.side[shop.k]).toBe(SIDE.Air);
    expect(shop.vp.walkNode[shop.k]).toBeGreaterThanOrEqual(0);
    const seat = pointAt(sim, 76, 46);
    expect(seat.vp.kind[seat.k]).toBe(SEATING);
    expect(seat.vp.side[seat.k]).toBe(SIDE.Air);
  });

  it('points are in ascending cell order', () => {
    const vp = shopSim().cohorts.visitTable(0)!;
    expect(vp.count).toBeGreaterThan(1);
    for (let k = 1; k < vp.count; k++) expect(vp.cell[k]).toBeGreaterThan(vp.cell[k - 1]!);
  });

  it('a cafe in a commercial area inside the public hall is land side', () => {
    const sim = shopSim();
    expect(paint(sim, 'zone', 50, 48, 52, 49, ZONE.Commercial)).toEqual([]);
    expect(paint(sim, 'fixture', 50, 48, 51, 49, CAFE)).toEqual([]);
    const p = pointAt(sim, 50, 48);
    expect(p.vp.side[p.k]).toBe(SIDE.Land);
  });

  it('a commercial area touching a public and a secure cell has no side', () => {
    const sim = shopSim();
    // Effective zones follow open edges, so the wall between the public and the secure hall opens here.
    expect(paint(sim, 'removeWall', 72, 48, 72, 49, 1)).toEqual([]);
    expect(paint(sim, 'zone', 70, 48, 72, 49, ZONE.Commercial)).toEqual([]);
    expect(paint(sim, 'fixture', 71, 48, 72, 49, CAFE)).toEqual([]);
    const p = pointAt(sim, 71, 48);
    expect(p.vp.side[p.k]).toBe(SIDE.None);
  });

  it('a commercial area touching only the secure hall is air side', () => {
    const sim = shopSim();
    expect(paint(sim, 'zone', 90, 48, 92, 49, ZONE.Commercial)).toEqual([]);
    expect(paint(sim, 'fixture', 90, 48, 91, 49, CAFE)).toEqual([]);
    const p = pointAt(sim, 90, 48);
    expect(p.vp.side[p.k]).toBe(SIDE.Air);
  });

  it('findPoint finds the same anchor after a rebuild and -1 once it is gone', () => {
    const sim = shopSim();
    const before = pointAt(sim, 86, 46);
    const cell = before.vp.cell[before.k]!;
    expect(findPoint(before.vp, cell, CONVENIENCE)).toBe(before.k);
    paint(sim, 'zone', 50, 48, 52, 49, ZONE.Commercial);
    paint(sim, 'fixture', 50, 48, 51, 49, CAFE);
    const after = sim.cohorts.visitTable(0)!;
    expect(findPoint(after, cell, CONVENIENCE)).toBeGreaterThanOrEqual(0);
    expect(after.cell[findPoint(after, cell, CONVENIENCE)]).toBe(cell);
    paint(sim, 'erase', 86, 46, 87, 47, 0);
    expect(findPoint(sim.cohorts.visitTable(0)!, cell, CONVENIENCE)).toBe(-1);
  });

  it('a restored save rebuilds the same points', () => {
    const a = shopSim();
    const b = new Sim(a.seed, OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    const va = a.cohorts.visitTable(0)!;
    const vb = b.cohorts.visitTable(0)!;
    expect(vb.count).toBe(va.count);
    expect(Array.from(vb.cell)).toEqual(Array.from(va.cell));
  });
});
