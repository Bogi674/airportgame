import { AIRCRAFT } from '@data/aircraft';
import { BUSINESS, MARKET } from '@data/index';
import { TICKS_PER_MINUTE, dayIndex, minuteOfDay, type Airline, type AirlineScope, type Destination, type FlightSeries } from '@shared/business';
import { DAY_MIN, frequency, inWindow, operatesOn, seriesActive, seriesClash, weekdayOf } from '@shared/seriesPlan';
import { foldU32 } from '../hash';
import { FlState, type Traffic } from '../ops/traffic';
import { maxStageKm } from '../ops/performance';
import type { Rng } from '../rng';
import { generateDestinations, pickDestination } from './destinations';

/** What the market needs from the business around it. */
export interface MarketHost {
  emit(event: string): void;
  /** Airport stars, 0 and up (D15, D27). */
  stars(): number;
  /** Landings plus takeoffs the tower allows per hour, 0 without a tower. */
  movementBudget(): number;
  /** True when the airport holds the whole international passenger flow, so international flights may operate (T79). */
  internationalReady(): boolean;
}

/** fAirline is an Int8Array, so the airline list stops growing before it overflows. A technical limit, not a game rule. */
const MAX_AIRLINES = 120;
/** A flight placed for today still needs this lead to spawn its approach, as the old rotations did. */
const SAME_DAY_LEAD_MIN = 45;

const S = MARKET.series;
const WEEK_HOURS = 7 * 24;
const H = MARKET.satisfaction;

/**
 * Generated airlines, the destination network and the flight series they fly (docs/DESIGN_REVISION_4.md
 * section 3, tasks T61 and T62). Airlines sign with a set of series, the player places each series once
 * on a stand at an arrival minute, and every operating day the placed series turn into flights.
 * Airlines judge the airport through their satisfaction and grow their offer with its stars.
 */
export class Market {
  readonly destinations: Destination[];
  readonly series: FlightSeries[] = [];
  private nextSeries = 1;
  private readonly seriesRng: Rng;
  private readonly usable: number[] = [];

  constructor(
    root: Rng,
    private readonly airlineRng: Rng,
    private readonly airlines: Airline[],
    private readonly traffic: Traffic,
    private readonly host: MarketHost,
  ) {
    this.destinations = generateDestinations(root.fork('destinations'), root.fork('destinationsIntl'));
    this.seriesRng = root.fork('series');
  }

  /** True when the flight belongs to a series whose destination is international. Flights without a series are domestic. */
  isInternational(f: number): boolean {
    const rot = this.traffic.fRot[f];
    if (rot < 0) return false;
    for (let i = 0; i < this.series.length; i++) {
      const s = this.series[i];
      if (s.id === rot) return this.destinations[s.dest]?.international === true;
    }
    return false;
  }

  // Airlines -----------------------------------------------------------------

  /** The seven opening airlines: three regional, three national and one long haul, with their rating gates (user, 2026-11-17). */
  generateAirlines(): void {
    // One at a time, so each airline's id is its index and the name check sees the airlines made before it.
    const gates: [AirlineScope, number][] = [['regional', 0], ['regional', 0], ['regional', 10], ['national', 25], ['national', 35], ['national', 45], ['international', 70]];
    for (const [scope, min] of gates) this.airlines.push(this.makeAirline(scope, min));
  }

  private makeAirline(scope: AirlineScope, minRating: number): Airline {
    const rng = this.airlineRng;
    const names = BUSINESS.airlines;
    const list = scope === 'regional' ? names.regionalNames : names.nationalNames;
    const used = new Set(this.airlines.map((a) => a.name));
    let name = '';
    for (let tries = 0; tries < 20; tries++) {
      name = `${list[rng.int(0, list.length - 1)]} ${names.suffixes[rng.int(0, names.suffixes.length - 1)]}`;
      if (!used.has(name)) break;
    }
    const pool = poolOf(scope);
    const fleet: number[] = [];
    const fleetSize = rng.int(1, 2);
    for (let k = 0; k < fleetSize; k++) {
      const t = pool[rng.int(0, pool.length - 1)];
      if (!fleet.includes(t)) fleet.push(t);
    }
    // The hub is where the airline is based, picked by demand weight over the whole network.
    const hub = pickDestination(rng, this.destinations, 0, Infinity, Infinity, new Set());
    const id = this.airlines.length;
    return { id, name, scope, livery: id % 8, fleet, minRating, signed: false, hub, happiness: H.start, lowWeeks: 0, veryLowWeeks: 0, feeLevel: 1, flights: 0, pax: 0 };
  }

  /** Signs or ends the contract of an airline. Signing brings its series offer (D11, D15). */
  sign(id: number, on: boolean, rating: number, tick: number): string | null {
    const a = this.airlines[id];
    if (!a) return 'noSuchAirline';
    if (on === a.signed) return null;
    if (on && rating < a.minRating) return `ratingTooLow|need=${a.minRating}`;
    a.signed = on;
    if (on) {
      a.happiness = H.start;
      a.lowWeeks = 0;
      a.veryLowWeeks = 0;
      this.offer(a, this.targetCount(a), dayIndex(tick));
      this.host.emit(`airlineSigned|name=${a.name}`);
      if (this.traffic.autoStands) this.autoPlan(tick);
    } else {
      for (const s of this.series.filter((x) => x.airline === id)) this.remove(s);
    }
    return null;
  }

  /** How many series an airline offers at the airport's current stars. */
  private targetCount(a: Airline): number {
    return S.onSigning[a.scope] + S.perStar * this.host.stars();
  }

  /** Adds n new unplaced series to the airline's contract. */
  private offer(a: Airline, n: number, day: number): number {
    const large = this.host.stars() >= S.largeTypesStars;
    const types = a.fleet.filter((t) => large || !S.largeTypeCodes.includes(AIRCRAFT[t].derivedForReading.code));
    if (types.length === 0) return 0;
    const avoid = new Set(this.series.filter((x) => x.airline === a.id).map((x) => x.dest));
    if (a.hub >= 0) avoid.add(a.hub);
    const [lo, hi] = S.stageKm[a.scope];
    // No international offer goes out while the airport lacks the international flow (T79).
    const domesticOnly = !this.host.internationalReady();
    let added = 0;
    for (let k = 0; k < n; k++) {
      const t = types[this.seriesRng.int(0, types.length - 1)];
      // Each series goes to a new destination while any is left in range; then destinations repeat.
      let dest = pickDestination(this.seriesRng, this.destinations, lo, hi, maxStageKm(AIRCRAFT[t]), avoid, domesticOnly);
      if (dest < 0) dest = pickDestination(this.seriesRng, this.destinations, lo, hi, maxStageKm(AIRCRAFT[t]), new Set(), domesticOnly);
      if (dest < 0) continue;
      avoid.add(dest);
      const steps = Math.floor((S.windowStartLastMin - S.windowStartFirstMin) / S.slotStepMin);
      const winMin = S.windowStartFirstMin + this.seriesRng.int(0, steps) * S.slotStepMin;
      const days = this.pattern();
      this.series.push({ id: this.nextSeries++, airline: a.id, dest, typeIdx: t, days, winMin, startDay: day, endDay: day + S.contractWeeks * 7, standId: -1, minute: -1, turnMin: this.nominalTurn(t) });
      added++;
    }
    return added;
  }

  private nominalTurn(t: number): number {
    return Math.round(this.traffic.turnaroundTicks(t) / TICKS_PER_MINUTE);
  }

  /** Operating days of a new series: one of the D9 patterns, picked by weight. */
  private pattern(): number {
    let total = 0;
    for (const p of S.patterns) total += p.weight;
    let r = this.seriesRng.next() * total;
    let id = S.patterns[S.patterns.length - 1].id;
    for (const p of S.patterns) {
      r -= p.weight;
      if (r < 0) {
        id = p.id;
        break;
      }
    }
    switch (id) {
      case 'daily':
        return 0b1111111;
      case 'weekdays':
        return 0b0011111;
      case 'alternate':
        return 0b0010101 << this.seriesRng.int(0, 1);
      case 'twiceWeekly':
        return 0b0001001 << this.seriesRng.int(0, 3);
      default:
        return 0b1100000;
    }
  }

  // Placement ----------------------------------------------------------------

  /** Why the series cannot be placed on the stand at the minute, or null. Shared by the command and the auto planner. */
  private refusePlace(s: FlightSeries, standId: number, minute: number): string | null {
    if (this.airlines[s.airline]?.signed !== true) return 'seriesNotSigned';
    if (!Number.isInteger(minute) || minute < 0 || minute >= DAY_MIN) return 'seriesMinute';
    const r = this.traffic.refuseStandType(s.typeIdx, standId);
    if (r !== null) return r;
    const clash = seriesClash(s.days, s.turnMin, minute, standId, this.series, s.id);
    if (clash !== null) return `seriesBusy|dest=${this.destinations[clash.dest]?.name ?? ''}`;
    if (!this.traffic.takeoffOkFor(s.typeIdx, this.stageOf(s))) return `seriesStage|km=${this.stageOf(s)}`;
    const budget = this.host.movementBudget();
    if (budget > 0 && this.overBudget(s, minute, budget)) return `seriesTower|cap=${budget}`;
    return null;
  }

  /**
   * True when placing the series at the minute takes some hour of the week over the tower budget.
   * Landings and takeoffs of every placed series are counted per hour of the week, with wrap.
   */
  private overBudget(s: FlightSeries, minute: number, budget: number): boolean {
    const hours = new Int32Array(WEEK_HOURS);
    const add = (days: number, m: number, turn: number): void => {
      for (let d = 0; d < 7; d++) {
        if (!operatesOn(days, d)) continue;
        for (const at of [d * DAY_MIN + m, d * DAY_MIN + m + turn]) hours[Math.floor(at / 60) % WEEK_HOURS]++;
      }
    };
    for (const o of this.series) if (o.minute >= 0 && o.id !== s.id) add(o.days, o.minute, o.turnMin);
    add(s.days, minute, s.turnMin);
    for (let d = 0; d < 7; d++) {
      if (!operatesOn(s.days, d)) continue;
      for (const at of [d * DAY_MIN + minute, d * DAY_MIN + minute + s.turnMin]) if (hours[Math.floor(at / 60) % WEEK_HOURS] > budget) return true;
    }
    return false;
  }

  place(id: number, standId: number, minute: number, tick: number): string | null {
    const s = this.series.find((x) => x.id === id);
    if (!s) return 'noSuchSeries';
    const m = Math.round(minute / S.slotStepMin) * S.slotStepMin;
    const refusal = this.refusePlace(s, standId, m % DAY_MIN);
    if (refusal !== null) return refusal;
    s.standId = standId;
    s.minute = m % DAY_MIN;
    this.dropToday(s);
    this.scheduleToday(s, tick);
    return null;
  }

  unplace(id: number): string | null {
    const s = this.series.find((x) => x.id === id);
    if (!s) return 'noSuchSeries';
    s.standId = -1;
    s.minute = -1;
    this.dropToday(s);
    return null;
  }

  cancel(id: number): string | null {
    const s = this.series.find((x) => x.id === id);
    if (!s) return 'noSuchSeries';
    this.remove(s);
    return null;
  }

  /** Extends a series by a contract length once its renewal period has begun (D10). */
  renew(id: number, tick: number): string | null {
    const s = this.series.find((x) => x.id === id);
    if (!s) return 'noSuchSeries';
    if (s.endDay - dayIndex(tick) > S.renewalWeeks * 7) return `seriesNotDue|weeks=${S.renewalWeeks}`;
    s.endDay += S.contractWeeks * 7;
    return null;
  }

  private remove(s: FlightSeries): void {
    this.dropToday(s);
    const i = this.series.indexOf(s);
    if (i >= 0) this.series.splice(i, 1);
  }

  /** Cancels today's flight of the series while it is still only scheduled, so a move or cancel takes effect at once. */
  private dropToday(s: FlightSeries): void {
    const t = this.traffic;
    for (let f = 0; f < t.fState.length; f++) {
      if (t.fState[f] === FlState.Scheduled && t.fAirline[f] === s.airline && t.fRot[f] === s.id) t.fState[f] = FlState.Done;
    }
  }

  /** The auto planner: every unplaced series takes the first valid stand and minute inside its preferred arrival span. */
  autoPlan(tick: number): void {
    for (const s of this.series) {
      if (s.minute >= 0 || this.airlines[s.airline]?.signed !== true) continue;
      const stands = this.traffic.standOrder(s.typeIdx);
      search: for (let k = 0; k < S.windowMin; k += S.slotStepMin) {
        const m = (s.winMin + k) % DAY_MIN;
        for (const sid of stands) {
          if (this.refusePlace(s, sid, m) !== null) continue;
          s.standId = sid;
          s.minute = m;
          this.scheduleToday(s, tick);
          break search;
        }
      }
    }
  }

  private stageOf(s: FlightSeries): number {
    const km = this.destinations[s.dest]?.km ?? 0;
    return Math.max(100, Math.min(km, maxStageKm(AIRCRAFT[s.typeIdx])));
  }

  // Daily cycle --------------------------------------------------------------

  /** Schedules the placed series of the day that starts at `tick`, charges unplaced frequency and runs the weekly and monthly checks. */
  dailyClose(tick: number, atcOk: boolean): void {
    const day = dayIndex(tick);
    const wd = weekdayOf(day);
    if (day > 0 && wd === 0) this.weekly(day);
    if (day > 0 && day % MARKET.approach.everyDays === 0) this.approach();
    // Contracts end at the start of their end day; renewals are announced as their window opens.
    for (const s of this.series.slice()) {
      if (day >= s.endDay) {
        this.host.emit(`seriesExpired|name=${this.airlines[s.airline]?.name ?? ''}|dest=${this.destinations[s.dest]?.name ?? ''}`);
        this.remove(s);
      } else if (s.endDay - day === S.renewalWeeks * 7) this.host.emit(`seriesRenewal|name=${this.airlines[s.airline]?.name ?? ''}|dest=${this.destinations[s.dest]?.name ?? ''}`);
    }
    if (this.traffic.autoStands) this.autoPlan(tick);
    const midnight = tick - minuteOfDay(tick) * TICKS_PER_MINUTE;
    this.traffic.usableTypesPublic(this.usable);
    const idle = new Set<number>();
    const intlIdle = new Set<number>();
    const intlOk = this.host.internationalReady();
    for (const s of this.series) {
      const a = this.airlines[s.airline];
      if (!a?.signed || !seriesActive(s, day) || !operatesOn(s.days, wd)) continue;
      if (s.minute < 0) {
        this.happy(a, H.unplacedFlight);
        continue;
      }
      if (!this.usable.includes(s.typeIdx)) {
        if (!idle.has(a.id)) this.host.emit(`airlineIdle|name=${a.name}`);
        idle.add(a.id);
        continue;
      }
      if (!atcOk) {
        if (!idle.has(a.id)) this.host.emit(`noAtc|name=${a.name}`);
        idle.add(a.id);
        continue;
      }
      if (!intlOk && this.destinations[s.dest]?.international === true) {
        this.happy(a, H.cancelledFlight);
        if (!intlIdle.has(a.id)) this.host.emit(`intlFlowMissing|name=${a.name}`);
        intlIdle.add(a.id);
        continue;
      }
      if (!inWindow(s.winMin, S.windowMin, s.minute)) this.happy(a, H.outsideWindowFlight);
      this.spawn(s, midnight + s.minute * TICKS_PER_MINUTE);
    }
  }

  /** A series placed during the day still flies today when its time has not passed. */
  private scheduleToday(s: FlightSeries, tick: number): void {
    const day = dayIndex(tick);
    if (!seriesActive(s, day) || !operatesOn(s.days, weekdayOf(day))) return;
    const now = minuteOfDay(tick);
    if (s.minute < now + SAME_DAY_LEAD_MIN) return;
    this.traffic.usableTypesPublic(this.usable);
    if (!this.usable.includes(s.typeIdx)) return;
    if (this.destinations[s.dest]?.international === true && !this.host.internationalReady()) return;
    this.spawn(s, tick + (s.minute - now) * TICKS_PER_MINUTE);
  }

  private spawn(s: FlightSeries, eta: number): void {
    const a = this.airlines[s.airline];
    const f = this.traffic.scheduleArrival(s.typeIdx, eta, a.livery, this.traffic.turnaroundTicks(s.typeIdx), a.id, this.stageOf(s), s.id);
    if (f >= 0 && this.traffic.refuseAssign(f, s.standId) === null) this.traffic.fStand[f] = s.standId;
  }

  /** A series flight pushed back: on time within D13 of its scheduled off block, else delayed (D14), less the airline's own hold. */
  flightDone(f: number): void {
    const t = this.traffic;
    const al = t.fAirline[f];
    if (al < 0 || t.fRot[f] < 0) return;
    const a = this.airlines[al];
    if (!a?.signed) return;
    // Time the airline itself owns, such as passengers late to the gate, is not held against the airport (T63).
    const late = (t.nowTick - (t.fEta[f] + t.fTurn[f]) - t.fAirlineHold[f]) / TICKS_PER_MINUTE;
    this.happy(a, late <= H.onTimeMin ? H.onTimeFlight : H.delayedFlight);
  }

  /** Adds satisfaction points to an airline by id, within the D14 limits (T50). */
  addHappiness(id: number, delta: number): void {
    const a = this.airlines.find((x) => x.id === id);
    if (a) this.happy(a, delta);
  }

  private happy(a: Airline, delta: number): void {
    a.happiness = Math.max(H.min, Math.min(H.max, a.happiness + delta));
  }

  /** Weekly drift, the D14 thresholds and growth with stars (D15). */
  private weekly(day: number): void {
    for (const a of this.airlines) {
      if (!a.signed) continue;
      const gap = H.start - a.happiness;
      a.happiness += Math.sign(gap) * Math.min(Math.abs(gap), H.weeklyDrift);
      a.lowWeeks = a.happiness < H.cancelBelow ? a.lowWeeks + 1 : 0;
      a.veryLowWeeks = a.happiness < H.endBelow ? a.veryLowWeeks + 1 : 0;
      if (a.veryLowWeeks >= H.endWeeks) {
        this.host.emit(`airlineLeft|name=${a.name}`);
        a.signed = false;
        for (const s of this.series.filter((x) => x.airline === a.id)) this.remove(s);
        continue;
      }
      if (a.lowWeeks >= H.cancelWeeks) {
        const worst = this.worstSeries(a.id);
        if (worst) {
          this.host.emit(`seriesCancelled|name=${a.name}|dest=${this.destinations[worst.dest]?.name ?? ''}`);
          this.remove(worst);
        }
        a.lowWeeks = 0;
        continue;
      }
      const have = this.series.filter((x) => x.airline === a.id).length;
      if (have < this.targetCount(a) && this.offer(a, 1, day) > 0) this.host.emit(`seriesOffered|name=${a.name}`);
    }
  }

  /** The series an unhappy airline drops first: unplaced before placed, then the most frequent, then the newest. */
  private worstSeries(airline: number): FlightSeries | null {
    let best: FlightSeries | null = null;
    for (const s of this.series) {
      if (s.airline !== airline) continue;
      if (!best) {
        best = s;
        continue;
      }
      const key = (x: FlightSeries): number => (x.minute < 0 ? 1e6 : 0) + frequency(x.days) * 1e4 + x.id;
      if (key(s) > key(best)) best = s;
    }
    return best;
  }

  /** A new airline approaches with a chance that grows with the stars (D15). */
  private approach(): void {
    const stars = this.host.stars();
    if (this.airlines.length >= MAX_AIRLINES) return;
    if (this.seriesRng.next() >= MARKET.approach.chancePerStar * stars) return;
    const scope: AirlineScope = stars >= S.largeTypesStars && this.seriesRng.next() < 0.5 ? 'international' : this.seriesRng.next() < 0.5 ? 'regional' : 'national';
    const a = this.makeAirline(scope, 0);
    this.airlines.push(a);
    this.host.emit(`airlineApproach|name=${a.name}`);
  }

  // Save ---------------------------------------------------------------------

  saveState(): unknown {
    return { series: this.series, nextSeries: this.nextSeries, rng: this.seriesRng.getState() };
  }

  loadState(raw: unknown): void {
    const o = raw as { series: FlightSeries[]; nextSeries: number; rng?: number };
    this.series.length = 0;
    for (const s of o.series) this.series.push({ ...s, dest: s.dest >= 0 ? s.dest : this.nearestStage(-s.dest), turnMin: s.turnMin > 0 ? s.turnMin : this.nominalTurn(s.typeIdx) });
    this.nextSeries = o.nextSeries;
    if (o.rng !== undefined) this.seriesRng.setState(o.rng);
  }

  /** The destination closest to a stage length, for rotations migrated from saves before version 18 (section 3.5). */
  private nearestStage(km: number): number {
    let best = 0;
    for (const d of this.destinations) if (Math.abs(d.km - km) < Math.abs(this.destinations[best].km - km)) best = d.id;
    return best;
  }

  hash(h: number): number {
    let acc = foldU32(h, this.nextSeries);
    for (const s of this.series) {
      acc = foldU32(foldU32(foldU32(acc, s.id), s.dest), s.days);
      acc = foldU32(foldU32(foldU32(acc, s.standId + 1), s.minute + 1), s.endDay);
    }
    for (const a of this.airlines) acc = foldU32(foldU32(acc, a.signed ? 1 : 0), Math.round(a.happiness * 10));
    return acc;
  }
}

/** Aircraft the airlines of a scope fly. Regional airlines fly small types, international ones widebodies. */
function poolOf(scope: AirlineScope): number[] {
  const roles = scope === 'regional' ? ['commuter', 'regionalTurboprop', 'regionalJet'] : scope === 'national' ? ['narrowbody', 'regionalJet'] : ['widebody'];
  return AIRCRAFT.map((a, i) => (roles.includes(a.role) && a.capacity.seatsTypical >= 9 ? i : -1)).filter((i) => i >= 0);
}
