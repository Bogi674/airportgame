import { Sim } from '@sim/sim';
import type { Command } from '@sim/commands';
import type { StandType } from '@shared/airfield';
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
  const spacing = { A: 18, B: 27, C: 45, D: 60, E: 70 }[code];
  const type = o.standType ?? 'remotePushback';
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
  go({ type: 'buildStands', x: x0 + 800 + span - 50, y: 5330, headingDeg: 180, count: per, spacingM: spacing, standType: type, code });
  if (errors.length > 0) throw new Error(`test airport failed: ${errors.join(', ')}`);
}

export interface TerminalOptions {
  checkIn?: number;
  security?: number;
  belt?: number;
  seating?: number;
  toilet?: number;
  shop?: boolean;
  /** Set false to leave out the control room. */
  atc?: boolean;
}

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
  row(1, o.checkIn ?? 8, 42, 42);
  row(2, o.security ?? 3, 54, 42);
  row(3, o.belt ?? 2, 62, 42);
  row(4, o.seating ?? 6, 70, 46);
  row(5, o.toilet ?? 2, 80, 46);
  if (o.shop) row(6, 1, 84, 46);
  if (o.atc !== false) edit(id, { op: 'fixture', x0: 88, y0: 48, x1: 90, y1: 50, variant: 12 });
  return problems;
}
