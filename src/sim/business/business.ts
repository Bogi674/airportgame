import { AIRCRAFT } from '@data/aircraft';
import { GSE } from '@data/index';
import { AcState, FlState } from '../ops/traffic';
import { maxStageKm, takeoffWeight } from '../ops/performance';
import { BUSINESS, SURFACE_SPEC } from '@data/index';
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
  type OfferRow,
  FIXTURE_KEYS,
  type FixtureKey,
  type Terminal,
  type TerminalGrid,
  type WeatherKind,
} from '@shared/business';
import { terminalIssues } from '@shared/terminalRooms';
import { cellCount, cellIndex, cellOf, cornerWorld, floorBounds, newGrid, planEdit, rectWorld, summarize, type TerminalEdit } from '@shared/terminalOps';
import type { Pt } from '@shared/geom';
import type { WalkGraphView } from '@shared/protocol';
import { isShopFixture, fixtureKey, TERMINAL_LEVEL_MIN, ZONE } from '@shared/business';
import { towerLevelOf } from '@shared/towerBudget';
import { blockWindow } from '@shared/flightBlock';
import type { BuildContext } from '@shared/validate';
import { foldU32 } from '../hash';
import { packTyped, unpackInto } from '../save/pack';
import { buildWalkGraph, updateWalkGraph, type WalkGraph } from '../terminal/walkGraph';
import { nearestNode, walkDistance } from '../terminal/walkDistance';
import { buildServiceNodes, rebuildServiceNodes, serviceJoin, serviceUpdate, serviceWait, type ServiceNodes } from '../terminal/serviceNodes';
import type { Rng } from '../rng';
import type { SiteSpec } from '../world/site';
import type { Airfield } from '../airfield/airfield';
import type { Traffic } from '../ops/traffic';

const CAT_INDEX: Record<LedgerCategory, number> = Object.fromEntries(LEDGER_CATEGORIES.map((c, i) => [c, i])) as Record<LedgerCategory, number>;
const FEE_MULT = [0.8, 1, 1.25] as const;
const FEE_LF = [0.08, 0, -0.08] as const;
const TERMINAL_SEAT_THRESHOLD = 15;
/** Rows the flights board and the offers sheet show for scheduled flights. Display only, the sim keeps every flight. */
const SCHEDULE_ROWS = 60;
const MINUTES_PER_DAY = 24 * 60;

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
  /** Walking graph of every grid, same order as grids. Derived, never saved. */
  readonly walkGraphs: WalkGraph[] = [];
  /** Counts walk graph rebuilds. Node ids are stale after a change. */
  walkVersion = 0;
  /** Service node tables of every grid, same order as grids. Derived from the grids and the queues in them, never saved. */
  readonly serviceNodes: ServiceNodes[] = [];
  /** Counts service table rebuilds. Node ids are stale after a change. */
  serviceVersion = 0;
  /** Counts per building, rebuilt after every edit. */
  terminals: Terminal[] = [];
  terminalVersion = 0;
    atcCells = 0;
  /** Ground support vehicles owned, by catalog index. */
  fleet: number[] = GSE.map((v) => BUSINESS.gse[v.id]?.start ?? 0);

  /** Buys vehicles for the ground handling fleet. */
  buyGse(kind: string, count: number): string | null {
    const i = GSE.findIndex((v) => v.id === kind);
    const spec = BUSINESS.gse[kind];
    if (i < 0 || !spec) return 'nothingThere';
    const n = Math.max(1, Math.min(20, Math.floor(count)));
    const cost = spec.price * n;
    if (cost > this.host.getCash()) return `insufficientFunds|cost=${cost}`;
    this.host.book('construction', -cost);
    this.fleet[i] += n;
    this.version++;
    return null;
  }

  /** Turnarounds run slower when there are fewer loaders, tugs, fuel and power units than aircraft on stands. */
  private updateServiceLevel(): void {
    const t = this.traffic;
    let busy = 0;
    for (let i = 0; i < 256; i++) if (t.active[i] === 1 && t.state[i] === AcState.Turnaround) busy++;
    let worst = 1;
    for (const id of ['beltloader', 'refueller', 'gpu', 'tug']) {
      const k = GSE.findIndex((v) => v.id === id);
      if (k >= 0 && busy > 0) worst = Math.min(worst, Math.max(0, this.fleet[k]) / busy);
    }
    t.serviceSlowdown = 1 + 0.6 * (1 - Math.min(1, worst));
  }

  /** Layout problems of the main terminal building, from the walls, doors and zones laid. */
  roomIssues: string[] = [];
  secureSeating = 0;
  /** True when some building has a gate desk, and whether some building with security and secure seating has none. */
  private anyGateDesk = false;
  private gatelessHall = false;
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
  private readonly serviceRng: Rng;
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
    this.serviceRng = rng.fork('service');
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
      return { id, name, scope, livery: id % 8, fleet, minRating, rotations: 0, slots: [], standPrefs: [], feeLevel: 1, flights: 0, pax: 0 };
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
    a.slots = fitSlots(a.slots, r, a.id);
    a.standPrefs = fitStandPrefs(a.standPrefs, r);
    this.version++;
    if (before === 0 && r > 0) {
      this.host.emit(`airlineSigned|name=${a.name}`);
      this.scheduleToday(a);
    }
    return null;
  }

  /** Remembers the stand the player chose for a rotation, -1 to clear. Out of range rotations are ignored. */
  setStandPref(airline: number, rot: number, standId: number): void {
    const a = this.airlines[airline];
    if (!a || rot < 0 || rot >= a.standPrefs.length) return;
    a.standPrefs[rot] = standId;
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

  /** Aircraft types the signed airlines fly, in index order. */
  assignedTypes(): number[] {
    const out = new Set<number>();
    for (const a of this.airlines) if (a.rotations > 0) for (const t of a.fleet) out.add(t);
    return [...out].sort((p, q) => p - q);
  }

  // Terminals ----------------------------------------------------------------

  /** Rebuilds counts, totals and the reach sample after any change to the grids. */
  private refreshTerminals(): void {
    this.terminals = this.grids.map(summarize);
    this.totals = Object.fromEntries(FIXTURE_KEYS.map((k) => [k, 0])) as Record<FixtureKey, number>;
    for (const t of this.terminals) for (const k of FIXTURE_KEYS) this.totals[k] += t.counts[k];
    this.reach = [];
    for (const g of this.grids) {
      // Every third cell on the logical grid, so the sample does not shift as a building grows.
      for (let cy = Math.ceil(g.y0 / 3) * 3; cy < g.y0 + g.h; cy += 3) {
        for (let cx = Math.ceil(g.x0 / 3) * 3; cx < g.x0 + g.w; cx += 3) {
          if (g.floor[cellIndex(g, cx, cy)] === 0) continue;
          const w = cornerWorld(g, cx + 0.5, cy + 0.5);
          this.reach.push(w.x, w.y);
        }
      }
    }
    this.computeFacilities();
    this.terminalVersion++;
    this.version++;
  }

  private computeFacilities(): void {
    let cells = 0;
    this.secureSeating = 0;
    this.anyGateDesk = false;
    this.gatelessHall = false;
    for (const g of this.grids) {
      let seats = 0;
      let lanes = 0;
      let gates = 0;
      for (let i = 0; i < g.fixture.length; i++) {
        const f = g.fixture[i];
        if (f === 0) continue;
        const k = fixtureKey(f);
        if (k === 'atc') {
          cells++;
        } else if (k === 'seating' && g.zone[i] === ZONE.Secure) {
          this.secureSeating++;
          seats++;
        } else if (k === 'security') lanes++;
        else if (k === 'gateDesk' && g.fixtureRot[i] < 5) gates++;
      }
      if (gates > 0) this.anyGateDesk = true;
      if (seats > 0 && lanes > 0 && gates === 0) this.gatelessHall = true;
    }
    this.atcCells = cells;
    let main: TerminalGrid | null = null;
    for (const g of this.grids) if (main === null || cellCountOf(g) > cellCountOf(main)) main = g;
    this.roomIssues = main ? terminalIssues(main) : [];
  }

  /** True when an ATC tower stands and a runway exists. The tower covers the whole site, so there is no range test. */
  get atcOk(): boolean {
    return (this.airfield.data.towers?.length ?? 0) > 0 && this.airfield.data.runways.length > 0;
  }

  /** What still stops flights from working, as string keys for the UI checklist. */
  readiness(): string[] {
    const out: string[] = [];
    if (this.terminals.length === 0) out.push('noTerminal');
    else {
      if (this.totals.checkIn + this.totals.kiosk === 0) out.push('noCheckIn');
      if (this.totals.security === 0) out.push('noSecurity');
      if (this.secureSeating === 0) out.push('noSeating');
      if (this.anyGateDesk && this.gatelessHall) out.push('noGateDesk');
      for (const k of this.roomIssues) out.push(k);
      if (this.totals.belt === 0) out.push('noBelt');
    }
    if (!this.atcOk) out.push('noAtc');
    return out;
  }

  /**
   * Applies one edit to a terminal building. With `building` below 0 and a foundation edit a new
   * building is started at the given origin. Only floor 0 can be built. Returns a problem code or null.
   */
  terminalBuild(building: number, ox: number, oy: number, headingDeg: number, edit: TerminalEdit, ctx: BuildContext, level = 0): string | null {
    if (level !== 0) return 'floorNotBuildable';
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
      const wg = buildWalkGraph(grid);
      this.walkGraphs.push(wg);
      this.serviceNodes.push(buildServiceNodes(grid, wg));
    } else if (cellCount(grid) > 0) {
      const i = this.grids.indexOf(grid);
      this.walkGraphs[i] = updateWalkGraph(this.walkGraphs[i]!, grid, Math.min(edit.x0, edit.x1), Math.min(edit.y0, edit.y1), Math.max(edit.x0, edit.x1), Math.max(edit.y0, edit.y1));
      this.serviceNodes[i] = rebuildServiceNodes(this.serviceNodes[i]!, grid, this.walkGraphs[i]!);
    }
    if (cellCount(grid) === 0) {
      const i = this.grids.indexOf(grid);
      this.grids.splice(i, 1);
      this.walkGraphs.splice(i, 1);
      this.serviceNodes.splice(i, 1);
    }
    this.walkVersion++;
    this.serviceVersion++;
    this.refreshTerminals();
    return null;
  }

  demolishTerminal(id: number): string | null {
    const i = this.grids.findIndex((x) => x.id === id);
    if (i < 0) return 'nothingThere';
    this.host.book('construction', Math.round(this.grids[i].cost * 0.25));
    this.grids.splice(i, 1);
    this.walkGraphs.splice(i, 1);
    this.serviceNodes.splice(i, 1);
    this.walkVersion++;
    this.serviceVersion++;
    this.refreshTerminals();
    return null;
  }

  /** Index of a grid by id, -1 when no grid has that id. */
  private gridIndex(grid: number): number {
    return this.grids.findIndex((g) => g.id === grid);
  }

  /**
   * Joins a cohort to a service node of a grid. False when no grid has that id or the node refuses the cohort.
   * Node ids are stale after serviceVersion changes, so look them up again after an edit.
   */
  serviceJoin(grid: number, node: number, cohort: number, size: number): boolean {
    const i = this.gridIndex(grid);
    return i >= 0 && serviceJoin(this.serviceNodes[i]!, node, cohort, size);
  }

  /** Seconds a person joining a node of a grid now would wait, Infinity when no grid or node has that id. Stale after serviceVersion changes. */
  serviceWait(grid: number, node: number, tick: number): number {
    const i = this.gridIndex(grid);
    return i < 0 ? Infinity : serviceWait(this.serviceNodes[i]!, node, tick);
  }

  /** The service node table of a grid, null when no grid has that id. Stale after serviceVersion changes. */
  serviceTable(grid: number): ServiceNodes | null {
    const i = this.gridIndex(grid);
    return i < 0 ? null : this.serviceNodes[i]!;
  }

  /** Walking distance in metres between two walk nodes of a grid, Infinity when no grid has that id. Node ids come from nearestNode and are stale after walkVersion changes. */
  walkDistance(grid: number, fromNode: number, toNode: number): number {
    for (let i = 0; i < this.grids.length; i++) {
      if (this.grids[i]!.id === grid) return walkDistance(this.walkGraphs[i]!, fromNode, toNode);
    }
    return Infinity;
  }

  /** Walk node a person in array cell cell of a grid starts from, -1 when no grid has that id. Stale after walkVersion changes. */
  nearestNode(grid: number, cell: number): number {
    for (let i = 0; i < this.grids.length; i++) {
      if (this.grids[i]!.id === grid) return nearestNode(this.walkGraphs[i]!, cell);
    }
    return -1;
  }

  /** Copies of the node and edge arrays of a grid's walk graph for the debug overlay, null when no grid has that id. */
  walkGraphView(grid: number): WalkGraphView | null {
    for (let i = 0; i < this.grids.length; i++) {
      if (this.grids[i]!.id !== grid) continue;
      const wg = this.walkGraphs[i]!;
      return {
        grid,
        nodeX: wg.nodeX.slice(),
        nodeY: wg.nodeY.slice(),
        nodeKind: wg.nodeKind.slice(),
        edgeStart: wg.edgeStart.slice(),
        edgeTo: wg.edgeTo.slice(),
      };
    }
    return null;
  }

  /** Departing passengers the terminals can process per hour. */
  depCapacity(): number {
    const checkInTerm =
      this.totals.checkIn * BUSINESS.modules.checkIn.capacityPerHour +
      this.totals.kiosk * BUSINESS.modules.kiosk.capacityPerHour +
      this.totals.bagDrop * BUSINESS.modules.bagDrop.capacityPerHour;
    const base = Math.min(checkInTerm, this.totals.security * BUSINESS.modules.security.capacityPerHour);
    // Without seats in the secure zone passengers wait standing and the lounge backs up.
    if (this.roomIssues.length > 0) return 0;
    return this.secureSeating > 0 ? base : Math.floor(base / 2);
  }

  arrCapacity(): number {
    return this.totals.belt * BUSINESS.modules.belt.capacityPerHour;
  }

  intlCapacity(): number {
    return this.totals.passport * BUSINESS.modules.passport.capacityPerHour;
  }

  /** Contact stands need a terminal building close by. */
  /** The floor bounds of every terminal as world polygons, for the obstacle surfaces. */
  footprints(): Pt[][] {
    const out: Pt[][] = [];
    for (const g of this.grids) {
      const b = floorBounds(g);
      if (b) out.push(rectWorld(g, b.x0, b.y0, b.x1 + 1, b.y1 + 1));
    }
    return out;
  }

  hasTerminalNear(x: number, y: number): boolean {
    const reach = BUSINESS.terminal.contactReachM;
    for (let i = 0; i < this.reach.length; i += 2) if (Math.hypot(this.reach[i] - x, this.reach[i + 1] - y) < reach) return true;
    return false;
  }

  staffCount(): number {
    let s = 0;
    for (const k of ['checkIn', 'security', 'belt', 'toilet', 'atc', 'kiosk', 'bagDrop', 'passport', 'gateDesk'] as const) s += this.totals[k] * BUSINESS.modules[k].staff;
    s += this.airfield.data.stands.length * 1.5;
    if (this.airfield.data.runways.length > 0) s += 4 + this.airfield.data.runways.length * 2;
    return Math.round(s);
  }

  // Hooks from traffic -------------------------------------------------------

  private paxFor(f: number): number {
    const a = this.traffic.fAirline[f] >= 0 ? this.airlines[this.traffic.fAirline[f]] : null;
    const seats = AIRCRAFT[this.traffic.fType[f]].capacity.seatsTypical;
    const lf = a ? this.loadFactor(a) : 0.7;
    const stage = this.traffic.fStage[f];
    const cut = stage > 0 ? takeoffWeight(AIRCRAFT[this.traffic.fType[f]], stage, lf).payloadFactor : 1;
    return Math.max(0, Math.round(seats * lf * cut));
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
    if (tick % 100 === 0) this.updateServiceLevel();
    if (tick % 10 === 0) for (let i = 0; i < this.serviceNodes.length; i++) serviceUpdate(this.serviceNodes[i]!, tick, this.serviceRng);
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
    if (!this.atcOk) return;
    for (let k = 0; k < a.rotations; k++) {
      const minute = a.slots[k] ?? SLOT_FIRST;
      if (minute < nowMin + 45) continue;
      const t = this.typeForRotation(a, k);
      const f = this.traffic.scheduleArrival(t, now + (minute - nowMin) * TICKS_PER_MINUTE, a.livery, this.traffic.turnaroundTicks(t), a.id, this.stageFor(a, t), k);
      this.applyStandPref(a, k, f);
    }
  }

  /**
   * The aircraft type a rotation flies. It is fixed by the rotation index, so the same rotation
   * flies the same type every day (T41 D1). Requires `usableScratch` to be filled for the airline.
   */
  private typeForRotation(a: Airline, k: number): number {
    return this.usableScratch[(a.id + k) % this.usableScratch.length];
  }

  /** Gives a new flight the stand remembered for its rotation. A refused stand is kept as a preference, not cleared. */
  private applyStandPref(a: Airline, k: number, f: number): void {
    if (f < 0 || a.standPrefs[k] < 0) return;
    if (this.traffic.refuseAssign(f, a.standPrefs[k]) !== null) return;
    this.traffic.fStand[f] = a.standPrefs[k];
  }

  /** Stage length of a rotation in km: regional flights are short, national ones longer, never beyond the type's range. */
  private stageFor(a: Airline, type: number): number {
    const raw = a.scope === 'regional' ? this.rng.int(250, 800) : this.rng.int(700, 2200);
    return Math.max(100, Math.min(raw, maxStageKm(AIRCRAFT[type])));
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
      if (!this.atcOk) {
        this.host.emit(`noAtc|name=${a.name}`);
        continue;
      }
      for (let k = 0; k < a.rotations; k++) {
        const minute = a.slots[k] ?? SLOT_FIRST;
        const t = this.typeForRotation(a, k);
        // Arrival times are relative to the midnight that starts this day, in ticks.
        const midnight = tick - minuteOfDay(tick) * TICKS_PER_MINUTE;
        const f = this.traffic.scheduleArrival(t, midnight + minute * TICKS_PER_MINUTE, a.livery, this.traffic.turnaroundTicks(t), a.id, this.stageFor(a, t), k);
        this.applyStandPref(a, k, f);
      }
    }
    // Today's flights take free stands now; this runs in the business step, after the airfield copy is current.
    if (this.traffic.autoStands) this.traffic.autoAssign();
    this.version++;
  }

  private chargeDaily(): void {
    const fees = BUSINESS.fees;
    const wages = Math.round(this.staffCount() * fees.wageStaffPerDay);
    this.host.book('wages', -wages);
    // Upkeep: surface percentage of build cost per year, spread over days.
    let upkeep = 0;
    const af = this.airfield.data;
    for (const r of af.runways) upkeep += (r.cost * SURFACE_SPEC[r.surface].upkeepPct) / 100 / 365;
    for (const t of af.taxiways) upkeep += (t.cost * SURFACE_SPEC[t.surface].upkeepPct) / 100 / 365;
    for (const a of af.aprons) upkeep += (a.cost * SURFACE_SPEC[a.surface].upkeepPct) / 100 / 365;
    for (const g of this.grids) upkeep += (g.cost * 0.5) / 100 / 365;
    for (const n of this.fleet) upkeep += n * fees.gseUpkeepPerDay;
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
      const eta = f >= 0 ? minuteOfDay(t.fEta[f]) : 0;
      const turnMin = f >= 0 ? Math.round(t.fTurn[f] / TICKS_PER_MINUTE) : 0;
      rows.push({
        airline: al >= 0 ? this.airlines[al].name : 'Test',
        type: AIRCRAFT[t.type[i]].icaoType,
        status: names[t.state[i]],
        stand: stand ? stand.number : '',
        eta,
        delayMin: f >= 0 ? Math.round(t.fDelay[f] / TICKS_PER_MINUTE) : 0,
        stageKm: f >= 0 ? t.fStage[f] : 0,
        flight: f,
        standId: t.standId[i],
        turnMin,
        offBlockMin: (eta + turnMin) % MINUTES_PER_DAY,
        typeIdx: t.type[i],
        startMin: f >= 0 ? t.fEta[f] / TICKS_PER_MINUTE : 0,
      });
    }
    for (let f = 0; f < 1024 && rows.length < SCHEDULE_ROWS; f++) {
      if (t.fState[f] !== FlState.Scheduled) continue;
      const al = t.fAirline[f];
      const eta = minuteOfDay(t.fEta[f]);
      const turnMin = Math.round(t.fTurn[f] / TICKS_PER_MINUTE);
      rows.push({
        airline: al >= 0 ? this.airlines[al].name : 'Test',
        type: AIRCRAFT[t.fType[f]].icaoType,
        status: 'scheduled',
        stand: '',
        eta,
        delayMin: Math.round(t.fDelay[f] / TICKS_PER_MINUTE),
        stageKm: t.fStage[f],
        flight: f,
        standId: t.fStand[f],
        turnMin,
        offBlockMin: (eta + turnMin) % MINUTES_PER_DAY,
        typeIdx: t.fType[f],
        startMin: t.fEta[f] / TICKS_PER_MINUTE,
      });
    }
    void tick;
    return rows;
  }

  /** Stand blocks of every flight that holds a stand, four numbers each. Traffic.flightBlock gives each span. */
  private standBlocks(): number[] {
    const out: number[] = [];
    const t = this.traffic;
    for (let f = 0; f < t.fStand.length; f++) {
      if (t.fStand[f] < 0 || !t.occupies(f)) continue;
      const w = t.flightBlock(f);
      out.push(t.fStand[f], f, w.startMin, w.endMin);
    }
    return out;
  }

  /** Scheduled flights of signed airlines, earliest arrival then flight id, capped at the board's row count. */
  offers(): OfferRow[] {
    const t = this.traffic;
    const flights: number[] = [];
    for (let f = 0; f < 1024; f++) if (t.fState[f] === FlState.Scheduled && t.fAirline[f] >= 0) flights.push(f);
    flights.sort((a, b) => t.fEta[a] - t.fEta[b] || a - b);
    const rows: OfferRow[] = [];
    for (let k = 0; k < flights.length && rows.length < SCHEDULE_ROWS; k++) {
      const f = flights[k];
      const spec = AIRCRAFT[t.fType[f]];
      const arrMin = minuteOfDay(t.fEta[f]);
      const turnMin = Math.round(t.turnaroundTicks(t.fType[f]) / TICKS_PER_MINUTE);
      rows.push({
        flight: f,
        airline: t.fAirline[f],
        type: spec.icaoType,
        typeIdx: t.fType[f],
        arrMin,
        turnMin,
        endMin: blockWindow(arrMin, turnMin).endMin,
        startMin: t.fEta[f] / TICKS_PER_MINUTE,
        code: spec.derivedForReading.code,
        stageKm: t.fStage[f],
        standId: t.fStand[f],
      });
    }
    return rows;
  }

  payload(tick: number): BusinessPayload {
    const dep = this.depCapacity();
    const stands = this.airfield.data.stands;
    return {
      board: this.board(tick),
      offers: this.offers(),
      standLinked: stands.map((_, i) => (this.traffic.standLinkedPublic(i) ? 1 : 0)),
      standContact: stands.map((st) => (st.type !== 'contact' || this.hasTerminalNear(st.x, st.y) ? 1 : 0)),
      movementBudget: this.traffic.movementBudget(),
      standBlocks: this.standBlocks(),
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
      readiness: this.readiness(),
      autoStands: this.traffic.autoStands,
      fleet: this.fleet,
      serviceSlowdown: this.traffic.serviceSlowdown,
      arrCapacity: this.arrCapacity(),
      intlCapacity: this.intlCapacity(),
      towerLevel: towerLevelOf(this.airfield.data),
      atcQueue: this.traffic.atcQueueLength(),
      history: this.history.map((h) => Array.from(h)),
      today: Array.from(this.today),
      paxToday: this.paxToday,
      flightsToday: this.flightsToday,
      lostPaxToday: this.lostToday,
    };
  }

  saveState(): unknown {
    return {
      fleet: this.fleet, version: this.version, grids: this.grids.map(saveGrid), airlines: this.airlines, rating: this.rating, satisfaction: this.satisfaction,
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
    const fl = (raw as { fleet?: number[] }).fleet;
    if (fl && fl.length === this.fleet.length) this.fleet = fl.slice();
    this.grids.length = 0;
    for (const sg of o.grids) this.grids.push(loadGrid(sg));
    this.walkGraphs.length = 0;
    for (const g of this.grids) this.walkGraphs.push(buildWalkGraph(g));
    this.walkVersion++;
    this.serviceNodes.length = 0;
    for (let i = 0; i < this.grids.length; i++) this.serviceNodes.push(buildServiceNodes(this.grids[i]!, this.walkGraphs[i]!));
    this.serviceVersion++;
    this.airlines.length = 0;
    this.airlines.push(...o.airlines.map((a) => ({ ...a, slots: a.slots ?? fitSlots([], a.rotations, a.id), standPrefs: a.standPrefs ?? new Array<number>(a.rotations).fill(-1) })));
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
    for (const a of this.airlines) {
      acc = foldU32(foldU32(acc, a.rotations), a.pax);
      for (const s of a.standPrefs) acc = foldU32(acc, s);
    }
    for (const g of this.grids) {
      acc = foldU32(foldU32(foldU32(foldU32(acc, g.id), cellCount(g)), g.building), g.level - TERMINAL_LEVEL_MIN);
      for (let i = 0; i < g.fixture.length; i++) {
        if (g.fixture[i] === 0) continue;
        const c = cellOf(g, i);
        acc = foldU32(foldU32(foldU32(acc, c.x + 65536), c.y + 65536), g.fixture[i]);
        // The pairing of two cell fixtures is state. Only nonzero footprints hash, so layouts without them keep their hash.
        if (g.fixtureRot[i] !== 0) acc = foldU32(foldU32(acc, i), g.fixtureRot[i]);
      }
    }
    // Queues only enter the hash once someone waits, so idle games keep their hashes.
    if (this.serviceNodes.some((sn) => sn.active > 0 || sn.evictedCount > 0)) {
      for (const sn of this.serviceNodes) {
        acc = foldU32(acc, sn.count);
        for (let k = 0; k < sn.count; k++) {
          acc = foldU32(foldU32(foldU32(foldU32(foldU32(acc, sn.kind[k]!), sn.queueLen[k]!), sn.busyUntil[k]!), sn.serving[k]!), sn.servingSize[k]!);
        }
        acc = foldU32(acc, sn.evictedCount);
      }
      acc = foldU32(acc, this.serviceRng.getState());
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
  zone?: string;
  fixture: string;
  fixtureRot: string;
  hWall: string;
  vWall: string;
  leased: string;
  cost: number;
  /** Grid bounds; saves before format 6 have a fixed 160 by 160 grid at the origin. */
  x0?: number;
  y0?: number;
  w?: number;
  h?: number;
  /** Saves before format 11 have one floor per building, on level 0. */
  building?: number;
  level?: number;
}

const cellCountOf = (g: TerminalGrid): number => cellCount(g);
/** Size of the fixed grid that saves before format 6 used. */
const LEGACY_GRID = 160;

const SLOT_FIRST = 6 * 60;
const SLOT_LAST = 21 * 60;

/** Keeps the slots the player set, drops extras and spreads new ones over the day without using random numbers. */
function fitSlots(old: number[], rotations: number, id: number): number[] {
  const out = old.slice(0, rotations);
  const span = SLOT_LAST - SLOT_FIRST;
  for (let i = out.length; i < rotations; i++) {
    const base = SLOT_FIRST + Math.floor(((i + 0.5) * span) / Math.max(1, rotations));
    out.push(Math.max(SLOT_FIRST, Math.min(SLOT_LAST, Math.round((base + ((id * 35) % 60) - 30) / 5) * 5)));
  }
  return out;
}

/** Keeps the stands the player chose per rotation, pads new rotations with -1 and drops extras from the end. */
function fitStandPrefs(old: number[], rotations: number): number[] {
  const out = old.slice(0, rotations);
  while (out.length < rotations) out.push(-1);
  return out;
}

function saveGrid(g: TerminalGrid): SavedGrid {
  return { id: g.id, building: g.building, level: g.level, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, x0: g.x0, y0: g.y0, w: g.w, h: g.h, floor: packTyped(g.floor), zone: packTyped(g.zone), fixture: packTyped(g.fixture), fixtureRot: packTyped(g.fixtureRot), hWall: packTyped(g.hWall), vWall: packTyped(g.vWall), leased: packTyped(g.leased), cost: g.cost };
}

function loadGrid(sg: SavedGrid): TerminalGrid {
  const g = newGrid(sg.id, sg.ox, sg.oy, sg.headingDeg);
  g.building = sg.building ?? sg.id;
  g.level = sg.level ?? 0;
  const x0 = sg.x0 ?? 0;
  const y0 = sg.y0 ?? 0;
  const w = sg.w ?? LEGACY_GRID;
  const h = sg.h ?? LEGACY_GRID;
  Object.assign(g, { x0, y0, w, h, floor: new Uint8Array(w * h), zone: new Uint8Array(w * h), fixture: new Uint8Array(w * h), fixtureRot: new Uint8Array(w * h), leased: new Uint8Array(w * h), hWall: new Uint8Array((h + 1) * w), vWall: new Uint8Array(h * (w + 1)) });
  unpackInto(sg.floor, g.floor, Uint8Array);
  if (sg.zone) unpackInto(sg.zone, g.zone, Uint8Array);
  unpackInto(sg.fixture, g.fixture, Uint8Array);
  unpackInto(sg.fixtureRot, g.fixtureRot, Uint8Array);
  unpackInto(sg.hWall, g.hWall, Uint8Array);
  unpackInto(sg.vWall, g.vWall, Uint8Array);
  unpackInto(sg.leased, g.leased, Uint8Array);
  g.cost = sg.cost;
  return g;
}

