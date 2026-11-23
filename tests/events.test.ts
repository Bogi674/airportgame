import { describe, expect, it } from 'vitest';
import { EVENTS, GSE } from '@data/index';
import { eventsSchema } from '@data/schemas/events';
import { TICKS_PER_DAY, TICKS_PER_MINUTE } from '@shared/business';
import { Director, type DirectorEffects, type DirectorHost } from '@sim/events/director';
import { DIVERT_AIRLINE, FlState } from '@sim/ops/traffic';
import { Rng } from '@sim/rng';
import type { Sim } from '@sim/sim';
import { buildTestAirport, ownedSim, run } from './helpers';

const HOUR = 60 * TICKS_PER_MINUTE;

/** A host with every requirement met and the calls recorded. */
type FakeHost = DirectorHost & { log: string[]; cash: number; fx: DirectorEffects | null; weather: string };

function fakeHost(over: Partial<DirectorHost> = {}): FakeHost {
  const h: FakeHost = {
    log: [] as string[],
    cash: 100000,
    fx: null as DirectorEffects | null,
    weather: 'clear',
    emit(code: string) {
      h.log.push(code);
    },
    book(_c: string, amount: number) {
      h.cash += amount;
    },
    getCash: (): number => h.cash,
    climate: () => ({ rainDays: 120, fogDays: 20 }),
    has: () => true,
    pick: () => 0,
    label: () => 'subject',
    startWeather(kind: string) {
      h.weather = kind;
    },
    weatherActive: (): boolean => h.weather !== 'clear',
    apply(fx: DirectorEffects) {
      h.fx = { ...fx, vehiclesOut: new Map(fx.vehiclesOut) };
    },
    addAirlineSatisfaction() {
      h.log.push('happy');
    },
    divert: () => 7,
    wagesPerDay: () => 1000,
    changed() {},
    ...over,
  };
  return h;
}

/** Ids of the events a director fires over the days, each fired event answered by its fallback. */
function runDays(seed: string, days: number): string[] {
  const host = fakeHost();
  const d = new Director(Rng.fromString(seed), host);
  for (let day = 0; day < days; day++) {
    const start = day * TICKS_PER_DAY;
    d.newDay(start);
    for (let t = start; t < start + TICKS_PER_DAY; t += 10) d.update(t);
  }
  return host.log.filter((c) => c.startsWith('eventStart')).map((c) => c.split('=')[1]!);
}

describe('event deck data (T50)', () => {
  it('holds the eight events of D32, two choices each, with a fallback among them', () => {
    expect(EVENTS.events.map((e) => e.id)).toEqual(['rain', 'fog', 'wind', 'fuelDelay', 'breakdown', 'vip', 'diversion', 'staffShortage']);
    for (const e of EVENTS.events) {
      expect(e.choices).toHaveLength(2);
      expect(e.choices.map((c) => c.id)).toContain(e.fallback);
    }
  });

  it('carries the D33 costs', () => {
    const cost = (e: string, c: string): number => EVENTS.events.find((x) => x.id === e)!.choices.find((x) => x.id === c)!.cost;
    expect(cost('fuelDelay', 'priority')).toBe(15000);
    expect(cost('breakdown', 'repair')).toBe(8000);
    expect(cost('vip', 'host')).toBe(10000);
    expect(cost('rain', 'prepare')).toBe(5000);
  });

  it('refuses a fallback that names no choice', () => {
    const bad = structuredClone(EVENTS) as { events: { fallback: string }[] };
    bad.events[0]!.fallback = 'nothing';
    expect(eventsSchema.safeParse(bad).success).toBe(false);
  });
});

describe('event director (T50)', () => {
  it('fires the planned event, waits for a choice and applies it', () => {
    const host = fakeHost();
    const d = new Director(new Rng(1), host);
    expect(d.plan('breakdown', 100)).toBeNull();
    d.update(100);
    const v = d.view(100)!;
    expect(v.id).toBe('breakdown');
    expect(v.minutesLeft).toBe(EVENTS.choiceHours * 60);
    expect(d.choose(v.seq + 1, 'repair', 101)).toBe('eventClosed');
    expect(d.choose(v.seq, 'repair', 101)).toBeNull();
    expect(host.cash).toBe(100000 - 8000);
    expect(d.view(101)).toBeNull();
    expect(host.log).toContain('eventResolved|choice=repair|id=breakdown');
  });

  it('applies the fallback after the choice hours, and its effect ends on time', () => {
    const host = fakeHost();
    const d = new Director(new Rng(1), host);
    d.plan('breakdown', 0);
    d.update(0);
    const deadline = EVENTS.choiceHours * HOUR;
    d.update(deadline - 1);
    expect(host.log.some((c) => c.startsWith('eventFallback'))).toBe(false);
    d.update(deadline);
    expect(host.log).toContain('eventFallback|choice=lose|id=breakdown');
    expect(host.fx!.vehiclesOut.get(0)).toBe(1);
    expect(host.cash).toBe(100000);
    d.update(deadline + 2880 * TICKS_PER_MINUTE);
    expect(host.fx!.vehiclesOut.size).toBe(0);
  });

  it('refuses a choice the cash cannot pay', () => {
    const host = fakeHost();
    host.cash = 100;
    const d = new Director(new Rng(1), host);
    d.plan('fuelDelay', 0);
    d.update(0);
    expect(d.choose(d.view(0)!.seq, 'priority', 1)).toBe('insufficientFunds|cost=15000');
    expect(d.choose(d.view(0)!.seq, 'accept', 1)).toBeNull();
    expect(host.fx!.fuelHeldUntil).toBe(1 + 90 * TICKS_PER_MINUTE);
  });

  it('starts the weather on fire and halves it when prepared, until the weather clears', () => {
    const host = fakeHost();
    const d = new Director(new Rng(1), host);
    d.plan('fog', 0);
    d.update(0);
    expect(host.weather).toBe('fog');
    d.choose(d.view(0)!.seq, 'prepare', 1);
    expect(host.fx!.weatherSeverity).toBe(0.5);
    host.weather = 'clear';
    d.update(10);
    expect(host.fx!.weatherSeverity).toBe(1);
  });

  it('prices overtime from the day of wages and pays it as wages', () => {
    const host = fakeHost();
    const d = new Director(new Rng(1), host);
    d.plan('staffShortage', 0);
    d.update(0);
    const v = d.view(0)!;
    expect(v.choices.find((c) => c.id === 'overtime')!.cost).toBe(500);
    d.choose(v.seq, 'overtime', 1);
    expect(host.cash).toBe(100000 - 500);
    expect(host.fx!.staffShort).toBe(0);
  });

  it('makes a quiet day of an event whose requirements are not met', () => {
    const host = fakeHost({ has: () => false });
    const d = new Director(new Rng(1), host);
    d.plan('vip', 0);
    d.update(0);
    expect(d.view(0)).toBeNull();
  });

  it('draws one event a day, the same run from one seed and a different run from another', () => {
    const a = runDays('SEED-A', 30);
    expect(a.length).toBe(30);
    expect(runDays('SEED-A', 30)).toEqual(a);
    expect(runDays('SEED-B', 30)).not.toEqual(a);
  });

  it('saves and restores mid event', () => {
    const host = fakeHost();
    const d = new Director(new Rng(3), host);
    d.plan('vip', 0);
    d.update(0);
    const copy = new Director(new Rng(3), fakeHost());
    copy.loadState(JSON.parse(JSON.stringify(d.saveState())));
    expect(copy.hash(1)).toBe(d.hash(1));
    expect(copy.view(5)).toEqual(d.view(5));
  });
});

/** Steps the sim until the tick, then returns the events emitted on the way. */
function stepTo(sim: Sim, tick: number): string[] {
  const out: string[] = [];
  while (sim.tick < tick) {
    sim.step();
    sim.drainEvents(out);
  }
  return out;
}

describe('event director in the sim (T50)', () => {
  it('two runs from one seed with an event and a choice give identical hashes, also through a save', () => {
    const sims = [ownedSim(), ownedSim()];
    for (const s of sims) {
      run(s, { type: 'testEvent', id: 'rain' });
      stepTo(s, 100);
      const seq = s.director.view(s.tick)!.seq;
      expect(run(s, { type: 'eventChoice', seq, choice: 'prepare' })).toEqual(['eventResolved|choice=prepare|id=rain']);
      stepTo(s, 2000);
    }
    expect(sims[0]!.stateHash()).toBe(sims[1]!.stateHash());
    const copy = ownedSim();
    copy.restore(JSON.parse(JSON.stringify(sims[0]!.serialize())));
    expect(copy.stateHash()).toBe(sims[0]!.stateHash());
    stepTo(copy, 4000);
    stepTo(sims[0]!, 4000);
    expect(copy.stateHash()).toBe(sims[0]!.stateHash());
  });

  it('draws the day event at midnight on its own stream', () => {
    const sim = ownedSim();
    const ev = stepTo(sim, 18 * HOUR + EVENTS.fireWithinHours * HOUR + 10);
    // An empty site meets only the weather requirements, so the day is weather or quiet.
    const started = ev.filter((c) => c.startsWith('eventStart'));
    expect(started.length).toBeLessThanOrEqual(1);
  });

  it('plays the weather through both choices', () => {
    for (const choice of ['prepare', 'rideOut']) {
      const sim = ownedSim();
      run(sim, { type: 'testEvent', id: 'wind' });
      expect(sim.business.weather).toBe('wind');
      const cash = sim.cash;
      run(sim, { type: 'eventChoice', seq: sim.director.view(sim.tick)!.seq, choice });
      expect(sim.traffic.weatherSeverity).toBe(choice === 'prepare' ? 0.5 : 1);
      expect(cash - sim.cash).toBe(choice === 'prepare' ? 5000 : 0);
    }
  });

  it('takes a broken vehicle out of the fleet the depot sends', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 2 });
    run(sim, { type: 'testEvent', id: 'breakdown' });
    const v = sim.director.view(sim.tick)!;
    const kind = GSE.findIndex((g) => g.name.toLowerCase() === v.subject);
    const before = sim.business.available(kind);
    run(sim, { type: 'eventChoice', seq: v.seq, choice: 'lose' });
    expect(sim.business.available(kind)).toBe(before - 1);
  });

  it('lands an accepted diversion with no passengers that pays the flat fee', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 2 });
    run(sim, { type: 'testEvent', id: 'diversion' });
    const v = sim.director.view(sim.tick)!;
    expect(v.subject).not.toBe('');
    run(sim, { type: 'eventChoice', seq: v.seq, choice: 'accept' });
    let f = -1;
    for (let k = 0; k < sim.traffic.fAirline.length; k++) if (sim.traffic.fAirline[k] === DIVERT_AIRLINE && sim.traffic.fState[k] === FlState.Scheduled) f = k;
    expect(f).toBeGreaterThanOrEqual(0);
    expect(sim.business.paxFor(f)).toBe(0);
  });

  it('refuses a choice for an event that is closed', () => {
    const sim = ownedSim();
    expect(run(sim, { type: 'eventChoice', seq: 9, choice: 'prepare' })).toEqual(['eventClosed']);
  });
});
