import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { DEPARTURES } from '@data/index';
import { PROFILE_KEYS } from '@data/schemas/profiles';
import { Sim } from '@sim/sim';
import { Stage } from '@sim/cohorts/cohorts';
import { COHORT_DRAW, traitU } from '@sim/cohorts/traits';
import { FIXTURE_KEYS, TICKS_PER_DAY } from '@shared/business';
import { buildArrivalTerminal, buildTestAirport, OPTIONS, ownedSim, run } from './helpers';

const A320 = AIRCRAFT.findIndex((a) => a.id === 'a320neo');
const PASSPORT = FIXTURE_KEYS.indexOf('passport') + 1;
const EGATE = FIXTURE_KEYS.indexOf('eGate') + 1;
const FAMILY = PROFILE_KEYS.indexOf('family');

/**
 * The arrival hall of T20 with customs and a carousel, plus passport control in departure mode on the wall between the
 * secure hall (north) and the international hall (south): a booth, or an eGate when asked. Returns the sim.
 */
function intlHall(o: { departure?: 'passport' | 'eGate' | 'both' | 'none'; customs?: boolean } = {}): Sim {
  const sim = ownedSim();
  sim.cash = 1_000_000_000;
  buildTestAirport(sim, { standsPerRow: 8 });
  expect(buildArrivalTerminal(sim, { carousel: true, customs: o.customs !== false })).toEqual([]);
  const g = sim.business.grids[0]!;
  const edit = (e: { op: 'removeWall' | 'fixture'; x0: number; y0: number; x1: number; y1: number; variant: number; rot?: 0 | 1 | 2 | 3; mode?: number }): void => {
    expect(run(sim, { type: 'terminalBuild', building: g.id, ox: g.ox, oy: g.oy, headingDeg: 90, edit: e })).toEqual([]);
  };
  const dep = o.departure ?? 'passport';
  // Rotation 2 flows toward the higher row index, from the secure hall into the international hall.
  if (dep === 'passport' || dep === 'both') {
    edit({ op: 'removeWall', x0: 88, y0: 50, x1: 89, y1: 50, variant: 0 });
    edit({ op: 'fixture', x0: 88, y0: 49, x1: 89, y1: 50, variant: PASSPORT, rot: 2, mode: 0 });
  }
  if (dep === 'eGate' || dep === 'both') {
    edit({ op: 'removeWall', x0: 92, y0: 50, x1: 93, y1: 50, variant: 0 });
    edit({ op: 'fixture', x0: 92, y0: 49, x1: 93, y1: 50, variant: EGATE, rot: 2, mode: 0 });
  }
  return sim;
}

/** Schedules a flight of a series to an international (or domestic) destination on stand 0 and returns it. */
function departRoute(sim: Sim, international: boolean): number {
  const market = sim.business.market;
  const dest = market.destinations.find((d) => d.international === international)!;
  const id = international ? 9001 : 9002;
  market.series.push({ id, airline: 0, dest: dest.id, typeIdx: A320, days: 127, winMin: 0, startDay: 0, endDay: 100, standId: -1, minute: -1, turnMin: 30 });
  const t = sim.traffic;
  const f = t.scheduleArrival(A320, t.nowTick + 100, 0, t.turnaroundTicks(A320), 0, 0, id);
  t.fStand[f] = sim.airfield.data.stands[0]!.id;
  return f;
}

/** Steps until no departing cohort is active, recording per slot the stages seen in order of first sight. */
function runDepartures(sim: Sim, maxTicks = 40000): number[][] {
  const co = sim.cohorts;
  const order: number[][] = Array.from({ length: co.cap }, () => []);
  for (let t = 0; t < maxTicks; t++) {
    sim.step();
    for (let c = 0; c < co.hi; c++) {
      const st = co.stage[c]!;
      if (st === Stage.Free || (st >= Stage.Deboard && st <= Stage.ToExit)) continue;
      const seen = order[c]!;
      if (seen[seen.length - 1] !== st) seen.push(st);
    }
    if (t > 200 && co.active === 0) break;
  }
  return order;
}

describe('international flow readiness (T79)', () => {
  it('is ready only with departure and arrival passport control, an international gate desk and customs', () => {
    expect(intlHall().business.internationalReady()).toBe(true);
    expect(intlHall({ departure: 'none' }).business.internationalReady()).toBe(false);
    expect(intlHall({ customs: false }).business.internationalReady()).toBe(false);
  }, 30_000);
});

describe('international departures (T79)', () => {
  it('every cohort of an international flight passes passport control after security and before airside', () => {
    const sim = intlHall();
    departRoute(sim, true);
    const order = runDepartures(sim);
    const co = sim.cohorts;
    expect(co.generated).toBeGreaterThan(0);
    expect(co.boarded).toBeGreaterThan(0);
    let passed = 0;
    for (const seen of order) {
      const at = seen.indexOf(Stage.Emigration);
      if (seen.indexOf(Stage.Gate) < 0) continue;
      expect(at, seen.join(',')).toBeGreaterThan(seen.indexOf(Stage.Security));
      expect(seen.indexOf(Stage.Airside), seen.join(',')).toBeGreaterThan(at);
      passed++;
    }
    expect(passed).toBeGreaterThan(0);
  });

  it('a domestic flight never queues at passport control', () => {
    const sim = intlHall();
    departRoute(sim, false);
    const order = runDepartures(sim);
    expect(sim.cohorts.boarded).toBeGreaterThan(0);
    for (const seen of order) {
      expect(seen.includes(Stage.Emigration)).toBe(false);
      expect(seen.includes(Stage.ToEmigration)).toBe(false);
    }
  });

  it('families never use a departure eGate and referred cohorts go on to a booth', () => {
    const sim = intlHall({ departure: 'both' });
    departRoute(sim, true);
    const co = sim.cohorts;
    const nodes = (): ReturnType<typeof sim.business.serviceTable> => sim.business.serviceTable(sim.business.grids[0]!.id);
    const kinds: number[][] = Array.from({ length: co.cap }, () => []);
    for (let t = 0; t < 40000; t++) {
      sim.step();
      const sn = nodes()!;
      for (let c = 0; c < co.hi; c++) {
        if (co.stage[c] !== Stage.Emigration || co.node[c]! < 0) continue;
        const k = sn.kind[co.node[c]!]!;
        const seen = kinds[c]!;
        if (seen[seen.length - 1] !== k) seen.push(k);
      }
      if (t > 200 && co.active === 0) break;
    }
    let viaGate = 0;
    for (let c = 0; c < co.cap; c++) {
      const seen = kinds[c]!;
      if (seen.length === 0) continue;
      if (co.profile[c] === FAMILY) expect(seen).toEqual([PASSPORT]);
      if (seen[0] === EGATE) {
        viaGate++;
        const referred = traitU(co.recipeSeed[c]!, COHORT_DRAW.Referral) < DEPARTURES.service.eGate.referralShare;
        expect(seen).toEqual(referred ? [EGATE, PASSPORT] : [EGATE]);
      }
    }
    expect(viaGate).toBeGreaterThan(0);
  });

  it('runs 2000 ticks twice from one seed to the same hash, and a save mid flow restores the same hash', () => {
    const a = intlHall();
    const b = intlHall();
    departRoute(a, true);
    departRoute(b, true);
    let queued = false;
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 30000 && !queued; t++) {
      a.step();
      for (let c = 0; c < a.cohorts.hi && !queued; c++) queued = a.cohorts.stage[c] === Stage.Emigration;
    }
    expect(queued).toBe(true);
    const r = new Sim('GOLDEN-0001', OPTIONS);
    r.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(r.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 2000; t++) {
      a.step();
      r.step();
    }
    expect(r.stateHash()).toBe(a.stateHash());
  });
});

describe('international offers and flights (T79)', () => {
  it('offers no international series while the flow is missing', () => {
    const sim = ownedSim();
    expect(sim.business.internationalReady()).toBe(false);
    for (const a of sim.business.airlines) a.minRating = 0;
    for (const a of sim.business.airlines) run(sim, { type: 'signAirline', airlineId: a.id, sign: true });
    const market = sim.business.market;
    expect(market.series.length).toBeGreaterThan(0);
    for (const s of market.series) expect(market.destinations[s.dest]!.international).toBe(false);
  });

  it('cancels a signed international flight at the daily close while the flow is missing, and flies it once built', () => {
    const missing = intlHall({ customs: false });
    const ready = intlHall();
    const count = (sim: Sim): { flights: number; events: string[] } => {
      const market = sim.business.market;
      market.series.length = 0;
      const a = sim.business.airlines[0]!;
      a.signed = true;
      const dest = market.destinations.find((d) => d.international)!;
      market.series.push({ id: 9001, airline: a.id, dest: dest.id, typeIdx: A320, days: 127, winMin: 600, startDay: 0, endDay: 100, standId: sim.airfield.data.stands[0]!.id, minute: 600, turnMin: 30 });
      const events: string[] = [];
      for (let t = 0; t < TICKS_PER_DAY + 10; t++) {
        sim.step();
        sim.drainEvents(events);
      }
      let flights = 0;
      for (let f = 0; f < sim.traffic.fState.length; f++) if (sim.traffic.fRot[f] === 9001) flights++;
      return { flights, events };
    };
    const m = count(missing);
    expect(m.flights).toBe(0);
    expect(m.events.some((e) => e.startsWith('intlFlowMissing'))).toBe(true);
    const r = count(ready);
    expect(r.flights).toBeGreaterThan(0);
    expect(r.events.some((e) => e.startsWith('intlFlowMissing'))).toBe(false);
  });
});
