import { describe, expect, it } from 'vitest';
import { FIXTURE_KEYS, type FixtureKey } from '../src/shared/business';
import { Sim } from '../src/sim/sim';
import { buildTestAirport, buildTestTerminal, ownedSim, run, OPTIONS } from './helpers';
import { SERVICE_KEYS, type ServiceKey, type ServiceNodes } from '../src/sim/terminal/serviceNodes';

const KEY = (k: FixtureKey): number => FIXTURE_KEYS.indexOf(k) + 1;

/** A sim with the test airport and terminal, and the first terminal's id. */
function terminalSim(seed = 'GOLDEN-0001'): { sim: Sim; gid: number } {
  const sim = ownedSim(seed);
  sim.cash = 100_000_000;
  buildTestAirport(sim, { standsPerRow: 8 });
  expect(buildTestTerminal(sim)).toEqual([]);
  return { sim, gid: sim.business.grids[0]!.id };
}

/** Node index of the first security lane on a table. */
function laneNode(sn: ServiceNodes): number {
  for (let k = 0; k < sn.count; k++) if (sn.kind[k] === KEY('security')) return k;
  throw new Error('no lane');
}

/** Node index at logical cell (lx, ly) with the given kind, -1 when there is none. */
function findAt(sn: ServiceNodes, lx: number, ly: number, kind: number): number {
  for (let k = 0; k < sn.count; k++) if (sn.lx[k] === lx && sn.ly[k] === ly && sn.kind[k] === kind) return k;
  return -1;
}

/** Edit a fixture or erase cells of the first terminal. Returns problems, empty on success. */
function terminalEdit(sim: Sim, gid: number, edit: { op: 'fixture' | 'erase' | 'wall' | 'foundation'; x0: number; y0: number; x1: number; y1: number; variant: number }): string[] {
  const g = sim.business.grids.find((x) => x.id === gid)!;
  return run(sim, { type: 'terminalBuild', building: gid, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit });
}

describe('service tables follow the terminal', () => {
  it('has one node per service fixture anchor', () => {
    const { sim, gid } = terminalSim();
    const g = sim.business.grids[0]!;
    let anchors = 0;
    for (let i = 0; i < g.fixture.length; i++) {
      const id = g.fixture[i]!;
      if (id > 0 && SERVICE_KEYS.includes(FIXTURE_KEYS[id - 1] as ServiceKey) && g.fixtureRot[i]! < 5) anchors++;
    }
    expect(anchors).toBeGreaterThan(0);
    expect(sim.business.serviceTable(gid)!.count).toBe(anchors);
  });

  it('adding a toilet adds a node, erasing it removes one, and the version moves each time', () => {
    const { sim, gid } = terminalSim();
    const before = sim.business.serviceTable(gid)!.count;
    const v0 = sim.business.serviceVersion;
    expect(terminalEdit(sim, gid, { op: 'fixture', x0: 60, y0: 46, x1: 61, y1: 47, variant: KEY('toilet') })).toEqual([]);
    expect(sim.business.serviceTable(gid)!.count).toBe(before + 1);
    expect(sim.business.serviceVersion).toBeGreaterThan(v0);
    const v1 = sim.business.serviceVersion;
    expect(terminalEdit(sim, gid, { op: 'erase', x0: 60, y0: 46, x1: 61, y1: 47, variant: 0 })).toEqual([]);
    expect(sim.business.serviceTable(gid)!.count).toBe(before);
    expect(sim.business.serviceVersion).toBeGreaterThan(v1);
  });

  it('a cohort queued at a lane survives an unrelated wall edit and a grid growing edit', () => {
    const { sim, gid } = terminalSim();
    const lane = laneNode(sim.business.serviceTable(gid)!);
    const lx = sim.business.serviceTable(gid)!.lx[lane]!;
    const ly = sim.business.serviceTable(gid)!.ly[lane]!;
    expect(sim.business.serviceJoin(gid, lane, 42, 3)).toBe(true);
    expect(terminalEdit(sim, gid, { op: 'wall', x0: 50, y0: 45, x1: 50, y1: 46, variant: 1 })).toEqual([]);
    let sn = sim.business.serviceTable(gid)!;
    let k = findAt(sn, lx, ly, KEY('security'));
    expect(k).toBeGreaterThanOrEqual(0);
    expect(sn.queueLen[k]).toBe(3);
    expect(sn.qCohort[k * sn.slots + sn.qHead[k]!]).toBe(42);
    expect(terminalEdit(sim, gid, { op: 'foundation', x0: 100, y0: 40, x1: 140, y1: 52, variant: 0 })).toEqual([]);
    sn = sim.business.serviceTable(gid)!;
    k = findAt(sn, lx, ly, KEY('security'));
    expect(k).toBeGreaterThanOrEqual(0);
    // The edit steps the sim, so the cohort may already be in service. Either way it is still here.
    expect(sn.serving[k] === 42 || sn.queueLen[k] === 3).toBe(true);
    expect(sn.active).toBe(1);
  });

  it('removing the lane evicts its serving cohort, then its queue, in order', () => {
    const { sim, gid } = terminalSim();
    const lane = laneNode(sim.business.serviceTable(gid)!);
    expect(sim.business.serviceJoin(gid, lane, 10, 2)).toBe(true);
    expect(sim.business.serviceJoin(gid, lane, 11, 2)).toBe(true);
    const busy = sim.business.serviceTable(gid)!;
    for (let t = 0; t < 10 && busy.serving[lane]! < 0; t++) sim.step();
    expect(busy.serving[lane]).toBe(10);
    expect(busy.queueLen[lane]).toBe(2);
    const lx = busy.lx[lane]!;
    const ly = busy.ly[lane]!;
    expect(terminalEdit(sim, gid, { op: 'erase', x0: lx, y0: ly, x1: lx + 1, y1: ly + 1, variant: 0 })).toEqual([]);
    const sn = sim.business.serviceTable(gid)!;
    expect(findAt(sn, lx, ly, KEY('security'))).toBe(-1);
    expect(sn.evictedCount).toBe(2);
    expect(Array.from(sn.evicted.subarray(0, sn.evictedCount))).toEqual([10, 11]);
  });

  it('demolishing the terminal drops its table', () => {
    const { sim, gid } = terminalSim();
    expect(sim.business.serviceTable(gid)).not.toBeNull();
    expect(sim.business.demolishTerminal(gid)).toBeNull();
    expect(sim.business.serviceTable(gid)).toBeNull();
    expect(sim.business.serviceNodes.length).toBe(0);
  });

  it('an unknown grid gives false and infinite wait', () => {
    const { sim } = terminalSim();
    expect(sim.business.serviceJoin(999, 0, 1, 1)).toBe(false);
    expect(sim.business.serviceWait(999, 0, 0)).toBe(Infinity);
    expect(sim.business.serviceTable(999)).toBeNull();
  });
});

describe('service queues in the sim', () => {
  /** Runs a sim for ticks with a join every 50 ticks at the first lane, recording the hash every 100 ticks. */
  function scripted(seed: string, ticks: number): number[] {
    const { sim, gid } = terminalSim(seed);
    const lane = laneNode(sim.business.serviceTable(gid)!);
    const hashes: number[] = [];
    let cohort = 0;
    for (let t = 0; t < ticks; t++) {
      if (t % 50 === 0) sim.business.serviceJoin(gid, lane, cohort++, 1 + (t % 3));
      sim.step();
      if (t % 100 === 0) hashes.push(sim.stateHash());
    }
    return hashes;
  }

  it('two sims with the same seed and join script hash the same every 100 ticks', () => {
    const a = scripted('SERVICE-SEED', 2000);
    const b = scripted('SERVICE-SEED', 2000);
    expect(a.length).toBe(20);
    expect(a).toEqual(b);
  });

  it('an idle sim hashes the same whether or not the API was read, and a join changes the hash', () => {
    const plain = terminalSim('IDLE-SEED');
    const read = terminalSim('IDLE-SEED');
    for (let t = 0; t < 100; t++) {
      plain.sim.step();
      read.sim.step();
    }
    read.sim.business.serviceTable(read.gid);
    read.sim.business.serviceWait(read.gid, 0, 100);
    expect(read.sim.stateHash()).toBe(plain.sim.stateHash());
    const lane = laneNode(read.sim.business.serviceTable(read.gid)!);
    expect(read.sim.business.serviceJoin(read.gid, lane, 1, 2)).toBe(true);
    expect(read.sim.stateHash()).not.toBe(plain.sim.stateHash());
  });

  it('a save and restore with empty queues keeps the hash and the table count', () => {
    const { sim, gid } = terminalSim('SAVE-SEED');
    for (let t = 0; t < 300; t++) sim.step();
    const restored = new Sim('SAVE-SEED', OPTIONS);
    restored.restore(JSON.parse(JSON.stringify(sim.serialize())));
    expect(restored.stateHash()).toBe(sim.stateHash());
    expect(restored.business.serviceTable(gid)!.count).toBe(sim.business.serviceTable(gid)!.count);
  });

  it('the wait at a lane falls as the sim ticks', () => {
    const { sim, gid } = terminalSim('WAIT-SEED');
    const lane = laneNode(sim.business.serviceTable(gid)!);
    expect(sim.business.serviceJoin(gid, lane, 5, 2)).toBe(true);
    const before = sim.business.serviceWait(gid, lane, sim.tick);
    expect(before).toBeCloseTo((2 * 12) / 1, 6);
    for (let t = 0; t < 200; t++) sim.step();
    expect(sim.business.serviceWait(gid, lane, sim.tick)).toBeLessThan(before);
  });
});
