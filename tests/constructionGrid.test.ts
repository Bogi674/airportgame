import { describe, expect, it } from 'vitest';
import { AIRFIELD } from '@data/index';
import { airfieldCodesSchema } from '../src/data/schemas';
import airfieldCodesJson from '../src/data/airfield_codes.json';
import type { Pt } from '@shared/geom';
import { EMPTY_AIRFIELD, type AirfieldPayload, type Runway, type Taxiway } from '@shared/airfield';
import { gridPoint, gridsFor, snapToGrid } from '@shared/constructionGrid';
import { buildTestAirport, ownedSim, run } from './helpers';

/** Asserts a point to a thousandth of a meter. */
function expectPt(p: Pt, x: number, y: number): void {
  expect(p.x).toBeCloseTo(x, 3);
  expect(p.y).toBeCloseTo(y, 3);
}

/** A runway at heading 37, so no snapped coordinate can be a round number. */
function rotatedRunway(): Runway {
  const hd = 37;
  const ux = Math.sin((hd * Math.PI) / 180);
  const uy = -Math.cos((hd * Math.PI) / 180);
  return {
    id: 1,
    cost: 0,
    x1: 1200.5,
    y1: 3000.25,
    x2: 1200.5 + 1000 * ux,
    y2: 3000.25 + 1000 * uy,
    headingDeg: hd,
    lengthM: 1000,
    widthM: 45,
    shoulderM: 7.5,
    code: 'C',
    approach: 'precision',
    surface: 'asphalt',
    pcr: 80,
    condition: 1,
    nameA: '04',
    nameB: '22',
  };
}

function taxiway(id: number, points: Pt[]): Taxiway {
  return {
    id,
    cost: 0,
    kind: 'taxiway',
    points,
    code: 'C',
    widthM: 25,
    surface: 'asphalt',
    pcr: 80,
    condition: 1,
    oneWay: false,
    closed: false,
    userMaxCode: 'C',
    maxCode: 'C',
    speedKmh: 30,
    name: 'T',
  };
}

/** The rotated runway plus a taxiway that runs east for 100 m, then bends south east for 70.7 m. */
function airfield(version = 7): AirfieldPayload {
  const bent = taxiway(4, [{ x: 1000, y: 2000 }, { x: 1100, y: 2000 }, { x: 1150, y: 2050 }]);
  return { ...EMPTY_AIRFIELD, version, runways: [rotatedRunway()], taxiways: [bent] };
}

describe('construction grid data', () => {
  it('has a 2 m minor and a 10 m major spacing', () => {
    expect(AIRFIELD.constructionGrid.spacingMinorM).toBe(2);
    expect(AIRFIELD.constructionGrid.spacingMajorM).toBe(10);
  });

  it('rejects a major spacing that is not a multiple of the minor one', () => {
    const bad = structuredClone(airfieldCodesJson) as typeof airfieldCodesJson;
    bad.constructionGrid.spacingMajorM = 7;
    expect(airfieldCodesSchema.safeParse(bad).success).toBe(false);
  });
});

describe('gridsFor', () => {
  it('returns no grids for an empty airfield', () => {
    expect(gridsFor(EMPTY_AIRFIELD)).toEqual([]);
  });

  it('gives a runway one grid at threshold A, along its heading', () => {
    const g = gridsFor(airfield())[0];
    expect(g.id).toBe('runway:1');
    expect(g.kind).toBe('runway');
    expectPt(g.origin, 1200.5, 3000.25);
    expect(g.headingDeg).toBe(37);
    expect(g.lengthM).toBe(1000);
    expect(g.spacingMinorM).toBe(2);
    expect(g.spacingMajorM).toBe(10);
    expect(g.ax).toBeCloseTo(0.601815, 6);
    expect(g.ay).toBeCloseTo(-0.798636, 6);
  });

  it('gives a bent taxiway one grid per segment, in order, each along its own segment', () => {
    const grids = gridsFor(airfield());
    expect(grids.map((g) => g.id)).toEqual(['runway:1', 'taxi:4:0', 'taxi:4:1']);
    const [, east, bend] = grids;
    expectPt(east.origin, 1000, 2000);
    expect(east.headingDeg).toBe(90);
    expect(east.lengthM).toBeCloseTo(100, 6);
    expectPt(bend.origin, 1100, 2000);
    expect(bend.headingDeg).toBe(135);
    expect(bend.lengthM).toBeCloseTo(70.710678, 5);
  });

  it('keeps the across axis square to the along axis, to the left of travel', () => {
    for (const g of gridsFor(airfield())) {
      expect(g.ax * g.cx + g.ay * g.cy).toBeCloseTo(0, 12);
      expect(Math.hypot(g.cx, g.cy)).toBeCloseTo(1, 12);
      // Left of travel is (ay, -ax), the same side runwayFrame calls positive lateral.
      expect(g.cx).toBeCloseTo(g.ay, 12);
      expect(g.cy).toBeCloseTo(-g.ax, 12);
    }
  });

  it('skips a zero length taxiway segment but keeps the segment numbering', () => {
    const t = taxiway(9, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 0 }]);
    const grids = gridsFor({ ...EMPTY_AIRFIELD, version: 1, taxiways: [t] });
    expect(grids.map((g) => g.id)).toEqual(['taxi:9:1']);
  });

  it('returns the same array while the version is unchanged and a new one after it bumps', () => {
    const af = airfield();
    const first = gridsFor(af);
    expect(gridsFor(af)).toBe(first);
    af.version = 8;
    const second = gridsFor(af);
    expect(second).not.toBe(first);
    expect(second.map((g) => g.id)).toEqual(first.map((g) => g.id));
  });

  it('is deterministic: two builds from equal input are equal', () => {
    expect(gridsFor(airfield())).toEqual(gridsFor(airfield()));
  });

  it('follows a real airport built by commands', () => {
    const sim = ownedSim();
    expect(gridsFor(sim.airfield.data)).toEqual([]);
    run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2000, code: 'C', approach: 'visual', surface: 'asphalt', tier: 2 });
    const one = gridsFor(sim.airfield.data);
    expect(one.map((g) => g.id)).toEqual(['runway:1']);
    expectPt(one[0].origin, 3000, 5000);
    buildTestAirport(ownedSim());
    const sim2 = ownedSim();
    buildTestAirport(sim2);
    const af = sim2.airfield.data;
    const segments = af.taxiways.reduce((n, t) => n + t.points.length - 1, 0);
    const all = gridsFor(af);
    expect(all.length).toBe(af.runways.length + segments);
    expect(new Set(all.map((g) => g.id)).size).toBe(all.length);
  });
});

describe('snapToGrid', () => {
  it('snaps points to the nodes of a runway grid at heading 37', () => {
    const g = gridsFor(airfield())[0];
    const a = snapToGrid({ x: 1223.5, y: 3037.5 }, g);
    expectPt(a.p, 1222.8164, 3037.1008);
    expect([a.i, a.j]).toEqual([-8, -20]);
    expect(a.snapped).toBe(true);
    expect(a.gridId).toBe('runway:1');
    expect(a.headingDeg).toBe(37);
    const b = snapToGrid({ x: 1185.5, y: 2972.75 }, g);
    expectPt(b.p, 1185.36, 2973.8156);
    expect([b.i, b.j]).toEqual([6, 14]);
    const c = snapToGrid({ x: 1255.5, y: 3042.25 }, g);
    expectPt(c.p, 1256.4045, 3042.3771);
    expect([c.i, c.j]).toEqual([0, -35]);
  });

  it('leaves a point that is already on a node where it is', () => {
    const g = gridsFor(airfield())[0];
    const r = snapToGrid({ x: 1200.5, y: 3000.25 }, g);
    expectPt(r.p, 1200.5, 3000.25);
    expect([r.i, r.j]).toEqual([0, 0]);
    expect(r.snapped).toBe(false);
    expect(r.major).toBe(true);
  });

  it('snaps to a node within the diagonal of one cell', () => {
    const g = gridsFor(airfield())[0];
    const p = { x: 1201.4, y: 3001.1 };
    const r = snapToGrid(p, g);
    expectPt(r.p, 1202.0973, 3001.4536);
    expect([r.i, r.j]).toEqual([0, -1]);
    expect(Math.hypot(r.p.x - p.x, r.p.y - p.y)).toBeLessThanOrEqual(Math.SQRT2);
  });

  it('snaps on an axis aligned taxiway segment to even meters from its start', () => {
    const east = gridsFor(airfield())[1];
    const a = snapToGrid({ x: 1043.2, y: 2005.1 }, east);
    expectPt(a.p, 1044, 2006);
    expect([a.i, a.j]).toEqual([22, -3]);
    const b = snapToGrid({ x: 1043.9, y: 1996.9 }, east);
    expectPt(b.p, 1044, 1996);
    expect([b.i, b.j]).toEqual([22, 2]);
  });

  it('snaps the same point differently on the two segments of a bend', () => {
    const [, east, bend] = gridsFor(airfield());
    const p = { x: 1130, y: 2030.7 };
    const onEast = snapToGrid(p, east);
    expectPt(onEast.p, 1130, 2030);
    expect(onEast.headingDeg).toBe(90);
    const onBend = snapToGrid(p, bend);
    expectPt(onBend.p, 1129.6985, 2029.6985);
    expect([onBend.i, onBend.j]).toEqual([21, 0]);
    expect(onBend.headingDeg).toBe(135);
    const behind = snapToGrid({ x: 1120.3, y: 1991 }, bend);
    expectPt(behind.p, 1119.799, 1991.5147);
    expect([behind.i, behind.j]).toEqual([4, 10]);
  });

  it('marks every fifth node in both directions as a major node', () => {
    const east = gridsFor(airfield())[1];
    expect(snapToGrid({ x: 1004, y: 2000 }, east).major).toBe(false);
    expect(snapToGrid({ x: 1010, y: 2000 }, east).major).toBe(true);
    expect(snapToGrid({ x: 1010, y: 2004 }, east).major).toBe(false);
    const both = snapToGrid({ x: 1010, y: 2010 }, east);
    expect([both.i, both.j, both.major]).toEqual([5, -5, true]);
  });

  it('keeps a node identity stable: the same cell gives the same indexes and point', () => {
    const g = gridsFor(airfield())[0];
    const first = snapToGrid({ x: 1223.5, y: 3037.5 }, g);
    const again = snapToGrid({ x: 1222.9, y: 3037.0 }, gridsFor(airfield())[0]);
    expect([again.i, again.j]).toEqual([first.i, first.j]);
    expectPt(again.p, first.p.x, first.p.y);
  });

  it('gridPoint is the inverse of the indexes snapToGrid returns', () => {
    const g = gridsFor(airfield())[0];
    const r = snapToGrid({ x: 1255.5, y: 3042.25 }, g);
    expectPt(gridPoint(g, r.i, r.j), r.p.x, r.p.y);
    expectPt(gridPoint(g, 0, 0), 1200.5, 3000.25);
    expectPt(gridPoint(g, 5, 0), 1200.5 + 10 * g.ax, 3000.25 + 10 * g.ay);
  });

  it('never returns a negative zero for an index', () => {
    const east = gridsFor(airfield())[1];
    const r = snapToGrid({ x: 1000.4, y: 2000.4 }, east);
    expect(Object.is(r.i, 0)).toBe(true);
    expect(Object.is(r.j, 0)).toBe(true);
  });
});
