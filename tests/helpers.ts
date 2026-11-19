import { Sim } from '@sim/sim';
import type { Command } from '@sim/commands';
import type { StandType } from '@shared/airfield';
import { GROUND, STAND_SIZES } from '@data/index';
import { sizeForCode } from '@shared/standSizes';
import { originFor } from '@shared/terminalOps';
import { standRoadAnchors } from '@shared/roadGraph';

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
  /** Build a depot west of the stand row and a service road along the stand tops (T60). Defaults to true. */
  ground?: boolean;
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
  if (o.ground !== false) errors.push(...buildTestGround(sim));
  if (errors.length > 0) throw new Error(`test airport failed: ${errors.join(', ')}`);
}

/**
 * A ground handling depot west of the stands and one service road from its exit through every stand
 * connection point, so turnarounds run at full speed and vehicles drive from the depot. Returns problems.
 */
export function buildTestGround(sim: Sim): string[] {
  const conns = sim.airfield.data.stands.map((s) => standRoadAnchors(s)?.conn).filter((p) => p !== undefined);
  if (conns.length === 0) return ['noStands'];
  conns.sort((a, b) => a.x - b.x);
  const y = conns[0].y;
  // Just west of the westmost apron, door side east, so the depot sits off the pavement.
  let west = conns[0].x;
  for (const a of sim.airfield.data.aprons) for (const p of a.polygon) west = Math.min(west, p.x);
  const x = west - 25;
  const problems = run(sim, { type: 'buildDepot', x, y, headingDeg: 90 });
  // One road through every connection point, laid in pieces of at most 60 points that join end to end.
  const line = [{ x: x + GROUND.depot.depthM / 2 + GROUND.depot.exitGapM, y }, ...conns];
  for (let i = 0; i + 1 < line.length; i += 59) problems.push(...run(sim, { type: 'buildRoad', points: line.slice(i, i + 60) }));
  // A fire station with three vehicles beside the depot, category 10, so airline flights never meet the fire rule (T65).
  problems.push(...run(sim, { type: 'buildBuilding', kind: 'fire', x, y: y + GROUND.depot.widthM / 2 + GROUND.buildings.fire.widthM / 2 + 5, headingDeg: 90 }));
  const station = sim.airfield.data.buildings?.find((b) => b.kind === 'fire');
  if (station) for (let k = 0; k < GROUND.fire.maxVehicles; k++) problems.push(...run(sim, { type: 'buyFireVehicle', id: station.id }));
  // Top the fleet up to the kit the tests used before depots, so turnaround timing stays as it was.
  for (const [kind, count] of [['beltloader', 1], ['refueller', 1], ['gpu', 1]] as const) problems.push(...run(sim, { type: 'buyGse', kind, count }));
  return problems;
}

export interface TerminalOptions {
  checkIn?: number;
  security?: number;
  belt?: number;
  seating?: number;
  toilet?: number;
  gateDesk?: number;
  shop?: boolean;
  /** Build the ATC tower too. Set false to test the no ATC case. */
  atc?: boolean;
  /** World metres of the terminal origin. Defaults to the spot south of the test apron. */
  at?: { x: number; y: number };
}

/** A free spot north west of the test airport, clear of every pavement and stand. */
const TEST_TOWER = { x: 2700, y: 4800 } as const;

/**
 * Lays a small terminal south of the test apron with the commands a player would use: a
 * foundation, a tile floor, walls with a door, and fixtures. Returns problems, empty on success.
 */
export function buildTestTerminal(sim: Sim, o: TerminalOptions = {}): string[] {
  const { ox, oy } = originFor(o.at?.x ?? 3960, o.at?.y ?? 5440, 90);
  const problems: string[] = [];
  const edit = (building: number, e: { op: 'foundation' | 'floor' | 'erase' | 'wall' | 'removeWall' | 'fixture' | 'zone'; x0: number; y0: number; x1: number; y1: number; variant: number; rot?: 0 | 1 | 2 | 3; level?: number }): void => {
    problems.push(...run(sim, { type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e }));
  };
  edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 100, y1: 52, variant: 0 });
  const id = sim.business.grids[sim.business.grids.length - 1]?.id ?? 1;
  edit(id, { op: 'floor', x0: 40, y0: 40, x1: 100, y1: 52, variant: 2 });
  edit(id, { op: 'wall', x0: 40, y0: 40, x1: 100, y1: 40, variant: 1 });
  edit(id, { op: 'wall', x0: 40, y0: 52, x1: 100, y1: 52, variant: 1 });
  edit(id, { op: 'wall', x0: 70, y0: 52, x1: 72, y1: 52, variant: 3 });
  // A door needs floor on both sides to be a walk node, so a gate desk layout gets a strip outside the door.
  if ((o.gateDesk ?? 0) > 0) {
    edit(id, { op: 'foundation', x0: 68, y0: 52, x1: 74, y1: 53, variant: 0 });
    edit(id, { op: 'floor', x0: 68, y0: 52, x1: 74, y1: 53, variant: 2 });
  }
  const row = (key: number, n: number, x: number, y: number): void => {
    if (n > 0) edit(id, { op: 'fixture', x0: x, y0: y, x1: x + n, y1: y + 1, variant: key });
  };
  // A secure hall on the east side, closed by a wall with one opening that holds the security lanes.
  edit(id, { op: 'zone', x0: 72, y0: 40, x1: 100, y1: 52, variant: 3 });
  edit(id, { op: 'wall', x0: 72, y0: 40, x1: 72, y1: 42, variant: 1 });
  // The wall leaves a gap at rows 50 and 51 for the security exit.
  edit(id, { op: 'wall', x0: 72, y0: 45, x1: 72, y1: 50, variant: 1 });
  row(1, o.checkIn ?? 8, 42, 42);
  const lanes = o.security ?? 3;
  if (lanes > 0) edit(id, { op: 'fixture', x0: 72, y0: 42, x1: 73, y1: 42 + Math.min(3, lanes), variant: 2, rot: 1 });
  // Passengers leave the secure hall through one exit that flows west, from secure to public.
  if (lanes > 0) edit(id, { op: 'fixture', x0: 72, y0: 51, x1: 73, y1: 52, variant: 20, rot: 3, level: 1 });
  row(3, o.belt ?? 2, 62, 42);
  row(4, o.seating ?? 6, 76, 46);
  row(5, o.toilet ?? 2, 84, 46);
  row(16, o.gateDesk ?? 0, 76, 42);
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

/**
 * A hall for the arrival journey (T20): a public hall with a curb door on the south wall, a secure hall and an
 * international hall on the east side, behind a wall with a security lane, a security exit, a passport booth and an
 * eGate, the last two in arrival mode. Gate desks stand in the secure and in the international hall. Returns
 * problems, empty on success.
 */
export function buildArrivalTerminal(sim: Sim, o: { eGate?: boolean; passport?: boolean; customs?: boolean; carousel?: boolean } = {}): string[] {
  const { ox, oy } = originFor(3960, 5440, 90);
  const problems: string[] = [];
  const edit = (building: number, e: { op: 'foundation' | 'floor' | 'wall' | 'fixture' | 'zone'; x0: number; y0: number; x1: number; y1: number; variant: number; rot?: 0 | 1 | 2 | 3; level?: number; mode?: number }): void => {
    problems.push(...run(sim, { type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e }));
  };
  edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 100, y1: 60, variant: 0 });
  const id = sim.business.grids[sim.business.grids.length - 1]?.id ?? 1;
  edit(id, { op: 'floor', x0: 40, y0: 40, x1: 100, y1: 60, variant: 2 });
  edit(id, { op: 'wall', x0: 40, y0: 40, x1: 100, y1: 40, variant: 1 });
  edit(id, { op: 'wall', x0: 40, y0: 60, x1: 100, y1: 60, variant: 1 });
  edit(id, { op: 'wall', x0: 50, y0: 60, x1: 52, y1: 60, variant: 3 });
  edit(id, { op: 'foundation', x0: 48, y0: 60, x1: 54, y1: 61, variant: 0 });
  edit(id, { op: 'floor', x0: 48, y0: 60, x1: 54, y1: 61, variant: 2 });
  edit(id, { op: 'zone', x0: 72, y0: 40, x1: 100, y1: 50, variant: 3 });
  edit(id, { op: 'zone', x0: 72, y0: 50, x1: 100, y1: 60, variant: 5 });
  // The dividing wall leaves one edge open at each fixture row.
  for (const [y0, y1] of [[40, 42], [43, 47], [48, 52], [53, 55], [56, 60]] as const) edit(id, { op: 'wall', x0: 72, y0, x1: 72, y1, variant: 1 });
  edit(id, { op: 'wall', x0: 72, y0: 50, x1: 100, y1: 50, variant: 1 });
  edit(id, { op: 'fixture', x0: 72, y0: 42, x1: 73, y1: 43, variant: 2, rot: 1 });
  edit(id, { op: 'fixture', x0: 72, y0: 47, x1: 73, y1: 48, variant: 20, rot: 3, level: 1 });
  if (o.passport !== false) edit(id, { op: 'fixture', x0: 72, y0: 52, x1: 73, y1: 53, variant: 15, rot: 3, mode: 1 });
  if (o.eGate !== false) edit(id, { op: 'fixture', x0: 72, y0: 55, x1: 73, y1: 56, variant: 21, rot: 3, mode: 1 });
  edit(id, { op: 'fixture', x0: 80, y0: 42, x1: 82, y1: 43, variant: 16 });
  edit(id, { op: 'fixture', x0: 80, y0: 57, x1: 82, y1: 58, variant: 16 });
  edit(id, { op: 'fixture', x0: 42, y0: 42, x1: 44, y1: 43, variant: 1 });
  problems.push(...run(sim, { type: 'buildTower', x: 2700, y: 4800, level: 5 }));
  return problems;
}
