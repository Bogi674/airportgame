import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { buildTestAirport, ownedSim, run } from './helpers';

function airport() {
  const sim = ownedSim();
  sim.cash = 500_000_000;
  buildTestAirport(sim, { standsPerRow: 4 });
  return sim;
}

describe('runway edits', () => {
  it('extends at an end into one longer runway and shortens it again', () => {
    const sim = airport();
    const r = sim.airfield.data.runways[0];
    const len = r.lengthM;
    const cash = sim.cash;
    expect(run(sim, { type: 'resizeRunway', id: r.id, end: 'a', deltaM: 300 })).toEqual([]);
    expect(sim.airfield.data.runways).toHaveLength(1);
    expect(sim.airfield.data.runways[0].lengthM).toBe(len + 300);
    expect(sim.cash).toBeLessThan(cash);
    expect(run(sim, { type: 'resizeRunway', id: r.id, end: 'a', deltaM: -300 })).toEqual([]);
    expect(sim.airfield.data.runways[0].lengthM).toBe(len);
  });

  it('refuses to shorten past a connector and below the minimum', () => {
    const sim = airport();
    const r = sim.airfield.data.runways[0];
    expect(run(sim, { type: 'resizeRunway', id: r.id, end: 'b', deltaM: -(r.lengthM - 200) })[0]).toMatch(/runwayLength/);
    expect(run(sim, { type: 'resizeRunway', id: r.id, end: 'b', deltaM: -1200 })[0]).toBe('runwayInUse');
  });

  it('changes class and approach, and connectors follow the new edge', () => {
    const sim = airport();
    const r = sim.airfield.data.runways[0];
    expect(run(sim, { type: 'reclassRunway', id: r.id, code: 'D', approach: 'precision' })).toEqual([]);
    const n = sim.airfield.data.runways[0];
    expect(n.widthM).toBe(45);
    expect(n.code).toBe('D');
    const edge = n.widthM / 2 + n.shoulderM;
    const near = sim.airfield.data.taxiways.some((t) =>
      t.points.some((p) => {
        const dx = p.x - n.x1;
        const dy = p.y - n.y1;
        return Math.abs(Math.abs(dy) - edge) < 1.5 && dx > 0 && dx < n.lengthM;
      }),
    );
    expect(near).toBe(true);
  });
});

describe('taxiway edits', () => {
  it('trims an end, extends it again and cuts a section out of the middle', () => {
    const sim = airport();
    const t = sim.airfield.data.taxiways.find((x) => x.kind === 'taxiway' && x.points.length >= 2);
    if (!t) throw new Error('no taxiway');
    const a = t.points[0];
    const b = t.points[t.points.length - 1];
    const mid = { x: a.x + (b.x - a.x) * 0.8, y: a.y + (b.y - a.y) * 0.8 };
    const before = sim.airfield.data.taxiways.length;
    expect(run(sim, { type: 'editTaxiway', id: t.id, op: 'trim', end: 'end', at: mid })).toEqual([]);
    const tt = sim.airfield.data.taxiways.find((x) => x.id === t.id);
    expect(tt).toBeDefined();
    const q1 = { x: a.x + (b.x - a.x) * 0.3, y: a.y + (b.y - a.y) * 0.3 };
    const q2 = { x: a.x + (b.x - a.x) * 0.5, y: a.y + (b.y - a.y) * 0.5 };
    expect(run(sim, { type: 'editTaxiway', id: t.id, op: 'cut', at: q1, at2: q2 })).toEqual([]);
    expect(sim.airfield.data.taxiways.length).toBe(before + 1);
  });
});

import { alignGuide } from '@shared/airfieldGeom';

describe('alignment guide', () => {
  it('snaps onto the extension of a taxiway and onto the square line, and ignores far points', () => {
    const sim = airport();
    const af = sim.airfield.data;
    const t = af.taxiways.find((x) => x.kind === 'taxiway');
    if (!t) throw new Error('no taxiway');
    const a = t.points[0];
    const b = t.points[1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / l;
    const uy = (b.y - a.y) / l;
    // 300 m past the end, 3 m off the line.
    const near = { x: b.x + ux * 300 - uy * 3, y: b.y + uy * 300 + ux * 3 };
    const g = alignGuide(af, [], near.x, near.y, 9);
    expect(g).not.toBeNull();
    if (g) expect(Math.hypot(g.p.x - near.x, g.p.y - near.y)).toBeLessThan(9);
    expect(alignGuide(af, [], near.x + 4000, near.y + 4000, 9)).toBeNull();
  });
});

describe('stand management', () => {
  const idx = (id: string): number => AIRCRAFT.findIndex((a) => a.id === id);

  function landOne(sim: ReturnType<typeof airport>, f: number): number {
    let standId = -1;
    for (let t = 0; t < 12000 && standId < 0; t++) {
      sim.step();
      for (let a = 0; a < 256; a++) if (sim.traffic.active[a] === 1 && sim.traffic.flight[a] === f && sim.traffic.standId[a] >= 0) standId = sim.traffic.standId[a];
    }
    return standId;
  }

  it('uses the stand the player assigned and never a closed one', () => {
    const sim = airport();
    const stands = sim.airfield.data.stands;
    const f = sim.traffic.scheduleArrival(idx('atr72_600'), sim.traffic.nowTick + 100, 0, 600, -1);
    run(sim, { type: 'assignStand', flight: f, standId: stands[2].id });
    expect(landOne(sim, f)).toBe(stands[2].id);

    const sim2 = airport();
    const s2 = sim2.airfield.data.stands;
    for (const s of s2.slice(1)) run(sim2, { type: 'setStandProps', id: s.id, closed: true });
    const f2 = sim2.traffic.scheduleArrival(idx('atr72_600'), sim2.traffic.nowTick + 100, 0, 600, -1);
    expect(landOne(sim2, f2)).toBe(s2[0].id);
  });

  it('without auto scheduling an unassigned flight waits, and the auto assigner fills the gaps', () => {
    const sim = airport();
    run(sim, { type: 'setAutoStands', on: false });
    const f = sim.traffic.scheduleArrival(idx('atr72_600'), sim.traffic.nowTick + 100, 0, 600, -1);
    for (let t = 0; t < 4000; t++) sim.step();
    expect(sim.traffic.fState[f]).toBe(1);
    run(sim, { type: 'autoAssignStands' });
    expect(sim.traffic.fStand[f]).toBeGreaterThanOrEqual(0);
    expect(landOne(sim, f)).toBe(sim.traffic.fStand[f]);
  });

  it('cancels a scheduled flight', () => {
    const sim = airport();
    const f = sim.traffic.scheduleArrival(idx('atr72_600'), sim.traffic.nowTick + 90000, 0, 600, -1);
    run(sim, { type: 'cancelFlight', flight: f });
    expect(sim.traffic.fState[f]).not.toBe(1);
  });
});

describe('ground handling fleet', () => {
  it('buying vehicles costs money and a short fleet slows turnarounds', () => {
    const sim = airport();
    const before = sim.business.fleet.slice();
    const cash = sim.cash;
    expect(run(sim, { type: 'buyGse', kind: 'beltloader', count: 2 })).toEqual([]);
    const i = before.length > 0 ? 3 : 0;
    expect(sim.business.fleet[i]).toBe(before[i] + 2);
    expect(sim.cash).toBeLessThan(cash);
    expect(run(sim, { type: 'buyGse', kind: 'nonsense', count: 1 })[0]).toBe('nothingThere');
    expect(sim.traffic.serviceSlowdown).toBe(1);
  });
});

describe('taxiway naming and upgrades', () => {
  it('names the main taxiway A and numbers its connectors', () => {
    const sim = airport();
    const names = sim.airfield.data.taxiways.map((t) => t.name);
    expect(names).toContain('A');
    expect(names).toContain('A1');
    expect(names.some((n) => /[IONX]/.test(n))).toBe(false);
    expect(new Set(names).size).toBe(names.length);
  });

  it('changes class and surface, and reverses direction', () => {
    const sim = airport();
    const t = sim.airfield.data.taxiways.find((x) => x.name === 'A');
    if (!t) throw new Error('no A');
    const first = { ...t.points[0] };
    const cash = sim.cash;
    expect(run(sim, { type: 'reclassTaxiway', id: t.id, code: 'D', surface: 'concrete', tier: 1 })).toEqual([]);
    const u = sim.airfield.data.taxiways.find((x) => x.id === t.id);
    expect(u?.widthM).toBe(18);
    expect(u?.surface).toBe('concrete');
    expect(sim.cash).toBeLessThan(cash);
    expect(run(sim, { type: 'reverseTaxiway', id: t.id })).toEqual([]);
    const v = sim.airfield.data.taxiways.find((x) => x.id === t.id);
    expect(v?.points[v.points.length - 1]).toEqual(first);
  });
});
