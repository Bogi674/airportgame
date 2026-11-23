import { describe, expect, it } from 'vitest';
import { STAFF } from '@data/index';
import { STAFF_ROLE_KEYS } from '@data/schemas/staff';
import { TICKS_PER_MINUTE } from '@shared/business';
import { JANITOR_SET } from '@shared/props';
import { Sim } from '@sim/sim';
import { STAFF_STATE } from '@sim/staff/staff';
import { buildTestAirport, buildTestTerminal, OPTIONS, ownedSim, run } from './helpers';

const CLEANER = STAFF_ROLE_KEYS.indexOf('cleaner');
const MINUTE = TICKS_PER_MINUTE;

type Edit = { op: 'wall' | 'zone'; x0: number; y0: number; x1: number; y1: number; variant: number };

/** A staff room of 4 by 6 cells with its corner at cell (x, 46), a staff door to the hall and a janitor room set. */
function janitorRoom(sim: Sim, x: number, doorOnEast: boolean): string[] {
  const g = sim.business.grids[0]!;
  const edit = (e: Edit): string[] => run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: e });
  const side = doorOnEast ? x + 4 : x;
  return [
    ...edit({ op: 'zone', x0: x, y0: 46, x1: x + 4, y1: 52, variant: 4 }),
    ...edit({ op: 'wall', x0: x, y0: 46, x1: x + 4, y1: 46, variant: 1 }),
    ...edit({ op: 'wall', x0: side, y0: 46, x1: side, y1: 52, variant: 1 }),
    ...edit({ op: 'wall', x0: side, y0: 48, x1: side, y1: 49, variant: 4 }),
    ...run(sim, { type: 'placeProp', building: g.id, asset: JANITOR_SET, x: (x + 1) * 2, y: 98, rot: 0 }),
  ];
}

function cleanSim(o: { west?: boolean; east?: boolean; seed?: string } = {}): Sim {
  const sim = ownedSim(o.seed);
  sim.cash = 1_000_000_000;
  buildTestAirport(sim, { ground: false });
  expect(buildTestTerminal(sim, { checkIn: 2, security: 1, gateDesk: 1 })).toEqual([]);
  if (o.west !== false) expect(janitorRoom(sim, 40, true)).toEqual([]);
  if (o.east) expect(janitorRoom(sim, 64, false)).toEqual([]);
  sim.step();
  return sim;
}

/** The passenger room holding the check in hall, the one passengers walk through first. */
function hallRoom(sim: Sim): number {
  return sim.cleaning.roomAt(0, 46, 44);
}

function cleanersIn(sim: Sim, state: number): number[] {
  const st = sim.staff;
  const out: number[] = [];
  for (let m = 0; m < st.hi; m++) if (st.role[m] === CLEANER && st.state[m] === state) out.push(m);
  return out;
}

describe('cleaners and terminal dirt (T81)', () => {
  it('bases cleanerBase cleaners at each janitor room set on staff floor, on three shifts', () => {
    const sim = cleanSim();
    const st = sim.staff;
    let base = -1;
    for (let s = 0; s < st.stCount; s++) if (st.sRole[s] === CLEANER) base = s;
    expect(base).toBeGreaterThanOrEqual(0);
    expect(st.sNeed[base]).toBe(2);
    expect(st.hired(CLEANER)).toBe(3 * (2 + 1));
    expect(cleanersIn(sim, STAFF_STATE.OnDuty)).toHaveLength(2);
  });

  it('splits the floor into rooms and counts only rooms off the staff zone', () => {
    const sim = cleanSim();
    const rooms = sim.cleaning.rooms[0]!;
    const hall = hallRoom(sim);
    const janitor = sim.cleaning.roomAt(0, 41, 50);
    expect(hall).toBeGreaterThanOrEqual(0);
    expect(janitor).toBeGreaterThanOrEqual(0);
    expect(janitor).not.toBe(hall);
    expect(rooms.pax[hall]).toBe(1);
    expect(rooms.pax[janitor]).toBe(0);
    expect(rooms.full[hall]).toBe(rooms.area[hall]! * 4 * STAFF.cleaning.dirtyPerM2);
  });

  it('sends a cleaner to a dirty room, who cleans it and walks back to the janitor room', () => {
    const sim = cleanSim();
    const rooms = sim.cleaning.rooms[0]!;
    const hall = hallRoom(sim);
    rooms.dirt[hall] = rooms.full[hall]!;
    expect(sim.cleaning.needsCleaner(0, hall)).toBe(true);
    let sent = -1;
    let sentAt = -1;
    for (let t = 0; t < 3 * MINUTE && sent < 0; t++) {
      sim.step();
      sent = cleanersIn(sim, STAFF_STATE.ToClean)[0] ?? -1;
      if (sent >= 0) sentAt = sim.tick;
    }
    expect(sent).toBeGreaterThanOrEqual(0);
    expect(cleanersIn(sim, STAFF_STATE.ToClean)).toHaveLength(1);
    const st = sim.staff;
    expect(st.wake[sent]).toBeGreaterThan(sentAt);
    const minutes = sim.cleaning.cleanMinutes(0, hall);
    for (let t = 0; t < 120 * MINUTE && st.state[sent] !== STAFF_STATE.CleanBack; t++) sim.step();
    expect(st.state[sent]).toBe(STAFF_STATE.CleanBack);
    expect(sim.tick - sentAt).toBeGreaterThanOrEqual(minutes * MINUTE);
    expect(rooms.dirt[hall]).toBeLessThan(rooms.full[hall]! * STAFF.cleaning.callShare);
    for (let t = 0; t < 30 * MINUTE && st.state[sent] !== STAFF_STATE.OnDuty; t++) sim.step();
    expect(st.state[sent]).toBe(STAFF_STATE.OnDuty);
  }, 60000);

  it('sends the cleaner of the base nearest by walking time, so a farther base answers later', () => {
    const response = (o: { west?: boolean; east?: boolean }): { base: number; ticks: number } => {
      const sim = cleanSim(o);
      const rooms = sim.cleaning.rooms[0]!;
      const hall = hallRoom(sim);
      rooms.dirt[hall] = rooms.full[hall]!;
      for (let t = 0; t < 3 * MINUTE; t++) {
        sim.step();
        const m = cleanersIn(sim, STAFF_STATE.ToClean)[0];
        if (m !== undefined) return { base: sim.staff.stX[m]!, ticks: sim.staff.wake[m]! - sim.tick };
      }
      throw new Error('no cleaner sent');
    };
    const west = response({ west: true });
    const east = response({ west: false, east: true });
    expect(west.ticks).not.toBe(east.ticks);
    const both = response({ west: true, east: true });
    expect(both.ticks).toBe(Math.min(west.ticks, east.ticks));
    expect(both.base).toBe(west.ticks < east.ticks ? west.base : east.base);
  }, 60000);

  it('lets dirt rise without a janitor room, lowering terminal cleanliness and the passenger rating', () => {
    const dirty = (west: boolean): Sim => {
      const sim = cleanSim({ west, seed: 'CLEAN-0001' });
      expect(run(sim, { type: 'setTestTraffic', perHour: 6, turnScale: 1 })).toEqual([]);
      const rooms = sim.cleaning.rooms[0]!;
      rooms.dirt[hallRoom(sim)] = Math.round(rooms.full[hallRoom(sim)]! * 0.5);
      for (let t = 0; t < 3 * 60 * MINUTE; t++) sim.step();
      return sim;
    };
    const none = dirty(false);
    let dirt = 0;
    for (const r of none.cleaning.rooms) for (let k = 0; k < r.count; k++) dirt += r.dirt[k]!;
    expect(dirt).toBeGreaterThan(0);
    expect(none.cleaning.cleanliness).toBeLessThan(1);
    expect(none.business.terminalClean!()).toBe(none.cleaning.cleanliness);
    const kept = dirty(true);
    expect(kept.cleaning.cleanliness).toBeGreaterThan(none.cleaning.cleanliness);
    // The rating mixes the cabin score and the terminal rooms for the passenger cleanliness part.
    const part = (sim: Sim): number => (sim.business.cleanScore + sim.cleaning.cleanliness) / 2;
    expect(part(kept)).toBeGreaterThan(part(none));
  }, 120000);

  it('keeps the dirt of a room across a floor edit that leaves it standing', () => {
    const sim = cleanSim();
    const hall = hallRoom(sim);
    sim.cleaning.rooms[0]!.dirt[hall] = 1234;
    const g = sim.business.grids[0]!;
    expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, edit: { op: 'wall', x0: 60, y0: 40, x1: 60, y1: 41, variant: 1 } })).toEqual([]);
    sim.step();
    expect(sim.cleaning.rooms[0]!.dirt[hallRoom(sim)]).toBeGreaterThanOrEqual(1234);
  });

  it('loads a version 37 save, from before dirt, with clean rooms', () => {
    const sim = cleanSim({ seed: 'CLEAN-0003' });
    sim.cleaning.rooms[0]!.dirt[hallRoom(sim)] = 500;
    const data = JSON.parse(JSON.stringify(sim.serialize())) as { version: number; cleaning?: unknown };
    data.version = 37;
    delete data.cleaning;
    const b = new Sim('CLEAN-0003', OPTIONS);
    b.restore(data);
    expect(b.cleaning.rooms[0]!.dirt[hallRoom(b)]).toBe(0);
    expect(b.cleaning.cleanliness).toBe(1);
  });

  it('two sims from one seed agree over 2000 ticks with a cleaner at work, and a restore replays the same', () => {
    const go = (): Sim => {
      const sim = cleanSim({ seed: 'CLEAN-0002' });
      const rooms = sim.cleaning.rooms[0]!;
      rooms.dirt[hallRoom(sim)] = rooms.full[hallRoom(sim)]!;
      for (let t = 0; t < 3 * MINUTE; t++) sim.step();
      return sim;
    };
    const a = go();
    const b = go();
    expect(cleanersIn(a, STAFF_STATE.ToClean).length + cleanersIn(a, STAFF_STATE.Cleaning).length).toBe(1);
    const c = new Sim('CLEAN-0002', OPTIONS);
    c.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(c.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
      c.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
    expect(c.stateHash()).toBe(a.stateHash());
  }, 60000);
});
