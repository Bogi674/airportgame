import { Sim } from '@sim/sim';
import type { Command } from '@sim/commands';
import type { StandType } from '@shared/airfield';

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
