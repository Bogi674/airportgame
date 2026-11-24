import { describe, expect, it } from 'vitest';
import { TICKS_PER_MINUTE } from '@shared/business';
import { createSnapshotBuffer, createSnapshotViews, PEOPLE_MODE, SnapHeader, SNAPSHOT_PEOPLE_CAPACITY, STAFF_ID_BASE, STAFF_PROFILE_BASE, type SnapshotViews } from '@shared/snapshot';
import { cornerWorld, cellIndex } from '@shared/terminalOps';
import { FIXTURE_KEYS } from '@shared/business';
import { frontStep } from '@shared/useArea';
import type { Sim } from '@sim/sim';
import { STAFF_STATE } from '@sim/staff/staff';
import { buildTestAirport, buildTestStaffCenter, buildTestTerminal, ownedSim } from './helpers';

const at = (hour: number, minute = 0): number => (hour - 6) * 60 * TICKS_PER_MINUTE + minute * TICKS_PER_MINUTE;

function staffSim(): Sim {
  const sim = ownedSim();
  buildTestAirport(sim);
  expect(buildTestStaffCenter(sim)).toEqual([]);
  expect(buildTestTerminal(sim, { checkIn: 2, security: 1, gateDesk: 1 })).toEqual([]);
  return sim;
}

const snapshot = (sim: Sim): SnapshotViews => {
  const views = createSnapshotViews(createSnapshotBuffer());
  sim.writeSnapshot(views);
  return views;
};

/** Indexes of the staff entries of a snapshot. */
function staffEntries(views: SnapshotViews): number[] {
  const out: number[] = [];
  for (let i = 0; i < views.header[SnapHeader.PeopleCount]!; i++) if (views.peopleId[i]! >= STAFF_ID_BASE) out.push(i);
  return out;
}

describe('staff in the people sample', () => {
  it('stands the agents on duty behind their desks, away from the queue', () => {
    const sim = staffSim();
    const views = snapshot(sim);
    const st = sim.staff;
    const g = sim.business.grids[0]!;
    const agents = staffEntries(views).filter((i) => views.peopleProfile[i] === STAFF_PROFILE_BASE);
    let onDuty = 0;
    for (let m = 0; m < st.hi; m++) if (st.role[m] === 0 && st.state[m] === STAFF_STATE.OnDuty) onDuty++;
    expect(agents).toHaveLength(onDuty);
    expect(onDuty).toBeGreaterThan(0);
    for (const i of agents) {
      const m = views.peopleId[i]! - STAFF_ID_BASE;
      const s = st.stIdx[m]!;
      const anchor = cornerWorld(g, st.sX[s]! + 0.5, st.sY[s]! + 0.5);
      expect(Math.hypot(views.peopleX[i]! - anchor.x, views.peopleY[i]! - anchor.y)).toBeLessThan(1);
      expect(views.peopleMode[i]).toBe(PEOPLE_MODE.Dwelling);
      const table = sim.business.serviceNodes[0]!;
      const node = st.sNode[s]!;
      if (table.qCellLen[node]! === 0) continue;
      const first = table.qCellOffset[node]!;
      const queue = cornerWorld(g, table.qCellX[first]! + 0.5, table.qCellY[first]! + 0.5);
      expect(Math.hypot(views.peopleX[i]! - queue.x, views.peopleY[i]! - queue.y)).toBeGreaterThan(Math.hypot(anchor.x - queue.x, anchor.y - queue.y));
    }
  });

  it('seats a check in agent on the chair of the desk art, beside the belt (T86)', () => {
    const sim = staffSim();
    const views = snapshot(sim);
    const st = sim.staff;
    const g = sim.business.grids[0]!;
    const checkIn = FIXTURE_KEYS.indexOf('checkIn') + 1;
    let seen = 0;
    for (const i of staffEntries(views)) {
      const m = views.peopleId[i]! - STAFF_ID_BASE;
      const s = st.stIdx[m]!;
      if (st.state[m] !== STAFF_STATE.OnDuty || s < 0 || st.sKind[s] !== checkIn) continue;
      const code = g.fixtureRot[cellIndex(g, st.sX[s]!, st.sY[s]!)]!;
      const [fx, fy] = frontStep(code >= 1 && code <= 4 ? code - 1 : 0);
      // The chair is 0.56 m behind the desk centre and 0.7 m toward the agent counter, a quarter turn from the queue.
      const chair = cornerWorld(g, st.sX[s]! + 0.5 - fx * 0.28 - fy * 0.35, st.sY[s]! + 0.5 - fy * 0.28 + fx * 0.35);
      expect(Math.hypot(views.peopleX[i]! - chair.x, views.peopleY[i]! - chair.y)).toBeLessThan(0.05);
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('walks members to their station during the shift change, moving toward it', () => {
    const sim = staffSim();
    while (sim.tick < at(13, 20)) sim.step();
    const st = sim.staff;
    const g = sim.business.grids[0]!;
    let found = -1;
    let first: SnapshotViews | null = null;
    for (let t = 0; t < 60 * TICKS_PER_MINUTE && found < 0; t++) {
      sim.step();
      if (t % 10 !== 0) continue;
      const views = snapshot(sim);
      expect(views.header[SnapHeader.PeopleCount]).toBeLessThanOrEqual(SNAPSHOT_PEOPLE_CAPACITY);
      for (const i of staffEntries(views)) {
        const m = views.peopleId[i]! - STAFF_ID_BASE;
        if (views.peopleMode[i] === PEOPLE_MODE.Walking && st.state[m] === STAFF_STATE.ToStation) {
          found = m;
          first = views;
        }
      }
    }
    expect(found).toBeGreaterThanOrEqual(0);
    const s = st.stIdx[found]!;
    const target = cornerWorld(g, st.sX[s]! + 0.5, st.sY[s]! + 0.5);
    const before = first!;
    const idx = staffEntries(before).find((i) => before.peopleId[i] === STAFF_ID_BASE + found)!;
    const d0 = Math.hypot(before.peopleX[idx]! - target.x, before.peopleY[idx]! - target.y);
    for (let t = 0; t < 100; t++) sim.step();
    const after = snapshot(sim);
    const j = staffEntries(after).find((i) => after.peopleId[i] === STAFF_ID_BASE + found);
    if (j !== undefined) {
      const d1 = Math.hypot(after.peopleX[j]! - target.x, after.peopleY[j]! - target.y);
      expect(d1).toBeLessThan(d0);
    } else {
      expect(st.state[found]).toBe(STAFF_STATE.OnDuty);
    }
  }, 120_000);

  it('writes identical entries twice from the same state', () => {
    const sim = staffSim();
    for (let t = 0; t < 100; t++) sim.step();
    const a = snapshot(sim);
    const b = snapshot(sim);
    const n = a.header[SnapHeader.PeopleCount]!;
    expect(b.header[SnapHeader.PeopleCount]).toBe(n);
    for (let i = 0; i < n; i++) {
      expect(b.peopleX[i]).toBe(a.peopleX[i]);
      expect(b.peopleY[i]).toBe(a.peopleY[i]);
      expect(b.peopleHeading[i]).toBe(a.peopleHeading[i]);
      expect(b.peopleId[i]).toBe(a.peopleId[i]);
      expect(b.peopleMode[i]).toBe(a.peopleMode[i]);
    }
  });
});
