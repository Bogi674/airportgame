import { AIRCRAFT } from '@data/aircraft';
import { GSE } from '@data/index';
import { AcState, FlState, GA_AIRLINE } from '../ops/traffic';
import { takeoffWeight } from '../ops/performance';
import { BAGGAGE, BUSINESS, GROUND, MARKET, STAFF, STAND_ACCESS, SURFACE_SPEC, TURNAROUNDS } from '@data/index';
import { CAUSE_CREW_LEAVING, isVehicleCause } from '@shared/turnaround';
import { airportFireCategory, neededCategory } from '@shared/fireCover';
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
  type FixtureKey,
  type Terminal,
  type TerminalGrid,
  type WeatherKind,
} from '@shared/business';
import type { Stand } from '@shared/airfield';
import { terminalIssues } from '@shared/terminalRooms';
import { cellCount, cellIndex, cellOf, cornerWorld, fixtureAnchor, fixtureCells, floorBounds, newGrid, planEdit, rectWorld, summarize, type TerminalEdit } from '@shared/terminalOps';
import { isLeveled, levelCost, MAX_FIXTURE_LEVEL, upgradeCost, upgradeDays, type FixtureWorks, type LeveledKey } from '@shared/fixtureLevels';
import type { Pt } from '@shared/geom';
import type { WalkGraphView } from '@shared/protocol';
import { GA_LABEL, isShopFixture, fixtureKey, TERMINAL_LEVEL_MIN, ZONE, type Prop, type StaffRow } from '@shared/business';
import { cellsOfRect, convertLegacyFixtures, planProp, propAt, propCost, propRect, propTotals } from '@shared/props';
import { AUD } from '@shared/terminalZones';
import { towerLevelOf } from '@shared/towerBudget';
import { travelatorCostOf } from '@shared/travelator';
import { Market } from '../market/market';
import type { BuildContext } from '@shared/validate';
import { foldU32 } from '../hash';
import { packTyped, unpackInto } from '../save/pack';
import { buildWalkGraph, updateWalkGraph, WALK_NODE, type WalkGraph } from '../terminal/walkGraph';
import { nearestNode, walkDistance } from '../terminal/walkDistance';
import { buildOverlayData, emptyOverlay, type OverlayData, type OverlayPeople } from '../terminal/overlays';
import { buildServiceNodes, rebuildServiceNodes, serviceJoin, serviceLoad, serviceSave, serviceUpdate, serviceWait, type ServiceNodes, type ServiceSave } from '../terminal/serviceNodes';
import type { Rng } from '../rng';
import type { SiteSpec } from '../world/site';
import type { Airfield } from '../airfield/airfield';
import type { Traffic } from '../ops/traffic';

const CAT_INDEX: Record<LedgerCategory, number> = Object.fromEntries(LEDGER_CATEGORIES.map((c, i) => [c, i])) as Record<LedgerCategory, number>;
const FEE_MULT = [0.8, 1, 1.25] as const;
const FEE_LF = [0.08, 0, -0.08] as const;
const TERMINAL_SEAT_THRESHOLD = 15;
const TOILET_ID = FIXTURE_KEYS.indexOf('toilet') + 1;
/** Rows the flights board and the offers sheet show for scheduled flights. Display only, the sim keeps every flight. */
const SCHEDULE_ROWS = 60;
const MINUTES_PER_DAY = 24 * 60;

export interface BusinessHost {
  getCash(): number;
  book(category: LedgerCategory, amount: number): void;
  emit(code: string): void;
}

/** A gate desk anchor: its grid id, logical cell and world center in meters. */
export interface GateDesk {
  building: number;
  x: number;
  y: number;
  wx: number;
  wy: number;
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
  /** Ground support vehicles owned, by catalog index. They live in depots, so a new game owns none (T60). */
  fleet: number[] = GSE.map(() => 0);
  /** Vehicles the depots can hold, set by the sim from the depot count (D18). */
  depotCapacity = 0;
  /** Fuel in the farms in liters, and tankers on the way as due tick and liters pairs (T65, D19). */
  fuelStockL = 0;
  fuelOrders: number[] = [];
  /** Game day from which a fire category below a type's need refuses its flights (T65, user 2026-11-18). */
  fireGraceUntil: number = GROUND.fire.graceDays;

  /** Liters all fuel farms hold. */
  fuelCapacityL(): number {
    const farms = (this.airfield.data.buildings ?? []).filter((b) => b.kind === 'fuelFarm').length;
    return farms * GROUND.fuel.tankCount * GROUND.fuel.tankM3 * 1000;
  }

  /**
   * Hourly fuel check: deliveries that are due fill the tanks, and below the order share tankers are ordered
   * to bring the stock with what is on the way back to full, paid at the buy price when ordered (D19).
   */
  private updateFuel(tick: number): void {
    const cap = this.fuelCapacityL();
    if (this.fuelStockL > cap) this.fuelStockL = cap;
    let inbound = 0;
    const keep: number[] = [];
    for (let i = 0; i < this.fuelOrders.length; i += 2) {
      if (this.fuelOrders[i] <= tick) this.fuelStockL = Math.min(cap, this.fuelStockL + this.fuelOrders[i + 1]);
      else {
        keep.push(this.fuelOrders[i], this.fuelOrders[i + 1]);
        inbound += this.fuelOrders[i + 1];
      }
    }
    if (keep.length !== this.fuelOrders.length) this.version++;
    this.fuelOrders = keep;
    if (cap === 0 || this.fuelStockL + inbound >= cap * GROUND.fuel.orderBelowShare) return;
    const tankerL = GROUND.fuel.tankerM3 * 1000;
    const n = Math.ceil((cap - this.fuelStockL - inbound) / tankerL);
    const due = tick + GROUND.fuel.leadHours * 60 * TICKS_PER_MINUTE;
    for (let k = 0; k < n; k++) this.fuelOrders.push(due, tankerL);
    this.host.book('fuel', -Math.round(n * tankerL * GROUND.fuel.buyPerL));
    this.host.emit(`fuelOrdered|n=${n}`);
    this.version++;
  }

  /** Takes up to the liters asked from the farms and sells them at the sell price. Returns the liters taken. */
  drawFuel(liters: number): number {
    const got = Math.min(liters, Math.floor(this.fuelStockL));
    if (got <= 0) return 0;
    this.fuelStockL -= got;
    this.host.book('fuel', Math.round(got * GROUND.fuel.sellPerL));
    return got;
  }

  /** Tells traffic the fire category and whether the grace is over. Derived, so the sim also calls it after edits and restores. */
  refreshFire(): void {
    this.traffic.fireCategory = airportFireCategory(this.airfield.data);
    this.traffic.fireEnforced = this.day >= this.fireGraceUntil;
  }

  /** The daily fire check, with a warning while the grace runs and the category falls short of a signed fleet. */
  private updateFire(day: number): void {
    this.refreshFire();
    const cat = this.traffic.fireCategory;
    let needed = 0;
    for (const a of this.airlines) if (a.signed) for (const t of a.fleet) needed = Math.max(needed, neededCategory(AIRCRAFT[t].dimensions.lengthM));
    if (needed > cat && day < this.fireGraceUntil) this.host.emit(`fireGrace|needed=${needed}|available=${cat}|days=${this.fireGraceUntil - day}`);
  }

  /**
   * Depots were built or removed: each new depot brings the starter set (the `start` counts of the gse
   * catalog in business.json, user 2026-11-18), each removed one takes it back as far as it is owned.
   */
  depotsChanged(delta: number): void {
    GSE.forEach((v, i) => {
      const n = (BUSINESS.gse[v.id]?.start ?? 0) * delta;
      this.fleet[i] = Math.max(0, this.fleet[i] + n);
    });
    this.version++;
  }

  /** Buys vehicles for the ground handling fleet. */
  buyGse(kind: string, count: number): string | null {
    const i = GSE.findIndex((v) => v.id === kind);
    const spec = BUSINESS.gse[kind];
    if (i < 0 || !spec) return 'nothingThere';
    const n = Math.max(1, Math.min(20, Math.floor(count)));
    if (this.depotCapacity === 0) return 'noDepot';
    let owned = 0;
    for (const k of this.fleet) owned += k;
    if (owned + n > this.depotCapacity) return `depotFull|max=${this.depotCapacity}`;
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
  /** Passenger amenities from props (T76), 0 to 1 each: seats against gate desks, ambience against passenger floor. */
  comfortScore = 0;
  ambienceScore = 0;
  /** Servers of every washroom, the summed capacity of their toilet props. */
  private toiletServers = 0;
  /** Summed price of every prop, for upkeep and the demolition refund. */
  private propCost = 0;
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
  /** Running share of airline turnarounds cleaned by a cleaning depot, and handled with no vehicle or crew delay (T63). */
  cleanScore = 1;
  handlingScore = 1;
  /** Passenger and airline experience, 0 to 1, from the last daily close. Derived, never saved. */
  paxScore = 0;
  airlineScore = 0;
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
  /** Passengers of a flight that reached a gate desk in time, set by the sim. Without it no departure passenger flies. */
  boarded: ((f: number) => number) | null = null;
  /** Called with the index of a terminal grid after it is demolished, set by the sim. */
  gridRemoved: ((index: number) => void) | null = null;
  /** Called with the building id at the end of every successful terminal edit or demolition, set by the sim. */
  onGridEdited: ((building: number) => void) | null = null;
  /** Share of today's checked bags that were missing, 0 to 1, and the reset after the daily close. Set by the sim (T43). */
  bagMissingShare: (() => number) | null = null;
  bagDayReset: (() => void) | null = null;
  /** Closes the day of passenger satisfaction and returns the mean over the trailing 30 days, 0 to 100, or -1 with no passenger rated. Set by the sim (T67). */
  closePax: (() => number) | null = null;
  /** Daily wages of the hired station staff, set by the sim (T68). */
  staffWages: (() => number) | null = null;
  /** Staffing table of the payload, set by the sim (T68). */
  staffRows: (() => StaffRow[]) | null = null;
  /** Last closed day of passengers, see BusinessPayload.paxDay. Set by the sim (T67). */
  paxDay: (() => number[]) | null = null;
  /** Last closed day of the arrival journey, see BusinessPayload.arrDay. Set by the sim (T20). */
  arrDay: (() => number[]) | null = null;
  private readonly rng: Rng;
  private readonly marketRng: Rng;
  private readonly serviceRng: Rng;
  private flightPax = new Int32Array(1024);
  private flightDockedAt = new Int32Array(1024);
  readonly market: Market;

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
    this.market = new Market(rng, this.marketRng, this.airlines, traffic, {
      emit: (e) => host.emit(e),
      stars: () => this.stars(),
      movementBudget: () => traffic.movementBudget(),
      internationalReady: () => this.internationalReady(),
    });
    this.market.generateAirlines();
    traffic.hooks = {
      docked: (f) => this.onDocked(f),
      pushback: (f) => this.onPushback(f),
      departed: (f) => this.onDeparted(f),
    };
  }

  // Airlines -----------------------------------------------------------------

  signAirline(id: number, on: boolean): string | null {
    const r = this.market.sign(id, on, this.rating, this.traffic.nowTick);
    this.version++;
    return r;
  }

  /** Airport stars from the rating cuts of D27: how many cuts the rating has passed. */
  stars(): number {
    let n = 0;
    for (const c of MARKET.stars.cuts) if (this.rating >= c) n++;
    return n;
  }

  setFee(id: number, level: FeeLevel): void {
    const a = this.airlines.find((x) => x.id === id);
    if (!a) return;
    a.feeLevel = level;
    this.version++;
  }

  private loadFactor(a: Airline): number {
    const city = this.site.city;
    const demand = 0.5 + 0.2 * Math.min(1, city.population / 1500000) + 0.1 * (city.tourismShare + city.businessShare);
    return Math.max(0.3, Math.min(0.95, demand + this.rating / 300 + FEE_LF[a.feeLevel]));
  }

  /** Aircraft types the signed airlines fly, in index order. */
  assignedTypes(): number[] {
    const out = new Set<number>();
    for (const s of this.market.series) if (this.airlines[s.airline]?.signed) out.add(s.typeIdx);
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
    let comfort = 0;
    let ambience = 0;
    let area = 0;
    let propCostSum = 0;
    let gateDesks = 0;
    this.secureSeating = 0;
    this.anyGateDesk = false;
    this.gatelessHall = false;
    for (const g of this.grids) {
      let lanes = 0;
      let gates = 0;
      for (let i = 0; i < g.fixture.length; i++) {
        const f = g.fixture[i];
        if (f === 0) continue;
        const k = fixtureKey(f);
        if (k === 'atc') {
          cells++;
        } else if (k === 'security') lanes++;
        else if (k === 'gateDesk' && g.fixtureRot[i] < 5) gates++;
      }
      const t = propTotals(g);
      const seats = t.secureSeats;
      this.secureSeating += t.secureSeats;
      comfort += t.comfortSeats;
      ambience += t.ambience;
      area += t.passengerAreaM2;
      propCostSum += t.cost;
      gateDesks += gates;
      if (gates > 0) this.anyGateDesk = true;
      if (seats > 0 && lanes > 0 && gates === 0) this.gatelessHall = true;
    }
    this.atcCells = cells;
    const P = BUSINESS.props;
    this.comfortScore = Math.min(1, comfort / (P.seatsPerGateDesk * Math.max(1, gateDesks)));
    this.ambienceScore = area > 0 ? Math.min(1, ambience / (area / P.ambienceAreaM2)) : 0;
    this.propCost = propCostSum;
    // Washrooms are toilet nodes of the service tables, one per room with toilet props (T76).
    let washrooms = 0;
    this.toiletServers = 0;
    for (const sn of this.serviceNodes) {
      for (let k = 0; k < sn.count; k++) {
        if (sn.kind[k] !== TOILET_ID) continue;
        washrooms++;
        this.toiletServers += sn.servers[k]!;
      }
    }
    this.totals.toilet = washrooms;
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
      if (this.totals.belt + this.totals.carousel === 0) out.push('noBelt');
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
    }
    const id = grid.id;
    if (cellCount(grid) === 0) {
      const i = this.grids.indexOf(grid);
      this.grids.splice(i, 1);
      this.gridRemoved?.(i);
      this.walkGraphs.splice(i, 1);
      this.serviceNodes.splice(i, 1);
      this.bumpTerminals();
    } else if (fresh) {
      this.bumpTerminals();
    } else {
      this.refreshGrid(id, edit.x0, edit.y0, edit.x1, edit.y1);
    }
    this.onGridEdited?.(id);
    return null;
  }

  /**
   * Rebuilds the derived data of one building after its cells changed inside the rectangle (corners in any order):
   * the walking graph, the service nodes and the terminal counts.
   */
  refreshGrid(building: number, x0: number, y0: number, x1: number, y1: number): void {
    const i = this.grids.findIndex((g) => g.id === building);
    if (i < 0) return;
    const grid = this.grids[i]!;
    if (cellCount(grid) > 0) {
      this.walkGraphs[i] = updateWalkGraph(this.walkGraphs[i]!, grid, Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1));
      this.dropStaleWorks(grid);
      this.serviceNodes[i] = rebuildServiceNodes(this.serviceNodes[i]!, grid, this.walkGraphs[i]!, this.closedCells(grid));
    }
    this.bumpTerminals();
  }

  // Fixture levels (T74) ----------------------------------------------------

  /** Fixtures under upgrade works, in the order they started. Saved. */
  fixtureWorks: FixtureWorks[] = [];

  /** The works on the fixture anchored at logical cell (x, y) of a building, undefined when there are none. */
  worksAt(building: number, x: number, y: number): FixtureWorks | undefined {
    return this.fixtureWorks.find((w) => w.building === building && w.x === x && w.y === y);
  }

  /** Array cells of the anchors of a grid that are closed for works. */
  private closedCells(g: TerminalGrid): number[] {
    const out: number[] = [];
    for (const w of this.fixtureWorks) if (w.building === g.id) out.push(cellIndex(g, w.x, w.y));
    return out;
  }

  /** Forgets the works of fixtures that an edit removed: the anchor no longer holds a leveled fixture at the works' old level. */
  private dropStaleWorks(g: TerminalGrid): void {
    this.fixtureWorks = this.fixtureWorks.filter((w) => {
      if (w.building !== g.id) return true;
      const c = cellIndex(g, w.x, w.y);
      return c >= 0 && g.fixture[c] !== 0 && g.fixtureRot[c] < 5 && isLeveled(fixtureKey(g.fixture[c])) && g.fixtureLevel[c] === w.from;
    });
  }

  /** Anchor array cell of the leveled fixture covering logical cell (x, y) of a grid, -1 when there is none. */
  private leveledAnchor(g: TerminalGrid, x: number, y: number): number {
    const a = fixtureAnchor(g, cellIndex(g, x, y));
    return a >= 0 && isLeveled(fixtureKey(g.fixture[a])) ? a : -1;
  }

  /**
   * Starts the works that raise a fixture one level (T74): pays the difference of the two build costs, closes the
   * fixture, whose queue moves to other fixtures of its kind, and finishes after the family's works days.
   */
  startFixtureUpgrade(building: number, x: number, y: number, tick: number): string | null {
    const g = this.grids.find((q) => q.id === building);
    if (!g) return 'nothingThere';
    const a = this.leveledAnchor(g, x, y);
    if (a < 0) return 'notLeveled';
    const at = cellOf(g, a);
    if (this.worksAt(building, at.x, at.y)) return 'fixtureWorksRunning';
    const key = fixtureKey(g.fixture[a]) as LeveledKey;
    const from = g.fixtureLevel[a];
    if (from >= MAX_FIXTURE_LEVEL) return 'fixtureMaxLevel';
    const cost = upgradeCost(key, from);
    if (cost > this.host.getCash()) return `insufficientFunds|cost=${cost}`;
    this.host.book('construction', -cost);
    g.cost += cost;
    this.fixtureWorks.push({ building, floor: g.level, x: at.x, y: at.y, from, to: from + 1, cost, doneTick: tick + upgradeDays(key) * TICKS_PER_DAY });
    this.refreshGrid(building, at.x, at.y, at.x, at.y);
    return null;
  }

  /** Cancels running works: the fixture keeps its old level and reopens, and the price is refunded in full. */
  cancelFixtureUpgrade(building: number, x: number, y: number): string | null {
    const g = this.grids.find((q) => q.id === building);
    if (!g) return 'nothingThere';
    const a = this.leveledAnchor(g, x, y);
    if (a < 0) return 'notLeveled';
    const at = cellOf(g, a);
    const w = this.worksAt(building, at.x, at.y);
    if (!w) return 'noWorks';
    this.fixtureWorks.splice(this.fixtureWorks.indexOf(w), 1);
    this.host.book('construction', w.cost);
    g.cost -= w.cost;
    this.refreshGrid(building, at.x, at.y, at.x, at.y);
    return null;
  }

  /** Finishes the works that are due: the fixture takes its new level on every cell and reopens. Cheap when none run. */
  private finishFixtureWorks(tick: number): void {
    if (this.fixtureWorks.length === 0) return;
    for (let i = 0; i < this.fixtureWorks.length; ) {
      const w = this.fixtureWorks[i]!;
      if (w.doneTick > tick) {
        i++;
        continue;
      }
      this.fixtureWorks.splice(i, 1);
      const g = this.grids.find((q) => q.id === w.building);
      if (!g) continue;
      const a = cellIndex(g, w.x, w.y);
      for (const c of fixtureCells(g, a)) g.fixtureLevel[c] = w.to;
      this.refreshGrid(w.building, w.x, w.y, w.x, w.y);
      this.onGridEdited?.(w.building);
      this.host.emit(`fixtureUpgraded|level=${w.to}`);
    }
  }

  /**
   * Removes the one cell security lanes of a save from before version 35 and refunds their level 1 cost (T74, owner
   * 2026-11-22). Cohorts queued at them are evicted and choose again. Returns the number of lanes removed.
   */
  removeLegacyLanes(lanes: readonly (readonly number[])[]): number {
    let removed = 0;
    for (let gi = 0; gi < this.grids.length; gi++) {
      const g = this.grids[gi]!;
      const cells = lanes[gi] ?? [];
      if (cells.length === 0) continue;
      for (const c of cells) {
        g.fixture[c] = 0;
        g.fixtureRot[c] = 0;
        g.fixtureOff[c] = 0;
        g.fixtureLevel[c] = 0;
        g.fixtureMode[c] = 0;
      }
      const refund = cells.length * levelCost('security', 1);
      this.host.book('construction', refund);
      g.cost = Math.max(0, g.cost - refund);
      removed += cells.length;
      this.walkGraphs[gi] = buildWalkGraph(g);
      this.serviceNodes[gi] = rebuildServiceNodes(this.serviceNodes[gi]!, g, this.walkGraphs[gi]!, this.closedCells(g));
    }
    if (removed > 0) this.bumpTerminals();
    return removed;
  }

  // Props (T76) ----------------------------------------------------------------

  /** Places a prop on a floor of a building, paying its price. Returns a problem code or null. */
  placeProp(building: number, p: Prop): string | null {
    const g = this.grids.find((q) => q.id === building);
    if (!g) return 'nothingThere';
    const prop: Prop = { asset: p.asset, x: p.x, y: p.y, rot: p.rot };
    const plan = planProp(g, prop);
    if (plan.problem) return plan.problem.code + argsOf(plan.problem.args);
    if (plan.cost > this.host.getCash()) return `insufficientFunds|cost=${plan.cost}`;
    if (plan.cost > 0) this.host.book('construction', -plan.cost);
    g.props.push(prop);
    this.refreshProp(g, prop);
    return null;
  }

  /** Removes the topmost prop under the point (x, y) in grid meters and refunds its full price, which stands in for undo. */
  removeProp(building: number, x: number, y: number): string | null {
    const g = this.grids.find((q) => q.id === building);
    if (!g) return 'nothingThere';
    const i = propAt(g.props, x, y);
    if (i < 0) return 'nothingThere';
    const [prop] = g.props.splice(i, 1);
    this.host.book('construction', propCost(prop!.asset));
    this.refreshProp(g, prop!);
    return null;
  }

  /** Rebuilds the derived data of a grid around one prop that came or went. */
  private refreshProp(g: TerminalGrid, p: Prop): void {
    const r = propRect(p)!;
    const c = cellsOfRect(r);
    this.refreshGrid(g.id, c.x0, c.y0, c.x1, c.y1);
    this.onGridEdited?.(g.id);
  }

  /**
   * Turns the seating and toilet fixtures of a save from before version 36 into props (T76, owner 2026-11-22). Cohorts
   * queued at the old toilet blocks are evicted and choose again. Returns the number of cells converted.
   */
  convertLegacyProps(): number {
    let n = 0;
    for (let gi = 0; gi < this.grids.length; gi++) {
      const g = this.grids[gi]!;
      const k = convertLegacyFixtures(g);
      if (k === 0) continue;
      n += k;
      this.walkGraphs[gi] = buildWalkGraph(g);
      this.serviceNodes[gi] = rebuildServiceNodes(this.serviceNodes[gi]!, g, this.walkGraphs[gi]!, this.closedCells(g));
    }
    if (n > 0) this.bumpTerminals();
    return n;
  }

  private bumpTerminals(): void {
    this.walkVersion++;
    this.serviceVersion++;
    this.refreshTerminals();
  }

  demolishTerminal(id: number): string | null {
    const i = this.grids.findIndex((x) => x.id === id);
    if (i < 0) return 'nothingThere';
    this.host.book('construction', Math.round((this.grids[i].cost + propTotals(this.grids[i]).cost) * 0.25));
    this.grids.splice(i, 1);
    this.gridRemoved?.(i);
    this.walkGraphs.splice(i, 1);
    this.serviceNodes.splice(i, 1);
    this.walkVersion++;
    this.serviceVersion++;
    this.refreshTerminals();
    this.onGridEdited?.(id);
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
  serviceJoin(grid: number, node: number, cohort: number, size: number, ahead?: (cohort: number) => boolean): boolean {
    const i = this.gridIndex(grid);
    return i >= 0 && serviceJoin(this.serviceNodes[i]!, node, cohort, size, ahead);
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

  /** Gate desk anchors of every grid in grid then cell order, with their world centers. Rebuilt when serviceVersion changes. */
  private gateDesks: GateDesk[] = [];
  private gateDesksAt = -1;

  private deskList(): GateDesk[] {
    if (this.gateDesksAt === this.serviceVersion) return this.gateDesks;
    this.gateDesksAt = this.serviceVersion;
    this.gateDesks = [];
    for (let i = 0; i < this.grids.length; i++) {
      const g = this.grids[i]!;
      const sn = this.serviceNodes[i]!;
      for (let n = 0; n < sn.count; n++) {
        if (fixtureKey(sn.kind[n]!) !== 'gateDesk') continue;
        const w = cornerWorld(g, sn.lx[n]! + 0.5, sn.ly[n]! + 0.5);
        this.gateDesks.push({ building: g.id, x: sn.lx[n]!, y: sn.ly[n]!, wx: w.x, wy: w.y });
      }
    }
    return this.gateDesks;
  }

  /** True when the logical cell (x, y) of the grid with this id holds the anchor of a gate desk. */
  isGateDesk(building: number, x: number, y: number): boolean {
    return this.deskList().some((d) => d.building === building && d.x === x && d.y === y);
  }

  /** Display number of the stand a flight is assigned to, '0' when it has none. */
  private standNumberOf(f: number): string {
    const stands = this.airfield.data.stands;
    for (let i = 0; i < stands.length; i++) if (stands[i]!.id === this.traffic.fStand[f]) return stands[i]!.number;
    return '0';
  }

  /** The desk a stand is assigned to while that desk still exists, null when the stand is unknown, has no assignment or the desk is gone. */
  assignedGate(standId: number): GateDesk | null {
    const stand = this.airfield.data.stands.find((s) => s.id === standId);
    const want = stand?.gate;
    if (!want) return null;
    return this.deskList().find((d) => d.building === want.building && d.x === want.x && d.y === want.y) ?? null;
  }

  /**
   * The gate desk that boards a stand: its assigned desk while that still exists, else the desk nearest the stand
   * center by straight line (ties to the lowest grid, then the lowest cell). Null when the airport has no gate desk.
   * The returned object is shared, never change it.
   */
  gateFor(stand: Pick<Stand, 'x' | 'y' | 'gate'>): GateDesk | null {
    const desks = this.deskList();
    const want = stand.gate;
    if (want) for (const d of desks) if (d.building === want.building && d.x === want.x && d.y === want.y) return d;
    let best: GateDesk | null = null;
    let bestD = Infinity;
    for (const d of desks) {
      const dist = Math.hypot(d.wx - stand.x, d.wy - stand.y);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }

  /**
   * Read only overlay of one terminal building: people per cell, queue and wait per service node, walking distance
   * per gate. The cohorts are passed in because they depend on the business. Changes no sim state, RNG or hash.
   */
  overlayData(grid: number, tick: number, out: OverlayData, people: OverlayPeople): OverlayData {
    const g = this.grids[grid];
    const sn = this.serviceNodes[grid];
    if (!g || !sn) return emptyOverlay(out, grid);
    return buildOverlayData(out, grid, g.id, g, sn, people, this, tick);
  }

  /** Walking distance in metres between two walk nodes of a grid for an audience, passengers by default, Infinity when no grid has that id. Node ids come from nearestNode and are stale after walkVersion changes. */
  walkDistance(grid: number, fromNode: number, toNode: number, aud: number = AUD.Pax): number {
    for (let i = 0; i < this.grids.length; i++) {
      if (this.grids[i]!.id === grid) return walkDistance(this.walkGraphs[i]!, fromNode, toNode, aud);
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

  private intlReady = false;
  private intlReadyAt = -1;
  private intlReadyWalk = -1;

  /**
   * True when some terminal with a curb holds the whole international flow (T79): a passport booth or eGate in
   * departure mode reachable from the curb, a gate desk in an International zone reachable from it, a booth or eGate in
   * arrival mode reachable from that desk, and a customs channel reachable from that booth with the curb beyond it.
   * Cached per walk and service version.
   */
  internationalReady(): boolean {
    if (this.intlReadyAt === this.serviceVersion && this.intlReadyWalk === this.walkVersion) return this.intlReady;
    this.intlReadyAt = this.serviceVersion;
    this.intlReadyWalk = this.walkVersion;
    this.intlReady = false;
    for (let i = 0; i < this.grids.length && !this.intlReady; i++) this.intlReady = this.intlFlowIn(i);
    return this.intlReady;
  }

  private intlFlowIn(i: number): boolean {
    const curb = this.curbNode(i);
    const t = this.serviceNodes[i];
    const wg = this.walkGraphs[i];
    const g = this.grids[i]!;
    if (curb < 0 || !t || !wg) return false;
    const dep: number[] = [];
    const desk: number[] = [];
    const arr: number[] = [];
    const cus: number[] = [];
    for (let n = 0; n < t.count; n++) {
      if (t.queueCap[n] <= 0) continue;
      const key = fixtureKey(t.kind[n]!);
      const w = t.walkNode[n]!;
      if (key === 'passport' || key === 'eGate') (g.fixtureMode[t.cell[n]!] === 1 ? arr : dep).push(w);
      else if (key === 'gateDesk' && wg.effective[t.cell[n]!] === ZONE.International) desk.push(w);
      else if (key === 'customs') cus.push(w);
    }
    const reach = (from: readonly number[], to: readonly number[]): number[] => to.filter((b) => from.some((a) => Number.isFinite(walkDistance(wg, a, b, AUD.Pax))));
    const back = reach(reach(reach(reach([curb], dep), desk), arr), cus);
    return reach(back, [curb]).length > 0;
  }

  /** Result of arrivalEntry: grid index, walk node of the entry desk, 1 when the route is international. */
  readonly entryOut = new Int32Array(3);

  /**
   * Picks where the passengers of a docked flight enter the terminal (T20 D5) and leaves it in entryOut. An
   * international flight wants a gate desk in an International zone, a domestic one in a Secure zone; an
   * international flight with no International desk falls back to a Secure one with entryOut[2] 0 (Q1 default,
   * the switch is this one branch). False when no gate desk in a grid with a curb can take the flight.
   */
  arrivalEntry(f: number): boolean {
    const stands = this.airfield.data.stands;
    let desk: GateDesk | null = null;
    for (let i = 0; i < stands.length; i++) {
      if (stands[i]!.id === this.traffic.fStand[f]) {
        desk = this.gateFor(stands[i]!);
        break;
      }
    }
    const intl = this.market.isInternational(f);
    if (this.entryInZone(desk, intl ? ZONE.International : ZONE.Secure)) {
      this.entryOut[2] = intl ? 1 : 0;
      return true;
    }
    if (intl && this.entryInZone(desk, ZONE.Secure)) {
      this.entryOut[2] = 0;
      return true;
    }
    return false;
  }

  /** Fills entryOut[0..1] with a gate desk whose zone is `want`: the stand's own desk first, then grids and nodes ascending. */
  private entryInZone(desk: GateDesk | null, want: number): boolean {
    if (desk) {
      for (let i = 0; i < this.grids.length; i++) {
        if (this.grids[i]!.id !== desk.building || this.curbNode(i) < 0) continue;
        const sn = this.serviceNodes[i]!;
        for (let n = 0; n < sn.count; n++) {
          if (sn.lx[n] !== desk.x || sn.ly[n] !== desk.y || fixtureKey(sn.kind[n]!) !== 'gateDesk') continue;
          if (this.walkGraphs[i]!.effective[sn.cell[n]!] !== want) break;
          this.entryOut[0] = i;
          this.entryOut[1] = sn.walkNode[n]!;
          return true;
        }
      }
    }
    for (let i = 0; i < this.grids.length; i++) {
      if (this.curbNode(i) < 0) continue;
      const sn = this.serviceNodes[i]!;
      for (let n = 0; n < sn.count; n++) {
        if (sn.queueCap[n]! <= 0 || fixtureKey(sn.kind[n]!) !== 'gateDesk') continue;
        if (this.walkGraphs[i]!.effective[sn.cell[n]!] !== want) continue;
        this.entryOut[0] = i;
        this.entryOut[1] = sn.walkNode[n]!;
        return true;
      }
    }
    return false;
  }

  /** Passengers a flight was served with at docking, 0 for GA and for flights lost to a missing terminal. */
  flightPaxOf(f: number): number {
    return f < 0 ? 0 : this.flightPax[f];
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

  /** Staff the legacy per fixture count includes for fixtures that individual staff now cover (T68). */
  stationPositions(): number {
    let s = 0;
    for (const k of Object.keys(STAFF.stations)) {
      if (k === 'note' || !(k in BUSINESS.modules)) continue;
      const key = k as keyof typeof BUSINESS.modules;
      s += this.totals[key] * BUSINESS.modules[key].staff;
    }
    return s;
  }

  // Hooks from traffic -------------------------------------------------------

  paxFor(f: number): number {
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

  needsTerminal(f: number): boolean {
    return AIRCRAFT[this.traffic.fType[f]].capacity.seatsTypical >= TERMINAL_SEAT_THRESHOLD;
  }

  /** Walk node of the lowest id door of a grid that stands on public floor, the curb where passengers arrive. Index into grids, -1 when there is none. */
  curbNode(grid: number): number {
    const wg = this.walkGraphs[grid];
    if (!wg) return -1;
    for (let n = 0; n < wg.nodeCount; n++) if (wg.nodeKind[n] === WALK_NODE.Door && wg.effective[wg.nodeCell[n]!] === ZONE.Public) return n;
    return -1;
  }

  /**
   * Grid index a flight's passengers use: the eligible grids in index order, picked by flight index. A grid is eligible
   * with a curb and, among its service nodes with queue room, a check in point, a security lane and a gate desk.
   * Returns -1 when no grid is eligible.
   */
  cohortGrid(f: number): number {
    let count = 0;
    for (let i = 0; i < this.grids.length; i++) if (this.servesCohorts(i)) count++;
    if (count === 0) return -1;
    let want = f % count;
    for (let i = 0; i < this.grids.length; i++) {
      if (!this.servesCohorts(i)) continue;
      if (want === 0) return i;
      want--;
    }
    return -1;
  }

  private servesCohorts(grid: number): boolean {
    if (this.curbNode(grid) < 0) return false;
    const t = this.serviceNodes[grid];
    if (!t) return false;
    let checkIn = false;
    let security = false;
    let gate = false;
    for (let n = 0; n < t.count; n++) {
      if (t.queueCap[n] <= 0) continue;
      const key = fixtureKey(t.kind[n]);
      if (key === 'checkIn' || key === 'kiosk') checkIn = true;
      else if (key === 'security') security = true;
      else if (key === 'gateDesk') gate = true;
    }
    return checkIn && security && gate;
  }

  /** Row label for a flight: the airline name, GA for general aviation, Test for the test flights. */
  private airlineLabel(al: number): string {
    if (al >= 0) return this.airlines[al].name;
    return al === GA_AIRLINE ? GA_LABEL : 'Test';
  }

  private onDocked(f: number): void {
    const t = this.traffic.fType[f];
    const spec = AIRCRAFT[t];
    const m = this.mult(f);
    // General aviation pays landing and parking only, so it carries no passengers.
    const ga = this.traffic.fAirline[f] === GA_AIRLINE;
    this.host.book('landing', Math.round((spec.weights.mtowKg / 1000) * BUSINESS.fees.landingPerTonne * m));
    let pax = ga ? 0 : this.paxFor(f);
    if (!ga && this.needsTerminal(f)) {
      if (!this.arrivalEntry(f)) {
        this.lostToday += pax;
        pax = 0;
        this.host.emit(`arrivalNoGate|stand=${this.standNumberOf(f)}`);
      } else if (this.market.isInternational(f) && this.entryOut[2] === 0) {
        this.host.emit(`intlNoImmigration|stand=${this.standNumberOf(f)}`);
      }
    }
    if (!ga) this.host.book('passengers', Math.round(pax * BUSINESS.fees.passengerArriving * m));
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
    const ga = this.traffic.fAirline[f] === GA_AIRLINE;
    let pax = ga ? 0 : this.paxFor(f);
    if (!ga && this.needsTerminal(f)) {
      // Only passengers who boarded through the terminal fly. The rest miss the flight.
      const served = Math.min(pax, this.boarded ? this.boarded(f) : 0);
      this.lostToday += pax - served;
      pax = served;
    }
    if (!ga) this.host.book('passengers', Math.round(pax * BUSINESS.fees.passengerDeparting * m));
    this.paxToday += pax;
    this.flightsToday++;
    if (this.traffic.fAirline[f] >= 0) {
      const c = this.traffic.fCause[f];
      const handled = isVehicleCause(c) || c === CAUSE_CREW_LEAVING ? 0 : 1;
      this.handlingScore += (handled - this.handlingScore) * TURNAROUNDS.ratingWeight;
    }
    const hours = Math.max(0.25, (this.traffic.nowTick - this.flightDockedAt[f]) / (TICKS_PER_MINUTE * 60));
    this.host.book('parking', Math.round(hours * BUSINESS.fees.parkingPerStandHour * m));
    const al = this.traffic.fAirline[f];
    if (al >= 0) {
      this.airlines[al].pax += pax;
      this.airlines[al].flights++;
      this.market.flightDone(f);
    }
  }

  private onDeparted(f: number): void {
    void f;
  }

  // Daily cycle --------------------------------------------------------------

  /** Called every tick, cheap. Does its work only on day and hour boundaries. */
  update(tick: number): void {
    if (tick % 100 === 0) this.updateServiceLevel();
    if (tick % (60 * TICKS_PER_MINUTE) === 0) this.updateFuel(tick);
    this.finishFixtureWorks(tick);
    if (tick % 10 === 0) for (let i = 0; i < this.serviceNodes.length; i++) serviceUpdate(this.serviceNodes[i]!, tick, this.serviceRng);
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

  private dailyClose(tick: number): void {
    const d = dayIndex(tick);
    if (d === this.day && tick > 0) return;
    // Close the finished day.
    if (tick > 0) {
      this.chargeDaily();
      this.history.push(Float64Array.from(this.today));
      if (this.history.length > LEDGER_DAYS) this.history.shift();
      this.today.fill(0);
      const rated = this.closePax?.() ?? -1;
      if (rated >= 0) this.satisfaction = rated / 100;
      this.updateRating();
      this.bagDayReset?.();
    }
    this.day = d;
    this.updateFire(d);
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
    // The placed series of signed airlines become the day's flights.
    this.market.dailyClose(tick, this.atcOk);
    // Today's flights take free stands now; this runs in the business step, after the airfield copy is current.
    if (this.traffic.autoStands) this.traffic.autoAssign();
    this.version++;
  }

  private chargeDaily(): void {
    const fees = BUSINESS.fees;
    const wages = Math.round((this.staffCount() - this.stationPositions()) * fees.wageStaffPerDay) + (this.staffWages?.() ?? 0);
    this.host.book('wages', -wages);
    // Upkeep: surface percentage of build cost per year, spread over days.
    let upkeep = 0;
    const af = this.airfield.data;
    for (const r of af.runways) upkeep += (r.cost * SURFACE_SPEC[r.surface].upkeepPct) / 100 / 365;
    for (const t of af.taxiways) upkeep += (t.cost * SURFACE_SPEC[t.surface].upkeepPct) / 100 / 365;
    for (const a of af.aprons) upkeep += (a.cost * SURFACE_SPEC[a.surface].upkeepPct) / 100 / 365;
    // Travelators carry no upkeep (owner, 2026-11-23).
    for (const g of this.grids) upkeep += ((g.cost - travelatorCostOf(g)) * 0.5) / 100 / 365;
    upkeep += (this.propCost * BUSINESS.props.upkeepPctPerMonth * 12) / 100 / 365;
    for (const n of this.fleet) upkeep += n * fees.gseUpkeepPerDay;
    for (const b of af.buildings ?? []) upkeep += b.cost * GROUND.buildingUpkeepShare;
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

  /**
   * The rating follows two experiences (user, 2026-11-17). Passengers judge toilets, shops and food,
   * queues (the share of passengers served in time), punctuality and the amenities of the props (T76); airlines judge ground handling
   * support (turnarounds with no vehicle or crew delay), airside infrastructure and punctuality. Cleanliness joins both (T63).
   * Each experience is the mean of its parts, the rating target the mean of the two.
   */
  /** A turnaround's cleaning ended: it counts as clean only with a cleaning depot on the airfield (user, 2026-11-18). */
  cleanedTurnaround(): void {
    const depot = (this.airfield.data.buildings ?? []).some((b) => b.kind === 'cleaning') ? 1 : 0;
    this.cleanScore += (depot - this.cleanScore) * TURNAROUNDS.ratingWeight;
  }

  private updateRating(): void {
    const leased = this.terminals.reduce((n, t) => n + t.leased, 0);
    const hasTerminal = this.terminals.length > 0;
    const toilets = hasTerminal ? Math.min(1, this.toiletServers / BUSINESS.props.toiletServersTarget) : 0;
    const amenities = hasTerminal ? (this.comfortScore + this.ambienceScore) / 2 : 0;
    const shops = hasTerminal ? Math.min(1, leased / 4) : 0;
    const queues = hasTerminal ? this.satisfaction : 0;
    // Missing bags weigh missingBagWeight each against the bags checked today. With none checked the term is a full score.
    const bagScore = Math.max(0, 1 - BAGGAGE.missingBagWeight * (this.bagMissingShare ? this.bagMissingShare() : 0));
    this.paxScore = (toilets + shops + queues + this.onTime + this.cleanScore + bagScore + amenities) / 7;
    const infra = Math.min(1, this.airfield.data.runways.length * 0.5 + (this.airfield.data.stands.length > 3 ? 0.3 : 0.1));
    this.airlineScore = (this.handlingScore + infra + this.onTime + this.cleanScore) / 4;
    const target = 100 * (this.paxScore + this.airlineScore) / 2;
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
        airline: this.airlineLabel(al),
        type: AIRCRAFT[t.type[i]].icaoType,
        status: names[t.state[i]],
        stand: stand ? stand.number : '',
        eta,
        delayMin: f >= 0 ? Math.round(t.fDelay[f] / TICKS_PER_MINUTE) : 0,
        cause: f >= 0 ? t.fCause[f] : 0,
        stageKm: f >= 0 ? t.fStage[f] : 0,
        flight: f,
        standId: t.standId[i],
        turnMin,
        offBlockMin: (eta + turnMin) % MINUTES_PER_DAY,
        typeIdx: t.type[i],
        startMin: f >= 0 ? t.fEta[f] / TICKS_PER_MINUTE : 0,
        intl: f >= 0 && this.market.isInternational(f),
      });
    }
    for (let f = 0; f < 1024 && rows.length < SCHEDULE_ROWS; f++) {
      if (t.fState[f] !== FlState.Scheduled) continue;
      const al = t.fAirline[f];
      const eta = minuteOfDay(t.fEta[f]);
      const turnMin = Math.round(t.fTurn[f] / TICKS_PER_MINUTE);
      rows.push({
        airline: this.airlineLabel(al),
        type: AIRCRAFT[t.fType[f]].icaoType,
        status: 'scheduled',
        stand: '',
        eta,
        delayMin: Math.round(t.fDelay[f] / TICKS_PER_MINUTE),
        cause: 0,
        stageKm: t.fStage[f],
        flight: f,
        standId: t.fStand[f],
        turnMin,
        offBlockMin: (eta + turnMin) % MINUTES_PER_DAY,
        typeIdx: t.fType[f],
        startMin: t.fEta[f] / TICKS_PER_MINUTE,
        intl: this.market.isInternational(f),
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

  payload(tick: number): Omit<BusinessPayload, 'baggage'> {
    const stands = this.airfield.data.stands;
    const staffing = this.staffRows?.() ?? [];
    return {
      board: this.board(tick),
      series: this.market.series,
      destinations: this.market.destinations,
      stars: this.stars(),
      paxScore: Math.round(this.paxScore * 100),
      airlineScore: Math.round(this.airlineScore * 100),
      paxDay: this.paxDay?.() ?? [],
      arrDay: this.arrDay?.() ?? [],
      standLinked: stands.map((_, i) => (this.traffic.standLinkedPublic(i) ? 1 : 0)),
      standContact: stands.map((st) => (st.type !== 'contact' || this.hasTerminalNear(st.x, st.y) ? 1 : 0)),
      gateDesks: this.deskList().map((d) => ({ building: d.building, x: d.x, y: d.y })),
      standGate: stands.map((st) => {
        const d = this.gateFor(st);
        return d ? this.deskList().indexOf(d) : -1;
      }),
      standFar: stands.map((st) => {
        const d = this.gateFor(st);
        return d && Math.hypot(d.wx - st.x, d.wy - st.y) > STAND_ACCESS.stairsWalkLimitM ? 1 : 0;
      }),
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
      staff: Math.round(this.staffCount() - this.stationPositions()) + staffing.reduce((n, r) => n + r.hired, 0),
      staffing,
      weather: this.weather,
      readiness: this.readiness(),
      autoStands: this.traffic.autoStands,
      fleet: this.fleet,
      fuelStockL: Math.round(this.fuelStockL),
      fuelCapacityL: this.fuelCapacityL(),
      fuelInboundL: this.fuelOrders.reduce((sum, v, i) => (i % 2 === 1 ? sum + v : sum), 0),
      fireCategory: this.traffic.fireCategory,
      fireGraceDays: Math.max(0, this.fireGraceUntil - this.day),
      serviceSlowdown: this.traffic.serviceSlowdown,
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
      fleet: this.fleet, fuelStockL: this.fuelStockL, fuelOrders: this.fuelOrders, fireGraceUntil: this.fireGraceUntil, version: this.version, grids: this.grids.map(saveGrid), airlines: this.airlines, rating: this.rating, satisfaction: this.satisfaction,
      onTime: this.onTime, cleanScore: this.cleanScore, handlingScore: this.handlingScore, loan: this.loan, loanOriginal: this.loanOriginal, weather: this.weather, weatherStart: this.weatherStart,
      weatherEnd: this.weatherEnd, pendingKind: this.pendingKind, nextTerminalId: this.nextTerminalId, day: this.day,
      today: Array.from(this.today), history: this.history.map((h) => Array.from(h)), paxToday: this.paxToday,
      flightsToday: this.flightsToday, lostToday: this.lostToday,
      flightPax: packTyped(this.flightPax), flightDockedAt: packTyped(this.flightDockedAt),
      rng: this.rng.getState(), marketRng: this.marketRng.getState(), market: this.market.saveState(),
      service: this.serviceNodes.map(serviceSave), serviceRng: this.serviceRng.getState(), fixtureWorks: this.fixtureWorks.map((w) => ({ ...w })),
    };
  }

  loadState(raw: unknown): void {
    const o = raw as {
      version: number; grids: SavedGrid[]; airlines: Airline[]; rating: number; satisfaction: number; onTime: number; loan: number;
      loanOriginal: number; weather: WeatherKind; weatherStart: number; weatherEnd: number; pendingKind: WeatherKind; nextTerminalId: number;
      day: number; today: number[]; history: number[][]; paxToday: number; flightsToday: number; lostToday: number;
      flightPax: string; flightDockedAt: string; rng: number; marketRng: number;
      service?: ServiceSave[]; serviceRng?: number;
    };
    const fl = (raw as { fleet?: number[] }).fleet;
    if (fl && fl.length === this.fleet.length) this.fleet = fl.slice();
    const fu = raw as { fuelStockL?: number; fuelOrders?: number[]; fireGraceUntil?: number };
    this.fuelStockL = fu.fuelStockL ?? 0;
    this.fuelOrders = (fu.fuelOrders ?? []).slice();
    this.fireGraceUntil = fu.fireGraceUntil ?? GROUND.fire.graceDays;
    this.grids.length = 0;
    for (const sg of o.grids) this.grids.push(loadGrid(sg));
    this.walkGraphs.length = 0;
    for (const g of this.grids) this.walkGraphs.push(buildWalkGraph(g));
    this.walkVersion++;
    this.serviceNodes.length = 0;
    this.fixtureWorks = ((raw as { fixtureWorks?: FixtureWorks[] }).fixtureWorks ?? []).map((w) => ({ ...w }));
    for (let i = 0; i < this.grids.length; i++) this.serviceNodes.push(buildServiceNodes(this.grids[i]!, this.walkGraphs[i]!, this.closedCells(this.grids[i]!)));
    const savedService = o.service ?? [];
    for (let i = 0; i < this.serviceNodes.length; i++) if (savedService[i]) serviceLoad(this.serviceNodes[i]!, savedService[i]!);
    if (o.serviceRng !== undefined) this.serviceRng.setState(o.serviceRng);
    this.serviceVersion++;
    this.airlines.length = 0;
    this.airlines.push(...o.airlines);
    this.market.loadState((raw as { market: unknown }).market);
    this.rating = o.rating;
    this.satisfaction = o.satisfaction;
    this.onTime = o.onTime;
    const sc = raw as { cleanScore?: number; handlingScore?: number };
    this.cleanScore = sc.cleanScore ?? 1;
    this.handlingScore = sc.handlingScore ?? 1;
    this.loan = o.loan;
    this.loanOriginal = o.loanOriginal;
    this.weather = o.weather;
    this.traffic.setWeather(o.weather);
    this.weatherStart = o.weatherStart;
    this.weatherEnd = o.weatherEnd;
    this.pendingKind = o.pendingKind;
    this.nextTerminalId = o.nextTerminalId;
    this.day = o.day;
    this.today.set(o.today.slice(0, this.today.length));
    this.history.length = 0;
    // Older ledgers have fewer categories; the missing ones count zero.
    for (const h of o.history) {
      const row = new Float64Array(this.today.length);
      row.set(h.slice(0, row.length));
      this.history.push(row);
    }
    this.paxToday = o.paxToday;
    this.flightsToday = o.flightsToday;
    this.lostToday = o.lostToday;
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
    acc = foldU32(acc, Math.floor(this.cleanScore * 10000));
    acc = foldU32(acc, Math.floor(this.handlingScore * 10000));
    for (const a of this.airlines) acc = foldU32(acc, a.pax);
    acc = this.market.hash(acc);
    for (const g of this.grids) {
      acc = foldU32(foldU32(foldU32(foldU32(acc, g.id), cellCount(g)), g.building), g.level - TERMINAL_LEVEL_MIN);
      for (let i = 0; i < g.fixture.length; i++) {
        if (g.fixture[i] === 0) continue;
        const c = cellOf(g, i);
        acc = foldU32(foldU32(foldU32(acc, c.x + 65536), c.y + 65536), g.fixture[i]);
        // The pairing of two cell fixtures is state. Only nonzero footprints hash, so layouts without them keep their hash.
        if (g.fixtureRot[i] !== 0) acc = foldU32(foldU32(acc, i), g.fixtureRot[i]);
        // Level and mode only hash when they differ from the defaults, so older layouts keep their hash.
        if (g.fixtureLevel[i] > 1 || g.fixtureMode[i] > 0) acc = foldU32(foldU32(acc, g.fixtureLevel[i]), g.fixtureMode[i]);
      }
    }
    // Props hash in placement order (T76). Grids without props keep their hash.
    for (const g of this.grids) {
      for (const p of g.props) acc = foldU32(foldU32(foldU32(foldU32(acc, propHashId(p.asset)), Math.round(p.x * 2) + 65536), Math.round(p.y * 2) + 65536), p.rot);
    }
    for (const w of this.fixtureWorks) acc = foldU32(foldU32(foldU32(foldU32(foldU32(acc, w.building), w.x + 65536), w.y + 65536), w.to), w.doneTick % 0xffffffff);
    // Queues only enter the hash once someone waits, so idle games keep their hashes.
    if (this.serviceNodes.some((sn) => sn.active > 0 || sn.evictedCount > 0)) {
      for (const sn of this.serviceNodes) {
        acc = foldU32(acc, sn.count);
        for (let k = 0; k < sn.count; k++) {
          acc = foldU32(foldU32(foldU32(foldU32(foldU32(acc, sn.kind[k]!), sn.queueLen[k]!), sn.busyUntil[k]!), sn.serving[k]!), sn.servingSize[k]!);
          // The ring in queue order, so the same people in a different order hash differently.
          for (let q = 0; q < sn.qCount[k]!; q++) {
            const slot = k * sn.slots + ((sn.qHead[k]! + q) % sn.slots);
            acc = foldU32(foldU32(acc, sn.qCohort[slot]!), sn.qSize[slot]!);
          }
        }
        acc = foldU32(acc, sn.evictedCount);
        for (let e = 0; e < sn.evictedCount; e++) acc = foldU32(acc, sn.evicted[e]!);
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
  /** Props, since version 36 (T76). */
  props?: Prop[];
  ox: number;
  oy: number;
  headingDeg: number;
  floor: string;
  zone?: string;
  fixture: string;
  fixtureRot: string;
  fixtureOff?: string;
  fixtureLevel?: string;
  fixtureMode?: string;
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

/** A stable 32 bit number for a prop asset id, folded character by character. */
function propHashId(asset: string): number {
  let h = 0;
  for (let i = 0; i < asset.length; i++) h = foldU32(h, asset.charCodeAt(i));
  return h;
}
/** Size of the fixed grid that saves before format 6 used. */
const LEGACY_GRID = 160;

function saveGrid(g: TerminalGrid): SavedGrid {
  return { id: g.id, building: g.building, level: g.level, ox: g.ox, oy: g.oy, headingDeg: g.headingDeg, x0: g.x0, y0: g.y0, w: g.w, h: g.h, floor: packTyped(g.floor), zone: packTyped(g.zone), fixture: packTyped(g.fixture), fixtureRot: packTyped(g.fixtureRot), fixtureOff: packTyped(g.fixtureOff), fixtureLevel: packTyped(g.fixtureLevel), fixtureMode: packTyped(g.fixtureMode), hWall: packTyped(g.hWall), vWall: packTyped(g.vWall), leased: packTyped(g.leased), cost: g.cost, props: g.props.map((p) => ({ ...p })) };
}

function loadGrid(sg: SavedGrid): TerminalGrid {
  const g = newGrid(sg.id, sg.ox, sg.oy, sg.headingDeg);
  g.building = sg.building ?? sg.id;
  g.level = sg.level ?? 0;
  const x0 = sg.x0 ?? 0;
  const y0 = sg.y0 ?? 0;
  const w = sg.w ?? LEGACY_GRID;
  const h = sg.h ?? LEGACY_GRID;
  Object.assign(g, { x0, y0, w, h, floor: new Uint8Array(w * h), zone: new Uint8Array(w * h), fixture: new Uint8Array(w * h), fixtureRot: new Uint8Array(w * h), fixtureOff: new Uint8Array(w * h), fixtureLevel: new Uint8Array(w * h), fixtureMode: new Uint8Array(w * h), leased: new Uint8Array(w * h), hWall: new Uint8Array((h + 1) * w), vWall: new Uint8Array(h * (w + 1)) });
  unpackInto(sg.floor, g.floor, Uint8Array);
  if (sg.zone) unpackInto(sg.zone, g.zone, Uint8Array);
  unpackInto(sg.fixture, g.fixture, Uint8Array);
  unpackInto(sg.fixtureRot, g.fixtureRot, Uint8Array);
  if (sg.fixtureOff) unpackInto(sg.fixtureOff, g.fixtureOff, Uint8Array);
  if (sg.fixtureLevel) unpackInto(sg.fixtureLevel, g.fixtureLevel, Uint8Array);
  if (sg.fixtureMode) unpackInto(sg.fixtureMode, g.fixtureMode, Uint8Array);
  unpackInto(sg.hWall, g.hWall, Uint8Array);
  unpackInto(sg.vWall, g.vWall, Uint8Array);
  unpackInto(sg.leased, g.leased, Uint8Array);
  g.cost = sg.cost;
  g.props = (sg.props ?? []).map((p) => ({ ...p }));
  return g;
}

