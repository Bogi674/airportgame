import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import type { Sim } from '@sim/sim';
import { Stage, type Cohorts } from '@sim/cohorts/cohorts';
import { buildOverlayData, emptyOverlay, OVERLAY_MAX, type OverlayData } from '@sim/terminal/overlays';
import { serviceWait } from '@sim/terminal/serviceNodes';
import { FIXTURE_KEYS } from '@shared/business';
import { buildTestAirport, buildTestTerminal, ownedSim } from './helpers';

const WIDE = AIRCRAFT.findIndex((a) => a.id === 'a320neo');
const LONG_TURN_TICKS = 36000;
const GATE_DESK = FIXTURE_KEYS.indexOf('gateDesk') + 1;

function terminalSim(seed?: string): Sim {
  const sim = ownedSim(seed);
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2 })).toEqual([]);
  const f = sim.traffic.scheduleArrival(WIDE, sim.traffic.nowTick + 100, 0, LONG_TURN_TICKS, -1);
  expect(f).toBeGreaterThanOrEqual(0);
  return sim;
}

/** People of grid index 0 that are inside the terminal, every stage but curb, boarded and missed. */
function peopleInside(co: Cohorts): number {
  let n = 0;
  for (let c = 0; c < co.hi; c++) {
    const st = co.stage[c];
    if (co.building[c] !== 0) continue;
    if (st === Stage.Free || st === Stage.Curb || st === Stage.Boarded || st === Stage.Missed) continue;
    n += co.size[c]!;
  }
  return n;
}

function densitySum(out: OverlayData): number {
  let n = 0;
  for (let i = 0; i < out.density.length; i++) n += out.density[i]!;
  return n;
}

/** Steps until people are both queued and walking, the mid journey state the overlay must count. */
function stepToMidJourney(sim: Sim, maxTicks: number): boolean {
  for (let t = 0; t < maxTicks; t++) {
    sim.step();
    const co = sim.cohorts;
    let queued = 0;
    let walking = 0;
    for (let c = 0; c < co.hi; c++) {
      const st = co.stage[c];
      if (st === Stage.CheckIn || st === Stage.Security || st === Stage.Gate) queued++;
      if (st === Stage.ToCheckIn || st === Stage.ToSecurity || st === Stage.ToGate) walking++;
    }
    if (queued > 0 && walking > 0) return true;
  }
  return false;
}

function freshOverlay(): OverlayData {
  return emptyOverlay(
    { building: 0, w: 0, h: 0, density: new Uint16Array(0), nodeCell: new Int32Array(0), nodeQueue: new Uint16Array(0), nodeWaitS: new Uint16Array(0), gateCell: new Int32Array(0), gateDistM: new Uint16Array(0) },
    0,
  );
}

describe('terminal overlays', () => {
  it('density sums to the people inside, with walking cohorts counted', () => {
    const sim = terminalSim('GOLDEN-0010');
    expect(stepToMidJourney(sim, 6000)).toBe(true);
    const out = freshOverlay();
    for (let round = 0; round < 3; round++) {
      sim.business.overlayData(0, sim.tick, out, sim.cohorts);
      expect(densitySum(out)).toBe(peopleInside(sim.cohorts));
      for (let t = 0; t < 1500; t++) sim.step();
    }
    expect(peopleInside(sim.cohorts)).toBeGreaterThan(0);
  });

  it('queue and wait per node equal queueLen and serviceWait', () => {
    const sim = terminalSim('GOLDEN-0010');
    expect(stepToMidJourney(sim, 6000)).toBe(true);
    const out = sim.business.overlayData(0, sim.tick, freshOverlay(), sim.cohorts);
    const sn = sim.business.serviceTable(sim.business.grids[0]!.id)!;
    expect(out.nodeQueue.length).toBe(sn.count);
    for (let k = 0; k < sn.count; k++) {
      expect(out.nodeQueue[k]).toBe(sn.queueLen[k]);
      expect(out.nodeWaitS[k]).toBe(Math.min(OVERLAY_MAX, Math.round(serviceWait(sn, k, sim.tick))));
    }
  });

  it('gate distance equals the walking distance from the curb, and an unreachable gate gives the marker', () => {
    const sim = terminalSim('GOLDEN-0010');
    const grid = sim.business.grids[0]!;
    const out = sim.business.overlayData(0, sim.tick, freshOverlay(), sim.cohorts);
    const sn = sim.business.serviceTable(grid.id)!;
    const curb = sim.business.curbNode(0);
    let gi = 0;
    for (let k = 0; k < sn.count; k++) {
      if (sn.kind[k] !== GATE_DESK) continue;
      const d = sim.business.walkDistance(grid.id, curb, sim.business.nearestNode(grid.id, out.nodeCell[k]!));
      expect(out.gateDistM[gi]).toBe(Math.min(OVERLAY_MAX, Math.round(d)));
      gi++;
    }
    expect(gi).toBeGreaterThan(0);

    const unreachable = buildOverlayData(
      freshOverlay(),
      0,
      grid.id,
      grid,
      sn,
      sim.cohorts,
      { curbNode: () => 0, nearestNode: () => 0, walkDistance: () => Infinity },
      sim.tick,
    );
    for (let i = 0; i < unreachable.gateDistM.length; i++) expect(unreachable.gateDistM[i]).toBe(OVERLAY_MAX);
  });

  it('the state hash is the same with and without overlay reads every 600 ticks', () => {
    const plain = terminalSim('GOLDEN-0011');
    const read = terminalSim('GOLDEN-0011');
    const out = freshOverlay();
    for (let t = 0; t < 2000; t++) {
      plain.step();
      read.step();
      if (t % 600 === 0) read.business.overlayData(0, read.tick, out, read.cohorts);
    }
    expect(read.stateHash()).toBe(plain.stateHash());
  });
});
