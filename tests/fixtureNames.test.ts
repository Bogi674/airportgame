import { describe, expect, it } from 'vitest';
import { FIXTURE_KEYS } from '@shared/business';
import { fixtureLabel, fixtureNameKey } from '@shared/fixtureNames';
import { cellIndex } from '@shared/terminalOps';
import { Sim } from '@sim/sim';
import { migrate } from '@sim/save/migrations';
import { BUSINESS } from '@data/index';
import { buildTestAirport, buildTestTerminal, ownedSim, run, OPTIONS } from './helpers';

const CHECK_IN = FIXTURE_KEYS.indexOf('checkIn') + 1;
const SECURITY = FIXTURE_KEYS.indexOf('security') + 1;

function scene(): Sim {
  const sim = ownedSim();
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, { atc: false })).toEqual([]);
  return sim;
}

const grid = (sim: Sim) => sim.business.grids[0]!;

/** Numbers on the anchors of one fixture kind, in cell index order. */
function numbersOf(sim: Sim, id: number): number[] {
  const out: number[] = [];
  for (const g of sim.business.grids) {
    for (let i = 0; i < g.fixture.length; i++) if (g.fixture[i] === id && g.fixtureRot[i]! < 5) out.push(g.fixtureNo[i]!);
  }
  return out;
}

const countersOf = (sim: Sim): number[] => (sim.business.saveState() as { fixtureCounters: number[] }).fixtureCounters;

describe('fixture numbers (T94)', () => {
  it('numbers each kind from 1 and counts kinds apart', () => {
    const sim = scene();
    expect(numbersOf(sim, CHECK_IN)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(numbersOf(sim, SECURITY)).toEqual([1, 2, 3]);
    const g = grid(sim);
    for (let i = 0; i < g.fixture.length; i++) if (g.fixture[i] !== 0) expect(g.fixtureNo[i]).toBeGreaterThan(0);
  });

  it('does not reuse the number of a removed fixture', () => {
    const sim = scene();
    const g = grid(sim);
    expect(run(sim, { type: 'removeFixture', building: g.id, x: 44, y: 42 })).toEqual([]);
    expect(numbersOf(sim, CHECK_IN)).toEqual([1, 2, 4, 5, 6, 7, 8]);
    run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op: 'fixture', x0: 44, y0: 42, x1: 45, y1: 43, variant: CHECK_IN } });
    expect(g.fixtureNo[cellIndex(g, 44, 42)]).toBe(9);
    expect(countersOf(sim)[CHECK_IN]).toBe(9);
  });

  it('keeps the number when a fixture moves', () => {
    const sim = scene();
    const g = grid(sim);
    const no = g.fixtureNo[cellIndex(g, 49, 42)]!;
    expect(no).toBe(8);
    expect(run(sim, { type: 'moveFixture', building: g.id, x: 49, y: 42, toX: 56, toY: 46, rot: 2 })).toEqual([]);
    expect(g.fixtureNo[cellIndex(g, 56, 46)]).toBe(no);
    expect(g.fixtureNo[cellIndex(g, 49, 42)]).toBe(0);
    expect(countersOf(sim)[CHECK_IN]).toBe(8);
  });

  it('keeps the number through undo and redo of a build and of a removal', () => {
    const sim = scene();
    const g = grid(sim);
    run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op: 'fixture', x0: 50, y0: 42, x1: 51, y1: 43, variant: CHECK_IN } });
    expect(g.fixtureNo[cellIndex(g, 50, 42)]).toBe(9);
    run(sim, { type: 'undo' });
    expect(grid(sim).fixtureNo[cellIndex(grid(sim), 50, 42)]).toBe(0);
    run(sim, { type: 'redo' });
    expect(grid(sim).fixtureNo[cellIndex(grid(sim), 50, 42)]).toBe(9);
    expect(countersOf(sim)[CHECK_IN]).toBe(9);
    run(sim, { type: 'removeFixture', building: g.id, x: 43, y: 42 });
    run(sim, { type: 'undo' });
    expect(grid(sim).fixtureNo[cellIndex(grid(sim), 43, 42)]).toBe(2);
  });
});

describe('fixture names (T94)', () => {
  it('builds the label from the custom name or the kind and number', () => {
    expect(fixtureLabel('Check in desk', 3, undefined)).toBe('Check in desk 3');
    expect(fixtureLabel('Check in desk', 3, 'Desk A')).toBe('Desk A');
    expect(fixtureLabel('Check in desk', 0, undefined)).toBe('Check in desk');
    expect(fixtureNameKey(CHECK_IN, 3)).toBe(`${CHECK_IN}:3`);
  });

  it('sets, caps and clears a custom name in the payload', () => {
    const sim = scene();
    const g = grid(sim);
    const key = fixtureNameKey(CHECK_IN, 1);
    expect(run(sim, { type: 'renameFixture', building: g.id, x: 42, y: 42, name: '  Desk A  ' })).toEqual([]);
    expect(sim.business.payload(sim.tick).fixtureNames[key]).toBe('Desk A');
    const long = 'x'.repeat(40);
    run(sim, { type: 'renameFixture', building: g.id, x: 42, y: 42, name: long });
    expect(sim.business.payload(sim.tick).fixtureNames[key]).toBe('x'.repeat(BUSINESS.terminal.fixtureNameMax));
    run(sim, { type: 'renameFixture', building: g.id, x: 42, y: 42, name: '   ' });
    expect(sim.business.payload(sim.tick).fixtureNames[key]).toBeUndefined();
    expect(run(sim, { type: 'renameFixture', building: g.id, x: 41, y: 41, name: 'Nope' })).toEqual(['nothingThere']);
  });

  it('saves and restores numbers, counters and names with the same hash', () => {
    const sim = scene();
    const g = grid(sim);
    run(sim, { type: 'removeFixture', building: g.id, x: 44, y: 42 }, { type: 'renameFixture', building: g.id, x: 45, y: 42, name: 'Desk Q' });
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(JSON.parse(JSON.stringify(sim.serialize())));
    expect(numbersOf(c, CHECK_IN)).toEqual(numbersOf(sim, CHECK_IN));
    expect(countersOf(c)).toEqual(countersOf(sim));
    expect(c.business.payload(c.tick).fixtureNames).toEqual({ [fixtureNameKey(CHECK_IN, 4)]: 'Desk Q' });
    expect(c.stateHash()).toBe(sim.stateHash());
  });

  it('migrates a version 43 save with numbers in grid then cell order', () => {
    const sim = scene();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as { version: number; business: { grids: Record<string, unknown>[]; fixtureCounters?: number[]; fixtureNames?: unknown } };
    data.version = 43;
    for (const sg of data.business.grids) delete sg.fixtureNo;
    delete data.business.fixtureCounters;
    delete data.business.fixtureNames;
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(migrate(data));
    expect(numbersOf(c, CHECK_IN)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(numbersOf(c, SECURITY)).toEqual([1, 2, 3]);
    expect(countersOf(c)[CHECK_IN]).toBe(8);
    expect(c.business.payload(c.tick).fixtureNames).toEqual({});
    const g = c.business.grids[0]!;
    for (let i = 0; i < g.fixture.length; i++) if (g.fixture[i] !== 0) expect(g.fixtureNo[i]).toBeGreaterThan(0);
  });

  it('gives identical hashes for 2000 ticks from one seed twice', () => {
    const hashOf = (): number => {
      const sim = scene();
      run(sim, { type: 'renameFixture', building: grid(sim).id, x: 42, y: 42, name: 'Desk A' });
      for (let t = 0; t < 2000; t++) sim.step();
      return sim.stateHash();
    };
    expect(hashOf()).toBe(hashOf());
  });
});
