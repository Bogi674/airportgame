import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { OverlayData } from '@shared/overlay';
import { Rng } from '../src/sim/rng';
import { buildServiceNodes, serviceJoin, serviceUpdate, serviceWait } from '../src/sim/terminal/serviceNodes';
import { AIRCRAFT } from '@data/aircraft';
import { FIXTURE_KEYS, LEDGER_CATEGORIES, WALL } from '@shared/business';
import { cellIndex, hEdgeIndex, originFor, vEdgeIndex } from '@shared/terminalOps';
import { buildTestAirport, buildTestTerminal, ownedSim, run, OPTIONS } from './helpers';
import { Staff, STAFF_FLAG, STAFF_STATE, type StaffSave } from '../src/sim/staff/staff';
import { breakJitterMin, staffSeed, staffSkill } from '../src/sim/staff/staffTraits';
import { STAFF_ROLE_COUNT } from '@data/schemas/staff';

const freshStaff = (): Staff => {
  const sim = new Sim('STAFF-0001', OPTIONS);
  return new Staff(sim.business, sim.baggage, sim.airfield);
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
  // No depot, so no apron crew pool (T81): these tests count the terminal stations only.
  buildTestAirport(sim, { ground: false });
  expect(buildTestTerminal(sim, { checkIn: 2, security: 1, gateDesk: 1 })).toEqual([]);
  return sim;
}

/** Frees every hire and caps every role at 0, so a test places staff by hand. */
function emptyStaff(sim: Sim): void {
  sim.staff.caps.fill(0);
  for (let m = sim.staff.hi - 1; m >= 0; m--) sim.staff.free(m);
  sim.staff.refresh();
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
    emptyStaff(sim);
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
    emptyStaff(sim);
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
    const m = onDuty(st, 0, 'checkIn');
    expect(m).toBeGreaterThanOrEqual(0);
    const g = sim.business.grids[0]!;
    const before = sim.business.serviceVersion;
    expect(run(sim, { type: 'placeProp', building: g.id, asset: 'decor.planterSmall', x: 176, y: 96, rot: 0 })).toEqual([]);
    expect(sim.business.serviceVersion).toBeGreaterThan(before);
    expect(st.stIdx[m]).toBeGreaterThanOrEqual(0);
    expect(sim.business.serviceNodes[0]!.staffFactor[st.sNode[st.stIdx[m]!]!]).toBeGreaterThan(0);
  });
});

/** First member of a role on duty at a station of a fixture key, -1 when none. */
function onDuty(st: Staff, role: number, key: string): number {
  for (let m = 0; m < st.hi; m++) if (st.role[m] === role && st.state[m] === STAFF_STATE.OnDuty && st.stKind[m] === kindId(key)) return m;
  return -1;
}

describe('automatic staffing', () => {
  it('hires three shifts of every position and puts the running shift on duty', () => {
    const sim = terminalSim();
    const st = sim.staff;
    expect(st.hired(0)).toBe(12);
    // Two lane officers and one security exit officer (T81) on three shifts, plus a relief per shift.
    expect(st.hired(1)).toBe(12);
    expect(st.hired(2)).toBe(0);
    let agents = 0;
    for (let m = 0; m < st.hi; m++) if (st.role[m] === 0 && st.state[m] === STAFF_STATE.OnDuty) agents++;
    expect(agents).toBe(3);
    const sn = sim.business.serviceNodes[0]!;
    for (let s = 0; s < st.stCount; s++) expect(sn.staffFactor[st.sNode[s]!]).toBeGreaterThan(0);
  });

  it('a second pass with nothing changed leaves the hash unchanged', () => {
    const sim = terminalSim();
    const before = sim.staff.hash(1);
    run(sim);
    expect(sim.staff.hash(1)).toBe(before);
  });

  it('applies and lifts a cap', () => {
    const sim = terminalSim();
    const st = sim.staff;
    expect(run(sim, { type: 'setStaffCap', role: 1, cap: 2 })).toEqual([]);
    // The two seats go to the lane; the exit officer already on site is unplaced and works to the end of its shift.
    expect(st.hired(1)).toBe(3);
    let placed = 0;
    for (let m = 0; m < st.hi; m++) {
      if (st.role[m] !== 1 || st.state[m] === STAFF_STATE.Free) continue;
      expect(st.state[m]).toBe(STAFF_STATE.OnDuty);
      if (st.stIdx[m]! >= 0) placed++;
    }
    expect(placed).toBe(2);
    expect(run(sim, { type: 'setStaffCap', role: 1, cap: -1 })).toEqual([]);
    expect(st.hired(1)).toBe(12);
  });

  it('reports a bad cap', () => {
    const sim = terminalSim();
    expect(run(sim, { type: 'setStaffCap', role: 9, cap: 1 })).toEqual(['badStaffCap']);
    expect(run(sim, { type: 'setStaffCap', role: 0, cap: -2 })).toEqual(['badStaffCap']);
  });

  it('erasing a check in desk frees the off staff and unplaces the one on site', () => {
    const sim = terminalSim();
    const st = sim.staff;
    const g = sim.business.grids[0]!;
    expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op: 'erase', x0: 42, y0: 42, x1: 43, y1: 43, variant: 0 } })).toEqual([]);
    expect(st.stCount).toBe(4);
    let unplaced = 0;
    for (let m = 0; m < st.hi; m++) if (st.role[m] === 0 && st.state[m] === STAFF_STATE.OnDuty && st.stGrid[m] === -1 && (st.flags[m]! & STAFF_FLAG.Relief) === 0) unplaced++;
    expect(unplaced).toBe(1);
    expect(st.hired(0)).toBe(10);
  });

  it('is deterministic over 2000 ticks', () => {
    const a = terminalSim();
    const b = terminalSim();
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    expect(a.stateHash()).toBe(b.stateHash());
  });
});

describe('screening machine staffing', () => {
  type Edit = { op: 'foundation' | 'floor' | 'zone' | 'fixture'; x0: number; y0: number; x1: number; y1: number; variant: number; rot?: 0 | 1 | 2 | 3 };

  /** A hall with a check in desk, a security lane, a staff room with a machine, a carousel and a bay serving the first stand. */
  function machineLayout(): { sim: Sim; machine: number; checkIn: (bags: number) => number } {
    const { ox, oy } = originFor(3960, 5440, 90);
    const sim = ownedSim();
    buildTestAirport(sim);
    const edit = (building: number, e: Edit): string[] => run(sim, { type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e });
    expect(edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 70, y1: 53, variant: 0 })).toEqual([]);
    const building = sim.business.grids[0]!.id;
    expect(edit(building, { op: 'floor', x0: 40, y0: 40, x1: 70, y1: 53, variant: 2 })).toEqual([]);
    expect(edit(building, { op: 'zone', x0: 40, y0: 46, x1: 60, y1: 53, variant: 4 })).toEqual([]);
    const g = sim.business.grids[0]!;
    for (let x = 41; x <= 45; x++) {
      g.hWall[hEdgeIndex(g, x, 47)] = WALL.Wall;
      g.hWall[hEdgeIndex(g, x, 50)] = x === 43 ? WALL.Door : WALL.Wall;
    }
    for (let y = 47; y <= 49; y++) {
      g.vWall[vEdgeIndex(g, 41, y)] = WALL.Wall;
      g.vWall[vEdgeIndex(g, 46, y)] = WALL.Wall;
    }
    for (let x = 50; x <= 57; x++) g.hWall[hEdgeIndex(g, x, 53)] = WALL.Wall;
    expect(edit(building, { op: 'fixture', x0: 60, y0: 41, x1: 61, y1: 42, variant: 1 })).toEqual([]);
    // The 2 by 8 cell lane (T74) covers columns 61 to 68 on rows 41 and 42, east of the check in desk.
    expect(edit(building, { op: 'fixture', x0: 68, y0: 41, x1: 69, y1: 42, variant: 2, rot: 1 })).toEqual([]);
    const place = (kind: 'machine' | 'bay' | 'carousel', cx: number, cy: number): void => {
      expect(run(sim, { type: 'placeBaggageNode', building, kind, cx, cy, rot: 0, widthCells: 4 })).toEqual([]);
    };
    place('machine', 42, 48);
    place('carousel', 42, 42);
    place('bay', 50, 49);
    const recs = sim.baggage.nodesOf(building);
    const bay = recs.find((r) => r.kind === 'bay')!.id;
    expect(run(sim, { type: 'setStandBay', standId: sim.airfield.data.stands[0]!.id, bayId: bay })).toEqual([]);
    const machine = recs.find((r) => r.kind === 'machine')!.id;
    const anchor = cellIndex(g, 60, 41);
    const a320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');
    const checkIn = (bags: number): number => {
      const t = sim.traffic;
      const f = t.scheduleArrival(a320, sim.tick + 1, 0, t.turnaroundTicks(a320), 0);
      t.fStand[f] = sim.airfield.data.stands[0]!.id;
      sim.baggage.checkIn(building, anchor, t.serialOf(f), bags);
      return t.serialOf(f);
    };
    return { sim, machine, checkIn };
  }

  it('leaves the batch unscreened while both officers stand on the lane', () => {
    const l = machineLayout();
    expect(run(l.sim, { type: 'setStaffCap', role: 1, cap: 2 })).toEqual([]);
    const lane = stationsOf(l.sim.staff, 'security')[0]!;
    expect(l.sim.staff.sPresent[lane]).toBe(2);
    expect(l.sim.staff.machineOn(l.machine)).toBe(false);
    const serial = l.checkIn(3);
    for (let t = 0; t < 1500; t++) l.sim.step();
    expect(l.sim.baggage.bagsOf(serial, 5)).toBe(0);
    expect(l.sim.baggage.batchCount).toBeGreaterThan(0);
  });

  it('screens once the pass staffs the machine', () => {
    const l = machineLayout();
    expect(run(l.sim, { type: 'setStaffCap', role: 1, cap: -1 })).toEqual([]);
    expect(l.sim.staff.machineOn(l.machine)).toBe(true);
    const serial = l.checkIn(3);
    let reached = false;
    for (let t = 0; t < 1500 && !reached; t++) {
      l.sim.step();
      reached = l.sim.baggage.bagsOf(serial, 5) === 3;
    }
    expect(reached).toBe(true);
  });
});

describe('staff wages and payload', () => {
  it('charges the legacy remainder plus one wage per hired member at the day close', () => {
    const sim = terminalSim();
    const st = sim.staff;
    const hired = st.hired(0) + st.hired(1) + st.hired(2);
    expect(hired).toBe(24);
    const remainder = sim.business.staffCount() - sim.business.stationPositions();
    while (sim.tick < 18 * 60 * 50 + 50) sim.step();
    const p = sim.business.payload(sim.tick);
    const wages = p.history[0]![LEDGER_CATEGORIES.indexOf('wages')]!;
    expect(wages).toBe(-(Math.round(remainder * 130) + hired * 130));
  }, 120_000);

  it('lists one staffing row per role with the hired agents', () => {
    const sim = terminalSim();
    const p = sim.business.payload(sim.tick);
    expect(p.staffing).toHaveLength(STAFF_ROLE_COUNT);
    expect(p.staffing[0]!.hired).toBe(12);
    expect(p.staffing[1]!.hired).toBe(12);
    expect(p.staffing[0]!.onDuty).toBe(3);
    expect(p.staffing[0]!.needed).toBe(3);
    expect(p.staffing[0]!.wagePerDay).toBe(130);
    expect(p.staff).toBe(Math.round(sim.business.staffCount() - sim.business.stationPositions()) + 24);
  });
});

describe('staffing coverage overlay data', () => {
  const blank = (): OverlayData => ({
    building: 0, w: 0, h: 0, density: new Uint16Array(0), nodeCell: new Int32Array(0), nodeQueue: new Uint16Array(0), nodeWaitS: new Uint16Array(0),
    gateCell: new Int32Array(0), gateDistM: new Uint16Array(0), stationCell: new Int32Array(0), stationNeed: new Uint8Array(0), stationPresent: new Uint8Array(0),
  });

  it('lists every station with its need and the present count of its service node', () => {
    const sim = terminalSim();
    const o = sim.overlayData(0, blank());
    expect(Array.from(o.stationNeed).sort()).toEqual([1, 1, 1, 1, 2]);
    const sn = sim.business.serviceNodes[0]!;
    for (let i = 0; i < o.stationCell.length; i++) {
      const node = Array.from(sn.cell).indexOf(o.stationCell[i]!);
      expect(node).toBeGreaterThanOrEqual(0);
      expect(o.stationPresent[i]).toBe(sn.staffPresent[node]);
      expect(o.stationPresent[i]).toBe(o.stationNeed[i]);
    }
  });

  it('shows one of two officers on a capped security lane', () => {
    const sim = terminalSim();
    expect(run(sim, { type: 'setStaffCap', role: 1, cap: 1 })).toEqual([]);
    const o = sim.overlayData(0, blank());
    const lane = Array.from(o.stationNeed).indexOf(2);
    expect(lane).toBeGreaterThanOrEqual(0);
    expect(o.stationPresent[lane]).toBe(1);
  });
});
