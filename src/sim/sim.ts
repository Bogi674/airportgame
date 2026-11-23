import { AIRCRAFT } from '@data/aircraft';
import { GROUND, GSE, STAND_ACCESS } from '@data/index';
import { STAFF_ROLE_COUNT } from '@data/schemas/staff';
import { ACCEPT_COMMERCIAL, STAND_UPGRADE, type AirfieldPayload, type Stand } from '@shared/airfield';
import { isVehicleCause, VEHICLE_CAUSE } from '@shared/turnaround';
import { sizeForCode } from '@shared/standSizes';
import { ParcelType, START_CASH } from '@shared/site';
import type { BuildContext } from '@shared/validate';
import { checkRunwayObstacles } from '@shared/obstacles';
import type { GameOptions } from '@shared/protocol';
import type { OverlayData } from '@shared/overlay';
import { Gse, MAX_VEHICLES } from './vehicles/gse';
import { RoadNet } from './vehicles/roads';
import { SnapHeader, SNAPSHOT_VERSION, type SnapshotViews } from '@shared/snapshot';
import { TICK_SECONDS } from '@shared/time';
import { CommandLog, type Command } from './commands';
import { Airfield, isProblem } from './airfield/airfield';
import { DIVERT_AIRLINE, FlState, GA_AIRLINE, Traffic } from './ops/traffic';
import { Director, type DirectorSave } from './events/director';
import { BOARDING, Turnarounds, TURN_STEP } from './ops/turnaround';
import { Business } from './business/business';
import { Cohorts, DAY, type CohortsSave } from './cohorts/cohorts';
import { Staff, type StaffSave } from './staff/staff';
import { writeCrewSample } from './staff/crewSample';
import { Cleaning, type CleaningSave } from './staff/cleaning';
import { Baggage, BAG_RUN_TICKS, BagStage, type BaggageSave } from './ops/baggage/baggage';
import { ATC_MIN_CELLS, TICKS_PER_DAY, type BusinessPayload, type LedgerCategory, type TerminalGrid } from '@shared/business';
import { towerLevelOf } from '@shared/towerBudget';
import { generateSite, type SiteSpec } from './world/site';
import { foldInts, foldU32, HASH_INIT } from './hash';
import { Rng } from './rng';
import { packTyped, unpackInto } from './save/pack';
import { migrate, SAVE_VERSION, type SaveData } from './save/migrations';

/** Subsystems in execution order. The stress tool times each one separately. */
const SUBSYSTEMS = ['commands', 'clock', 'network', 'business', 'cohorts', 'baggage', 'flights', 'aircraft', 'vehicles'] as const;
export type SubsystemName = (typeof SUBSYSTEMS)[number];

/**
 * The last closed passenger day as the finance sheet shows it (BusinessPayload.paxDay), read from the DAY counters
 * of cohorts.ts. Empty while no passenger was rated, which is the case right after a restore until the next daily close.
 */
function paxDayNumbers(day: Float64Array): number[] {
  const rated = day[DAY.SatCount]!;
  if (rated <= 0) return [];
  const round = (v: number): number => Math.round(v * 10) / 10;
  const out = [DAY.SatSum, DAY.PenQueue, DAY.PenWalk, DAY.PenUnmet, DAY.PenMissed].map((k) => round(day[k]! / rated));
  for (let k = DAY.Visits0; k < DAY.Spend; k++) out.push(round(day[k]!));
  out.push(round(day[DAY.Spend]!));
  return out;
}

/**
 * The last closed arrival day as the finance sheet shows it (BusinessPayload.arrDay): passengers exited, stranded,
 * mean claim wait in game minutes and passengers without their bags. Empty while no arrival finished its journey.
 */
function arrDayNumbers(day: Float64Array): number[] {
  if (day[DAY.ArrExited]! + day[DAY.ArrStranded]! <= 0) return [];
  const round = (v: number): number => Math.round(v * 10) / 10;
  const wait = day[DAY.ClaimCount]! > 0 ? round(day[DAY.ClaimWaitS]! / day[DAY.ClaimCount]! / 60) : 0;
  return [day[DAY.ArrExited]!, day[DAY.ArrStranded]!, wait, day[DAY.NoBags]!];
}

/**
 * The simulation core. Pure TypeScript with no DOM and no wall clock, so the same seed
 * and the same commands always give the same result.
 */
export class Sim {
  readonly seed: string;
  readonly options: GameOptions;
  readonly log = new CommandLog();
  readonly rng: Rng;
  readonly site: SiteSpec;
  readonly airfield = new Airfield();
  readonly traffic: Traffic;
  readonly business: Business;
  readonly cohorts: Cohorts;
  /** Baggage nodes and their automatic link network, one per building (T43). */
  readonly baggage: Baggage;
  /** Airport staff as individuals (T68). */
  readonly staff: Staff;
  /** Terminal dirt per room that cleaners keep low (T81). */
  readonly cleaning: Cleaning;
  /** The seeded event director and its deck (T50). */
  readonly director: Director;
  /** True while a save is restored, so derived event effects do not schedule work the uninterrupted run did not have. */
  private restoring = false;
  private readonly divertTypes: number[] = [];
  readonly gse: Gse;
  /** Turnaround task lists of airline flights (T63). */
  readonly turns: Turnarounds;
  /** Service road graph and the vehicle routes on it, derived from the airfield (T60). */
  readonly roads = new RoadNet();
  /** Airfield and ground versions the road net was built for, and the depots counted then. */
  private roadSeen = [-1, -1, -1];
  private depotsSeen = 0;
  private businessSent = -1;
  private gridsSent = -1;
  private bagDrawSent = -1;
  private businessSentTick = -1000000;
  /** Airfield version of the last business payload, whose stand link and contact facts follow the airfield. */
  private businessAirfield = -1;
  private airfieldSent = -1;
  private obstaclesSent = -1;
  private towersSent = -1;
  private groundSent = -1;
  private networkVersion = -1;
  /** Set by a stand command. The automatic assigner runs once in the next airfield sync. It is clear at every save point. */
  private standsDirty = false;
  /** Bumped whenever the player buys land, which clears the cover on it. */
  private ownerVersion = 0;
  /** Airfield, terminal and ownership versions last looked at, and the inputs the results are for. */
  private readonly obstacleSeen = [-1, -1, -1];
  private obstacleKey = '';
  /** Owner per parcel: 0 none, 1 the player. */
  readonly parcelOwner: Uint8Array;
  cash: number;
  /** Set when ownership or cash changed since the last `takeOwnershipDirty`. */
  private ownershipDirty = true;
  private readonly eventQueue: string[] = [];

  tick = 0;
  /** Game seconds since start. */
  gameSeconds = 0;

  private readonly pending: Command[] = [];

  constructor(seed: string, options: GameOptions) {
    this.seed = seed;
    this.options = options;
    this.rng = Rng.fromString(seed);
    this.site = generateSite(seed, options.preset);
    this.parcelOwner = new Uint8Array(this.site.parcelCount);
    for (let i = 0; i < this.site.startParcels.length; i++) this.parcelOwner[this.site.startParcels[i]] = 1;
    this.cash = START_CASH;
    // The business keeps the ledger, so every cash change goes through `book`.
    this.traffic = new Traffic({ windFreq: this.site.wind.freq, windMeanKt: this.site.wind.meanKt, climate: this.site.climate, idealHeadingDeg: this.site.idealHeadingDeg }, this.rng, (code) => this.eventQueue.push(code));
    const host = {
      getCash: (): number => this.cash,
      book: (category: LedgerCategory, amount: number): void => this.book(category, amount),
      emit: (code: string): void => {
        this.eventQueue.push(code);
      },
    };
    this.business = new Business(this.site, this.rng, host, this.traffic, this.airfield);
    this.gse = new Gse(this.traffic, {
      roads: this.roads,
      standIndexOf: (a) => this.airfield.data.stands.findIndex((s) => s.id === this.traffic.standId[a]),
      cartsFor: (a) => {
        const st = this.airfield.data.stands.find((s) => s.id === this.traffic.standId[a]);
        return GROUND.cartsPerTrain[st ? st.size : sizeForCode(AIRCRAFT[this.traffic.type[a]].derivedForReading.code)];
      },
      upgradesOf: (a) => this.airfield.data.stands.find((s) => s.id === this.traffic.standId[a])?.upgrades ?? 0,
      boardingOf: (a) => {
        const st = this.airfield.data.stands.find((s) => s.id === this.traffic.standId[a]);
        return st ? this.boardingMode(st, this.traffic.flight[a]) : BOARDING.near;
      },
      owned: (k) => this.business.available(k),
      cateringTrucks: () => (this.airfield.data.buildings ?? []).filter((b) => b.kind === 'catering').length * GROUND.catering.trucks,
      trips: {
        frame: (b) => this.baggage.bayFrameOf((this.airfield.data.bayAnchors ?? [])[b]?.bay ?? -1),
        serialOf: (a) => (this.traffic.flight[a] >= 0 ? this.traffic.serialOf(this.traffic.flight[a]) : 0),
        ready: (a) => {
          const f = this.traffic.flight[a];
          return f >= 0 && this.baggage.loadReady(this.traffic.serialOf(f), this.tick, this.traffic.fEta[f] + this.traffic.fTurn[f]);
        },
        unloadDone: (a) => this.turns.unloadDone(a),
        bags: (serial, arrival) => this.baggage.bagsOf(serial, arrival ? BagStage.TrainIn : BagStage.Bay),
        pickUp: (serial) => this.baggage.pickUp(serial),
        putBack: (serial) => this.baggage.putBack(serial),
        dropOff: (serial, force) => this.baggage.dropOff(serial, force),
      },
    });
    this.turns = new Turnarounds(this.traffic, this.gse);
    this.gse.turns = this.turns;
    this.turns.cleaned = () => this.business.cleanedTurnaround();
    this.turns.crewPool = () => this.staff.rampCrews();
    this.cohorts = new Cohorts(this.rng, this.business, this.traffic);
    this.business.boarded = (f) => this.cohorts.boardedFor(f);
    this.business.gridRemoved = (g) => this.cohorts.onGridRemoved(g);
    this.business.closePax = () => this.cohorts.closeDay();
    this.business.paxDay = () => paxDayNumbers(this.cohorts.lastDay);
    this.business.arrDay = () => arrDayNumbers(this.cohorts.lastDay);
    this.baggage = new Baggage(this.business, {
      getCash: (): number => this.cash,
      book: (amount: number): void => this.book('construction', amount),
      standExists: (id: number): boolean => this.airfield.data.stands.some((s) => s.id === id),
      standOfSerial: (serial: number): number => {
        const f = this.traffic.flightOfSerial(serial);
        return f < 0 ? -2 : this.traffic.fStand[f];
      },
      bayConnected: (id: number): boolean => this.roads.bayConnected((this.airfield.data.bayAnchors ?? []).findIndex((a) => a.bay === id)),
    }, this.rng);
    this.staff = new Staff(this.business, this.baggage, this.airfield);
    this.cleaning = new Cleaning(this.business, this.cohorts);
    this.staff.cleaning = this.cleaning;
    this.business.terminalClean = () => this.cleaning.cleanliness;
    this.director = new Director(this.rng, {
      emit: (code) => this.eventQueue.push(code),
      book: (category, amount) => this.book(category, amount),
      getCash: () => this.cash,
      climate: () => this.site.climate,
      has: (req) => {
        switch (req) {
          case 'fuelFarm':
            return this.business.fuelCapacityL() > 0;
          case 'vehicle':
            return GSE.some((_, k) => this.business.available(k) > 0);
          case 'airline':
            return this.business.airlines.some((a) => a.signed);
          case 'diversionType':
            this.traffic.diversionTypes(this.divertTypes);
            return this.divertTypes.length > 0;
          case 'staff':
            for (let r = 0; r < STAFF_ROLE_COUNT; r++) if (this.staff.hired(r) > 0) return true;
            return false;
          default:
            return false;
        }
      },
      pick: (req, rng) => {
        const out: number[] = [];
        if (req === 'vehicle') {
          for (let k = 0; k < GSE.length; k++) if (this.business.available(k) > 0) out.push(k);
        } else if (req === 'airline') {
          for (const a of this.business.airlines) if (a.signed) out.push(a.id);
        } else if (req === 'diversionType') this.traffic.diversionTypes(out);
        return out.length === 0 ? -1 : out[rng.int(0, out.length - 1)]!;
      },
      label: (req, arg) => {
        if (req === 'vehicle') return (GSE[arg]?.name ?? '').toLowerCase();
        if (req === 'airline') return this.business.airlines.find((a) => a.id === arg)?.name ?? '';
        return AIRCRAFT[arg]?.name ?? '';
      },
      startWeather: (kind, ticks) => this.business.setWeather(kind, ticks),
      weatherActive: () => this.business.weather !== 'clear',
      apply: (fx) => {
        this.business.fuelHeldUntil = fx.fuelHeldUntil;
        this.business.vehiclesOut = fx.vehiclesOut;
        this.traffic.weatherSeverity = fx.weatherSeverity;
        this.staff.setShortage(fx.staffShort, !this.restoring);
      },
      addAirlineSatisfaction: (id, points) => this.business.market.addHappiness(id, points),
      divert: (type, eta, hold) => {
        const f = this.traffic.scheduleArrival(type, eta, 0, hold, DIVERT_AIRLINE);
        return f < 0 ? -1 : this.traffic.serialOf(f);
      },
      wagesPerDay: () => this.staff.wagesPerDay(),
      changed: () => this.business.version++,
    });
    this.business.newDay = (tick) => this.director.newDay(tick);
    this.business.diversionFee = (f) => this.director.takeFee(this.traffic.serialOf(f));
    this.baggage.machineStaffed = (id) => this.staff.machineOn(id);
    this.business.staffWages = () => this.staff.wagesPerDay();
    this.business.staffRows = () => this.staff.rows();
    this.business.onGridEdited = (b) => this.baggage.onGridEdited(b);
    this.business.bagMissingShare = () => this.baggage.missingShare();
    this.business.bagDayReset = () => this.baggage.resetDay();
    this.cohorts.onCheckIn = (gridId, cell, serial, bags) => this.baggage.checkIn(gridId, cell, serial, bags);
    this.cohorts.bagLookup = this.baggage;
    this.turns.bagsReady = (f) => this.baggage.loadReady(this.traffic.serialOf(f), this.tick, this.traffic.fEta[f] + this.traffic.fTurn[f]);
    this.turns.loaded = (f) => this.baggage.freeFlight(this.traffic.serialOf(f));
    this.turns.unloaded = (f) => {
      const serial = this.traffic.serialOf(f);
      // The train takes the bags to the bay when it can make the trip; otherwise they are lost (T78, owner: strict).
      const onTrain = this.traffic.fAc[f] >= 0 && this.gse.sendArrival(this.traffic.fAc[f], serial);
      this.baggage.unloaded(serial, this.business.flightPaxOf(f), this.tick, onTrain);
    };
    const businessPushback = this.traffic.hooks?.pushback;
    const businessDocked = this.traffic.hooks?.docked;
    this.traffic.hooks = {
      ...(this.traffic.hooks ?? { docked: () => undefined, pushback: () => undefined, departed: () => undefined }),
      docked: (f) => {
        businessDocked?.(f);
        this.cohorts.onDocked(f, this.tick, this.dockedBoarding(f));
        this.warnNoRoad(f);
        this.warnFarStand(f);
        this.fuelAtDock(f);
      },
      fuelReady: (i) => {
        // Fuel delivered since the aircraft docked is pumped as soon as it is in the tanks.
        this.traffic.fuelOwed[i] -= this.business.drawFuel(this.traffic.fuelOwed[i]);
        return this.traffic.fuelOwed[i] <= 0;
      },
      contactOk: (x, y) => this.business.hasTerminalNear(x, y),
      scheduled: (f) => this.cohorts.onScheduled(f, this.tick),
      boardingReady: (f) => this.cohorts.boardingReady(f),
      turnDone: (i) => this.turns.done[i] === 1 && this.turns.flightOf[i] === this.traffic.flight[i],
      crewGone: (i) => this.gse.crewGone(i),
      blocker: (i) => this.turns.blocker(i),
      delayCause: (_f, c) => this.warnNoVehicle(c),
      // The business settles the flight first, then the passengers still in the terminal miss it.
      pushback: (f) => {
        businessPushback?.(f);
        this.cohorts.onPushback(f);
        this.baggage.freeFlight(this.traffic.serialOf(f));
      },
    };
  }

  /** Changes cash and records it in today's ledger. */
  book(category: LedgerCategory, amount: number): void {
    this.cash += amount;
    this.business.record(category, amount);
    this.ownershipDirty = true;
  }

  get subsystemCount(): number {
    return SUBSYSTEMS.length;
  }

  subsystemName(index: number): SubsystemName {
    return SUBSYSTEMS[index];
  }

  get standsFree(): number {
    return this.traffic.standsFree;
  }

  get aircraftCount(): number {
    return this.traffic.count;
  }

  /** Queues a command. It is applied and logged at the start of the next tick. */
  enqueue(cmd: Command): void {
    this.pending.push(cmd);
  }

  /** Runs one full tick. */
  step(): void {
    for (let i = 0; i < SUBSYSTEMS.length; i++) this.runSubsystem(i);
    this.endTick();
  }

  /** Runs one subsystem of the current tick. Callers must run all of them in order, then `endTick`. */
  runSubsystem(index: number): void {
    switch (index) {
      case 0:
        this.applyPending();
        break;
      case 1:
        this.gameSeconds += TICK_SECONDS;
        break;
      case 2:
        if (this.airfield.update(this.tick)) this.standsDirty = true;
        this.updateObstacles();
        this.syncAirfield();
        break;
      case 3:
        this.staff.update(this.tick);
        this.business.update(this.tick);
        this.director.update(this.tick);
        break;
      case 4:
        this.cohorts.update(this.tick);
        break;
      case 5:
        if (this.tick % BAG_RUN_TICKS === 0) this.baggage.update(this.tick);
        break;
      case 6:
        if (this.tick % 10 === 0) {
          this.traffic.updateFlights(this.tick);
          this.traffic.updateGa(this.tick);
        }
        break;
      case 7:
        this.traffic.update(this.tick);
        break;
      case 8:
        this.gse.update();
        if (this.tick % TURN_STEP === 0) this.turns.update();
        break;
    }
  }

  /**
   * Applies queued commands without advancing time, so builds work while paused. They are
   * logged at the current tick and replay applies them at the start of that same tick.
   */
  flushCommands(): void {
    this.applyPending();
    this.syncAirfield();
  }

  /**
   * Brings traffic in line with the airfield and runs a pending automatic stand pass. Both the tick and the paused
   * flush call it, so the standsDirty flag is always clear at a save point.
   */
  private syncAirfield(): void {
    if (this.networkVersion !== this.airfield.version) {
      this.networkVersion = this.airfield.version;
      this.traffic.setAirfield(this.airfield.data);
    }
    this.syncRoads(false);
    if (this.standsDirty) {
      this.standsDirty = false;
      if (this.traffic.autoStands) this.traffic.autoAssign();
    }
  }

  /**
   * Rebuilds the road net after the airfield or the roads changed, and gives traffic the no road penalty per
   * stand. A new depot brings its starter vehicles and a removed one takes them back, so undo is exact;
   * a restore only counts the depots, as their vehicles are in the saved fleet.
   */
  private syncRoads(restoring: boolean): void {
    this.syncBayAnchors();
    if (this.roadSeen[0] === this.airfield.version && this.roadSeen[1] === this.airfield.groundVersion && this.roadSeen[2] === this.standBayKeyStamp) return;
    this.roadSeen[0] = this.airfield.version;
    this.roadSeen[1] = this.airfield.groundVersion;
    this.roadSeen[2] = this.standBayKeyStamp;
    const af = this.airfield.data;
    this.roads.rebuild(af, this.traffic.net, this.standBayIndex(af));
    const factor = new Float64Array(af.stands.length);
    for (let s = 0; s < factor.length; s++) factor[s] = this.roads.standRoad[s] === 1 ? 1 : GROUND.noRoadTurnaroundFactor;
    this.traffic.standRoadFactor = factor;
    this.syncRamp(af);
    const depots = af.depots?.length ?? 0;
    if (!restoring && depots !== this.depotsSeen) this.business.depotsChanged(depots - this.depotsSeen);
    this.depotsSeen = depots;
    this.business.depotCapacity = depots * GROUND.depot.capacity;
    this.business.refreshFire();
  }

  /** Hands the staff the apron crew pool: the lowest id depot and the commercial stands a depot reaches (T81). */
  private syncRamp(af: AirfieldPayload): void {
    let depot = -1;
    let x = 0;
    let y = 0;
    for (const d of af.depots ?? []) {
      if (depot >= 0 && d.id >= depot) continue;
      depot = d.id;
      x = d.x;
      y = d.y;
    }
    let stands = 0;
    for (let s = 0; s < af.stands.length; s++) if (this.roads.standRoad[s] === 1 && (af.stands[s]!.accepts & ACCEPT_COMMERCIAL) !== 0) stands++;
    this.staff.setRamp(depot, x, y, stands);
  }

  /** Baggage layout stamp the bay anchors were last taken at, the stand to bay key, and a counter bumped when that key changes. */
  private bagRoadStamp = -1;
  private standBayKey = '';
  private standBayKeyStamp = 0;

  /**
   * Hands the bays' road connection points to the airfield after a baggage edit, and notes when a stand changed bay,
   * so the road net rebuilds only when the bays or the assignments really changed (T78).
   */
  private syncBayAnchors(): void {
    const stamp = this.baggage.drawVersion();
    if (stamp === this.bagRoadStamp) return;
    this.bagRoadStamp = stamp;
    this.airfield.setBayAnchors(this.baggage.bayAnchors());
    const key = this.airfield.data.stands.map((s) => this.baggage.bayOfStand(s.id) ?? -1).join(',');
    if (key !== this.standBayKey) {
      this.standBayKey = key;
      this.standBayKeyStamp++;
    }
  }

  /** Per stand index, the index of its bay in `af.bayAnchors`, or -1. */
  private standBayIndex(af: AirfieldPayload): Int32Array {
    const anchors = af.bayAnchors ?? [];
    return Int32Array.from(af.stands, (s) => {
      const bay = this.baggage.bayOfStand(s.id);
      return bay === null ? -1 : anchors.findIndex((a) => a.bay === bay);
    });
  }

  /**
   * An airline flight that docks takes its type's fuel from the farms (T65, D19, user: fixed liters per type).
   * Without a farm fuel stays outside the game, as before; with one, what the stock cannot give is owed and holds the flight.
   */
  private fuelAtDock(f: number): void {
    if (this.traffic.fAirline[f] === GA_AIRLINE || this.business.fuelCapacityL() === 0) return;
    const a = this.traffic.fAc[f];
    if (a < 0) return;
    const need = GROUND.fuel.upliftL[AIRCRAFT[this.traffic.fType[f]].id] ?? 0;
    const owed = need - this.business.drawFuel(need);
    this.traffic.fuelOwed[a] = owed;
    if (owed > 0) this.eventQueue.push(`fuelShort|type=${AIRCRAFT[this.traffic.fType[f]].id}`);
  }

  /** Day each stand last warned that it has no service road, so the alert asks once a day per stand. */
  private noRoadWarned = new Map<number, number>();
  private noVehicleWarned = new Map<number, number>();

  /** A commercial flight docked at a stand no depot reaches: the turnaround runs slower and an alert asks for a road (D2 as revised 2026-11-16). */
  private warnNoRoad(f: number): void {
    if (this.traffic.fAirline[f] === GA_AIRLINE) return;
    const id = this.traffic.fStand[f];
    const s = this.airfield.data.stands.findIndex((x) => x.id === id);
    if (s < 0 || this.roads.standRoad[s] === 1) return;
    const day = Math.floor(this.tick / TICKS_PER_DAY);
    if (this.noRoadWarned.get(id) === day) return;
    this.noRoadWarned.set(id, day);
    this.eventQueue.push(`noServiceRoad|stand=${this.airfield.data.stands[s].number}`);
  }

  private farStandWarned = new Map<number, number>();

  /**
   * How a flight at a stand boards (T66): a stand farther than the stairs walk limit from its gate desk needs a bus
   * from a bus bay, or boards slower without one. General aviation, stands with no gate desk and near stands board as before.
   */
  private boardingMode(stand: Stand, f: number): number {
    if (f < 0 || this.traffic.fAirline[f] === GA_AIRLINE) return BOARDING.near;
    const desk = this.business.gateFor(stand);
    if (!desk || Math.hypot(desk.wx - stand.x, desk.wy - stand.y) <= STAND_ACCESS.stairsWalkLimitM) return BOARDING.near;
    return ((stand.upgrades ?? 0) & STAND_UPGRADE.busBay) !== 0 ? BOARDING.bus : BOARDING.farSlow;
  }

  /** How the flight at its stand boards, near when it has no stand. */
  private dockedBoarding(f: number): number {
    const stands = this.airfield.data.stands;
    for (let i = 0; i < stands.length; i++) if (stands[i]!.id === this.traffic.fStand[f]) return this.boardingMode(stands[i]!, f);
    return BOARDING.near;
  }

  /** A flight docks at a far stand with no bus bay: boarding runs slower and an alert asks for a bus bay, once a game day per stand. */
  private warnFarStand(f: number): void {
    const stand = this.airfield.data.stands.find((x) => x.id === this.traffic.fStand[f]);
    if (!stand || this.boardingMode(stand, f) !== BOARDING.farSlow) return;
    const day = Math.floor(this.tick / TICKS_PER_DAY);
    if (this.farStandWarned.get(stand.id) === day) return;
    this.farStandWarned.set(stand.id, day);
    this.eventQueue.push(`standNeedsBusBay|stand=${stand.number}`);
  }

  /** Tells the player once a game day per kind when an airline flight waits for a vehicle kind the airport owns none of (T63). */
  private warnNoVehicle(cause: number): void {
    if (!isVehicleCause(cause)) return;
    const kind = cause - VEHICLE_CAUSE;
    if ((this.business.fleet[kind] ?? 0) > 0) return;
    const day = Math.floor(this.tick / TICKS_PER_DAY);
    if (this.noVehicleWarned.get(kind) === day) return;
    this.noVehicleWarned.set(kind, day);
    this.eventQueue.push(`noVehicle|vehicle=${GSE[kind].name.toLowerCase()}`);
  }

  /** Advances the tick counter after all subsystems ran. */
  endTick(): void {
    this.tick++;
  }

  private applyPending(): void {
    for (let i = 0; i < this.pending.length; i++) {
      const cmd = this.pending[i];
      this.log.push(this.tick, cmd);
      this.apply(cmd);
    }
    this.pending.length = 0;
  }

  /** Applies a command to state. */
  apply(cmd: Command): void {
    switch (cmd.type) {
      case 'setTestTraffic':
        this.traffic.setTestTraffic(cmd.perHour, cmd.turnScale);
        break;
      case 'testArrival':
        this.traffic.scheduleArrival(cmd.typeIdx, this.tick + Math.max(0, cmd.inTicks), 0, cmd.turnTicks);
        break;
      case 'testEvent':
        this.report(this.director.plan(cmd.id, this.tick));
        break;
      case 'testDockAt':
        this.testDockAt(cmd.standId, cmd.typeIdx, cmd.turnTicks);
        break;
      case 'buyParcel':
        this.buyParcel(cmd.parcelId);
        break;
      case 'buyParcels':
        this.buyParcels(cmd.ids);
        break;
      case 'terminalBuild':
        this.report(this.business.terminalBuild(cmd.building, cmd.ox, cmd.oy, cmd.headingDeg, cmd.edit, this.buildContext(), cmd.level ?? 0));
        break;
      case 'demolishTerminal':
        this.report(this.business.demolishTerminal(cmd.id));
        break;
      case 'upgradeFixture':
        this.report(this.business.startFixtureUpgrade(cmd.building, cmd.x, cmd.y, this.tick));
        break;
      case 'cancelFixtureUpgrade':
        this.report(this.business.cancelFixtureUpgrade(cmd.building, cmd.x, cmd.y));
        break;
      case 'zoneUnit': {
        const g = this.business.grids.find((q) => q.id === cmd.building);
        this.report(g ? this.business.tenants.zone(g, cmd.x, cmd.y, cmd.w, cmd.h, cmd.category) : 'nothingThere');
        break;
      }
      case 'removeUnit':
        this.report(this.business.tenants.remove(cmd.id));
        break;
      case 'acceptTenant':
        this.report(this.business.tenants.accept(cmd.unit, cmd.brand));
        break;
      case 'declineTenant':
        this.report(this.business.tenants.decline(cmd.unit, cmd.brand));
        break;
      case 'adCampaign':
        this.report(this.business.tenants.campaign(cmd.category));
        break;
      case 'placeProp':
        this.report(this.business.placeProp(cmd.building, { asset: cmd.asset, x: cmd.x, y: cmd.y, rot: cmd.rot }));
        break;
      case 'removeProp':
        this.report(this.business.removeProp(cmd.building, cmd.x, cmd.y));
        break;
      case 'placeBaggageNode':
        this.report(this.baggage.place(cmd));
        break;
      case 'removeBaggageNode':
        this.report(this.baggage.remove(cmd.id));
        break;
      case 'setStandBay':
        this.report(this.baggage.setStandBay(cmd.standId, cmd.bayId));
        break;
      case 'fixBaggageNode':
        this.report(this.baggage.fix(cmd.id));
        break;
      case 'signAirline':
        this.report(this.business.signAirline(cmd.airlineId, cmd.sign));
        break;
      case 'placeSeries':
        this.report(this.business.market.place(cmd.seriesId, cmd.standId, cmd.minute, this.traffic.nowTick));
        this.business.version++;
        break;
      case 'unplaceSeries':
        this.report(this.business.market.unplace(cmd.seriesId));
        this.business.version++;
        break;
      case 'cancelSeries':
        this.report(this.business.market.cancel(cmd.seriesId));
        this.business.version++;
        break;
      case 'renewSeries':
        this.report(this.business.market.renew(cmd.seriesId, this.traffic.nowTick));
        this.business.version++;
        break;
      case 'assignStand': {
        if (this.traffic.fState[cmd.flight] !== FlState.Scheduled) break;
        if (cmd.standId === -1) {
          this.traffic.fStand[cmd.flight] = -1;
          this.business.version++;
          break;
        }
        const refusal = this.traffic.refuseAssign(cmd.flight, cmd.standId);
        if (refusal) {
          this.report(refusal);
          break;
        }
        this.traffic.fStand[cmd.flight] = cmd.standId;
        this.business.version++;
        break;
      }
      case 'cancelFlight':
        if (this.traffic.fState[cmd.flight] === FlState.Scheduled) this.traffic.fState[cmd.flight] = FlState.Done;
        break;
      case 'setAutoStands':
        this.traffic.autoStands = cmd.on;
        this.standsDirty = true;
        this.business.version++;
        break;
      case 'autoAssignStands':
        this.traffic.autoAssign();
        break;
      case 'buyGse':
        this.report(this.business.buyGse(cmd.kind, cmd.count));
        break;
      case 'setAirlineFee':
        this.business.setFee(cmd.airlineId, cmd.level);
        break;
      case 'setStaffCap':
        this.report(this.staff.setCap(cmd.role, cmd.cap));
        break;
      case 'takeLoan':
        this.report(this.business.takeLoan(cmd.amount));
        break;
      case 'repayLoan':
        this.report(this.business.repayLoan(cmd.amount));
        break;
      case 'eventChoice':
        this.report(this.director.choose(cmd.seq, cmd.choice, this.tick));
        break;
      default: {
        const towersBefore = this.airfield.towersVersion;
        const r = this.airfield.execute(cmd, this.buildContext(), this.cash, { tick: this.tick, assignedTypes: this.business.assignedTypes(), terminals: this.business.grids });
        if (r === null) break;
        if (isProblem(r)) {
          let e = r.code;
          if (r.args) for (const k of Object.keys(r.args).sort()) e += `|${k}=${r.args[k]}`;
          this.eventQueue.push(e);
        } else {
          if (r.cashDelta !== 0) this.book('construction', r.cashDelta);
          // Stands moved or removed: the automatic assigner runs in the airfield sync, once the copy is current.
          if (cmd.type === 'buildStands' || cmd.type === 'setStandProps' || cmd.type === 'setStandGate' || cmd.type === 'startStandUpgrade' || (cmd.type === 'demolish' && cmd.kind === 'stand')) this.standsDirty = true;
        }
        // A tower change, including an undo, refreshes ATC coverage and the movement budget at once.
        if (this.airfield.towersVersion !== towersBefore) {
          this.business.version++;
          this.traffic.setTowerLevel(towerLevelOf(this.airfield.data));
        }
      }
    }
  }

  /**
   * Test scaffolding for the stand scenes: schedules an arrival due now and gives it the stand. A refused
   * stand cancels the flight and reports why, as a normal stand assignment does.
   */
  private testDockAt(standId: number, typeIdx: number, turnTicks: number): void {
    if (typeIdx < 0 || typeIdx >= AIRCRAFT.length) return;
    const f = this.traffic.scheduleArrival(typeIdx, this.tick, 0, turnTicks);
    if (f < 0) return;
    const refusal = this.traffic.refuseAssign(f, standId);
    if (refusal) {
      this.traffic.fState[f] = FlState.Done;
      this.report(refusal);
      return;
    }
    this.traffic.fStand[f] = standId;
    this.business.version++;
  }

  private report(problem: string | null): void {
    if (problem) this.eventQueue.push(problem);
  }

  private buildContext(): BuildContext {
    return { heights: this.site.heights, parcelId: this.site.parcelId, parcelOwner: this.parcelOwner };
  }

  /** Buys every listed parcel that is for sale, or none when the player cannot afford them all. */
  private buyParcels(ids: number[]): void {
    const site = this.site;
    let total = 0;
    const todo: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (!Number.isInteger(id) || id < 0 || id >= site.parcelCount) continue;
      if (this.parcelOwner[id] === 1 || site.parcelType[id] === ParcelType.Protected) continue;
      if (todo.indexOf(id) >= 0) continue;
      todo.push(id);
      total += site.parcelPrice[id];
    }
    if (todo.length === 0) return;
    if (total > this.cash) {
      this.eventQueue.push('insufficientFunds');
      return;
    }
    for (let i = 0; i < todo.length; i++) this.parcelOwner[todo[i]] = 1;
    this.ownerVersion++;
    this.book('land', -total);
  }

  /** The business payload when it or the airfield changed or ten game minutes passed, otherwise null. */
  takeBusiness(): BusinessPayload | null {
    const afVersion = this.airfield.data.version;
    if (this.business.version === this.businessSent && afVersion === this.businessAirfield && this.tick - this.businessSentTick < 6000) return null;
    this.businessSent = this.business.version;
    this.businessAirfield = afVersion;
    this.businessSentTick = this.tick;
    return { ...this.business.payload(this.tick), baggage: this.baggage.inspect(this.airfield.data.stands.map((st) => st.id)), event: this.director.view(this.tick) };
  }

  /** Copies of the terminal grids when they changed since the last call, otherwise null. */
  takeTerminalGrids(): TerminalGrid[] | null {
    const bagVersion = this.baggage.drawVersion();
    if (this.business.terminalVersion === this.gridsSent && bagVersion === this.bagDrawSent) return null;
    this.gridsSent = this.business.terminalVersion;
    this.bagDrawSent = bagVersion;
    return this.business.grids.map((g) => ({
      ...g,
      bagNodes: this.baggage.drawList(g.id),
      floor: g.floor.slice(),
      zone: g.zone.slice(),
      fixture: g.fixture.slice(),
      fixtureRot: g.fixtureRot.slice(),
      fixtureOff: g.fixtureOff.slice(),
      fixtureLevel: g.fixtureLevel.slice(),
      fixtureMode: g.fixtureMode.slice(),
      works: this.business.fixtureWorks.filter((w) => w.building === g.id).map((w) => ({ ...w })),
      hWall: g.hWall.slice(),
      vWall: g.vWall.slice(),
      leased: g.leased.slice(),
      props: g.props.map((p) => ({ ...p })),
      units: this.business.tenants.drawList(g),
    }));
  }

  /** Number of terminal buildings. Overlay grid indexes run from 0 to this count minus one. */
  terminalCount(): number {
    return this.business.grids.length;
  }

  /** Read only overlay of one terminal building at the current tick. Changes no sim state. */
  overlayData(gridIndex: number, out: OverlayData): OverlayData {
    const o = this.business.overlayData(gridIndex, this.tick, out, this.cohorts);
    this.staff.fillCoverage(o, gridIndex);
    const g = this.business.grids[gridIndex];
    o.bag = (g ? this.baggage.overlay(g.id, this.tick) : null) ?? undefined;
    return o;
  }

  /** True once per airfield change. */
  takeAirfieldDirty(): boolean {
    if (this.airfield.version === this.airfieldSent && this.airfield.obstaclesVersion === this.obstaclesSent && this.airfield.towersVersion === this.towersSent && this.airfield.groundVersion === this.groundSent) return false;
    this.groundSent = this.airfield.groundVersion;
    this.airfieldSent = this.airfield.version;
    this.obstaclesSent = this.airfield.obstaclesVersion;
    this.towersSent = this.airfield.towersVersion;
    return true;
  }

  /**
   * Works out the obstacle surfaces again after the airfield, a terminal or the land owned changed.
   * The results go to the traffic directly, so they never rebuild the taxi network.
   */
  private updateObstacles(): void {
    if (this.airfield.version === this.obstacleSeen[0] && this.business.terminalVersion === this.obstacleSeen[1] && this.ownerVersion === this.obstacleSeen[2]) return;
    this.obstacleSeen[0] = this.airfield.version;
    this.obstacleSeen[1] = this.business.terminalVersion;
    this.obstacleSeen[2] = this.ownerVersion;
    // Only runways, building outlines and land change the result, so most edits stop here.
    const runways = this.airfield.data.runways;
    const buildings = this.business.footprints();
    let key = `${this.ownerVersion}`;
    for (const r of runways) key += `|${r.id},${r.x1},${r.y1},${r.x2},${r.y2},${r.approach},${r.widthM}`;
    for (const b of buildings) for (const p of b) key += `|${p.x},${p.y}`;
    if (key === this.obstacleKey) return;
    this.obstacleKey = key;
    if (runways.length === 0 && (this.airfield.data.obstacles?.length ?? 0) === 0) return;
    const site = this.site;
    const input = { heights: site.heights, landClass: site.landClass, parcelId: site.parcelId, parcelOwner: this.parcelOwner, buildings };
    const list = runways.map((r) => checkRunwayObstacles(r, input));
    this.airfield.setObstacles(list);
    this.traffic.obstacles = list;
  }

  private buyParcel(id: number): void {
    const site = this.site;
    if (!Number.isInteger(id) || id < 0 || id >= site.parcelCount) return;
    if (this.parcelOwner[id] === 1) return;
    if (site.parcelType[id] === ParcelType.Protected) {
      this.eventQueue.push('parcelNotForSale');
      return;
    }
    const price = site.parcelPrice[id];
    if (price > this.cash) {
      this.eventQueue.push('insufficientFunds');
      return;
    }
    this.book('land', -price);
    this.parcelOwner[id] = 1;
    this.ownerVersion++;
  }

  /** Returns true once after ownership or cash changed. */
  takeOwnershipDirty(): boolean {
    const d = this.ownershipDirty;
    this.ownershipDirty = false;
    return d;
  }

  /** Event codes raised since the last call, for the alert system. */
  drainEvents(out: string[]): void {
    for (let i = 0; i < this.eventQueue.length; i++) out.push(this.eventQueue[i]);
    this.eventQueue.length = 0;
  }

  /** The full game state as plain data. The site is not saved, the seed regenerates it. */
  serialize(): SaveData {
    // Cohorts are not in SaveData yet, so the object is built first to skip the literal's excess property check.
    const save = {
      version: SAVE_VERSION,
      seed: this.seed,
      options: this.options,
      tick: this.tick,
      gameSeconds: this.gameSeconds,
      cash: this.cash,
      rng: this.rng.getState(),
      parcelOwner: packTyped(this.parcelOwner),
      airfield: this.airfield.saveState(),
      traffic: this.traffic.saveState(),
      business: this.business.saveState(),
      baggage: this.baggage.saveState(),
      cohorts: this.cohorts.saveState(),
      vehicles: this.gse.saveState(),
      turnarounds: this.turns.saveState(),
      staff: this.staff.saveState(),
      cleaning: this.cleaning.saveState(),
      events: this.director.saveState(),
    };
    return save;
  }

  /** Replaces the state of a fresh sim with saved state. The save is migrated to the current version first. */
  restore(raw: unknown): void {
    const save = migrate(raw);
    if (save.seed !== this.seed) throw new Error('Save belongs to a different seed');
    this.tick = save.tick;
    this.gameSeconds = save.gameSeconds;
    this.cash = save.cash;
    this.rng.setState(save.rng);
    unpackInto(save.parcelOwner, this.parcelOwner, Uint8Array);
    this.airfield.loadState(save.airfield);
    // Build the network for the loaded airfield, then put the traffic state on top of it.
    this.networkVersion = this.airfield.version;
    this.traffic.setAirfield(this.airfield.data);
    this.traffic.setTowerLevel(towerLevelOf(this.airfield.data));
    this.traffic.loadState(save.traffic);
    this.business.loadState(save.business);
    this.baggage.loadState(save.baggage as BaggageSave | undefined);
    if (save.convertBelts) {
      const kept = this.baggage.convertBelts();
      if (kept > 0) this.eventQueue.push(`beltsKept|n=${kept}`);
    }
    this.roadSeen.fill(-1);
    this.bagRoadStamp = -1;
    this.syncRoads(true);
    this.gse.loadState(save.vehicles);
    this.turns.loadState(save.turnarounds);
    this.cohorts.loadState((save as { cohorts?: CohortsSave }).cohorts, Math.max(0, save.tick - 1));
    this.staff.loadState(save.staff as StaffSave | undefined);
    this.cleaning.loadState(save.cleaning as CleaningSave | undefined);
    this.restoring = true;
    this.director.loadState((save as { events?: DirectorSave }).events);
    this.restoring = false;
    if (save.convertProps) {
      const n = this.business.convertLegacyProps();
      if (n > 0) this.eventQueue.push(`propsConverted|n=${n}`);
    }
    if (save.convertShops) {
      const n = this.business.convertLegacyShops();
      if (n > 0) this.eventQueue.push(`shopsConverted|n=${n}`);
    }
    if (save.legacyLanes) {
      const n = this.business.removeLegacyLanes(save.legacyLanes);
      if (n > 0) this.eventQueue.push(`lanesRemoved|n=${n}`);
    }
    this.cleaning.refresh();
    // A save from before the tower that relied on a control room has no coverage now (task T40 R3).
    if (this.business.atcCells >= ATC_MIN_CELLS && (this.airfield.data.towers?.length ?? 0) === 0) this.eventQueue.push('atcLost');
    this.ownershipDirty = true;
    this.airfieldSent = -1;
    this.obstaclesSent = -1;
    this.towersSent = -1;
    this.groundSent = -1;
    this.obstacleKey = '';
    this.obstacleSeen.fill(-1);
    this.updateObstacles();
    this.businessSent = -1;
    this.gridsSent = -1;
    this.bagDrawSent = -1;
    this.pending.length = 0;
  }

  /** 32 bit hash of the state that matters, for determinism tests. */
  stateHash(): number {
    let h = HASH_INIT;
    h = foldU32(h, this.tick);
    h = foldU32(h, this.rng.getState());
    h = foldInts(h, this.parcelOwner, this.parcelOwner.length);
    h = foldU32(h, Math.floor(this.cash));
    h = this.airfield.hash(h);
    h = this.traffic.hash(h);
    h = this.business.hash(h);
    h = this.baggage.hash(h);
    h = this.cohorts.hash(h);
    h = this.gse.hash(h);
    h = this.turns.hash(h);
    h = this.staff.hash(h);
    h = this.cleaning.hash(h);
    h = this.director.hash(h);
    return h;
  }

  /** Writes the current state into a snapshot buffer's views. */
  // hot
  writeSnapshot(views: SnapshotViews): void {
    views.header[SnapHeader.Version] = SNAPSHOT_VERSION;
    views.header[SnapHeader.Tick] = this.tick;
    this.traffic.writeSnapshot(views);
    const g = this.gse;
    let n = 0;
    for (let v = 0; v < MAX_VEHICLES; v++) {
      if (g.active[v] === 0) continue;
      views.vehicleId[n] = v;
      views.vehicleX[n] = g.x[v];
      views.vehicleY[n] = g.y[v];
      views.vehicleHeading[n] = g.heading[v];
      views.vehicleKind[n] = g.kind[v];
      views.vehicleDocked[n] = g.isDocked(v) ? 1 : 0;
      n++;
    }
    views.header[SnapHeader.VehicleCount] = n;
    this.cohorts.writeSample(views, this.tick);
    writeCrewSample(views, this.turns, this.traffic);
    this.staff.writeSample(views, this.tick);
  }
}
