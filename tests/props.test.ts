import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@data/index';
import { FIXTURE_KEYS, WALL, ZONE, type Prop, type TerminalGrid } from '@shared/business';
import { convertLegacyFixtures, footprintSteps, planProp, propBlockMask, propCost, propRect, propSpec, propTotals, seatCells, seatSpots, washrooms } from '@shared/props';
import { ensureCells, newGrid } from '@shared/terminalOps';
import { labelRooms } from '@shared/terminalRooms';
import { Sim } from '@sim/sim';
import { SAVE_VERSION } from '@sim/save/migrations';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run } from './helpers';

const KEY = (k: (typeof FIXTURE_KEYS)[number]): number => FIXTURE_KEYS.indexOf(k) + 1;

/** A 10 by 10 cell floor of one zone with a wall along its top edge and a door on the left edge of cell (5, 5). */
function room(zone: number = ZONE.Staff): TerminalGrid {
  const g = newGrid(1, 0, 0, 90);
  ensureCells(g, 0, 0, 10, 10);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const i = (y - g.y0) * g.w + (x - g.x0);
      g.floor[i] = 1;
      g.zone[i] = zone;
    }
  }
  for (let x = 0; x < 10; x++) g.hWall[(0 - g.y0) * g.w + (x - g.x0)] = WALL.Wall;
  g.vWall[(5 - g.y0) * (g.w + 1) + (5 - g.x0)] = WALL.Door;
  return g;
}

const cell = (g: TerminalGrid, x: number, y: number): number => (y - g.y0) * g.w + (x - g.x0);
const place = (g: TerminalGrid, p: Prop): string | null => {
  const plan = planProp(g, p);
  if (plan.problem) return plan.problem.code;
  g.props.push(p);
  return null;
};

/** A sim with the test airport and terminal: 12 beam seats in the secure hall and 4 stalls on its north wall. */
function terminalSim(seed = 'GOLDEN-0001'): Sim {
  const sim = ownedSim(seed);
  sim.cash = 100_000_000;
  buildTestAirport(sim, { standsPerRow: 6 });
  expect(buildTestTerminal(sim, { gateDesk: 2 })).toEqual([]);
  return sim;
}

describe('prop footprints and prices', () => {
  it('rounds the drawn size up to the 0.5 m grid and turns it with rot', () => {
    const bench = propSpec('bench.beam3')!;
    expect(footprintSteps(bench, 0)).toEqual([4, 2]);
    expect(footprintSteps(bench, 1)).toEqual([2, 4]);
    expect(propRect({ asset: 'bench.beam3', x: 3, y: 1.5, rot: 0 })).toEqual({ sx0: 6, sy0: 3, sx1: 10, sy1: 5 });
    expect(propSpec('checkIn.l1')).toBeUndefined();
    expect(propSpec('screeningConsole')).toBeUndefined();
  });

  it('prices seats per seat, decoration per ambience point, overrides by id and the rest by category', () => {
    expect(propCost('bench.beam5')).toBe(5 * BUSINESS.props.perSeat);
    expect(propCost('decor.planterLarge')).toBe(2 * BUSINESS.props.perAmbience);
    expect(propCost('washroom.wcStall')).toBe(2500);
    expect(propCost('screen.ledWall')).toBe(12000);
    expect(propCost('vending.snack')).toBe(3000);
    expect(propCost('lounge.sofa3')).toBe(1200);
  });
});

describe('prop placement rules', () => {
  it('needs floor, an allowed zone, the grid and no fixture', () => {
    const g = room();
    expect(planProp(g, { asset: 'office.workDesk', x: 4, y: 4, rot: 0 }).problem).toBeNull();
    expect(planProp(g, { asset: 'office.workDesk', x: 4.25, y: 4, rot: 0 }).problem?.code).toBe('propOffGrid');
    expect(planProp(g, { asset: 'office.workDesk', x: 19, y: 4, rot: 0 }).problem?.code).toBe('terminalNeedsFoundation');
    expect(planProp(g, { asset: 'bench.beam3', x: 4, y: 4, rot: 0 }).problem?.code).toBe('wrongZone');
    expect(planProp(g, { asset: 'nope', x: 4, y: 4, rot: 0 }).problem?.code).toBe('notAProp');
    g.fixture[cell(g, 2, 2)] = KEY('checkIn');
    expect(planProp(g, { asset: 'office.workDesk', x: 4, y: 4, rot: 0 }).problem?.code).toBe('propOnFixture');
    // Overhead props hang over fixtures.
    const pub = room(ZONE.Public);
    pub.fixture[cell(pub, 2, 2)] = KEY('checkIn');
    expect(planProp(pub, { asset: 'screen.ceilingFids', x: 4, y: 4.5, rot: 0 }).problem).toBeNull();
  });

  it('puts wall props on a wall with their back edge, turned with them', () => {
    const g = room(ZONE.Public);
    expect(planProp(g, { asset: 'washroom.wcStall', x: 4, y: 0, rot: 0 }).problem).toBeNull();
    expect(planProp(g, { asset: 'washroom.wcStall', x: 4, y: 2, rot: 0 }).problem?.code).toBe('propNeedsWall');
    // Turned twice the back is the bottom edge, which does not touch the top wall.
    expect(planProp(g, { asset: 'washroom.wcStall', x: 4, y: 0, rot: 2 }).problem?.code).toBe('propNeedsWall');
  });

  it('never crosses a wall and never overlaps on its layer', () => {
    const g = room(ZONE.Secure);
    g.vWall[cell(g, 3, 3) + 3] = WALL.Wall;
    expect(planProp(g, { asset: 'lounge.sofa3', x: 5, y: 7, rot: 0 }).problem?.code).toBe('propCrossesWall');
    expect(place(g, { asset: 'lounge.sofa3', x: 12, y: 12, rot: 0 })).toBeNull();
    expect(place(g, { asset: 'lounge.armchair', x: 13, y: 12, rot: 0 })).toBe('propOverlap');
    // A rug lies under the sofa on its own layer.
    expect(place(g, { asset: 'lounge.rug', x: 12, y: 12, rot: 0 })).toBeNull();
  });

  it('puts desktop props on a desk only', () => {
    const g = room();
    expect(place(g, { asset: 'office.computerSingle', x: 4, y: 4, rot: 0 })).toBe('propNeedsDesk');
    expect(place(g, { asset: 'office.workDesk', x: 4, y: 4, rot: 0 })).toBeNull();
    expect(place(g, { asset: 'office.computerSingle', x: 4, y: 4, rot: 0 })).toBeNull();
    expect(place(g, { asset: 'office.computerDual', x: 4, y: 4, rot: 0 })).toBe('propOverlap');
  });

  it('refuses a prop that would block a cell beside a door', () => {
    const g = room();
    // The door is on the left edge of cell (5, 5), so cells (4, 5) and (5, 5) stay clear.
    expect(planProp(g, { asset: 'office.workDesk', x: 10, y: 10, rot: 0 }).problem?.code).toBe('propBlocksDoor');
    expect(planProp(g, { asset: 'office.workDesk', x: 8, y: 10, rot: 0 }).problem?.code).toBe('propBlocksDoor');
    expect(planProp(g, { asset: 'office.workDesk', x: 14, y: 10, rot: 0 }).problem).toBeNull();
  });
});

describe('walking block', () => {
  it('blocks a cell when floor props cover half of it, never for floor layer props', () => {
    const g = room(ZONE.Secure);
    // A bench is 2 by 1 m on the grid, half of its cell.
    expect(place(g, { asset: 'bench.beam3', x: 2, y: 2, rot: 0 })).toBeNull();
    // A small planter covers a quarter.
    expect(place(g, { asset: 'decor.planterSmall', x: 6, y: 2, rot: 0 })).toBeNull();
    expect(place(g, { asset: 'lounge.rug', x: 10, y: 10, rot: 0 })).toBeNull();
    const m = propBlockMask(g);
    expect(m[cell(g, 1, 1)]).toBe(1);
    expect(m[cell(g, 3, 1)]).toBe(0);
    expect(m[cell(g, 5, 5)]).toBe(0);
    expect(m.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('washrooms and seats', () => {
  it('groups the toilet props of a room into one node with their capacity and weighted service time', () => {
    const g = room(ZONE.Public);
    expect(place(g, { asset: 'washroom.wcStall', x: 2, y: 0, rot: 0 })).toBeNull();
    expect(place(g, { asset: 'washroom.wcStall', x: 3, y: 0, rot: 0 })).toBeNull();
    expect(place(g, { asset: 'washroom.urinals3', x: 10, y: 0, rot: 0 })).toBeNull();
    expect(place(g, { asset: 'washroom.vanity2', x: 14, y: 0, rot: 0 })).toBeNull();
    const w = washrooms(g, labelRooms(g), propBlockMask(g));
    expect(w).toHaveLength(1);
    expect(w[0]!.servers).toBe(5);
    expect(w[0]!.meanS).toBeCloseTo((2 * 90 + 3 * 45) / 5, 6);
    // The node stands in front of the first stall, on the open cell below it.
    expect(w[0]!.cell).toBe(cell(g, 1, 1));
  });

  it('counts seats with comfort and ambience on passenger floor', () => {
    const g = room(ZONE.Secure);
    expect(place(g, { asset: 'bench.padded3', x: 2, y: 4, rot: 0 })).toBeNull();
    expect(place(g, { asset: 'decor.palm', x: 14, y: 14, rot: 0 })).toBeNull();
    const t = propTotals(g);
    expect(t.comfortSeats).toBeCloseTo(3 * (1 + BUSINESS.props.comfortWeight * 2), 6);
    expect(t.secureSeats).toBe(3);
    expect(t.ambience).toBe(2);
    expect(t.passengerAreaM2).toBe(400);
    expect(t.cost).toBe(propCost('bench.padded3') + propCost('decor.palm'));
    expect(seatCells(g)).toEqual([cell(g, 1, 2)]);
  });

  it('lays out single seats along a row, back to back rows and a lone seat, each facing out of its prop (PX2)', () => {
    const g = room(ZONE.Secure);
    // A 3 seat beam turned to face minus y, a back to back 6 and a recliner facing plus y.
    expect(place(g, { asset: 'bench.beam3', x: 2, y: 4, rot: 2 })).toBeNull();
    expect(place(g, { asset: 'bench.b2b6', x: 8, y: 8, rot: 0 })).toBeNull();
    expect(place(g, { asset: 'recliner', x: 14, y: 4, rot: 0 })).toBeNull();
    const sp = seatSpots(g);
    expect(sp.count).toBe(3 + 6 + 1);
    // Beam: three seats one pitch apart on one row, across the prop, all facing minus y.
    const beam = propRect({ asset: 'bench.beam3', x: 2, y: 4, rot: 2 })!;
    const pitch = propSpec('bench.beam3')!.size[0] / 3;
    for (let i = 0; i < 3; i++) {
      expect(sp.row[i]).toBe(sp.row[0]);
      expect([sp.fx[i], sp.fy[i]]).toEqual([0, -1]);
      expect(sp.y[i]).toBeCloseTo(((beam.sy0 + beam.sy1) / 2) * 0.25, 6);
      if (i > 0) expect(Math.abs(sp.x[i]! - sp.x[i - 1]!) * 2).toBeCloseTo(pitch, 5);
    }
    // Back to back: two rows of three facing away from each other.
    expect(sp.row[3]).not.toBe(sp.row[0]);
    expect(sp.row[6]).not.toBe(sp.row[3]);
    for (let i = 3; i < 6; i++) expect([sp.fx[i], sp.fy[i]]).toEqual([0, 1]);
    for (let i = 6; i < 9; i++) expect([sp.fx[i], sp.fy[i]]).toEqual([0, -1]);
    expect(sp.y[3]).toBeGreaterThan(sp.y[6]!);
    // The recliner seats one at its centre on a row of its own.
    const rec = propRect({ asset: 'recliner', x: 14, y: 4, rot: 0 })!;
    expect(sp.x[9]).toBeCloseTo(((rec.sx0 + rec.sx1) / 2) * 0.25, 6);
    expect(sp.row[9]).not.toBe(sp.row[6]);
  });

  it('converts seating and toilet fixtures into props that fill their cells', () => {
    const g = room(ZONE.Secure);
    g.fixture[cell(g, 2, 3)] = KEY('seating');
    g.fixture[cell(g, 6, 3)] = KEY('toilet');
    expect(convertLegacyFixtures(g)).toBe(2);
    expect(g.fixture.every((f) => f === 0)).toBe(true);
    expect(g.props).toEqual([
      { asset: 'bench.beam3', x: 4, y: 6, rot: 0 },
      { asset: 'bench.beam3', x: 4, y: 7, rot: 0 },
      { asset: 'washroom.wcStall', x: 12, y: 6, rot: 0 },
      { asset: 'washroom.wcStall', x: 13, y: 6, rot: 0 },
    ]);
  });
});

describe('props in the sim', () => {
  it('pays for a prop and refunds it in full on removal', () => {
    const sim = terminalSim();
    const g = sim.business.grids[0]!;
    const cash = sim.cash;
    expect(run(sim, { type: 'placeProp', building: g.id, asset: 'decor.planterLarge', x: 180, y: 98, rot: 0 })).toEqual([]);
    expect(sim.cash).toBe(cash - propCost('decor.planterLarge'));
    expect(g.props.at(-1)).toEqual({ asset: 'decor.planterLarge', x: 180, y: 98, rot: 0 });
    expect(run(sim, { type: 'removeProp', building: g.id, x: 181, y: 99 })).toEqual([]);
    expect(sim.cash).toBe(cash);
    expect(run(sim, { type: 'removeProp', building: g.id, x: 181, y: 99 })).toEqual(['nothingThere']);
  });

  it('refuses seating and toilet fixtures, which are props now', () => {
    const sim = terminalSim();
    const g = sim.business.grids[0]!;
    expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: { op: 'fixture', x0: 90, y0: 48, x1: 91, y1: 49, variant: KEY('seating') } })).toEqual(['fixtureIsProp']);
  });

  it('blocks walking on prop cells, so no walk node stands there', () => {
    const sim = terminalSim();
    const g = sim.business.grids[0]!;
    const wg = sim.business.walkGraphs[0]!;
    const seat = cell(g, 76, 46);
    expect(wg.blocked[seat]).toBe(1);
    expect(wg.cellMain[seat]).toBe(-1);
    expect(wg.cellMain[cell(g, 76, 47)]).toBeGreaterThanOrEqual(0);
  });

  it('decoration raises the ambience score and seats the comfort score', () => {
    const sim = terminalSim();
    const g = sim.business.grids[0]!;
    expect(sim.business.comfortScore).toBeGreaterThan(0);
    const before = sim.business.ambienceScore;
    expect(run(sim, { type: 'placeProp', building: g.id, asset: 'decor.fountain', x: 186, y: 96, rot: 0 })).toEqual([]);
    expect(sim.business.ambienceScore).toBeGreaterThan(before);
  });

  it('two runs from one seed give identical hashes', () => {
    const a = terminalSim();
    const b = terminalSim();
    for (const s of [a, b]) {
      const g = s.business.grids[0]!;
      expect(run(s, { type: 'placeProp', building: g.id, asset: 'decor.planterSmall', x: 186, y: 98, rot: 1 })).toEqual([]);
      s.enqueue({ type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
      for (let t = 0; t < 2000; t++) s.step();
    }
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('a save mid run restores the props and runs on to the same hash', () => {
    const a = terminalSim();
    run(a, { type: 'signAirline', airlineId: 0, sign: true });
    for (let t = 0; t < 1500; t++) a.step();
    const b = new Sim('GOLDEN-0001', OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.business.grids[0]!.props).toEqual(a.business.grids[0]!.props);
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 1000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });

  it('a version 35 save turns its seating and toilet fixtures into props', () => {
    const a = terminalSim();
    const g = a.business.grids[0]!;
    // Lay the old fixtures by hand, as a save from before T76 holds them.
    g.props.length = 0;
    for (const x of [76, 77]) g.fixture[cell(g, x, 46)] = KEY('seating');
    g.fixture[cell(g, 84, 40)] = KEY('toilet');
    const data = JSON.parse(JSON.stringify(a.serialize())) as { version: number; business: { grids: { props?: unknown }[] } };
    data.version = 35;
    delete data.business.grids[0]!.props;
    const b = new Sim('GOLDEN-0001', OPTIONS);
    b.restore(data);
    const h = b.business.grids[0]!;
    expect(SAVE_VERSION).toBe(45);
    expect(h.fixture.includes(KEY('seating'))).toBe(false);
    expect(h.fixture.includes(KEY('toilet'))).toBe(false);
    expect(h.props.filter((p) => p.asset === 'bench.beam3')).toHaveLength(4);
    expect(h.props.filter((p) => p.asset === 'washroom.wcStall')).toHaveLength(2);
    const sn = b.business.serviceNodes[0]!;
    let servers = 0;
    for (let k = 0; k < sn.count; k++) if (sn.kind[k] === KEY('toilet')) servers += sn.servers[k]!;
    expect(servers).toBe(2);
    const ev: string[] = [];
    b.step();
    b.drainEvents(ev);
    expect(ev).toContain('propsConverted|n=3');
  });
});
