import { describe, expect, it } from 'vitest';
import { FIXTURE_KEYS, type FixtureKey } from '../src/shared/business';
import { Sim } from '../src/sim/sim';
import { buildTestAirport, buildTestTerminal, ownedSim, run, OPTIONS } from './helpers';
import { SERVICE_KEYS, type ServiceKey, type ServiceNodes } from '../src/sim/terminal/serviceNodes';
import { originFor } from '../src/shared/terminalOps';

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

/** Every security lane node on a table, in node order. */
function laneNodes(sn: ServiceNodes): number[] {
  const out: number[] = [];
  for (let k = 0; k < sn.count; k++) if (sn.kind[k] === KEY('security')) out.push(k);
  return out;
}

/** True when cohort c is being served at a node of the table or waits in one of its queues. */
function holds(sn: ServiceNodes, c: number): boolean {
  for (let k = 0; k < sn.count; k++) {
    if (sn.serving[k] === c) return true;
    for (let q = 0; q < sn.qCount[k]!; q++) if (sn.qCohort[k * sn.slots + ((sn.qHead[k]! + q) % sn.slots)] === c) return true;
  }
  return false;
}

/** A small terminal with a foundation, a floor and one check in desk, at the given north position. Returns its id. */
function smallTerminal(sim: Sim, py: number): number {
  const { ox, oy } = originFor(3960, py, 90);
  const before = sim.business.grids.length;
  expect(run(sim, { type: 'terminalBuild', building: -1, ox, oy, headingDeg: 90, edit: { op: 'foundation', x0: 40, y0: 40, x1: 60, y1: 50, variant: 0 } })).toEqual([]);
  const id = sim.business.grids[before]!.id;
  expect(run(sim, { type: 'terminalBuild', building: id, ox, oy, headingDeg: 90, edit: { op: 'floor', x0: 40, y0: 40, x1: 60, y1: 50, variant: 2 } })).toEqual([]);
  expect(run(sim, { type: 'terminalBuild', building: id, ox, oy, headingDeg: 90, edit: { op: 'fixture', x0: 42, y0: 42, x1: 43, y1: 43, variant: KEY('checkIn') } })).toEqual([]);
  return id;
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

  it('evictions accumulate in order across rebuilds, and a surviving node keeps its cohorts', () => {
    const { sim, gid } = terminalSim();
    const [a, b, c] = laneNodes(sim.business.serviceTable(gid)!);
    expect(c).toBeDefined();
    expect(sim.business.serviceJoin(gid, a!, 10, 2)).toBe(true);
    expect(sim.business.serviceJoin(gid, a!, 11, 2)).toBe(true);
    expect(sim.business.serviceJoin(gid, b!, 20, 2)).toBe(true);
    expect(sim.business.serviceJoin(gid, b!, 21, 2)).toBe(true);
    expect(sim.business.serviceJoin(gid, c!, 40, 2)).toBe(true);
    expect(sim.business.serviceJoin(gid, c!, 41, 2)).toBe(true);
    for (let t = 0; t < 10 && laneNodes(sim.business.serviceTable(gid)!).some((k) => sim.business.serviceTable(gid)!.serving[k]! < 0); t++) sim.step();
    const at = (k: number) => {
      const sn = sim.business.serviceTable(gid)!;
      return { lx: sn.lx[k]!, ly: sn.ly[k]! };
    };
    const laneA = at(a!);
    const laneB = at(b!);
    const laneC = at(c!);
    expect(sim.business.serviceTable(gid)!.active).toBe(6);

    expect(terminalEdit(sim, gid, { op: 'erase', x0: laneA.lx, y0: laneA.ly, x1: laneA.lx + 1, y1: laneA.ly + 1, variant: 0 })).toEqual([]);
    let sn = sim.business.serviceTable(gid)!;
    expect(sn.evictedCount).toBe(2);
    expect(Array.from(sn.evicted.subarray(0, sn.evictedCount))).toEqual([10, 11]);
    expect(sn.active).toBe(4);
    let kB = findAt(sn, laneB.lx, laneB.ly, KEY('security'));
    expect(sn.serving[kB]).toBe(20);
    expect(sn.qCohort[kB * sn.slots + sn.qHead[kB]!]).toBe(21);
    expect(sn.queueLen[kB]).toBe(2);

    expect(terminalEdit(sim, gid, { op: 'erase', x0: laneC.lx, y0: laneC.ly, x1: laneC.lx + 1, y1: laneC.ly + 1, variant: 0 })).toEqual([]);
    sn = sim.business.serviceTable(gid)!;
    expect(sn.evictedCount).toBe(4);
    expect(Array.from(sn.evicted.subarray(0, sn.evictedCount))).toEqual([10, 11, 40, 41]);
    expect(sn.active).toBe(2);
    kB = findAt(sn, laneB.lx, laneB.ly, KEY('security'));
    expect(sn.serving[kB]).toBe(20);
    expect(sn.qCohort[kB * sn.slots + sn.qHead[kB]!]).toBe(21);
  });

  it('a queue in a second terminal survives edits to the first and the first being erased and demolished', () => {
    const { sim, gid: first } = terminalSim();
    const second = smallTerminal(sim, 5700);
    const third = smallTerminal(sim, 6000);
    expect(sim.business.serviceJoin(second, 0, 77, 2)).toBe(true);
    const check = (): void => {
      expect(sim.business.serviceNodes.length).toBe(sim.business.grids.length);
      expect(holds(sim.business.serviceTable(second)!, 77)).toBe(true);
    };
    check();
    expect(terminalEdit(sim, first, { op: 'wall', x0: 50, y0: 45, x1: 50, y1: 46, variant: 1 })).toEqual([]);
    check();
    expect(terminalEdit(sim, first, { op: 'erase', x0: 0, y0: 0, x1: 200, y1: 200, variant: 0 })).toEqual([]);
    expect(sim.business.grids.some((g) => g.id === first)).toBe(false);
    check();
    expect(sim.business.demolishTerminal(third)).toBeNull();
    expect(sim.business.serviceTable(third)).toBeNull();
    check();
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

  it('the same join script with different cohort ids hashes differently', () => {
    const hashWithIds = (base: number): number => {
      const { sim, gid } = terminalSim('ID-SEED');
      const lane = laneNode(sim.business.serviceTable(gid)!);
      expect(sim.business.serviceJoin(gid, lane, base, 2)).toBe(true);
      expect(sim.business.serviceJoin(gid, lane, base + 1, 2)).toBe(true);
      for (let t = 0; t < 20; t++) sim.step();
      return sim.stateHash();
    };
    expect(hashWithIds(1000)).toBe(hashWithIds(1000));
    expect(hashWithIds(1000)).not.toBe(hashWithIds(2000));
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

describe('service queues survive a save', () => {
  it('a save taken while people queue restores to an identical run', () => {
    const { sim, gid } = terminalSim('QUEUE-SAVE-SEED');
    const lane = laneNode(sim.business.serviceTable(gid)!);
    for (let c = 0; c < 4; c++) expect(sim.business.serviceJoin(gid, lane, 100 + c, 2)).toBe(true);
    for (let t = 0; t < 30; t++) sim.step();
    expect(sim.business.serviceTable(gid)!.queueLen[lane]).toBeGreaterThan(0);

    const restored = new Sim('QUEUE-SAVE-SEED', OPTIONS);
    restored.restore(JSON.parse(JSON.stringify(sim.serialize())));
    expect(restored.stateHash()).toBe(sim.stateHash());
    expect(restored.business.serviceTable(gid)!.queueLen[lane]).toBe(sim.business.serviceTable(gid)!.queueLen[lane]);

    for (let t = 0; t < 300; t++) {
      sim.step();
      restored.step();
    }
    expect(restored.stateHash()).toBe(sim.stateHash());
    for (let t = 0; t < 300; t++) {
      sim.step();
      restored.step();
    }
    expect(restored.stateHash()).toBe(sim.stateHash());
  });
});
