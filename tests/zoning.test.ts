import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@data/index';
import { AUD, effectiveZones, stepAud, transitionBadges, zoneAccess, zoneBreaches, zoneIssues } from '@shared/terminalZones';
import { grid, paint, put, wall } from './zoningGrid';
import { FIXTURE_FOOTPRINT, FIXTURE_KEYS, FLOOR, WALL, footprintOf, type TerminalGrid } from '@shared/business';
import { cellIndex, ensureCells, fixtureAnchor, fixtureCells, newGrid, planEdit, type TerminalEdit } from '@shared/terminalOps';
import type { AirfieldPayload } from '@shared/airfield';
import type { BuildContext } from '@shared/validate';

describe('zoning constants', () => {
  it('appends the new fixture keys after the old ones', () => {
    expect(FIXTURE_KEYS.indexOf('securityExit') + 1).toBe(20);
    expect(FIXTURE_KEYS.indexOf('eGate') + 1).toBe(21);
    expect(FIXTURE_KEYS.indexOf('customs') + 1).toBe(22);
    expect(FIXTURE_KEYS[0]).toBe('checkIn');
    expect(FIXTURE_KEYS[18]).toBe('carousel');
  });

  it('has a footprint entry per key', () => {
    for (const k of FIXTURE_KEYS) expect(FIXTURE_FOOTPRINT[k].length).toBeGreaterThan(0);
  });

  it('picks the footprint by level', () => {
    expect(footprintOf('securityExit', 2)).toEqual([1, 3]);
    expect(footprintOf('securityExit', 0)).toEqual([2, 2]);
    expect(footprintOf('customs', 3)).toEqual([2, 2]);
  });
});

describe('footprint helpers', () => {
  it('finds the anchor from every cell and erases all four cells', () => {
    const env = { ctx: {} as BuildContext, af: {} as AirfieldPayload, others: [] as TerminalGrid[] };
    const g = newGrid(1, 0, 0, 0);
    ensureCells(g, 0, 0, 32, 32);
    for (let i = 0; i < g.floor.length; i++) g.floor[i] = FLOOR.Tile;
    const anchor = cellIndex(g, 2, 2);
    g.fixture[anchor] = FIXTURE_KEYS.indexOf('customs') + 1;
    g.fixtureRot[anchor] = 2;
    g.fixtureLevel[anchor] = 1;
    // Rot 1 runs along +row, across is -column: cells (2,2) (2,3) (1,2) (1,3).
    const tails: [number, number, number][] = [[2, 3, 1], [1, 2, 1 << 4], [1, 3, 1 | (1 << 4)]];
    for (const [x, y, off] of tails) {
      const c = cellIndex(g, x, y);
      g.fixture[c] = g.fixture[anchor];
      g.fixtureRot[c] = 6;
      g.fixtureOff[c] = off;
      g.fixtureLevel[c] = 1;
    }
    const cells = fixtureCells(g, anchor);
    expect(cells.length).toBe(4);
    for (const c of cells) expect(fixtureAnchor(g, c)).toBe(anchor);
    expect(fixtureAnchor(g, cellIndex(g, 5, 5))).toBe(-1);
    const plan = planEdit(g, { op: 'erase', x0: 1, y0: 3, x1: 2, y1: 4, variant: 0 }, env);
    expect(plan.problem).toBeNull();
    plan.apply();
    for (const c of cells) expect(g.fixture[c]).toBe(0);
  });
});

describe('placement of zoning fixtures', () => {
  const env = { ctx: {} as BuildContext, af: {} as AirfieldPayload, others: [] as TerminalGrid[] };
  const id = (k: (typeof FIXTURE_KEYS)[number]): number => FIXTURE_KEYS.indexOf(k) + 1;
  const floor = (): TerminalGrid => {
    const g = newGrid(1, 0, 0, 0);
    ensureCells(g, 0, 0, 32, 32);
    g.floor.fill(FLOOR.Tile);
    return g;
  };
  const edit = (g: TerminalGrid, e: Partial<TerminalEdit> & Pick<TerminalEdit, 'op' | 'variant'>) => planEdit(g, { x0: 4, y0: 4, x1: 5, y1: 5, ...e }, env);

  it('covers 1 by 3 cells for security exit level 2 and prices level 3', () => {
    const g = floor();
    const p = edit(g, { op: 'fixture', variant: id('securityExit'), rot: 0, level: 2 });
    expect(p.problem).toBeNull();
    p.apply();
    const anchor = cellIndex(g, 4, 4);
    expect(fixtureCells(g, anchor).length).toBe(3);
    expect(g.fixtureLevel[cellIndex(g, 4, 6)]).toBe(2);
    expect(g.fixtureOff[cellIndex(g, 4, 6)]).toBe(2 << 4);
    const p3 = edit(floor(), { op: 'fixture', variant: id('securityExit'), level: 3 });
    expect(p3.cost).toBe(60000);
    expect(p3.cost).toBe(BUSINESS.fixtureCosts['securityExit.revolving']);
  });

  it('flips the mode of a passport desk and refuses an empty rect', () => {
    const g = floor();
    edit(g, { op: 'fixture', variant: id('passport') }).apply();
    expect(edit(g, { op: 'mode', variant: 1, x0: 0, y0: 0, x1: 2, y1: 2 }).problem).not.toBeNull();
    const p = edit(g, { op: 'mode', variant: 1 });
    expect(p.problem).toBeNull();
    p.apply();
    expect(g.fixtureMode[cellIndex(g, 4, 4)]).toBe(1);
  });

  it('prices a staff door per edge', () => {
    const g = floor();
    const p = edit(g, { op: 'wall', variant: WALL.StaffDoor, x0: 4, y0: 4, x1: 7, y1: 4 });
    expect(p.cost).toBe(3 * BUSINESS.terminal.staffDoorPerEdge);
  });
});

describe('zone access', () => {
  const split = () => {
    const g = grid(10, 5);
    paint(g, 0, 0, 5, 5, 1);
    paint(g, 5, 0, 10, 5, 3);
    return g;
  };
  const cell = (g: TerminalGrid, x: number, y: number): number => y * g.w + x;

  // A security lane is 2 by 8 cells (T74), so its tests use a wider hall split at column 9: the lane anchored at
  // (9, 2) flowing east covers columns 2 to 9 on rows 2 and 3.
  const wide = () => {
    const g = grid(16, 6);
    paint(g, 0, 0, 9, 6, 1);
    paint(g, 9, 0, 16, 6, 3);
    return g;
  };

  it('opens public to secure one way through a lane', () => {
    const g = wide();
    put(g, 'security', 9, 2, 1);
    const acc = zoneAccess(g);
    for (const y of [2, 3]) {
      expect(stepAud(acc, g, 8, y, 1)).toBe(AUD.Pax | AUD.Staff);
      expect(stepAud(acc, g, 9, y, 0)).toBe(0);
    }
    expect(stepAud(acc, g, 8, 1, 1)).toBe(0);
    expect(stepAud(acc, g, 8, 4, 1)).toBe(0);
  });

  it('closes a backwards security exit both ways', () => {
    const g = split();
    put(g, 'securityExit', 5, 3, 1);
    const acc = zoneAccess(g);
    for (const y of [2, 3]) {
      expect(stepAud(acc, g, 4, y, 1)).toBe(0);
      expect(stepAud(acc, g, 5, y, 0)).toBe(0);
    }
  });

  it('lets a security exit carry people from secure to public', () => {
    const g = split();
    put(g, 'securityExit', 5, 3, 3);
    const acc = zoneAccess(g);
    expect(stepAud(acc, g, 5, 3, 0)).toBe(AUD.Pax | AUD.Staff);
    expect(stepAud(acc, g, 4, 3, 1)).toBe(0);
  });

  it('gives a staff door to staff only', () => {
    const g = split();
    wall(g, false, 5, 1, 4);
    const acc = zoneAccess(g);
    expect(stepAud(acc, g, 4, 1, 1)).toBe(AUD.Staff);
    expect(stepAud(acc, g, 5, 1, 0)).toBe(AUD.Staff);
  });

  it('keeps a plain door between zones closed', () => {
    const g = split();
    wall(g, false, 5, 3, 3);
    const acc = zoneAccess(g);
    expect(stepAud(acc, g, 4, 3, 1)).toBe(0);
    expect(stepAud(acc, g, 5, 3, 0)).toBe(0);
  });

  it('lets commercial adopt its side and stay apart when it has two', () => {
    const g = split();
    paint(g, 3, 0, 4, 1, 2);
    expect(effectiveZones(g)[cell(g, 3, 0)]).toBe(1);
    expect(stepAud(zoneAccess(g), g, 2, 0, 1)).toBe(3);
    paint(g, 4, 0, 5, 1, 2);
    expect(effectiveZones(g)[cell(g, 4, 0)]).toBe(2);
    const acc = zoneAccess(g);
    expect(stepAud(acc, g, 4, 0, 1)).toBe(0);
    expect(stepAud(acc, g, 2, 0, 1)).toBe(0);
  });

  it('keeps a staff door on a transition edge staff only', () => {
    const g = wide();
    put(g, 'security', 9, 2, 1);
    wall(g, false, 9, 2, 4);
    const acc = zoneAccess(g);
    expect(stepAud(acc, g, 8, 2, 1)).toBe(AUD.Staff);
    expect(stepAud(acc, g, 9, 2, 0)).toBe(AUD.Staff);
  });

  it('gives a security lane in staff mode to staff only', () => {
    const g = wide();
    put(g, 'security', 9, 2, 1, 1, 1);
    const acc = zoneAccess(g);
    expect(stepAud(acc, g, 8, 2, 1)).toBe(AUD.Staff);
    expect(stepAud(acc, g, 9, 2, 0)).toBe(0);
  });

  it('flips a passport desk and an automated gate between departure and arrival', () => {
    for (const key of ['passport', 'eGate'] as const) {
      const g = grid(10, 5);
      paint(g, 0, 0, 5, 5, 5);
      paint(g, 5, 0, 10, 5, 1);
      put(g, key, 5, 2, 1, 1, 1);
      const arrival = zoneAccess(g);
      expect(stepAud(arrival, g, 4, 2, 1)).toBe(AUD.Pax | AUD.Staff);
      expect(stepAud(arrival, g, 5, 2, 0)).toBe(0);
      const d = grid(10, 5);
      paint(d, 0, 0, 5, 5, 3);
      paint(d, 5, 0, 10, 5, 5);
      put(d, key, 5, 2, 1, 1, 0);
      expect(stepAud(zoneAccess(d), d, 4, 2, 1)).toBe(AUD.Pax | AUD.Staff);
      const wrong = grid(10, 5);
      paint(wrong, 0, 0, 5, 5, 3);
      paint(wrong, 5, 0, 10, 5, 5);
      put(wrong, key, 5, 2, 1, 1, 1);
      expect(stepAud(zoneAccess(wrong), wrong, 4, 2, 1)).toBe(0);
    }
  });
});

describe('zone breaches and issues', () => {
  const split = () => {
    const g = grid(10, 5);
    paint(g, 0, 0, 5, 5, 1);
    paint(g, 5, 0, 10, 5, 3);
    for (let y = 0; y < 5; y++) wall(g, false, 5, y, 1);
    return g;
  };
  // A wider hall split at column 9 with a wall along the split, for the 2 by 8 cell security lane (T74).
  const wide = () => {
    const g = grid(16, 6);
    paint(g, 0, 0, 9, 6, 1);
    paint(g, 9, 0, 16, 6, 3);
    for (let y = 0; y < 6; y++) wall(g, false, 9, y, 1);
    return g;
  };

  it('lists the three plain doors between zones as breaches', () => {
    const g = split();
    for (const y of [1, 2, 3]) wall(g, false, 5, y, 3);
    const breaches = zoneBreaches(g, zoneAccess(g));
    expect(breaches).toEqual([1, 2, 3].map((y) => ({ x: 5, y, horizontal: false })));
    expect(zoneIssues(g, zoneAccess(g))).toContain('zoneBreach');
  });

  it('has one badge per transition fixture at the front edge', () => {
    const g = wide();
    put(g, 'security', 9, 2, 1);
    // The exit's west side is its use area, so the split wall opens there (T85).
    wall(g, false, 9, 4, 0);
    wall(g, false, 9, 5, 0);
    put(g, 'securityExit', 9, 5, 3);
    const badges = transitionBadges(g);
    expect(badges.length).toBe(2);
    expect(badges[0]).toEqual({ x: 20, y: 6, to: 3, dx: 1, dy: 0 });
    expect(badges[1].to).toBe(1);
  });

  it('flags a security exit placed backwards', () => {
    const g = split();
    put(g, 'securityExit', 5, 3, 1);
    expect(zoneIssues(g, zoneAccess(g))).toContain('transitionOrientation');
  });

  it('flags a secure hall without an exit and clears it with one', () => {
    const g = wide();
    wall(g, false, 9, 2, 0);
    wall(g, false, 9, 3, 0);
    put(g, 'security', 9, 2, 1);
    expect(zoneIssues(g, zoneAccess(g))).toContain('paxCannotLeave');
    wall(g, false, 9, 5, 0);
    wall(g, false, 9, 4, 0);
    put(g, 'securityExit', 9, 5, 3);
    expect(zoneIssues(g, zoneAccess(g))).not.toContain('paxCannotLeave');
  });

  it('flags a staff door that bypasses screening and clears it with a staff lane', () => {
    const g = wide();
    wall(g, false, 9, 2, 4);
    expect(zoneIssues(g, zoneAccess(g))).toContain('staffBypass');
    wall(g, false, 9, 2, 0);
    wall(g, false, 9, 3, 0);
    put(g, 'security', 9, 2, 1, 1, 1);
    expect(zoneIssues(g, zoneAccess(g))).not.toContain('staffBypass');
  });
});
