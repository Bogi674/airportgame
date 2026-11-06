import { Sim } from '@sim/sim';
import type { Command } from '@sim/commands';
import type { StandType } from '@shared/airfield';
import { STAND_SIZES } from '@data/index';
import { sizeForCode } from '@shared/standSizes';
import { originFor } from '@shared/terminalOps';

export const OPTIONS = { preset: 'flatCoastal' } as const;

/** A sim where the player owns the whole site, so tests can place anything on land. */
export function ownedSim(seed = 'GOLDEN-0001'): Sim {
  const sim = new Sim(seed, OPTIONS);
  sim.parcelOwner.fill(1);
  return sim;
}

export function run(sim: Sim, ...cmds: Command[]): string[] {
  for (const c of cmds) sim.enqueue(c);
  sim.step();
  const ev: string[] = [];
  sim.drainEvents(ev);
  return ev;
}

export interface AirportOptions {
  runwayLengthM?: number;
  standsPerRow?: number;
  standType?: StandType;
  standCode?: 'A' | 'B' | 'C' | 'D' | 'E';
}

/**
 * Runway 09/27 with a rapid exit, a one way parallel taxiway A with connectors and a row of
 * stands hanging off it.
 */
export function buildTestAirport(sim: Sim, o: AirportOptions = {}): void {
  const len = o.runwayLengthM ?? 2600;
  const per = o.standsPerRow ?? 8;
  const code = o.standCode ?? 'C';
  const size = sizeForCode(code);
  const spacing = STAND_SIZES[size].widthM;
  const type = o.standType ?? 'remote';
  const x0 = 3000;
  const errors: string[] = [];
  const go = (cmd: Command): void => {
    errors.push(...run(sim, cmd));
  };
  go({ type: 'buildRunway', x: x0, y: 5000, headingDeg: 90, lengthM: len, code: 'C', approach: 'precision', surface: 'asphalt', tier: 2 });
  go({ type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 190, code: 'C', connectors: 4, surface: 'asphalt', tier: 2 });
  go({ type: 'buildRapidExit', runwayId: 1, distM: Math.min(1300, len - 300), side: 'right', angleDeg: 30, code: 'C', surface: 'asphalt', tier: 2 });
  const span = spacing * per + 100;
  go({ type: 'buildApron', polygon: [{ x: x0 + 800, y: 5260 }, { x: x0 + 800 + span, y: 5260 }, { x: x0 + 800 + span, y: 5400 }, { x: x0 + 800, y: 5400 }], surface: 'concrete', tier: 2 });
  // One command places at most 30 stands, so larger rows are laid in batches along the same apron.
  for (let placed = 0; placed < per; placed += 30) {
    go({ type: 'buildStands', x: x0 + 800 + span - 50 - placed * spacing, y: 5330, headingDeg: 180, count: Math.min(30, per - placed), spacingM: spacing, standType: type, size });
  }
  if (errors.length > 0) throw new Error(`test airport failed: ${errors.join(', ')}`);
}

export interface TerminalOptions {
  checkIn?: number;
  security?: number;
  belt?: number;
  seating?: number;
  toilet?: number;
  shop?: boolean;
  /** Build the ATC tower too. Set false to test the no ATC case. */
  atc?: boolean;
}

/** A free spot north west of the test airport, clear of every pavement and stand. */
const TEST_TOWER = { x: 2700, y: 4800 } as const;

/**
 * Lays a small terminal south of the test apron with the commands a player would use: a
 * foundation, a tile floor, walls with a door, and fixtures. Returns problems, empty on success.
 */
export function buildTestTerminal(sim: Sim, o: TerminalOptions = {}): string[] {
  const { ox, oy } = originFor(3960, 5440, 90);
  const problems: string[] = [];
  const edit = (building: number, e: { op: 'foundation' | 'floor' | 'erase' | 'wall' | 'removeWall' | 'fixture' | 'zone'; x0: number; y0: number; x1: number; y1: number; variant: number }): void => {
    problems.push(...run(sim, { type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e }));
  };
  edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 100, y1: 52, variant: 0 });
  const id = sim.business.grids[0]?.id ?? 1;
  edit(id, { op: 'floor', x0: 40, y0: 40, x1: 100, y1: 52, variant: 2 });
  edit(id, { op: 'wall', x0: 40, y0: 40, x1: 100, y1: 40, variant: 1 });
  edit(id, { op: 'wall', x0: 40, y0: 52, x1: 100, y1: 52, variant: 1 });
  edit(id, { op: 'wall', x0: 70, y0: 52, x1: 72, y1: 52, variant: 3 });
  const row = (key: number, n: number, x: number, y: number): void => {
    if (n > 0) edit(id, { op: 'fixture', x0: x, y0: y, x1: x + n, y1: y + 1, variant: key });
  };
  // A secure hall on the east side, closed by a wall with one opening that holds the security lanes.
  edit(id, { op: 'zone', x0: 72, y0: 40, x1: 100, y1: 52, variant: 3 });
  edit(id, { op: 'wall', x0: 72, y0: 40, x1: 72, y1: 42, variant: 1 });
  edit(id, { op: 'wall', x0: 72, y0: 45, x1: 72, y1: 52, variant: 1 });
  row(1, o.checkIn ?? 8, 42, 42);
  const lanes = o.security ?? 3;
  if (lanes > 0) edit(id, { op: 'fixture', x0: 72, y0: 42, x1: 73, y1: 42 + Math.min(3, lanes), variant: 2 });
  row(3, o.belt ?? 2, 62, 42);
  row(4, o.seating ?? 6, 76, 46);
  row(5, o.toilet ?? 2, 84, 46);
  if (o.shop) row(6, 1, 86, 46);
  if (o.atc !== false) problems.push(...run(sim, { type: 'buildTower', x: TEST_TOWER.x, y: TEST_TOWER.y, level: 5 }));
  return problems;
}

/** Paints a legacy control room fixture in the first terminal, to test that it grants no coverage any more. */
export function buildTestControlRoom(sim: Sim): string[] {
  const g = sim.business.grids[0];
  if (!g) return ['noTerminal'];
  const edit = (e: { op: 'fixture' | 'zone'; x0: number; y0: number; x1: number; y1: number; variant: number }): string[] =>
    run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: e });
  return [...edit({ op: 'zone', x0: 88, y0: 48, x1: 90, y1: 50, variant: 4 }), ...edit({ op: 'fixture', x0: 88, y0: 48, x1: 90, y1: 50, variant: 12 })];
}
