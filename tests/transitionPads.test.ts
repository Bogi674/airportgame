import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@data/index';
import { FIXTURE_KEYS, FLOOR, ZONE, footprintOf, type TerminalGrid } from '@shared/business';
import { cellIndex, ensureCells, newGrid, planEdit, type TerminalEdit } from '@shared/terminalOps';
import { transitionPads } from '@shared/transitionPads';
import { effectiveZones, pendingExitBadges, transitionBadges, zoneAccess, zoneIssues } from '@shared/terminalZones';
import type { AirfieldPayload } from '@shared/airfield';
import type { BuildContext } from '@shared/validate';

const env = { ctx: {} as BuildContext, af: {} as AirfieldPayload, others: [] as TerminalGrid[] };
const id = (k: (typeof FIXTURE_KEYS)[number]): number => FIXTURE_KEYS.indexOf(k) + 1;
const floor = (): TerminalGrid => {
  const g = newGrid(1, 0, 0, 0);
  ensureCells(g, 0, 0, 32, 32);
  g.floor.fill(FLOOR.Tile);
  return g;
};
const place = (g: TerminalGrid, e: Partial<TerminalEdit> & Pick<TerminalEdit, 'op' | 'variant'>): void => {
  const p = planEdit(g, { x0: 10, y0: 10, x1: 11, y1: 11, ...e }, env);
  expect(p.problem).toBeNull();
  p.apply();
};
const zoneOf = (g: TerminalGrid, x: number, y: number): number => g.zone[cellIndex(g, x, y)];
const D = BUSINESS.terminal.transitionPadCells;

describe('transition pads (T88)', () => {
  it('lists a block as wide as the fixture and pad cells deep on each side', () => {
    const [along] = footprintOf('security', 1);
    const pads = transitionPads('security', 1, 0, 10, 10, 0);
    expect(pads).not.toBeNull();
    expect(pads!.from).toBe(ZONE.Public);
    expect(pads!.to).toBe(ZONE.Secure);
    expect(pads!.intake.length).toBe(along * D);
    expect(pads!.exit.length).toBe(along * D);
    expect(transitionPads('checkIn', 1, 0, 10, 10, 0)).toBeNull();
  });

  it('paints Secure past the exit of a security lane and Public before its intake, so the lane works', () => {
    for (const rot of [0, 1, 2, 3] as const) {
      const g = floor();
      place(g, { op: 'fixture', variant: id('security'), rot });
      const pads = transitionPads('security', 1, 0, 10, 10, rot)!;
      for (const [x, y] of pads.exit) expect(zoneOf(g, x, y)).toBe(ZONE.Secure);
      for (const [x, y] of pads.intake) expect(zoneOf(g, x, y)).toBe(ZONE.Public);
      expect(zoneIssues(g, zoneAccess(g))).not.toContain('transitionOrientation');
    }
  });

  it('follows the from and to zones of each transition and mode', () => {
    const cases: [(typeof FIXTURE_KEYS)[number], number, number, number][] = [
      ['securityExit', 0, ZONE.Secure, ZONE.Public],
      ['passport', 0, ZONE.Secure, ZONE.International],
      ['passport', 1, ZONE.International, ZONE.Public],
      ['eGate', 1, ZONE.International, ZONE.Public],
    ];
    for (const [key, mode, from, to] of cases) {
      const g = floor();
      place(g, { op: 'fixture', variant: id(key), mode });
      const pads = transitionPads(key, 1, mode, 10, 10, 0)!;
      for (const [x, y] of pads.intake) expect(zoneOf(g, x, y)).toBe(from);
      for (const [x, y] of pads.exit) expect(zoneOf(g, x, y)).toBe(to);
    }
  });

  it('never paints over a zone the player chose, except the from zone past the exit', () => {
    const g = floor();
    const pads = transitionPads('security', 1, 0, 10, 10, 0)!;
    const [sx, sy] = pads.exit[0]!;
    const [px, py] = pads.exit[1]!;
    const [ix, iy] = pads.intake[0]!;
    g.zone[cellIndex(g, sx, sy)] = ZONE.Staff;
    g.zone[cellIndex(g, px, py)] = ZONE.Public;
    g.zone[cellIndex(g, ix, iy)] = ZONE.International;
    place(g, { op: 'fixture', variant: id('security'), rot: 0 });
    expect(zoneOf(g, sx, sy)).toBe(ZONE.Staff);
    expect(zoneOf(g, px, py)).toBe(ZONE.Secure);
    expect(zoneOf(g, ix, iy)).toBe(ZONE.International);
  });

  it('keeps the player zones when the fixture is placed backwards', () => {
    const g = floor();
    const pads = transitionPads('security', 1, 0, 10, 10, 0)!;
    for (const [x, y] of pads.intake) g.zone[cellIndex(g, x, y)] = ZONE.Secure;
    for (const [x, y] of pads.exit) g.zone[cellIndex(g, x, y)] = ZONE.Public;
    place(g, { op: 'fixture', variant: id('security'), rot: 0 });
    for (const [x, y] of pads.exit) expect(zoneOf(g, x, y)).toBe(ZONE.Public);
    expect(zoneIssues(g, zoneAccess(g))).toContain('transitionOrientation');
  });

  it('skips cells without floor', () => {
    const g = floor();
    const pads = transitionPads('security', 1, 0, 10, 10, 0)!;
    // The outermost row: the first row past the exit is the lane's use area and needs floor.
    const [x, y] = pads.exit[pads.exit.length - 1]!;
    g.floor[cellIndex(g, x, y)] = 0;
    place(g, { op: 'fixture', variant: id('security'), rot: 0 });
    expect(zoneOf(g, x, y)).toBe(0);
  });

  it('pulses an exit until its zone reaches past the attached block', () => {
    const g = floor();
    place(g, { op: 'fixture', variant: id('security'), rot: 0 });
    expect(transitionBadges(g).length).toBe(1);
    expect(pendingExitBadges(g, effectiveZones(g)).length).toBe(1);
    const pads = transitionPads('security', 1, 0, 10, 10, 0)!;
    // One more secure cell joined to the block carries the zone on.
    const [x, y] = pads.exit[pads.exit.length - 1]!;
    const step = pads.flow;
    g.zone[cellIndex(g, x + step[0], y + step[1])] = ZONE.Secure;
    expect(pendingExitBadges(g, effectiveZones(g)).length).toBe(0);
  });
});
