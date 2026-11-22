import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { ARRIVALS } from '@data/index';
import { Sim } from '@sim/sim';
import { Stage } from '@sim/cohorts/cohorts';
import { buildServiceNodes } from '@sim/terminal/serviceNodes';
import { FIXTURE_KEYS } from '@shared/business';
import { buildArrivalTerminal, buildTestAirport, OPTIONS, ownedSim, run } from './helpers';

const A320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');
const SEC_EXIT = FIXTURE_KEYS.indexOf('securityExit') + 1;

function arrivalHall(seed?: string): Sim {
  const sim = ownedSim(seed);
  sim.cash = 1_000_000_000;
  buildTestAirport(sim, { standsPerRow: 8 });
  expect(buildArrivalTerminal(sim, { carousel: true, customs: true })).toEqual([]);
  return sim;
}

/** Docks a domestic or international airline flight on stand 0 and steps until its passengers were counted. */
function dockRoute(sim: Sim, international: boolean): void {
  const market = sim.business.market;
  const dest = market.destinations.find((d) => d.international === international)!;
  const id = international ? 9001 : 9002;
  market.series.push({ id, airline: 0, dest: dest.id, typeIdx: A320, days: 127, winMin: 0, startDay: 0, endDay: 100, standId: -1, minute: -1, turnMin: 30 });
  const f = sim.traffic.scheduleArrival(A320, sim.traffic.nowTick + 100, 0, 600, -1, 0, id);
  sim.traffic.fStand[f] = sim.airfield.data.stands[0]!.id;
  for (let t = 0; t < 8000 && sim.business.flightPaxOf(f) === 0; t++) sim.step();
  expect(sim.business.flightPaxOf(f)).toBeGreaterThan(0);
}

/** Stages each arrival slot passed through, in order, until no arrival is active. */
function stageSequences(sim: Sim, ticks: number, each?: () => void): number[][] {
  const co = sim.cohorts;
  const seq: number[][] = Array.from({ length: co.cap }, () => []);
  for (let t = 0; t < ticks && co.arrActive > 0; t++) {
    sim.step();
    for (let c = 0; c < co.hi; c++) {
      const st = co.stage[c]!;
      const list = seq[c]!;
      if (st >= Stage.Deboard && list[list.length - 1] !== st) list.push(st);
    }
    each?.();
  }
  return seq;
}

describe('security exit queue (T80)', () => {
  it('every domestic arrival queues at the security exit before the claim and exits at the curb', () => {
    const sim = arrivalHall();
    dockRoute(sim, false);
    const nodes = sim.business.serviceNodes[0]!;
    let exitNodes = 0;
    for (let n = 0; n < nodes.count; n++) if (nodes.kind[n] === SEC_EXIT) exitNodes++;
    expect(exitNodes).toBe(1);
    let longest = 0;
    const seq = stageSequences(sim, 30000, () => {
      for (let n = 0; n < nodes.count; n++) if (nodes.kind[n] === SEC_EXIT) longest = Math.max(longest, nodes.queueLen[n]!);
    });
    let domestic = 0;
    for (const list of seq) {
      if (list.length === 0) continue;
      domestic++;
      const at = list.indexOf(Stage.SecExit);
      expect(at, list.join(',')).toBeGreaterThan(list.indexOf(Stage.Deboard));
      expect(list.indexOf(Stage.ToSecExit)).toBeLessThan(at);
      if (list.includes(Stage.Claim)) expect(list.indexOf(Stage.Claim)).toBeGreaterThan(at);
      expect(list).not.toContain(Stage.Immigration);
    }
    expect(domestic).toBeGreaterThan(0);
    expect(longest).toBeGreaterThan(0);
    expect(sim.cohorts.arrExited).toBe(sim.cohorts.arrGenerated);
  }, 30000);

  it('international arrivals pass immigration and never the security exit', () => {
    const sim = arrivalHall();
    dockRoute(sim, true);
    const seq = stageSequences(sim, 30000);
    for (const list of seq) {
      expect(list).not.toContain(Stage.SecExit);
      expect(list).not.toContain(Stage.ToSecExit);
    }
    expect(sim.cohorts.arrExited).toBe(sim.cohorts.arrGenerated);
  }, 30000);

  it('takes the service time of the exit level from the data', () => {
    const sim = arrivalHall();
    const grid = sim.business.grids[0]!;
    const wg = sim.business.walkGraphs[0]!;
    const cell = grid.fixture.findIndex((id, i) => id === SEC_EXIT && grid.fixtureRot[i]! < 5);
    expect(cell).toBeGreaterThanOrEqual(0);
    for (let level = 1; level <= 3; level++) {
      grid.fixtureLevel[cell] = level;
      const t = buildServiceNodes(grid, wg);
      const n = Array.from(t.cell).indexOf(cell);
      const want = ARRIVALS.service.securityExit.levels[level - 1]!;
      expect(t.meanS[n]).toBeCloseTo(want.serviceSeconds, 5);
      expect(t.servers[n]).toBe(want.servers);
      expect(t.queueCap[n]).toBeGreaterThan(0);
    }
    expect(ARRIVALS.service.securityExit.levels[1]!.serviceSeconds).toBeGreaterThan(ARRIVALS.service.securityExit.levels[2]!.serviceSeconds);
  });

  it('two sims from one seed stay equal over 2000 ticks with arrivals at the exit, and a restore mid queue replays the same', () => {
    const a = arrivalHall('EXIT-0001');
    const b = arrivalHall('EXIT-0001');
    dockRoute(a, false);
    dockRoute(b, false);
    const co = a.cohorts;
    let queued = false;
    for (let t = 0; t < 20000 && !queued; t++) {
      a.step();
      b.step();
      for (let c = 0; c < co.hi && !queued; c++) queued = co.stage[c] === Stage.SecExit;
    }
    expect(queued).toBe(true);
    const r = new Sim('EXIT-0001', OPTIONS);
    r.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(r.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
      r.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
    expect(r.stateHash()).toBe(a.stateHash());
  }, 60000);

  it('sends a queued cohort back to ToSecExit when the exit is removed, and it still leaves the terminal', () => {
    const sim = arrivalHall();
    dockRoute(sim, false);
    const co = sim.cohorts;
    let c = -1;
    for (let t = 0; t < 20000 && c < 0; t++) {
      sim.step();
      for (let k = 0; k < co.hi && c < 0; k++) if (co.stage[k] === Stage.SecExit) c = k;
    }
    expect(c).toBeGreaterThanOrEqual(0);
    const grid = sim.business.grids[0]!;
    // The exit of the arrival hall stands at (72, 47).
    run(sim, { type: 'terminalBuild', building: grid.id, ox: grid.ox, oy: grid.oy, headingDeg: 90, edit: { op: 'erase', x0: 72, y0: 47, x1: 73, y1: 48, variant: 0 } });
    let back = false;
    for (let t = 0; t < 40000 && co.arrActive > 0; t++) {
      sim.step();
      if (co.stage[c] === Stage.ToSecExit) back = true;
    }
    expect(back).toBe(true);
    expect(co.arrActive).toBe(0);
    expect(co.arrExited + co.arrStranded).toBe(co.arrGenerated);
  }, 60000);
});
