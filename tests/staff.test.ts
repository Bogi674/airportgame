import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Rng } from '../src/sim/rng';
import { buildServiceNodes, serviceJoin, serviceUpdate, serviceWait } from '../src/sim/terminal/serviceNodes';
import { FIXTURE_KEYS } from '@shared/business';
import { buildTestAirport, buildTestTerminal, ownedSim, run, OPTIONS } from './helpers';
import { Staff, STAFF_FLAG, STAFF_STATE, type StaffSave } from '../src/sim/staff/staff';
import { breakJitterMin, staffSeed, staffSkill } from '../src/sim/staff/staffTraits';

const freshStaff = (): Staff => {
  const sim = new Sim('STAFF-0001', OPTIONS);
  return new Staff(sim.business, sim.baggage);
};

describe('staff store', () => {
  it('allocates slots in order with serial seeds', () => {
    const st = freshStaff();
    expect([st.alloc(0, 0), st.alloc(1, 1), st.alloc(2, 2)]).toEqual([0, 1, 2]);
    for (let i = 0; i < 3; i++) expect(st.seed[i]).toBe(staffSeed(i));
    expect(st.state[0]).toBe(STAFF_STATE.Off);
  });

  it('reuses a freed slot with the next serial seed', () => {
    const st = freshStaff();
    st.alloc(0, 0);
    st.alloc(0, 0);
    st.alloc(0, 0);
    st.free(1);
    expect(st.alloc(1, 2)).toBe(1);
    expect(st.seed[1]).toBe(staffSeed(3));
    expect(st.role[1]).toBe(1);
  });

  it('lowers hi when the top slot is freed', () => {
    const st = freshStaff();
    st.alloc(0, 0);
    st.alloc(0, 0);
    st.alloc(0, 0);
    st.free(1);
    st.free(2);
    expect(st.hi).toBe(1);
    expect(st.hired(0)).toBe(1);
  });

  it('keeps skill and break jitter in range', () => {
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const seed = staffSeed(i);
      const k = staffSkill(seed);
      expect(k).toBeGreaterThanOrEqual(0.9);
      expect(k).toBeLessThanOrEqual(1.1);
      sum += k;
      const j = breakJitterMin(seed);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThanOrEqual(60);
    }
    expect(Math.abs(sum / 10000 - 1)).toBeLessThan(0.01);
  });

  it('hashes equal for equal calls and differs on a flag change', () => {
    const make = (): Staff => {
      const st = freshStaff();
      st.alloc(0, 0);
      st.alloc(2, 1);
      return st;
    };
    const a = make();
    const b = make();
    expect(a.hash(1)).toBe(b.hash(1));
    b.flags[1] |= STAFF_FLAG.Tired;
    expect(a.hash(1)).not.toBe(b.hash(1));
  });

  it('hashes signed and wide fields', () => {
    const st = freshStaff();
    st.alloc(0, 0);
    const base = st.hash(1);
    st.stX[0] = -5;
    const withX = st.hash(1);
    expect(withX).not.toBe(base);
    st.home[0] = 7;
    expect(st.hash(1)).not.toBe(withX);
  });

  it('saves and loads into a fresh store with the same hash', () => {
    const st = freshStaff();
    st.alloc(0, 0);
    st.alloc(1, 1);
    st.alloc(2, 2);
    st.flags[1] |= STAFF_FLAG.Tired;
    st.stX[2] = -4;
    st.home[0] = 9;
    st.caps[1] = 2;
    const saved = JSON.parse(JSON.stringify(st.saveState())) as StaffSave;
    const fresh = freshStaff();
    fresh.loadState(saved);
    expect(fresh.hi).toBe(3);
    expect(fresh.hash(1)).toBe(st.hash(1));
    fresh.loadState(undefined);
    expect(fresh.hi).toBe(0);
    expect(fresh.caps[1]).toBe(-1);
  });

  it('a Sim serialize then restore keeps the state hash', () => {
    const sim = new Sim('STAFF-0001', OPTIONS);
    for (let t = 0; t < 50; t++) sim.step();
    sim.staff.alloc(0, 1);
    const data = JSON.parse(JSON.stringify(sim.serialize())) as unknown;
    const b = new Sim('STAFF-0001', OPTIONS);
    b.restore(data);
    expect(b.stateHash()).toBe(sim.stateHash());
    expect(b.staff.hi).toBe(1);
  });
});

const kindId = (key: string): number => FIXTURE_KEYS.indexOf(key as never) + 1;

function terminalSim(): Sim {
  const sim = ownedSim();
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, { checkIn: 2, security: 1, gateDesk: 1 })).toEqual([]);
  return sim;
}

/** Stations of a fixture key in station order. */
function stationsOf(st: Staff, key: string): number[] {
  const out: number[] = [];
  for (let s = 0; s < st.stCount; s++) if (st.sKind[s] === kindId(key)) out.push(s);
  return out;
}

/** Puts a new agent on duty on a station. */
function place(st: Staff, role: number, s: number): number {
  const m = st.alloc(role, 0);
  st.state[m] = STAFF_STATE.OnDuty;
  st.stGrid[m] = st.sGridId[s]!;
  st.stX[m] = st.sX[s]!;
  st.stY[m] = st.sY[s]!;
  st.stKind[m] = st.sKind[s]!;
  st.stIdx[m] = s;
  return m;
}

describe('staff stations and service factor', () => {
  it('gives unstaffed check in nodes a factor of 0 and keeps nodes that need no staff at 1', () => {
    const sim = terminalSim();
    const st = sim.staff;
    st.refresh();
    const sn = sim.business.serviceNodes[0]!;
    const desks = stationsOf(st, 'checkIn');
    expect(desks).toHaveLength(2);
    for (const s of desks) expect(sn.staffFactor[st.sNode[s]!]).toBe(0);
    for (let k = 0; k < sn.count; k++) if (sn.staffNeed[k] === 0) expect(sn.staffFactor[k]).toBe(1);
    expect(sn.count).toBeGreaterThan(st.stCount);
  });

  it('serves at the skill of one agent, and a lane with one officer at half of it', () => {
    const sim = terminalSim();
    const st = sim.staff;
    st.refresh();
    const desk = stationsOf(st, 'checkIn')[0]!;
    const m = place(st, 0, desk);
    const lane = stationsOf(st, 'security')[0]!;
    const o = place(st, 1, lane);
    st.refresh();
    const sn = sim.business.serviceNodes[0]!;
    expect(sn.staffPresent[st.sNode[desk]!]).toBe(1);
    expect(sn.staffFactor[st.sNode[desk]!]).toBeCloseTo(staffSkill(st.seed[m]!), 6);
    expect(sn.staffFactor[st.sNode[lane]!]).toBeCloseTo(staffSkill(st.seed[o]!) / 2, 6);
  });

  it('starts no service at factor 0 and takes twice as long at factor 0.5', () => {
    const sim = terminalSim();
    const st = sim.staff;
    st.refresh();
    const g = sim.business.grids[0]!;
    const full = buildServiceNodes(g, sim.business.walkGraphs[0]!);
    const half = buildServiceNodes(g, sim.business.walkGraphs[0]!);
    const none = buildServiceNodes(g, sim.business.walkGraphs[0]!);
    const node = st.sNode[stationsOf(st, 'checkIn')[0]!]!;
    full.staffFactor[node] = 1;
    half.staffFactor[node] = 0.5;
    none.staffFactor[node] = 0;
    for (const t of [full, half, none]) {
      expect(serviceJoin(t, node, 5, 1)).toBe(true);
      serviceUpdate(t, 0, new Rng(7));
    }
    expect(none.serving[node]).toBe(-1);
    expect(none.qCount[node]).toBe(1);
    expect(serviceWait(none, node, 0)).toBe(Infinity);
    expect(full.serving[node]).toBe(5);
    expect(Math.abs(half.busyUntil[node]! - 2 * full.busyUntil[node]!)).toBeLessThanOrEqual(1);
  });

  it('keeps the factors across an edit that rebuilds the tables', () => {
    const sim = terminalSim();
    const st = sim.staff;
    st.refresh();
    const m = place(st, 0, stationsOf(st, 'checkIn')[0]!);
    st.refresh();
    const g = sim.business.grids[0]!;
    const before = sim.business.serviceVersion;
    expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op: 'fixture', x0: 88, y0: 48, x1: 89, y1: 49, variant: 5 } })).toEqual([]);
    expect(sim.business.serviceVersion).toBeGreaterThan(before);
    st.refresh();
    const desk = stationsOf(st, 'checkIn')[0]!;
    expect(st.stIdx[m]).toBe(desk);
    expect(sim.business.serviceNodes[0]!.staffFactor[st.sNode[desk]!]).toBeCloseTo(staffSkill(st.seed[m]!), 6);
  });
});
