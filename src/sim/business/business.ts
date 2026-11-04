import { AIRCRAFT } from '@data/aircraft';
import { AcState, FlState } from '../ops/traffic';
import { BUSINESS, AIRFIELD } from '@data/index';
import {
  LEDGER_CATEGORIES,
  LEDGER_DAYS,
  TICKS_PER_DAY,
  TICKS_PER_MINUTE,
  dayIndex,
  minuteOfDay,
  type Airline,
  type BoardRow,
  type BusinessPayload,
  type FeeLevel,
  type LedgerCategory,
  FIXTURE_KEYS,
  TERMINAL_GRID,
  type FixtureKey,
  type Terminal,
  type TerminalGrid,
  type WeatherKind,
} from '@shared/business';
import { cellCount, cornerWorld, newGrid, planEdit, summarize, type TerminalEdit } from '@shared/terminalOps';
import { isShopFixture, fixtureKey } from '@shared/business';
import type { BuildContext } from '@shared/validate';
import { foldU32 } from '../hash';
import { packTyped, unpackInto } from '../save/pack';
import type { Rng } from '../rng';
import type { SiteSpec } from '../world/site';
import type { Airfield } from '../airfield/airfield';
import type { Traffic } from '../ops/traffic';

const CAT_INDEX: Record<LedgerCategory, number> = Object.fromEntries(LEDGER_CATEGORIES.map((c, i) => [c, i])) as Record<LedgerCategory, number>;
const FEE_MULT = [0.8, 1, 1.25] as const;
const FEE_LF = [0.08, 0, -0.08] as const;
const TERMINAL_SEAT_THRESHOLD = 15;

export interface BusinessHost {
  getCash(): number;
  book(category: LedgerCategory, amount: number): void;
  emit(code: string): void;
}

/** Terminals, airlines, flights revenue, daily close, rating, loan and weather. Everything is aggregated. */
export class Business {
  version = 0;
  /** Full grids of every terminal building. */
  readonly grids: TerminalGrid[] = [];
  /** Counts per building, rebuilt after every edit. */
  terminals: Terminal[] = [];
  terminalVersion = 0;
  private totals: Record<FixtureKey, number> = Object.fromEntries(FIXTURE_KEYS.map((k) => [k, 0])) as Record<FixtureKey, number>;
  /** Sample of foundation cell centres, for the contact stand reach test. */
  private reach: number[] = [];
  readonly airlines: Airline[] = [];
  rating = 25;
  satisfaction = 0.8;
  onTime = 0.9;
  loan = 0;
  loanOriginal = 0;
  weather: WeatherKind = 'clear';
  private weatherStart = 0;
  private weatherEnd = 0;
  private nextTerminalId = 1;
  private day = 0;
  private readonly today = new Float64Array(LEDGER_CATEGORIES.length);
  private readonly history: Float64Array[] = [];
  paxToday = 0;
  flightsToday = 0;
  lostToday = 0;
  /** Departing passengers of the last hour, as a decaying sum, to find terminal load. */
  private depWindow = 0;
  private readonly rng: Rng;
  private readonly marketRng: Rng;
  private flightPax = new Int32Array(1024);
  private flightDockedAt = new Int32Array(1024);
  private readonly usableScratch: number[] = [];

  constructor(
    private readonly site: SiteSpec,
    rng: Rng,
    private readonly host: BusinessHost,
    private readonly traffic: Traffic,
    private readonly airfield: Airfield,
  ) {
    this.rng = rng.fork('business');
    this.marketRng = rng.fork('market');
    this.generateAirlines();
    traffic.hooks = {
      docked: (f) => this.onDocked(f),
      pushback: (f) => this.onPushback(f),
      departed: (f) => this.onDeparted(f),
    };
  }

  // Airlines -----------------------------------------------------------------

  private generateAirlines(): void {
    const names = BUSINESS.airlines;
    const roles = (r: string[]): number[] => AIRCRAFT.map((a, i) => (r.includes(a.role) && a.capacity.seatsTypical >= 9 ? i : -1)).filter((i) => i >= 0);
    const regionalPool = roles(['commuter', 'regionalTurboprop', 'regionalJet']);
    const nationalPool = roles(['narrowbody', 'regionalJet']);
    const widePool = roles(['widebody']);
    const used = new Set<string>();
    const mk = (scope: 'regional' | 'national', pool: number[], minRating: number, id: number): Airline => {
      const list = scope === 'regional' ? names.regionalNames : names.nationalNames;
      let name = '';
      for (let tries = 0; tries < 20; tries++) {
        name = `${list[this.marketRng.int(0, list.length - 1)]} ${names.suffixes[this.marketRng.int(0, names.suffixes.length - 1)]}`;
        if (!used.has(name)) break;
      }
      used.add(name);
      const fleetSize = scope === 'regional' ? this.marketRng.int(1, 2) : this.marketRng.int(1, 2);
      const fleet: number[] = [];
      for (let k = 0; k < fleetSize; k++) {
        const t = pool[this.marketRng.int(0, pool.length - 1)];
        if (!fleet.includes(t)) fleet.push(t);
      }
      return { id, name, scope, livery: id % 8, fleet, minRating, rotations: 0, feeLevel: 1, flights: 0, pax: 0 };
    };
    this.airlines.push(mk('regional', regionalPool, 0, 0), mk('regional', regionalPool, 0, 1), mk('regional', regionalPool, 10, 2));
    this.airlines.push(mk('national', nationalPool, 25, 3), mk('national', nationalPool, 35, 4), mk('national', nationalPool, 45, 5));
    // One long haul operator with widebodies that only comes at a high rating.
    const heavy = mk('national', widePool, 70, 6);
    this.airlines.push(heavy);
  }

  signAirline(id: number, rotations: number): string | null {
    const a = this.airlines.find((x) => x.id === id);
    if (!a) return 'noSuchAirline';
    const r = Math.max(0, Math.min(this.maxRotations(), Math.floor(rotations)));
    if (r > 0 && this.rating < a.minRating) return `ratingTooLow|need=${a.minRating}`;
    const before = a.rotations;
    a.rotations = r;
    this.version++;
    if (before === 0 && r > 0) {
      this.host.emit(`airlineSigned|name=${a.name}`);
      this.scheduleToday(a);
    }
    return null;
  }

  setFee(id: number, level: FeeLevel): void {
    const a = this.airlines.find((x) => x.id === id);
    if (!a) return;
    a.feeLevel = level;
    this.version++;
  }

  maxRotations(): number {
    return 1 + Math.floor(this.rating / 20);
  }

  private loadFactor(a: Airline): number {
    const city = this.site.city;
    const demand = 0.5 + 0.2 * Math.min(1, city.population / 1500000) + 0.1 * (city.tourismShare + city.businessShare);
    return Math.max(0.3, Math.min(0.95, demand + this.rating / 300 + FEE_LF[a.feeLevel]));
  }

  // Terminals ----------------------------------------------------------------

  /** Rebuilds counts, totals and the reach sample after any change to the grids. */
  private refreshTerminals(): void {
    this.terminals = this.grids.map(summarize);
    this.totals = Object.fromEntries(FIXTURE_KEYS.map((k) => [k, 0])) as Record<FixtureKey, number>;
    for (const t of this.terminals) for (const k of FIXTURE_KEYS) this.totals[k] += t.counts[k];
    this.reach = [];
    for (const g of this.grids) {
      for (let cy = 0; cy < TERMINAL_GRID; cy += 3) {
        for (let cx = 0; cx < TERMINAL_GRID; cx += 3) {
          if (g.floor[cy * TERMINAL_GRID + cx] === 0) continue;
          const w = cornerWorld(g, cx + 0.5, cy + 0.5);
          this.reach.push(w.x, w.y);
        }
      }
    }
    this.terminalVersion++;
    this.version++;
  }

  /**
   * Applies one edit to a terminal building. With `building` below 0 and a foundation edit a new
   * building is started at the given origin. Returns a problem code or null.
   */
  terminalBuild(building: number, ox: number, oy: number, headingDeg: number, edit: TerminalEdit, ctx: BuildContext): string | null {
    let grid = building >= 0 ? this.grids.find((g) => g.id === building) : undefined;
    const fresh = grid === undefined;
    if (building >= 0 && !grid) return 'nothingThere';
    if (!grid) {
      if (edit.op !== 'foundation') return 'terminalNeedsFoundation';
      grid = newGrid(this.nextTerminalId, ox, oy, ((Math.round(headingDeg) % 360) + 360) % 360);
    }
    const plan = planEdit(grid, edit, { ctx, af: this.airfield.data, others: this.grids });
    if (plan.problem && plan.changes === 0) return plan.problem.code + argsOf(plan.problem.args);
    if (plan.problem) return plan.problem.code + argsOf(plan.problem.args);
    if (plan.cost > this.host.getCash()) return `insufficientFunds|cost=${plan.cost}`;
    if (plan.cost > 0) this.host.book('construction', -plan.cost);
    plan.apply();
    if (fresh) {
      this.nextTerminalId++;
      this.grids.push(grid);
    }
    if (cellCount(grid) === 0) this.grids.splice(this.grids.indexOf(grid), 1);
    this.refreshTerminals();
    return null;
  }

  demolishTerminal(id: number): string | null {
    const i = this.grids.findIndex((x) => x.id === id);
    if (i < 0) return 'nothingThere';
    this.host.book('construction', Math.round(this.grids[i].cost * 0.25));
    this.grids.splice(i, 1);
    this.refreshTerminals();
    return null;
  }

  /** Departing passengers the terminals can process per hour. */
  depCapacity(): number {
    return Math.min(this.totals.checkIn * BUSINESS.modules.checkIn.capacityPerHour, this.totals.security * BUSINESS.modules.security.capacityPerHour);
  }

  arrCapacity(): number {
    return this.totals.belt * BUSINESS.modules.belt.capacityPerHour;
  }

  /** Contact stands need a terminal building close by. */
  hasTerminalNear(x: number, y: number): boolean {
    const reach = BUSINESS.terminal.contactReachM;
    for (let i = 0; i < this.reach.length; i += 2) if (Math.hypot(this.reach[i] - x, this.reach[i + 1] - y) < reach) return true;
    return false;
  }

  staffCount(): number {
    let s = 0;
    for (const k of ['checkIn', 'security', 'belt', 'toilet'] as const) s += this.totals[k] * BUSINESS.modules[k].staff;
    s += this.airfield.data.stands.length * 1.5;
    if (this.airfield.data.runways.length > 0) s += 4 + this.airfield.data.runways.length * 2;
    return Math.round(s);
  }

  // Hooks from traffic -------------------------------------------------------

  private paxFor(f: number): number {
    const a = this.traffic.fAirline[f] >= 0 ? this.airlines[this.traffic.fAirline[f]] : null;
    const seats = AIRCRAFT[this.traffic.fType[f]].capacity.seatsTypical;
    const lf = a ? this.loadFactor(a) : 0.7;
    return Math.max(0, Math.round(seats * lf));
  }

  private mult(f: number): number {
    const al = this.traffic.fAirline[f];
    return al >= 0 ? FEE_MULT[this.airlines[al].feeLevel] : 1;
  }

  private needsTerminal(f: number): boolean {
    return AIRCRAFT[this.traffic.fType[f]].capacity.seatsTypical >= TERMINAL_SEAT_THRESHOLD;
  }

  private onDocked(f: number): void {
    const t = this.traffic.fType[f];
    const spec = AIRCRAFT[t];
    const m = this.mult(f);
    this.host.book('landing', Math.round((spec.weights.mtowKg / 1000) * BUSINESS.fees.landingPerTonne * m));
    let pax = this.paxFor(f);
    if (this.needsTerminal(f)) {
      const cap = this.arrCapacity();
      if (cap <= 0) {
        this.lostToday += pax;
        pax = 0;
      } else {
        const sf = Math.min(1, cap / Math.max(1, pax * 3));
        const served = Math.round(pax * sf);
        this.lostToday += pax - served;
        pax = served;
      }
    }
    this.host.book('passengers', Math.round(pax * BUSINESS.fees.passengerArriving * m));
    this.paxToday += pax;
    this.flightPax[f] = pax;
    this.flightDockedAt[f] = this.traffic.nowTick;
    const al = this.traffic.fAirline[f];
    if (al >= 0) this.airlines[al].pax += pax;
    // Lateness feeds the on time score.
    const late = this.traffic.fDelay[f] + this.traffic.fLate[f];
    this.onTime += ((late < 15 * TICKS_PER_MINUTE ? 1 : 0) - this.onTime) * 0.08;
  }

  private onPushback(f: number): void {
    const m = this.mult(f);
    let pax = this.paxFor(f);
    if (this.needsTerminal(f)) {
      const cap = this.depCapacity();
      let sf = 0;
      if (cap > 0) {
        this.depWindow += pax;
        sf = Math.min(1, cap / Math.max(1, this.depWindow));
      }
      const served = Math.round(pax * sf);
      this.lostToday += pax - served;
      this.satisfaction += (sf - this.satisfaction) * 0.1;
      pax = served;
    }
    this.host.book('passengers', Math.round(pax * BUSINESS.fees.passengerDeparting * m));
    this.paxToday += pax;
    this.flightsToday++;
    const hours = Math.max(0.25, (this.traffic.nowTick - this.flightDockedAt[f]) / (TICKS_PER_MINUTE * 60));
    this.host.book('parking', Math.round(hours * BUSINESS.fees.parkingPerStandHour * m));
    const al = this.traffic.fAirline[f];
    if (al >= 0) {
      this.airlines[al].pax += pax;
      this.airlines[al].flights++;
    }
  }

  private onDeparted(f: number): void {
    void f;
  }

  // Daily cycle --------------------------------------------------------------

  /** Called every tick, cheap. Does its work only on day and hour boundaries. */
  update(tick: number): void {
    // The terminal load window decays every 10 game minutes.
    if (tick % (10 * TICKS_PER_MINUTE) === 0) this.depWindow *= 1 - 10 / 60;
    if (tick % TICKS_PER_DAY === dayStartOffset()) this.dailyClose(tick);
    if (this.weather !== 'clear' && tick >= this.weatherEnd) this.setWeather('clear', tick);
    else if (this.weather === 'clear' && this.weatherStart > 0 && tick >= this.weatherStart && this.pendingKind !== 'clear') this.setWeather(this.pendingKind, tick);
  }

  private pendingKind: WeatherKind = 'clear';

  private setWeather(kind: WeatherKind, tick: number): void {
    this.weather = kind;
    this.traffic.setWeather(kind);
    if (kind === 'clear') {
      this.weatherStart = 0;
      this.host.emit('weatherEnd');
    } else {
      this.host.emit(`weatherStart|kind=${kind}`);
      this.weatherEnd = tick + this.rng.int(3, 8) * 60 * TICKS_PER_MINUTE;
    }
    this.version++;
  }

  private scheduleToday(a: Airline): void {
    const now = this.traffic.nowTick;
    const nowMin = minuteOfDay(now);
    this.usableTypesFor(a);
    if (this.usableScratch.length === 0) return;
    for (let r = 0; r < a.rotations; r++) {
      const earliest = Math.max(nowMin + 45, 6 * 60);
      if (earliest > 21 * 60) break;
      const minute = this.rng.int(earliest, 21 * 60);
      const t = this.usableScratch[this.rng.int(0, this.usableScratch.length - 1)];
      this.traffic.scheduleArrival(t, now + (minute - nowMin) * TICKS_PER_MINUTE, a.livery, this.traffic.turnaroundTicks(t), a.id);
    }
  }

  private usableTypesFor(a: Airline): void {
    this.usableScratch.length = 0;
    const all: number[] = [];
    this.traffic.usableTypesPublic(all);
    for (const t of a.fleet) if (all.includes(t)) this.usableScratch.push(t);
  }

  private dailyClose(tick: number): void {
    const d = dayIndex(tick);
    if (d === this.day && tick > 0) return;
    // Close the finished day.
    if (tick > 0) {
      this.chargeDaily();
      this.history.push(Float64Array.from(this.today));
      if (this.history.length > LEDGER_DAYS) this.history.shift();
      this.today.fill(0);
      this.updateRating();
    }
    this.day = d;
    this.paxToday = 0;
    this.flightsToday = 0;
    this.lostToday = 0;
    // Weather for the day.
    const c = this.site.climate;
    const r = this.rng.next();
    let kind: WeatherKind = 'clear';
    if (r < c.fogDays / 365) kind = 'fog';
    else if (r < (c.fogDays + c.rainDays) / 365) kind = 'rain';
    else if (r < (c.fogDays + c.rainDays) / 365 + 0.03) kind = 'wind';
    this.pendingKind = kind;
    this.weatherStart = kind === 'clear' ? 0 : tick + this.rng.int(0, 12) * 60 * TICKS_PER_MINUTE + 1;
    // Schedule the new day's flights for signed airlines.
    for (const a of this.airlines) {
      if (a.rotations <= 0) continue;
      this.usableTypesFor(a);
      if (this.usableScratch.length === 0) {
        this.host.emit(`airlineIdle|name=${a.name}`);
        continue;
      }
      for (let k = 0; k < a.rotations; k++) {
        const minute = this.rng.int(6 * 60, 21 * 60);
        const t = this.usableScratch[this.rng.int(0, this.usableScratch.length - 1)];
        // Arrival times are relative to the midnight that starts this day, in ticks.
        const midnight = tick - minuteOfDay(tick) * TICKS_PER_MINUTE;
        this.traffic.scheduleArrival(t, midnight + minute * TICKS_PER_MINUTE, a.livery, this.traffic.turnaroundTicks(t), a.id);
      }
    }
    this.version++;
  }

  private chargeDaily(): void {
    const fees = BUSINESS.fees;
    const wages = Math.round(this.staffCount() * fees.wageStaffPerDay);
    this.host.book('wages', -wages);
    // Upkeep: surface percentage of build cost per year, spread over days.
    let upkeep = 0;
    const af = this.airfield.data;
    for (const r of af.runways) upkeep += (r.cost * AIRFIELD.surfaces[r.surface].upkeepPct) / 100 / 365;
    for (const t of af.taxiways) upkeep += (t.cost * AIRFIELD.surfaces[t.surface].upkeepPct) / 100 / 365;
    for (const a of af.aprons) upkeep += (a.cost * AIRFIELD.surfaces[a.surface].upkeepPct) / 100 / 365;
    for (const g of this.grids) upkeep += (g.cost * 0.5) / 100 / 365;
    this.host.book('upkeep', -Math.round(upkeep));
    // Shop tenants and rent, one lease per shop fixture.
    let rent = 0;
    for (const g of this.grids) {
      for (let i = 0; i < g.fixture.length; i++) {
        const f = g.fixture[i];
        if (!isShopFixture(f)) continue;
        const spec = BUSINESS.shops[fixtureKey(f) as keyof typeof BUSINESS.shops];
        if (g.leased[i] === 0 && this.rating >= spec.minRating && this.rng.next() < 0.35) g.leased[i] = 1;
        if (g.leased[i] === 1 && this.rating < spec.minRating - 15) g.leased[i] = 0;
        if (g.leased[i] === 1) rent += spec.rentPerDay * Math.min(1.5, 0.5 + this.paxToday / 1500);
      }
    }
    this.host.book('rent', Math.round(rent));
    if (this.loan > 0) {
      const interest = Math.round((this.loan * fees.interestAnnualPct) / 100 / 365);
      this.host.book('interest', -interest);
      const repay = Math.min(this.loan, Math.ceil(this.loanOriginal / fees.loanTermDays));
      this.loan -= repay;
      this.host.book('loan', -repay);
      if (this.loan <= 0) this.loanOriginal = 0;
    }
  }

  private updateRating(): void {
    const leased = this.terminals.reduce((n, t) => n + t.leased, 0);
    const facilities =
      this.terminals.length === 0 ? 0 : Math.min(1, this.totals.seating / 12) * 0.4 + Math.min(1, this.totals.toilet / 4) * 0.3 + Math.min(1, leased / 4) * 0.3;
    const infra = Math.min(1, this.airfield.data.runways.length * 0.5 + (this.airfield.data.stands.length > 3 ? 0.3 : 0.1));
    const target = 100 * (0.35 * this.onTime + 0.35 * this.satisfaction + 0.2 * facilities + 0.1 * infra);
    this.rating += (target - this.rating) * 0.15;
    this.rating = Math.max(0, Math.min(100, this.rating));
  }

  // Loan ---------------------------------------------------------------------

  takeLoan(amount: number): string | null {
    const a = Math.floor(amount);
    if (a <= 0) return null;
    if (this.loan + a > BUSINESS.fees.loanMax) return `loanLimit|max=${BUSINESS.fees.loanMax - this.loan}`;
    this.loan += a;
    this.loanOriginal += a;
    this.host.book('loan', a);
    this.version++;
    return null;
  }

  repayLoan(amount: number): string | null {
    const a = Math.min(Math.floor(amount), this.loan);
    if (a <= 0) return null;
    if (a > this.host.getCash()) return `insufficientFunds|cost=${a}`;
    this.loan -= a;
    this.host.book('loan', -a);
    if (this.loan <= 0) this.loanOriginal = 0;
    this.version++;
    return null;
  }

  // Ledger -------------------------------------------------------------------

  /** Records a signed amount for today. */
  record(category: LedgerCategory, amount: number): void {
    this.today[CAT_INDEX[category]] += amount;
  }

  private board(tick: number): BoardRow[] {
    const t = this.traffic;
    const rows: BoardRow[] = [];
    const names = ['', 'approach', 'landing', 'taxiIn', 'turnaround', 'pushback', 'taxiOut', 'holding', 'lineUp', 'takeoff'];
    const stands = this.airfield.data.stands;
    for (let i = 0; i < 256 && rows.length < 40; i++) {
      if (t.active[i] === 0 || t.state[i] === AcState.Free) continue;
      const f = t.flight[i];
      const al = f >= 0 ? t.fAirline[f] : -1;
      const stand = stands.find((s) => s.id === t.standId[i]);
      rows.push({
        airline: al >= 0 ? this.airlines[al].name : 'Test',
        type: AIRCRAFT[t.type[i]].icaoType,
        status: names[t.state[i]],
        stand: stand ? stand.number : '',
        eta: f >= 0 ? minuteOfDay(t.fEta[f]) : 0,
        delayMin: f >= 0 ? Math.round(t.fDelay[f] / TICKS_PER_MINUTE) : 0,
      });
    }
    for (let f = 0; f < 1024 && rows.length < 60; f++) {
      if (t.fState[f] !== FlState.Scheduled) continue;
      const al = t.fAirline[f];
      rows.push({
        airline: al >= 0 ? this.airlines[al].name : 'Test',
        type: AIRCRAFT[t.fType[f]].icaoType,
        status: 'scheduled',
        stand: '',
        eta: minuteOfDay(t.fEta[f]),
        delayMin: Math.round(t.fDelay[f] / TICKS_PER_MINUTE),
      });
    }
    void tick;
    return rows;
  }

  payload(tick: number): BusinessPayload {
    const dep = this.depCapacity();
    return {
      board: this.board(tick),
      version: this.version,
      day: dayIndex(tick),
      minuteOfDay: minuteOfDay(tick),
      terminals: this.terminals,
      terminalVersion: this.terminalVersion,
      airlines: this.airlines,
      rating: Math.round(this.rating * 10) / 10,
      satisfaction: Math.round(this.satisfaction * 100) / 100,
      onTimePct: Math.round(this.onTime * 100),
      loan: this.loan,
      staff: this.staffCount(),
      weather: this.weather,
      depCapacity: dep,
      arrCapacity: this.arrCapacity(),
      history: this.history.map((h) => Array.from(h)),
      today: Array.from(this.today),
      paxToday: this.paxToday,
      flightsToday: this.flightsToday,
      lostPaxToday: this.lostToday,
    };
  }

  saveState(): unknown {
    return {
      version: this.version, grids: this.grids.map(saveGrid), airlines: this.airlines, rating: this.rating, satisfaction: this.satisfaction,
      onTime: this.onTime, loan: this.loan, loanOriginal: this.loanOriginal, weather: this.weather, weatherStart: this.weatherStart,
      weatherEnd: this.weatherEnd, pendingKind: this.pendingKind, nextTerminalId: this.nextTerminalId, day: this.day,
      today: Array.from(this.today), history: this.history.map((h) => Array.from(h)), paxToday: this.paxToday,
      flightsToday: this.flightsToday, lostToday: this.lostToday, depWindow: this.depWindow,
      flightPax: packTyped(this.flightPax), flightDockedAt: packTyped(this.flightDockedAt),
      rng: this.rng.getState(), marketRng: this.marketRng.getState(),
    };
  }

  loadState(raw: unknown): void {
    const o = raw as {
      version: number; grids: SavedGrid[]; airlines: Airline[]; rating: number; satisfaction: number; onTime: number; loan: number;
      loanOriginal: number; weather: WeatherKind; weatherStart: number; weatherEnd: number; pendingKind: WeatherKind; nextTerminalId: number;
      day: number; today: number[]; history: number[][]; paxToday: number; flightsToday: number; lostToday: number; depWindow: number;
      flightPax: string; flightDockedAt: string; rng: number; marketRng: number;
    };
    this.grids.length = 0;
    for (const sg of o.grids) this.grids.push(loadGrid(sg));
    this.airlines.length = 0;
    this.airlines.push(...o.airlines);
    this.rating = o.rating;
    this.satisfaction = o.satisfaction;
    this.onTime = o.onTime;
    this.loan = o.loan;
    this.loanOriginal = o.loanOriginal;
    this.weather = o.weather;
    this.traffic.setWeather(o.weather);
    this.weatherStart = o.weatherStart;
    this.weatherEnd = o.weatherEnd;
    this.pendingKind = o.pendingKind;
    this.nextTerminalId = o.nextTerminalId;
    this.day = o.day;
    this.today.set(o.today);
    this.history.length = 0;
    for (const h of o.history) this.history.push(Float64Array.from(h));
    this.paxToday = o.paxToday;
    this.flightsToday = o.flightsToday;
    this.lostToday = o.lostToday;
    this.depWindow = o.depWindow;
    unpackInto(o.flightPax, this.flightPax, Int32Array);
    unpackInto(o.flightDockedAt, this.flightDockedAt, Int32Array);
    this.rng.setState(o.rng);
    this.marketRng.setState(o.marketRng);
    this.refreshTerminals();
    this.version = Math.max(this.version, o.version + 1);
  }

  hash(h: number): number {
    let acc = foldU32(h, this.grids.length);
    acc = foldU32(acc, Math.floor(this.rating * 100));
    acc = foldU32(acc, this.loan);
    acc = foldU32(acc, this.paxToday);
    for (const a of this.airlines) acc = foldU32(foldU32(acc, a.rotations), a.pax);
    for (const g of this.grids) {
      acc = foldU32(foldU32(acc, g.id), cellCount(g));
      for (let i = 0; i < g.fixture.length; i++) if (g.fixture[i] !== 0) acc = foldU32(acc, i * 16 + g.fixture[i]);
    }
    return foldU32(acc, this.weather.length);
  }
}

/** The tick offset within a day at which midnight falls, since the game starts at 06:00. */
function dayStartOffset(): number {
  return (24 * 60 - 6 * 60) * TICKS_PER_MINUTE;
}

const argsOf = (args?: Record<string, string | number>): string => {
  if (!args) return '';
  let out = '';
  for (const k of Object.keys(args).sort()) out += `|${k}=${args[k]}`;
  return out;
};

interface SavedGrid {
  id: number;
  ox: number;
  oy: number;
  headingDeg: number;
  floor: string;
  fixture: string;
  hWall: string;
  vWall: string;
  leased: string;
  cost: number;
}

function saveGrid(g: TerminalGrid): SavedGrid {
  return { id: g.id, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, floor: packTyped(g.floor), fixture: packTyped(g.fixture), hWall: packTyped(g.hWall), vWall: packTyped(g.vWall), leased: packTyped(g.leased), cost: g.cost };
}

function loadGrid(sg: SavedGrid): TerminalGrid {
  const g = newGrid(sg.id, sg.ox, sg.oy, sg.headingDeg);
  unpackInto(sg.floor, g.floor, Uint8Array);
  unpackInto(sg.fixture, g.fixture, Uint8Array);
  unpackInto(sg.hWall, g.hWall, Uint8Array);
  unpackInto(sg.vWall, g.vWall, Uint8Array);
  unpackInto(sg.leased, g.leased, Uint8Array);
  g.cost = sg.cost;
  return g;
}

