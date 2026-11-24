import { EVENTS } from '@data/index';
import type { EventEffect, EventRequire } from '@data/schemas/events';
import { TICKS_PER_MINUTE } from '@shared/business';
import type { EventView, WeatherKind } from '@shared/business';
import type { LedgerCategory } from '@shared/business';
import { foldU32 } from '../hash';
import type { Rng } from '../rng';

/** What the director reads from and changes in the rest of the sim (T50). */
export interface DirectorHost {
  emit(code: string): void;
  book(category: LedgerCategory, amount: number): void;
  getCash(): number;
  /** Days with rain and fog per year at the site. */
  climate(): { rainDays: number; fogDays: number };
  has(req: EventRequire): boolean;
  /** Draws the subject of an event from the given stream: a vehicle kind, a signed airline id or an aircraft type, -1 when none. */
  pick(req: EventRequire, rng: Rng): number;
  /** Label of the subject for the player: vehicle id, airline name or aircraft type id. */
  label(req: EventRequire, arg: number): string;
  startWeather(kind: WeatherKind, ticks: number): void;
  weatherActive(): boolean;
  /** Derived effect state, pushed after every change and after a restore. */
  apply(state: DirectorEffects): void;
  addAirlineSatisfaction(airline: number, points: number): void;
  /** Schedules a diverted arrival of the type and returns its flight serial, or -1 when no flight slot is free. */
  divert(type: number, etaTick: number, holdTicks: number): number;
  wagesPerDay(): number;
  /** Something the payload shows changed. */
  changed(): void;
}

/** The combined effect of every active consequence, read by fuel, vehicles, staff and traffic. */
export interface DirectorEffects {
  fuelHeldUntil: number;
  /** Vehicles out of the fleet per kind index. */
  vehiclesOut: Map<number, number>;
  staffShort: number;
  weatherSeverity: number;
}

const KIND_FUEL = 0;
const KIND_VEHICLE = 1;
const KIND_STAFF = 2;
const KIND_WEATHER = 3;

interface Active {
  kind: number;
  until: number;
  arg: number;
  share: number;
}

interface Pending {
  seq: number;
  event: number;
  deadline: number;
  arg: number;
}

export interface DirectorSave {
  rng: number;
  seq: number;
  planEvent: number;
  planTick: number;
  pending: Pending | null;
  active: Active[];
  fees: number[];
}

const HOUR = 60 * TICKS_PER_MINUTE;

/** The first requirement that names the subject of an event, or null when it has none. */
function subjectOf(event: number): EventRequire | null {
  for (const r of EVENTS.events[event]!.requires) if (r === 'vehicle' || r === 'airline' || r === 'diversionType') return r;
  return null;
}

/**
 * Seeded event director (T50, D32, D33). Each game day it draws one event of the deck by weight on its own stream.
 * The event fires at a whole hour of the day, offers two choices and applies the fallback when the player has not
 * chosen in time. A drawn event whose requirements the airport does not meet makes a quiet day.
 */
export class Director {
  private readonly rng: Rng;
  private seq = 0;
  private planEvent = -1;
  private planTick = 0;
  private pending: Pending | null = null;
  private active: Active[] = [];
  /** Serial and fee pairs of accepted diversions that have not docked yet. */
  private fees: number[] = [];
  private readonly effects: DirectorEffects = { fuelHeldUntil: 0, vehiclesOut: new Map(), staffShort: 0, weatherSeverity: 1 };

  constructor(
    rng: Rng,
    private readonly host: DirectorHost,
  ) {
    this.rng = rng.fork('events');
  }

  /** Draw weight of an event: its weight, or for weather its climate share of days times the climate weight. */
  private weight(e: number): number {
    const ev = EVENTS.events[e]!;
    if (ev.weight !== undefined) return ev.weight;
    const c = this.host.climate();
    const days = ev.weather === 'rain' ? c.rainDays / 365 : ev.weather === 'fog' ? c.fogDays / 365 : EVENTS.windShare;
    return days * EVENTS.climateWeight;
  }

  private eligible(e: number): boolean {
    for (const r of EVENTS.events[e]!.requires) if (!this.host.has(r)) return false;
    return true;
  }

  /** Called at the start of every game day: draws the day's event and the hour it fires. */
  newDay(tick: number): void {
    let total = 0;
    for (let e = 0; e < EVENTS.events.length; e++) total += this.weight(e);
    const r = this.rng.next() * total;
    const hour = this.rng.int(0, EVENTS.fireWithinHours - 1);
    let acc = 0;
    let drawn = -1;
    for (let e = 0; e < EVENTS.events.length && drawn < 0; e++) {
      acc += this.weight(e);
      if (r < acc) drawn = e;
    }
    this.planEvent = drawn >= 0 && this.eligible(drawn) ? drawn : -1;
    this.planTick = tick + hour * HOUR + 1;
  }

  /** Plans the event with the id to fire on the tick, in place of the day's draw. For tests and scenarios. */
  plan(id: string, tick: number): string | null {
    const e = EVENTS.events.findIndex((x) => x.id === id);
    if (e < 0) return 'nothingThere';
    this.planEvent = e;
    this.planTick = tick;
    return null;
  }

  /** Called every tick, cheap: fires the planned event, applies a due fallback and ends expired effects. */
  update(tick: number): void {
    if (this.planEvent >= 0 && tick >= this.planTick) this.fire(tick);
    if (this.pending && tick >= this.pending.deadline) {
      const ev = EVENTS.events[this.pending.event]!;
      const c = ev.choices.findIndex((x) => x.id === ev.fallback);
      this.resolve(c, tick, true);
    }
    if (tick % 10 !== 0 || this.active.length === 0) return;
    const weather = this.host.weatherActive();
    let kept = 0;
    for (let i = 0; i < this.active.length; i++) {
      const a = this.active[i]!;
      const over = a.kind === KIND_WEATHER ? !weather : tick >= a.until;
      if (!over) this.active[kept++] = a;
    }
    if (kept !== this.active.length) {
      this.active.length = kept;
      this.refresh();
      this.host.changed();
    }
  }

  private fire(tick: number): void {
    const e = this.planEvent;
    this.planEvent = -1;
    if (!this.eligible(e)) return;
    const ev = EVENTS.events[e]!;
    const subject = subjectOf(e);
    const arg = subject ? this.host.pick(subject, this.rng) : -1;
    if (subject && arg < 0) return;
    if (ev.weather) {
      const hours = this.rng.int(EVENTS.weatherHours.min, EVENTS.weatherHours.max);
      this.host.startWeather(ev.weather, hours * HOUR);
    }
    this.seq++;
    this.pending = { seq: this.seq, event: e, deadline: tick + EVENTS.choiceHours * HOUR, arg };
    this.host.emit(`eventStart|id=${ev.id}`);
    this.host.changed();
  }

  /** The player's choice for the open event. Returns a problem code or null. */
  choose(seq: number, choice: string, tick: number): string | null {
    const p = this.pending;
    if (!p || p.seq !== seq) return 'eventClosed';
    const ev = EVENTS.events[p.event]!;
    const c = ev.choices.findIndex((x) => x.id === choice);
    if (c < 0) return 'eventClosed';
    const cost = this.costOf(ev.choices[c]!.cost, ev.choices[c]!.effects);
    if (cost > this.host.getCash()) return `insufficientFunds|cost=${Math.round(cost)}`;
    this.resolve(c, tick, false);
    return null;
  }

  /** The flat cost of a choice plus the wage premium of its effects. */
  private costOf(flat: number, effects: readonly EventEffect[]): number {
    let cost = flat;
    for (const x of effects) if (x.kind === 'wagePremium') cost += Math.round(x.share * this.host.wagesPerDay());
    return cost;
  }

  private resolve(c: number, tick: number, fallback: boolean): void {
    const p = this.pending!;
    this.pending = null;
    const ev = EVENTS.events[p.event]!;
    const ch = ev.choices[c]!;
    if (ch.cost > 0) this.host.book('incidents', -ch.cost);
    for (const x of ch.effects) this.effect(x, p.arg, tick);
    this.refresh();
    this.host.emit(`${fallback ? 'eventFallback' : 'eventResolved'}|choice=${ch.id}|id=${ev.id}`);
    this.host.changed();
  }

  private effect(x: EventEffect, arg: number, tick: number): void {
    switch (x.kind) {
      case 'weatherSeverity':
        if (this.host.weatherActive()) this.active.push({ kind: KIND_WEATHER, until: 0, arg: -1, share: x.share });
        break;
      case 'fuelHold':
        this.active.push({ kind: KIND_FUEL, until: tick + x.minutes * TICKS_PER_MINUTE, arg: -1, share: 1 });
        break;
      case 'vehicleOut':
        this.active.push({ kind: KIND_VEHICLE, until: tick + x.minutes * TICKS_PER_MINUTE, arg, share: 1 });
        break;
      case 'staffShort':
        this.active.push({ kind: KIND_STAFF, until: tick + x.minutes * TICKS_PER_MINUTE, arg: -1, share: x.share });
        break;
      case 'airlineSatisfaction':
        this.host.addAirlineSatisfaction(arg, x.points);
        break;
      case 'wagePremium':
        this.host.book('wages', -Math.round(x.share * this.host.wagesPerDay()));
        break;
      case 'diversion': {
        const serial = this.host.divert(arg, tick + EVENTS.diversionLeadMin * TICKS_PER_MINUTE, x.minutes * TICKS_PER_MINUTE);
        if (serial >= 0) this.fees.push(serial, x.fee);
        break;
      }
    }
  }

  /** The fee of a diverted flight that docks, removed from the list. 0 for any other flight. */
  takeFee(serial: number): number {
    for (let i = 0; i < this.fees.length; i += 2) {
      if (this.fees[i] !== serial) continue;
      const fee = this.fees[i + 1]!;
      this.fees.splice(i, 2);
      return fee;
    }
    return 0;
  }

  /** Recomputes the combined effects and hands them to the host. */
  private refresh(): void {
    const fx = this.effects;
    fx.fuelHeldUntil = 0;
    fx.vehiclesOut.clear();
    fx.staffShort = 0;
    fx.weatherSeverity = 1;
    for (const a of this.active) {
      if (a.kind === KIND_FUEL) fx.fuelHeldUntil = Math.max(fx.fuelHeldUntil, a.until);
      else if (a.kind === KIND_VEHICLE) fx.vehiclesOut.set(a.arg, (fx.vehiclesOut.get(a.arg) ?? 0) + 1);
      else if (a.kind === KIND_STAFF) fx.staffShort = Math.max(fx.staffShort, a.share);
      else fx.weatherSeverity = Math.min(fx.weatherSeverity, a.share);
    }
    this.host.apply(fx);
  }

  /** The open event for the UI, or null. */
  view(tick: number): EventView | null {
    const p = this.pending;
    if (!p) return null;
    const ev = EVENTS.events[p.event]!;
    const subject = subjectOf(p.event);
    return {
      seq: p.seq,
      id: ev.id,
      subject: subject ? this.host.label(subject, p.arg) : '',
      minutesLeft: Math.max(0, Math.ceil((p.deadline - tick) / TICKS_PER_MINUTE)),
      fallback: ev.fallback,
      choices: ev.choices.map((c) => ({ id: c.id, cost: this.costOf(c.cost, c.effects) })),
    };
  }

  saveState(): DirectorSave {
    return {
      rng: this.rng.getState(),
      seq: this.seq,
      planEvent: this.planEvent,
      planTick: this.planTick,
      pending: this.pending ? { ...this.pending } : null,
      active: this.active.map((a) => ({ ...a })),
      fees: this.fees.slice(),
    };
  }

  /** Loads saved state, or resets to a director with nothing planned for saves from before T50. Pushes the effects either way. */
  loadState(s: DirectorSave | undefined): void {
    if (s) this.rng.setState(s.rng);
    this.seq = s?.seq ?? 0;
    this.planEvent = s?.planEvent ?? -1;
    this.planTick = s?.planTick ?? 0;
    this.pending = s?.pending ? { ...s.pending } : null;
    this.active = (s?.active ?? []).map((a) => ({ ...a }));
    this.fees = (s?.fees ?? []).slice();
    this.refresh();
  }

  hash(h: number): number {
    let acc = foldU32(h, this.rng.getState());
    acc = foldU32(acc, this.seq);
    acc = foldU32(acc, this.planEvent + 1);
    acc = foldU32(acc, this.planTick);
    if (this.pending) acc = foldU32(foldU32(foldU32(acc, this.pending.event), this.pending.deadline), this.pending.arg + 1);
    for (const a of this.active) acc = foldU32(foldU32(foldU32(acc, a.kind), a.until), a.arg + 1);
    for (const f of this.fees) acc = foldU32(acc, f);
    return acc;
  }
}
