import { describe, expect, it } from 'vitest';
import { ZONE, type TerminalGrid } from '@shared/business';
import { defaultZones } from '@shared/defaultZones';
import { cornerWorld, originFor } from '@shared/terminalOps';
import { effectiveZones } from '@shared/terminalZones';
import { Sim } from '@sim/sim';
import { buildTestAirport, OPTIONS, ownedSim, run } from './helpers';

/** A w by h floor with its corner at the origin, heading 90. */
function floorGrid(w: number, h: number): TerminalGrid {
  return { id: 1, building: 1, level: 0, ox: 0, oy: 0, headingDeg: 90, x0: 0, y0: 0, w, h, floor: new Uint8Array(w * h).fill(1) } as unknown as TerminalGrid;
}

describe('default zones of unzoned floor (T95)', () => {
  it('splits a hall at the middle: the half by the apron is Secure, the half by the curb Public', () => {
    const g = floorGrid(10, 8);
    // The apron lies past the far edge of the rows, along +row.
    const far = cornerWorld(g, 0, 8);
    const near = cornerWorld(g, 0, 0);
    const ux = far.x - near.x;
    const uy = far.y - near.y;
    const along = (x: number, y: number): number => ((x - near.x) * ux + (y - near.y) * uy) / Math.hypot(ux, uy);
    const z = defaultZones(g, (x, y) => along(x, y) > 16 + 5, 40, 2);
    // Row 0 touches the landside, the side walls are landside too, so only the middle rows near the apron edge are Secure.
    expect(z[0 * 10 + 5]).toBe(ZONE.Public);
    expect(z[7 * 10 + 5]).toBe(ZONE.Secure);
    expect(z[6 * 10 + 5]).toBe(ZONE.Secure);
    expect(z[2 * 10 + 5]).toBe(ZONE.Public);
  });

  it('is all Public with no apron around, as unzoned floor was before', () => {
    const z = defaultZones(floorGrid(6, 6), () => false, 40, 2);
    expect(Array.from(z).every((v) => v === ZONE.Public)).toBe(true);
  });

  it('leaves cells without floor at 0', () => {
    const g = floorGrid(4, 4);
    g.floor[5] = 0;
    const z = defaultZones(g, () => true, 40, 2);
    expect(z[5]).toBe(0);
    expect(z[0]).toBe(ZONE.Secure);
  });
});

describe('default sides in the sim (T95)', () => {
  function hall(): Sim {
    const sim = ownedSim();
    buildTestAirport(sim);
    const { ox, oy } = originFor(3960, 5440, 90);
    const edit = (building: number, e: { op: 'foundation' | 'floor'; x0: number; y0: number; x1: number; y1: number; variant: number }): string[] => run(sim, { type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e });
    expect(edit(-1, { op: 'foundation', x0: 40, y0: 30, x1: 70, y1: 53, variant: 0 })).toEqual([]);
    expect(edit(sim.business.grids[0]!.id, { op: 'floor', x0: 40, y0: 30, x1: 70, y1: 53, variant: 2 })).toEqual([]);
    return sim;
  }

  it('an unzoned hall beside the apron is part Secure, part Public, and the zones follow it', () => {
    const sim = hall();
    sim.step();
    const g = sim.business.grids[0]!;
    const eff = effectiveZones(g);
    const kinds = new Set(Array.from(eff).filter((z) => z !== 0));
    expect(kinds.has(ZONE.Secure)).toBe(true);
    expect(kinds.has(ZONE.Public)).toBe(true);
    expect(Array.from(g.zone).every((z) => z === 0)).toBe(true);
  });

  it('is deterministic over 2000 ticks and survives a save', () => {
    const go = (): Sim => {
      const sim = hall();
      for (let t = 0; t < 2000; t++) sim.step();
      return sim;
    };
    const a = go();
    const b = go();
    expect(a.stateHash()).toBe(b.stateHash());
    const c = new Sim(a.seed, OPTIONS);
    c.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(Array.from(c.business.grids[0]!.sides ?? [])).toEqual(Array.from(a.business.grids[0]!.sides ?? []));
    for (let t = 0; t < 200; t++) {
      a.step();
      c.step();
    }
    expect(c.stateHash()).toBe(a.stateHash());
  });
});
