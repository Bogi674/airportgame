import { AIRCRAFT, RUNWAY_OCCUPANCY, wakeSeparationSec, WAKE_ORDER, type AircraftSpec } from '@data/aircraft';
import { ACCEPT_GA, CODES, compassVector, STAND_SIZES_ORDER, type AirfieldPayload, type CodeLetter, type FlightCategory, type Runway, type Stand } from '@shared/airfield';
import { SnapHeader, type SnapshotViews } from '@shared/snapshot';
import { SEASONS, WIND_BINS, windBand, type Climate } from '@shared/site';
import { atan2Det, cosLut, PI, sinLut, TWO_PI } from '@shared/trig';
import { foldF64, foldInts, foldU32 } from '../hash';
import { packTyped, unpackInto } from '../save/pack';
import type { Rng } from '../rng';
import { blockWindow, blocksOverlap, refuseFit, refuseStand, refuseUsage, STAND_BLOCK_BUFFER_MIN, type BlockWindow, type StandFacts, type StandRefusal } from '@shared/flightBlock';
import { minuteOfDay, TICKS_PER_DAY, TICKS_PER_MINUTE } from '@shared/business';
import { gameSecondsToTicks } from '@shared/time';
import { PUSHBACK_EXTENSION_M } from '@shared/standFork';
import { sizeGap } from '@shared/standSizes';
import { parkedOffsetM } from '@shared/standGeom';
import type { RunwayObstacles } from '@shared/obstacles';
import { AIRFIELD, BUSINESS, GROUND, PROFILES } from '@data/index';
import { neededCategory } from '@shared/fireCover';
import { movementsPerHour } from '@shared/towerBudget';
import { padSize } from '@shared/turnPad';
import { closestOnSegment } from '@shared/geom';
import { CAUSE_ATC, CAUSE_BOARDING, CAUSE_CREW_LEAVING, CAUSE_FUEL } from '@shared/turnaround';
import { EdgeKind, TaxiNetwork, isTaxiEdge } from '../airfield/network';
import { checkLanding, checkTakeoff, requiredTakeoffM, takeoffWeight } from './performance';

export const MAX_AIRCRAFT = 256;
const MAX_ROUTE = 40;
/**
 * Parked offset in meters along the stand heading, by stand size and aircraft type index (docs/DESIGN_REVISION_3.md
 * stop bars). Built once so the tick reads a number and allocates nothing.
 */
const PARKED_OFFSET = (() => {
  const table = new Float64Array(STAND_SIZES_ORDER.length * AIRCRAFT.length);
  STAND_SIZES_ORDER.forEach((size, k) => {
    AIRCRAFT.forEach((spec, t) => {
      table[k * AIRCRAFT.length + t] = parkedOffsetM(size, spec);
    });
  });
  return table;
})();
/** Index in STAND_SIZES_ORDER by size name, read in the tick without a search. */
const SIZE_INDEX: Readonly<Record<string, number>> = Object.fromEntries(STAND_SIZES_ORDER.map((size, k) => [size, k]));
/** A push back waits while a taxiing aircraft will pass its junction within this many metres of taxi route (user, 2026-11-17). */
const PUSH_GIVE_WAY_M = 250;
/** Extra reach of a junction zone, about one aircraft length, so an aircraft already past the node still holds its conflicts. */
const CONFLICT_MARGIN_M = 30;
const MAX_FLIGHTS = 1024;
const DT = 0.1;
const KT = 0.514444;
const APPROACH_START_M = 4000;
const TOUCHDOWN_M = 300;
const TAXI_DECEL = 1.5;
const TAXI_ACCEL = 1.0;
const PUSHBACK_SPEED = 1.5;
/** How far from its position a rebuild looks for an edge to keep a ground aircraft on, before it falls back to the nearest node. */
const PLACE_RADIUS_M = 40;
/** Longest an arrival waits for a stand or runway before it diverts: 60 game minutes. */
const MAX_DELAY_TICKS = 60 * TICKS_PER_MINUTE;
const RETRY_TICKS = 300;
/** Longest a turnaround waits past its timer for passengers already at a gate desk. */
const BOARD_HOLD_TICKS = gameSecondsToTicks(PROFILES.boardingHoldS);
/** A movement waits for ATC budget for 90 game minutes, then the arrival diverts (T40 R4). */
const ATC_MAX_WAIT_TICKS = 90 * TICKS_PER_MINUTE;
// The rolling span of a movement budget: 36000 physical ticks, which is 12 game hours.
const MOVEMENT_WINDOW_TICKS = 36000;
/** Ring size for one runway's movement starts, the highest budget per rolling span on the ladder. */
const MOVEMENT_RING = BUSINESS.tower.levels.reduce((m, l) => Math.max(m, l.movementsPerHour), 0);
const SLOTS = 8;
const TURN_RATE = 0.35;
/** The gap autoAssign keeps between two flights on one stand, in ticks. */
const STAND_BLOCK_BUFFER_TICKS = STAND_BLOCK_BUFFER_MIN * TICKS_PER_MINUTE;

export const AcState = { Free: 0, Approach: 1, Rollout: 2, TaxiIn: 3, Turnaround: 4, Pushback: 5, TaxiOut: 6, Holding: 7, LineUp: 8, Takeoff: 9, Backtrack: 10, TowBack: 11 } as const;
export const FlState = { Free: 0, Scheduled: 1, Inbound: 2, OnGround: 3, Departing: 4, Done: 5 } as const;
/** Airline id of a general aviation flight. It has no airline, so every `>= 0` airline check skips it. */
export const GA_AIRLINE = -2;
/** Airline index of a diverted aircraft accepted through an event (T50): no passengers, a fixed stand time, a flat fee. */
export const DIVERT_AIRLINE = -3;
/** Ticks a flight waits for fuel before it is reported grounded (D19). */
const FUEL_GROUND_TICKS = GROUND.fuel.groundAfterMin * TICKS_PER_MINUTE;
/** GA arrivals come in the daytime span only, from 06:00 to 20:00 game time. */
const GA_DAY_START_MIN = 6 * 60;
const GA_DAY_END_MIN = 20 * 60;
/** Gap between GA arrivals when one stand is free, in ticks (four game hours). The gap shrinks with more free stands. */
const GA_DAY_SPAN_TICKS = 4 * 60 * TICKS_PER_MINUTE;
/** Shortest gap between two GA arrivals, one game hour. */
const GA_MIN_GAP_TICKS = 60 * TICKS_PER_MINUTE;
/** Wait before the next GA check when no type or stand fits, 30 game minutes. */
const GA_RETRY_TICKS = 30 * TICKS_PER_MINUTE;
const GA_LEAD_TICKS = 1500;
/** Highest turnaround scale of the test traffic command. 24 keeps the longest turn near the 270000 ticks it could reach before the calendar ran faster. */
const TEST_TURN_SCALE_MAX = 24;
/** The wind is redrawn every 12 game hours, so the runway in use changes at most twice a day. */
const WIND_UPDATE_TICKS = 12 * 60 * TICKS_PER_MINUTE;

/** Turnaround length per aircraft role in game minutes. */
const ROLE_TURNAROUND_MIN: Record<string, number> = { ga: 45, commuter: 60, regionalTurboprop: 75, regionalJet: 90, narrowbody: 120, widebody: 180 };

const SURFACE_BIT: Record<string, number> = { dirt: 1, gravel: 2, grass: 4, asphalt: 8, concrete: 16 };
const surfaceMask = (a: AircraftSpec): number => a.surfaces.reduce((m, s) => m | SURFACE_BIT[s], 0);
const MASKS = AIRCRAFT.map(surfaceMask);
const CODES_OF: CodeLetter[] = AIRCRAFT.map((a) => a.derivedForReading.code);
/** Junction turns closer than 1 degree to straight, or turning back by more than 170 degrees, get no curve (T84, as `nodeGeometry`). */
const STRAIGHT_COS = cosLut((1 * PI) / 180);
const TURN_BACK_COS = cosLut((170 * PI) / 180);
/** The tangent distance of the sharpest curved turn, 170 degrees, in turn radii: a quick bound before the curve is built. */
const MAX_TAN_HALF = sinLut((85 * PI) / 180) / cosLut((85 * PI) / 180);
/** Flight category of traffic without a flight record, such as test traffic: GA types count as GA. */
const CAT_OF: FlightCategory[] = AIRCRAFT.map((a) => (a.role === 'ga' ? 'ga' : 'commercial'));
const WAKE_OF = AIRCRAFT.map((a) => WAKE_ORDER.indexOf(a.derivedForReading.wake));
const ACR_OF = AIRCRAFT.map((a) => {
  const gear = a.weights.mtowKg < 7000 ? 1 : a.weights.mtowKg < 100000 ? 0.8 : a.weights.mtowKg < 280000 ? 0.65 : 0.55;
  const wheels = a.weights.mtowKg < 7000 ? 2 : a.weights.mtowKg < 100000 ? 4 : a.weights.mtowKg < 280000 ? 8 : 12;
  return ((a.weights.mtowKg / 1000) * gear) / Math.sqrt(wheels) * 1.1;
});

const turnWrap = (a: number): number => {
  let d = a;
  while (d > PI) d -= TWO_PI;
  while (d < -PI) d += TWO_PI;
  return d;
};

interface Scratch {
  x: number;
  y: number;
  h: number;
}

/** The parts of the site that traffic needs. */
export interface TrafficSite {
  windFreq: Float32Array;
  windMeanKt: Float32Array;
  climate: Climate;
  idealHeadingDeg: number;
}

/** Flights, aircraft, air traffic control and ground movement. All typed arrays, no allocation per tick. */
export class Traffic {
  // Aircraft
  readonly active = new Uint8Array(MAX_AIRCRAFT);
  readonly state = new Uint8Array(MAX_AIRCRAFT);
  readonly type = new Uint8Array(MAX_AIRCRAFT);
  readonly livery = new Uint8Array(MAX_AIRCRAFT);
  readonly flight = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly x = new Float64Array(MAX_AIRCRAFT);
  readonly y = new Float64Array(MAX_AIRCRAFT);
  readonly heading = new Float64Array(MAX_AIRCRAFT);
  readonly speed = new Float64Array(MAX_AIRCRAFT);
  readonly dist = new Float64Array(MAX_AIRCRAFT);
  readonly routeLen = new Uint8Array(MAX_AIRCRAFT);
  readonly routeIdx = new Uint8Array(MAX_AIRCRAFT);
  readonly routeEdge = new Int32Array(MAX_AIRCRAFT * MAX_ROUTE);
  readonly routeDir = new Int8Array(MAX_AIRCRAFT * MAX_ROUTE);
  readonly heldNode = new Int32Array(MAX_AIRCRAFT).fill(-1);
  /**
   * Route positions from claimFrom to claimTo whose two way blocks the aircraft holds, both -1 for none (T87).
   * A claim covers the whole run of two way pavement up to where the route leaves it, taken at once.
   */
  readonly claimFrom = new Int16Array(MAX_AIRCRAFT).fill(-1);
  readonly claimTo = new Int16Array(MAX_AIRCRAFT).fill(-1);
  /** 1 while waitingFor names an aircraft coming the other way on the same pavement rather than a reservation. */
  readonly oppWait = new Uint8Array(MAX_AIRCRAFT);
  /** Tow back (T87): the route position whose start node the tow clears, the center distance to clear it by and the state to return to. */
  readonly towIdx = new Int16Array(MAX_AIRCRAFT).fill(-1);
  readonly towClearM = new Float64Array(MAX_AIRCRAFT);
  readonly towState = new Uint8Array(MAX_AIRCRAFT);
  /** Edge the junction and block were reserved for, or -1. */
  readonly nextAcq = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly waitingFor = new Int32Array(MAX_AIRCRAFT).fill(-1);
  /** Junction node this aircraft asked to enter, or -1 for none. Requests compete by class, then by first tick. */
  readonly reqNode = new Int32Array(MAX_AIRCRAFT).fill(-1);
  /** Tick of the first request for reqNode, so an earlier request wins within a class. */
  readonly reqTick = new Int32Array(MAX_AIRCRAFT);
  /** Priority class of the open request: 0 arrival on its first edge, 1 other arrival, 2 departure or other, 3 push back. Lower wins. */
  readonly reqClass = new Uint8Array(MAX_AIRCRAFT);
  readonly ignoreLocks = new Int32Array(MAX_AIRCRAFT);
  readonly yieldUntil = new Int32Array(MAX_AIRCRAFT);
  /** Until this tick the aircraft shows in the deadlock overlay. Not saved, it only feeds the overlay. */
  private readonly deadlockUntil = new Int32Array(MAX_AIRCRAFT);
  readonly standId = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly rwyIdx = new Int32Array(MAX_AIRCRAFT).fill(-1);
  /** +1 when moving from threshold A toward B on the runway, -1 for the other way. */
  readonly rwyDir = new Int8Array(MAX_AIRCRAFT);
  readonly rwyS = new Float64Array(MAX_AIRCRAFT);
  readonly rwyExitS = new Float64Array(MAX_AIRCRAFT);
  /** Distance a departure backtracks along the runway to a turn pad before its roll, 0 for none. */
  readonly rwyBack = new Float64Array(MAX_AIRCRAFT);
  readonly rwySlot = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly entryIdx = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly timer = new Int32Array(MAX_AIRCRAFT);
  readonly stuckTicks = new Int32Array(MAX_AIRCRAFT);
  /** Ticks a departure has waited on its stand for an ATC movement. */
  readonly depWait = new Int32Array(MAX_AIRCRAFT);
  /** Tick a budget blocked departure tries again. Zero means no wait. */
  readonly depRetryAt = new Int32Array(MAX_AIRCRAFT);
  /** Ticks a turnaround has held past its timer for boarding. */
  readonly boardHold = new Int32Array(MAX_AIRCRAFT);
  /** 1 when the turnaround runs the task list with vehicles (T63): an airline flight. GA and test traffic keep the timer. */
  readonly tasked = new Uint8Array(MAX_AIRCRAFT);
  readonly goalX = new Float64Array(MAX_AIRCRAFT);
  readonly goalY = new Float64Array(MAX_AIRCRAFT);
  count = 0;
  private readonly activeList = new Int32Array(MAX_AIRCRAFT);

  // Flights
  readonly fState = new Uint8Array(MAX_FLIGHTS);
  readonly fType = new Uint8Array(MAX_FLIGHTS);
  readonly fLivery = new Uint8Array(MAX_FLIGHTS);
  readonly fEta = new Int32Array(MAX_FLIGHTS);
  readonly fTurn = new Int32Array(MAX_FLIGHTS);
  readonly fAc = new Int32Array(MAX_FLIGHTS).fill(-1);
  readonly fDelay = new Int32Array(MAX_FLIGHTS);
  readonly fRetryAt = new Int32Array(MAX_FLIGHTS);
  readonly fAirline = new Int8Array(MAX_FLIGHTS).fill(-1);
  /** Rotation index of a flight within its airline, -1 for flights not bound to a rotation. */
  readonly fRot = new Int16Array(MAX_FLIGHTS).fill(-1);
  /** How late the arrival touched down against its schedule, in ticks. */
  readonly fLate = new Int32Array(MAX_FLIGHTS);
  /** Stage length in km a flight departs on, 0 for the default weight. */
  readonly fStage = new Int32Array(MAX_FLIGHTS);
  /** Stand id a flight is assigned to by the player or the auto scheduler, -1 for none. */
  readonly fStand = new Int32Array(MAX_FLIGHTS).fill(-1);
  /** Ticks a scheduled arrival has waited for an ATC movement, 0 when it is not waiting for the budget. */
  readonly fMovWait = new Int32Array(MAX_FLIGHTS);
  /** Latest reason the flight's turnaround ran past its plan, a code of `src/shared/turnaround.ts`, 0 for none. */
  readonly fCause = new Uint8Array(MAX_FLIGHTS);
  /** Ticks the flight was held past its plan for reasons the airline owns. */
  readonly fAirlineHold = new Int32Array(MAX_FLIGHTS);
  /** Stable flight serial, never reused. A freed slot keeps its old value until a new flight takes it. */
  readonly fSerial = new Int32Array(MAX_FLIGHTS);
  /** The serial the next scheduled flight takes. */
  nextSerial = 1;
  /** When false only flights with an assigned stand are accepted. */
  autoStands = true;
  /** Multiplier on new turnaround times from the ground handling fleet, set by the business. */
  serviceSlowdown = 1;
  /** Arrival delay in ticks, kept for statistics when the flight completes. */
  completedFlights = 0;
  divertedFlights = 0;
  deadlocks = 0;

  // Network and runway state
  net: TaxiNetwork = TaxiNetwork.build({ version: 0, runways: [], taxiways: [], aprons: [], stands: [], holding: [], entries: [] }, 0);
  private af: AirfieldPayload = { version: 0, runways: [], taxiways: [], aprons: [], stands: [], holding: [], entries: [] };
  private nodeOwner = new Int32Array(0);
  /** Derived from the claims by ensureCounts, never saved: holders per block, their direction, and whether both directions hold it. */
  private blockCount = new Int32Array(0);
  private blockDir = new Int8Array(0);
  private blockMixed = new Uint8Array(0);
  private blockMark = new Int32Array(0);
  private markStamp = 0;
  private countsDirty = true;
  /** The aircraft coming the other way that leaderLimit stopped for in its last call, or -1. */
  private oppBlocker = -1;
  private standOwner = new Int32Array(0);

  /** Stands with no aircraft assigned. */
  get standsFree(): number {
    let n = 0;
    for (let i = 0; i < this.standOwner.length; i++) if (this.standOwner[i] === -1) n++;
    return n;
  }

  /** Arrivals assigned to each runway entry and departures queued for it, so they never share a connector. */
  private entryInbound = new Int32Array(0);
  private entryDeparting = new Int32Array(0);
  private readonly entryCounted = new Uint8Array(MAX_AIRCRAFT);
  private rsvStart = new Int32Array(0);
  private rsvEnd = new Int32Array(0);
  private rsvCat = new Int8Array(0);
  /** Start tick of each admitted movement per runway, the rolling hour budget (T40 R4). */
  private movStart = new Int32Array(0);
  private movHead = new Int32Array(0);
  private movCount = new Int32Array(0);
  /** Highest tower level on the airfield, 0 without a tower. Level 0 means no movement budget at all. */
  private towerLevel = 0;
  private readonly tmpEdge = new Int32Array(MAX_ROUTE);
  private readonly tmpDir = new Int8Array(MAX_ROUTE);
  private readonly tailEdge = new Int32Array(MAX_ROUTE);
  private readonly tailDir = new Int8Array(MAX_ROUTE);
  private readonly pos: Scratch = { x: 0, y: 0, h: 0 };
  /** Scratch points of the junction turn curve (T84). */
  private readonly cornerA: Scratch = { x: 0, y: 0, h: 0 };
  private readonly cornerB: Scratch = { x: 0, y: 0, h: 0 };
  private readonly cornerN: Scratch = { x: 0, y: 0, h: 0 };
  private readonly bits = [new Uint32Array(0)];

  /** Business callbacks: arrival at the stand, start of push back, departure, and whether a contact stand has a gate desk. */
  /** Usable approach type per runway direction, set by the sim from the obstacle surfaces. */
  obstacles: RunwayObstacles[] = [];
  hooks: { docked(f: number): void; pushback(f: number): void; departed(f: number): void; contactOk?(stand: Stand): boolean; scheduled?(f: number): void; boardingReady?(f: number): boolean; fuelReady?(i: number): boolean; turnDone?(i: number): boolean; crewGone?(i: number): boolean; blocker?(i: number): number; delayCause?(f: number, cause: number): void } | null = null;
  private reachStand = 0;
  /** Stand blocks gathered by one autoAssign pass: stand index and start and end tick. Reused, never reallocated. */
  private readonly occStand = new Int32Array(MAX_FLIGHTS);
  private readonly occStart = new Float64Array(MAX_FLIGHTS);
  private readonly occEnd = new Float64Array(MAX_FLIGHTS);
  private occCount = 0;
  /** Gate desk of the contact stand in reachStand (T89). Bound once, so the reused scratch facts allocate nothing per check. */
  private readonly reachOf = (): boolean => {
    const st = this.af.stands[this.reachStand];
    return !this.hooks?.contactOk || this.hooks.contactOk(st);
  };
  private readonly standScratch: StandFacts = { closed: false, accepts: 0, size: 'small', surface: 'asphalt', type: 'remote', code: 'A', linked: false, contactOk: this.reachOf };
  weather: 'clear' | 'rain' | 'fog' | 'wind' = 'clear';

  // Weather and settings
  windFromDeg = 0;
  windKt = 0;
  private testPerHour = 0;
  private testTurnScale = 1;
  private tick = 0;
  private readonly rng: Rng;
  private readonly weatherRng: Rng;
  private readonly gaRng: Rng;
  /** Tick the next general aviation arrival check runs at. */
  private gaNextTick = 0;
  /** Types that land on a runway and fit a GA stand. Reused, never reallocated. */
  private readonly gaTypes: number[] = [];

  constructor(
    private readonly site: TrafficSite,
    rng: Rng,
    private readonly emit: (code: string) => void,
  ) {
    this.rng = rng.fork('traffic');
    this.weatherRng = rng.fork('weather');
    this.gaRng = rng.fork('ga');
    this.bits = [new Uint32Array(this.x.buffer), new Uint32Array(this.y.buffer), new Uint32Array(this.speed.buffer)];
    this.updateWind();
  }

  // Setup ------------------------------------------------------------------

  setTestTraffic(perHour: number, turnScale: number): void {
    this.testPerHour = Math.max(0, Math.min(240, perHour));
    this.testTurnScale = Math.max(0.05, Math.min(TEST_TURN_SCALE_MAX, turnScale));
  }

  /** Sets the tower level that meters movements. The sim calls it when a tower is built, upgraded, lost or loaded. */
  setTowerLevel(level: number): void {
    this.towerLevel = level;
  }

  get nowTick(): number {
    return this.tick;
  }

  /** Share of the full weather effect that acts, 0.5 when the player prepared for it (T50). Derived from the event director, never saved. */
  weatherSeverity = 1;

  /** Commercial types that land on a runway and fit an open commercial stand, the candidates for a diversion (T50). */
  diversionTypes(out: number[]): void {
    out.length = 0;
    for (let t = 0; t < AIRCRAFT.length; t++) {
      if (AIRCRAFT[t].role === 'ga') continue;
      let lands = false;
      for (let r = 0; r < this.af.runways.length && !lands; r++) lands = checkLanding(AIRCRAFT[t], this.af.runways[r], 0.95).ok;
      if (!lands) continue;
      let fits = false;
      for (let s = 0; s < this.af.stands.length && !fits; s++) fits = this.net.standNode[s] >= 0 && this.standAllows(t, s) && this.standFits(t, s);
      if (fits) out.push(t);
    }
  }

  setWeather(kind: 'clear' | 'rain' | 'fog' | 'wind'): void {
    this.weather = kind;
  }

  usableTypesPublic(out: number[]): void {
    this.usableTypes(out);
  }

  /** Runway length factor: wet surface, and the 5 percent bonus on an Optimal wind band. */
  private lengthFactor(r: Runway, dir: number): number {
    const hdg = dir === 1 ? r.headingDeg : (r.headingDeg + 180) % 360;
    const band = windBand(hdg % 180, this.site.idealHeadingDeg) === 'optimal' ? 0.95 : 1;
    return band * (this.weather === 'rain' ? 1 + 0.15 * this.weatherSeverity : 1);
  }

  get network(): TaxiNetwork {
    return this.net;
  }

  /** Rebuilds the network after an airfield change and re-plans everything that was moving on it. */
  setAirfield(af: AirfieldPayload): void {
    // The movement ledger belongs to a runway id, not to its array index, so a rebuild keeps it (T40 R4).
    const oldIds = this.af.runways.map((r) => r.id);
    const oldStart = this.movStart;
    const oldHead = this.movHead;
    const oldCount = this.movCount;
    this.af = { ...af, runways: af.runways, taxiways: af.taxiways, aprons: af.aprons, stands: af.stands, holding: af.holding, entries: af.entries };
    this.net = TaxiNetwork.build(af, af.version);
    const R = af.runways.length;
    this.rsvStart = new Int32Array(R * SLOTS);
    this.rsvEnd = new Int32Array(R * SLOTS);
    this.rsvCat = new Int8Array(R * SLOTS).fill(-1);
    this.movStart = new Int32Array(R * MOVEMENT_RING);
    this.movHead = new Int32Array(R);
    this.movCount = new Int32Array(R);
    for (let r = 0; r < R; r++) {
      const old = oldIds.indexOf(af.runways[r].id);
      if (old < 0) continue;
      this.movHead[r] = oldHead[old];
      this.movCount[r] = oldCount[old];
      for (let k = 0; k < MOVEMENT_RING; k++) this.movStart[r * MOVEMENT_RING + k] = oldStart[old * MOVEMENT_RING + k];
    }
    this.entryInbound = new Int32Array(af.entries.length);
    this.entryDeparting = new Int32Array(af.entries.length);
    this.entryCounted.fill(0);
    this.resetOwnership();
    for (let k = 0; k < this.count; k++) this.replan(this.activeList[k]);
    this.rebuildActive();
    this.reclaimAll();
  }

  private resetOwnership(): void {
    this.nodeOwner = new Int32Array(this.net.nodeCount).fill(-1);
    const B = this.net.blockTotal;
    this.blockCount = new Int32Array(B);
    this.blockDir = new Int8Array(B);
    this.blockMixed = new Uint8Array(B);
    this.blockMark = new Int32Array(B);
    this.markStamp = 0;
    this.countsDirty = true;
    this.standOwner = new Int32Array(this.af.stands.length).fill(-1);
    for (let i = 0; i < MAX_AIRCRAFT; i++) {
      this.heldNode[i] = -1;
      this.claimFrom[i] = -1;
      this.claimTo[i] = -1;
      this.oppWait[i] = 0;
      this.nextAcq[i] = -1;
      this.waitingFor[i] = -1;
      this.reqNode[i] = -1;
    }
    for (let i = 0; i < MAX_AIRCRAFT; i++) {
      if (this.active[i] === 1 && this.standId[i] >= 0) {
        const idx = this.af.stands.findIndex((s) => s.id === this.standId[i]);
        if (idx >= 0) this.standOwner[idx] = i;
        else this.standId[i] = -1;
      }
    }
  }

  private replan(i: number): void {
    const st = this.state[i];
    if (st === AcState.Takeoff || st === AcState.Backtrack) {
      if (this.rwyIdx[i] >= this.af.runways.length) this.removeAircraft(i, 'lost');
      return;
    }
    if (st === AcState.Approach || st === AcState.Rollout) {
      // The landing continues on its runway, but the exit and the route to the stand are looked up again.
      const rw = this.af.runways[this.rwyIdx[i]];
      const sIdx = this.af.stands.findIndex((x) => x.id === this.standId[i]);
      if (!rw || sIdx < 0 || this.net.standNode[sIdx] < 0) {
        this.removeAircraft(i, 'lost');
        return;
      }
      const dir = this.rwyDir[i];
      const d = compassVector(dir === 1 ? rw.headingDeg : (rw.headingDeg + 180) % 360);
      const ex = (dir === 1 ? rw.x1 : rw.x2) + d.x * this.rwyExitS[i];
      const ey = (dir === 1 ? rw.y1 : rw.y2) + d.y * this.rwyExitS[i];
      let entry = -1;
      let bestD = 30;
      this.af.entries.forEach((e, idx) => {
        const dd = Math.hypot(e.x - ex, e.y - ey);
        if (e.runwayId === rw.id && dd < bestD && this.net.entryNode[idx] >= 0) {
          bestD = dd;
          entry = idx;
        }
      });
      const n = entry < 0 ? -1 : this.net.route(this.net.entryNode[entry], this.net.standNode[sIdx], CODES_OF[this.type[i]], ACR_OF[this.type[i]], MASKS[this.type[i]], this.tmpEdge, this.tmpDir, MAX_ROUTE);
      if (n < 0) {
        this.removeAircraft(i, 'lost');
        return;
      }
      for (let k = 0; k < n; k++) {
        this.routeEdge[i * MAX_ROUTE + k] = this.tmpEdge[k];
        this.routeDir[i * MAX_ROUTE + k] = this.tmpDir[k];
      }
      this.routeLen[i] = n;
      this.routeIdx[i] = 0;
      this.entryIdx[i] = entry;
      this.standOwner[sIdx] = i;
      return;
    }
    if (st === AcState.Turnaround) return;
    if (st === AcState.TowBack) {
      this.state[i] = this.towState[i];
      this.towIdx[i] = -1;
    }
    if (this.placeOnNetwork(i)) return;
    const from = this.nearestNode(this.x[i], this.y[i]);
    const goal = this.goalNode(i);
    if (from < 0 || goal < 0) {
      this.removeAircraft(i, 'lost');
      return;
    }
    const n = this.net.route(from, goal, CODES_OF[this.type[i]], ACR_OF[this.type[i]], MASKS[this.type[i]], this.tmpEdge, this.tmpDir, MAX_ROUTE);
    if (n < 0) {
      this.removeAircraft(i, 'lost');
      return;
    }
    for (let k = 0; k < n; k++) {
      this.routeEdge[i * MAX_ROUTE + k] = this.tmpEdge[k];
      this.routeDir[i * MAX_ROUTE + k] = this.tmpDir[k];
    }
    this.routeLen[i] = n;
    this.routeIdx[i] = 0;
    this.dist[i] = 0;
    this.speed[i] = 0;
    if (st === AcState.Holding || st === AcState.LineUp || st === AcState.Pushback) this.state[i] = AcState.TaxiOut;
    this.afterReplan(i);
  }

  /** A departure finds the entry it was heading for again and lets go of the stand it has left. */
  private afterReplan(i: number): void {
    if (this.state[i] === AcState.TaxiOut) {
      // Entry indexes change with the airfield, so find the entry this aircraft was heading for again.
      this.entryIdx[i] = -1;
      for (let e = 0; e < this.af.entries.length; e++) {
        if (Math.hypot(this.af.entries[e].x - this.goalX[i], this.af.entries[e].y - this.goalY[i]) < 15) this.entryIdx[i] = e;
      }
      const sIdx = this.af.stands.findIndex((x) => x.id === this.standId[i]);
      if (sIdx >= 0 && this.standOwner[sIdx] === i) this.standOwner[sIdx] = -1;
      this.standId[i] = -1;
    }
  }

  /**
   * Keeps a ground aircraft where it is when the network is rebuilt (T87): on the nearest point of an edge it
   * may use, facing the way its nose points along it (tail first for a push back), with a route on from the
   * end of that edge to the same goal. False when no edge is near or no route exists; the caller then falls back.
   */
  private placeOnNetwork(i: number): boolean {
    const net = this.net;
    const st = this.state[i];
    const sIdx = this.standIndexOf(this.standId[i]);
    const back = st === AcState.Pushback ? -1 : 1;
    const hx = cosLut(this.heading[i]) * back;
    const hy = sinLut(this.heading[i]) * back;
    const c = { x: 0, y: 0, t: 0 };
    let bestE = -1;
    let bestD = PLACE_RADIUS_M;
    let bestC = 0;
    let bestDir = 1;
    for (let e = 0; e < net.edgeCount; e++) {
      const k = net.edgeKind[e];
      if (k === EdgeKind.Runway) continue;
      if (!isTaxiEdge(k) && (sIdx < 0 || (net.edgeStand[e] !== sIdx && net.edgeForkStand[e] !== sIdx))) continue;
      const s0 = net.edgeSampleStart[e];
      const n = net.edgeSampleCount[e];
      const step = n > 1 ? net.edgeLen[e] / (n - 1) : 0;
      for (let q = 0; q + 1 < n; q++) {
        const ax = net.sampleX[s0 + q];
        const ay = net.sampleY[s0 + q];
        const bx = net.sampleX[s0 + q + 1];
        const by = net.sampleY[s0 + q + 1];
        closestOnSegment(this.x[i], this.y[i], ax, ay, bx, by, c);
        const d = Math.hypot(c.x - this.x[i], c.y - this.y[i]);
        if (d >= bestD) continue;
        bestD = d;
        bestE = e;
        bestC = Math.min(net.edgeLen[e], (q + c.t) * step);
        bestDir = (bx - ax) * hx + (by - ay) * hy >= 0 ? 1 : -1;
      }
    }
    if (bestE < 0) return false;
    const end = bestDir === 1 ? net.edgeTo[bestE] : net.edgeFrom[bestE];
    const goal = st === AcState.TaxiIn && sIdx >= 0 && net.standNode[sIdx] >= 0 ? net.standNode[sIdx] : this.goalNode(i);
    if (goal < 0) return false;
    let n = 0;
    if (end !== goal) {
      n = net.route(end, goal, CODES_OF[this.type[i]], ACR_OF[this.type[i]], MASKS[this.type[i]], this.tmpEdge, this.tmpDir, MAX_ROUTE - 1);
      if (n < 0) return false;
    }
    const base = i * MAX_ROUTE;
    this.routeEdge[base] = bestE;
    this.routeDir[base] = bestDir;
    for (let k = 0; k < n; k++) {
      this.routeEdge[base + 1 + k] = this.tmpEdge[k];
      this.routeDir[base + 1 + k] = this.tmpDir[k];
    }
    this.routeLen[i] = n + 1;
    this.routeIdx[i] = 0;
    this.dist[i] = bestDir === 1 ? bestC : net.edgeLen[bestE] - bestC;
    if (st === AcState.Holding || st === AcState.LineUp || (st === AcState.Pushback && isTaxiEdge(net.edgeKind[bestE]))) this.state[i] = AcState.TaxiOut;
    if (this.state[i] === AcState.TaxiOut) this.afterReplan(i);
    return true;
  }

  /**
   * The node a ground aircraft is heading for after a rebuild. A departure heads for its runway entry, whose node
   * lies on the runway, so it is found among the entries rather than among the taxi nodes (T87).
   */
  private goalNode(i: number): number {
    for (let e = 0; e < this.af.entries.length; e++) {
      const en = this.af.entries[e];
      if (this.net.entryNode[e] >= 0 && Math.hypot(en.x - this.goalX[i], en.y - this.goalY[i]) < 15) return this.net.entryNode[e];
    }
    return this.nearestNode(this.goalX[i], this.goalY[i]);
  }

  private nearestNode(x: number, y: number): number {
    let best = -1;
    let bestD = 400;
    for (let n = 0; n < this.net.nodeCount; n++) {
      if (this.net.nodeOnRunway[n] === 1) continue;
      const d = Math.hypot(this.net.nodeX[n] - x, this.net.nodeY[n] - y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  // Weather ----------------------------------------------------------------

  private updateWind(): void {
    const season = Math.floor((this.tick / (TICKS_PER_DAY * 91.25)) % SEASONS);
    let r = this.weatherRng.next();
    let bin = 0;
    for (let b = 0; b < WIND_BINS; b++) {
      r -= this.site.windFreq[season * WIND_BINS + b];
      if (r <= 0) {
        bin = b;
        break;
      }
      bin = b;
    }
    this.windFromDeg = (bin * 22.5 + (this.weatherRng.next() - 0.5) * 22.5 + 360) % 360;
    this.windKt = this.site.windMeanKt[season * WIND_BINS + bin] * (0.4 + this.weatherRng.next() * 1.2);
  }

  private effectiveWind(): number {
    return this.weather === 'wind' ? this.windKt * (1 + 0.8 * this.weatherSeverity) : this.windKt;
  }

  /** Wind component along a heading (positive is headwind). */
  private headwind(headingDeg: number): number {
    return this.effectiveWind() * cosLut(((this.windFromDeg - headingDeg) * PI) / 180);
  }

  private crosswind(headingDeg: number): number {
    return Math.abs(this.effectiveWind() * sinLut(((this.windFromDeg - headingDeg) * PI) / 180));
  }

  // Flights ----------------------------------------------------------------

  /** The stable serial of a flight slot, 0 for no flight. */
  serialOf(f: number): number {
    return f < 0 ? 0 : this.fSerial[f];
  }

  /** The live flight slot that carries a serial, -1 when it is finished or unknown. */
  flightOfSerial(serial: number): number {
    for (let f = 0; f < MAX_FLIGHTS; f++) {
      if (this.fSerial[f] === serial && this.fState[f] !== FlState.Free && this.fState[f] !== FlState.Done) return f;
    }
    return -1;
  }

  /** Schedules an arriving flight. Its turnaround and departure follow automatically. */
  scheduleArrival(typeIdx: number, etaTick: number, livery: number, turnTicks: number, airline = -1, stageKm = 0, rot = -1): number {
    let f = -1;
    for (let k = 0; k < MAX_FLIGHTS; k++) {
      if (this.fState[k] === FlState.Free || this.fState[k] === FlState.Done) {
        f = k;
        break;
      }
    }
    if (f < 0) return -1;
    this.fSerial[f] = this.nextSerial++;
    this.fState[f] = FlState.Scheduled;
    this.fType[f] = typeIdx;
    this.fLivery[f] = livery;
    this.fEta[f] = etaTick;
    this.fTurn[f] = turnTicks;
    this.fAc[f] = -1;
    this.fDelay[f] = 0;
    this.fRetryAt[f] = 0;
    this.fMovWait[f] = 0;
    this.fAirline[f] = airline;
    this.fRot[f] = rot;
    this.fLate[f] = 0;
    this.fStage[f] = stageKm;
    this.fStand[f] = -1;
    this.fCause[f] = 0;
    this.fAirlineHold[f] = 0;
    this.hooks?.scheduled?.(f);
    return f;
  }

  /**
   * True when a moving aircraft is on one of the marked network edges or has it next on its route, so a
   * vehicle at a road crossing gives way (T60). Parked and free aircraft never block a crossing.
   */
  taxiOnEdges(mark: Uint8Array): boolean {
    for (let i = 0; i < MAX_AIRCRAFT; i++) {
      if (this.active[i] === 0 || this.state[i] === AcState.Turnaround) continue;
      const k = this.routeIdx[i];
      const n = this.routeLen[i];
      for (let j = k; j < n && j <= k + 1; j++) {
        const e = this.routeEdge[i * MAX_ROUTE + j];
        if (e >= 0 && e < mark.length && mark[e] === 1) return true;
      }
    }
    return false;
  }

  /** The airport's fire category and whether its grace is over, set by the business each game day (T65). Derived, never saved. */
  fireCategory = 0;
  fireEnforced = false;
  /** Liters of fuel still owed to each parked aircraft, and the ticks it has waited for them (T65). */
  readonly fuelOwed = new Int32Array(MAX_AIRCRAFT);
  readonly fuelWait = new Int32Array(MAX_AIRCRAFT);

  /** Turnaround factor per stand index for commercial flights with no road from a depot (T60): 1 or the soft penalty. Set by the sim. */
  standRoadFactor = new Float64Array(0);

  turnaroundTicks(typeIdx: number): number {
    return Math.round((ROLE_TURNAROUND_MIN[AIRCRAFT[typeIdx].role] ?? 120) * TICKS_PER_MINUTE * this.testTurnScale);
  }

  /** Types that have a runway, an exit and a stand they can use right now. */
  private usableTypes(out: number[]): void {
    out.length = 0;
    for (let t = 0; t < AIRCRAFT.length; t++) {
      const a = AIRCRAFT[t];
      let ok = false;
      for (const r of this.af.runways) {
        if (!checkLanding(a, r, 0.95).ok) continue;
        for (let s = 0; s < this.af.stands.length; s++) {
          const st = this.af.stands[s];
          if (this.standFits(t, s)) {
            ok = this.net.standNode[s] >= 0 && st !== undefined;
            if (ok) break;
          }
        }
        if (ok) break;
      }
      if (ok) out.push(t);
    }
  }

  private readonly usable: number[] = [];

  private generateTestFlight(): void {
    this.usableTypes(this.usable);
    if (this.usable.length === 0) return;
    const t = this.usable[this.rng.int(0, this.usable.length - 1)];
    this.scheduleArrival(t, this.tick + 1500, this.rng.int(0, 7), this.turnaroundTicks(t));
  }

  /** Fills out with the GA types that land on a runway and fit a GA eligible stand. */
  private gaTypesInto(out: number[]): void {
    out.length = 0;
    for (let t = 0; t < AIRCRAFT.length; t++) {
      if (AIRCRAFT[t].role !== 'ga') continue;
      let lands = false;
      for (let r = 0; r < this.af.runways.length && !lands; r++) lands = checkLanding(AIRCRAFT[t], this.af.runways[r], 0.95).ok;
      if (!lands) continue;
      let fits = false;
      for (let s = 0; s < this.af.stands.length && !fits; s++) fits = this.gaEligible(s) && this.standFits(t, s);
      if (fits) out.push(t);
    }
  }

  /** Called every 10 ticks. Schedules general aviation arrivals in daytime, paced by the free GA stands. */
  updateGa(tick: number): void {
    if (tick < this.gaNextTick) return;
    const min = minuteOfDay(tick);
    if (min < GA_DAY_START_MIN || min >= GA_DAY_END_MIN) {
      this.gaNextTick = tick + GA_RETRY_TICKS;
      return;
    }
    let free = 0;
    for (let s = 0; s < this.af.stands.length; s++) if (this.standOwner[s] === -1 && this.gaEligible(s)) free++;
    let pending = 0;
    for (let f = 0; f < MAX_FLIGHTS; f++) {
      if (this.fAirline[f] === GA_AIRLINE && (this.fState[f] === FlState.Scheduled || this.fState[f] === FlState.Inbound)) pending++;
    }
    const n = Math.max(0, free - pending);
    this.gaTypesInto(this.gaTypes);
    if (this.gaTypes.length === 0 || n === 0) {
      this.gaNextTick = tick + GA_RETRY_TICKS;
      return;
    }
    const t = this.gaTypes[this.gaRng.int(0, this.gaTypes.length - 1)];
    this.scheduleArrival(t, tick + GA_LEAD_TICKS, this.gaRng.int(0, 7), this.turnaroundTicks(t), GA_AIRLINE);
    this.gaNextTick = tick + Math.max(GA_MIN_GAP_TICKS, Math.floor((GA_DAY_SPAN_TICKS / n) * (0.5 + this.gaRng.next())));
  }

  /** Called every 10 ticks. */
  updateFlights(tick: number): void {
    this.tick = tick;
    if (this.testPerHour > 0 && this.tick % 50 === 0) {
      // Test traffic is tuned in physical time: the draw happens every 50 ticks (5 s of motion).
      if (this.rng.next() < (this.testPerHour * 5) / 3600) this.generateTestFlight();
    }
    for (let f = 0; f < MAX_FLIGHTS; f++) {
      if (this.fState[f] !== FlState.Scheduled) continue;
      const startAt = this.fEta[f] - Math.round(((APPROACH_START_M + TOUCHDOWN_M) / (AIRCRAFT[this.fType[f]].performance.vrefKt * KT)) * 10);
      if (this.tick < startAt || this.tick < this.fRetryAt[f]) continue;
      this.trySpawnArrival(f);
    }
    if (this.tick % WIND_UPDATE_TICKS === 0 && this.tick > 0) this.updateWind();
  }

  // Runway reservations ----------------------------------------------------

  /**
   * True when one more movement fits the runway's rolling hour budget. Expired movements drop off the
   * head as time passes, so the scan stays O(1) amortised (task T40 R4).
   */
  private movementFree(r: number): boolean {
    if (this.towerLevel < 1) return true;
    const base = r * MOVEMENT_RING;
    while (this.movCount[r] > 0 && this.tick - this.movStart[base + this.movHead[r]] >= MOVEMENT_WINDOW_TICKS) {
      this.movHead[r] = (this.movHead[r] + 1) % MOVEMENT_RING;
      this.movCount[r]--;
    }
    return this.movCount[r] < movementsPerHour(this.towerLevel);
  }

  /** Records a landing or takeoff that is starting now against the runway budget. Taxiing is free. */
  private spendMovement(r: number): void {
    if (this.towerLevel < 1) return;
    const base = r * MOVEMENT_RING;
    this.movStart[base + ((this.movHead[r] + this.movCount[r]) % MOVEMENT_RING)] = this.tick;
    this.movCount[r]++;
  }

  /** Landings plus takeoffs the tower allows per rolling hour across every runway, the total behind movementFree. 0 without a tower. */
  movementBudget(): number {
    return movementsPerHour(this.towerLevel) * this.af.runways.length;
  }

  /** Movements waiting for budget right now: scheduled arrivals plus aircraft still on a stand before push back. */
  atcQueueLength(): number {
    let n = 0;
    for (let f = 0; f < MAX_FLIGHTS; f++) if (this.fState[f] === FlState.Scheduled && this.fMovWait[f] > 0) n++;
    for (let k = 0; k < this.count; k++) {
      const i = this.activeList[k];
      if (this.state[i] === AcState.Turnaround && this.depWait[i] > 0) n++;
    }
    return n;
  }

  /** A runway under works takes no movements (docs/GAME_DESIGN.md section 6, runway tool). */
  private runwayClosed(r: number): boolean {
    const w = this.af.runways[r]?.works;
    return w !== undefined && w.doneTick > this.tick;
  }

  private slotFree(r: number, start: number, end: number, cat: number): boolean {
    if (this.runwayClosed(r)) return false;
    for (let k = 0; k < SLOTS; k++) {
      const o = r * SLOTS + k;
      if (this.rsvCat[o] < 0) continue;
      if (this.rsvEnd[o] < this.tick - 100) {
        this.rsvCat[o] = -1;
        continue;
      }
      const fog = this.weather === 'fog' ? Math.round(300 * this.weatherSeverity) : 0;
      const sepAfter = wakeSeparationSec(WAKE_ORDER[this.rsvCat[o]], WAKE_ORDER[cat]) * 10 + fog;
      const sepBefore = wakeSeparationSec(WAKE_ORDER[cat], WAKE_ORDER[this.rsvCat[o]]) * 10 + fog;
      if (start < this.rsvEnd[o] + sepAfter && end + sepBefore > this.rsvStart[o]) return false;
    }
    return true;
  }

  private reserve(r: number, start: number, end: number, cat: number): number {
    for (let k = 0; k < SLOTS; k++) {
      const o = r * SLOTS + k;
      if (this.rsvCat[o] < 0) {
        this.rsvStart[o] = start;
        this.rsvEnd[o] = end;
        this.rsvCat[o] = cat;
        return o;
      }
    }
    return -1;
  }

  // Arrivals ---------------------------------------------------------------

  /** True when a stand has a taxi node, so an aircraft can route to it. */
  standLinkedPublic(index: number): boolean {
    return this.net.standNode[index] >= 0;
  }

  /** Fills the reused scratch facts for one stand. Hot path, so nothing is allocated. */
  private standFactsOf(s: number): StandFacts {
    const st = this.af.stands[s];
    const f = this.standScratch;
    f.closed = st.closed === true || st.upgradeWorks !== undefined;
    f.accepts = st.accepts;
    f.size = st.size;
    f.surface = st.surface;
    f.type = st.type;
    f.code = st.code;
    f.linked = this.standLinkedPublic(s);
    this.reachStand = s;
    f.contactOk = this.reachOf;
    return f;
  }

  /** Wingspan within the stand size, the stand surface on the type's list and contact reach (docs/DESIGN_REVISION_2.md 3.1). */
  private standFits(t: number, s: number): boolean {
    return refuseFit(this.standFactsOf(s), AIRCRAFT[t]) === null;
  }

  /** The category of flight f: GA for the GA airline, else commercial. Without a flight it follows the type. */
  private categoryOf(f: number, t: number): FlightCategory {
    if (f < 0) return CAT_OF[t];
    return this.fAirline[f] === GA_AIRLINE ? 'ga' : 'commercial';
  }

  /** True when a stand is open and takes the category of flight f (user, 2026-11-17). Without a flight the type decides. */
  private standAllows(t: number, s: number, f = -1): boolean {
    const st = this.af.stands[s];
    return st.closed !== true && st.upgradeWorks === undefined && refuseUsage(st.accepts, this.categoryOf(f, t)) === null;
  }

  /** True when a stand with a taxi node takes general aviation. */
  private gaEligible(s: number): boolean {
    return this.net.standNode[s] >= 0 && (this.af.stands[s].accepts & ACCEPT_GA) !== 0;
  }

  /** Holding points a departure can stop at, for tests and the stand inspector. */
  holdCount(): number {
    return this.net.holds.length;
  }

  /** True when a taxi route leads from the node to any stand the flight may use, free or occupied. */
  private exitReachesStand(t: number, fromNode: number, f: number): boolean {
    for (let s = 0; s < this.af.stands.length; s++) {
      if (this.net.standNode[s] < 0 || !this.standFits(t, s) || !this.standAllows(t, s, f)) continue;
      if (f >= 0 && this.fStand[f] >= 0 && this.af.stands[s].id !== this.fStand[f]) continue;
      if (this.net.route(fromNode, this.net.standNode[s], CODES_OF[t], ACR_OF[t], MASKS[t], this.tmpEdge, this.tmpDir, MAX_ROUTE) >= 0) return true;
    }
    return false;
  }

  private pickStand(t: number, fromNode: number, f = -1): number {
    // A stand the player or the scheduler assigned goes first. Without auto scheduling it is the only choice.
    if (f >= 0 && this.fStand[f] >= 0) {
      // A flight with a stand set waits for that stand and never takes another one (T41 R22).
      const s = this.standIndexOf(this.fStand[f]);
      if (s >= 0 && this.standOwner[s] === -1 && this.net.standNode[s] >= 0 && this.standFits(t, s) && this.standAllows(t, s, f)) {
        const n = this.net.route(fromNode, this.net.standNode[s], CODES_OF[t], ACR_OF[t], MASKS[t], this.tmpEdge, this.tmpDir, MAX_ROUTE);
        if (n >= 0) return s;
      }
      return -1;
    }
    if (!this.autoStands) return -1;
    let best = -1;
    let bestScore = Infinity;
    for (let s = 0; s < this.af.stands.length; s++) {
      if (this.standOwner[s] !== -1 || this.net.standNode[s] < 0) continue;
      if (!this.standFits(t, s) || !this.standAllows(t, s, f)) continue;
      // Own size first, then the next larger (user, 2026-11-17). standFits already bars smaller sizes.
      const score = sizeGap(this.af.stands[s].size, AIRCRAFT[t]) * 100 + s * 0.01;
      if (score >= bestScore) continue;
      const n = this.net.route(fromNode, this.net.standNode[s], CODES_OF[t], ACR_OF[t], MASKS[t], this.tmpEdge, this.tmpDir, MAX_ROUTE);
      if (n < 0) continue;
      bestScore = score;
      best = s;
    }
    return best;
  }

  /** Index of a stand by its id in the airfield copy, or -1 when it no longer exists. */
  private standIndexOf(id: number): number {
    return this.af.stands.findIndex((x) => x.id === id);
  }

  /** True while a flight is still due to hold a stand: scheduled, inbound or on the ground. */
  occupies(g: number): boolean {
    const st = this.fState[g];
    return st === FlState.Scheduled || st === FlState.Inbound || st === FlState.OnGround;
  }

  /** Records one flight's stand block in the reused occupancy scratch, in ticks. */
  private addOccupancy(g: number, s: number): void {
    const k = this.occCount++;
    this.occStand[k] = s;
    this.occStart[k] = this.fEta[g];
    this.occEnd[k] = this.fEta[g] + this.fTurn[g] + STAND_BLOCK_BUFFER_TICKS;
  }

  /** True when a recorded block on stand s overlaps the tick span from..to, buffer included. */
  private clashes(s: number, from: number, to: number): boolean {
    for (let k = 0; k < this.occCount; k++) if (this.occStand[k] === s && this.occStart[k] < to && this.occEnd[k] > from) return true;
    return false;
  }

  /** A flight's stand block in absolute game minutes: arrival to the end of the turn plus the buffer. The one span math both the rule and the payload use. */
  flightBlock(f: number): BlockWindow {
    return blockWindow(this.fEta[f] / TICKS_PER_MINUTE, this.fTurn[f] / TICKS_PER_MINUTE);
  }

  /** Why a flight cannot take a stand: the stand rule first, then a clash with another flight's block. Null when it may. */
  refuseAssign(f: number, standId: number): StandRefusal | null {
    const s = this.standIndexOf(standId);
    if (s < 0) return 'standNoLink';
    const r = refuseStand(this.standFactsOf(s), AIRCRAFT[this.fType[f]], this.categoryOf(f, this.fType[f]));
    if (r !== null) return r;
    const mine = this.flightBlock(f);
    for (let g = 0; g < MAX_FLIGHTS; g++) {
      if (g === f || this.fStand[g] !== standId || !this.occupies(g)) continue;
      if (blocksOverlap(mine, this.flightBlock(g))) return 'standBusy';
    }
    return null;
  }

  /** Why a stand cannot take a commercial flight of this type, other flights aside (weekly planner, T61). Null when it can. */
  refuseStandType(t: number, standId: number): StandRefusal | null {
    const s = this.standIndexOf(standId);
    if (s < 0) return 'standNoLink';
    return refuseStand(this.standFactsOf(s), AIRCRAFT[t], 'commercial');
  }

  /** Stand ids a type may use, own size first, then the next larger (user, 2026-11-17), then by index. */
  standOrder(t: number): number[] {
    const out: { id: number; score: number }[] = [];
    for (let s = 0; s < this.af.stands.length; s++) {
      if (!this.standFits(t, s)) continue;
      out.push({ id: this.af.stands[s].id, score: sizeGap(this.af.stands[s].size, AIRCRAFT[t]) * 1000 + s });
    }
    return out.sort((p, q) => p.score - q.score).map((x) => x.id);
  }

  /** True when some open runway lets the type take off over its full length with the fuel for the stage (section 3.2). */
  takeoffOkFor(t: number, stageKm: number): boolean {
    const share = takeoffWeight(AIRCRAFT[t], stageKm, 0.75).share;
    for (let r = 0; r < this.af.runways.length; r++) {
      if (this.runwayClosed(r)) continue;
      const rw = this.af.runways[r];
      for (const dir of [1, -1] as const) if (checkTakeoff(AIRCRAFT[t], rw, rw.lengthM, this.site.climate, this.lengthFactor(rw, dir), share).ok) return true;
    }
    return false;
  }

  /** Gives every unassigned scheduled flight a stand that is free for its whole stay, earliest first. */
  autoAssign(): void {
    const order: number[] = [];
    for (let f = 0; f < MAX_FLIGHTS; f++) if (this.fState[f] === FlState.Scheduled && this.fStand[f] < 0) order.push(f);
    order.sort((a, b) => this.fEta[a] - this.fEta[b] || a - b);
    this.occCount = 0;
    for (let g = 0; g < MAX_FLIGHTS; g++) {
      if (this.fStand[g] < 0 || !this.occupies(g)) continue;
      const s = this.standIndexOf(this.fStand[g]);
      if (s >= 0) this.addOccupancy(g, s);
    }
    for (const f of order) {
      const t = this.fType[f];
      const from = this.fEta[f] - STAND_BLOCK_BUFFER_TICKS;
      const to = this.fEta[f] + this.fTurn[f] + STAND_BLOCK_BUFFER_TICKS;
      let best = -1;
      let bestScore = Infinity;
      for (let s = 0; s < this.af.stands.length; s++) {
        if (this.net.standNode[s] < 0 || !this.standFits(t, s) || !this.standAllows(t, s, f)) continue;
        if (this.clashes(s, from, to)) continue;
        const score = sizeGap(this.af.stands[s].size, AIRCRAFT[t]) * 100 + s * 0.01;
        if (score < bestScore) {
          bestScore = score;
          best = s;
        }
      }
      if (best >= 0) {
        this.fStand[f] = this.af.stands[best].id;
        this.addOccupancy(f, best);
      }
    }
  }

  private refuse(f: number, reason: string, extra: string): void {
    this.emit(`flightRefused|type=${AIRCRAFT[this.fType[f]].id}|reason=${reason}${extra}`);
  }

  private delay(f: number, reason: string): void {
    this.fDelay[f] += RETRY_TICKS;
    this.fRetryAt[f] = this.tick + RETRY_TICKS;
    if (this.fDelay[f] > MAX_DELAY_TICKS) this.divert(f, reason);
  }

  /**
   * Holds an arrival whose movement the tower has no budget for. Only this wait counts toward the 30
   * game minute ATC window, so a stand or runway wait keeps its own 20 minute limit (T40 R4).
   */
  private atcWait(f: number): void {
    this.fMovWait[f] += RETRY_TICKS;
    this.fRetryAt[f] = this.tick + RETRY_TICKS;
    if (this.fMovWait[f] >= ATC_MAX_WAIT_TICKS) this.divert(f, 'noMovement');
  }

  private divert(f: number, reason: string): void {
    this.fState[f] = FlState.Done;
    this.divertedFlights++;
    this.emit(`flightDiverted|type=${AIRCRAFT[this.fType[f]].id}|reason=${reason}`);
  }

  private trySpawnArrival(f: number): void {
    const t = this.fType[f];
    const a = AIRCRAFT[t];
    const af = this.af;
    // Below the fire category the type needs, airline flights are refused once the grace has run out (T65). GA never is.
    if (this.fireEnforced && this.fAirline[f] !== GA_AIRLINE) {
      const needed = neededCategory(a.dimensions.lengthM);
      if (needed > this.fireCategory) {
        this.refuse(f, 'fireCategory', `|needed=${needed}|available=${this.fireCategory}`);
        this.fState[f] = FlState.Done;
        this.divertedFlights++;
        return;
      }
    }
    // Runway ends the type can land on, best headwind first. A later end is taken when no exit of a
    // better one leads to a free stand, for example behind a one way taxiway.
    const cands: { r: number; dir: 1 | -1; hw: number }[] = [];
    let firstFail = '';
    for (let r = 0; r < af.runways.length; r++) {
      const rw = af.runways[r];
      if (this.runwayClosed(r)) {
        firstFail = firstFail || 'runwayWorks|needed=0|available=0';
        continue;
      }
      const obs = this.obstacles.find((o) => o.runwayId === rw.id);
      const lim = checkLanding(a, rw, this.lengthFactor(rw, 1));
      if (!lim.ok) {
        if (!firstFail) firstFail = `${lim.reason}|needed=${lim.needed}|available=${lim.available}`;
        continue;
      }
      for (const dir of [1, -1] as const) {
        // In fog only an instrument approach clear of obstacles in that direction works.
        const approach = obs ? (dir === 1 ? obs.approachA : obs.approachB) : rw.approach;
        if (this.weather === 'fog' && approach === 'visual') {
          firstFail = firstFail || 'fog|needed=0|available=0';
          continue;
        }
        const hdg = dir === 1 ? rw.headingDeg : (rw.headingDeg + 180) % 360;
        const limit = a.weights.mtowKg < 30000 ? 15 : 20;
        if (this.crosswind(hdg) > limit) continue;
        cands.push({ r, dir, hw: this.headwind(hdg) });
      }
    }
    if (cands.length === 0) {
      if (firstFail) {
        const parts = firstFail.split('|');
        this.refuse(f, parts[0], `|${parts[1]}|${parts[2]}`);
        this.fState[f] = FlState.Done;
        this.divertedFlights++;
        return;
      }
      this.delay(f, 'crosswind');
      return;
    }
    // Stable order: headwind first, then the build order of the runway ends.
    cands.sort((p, q) => q.hw - p.hw || p.r - q.r || q.dir - p.dir);
    const vTd = a.performance.vrefKt * KT * 0.95;
    const vExit = a.derivedForReading.code === 'A' || a.derivedForReading.code === 'B' ? 8 : 15;
    const decel = a.weights.mtowKg > 200000 ? 1.8 : 2.2;
    const minRoll = (vTd * vTd - vExit * vExit) / (2 * decel);
    let bestR = -1;
    let bestDir: 1 | -1 = 1;
    let chosen = -1;
    let stand = -1;
    let sExit = 0;
    let anyExit = false;
    let routeBlocked = false;
    for (const c of cands) {
      const crw = af.runways[c.r];
      // Candidate exits ordered along the landing direction.
      const exits: { idx: number; s: number }[] = [];
      af.entries.forEach((e, idx) => {
        if (e.runwayId !== crw.id || this.net.entryNode[idx] < 0) return;
        const dAlong = Math.hypot(e.x - crw.x1, e.y - crw.y1);
        exits.push({ idx, s: c.dir === 1 ? dAlong : crw.lengthM - dAlong });
      });
      exits.sort((p, q) => p.s - q.s);
      const viable = exits.filter((e) => e.s >= TOUCHDOWN_M + minRoll);
      const ordered = viable.length > 0 ? viable : exits.slice(-1);
      if (ordered.length > 0) anyExit = true;
      for (const ex of ordered) {
        if (this.exitQueued(ex.idx) || this.entryDeparting[ex.idx] > 0) continue;
        const s = this.pickStand(t, this.net.entryNode[ex.idx], f);
        if (s >= 0) {
          chosen = ex.idx;
          stand = s;
          sExit = ex.s;
          break;
        }
      }
      if (chosen >= 0) {
        bestR = c.r;
        bestDir = c.dir;
        break;
      }
      // Busy exits or full stands clear by waiting. Only an end whose exits reach no stand the type
      // may use, occupied or not, hands the landing to the next best end.
      let reaches = false;
      for (const ex of ordered) reaches = reaches || this.exitReachesStand(t, this.net.entryNode[ex.idx], f);
      if (reaches) break;
      if (ordered.length > 0) routeBlocked = true;
    }
    if (chosen < 0) {
      this.delay(f, !anyExit ? 'noExit' : routeBlocked ? 'noRoute' : 'noStand');
      return;
    }
    // A departure that has waited too long goes first: new landings wait their turn until it is away.
    if (this.departureStarving(bestR)) {
      this.delay(f, 'runwayBusy');
      return;
    }
    // The tower meters landings too. A blocked flight keeps its chosen exit and stand and retries.
    if (!this.movementFree(bestR)) {
      this.atcWait(f);
      return;
    }
    // Runway window for the landing.
    const approachTicks = Math.round(((APPROACH_START_M + TOUCHDOWN_M) / (a.performance.vrefKt * KT)) * 10);
    const rollTicks = Math.round(((2 * (sExit - TOUCHDOWN_M)) / (vTd + vExit)) * 10);
    const start = this.tick + approachTicks - 100;
    const end = this.tick + approachTicks + rollTicks + RUNWAY_OCCUPANCY.landingRollout * 2;
    if (!this.slotFree(bestR, start, end, WAKE_OF[t])) {
      this.delay(f, 'runwayBusy');
      return;
    }
    this.fLate[f] = Math.max(0, this.tick + approachTicks - this.fEta[f]);
    const slot = this.reserve(bestR, start, end, WAKE_OF[t]);
    if (slot < 0) {
      this.delay(f, 'runwayBusy');
      return;
    }
    const ac = this.allocAircraft();
    if (ac < 0) {
      this.delay(f, 'noAircraftSlot');
      return;
    }
    // Route from the exit to the chosen stand.
    const n = this.net.route(this.net.entryNode[chosen], this.net.standNode[stand], CODES_OF[t], ACR_OF[t], MASKS[t], this.tmpEdge, this.tmpDir, MAX_ROUTE);
    for (let k = 0; k < n; k++) {
      this.routeEdge[ac * MAX_ROUTE + k] = this.tmpEdge[k];
      this.routeDir[ac * MAX_ROUTE + k] = this.tmpDir[k];
    }
    this.routeLen[ac] = n;
    this.routeIdx[ac] = 0;
    this.fMovWait[f] = 0;
    this.spendMovement(bestR);
    this.standOwner[stand] = ac;
    this.standId[ac] = af.stands[stand].id;
    this.type[ac] = t;
    this.livery[ac] = this.fLivery[f];
    this.flight[ac] = f;
    this.fAc[f] = ac;
    this.fState[f] = FlState.Inbound;
    this.state[ac] = AcState.Approach;
    this.rwyIdx[ac] = bestR;
    this.rwyDir[ac] = bestDir;
    this.rwyS[ac] = -APPROACH_START_M;
    this.rwyExitS[ac] = sExit;
    this.rwySlot[ac] = slot;
    this.entryIdx[ac] = chosen;
    this.entryInbound[chosen]++;
    this.entryCounted[ac] = 1;
    this.speed[ac] = a.performance.vrefKt * KT;
    this.goalX[ac] = this.net.nodeX[this.net.standNode[stand]];
    this.goalY[ac] = this.net.nodeY[this.net.standNode[stand]];
    this.placeOnRunway(ac);
  }

  private departureStarving(r: number): boolean {
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (this.state[j] === AcState.Holding && this.rwyIdx[j] === r && this.tick - this.timer[j] > 1200) return true;
    }
    return false;
  }

  /** True when a departing aircraft is waiting on the connector of this runway entry. */
  private exitQueued(entry: number): boolean {
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      const st = this.state[j];
      if ((st === AcState.Holding || st === AcState.LineUp || st === AcState.TaxiOut) && this.entryIdx[j] === entry) {
        const b = j * MAX_ROUTE + this.routeIdx[j];
        if (this.routeIdx[j] === this.routeLen[j] - 1 && this.net.edgeLen[this.routeEdge[b]] - this.dist[j] < 200) return true;
      }
    }
    return false;
  }

  private allocAircraft(): number {
    for (let i = 0; i < MAX_AIRCRAFT; i++) {
      if (this.active[i] === 0) {
        this.active[i] = 1;
        this.heldNode[i] = -1;
        this.claimFrom[i] = -1;
        this.claimTo[i] = -1;
        this.oppWait[i] = 0;
        this.towIdx[i] = -1;
        this.nextAcq[i] = -1;
        this.waitingFor[i] = -1;
        this.reqNode[i] = -1;
        this.ignoreLocks[i] = 0;
        this.yieldUntil[i] = 0;
        this.stuckTicks[i] = 0;
        this.rwySlot[i] = -1;
        this.depWait[i] = 0;
        this.depRetryAt[i] = 0;
        this.rebuildActive();
        return i;
      }
    }
    return -1;
  }

  private rebuildActive(): void {
    let n = 0;
    for (let i = 0; i < MAX_AIRCRAFT; i++) if (this.active[i] === 1) this.activeList[n++] = i;
    this.count = n;
  }

  private removeAircraft(i: number, why: string): void {
    this.uncount(i);
    this.releaseAll(i);
    const f = this.flight[i];
    if (f >= 0) {
      this.fState[f] = FlState.Done;
      this.fAc[f] = -1;
      if (why === 'departed') {
        this.completedFlights++;
        this.hooks?.departed(f);
      }
      else this.emit(`flightLost|type=${AIRCRAFT[this.type[i]].id}`);
    }
    const s = this.af.stands.findIndex((st) => st.id === this.standId[i]);
    if (s >= 0 && this.standOwner[s] === i) this.standOwner[s] = -1;
    this.active[i] = 0;
    this.state[i] = AcState.Free;
    this.flight[i] = -1;
    this.standId[i] = -1;
    this.rebuildActive();
  }

  private uncount(i: number): void {
    const c = this.entryCounted[i];
    const e = this.entryIdx[i];
    if (c === 1 && e >= 0 && e < this.entryInbound.length && this.entryInbound[e] > 0) this.entryInbound[e]--;
    if (c === 2 && e >= 0 && e < this.entryDeparting.length && this.entryDeparting[e] > 0) this.entryDeparting[e]--;
    this.entryCounted[i] = 0;
  }

  private releaseAll(i: number): void {
    if (this.heldNode[i] >= 0) {
      if (this.nodeOwner[this.heldNode[i]] === i) this.nodeOwner[this.heldNode[i]] = -1;
      this.heldNode[i] = -1;
    }
    this.dropClaim(i);
    this.nextAcq[i] = -1;
    this.waitingFor[i] = -1;
    this.oppWait[i] = 0;
    this.reqNode[i] = -1;
  }

  // Position on the runway -------------------------------------------------

  private placeOnRunway(i: number): void {
    const r = this.af.runways[this.rwyIdx[i]];
    if (!r) return;
    const dir = this.rwyDir[i];
    const bx = dir === 1 ? r.x1 : r.x2;
    const by = dir === 1 ? r.y1 : r.y2;
    const d = compassVector(dir === 1 ? r.headingDeg : (r.headingDeg + 180) % 360);
    this.x[i] = bx + d.x * this.rwyS[i];
    this.y[i] = by + d.y * this.rwyS[i];
    this.heading[i] = atan2Det(d.y, d.x);
  }

  // Per tick ---------------------------------------------------------------

  /** Moves every aircraft one tick. */
  // hot
  update(tick: number): void {
    this.tick = tick;
    for (let k = 0; k < this.count; k++) {
      const i = this.activeList[k];
      if (this.active[i] === 0) continue;
      switch (this.state[i]) {
        case AcState.Approach:
        case AcState.Rollout:
          this.updateLanding(i);
          break;
        case AcState.TaxiIn:
        case AcState.TaxiOut:
        case AcState.Pushback:
        case AcState.Holding:
        case AcState.LineUp:
          this.updateGround(i);
          break;
        case AcState.Turnaround:
          this.updateTurnaround(i);
          break;
        case AcState.Takeoff:
          this.updateTakeoff(i);
          break;
        case AcState.Backtrack:
          this.updateBacktrack(i);
          break;
        case AcState.TowBack:
          this.updateTow(i);
          break;
        default:
          break;
      }
    }
    if (tick % 20 === 0) this.detectDeadlocks();
    if (tick % 50 === 0) this.updateCongestion();
  }

  private updateLanding(i: number): void {
    const t = this.type[i];
    const a = AIRCRAFT[t];
    const vTd = a.performance.vrefKt * KT * 0.95;
    const vExit = CODES_OF[t] === 'A' || CODES_OF[t] === 'B' ? 8 : 15;
    if (this.state[i] === AcState.Approach) {
      this.speed[i] = a.performance.vrefKt * KT;
      this.rwyS[i] += this.speed[i] * DT;
      if (this.rwyS[i] >= TOUCHDOWN_M) {
        this.state[i] = AcState.Rollout;
        this.speed[i] = vTd;
      }
    } else {
      const decel = a.weights.mtowKg > 200000 ? 1.8 : 2.2;
      const sExit = this.rwyExitS[i];
      const need = (vTd * vTd - vExit * vExit) / (2 * Math.max(1, sExit - TOUCHDOWN_M));
      const aEff = Math.max(decel, need);
      const remaining = Math.max(0, sExit - this.rwyS[i]);
      const limit = Math.sqrt(vExit * vExit + 2 * aEff * remaining);
      this.speed[i] = Math.max(vExit, Math.min(this.speed[i], limit));
      this.rwyS[i] += this.speed[i] * DT;
      if (this.rwyS[i] >= sExit) {
        // Wait on the runway at the exit until the connector is clear of other aircraft.
        // A claim held the other way on the exit itself keeps the arrival on the runway too (T87). Held only
        // further on, the arrival vacates onto the exit and holds short at its first junction.
        const opposed = this.claimBlocker(i, 0, this.sameBlockEnd(i, 0));
        if (opposed >= 0) this.waitingFor[i] = opposed;
        if (opposed >= 0 || this.connectorBusy(this.net.entryNode[this.entryIdx[i]], i)) {
          this.rwyS[i] = sExit;
          this.speed[i] = 0;
          if (this.rwySlot[i] >= 0) this.rsvEnd[this.rwySlot[i]] = this.tick + 300;
        } else {
          this.beginTaxiIn(i);
          return;
        }
      }
    }
    this.placeOnRunway(i);
  }

  private connectorBusy(node: number, self: number): boolean {
    const nx = this.net.nodeX[node];
    const ny = this.net.nodeY[node];
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === self) continue;
      const s = this.state[j];
      if (s !== AcState.TaxiIn && s !== AcState.TaxiOut && s !== AcState.Pushback && s !== AcState.Holding && s !== AcState.LineUp && s !== AcState.TowBack) continue;
      if (Math.hypot(this.x[j] - nx, this.y[j] - ny) < 45) return true;
    }
    return false;
  }

  private beginTaxiIn(i: number): void {
    const slot = this.rwySlot[i];
    if (slot >= 0) {
      // Keep the runway reserved while the aircraft drives clear of the exit connector.
      this.rsvEnd[slot] = this.tick + 250;
      this.rwySlot[i] = -1;
    }
    this.state[i] = AcState.TaxiIn;
    const node = this.net.entryNode[this.entryIdx[i]];
    this.nodeOwner[node] = i;
    this.heldNode[i] = node;
    this.routeIdx[i] = 0;
    this.dist[i] = 0;
    this.speed[i] = Math.min(this.speed[i], 10);
    this.rwyIdx[i] = -1;
    this.waitingFor[i] = -1;
    // Claim the two way stretch past the exit so departures do not drive onto it from the other end, or the
    // exit alone when the rest is held the other way.
    const full = this.runEnd(i, 0);
    this.grantClaim(i, 0, this.claimBlocker(i, 0, full) < 0 ? full : this.sameBlockEnd(i, 0));
    this.applyEdgePose(i);
  }

  private applyEdgePose(i: number): void {
    const k = i * MAX_ROUTE + this.routeIdx[i];
    const e = this.routeEdge[k];
    const dir = this.routeDir[k];
    const len = this.net.edgeLen[e];
    const coord = dir === 1 ? this.dist[i] : len - this.dist[i];
    this.net.pointAt(e, coord, this.pos);
    let h = this.pos.h;
    if (dir === -1 && this.state[i] !== AcState.Pushback) h += PI;
    // Near a junction node the aircraft drives the turn curve the paint shows instead of the corner (T84).
    const st = this.state[i];
    if (st === AcState.TaxiIn || st === AcState.TaxiOut || st === AcState.TowBack) {
      const idx = this.routeIdx[i];
      if (idx + 1 < this.routeLen[i] && this.cornerPose(e, dir, this.routeEdge[k + 1], this.routeDir[k + 1], this.dist[i] - len)) h = this.pos.h;
      else if (idx > 0 && this.cornerPose(this.routeEdge[k - 1], this.routeDir[k - 1], e, dir, this.dist[i])) h = this.pos.h;
    }
    this.x[i] = this.pos.x;
    this.y[i] = this.pos.y;
    const dh = turnWrap(h - this.heading[i]);
    // Limit the turn rate so corners look smooth, but never lag far behind.
    const maxTurn = TURN_RATE * DT * 4;
    this.heading[i] += Math.abs(dh) < maxTurn ? dh : dh > 0 ? maxTurn : -maxTurn;
  }

  /** A point `travelled` meters along an edge in travel direction `dir`. */
  private alongRoute(e: number, dir: number, travelled: number, out: Scratch): void {
    const len = this.net.edgeLen[e];
    this.net.pointAt(e, dir === 1 ? travelled : len - travelled, out);
  }

  /**
   * The pose on the turn curve between two taxi edges that meet at a node, `s` meters from the node
   * along the route (negative before it), written to `this.pos` with the travel heading. False when
   * the aircraft is outside the curve, the edges run straight on or turn back, or one is not a taxi
   * edge. The curve has the taxiway turn radius of the smaller code, tangent to both edges, as the
   * fillets of `nodeGeometry` draw it. It is a rational quadratic Bezier with its control point on
   * the node, which is an exact circular arc, so it needs no trigonometry and stays deterministic.
   */
  private cornerPose(inE: number, inDir: number, outE: number, outDir: number, s: number): boolean {
    const net = this.net;
    if (!isTaxiEdge(net.edgeKind[inE]) || !isTaxiEdge(net.edgeKind[outE])) return false;
    const lenIn = net.edgeLen[inE];
    const lenOut = net.edgeLen[outE];
    const cap = 0.5 * Math.min(lenIn, lenOut);
    const r = AIRFIELD.codes[CODES[Math.min(net.edgeMaxCode[inE], net.edgeMaxCode[outE])]].turnRadiusM;
    const probe = Math.min(cap, r);
    if (probe <= 0 || Math.abs(s) >= probe * MAX_TAN_HALF) return false;
    const N = this.cornerN;
    const A = this.cornerA;
    const B = this.cornerB;
    this.alongRoute(inE, inDir, lenIn, N);
    this.alongRoute(inE, inDir, lenIn - probe, A);
    this.alongRoute(outE, outDir, probe, B);
    let ux = N.x - A.x;
    let uy = N.y - A.y;
    let vx = B.x - N.x;
    let vy = B.y - N.y;
    const ul = Math.sqrt(ux * ux + uy * uy);
    const vl = Math.sqrt(vx * vx + vy * vy);
    if (ul < 1e-6 || vl < 1e-6) return false;
    ux /= ul;
    uy /= ul;
    vx /= vl;
    vy /= vl;
    const c = ux * vx + uy * vy;
    if (c > STRAIGHT_COS || c < TURN_BACK_COS) return false;
    const td = Math.min(r * Math.sqrt((1 - c) / (1 + c)), cap);
    if (Math.abs(s) >= td) return false;
    this.alongRoute(inE, inDir, lenIn - td, A);
    this.alongRoute(outE, outDir, td, B);
    const w = Math.sqrt((1 + c) / 2);
    const t = (s + td) / (2 * td);
    const b0 = (1 - t) * (1 - t);
    const b1 = 2 * t * (1 - t) * w;
    const b2 = t * t;
    const d = b0 + b1 + b2;
    const px = (b0 * A.x + b1 * N.x + b2 * B.x) / d;
    const py = (b0 * A.y + b1 * N.y + b2 * B.y) / d;
    // Derivative direction: N'(t) D(t) - N(t) D'(t), with D'(t) = 2 (1 - 2t) (w - 1).
    const db0 = -2 * (1 - t);
    const db1 = 2 * (1 - 2 * t) * w;
    const db2 = 2 * t;
    const dd = db0 + db1 + db2;
    const tx = (db0 * A.x + db1 * N.x + db2 * B.x) * d - (b0 * A.x + b1 * N.x + b2 * B.x) * dd;
    const ty = (db0 * A.y + db1 * N.y + db2 * B.y) * d - (b0 * A.y + b1 * N.y + b2 * B.y) * dd;
    this.pos.x = px;
    this.pos.y = py;
    this.pos.h = atan2Det(ty, tx);
    return true;
  }

  // Ground movement --------------------------------------------------------

  private updateGround(i: number): void {
    const st = this.state[i];
    if (st === AcState.Holding) {
      if (this.tick % 10 === i % 10) this.tryClearDeparture(i);
      return;
    }
    const t = this.type[i];
    const net = this.net;
    const base = i * MAX_ROUTE;
    const idx = this.routeIdx[i];
    const e = this.routeEdge[base + idx];
    const dir = this.routeDir[base + idx];
    const len = net.edgeLen[e];
    const last = idx === this.routeLen[i] - 1;
    let vmax = st === AcState.Pushback ? PUSHBACK_SPEED : Math.min(net.edgeSpeed[e], 15);
    if (st === AcState.LineUp) vmax = 6;
    let goal: number;
    if (last) {
      goal = st === AcState.TaxiOut ? len - this.holdDistFor(i) : len;
      if (st === AcState.TaxiIn) goal = this.dockGoal(i, e, len);
      if (st === AcState.LineUp) goal = len;
      if (st === AcState.Holding) goal = this.dist[i];
    } else {
      goal = len;
      // Ask for the junction and the next edge when close enough.
      const nextE = this.routeEdge[base + idx + 1];
      const node = dir === 1 ? net.edgeTo[e] : net.edgeFrom[e];
      const hold = this.holdShortM(i, node);
      const lookahead = Math.max(60, this.speed[i] * 8) + hold;
      if (len - this.dist[i] < lookahead && this.nextAcq[i] !== nextE) {
        if (this.tick < this.yieldUntil[i] || !this.tryEnter(i, node, nextE)) goal = Math.max(0, len - hold);
      }
    }
    if (st === AcState.Pushback) {
      // Pushback needs the junction and its surroundings clear.
      if (this.dist[i] < this.pushStartLimit(i, e, len) && !this.pushbackClear(i)) {
        this.speed[i] = 0;
        return;
      }
    }
    // Brake for the goal.
    const toGoal = Math.max(0, goal - this.dist[i]);
    let allowed = Math.min(vmax, Math.sqrt(2 * TAXI_DECEL * Math.max(0, toGoal - 0.1)));
    // Keep a gap to the aircraft ahead.
    const gap = this.leaderLimit(i, e, dir, idx, last);
    if (gap < allowed) allowed = gap;
    // Stopped by an aircraft coming the other way: name it, so the deadlock check sees the pair (T87).
    if (this.oppBlocker >= 0 && allowed < 0.05) {
      if (this.waitingFor[i] < 0 || this.oppWait[i] === 1) {
        this.waitingFor[i] = this.oppBlocker;
        this.oppWait[i] = 1;
      }
    } else if (this.oppWait[i] === 1) {
      this.waitingFor[i] = -1;
      this.oppWait[i] = 0;
    }
    if (this.speed[i] < allowed) this.speed[i] = Math.min(allowed, this.speed[i] + TAXI_ACCEL * DT);
    else this.speed[i] = Math.max(allowed, this.speed[i] - TAXI_DECEL * 1.5 * DT);
    this.dist[i] += this.speed[i] * DT;
    if (this.speed[i] < 0.05) this.stuckTicks[i]++;
    else this.stuckTicks[i] = 0;
    if (this.ignoreLocks[i] > 0) this.ignoreLocks[i]--;

    if (!last && this.dist[i] >= len - 0.35) {
      // Cross into the next edge only once the junction is reserved.
      const nextE = this.routeEdge[base + idx + 1];
      if (this.nextAcq[i] === nextE || this.ignoreLocks[i] > 0) {
        this.nextAcq[i] = -1;
        this.routeIdx[i] = idx + 1;
        if (st === AcState.TaxiIn && this.entryCounted[i] === 1) this.uncount(i);
        if (st === AcState.Pushback && this.net.edgeKind[nextE] !== EdgeKind.StandFork) {
          // Push back runs along the lead in and a fork arc and ends on the taxilane: free the stand for the
          // next arrival and taxi under own power.
          this.state[i] = AcState.TaxiOut;
          const sIdx = this.af.stands.findIndex((x) => x.id === this.standId[i]);
          if (sIdx >= 0 && this.standOwner[sIdx] === i) this.standOwner[sIdx] = -1;
          this.standId[i] = -1;
        } else if (st === AcState.TaxiOut && this.standId[i] >= 0 && this.net.edgeKind[e] === EdgeKind.StandLeadOut && this.net.edgeKind[nextE] !== EdgeKind.StandLeadOut) {
          // A forward departure from a pass through stand frees the stand where its lead out meets the taxilane (T72).
          const sIdx = this.af.stands.findIndex((x) => x.id === this.standId[i]);
          if (sIdx >= 0 && this.standOwner[sIdx] === i) this.standOwner[sIdx] = -1;
          this.standId[i] = -1;
        }
        this.dist[i] -= len;
        if (this.dist[i] < 0) this.dist[i] = 0;
      } else {
        this.dist[i] = len - 0.35;
        this.speed[i] = 0;
      }
    } else if (!last && this.dist[i] > len) {
      this.dist[i] = len;
    }
    this.releaseBehind(i, t);
    if (last) this.checkArrivedAtEnd(i, len, goal);
    this.applyEdgePose(i);
  }

  /** Distance along the last edge where a taxiing in aircraft parks: its nose gear on the stop bar of its type, which puts the centre behind the stand point. */
  private dockGoal(i: number, e: number, len: number): number {
    if (this.net.edgeKind[e] !== EdgeKind.StandLeadIn) return len;
    const st = this.af.stands[this.net.edgeStand[e]];
    if (!st) return len;
    return Math.max(0, Math.min(len, len + PARKED_OFFSET[SIZE_INDEX[st.size] * AIRCRAFT.length + this.type[i]]));
  }

  /** Distance along the edge below which a push back is still at its start: half a meter past where the aircraft is parked. */
  private pushStartLimit(i: number, e: number, len: number): number {
    if (this.routeIdx[i] !== 0) return 0.5;
    return 0.5 + (len - this.dockGoal(i, e, len));
  }

  /** The no road penalty of the stand an aircraft docked at, for a commercial flight; general aviation never pays it (D2). */
  private roadFactor(i: number, f: number): number {
    if (this.fAirline[f] === GA_AIRLINE) return 1;
    const s = this.af.stands.findIndex((x) => x.id === this.standId[i]);
    return s >= 0 && s < this.standRoadFactor.length ? this.standRoadFactor[s] : 1;
  }

  private holdDistFor(i: number): number {
    const idx = this.entryIdx[i];
    for (const h of this.net.holds) if (h.entryIdx === idx) return h.holdDist;
    return 60;
  }

  private checkArrivedAtEnd(i: number, len: number, goal: number): void {
    const st = this.state[i];
    if (st === AcState.TaxiIn && this.dist[i] >= goal - 0.3 && this.speed[i] < 0.6) {
      // An aircraft restored past the new stop point parks where it is.
      if (this.dist[i] <= goal) this.dist[i] = goal;
      this.speed[i] = 0;
      this.releaseAll(i);
      this.state[i] = AcState.Turnaround;
      const f = this.flight[i];
      // An airline flight runs its task list with real vehicles, so the abstract fleet slowdown no longer applies to it (T63).
      this.tasked[i] = f >= 0 && this.fAirline[f] >= 0 ? 1 : 0;
      const slow = this.tasked[i] === 1 ? 1 : this.serviceSlowdown;
      this.timer[i] = f >= 0 ? Math.round(this.fTurn[f] * slow * this.roadFactor(i, f)) : 45 * TICKS_PER_MINUTE;
      this.fuelOwed[i] = 0;
      this.fuelWait[i] = 0;
      this.boardHold[i] = 0;
      if (f >= 0) {
        this.fState[f] = FlState.OnGround;
        this.hooks?.docked(f);
      }
      this.applyEdgePose(i);
    } else if (st === AcState.TaxiOut && this.dist[i] >= goal - 0.3 && this.speed[i] < 0.6) {
      this.state[i] = AcState.Holding;
      this.timer[i] = this.tick;
      this.speed[i] = 0;
    } else if (st === AcState.LineUp && this.dist[i] >= len - 0.3) {
      this.beginTakeoff(i);
    }
  }

  /** Frees the junction and the edge lock behind the aircraft once its tail has cleared. */
  private releaseBehind(i: number, t: number): void {
    const a = AIRCRAFT[t];
    // Claimed edges behind the aircraft are let go once its tail has cleared them.
    if (this.claimTo[i] >= 0) {
      const idx = this.routeIdx[i];
      let from = this.claimFrom[i];
      while (from < idx && (from < idx - 1 || this.dist[i] >= a.dimensions.lengthM * 0.6)) from++;
      if (from > this.claimTo[i]) this.dropClaim(i);
      else if (from !== this.claimFrom[i]) {
        this.claimFrom[i] = from;
        this.countsDirty = true;
      }
    }
    if (this.heldNode[i] >= 0 && this.nextAcq[i] < 0 && this.dist[i] >= a.dimensions.wingspanM * 0.5 + 8) {
      if (this.nodeOwner[this.heldNode[i]] === i) this.nodeOwner[this.heldNode[i]] = -1;
      this.heldNode[i] = -1;
    }
  }

  /**
   * What stops aircraft i from entering the junction `node` onto `nextE`, without writing any state.
   * -1 when free, the aircraft index that holds it, or -2 when a stand lead refuses it with no one to wait for.
   */
  private entryBlocker(i: number, node: number, nextE: number): number {
    const net = this.net;
    const ignore = this.ignoreLocks[i] > 0;
    const owner = this.nodeOwner[node];
    if (owner !== -1 && owner !== i && !ignore) return owner;
    if (!ignore) {
      const j = this.conflictHolder(i, node, nextE);
      if (j >= 0) return j;
    }
    // Two way pavement ahead is claimed as a whole run, up to where the route leaves it (T87).
    const k0 = this.routeIdx[i] + 1;
    if (!ignore && net.edgeBlock[nextE] >= 0 && !this.inClaim(i, k0)) {
      const j = this.claimBlocker(i, k0, this.runEnd(i, k0));
      if (j >= 0) return j;
    }
    // A stand lead in and its fork arcs are only for the aircraft that owns the stand, so an arrival
    // waits on the taxilane and never blocks the way out of the aircraft still on the stand.
    const leadKind = net.edgeKind[nextE];
    if (leadKind === EdgeKind.StandLeadIn || leadKind === EdgeKind.StandFork) {
      const s = leadKind === EdgeKind.StandLeadIn ? net.edgeStand[nextE] : net.edgeForkStand[nextE];
      if (this.standOwner[s] !== -1 && this.standOwner[s] !== i) return -2;
    }
    return -1;
  }

  private priorityClass(i: number): number {
    const st = this.state[i];
    if (st === AcState.TaxiIn) return this.routeIdx[i] === 0 ? 0 : 1;
    if (st === AcState.Pushback) return 3;
    return 2;
  }

  /** Whether aircraft a has priority over b at a junction. Without an open request on both, the lower index wins. */
  private outranks(a: number, b: number): boolean {
    if (this.reqNode[a] < 0 || this.reqNode[b] < 0) return a < b;
    if (this.reqClass[a] !== this.reqClass[b]) return this.reqClass[a] < this.reqClass[b];
    if (this.reqTick[a] !== this.reqTick[b]) return this.reqTick[a] < this.reqTick[b];
    return a < b;
  }

  /**
   * The highest ranked aircraft that asked for `node` before i, is about to enter it and is not blocked
   * there, or -1. Such an aircraft goes first, so i waits for it.
   */
  private priorityHolder(i: number, node: number): number {
    const net = this.net;
    let best = -1;
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === i || this.reqNode[j] !== node || !this.outranks(j, i)) continue;
      if (this.tick < this.yieldUntil[j]) continue;
      const st = this.state[j];
      if (st !== AcState.TaxiIn && st !== AcState.TaxiOut && st !== AcState.Pushback && st !== AcState.Holding) continue;
      if (this.routeIdx[j] >= this.routeLen[j] - 1) continue;
      const jk = j * MAX_ROUTE + this.routeIdx[j];
      const e = this.routeEdge[jk];
      const end = this.routeDir[jk] === 1 ? net.edgeTo[e] : net.edgeFrom[e];
      if (end !== node) continue;
      const nextK = jk + 1;
      if (this.entryBlocker(j, node, this.routeEdge[nextK]) !== -1) continue;
      if (best < 0 || this.outranks(j, best)) best = j;
    }
    return best;
  }

  private tryEnter(i: number, node: number, nextE: number): boolean {
    const net = this.net;
    if (this.reqNode[i] !== node) {
      this.reqNode[i] = node;
      this.reqTick[i] = this.tick;
      this.reqClass[i] = this.priorityClass(i);
    }
    const b = this.entryBlocker(i, node, nextE);
    if (b !== -1) {
      if (b >= 0) this.waitingFor[i] = b;
      return false;
    }
    if (this.ignoreLocks[i] <= 0) {
      const p = this.priorityHolder(i, node);
      if (p >= 0) {
        this.waitingFor[i] = p;
        return false;
      }
    }
    const k0 = this.routeIdx[i] + 1;
    if (net.edgeBlock[nextE] >= 0 && !this.inClaim(i, k0)) this.grantClaim(i, k0, this.runEnd(i, k0));
    if (this.heldNode[i] >= 0 && this.heldNode[i] !== node && this.nodeOwner[this.heldNode[i]] === i) this.nodeOwner[this.heldNode[i]] = -1;
    this.nodeOwner[node] = i;
    this.heldNode[i] = node;
    this.nextAcq[i] = nextE;
    this.waitingFor[i] = -1;
    this.reqNode[i] = -1;
    return true;
  }

  /**
   * Another aircraft on an edge that conflicts with `nextE` and inside the junction zone around `node`, or -1.
   * Only taxiing aircraft count, the node owner check has already settled the aircraft at the node itself.
   */
  private conflictHolder(i: number, node: number, nextE: number): number {
    const net = this.net;
    const curE = this.routeEdge[i * MAX_ROUTE + this.routeIdx[i]];
    const nx = net.nodeX[node];
    const ny = net.nodeY[node];
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === i) continue;
      const st = this.state[j];
      if (st !== AcState.TaxiIn && st !== AcState.TaxiOut && st !== AcState.Pushback && st !== AcState.Holding && st !== AcState.TowBack) continue;
      // Two aircraft held back by each other would deadlock: the lower index goes first, the other keeps waiting.
      if (this.waitingFor[j] === i && j > i) continue;
      // An aircraft holding short of the node with no clearance into it is clear of whoever passes (T87).
      if (this.holdingShort(j, node)) continue;
      const jk = j * MAX_ROUTE + this.routeIdx[j];
      const ej = this.routeEdge[jk];
      // The aircraft sweeps the end of the edge it is on as well as the start of the next one.
      if (!this.edgesConflict(nextE, ej) && !this.edgesConflict(curE, ej)) continue;
      // An aircraft that has left the node along its edge and cleared it with its tail no longer holds it.
      const leaving = this.routeDir[jk] === 1 ? net.edgeFrom[ej] === node : net.edgeTo[ej] === node;
      if (leaving && this.dist[j] > AIRCRAFT[this.type[j]].dimensions.lengthM) continue;
      const zone = Math.max(net.edgeZoneM[nextE], net.edgeZoneM[ej]);
      if (Math.hypot(this.x[j] - nx, this.y[j] - ny) < zone + CONFLICT_MARGIN_M) return j;
    }
    return -1;
  }

  private edgesConflict(e: number, f: number): boolean {
    const net = this.net;
    for (let c = net.conflictStart[e]; c < net.conflictStart[e + 1]; c++) if (net.conflictEdge[c] === f) return true;
    return false;
  }

  /** Takes a node for push back and lets go of the one held before, so no reservation is left behind. */
  private holdNode(i: number, node: number): void {
    const prev = this.heldNode[i];
    if (prev >= 0 && prev !== node && this.nodeOwner[prev] === i) this.nodeOwner[prev] = -1;
    this.nodeOwner[node] = i;
    this.heldNode[i] = node;
  }

  private pushbackClear(i: number): boolean {
    const k = i * MAX_ROUTE + this.routeIdx[i];
    const e = this.routeEdge[k];
    const node = this.routeDir[k] === 1 ? this.net.edgeTo[e] : this.net.edgeFrom[e];
    if (this.net.edgeKind[e] === EdgeKind.StandFork) return this.forkPushClear(i, e, node);
    // The fork point belongs to this stand alone and arrivals keep off its fork while the stand is taken.
    // Before leaving the stand a fork push back needs the taxilane node at the end of its arc free, no other
    // push back heading for it and the stretch beyond it clear, so neighbouring stands take turns.
    const nextIdx = k + 1;
    if (this.net.edgeKind[e] === EdgeKind.StandLeadIn && node === this.net.forkNode[this.net.edgeStand[e]] && this.routeIdx[i] + 1 < this.routeLen[i] && this.net.edgeKind[this.routeEdge[nextIdx]] === EdgeKind.StandFork) {
      let blocker = this.forkSideBlocker(i, this.routeEdge[nextIdx]);
      // While still on the stand the push may switch to the other arc when that side is free.
      if (blocker >= 0 && this.af.stands[this.net.edgeStand[e]].pushback === 'auto') {
        const other = this.net.forkEdge[this.net.edgeForkStand[this.routeEdge[nextIdx]] * 2 + 1 - this.net.edgeForkSide[this.routeEdge[nextIdx]]];
        if (other >= 0 && this.forkSideBlocker(i, other) < 0 && this.rerouteFrom(i, nextIdx, other)) blocker = -1;
      }
      // The taxiway past the arc must not be claimed the other way, or the push would meet that traffic head on.
      if (blocker < 0) blocker = this.pushClaimBlocker(i);
      // Taxiing traffic about to pass where the push meets the taxilane goes first (user, 2026-11-17).
      if (blocker < 0) blocker = this.approachingNode(i, this.net.edgeFrom[this.routeEdge[nextIdx]]);
      if (blocker >= 0) {
        this.waitingFor[i] = blocker;
        return false;
      }
      this.pushClaim(i);
      return true;
    }
    // Pushback goes from the stand to the junction, which is the far end of that edge in travel direction.
    const owner = this.nodeOwner[node];
    if (owner !== -1 && owner !== i) {
      this.waitingFor[i] = owner;
      return false;
    }
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === i) continue;
      const s = this.state[j];
      if (s === AcState.TaxiIn || s === AcState.TaxiOut || s === AcState.Pushback || s === AcState.TowBack) {
        if (Math.hypot(this.x[j] - this.net.nodeX[node], this.y[j] - this.net.nodeY[node]) < 28) return false;
      }
    }
    // A push that has not left the stand yet gives way to taxiing traffic about to pass its junction.
    if (this.nodeOwner[node] !== i) {
      const j = this.approachingNode(i, node);
      if (j >= 0) {
        this.waitingFor[i] = j;
        return false;
      }
    }
    const opposed = this.pushClaimBlocker(i);
    if (opposed >= 0) {
      this.waitingFor[i] = opposed;
      return false;
    }
    if (this.nodeOwner[node] !== i) this.holdNode(i, node);
    this.pushClaim(i);
    return true;
  }

  /**
   * A taxiing aircraft whose route passes `node` within PUSH_GIVE_WAY_M, or -1. Real ground control
   * holds a push back while traffic taxis behind it, so the later aircraft waits on the stand instead
   * of meeting the taxiing one between two intersections (user, 2026-11-17). An aircraft that waits
   * for i, or that heads for the stand i is leaving, never holds i back, so the two cannot lock.
   */
  private approachingNode(i: number, node: number): number {
    const net = this.net;
    const myFlight = this.flight[i];
    const myStand = myFlight >= 0 ? this.fStand[myFlight] : -1;
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === i || this.waitingFor[j] === i) continue;
      const st = this.state[j];
      if (st !== AcState.TaxiIn && st !== AcState.TaxiOut) continue;
      const fj = this.flight[j];
      if (myStand >= 0 && fj >= 0 && this.fStand[fj] === myStand) continue;
      const base = j * MAX_ROUTE;
      let ahead = -this.dist[j];
      for (let q = this.routeIdx[j]; q < this.routeLen[j]; q++) {
        const e = this.routeEdge[base + q];
        ahead += net.edgeLen[e];
        if (ahead > PUSH_GIVE_WAY_M) break;
        const end = this.routeDir[base + q] === 1 ? net.edgeTo[e] : net.edgeFrom[e];
        if (end === node) return j;
      }
    }
    return -1;
  }

  /** Who keeps aircraft i from pushing along a fork arc: the owner of its taxilane node or an aircraft in the stretch, or -1. */
  private forkSideBlocker(i: number, arc: number): number {
    const net = this.net;
    const end = net.edgeFrom[arc];
    const owner = this.nodeOwner[end];
    if (owner !== -1 && owner !== i) return owner;
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === i || this.state[j] !== AcState.Pushback) continue;
      // Two push backs that have not started yet would wait on each other: the lower index goes first (T87).
      if (j > i && !this.pushStarted(j)) continue;
      // Another push back on its lead in or arc toward the same taxilane node.
      for (let q = this.routeIdx[j]; q < Math.min(this.routeLen[j], this.routeIdx[j] + 2); q++) {
        const ej = this.routeEdge[j * MAX_ROUTE + q];
        if (net.edgeKind[ej] === EdgeKind.StandFork && net.edgeFrom[ej] === end) return j;
      }
    }
    const slot = net.edgeForkStand[arc] * 2 + net.edgeForkSide[arc];
    return this.stretchOccupant(i, end, net.forkAwayX[slot], net.forkAwayY[slot], AIRCRAFT[this.type[i]].dimensions.wingspanM / 2);
  }

  /** True once a push back has left its parked position. */
  private pushStarted(j: number): boolean {
    if (this.routeIdx[j] > 0) return true;
    const e = this.routeEdge[j * MAX_ROUTE];
    return this.dist[j] >= this.pushStartLimit(j, e, this.net.edgeLen[e]);
  }

  /** Replaces the route from position k on with a push along `arc` and a route from its taxilane end to the same goal. */
  private rerouteFrom(i: number, k: number, arc: number): boolean {
    const base = i * MAX_ROUTE;
    const lastE = this.routeEdge[base + this.routeLen[i] - 1];
    const goal = this.routeDir[base + this.routeLen[i] - 1] === 1 ? this.net.edgeTo[lastE] : this.net.edgeFrom[lastE];
    const t = this.type[i];
    const m = this.net.route(this.net.edgeFrom[arc], goal, CODES_OF[t], ACR_OF[t], MASKS[t], this.tailEdge, this.tailDir, MAX_ROUTE);
    if (m < 0 || k - base + 1 + m > MAX_ROUTE) return false;
    this.routeEdge[k] = arc;
    this.routeDir[k] = -1;
    for (let q = 0; q < m; q++) {
      this.routeEdge[k + 1 + q] = this.tailEdge[q];
      this.routeDir[k + 1 + q] = this.tailDir[q];
    }
    this.routeLen[i] = k + 1 + m - base;
    return true;
  }

  /** True when a ground aircraft stands or moves in the push back stretch of a stand's fork side. */
  private forkStretchBusy(s: number, side: number): boolean {
    const net = this.net;
    const arc = net.forkEdge[s * 2 + side];
    if (arc < 0) return true;
    const node = net.edgeFrom[arc];
    return this.stretchOccupant(-1, node, net.forkAwayX[s * 2 + side], net.forkAwayY[s * 2 + side], 20) >= 0;
  }

  /** The first ground aircraft other than i inside the 28 m stretch from a node along (ax, ay), or -1. */
  private stretchOccupant(i: number, node: number, ax: number, ay: number, halfSpan: number): number {
    const nx = this.net.nodeX[node];
    const ny = this.net.nodeY[node];
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === i) continue;
      const st = this.state[j];
      if (st !== AcState.TaxiIn && st !== AcState.TaxiOut && st !== AcState.Pushback && st !== AcState.TowBack) continue;
      const rx = this.x[j] - nx;
      const ry = this.y[j] - ny;
      const along = rx * ax + ry * ay;
      const lateral = Math.abs(-rx * ay + ry * ax);
      if (along > 0 && along < PUSHBACK_EXTENSION_M && lateral < halfSpan + AIRCRAFT[this.type[j]].dimensions.wingspanM / 2) return j;
    }
    return -1;
  }

  /**
   * Push back along a fork arc reserves the taxilane node at its end and the 28 m of taxilane beyond it
   * in the push direction (docs/DESIGN_REVISION_2.md section 1). Aircraft waiting on the other side of
   * the node do not block it.
   */
  private forkPushClear(i: number, e: number, node: number): boolean {
    const net = this.net;
    const owner = this.nodeOwner[node];
    if (owner !== -1 && owner !== i) {
      this.waitingFor[i] = owner;
      return false;
    }
    const slot = net.edgeForkStand[e] * 2 + net.edgeForkSide[e];
    const j = this.stretchOccupant(i, node, net.forkAwayX[slot], net.forkAwayY[slot], AIRCRAFT[this.type[i]].dimensions.wingspanM / 2);
    if (j >= 0) {
      this.waitingFor[i] = j;
      return false;
    }
    if (this.nodeOwner[node] !== i) this.holdNode(i, node);
    return true;
  }

  /**
   * Speed limit from the aircraft ahead, on this edge or at the start of the next one. An aircraft coming the
   * other way on either edge is a hard stop short of its nose, so nobody ever drives through another (T87);
   * the last one that set the limit is left in oppBlocker.
   */
  private leaderLimit(i: number, e: number, dir: number, idx: number, last: boolean): number {
    const span = AIRCRAFT[this.type[i]].dimensions.wingspanM;
    const lenI = AIRCRAFT[this.type[i]].dimensions.lengthM;
    let limit = Infinity;
    this.oppBlocker = -1;
    const base = i * MAX_ROUTE;
    const len = this.net.edgeLen[e];
    const nextE = last ? -1 : this.routeEdge[base + idx + 1];
    const nextD = last ? 0 : this.routeDir[base + idx + 1];
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === i) continue;
      const s = this.state[j];
      if (s !== AcState.TaxiIn && s !== AcState.TaxiOut && s !== AcState.Pushback && s !== AcState.Holding && s !== AcState.LineUp && s !== AcState.TowBack) continue;
      const jb = j * MAX_ROUTE + this.routeIdx[j];
      const ej = this.routeEdge[jb];
      const dj = this.routeDir[jb];
      let gap = -1;
      let opposite = false;
      if (ej === e && dj === dir && this.dist[j] > this.dist[i]) gap = this.dist[j] - this.dist[i];
      else if (nextE >= 0 && ej === nextE && dj === nextD) gap = len - this.dist[i] + this.dist[j];
      else if (ej === e && dj === -dir && len - this.dist[j] > this.dist[i]) {
        gap = len - this.dist[j] - this.dist[i];
        opposite = true;
      } else if (nextE >= 0 && ej === nextE && dj === -nextD) {
        gap = len - this.dist[i] + this.net.edgeLen[nextE] - this.dist[j];
        opposite = true;
      }
      if (gap < 0) continue;
      const need = opposite
        ? 10 + 0.5 * lenI + 0.5 * AIRCRAFT[this.type[j]].dimensions.lengthM
        : 20 + 0.5 * span + 0.5 * AIRCRAFT[this.type[j]].dimensions.wingspanM + 2 * this.speed[i];
      const vj = opposite ? 0 : this.speed[j];
      const v = Math.sqrt(vj * vj + 2 * TAXI_DECEL * Math.max(0, gap - need));
      if (v < limit) {
        limit = v;
        this.oppBlocker = opposite ? j : -1;
      }
    }
    return limit;
  }

  // Turnaround and departure -----------------------------------------------

  private updateTurnaround(i: number): void {
    const f = this.flight[i];
    // The timer counts down the planned turnaround. A tasked flight ends when its task list does (T63), else when the timer does.
    if (this.timer[i] > 0) {
      this.timer[i]--;
      if (this.tasked[i] === 0) return;
    }
    const late = this.timer[i] === 0 && f >= 0;
    if (this.tasked[i] === 1 && this.hooks?.turnDone && !this.hooks.turnDone(i)) {
      if (late && this.hooks.blocker) {
        const c = this.hooks.blocker(i);
        if (c !== 0 && c !== this.fCause[f]) {
          this.fCause[f] = c;
          this.hooks.delayCause?.(f, c);
        }
      }
      return;
    }
    if (this.timer[i] > 0) return;
    // A flight short of fuel waits for the farm; after the grounding limit it is reported grounded once (D19).
    if (this.fuelOwed[i] > 0) {
      if (this.hooks?.fuelReady && !this.hooks.fuelReady(i)) {
        this.fuelWait[i]++;
        if (late) this.fCause[f] = CAUSE_FUEL;
        if (this.fuelWait[i] === FUEL_GROUND_TICKS) this.emit(`flightGrounded|type=${AIRCRAFT[this.type[i]].id}|reason=fuel`);
        return;
      }
    }
    if (this.boardHold[i] < BOARD_HOLD_TICKS && this.hooks?.boardingReady && !this.hooks.boardingReady(f)) {
      this.boardHold[i]++;
      // Passengers late to the gate are the airline's delay (user, 2026-11-18).
      if (late) {
        this.fCause[f] = CAUSE_BOARDING;
        this.fAirlineHold[f]++;
      }
      return;
    }
    // The aircraft pushes back only once its crew has left the stand.
    if (this.tasked[i] === 1 && this.hooks?.crewGone && !this.hooks.crewGone(i)) {
      if (late) this.fCause[f] = CAUSE_CREW_LEAVING;
      return;
    }
    // A departure that lost the movement budget waits a retry step before it asks again (T40 R4).
    if (this.tick < this.depRetryAt[i]) {
      if (late) this.fCause[f] = CAUSE_ATC;
      return;
    }
    if (this.tick % 20 !== i % 20) return;
    this.planDeparture(i);
  }

  /** Picks a runway entry the type can take off from and a route to it, then starts the push back. */
  private planDeparture(i: number): void {
    const t = this.type[i];
    const a = AIRCRAFT[t];
    const s = this.af.stands.findIndex((st) => st.id === this.standId[i]);
    if (s < 0 || this.net.standNode[s] < 0) return;
    const from = this.net.standNode[s];
    let bestScore = Infinity;
    let bestHold = -1;
    let bestDir = 1;
    let firstFail = '';
    let failAvail = -1;
    let bestBack = 0;
    const f = this.flight[i];
    let waitedOnly = false;
    let softFail = '';
    for (const h of this.net.holds) {
      // A queue of more than two departures per entry spills onto the taxiway and blocks arrivals.
      if (this.entryInbound[h.entryIdx] > 0 || this.entryDeparting[h.entryIdx] >= 2) {
        waitedOnly = true;
        continue;
      }
      const en = this.af.entries[h.entryIdx];
      const rIdx = this.af.runways.findIndex((r) => r.id === en.runwayId);
      if (rIdx < 0) continue;
      const rw = this.af.runways[rIdx];
      if (this.runwayClosed(rIdx)) {
        firstFail = firstFail || 'runwayWorks|needed=0|available=0';
        continue;
      }
      for (const dir of [1, -1] as const) {
        const toda = dir === 1 ? en.todaTowardB : en.todaTowardA;
        const hdg = dir === 1 ? rw.headingDeg : (rw.headingDeg + 180) % 360;
        let lim = checkTakeoff(a, rw, toda, this.site.climate, this.lengthFactor(rw, dir), this.shareFor(i));
        // A turn pad at the end the roll starts from lets the aircraft backtrack and use the full length.
        let back = 0;
        const pad = dir === 1 ? rw.pads?.a : rw.pads?.b;
        if (!lim.ok && pad && toda < rw.lengthM) {
          const full = checkTakeoff(a, rw, rw.lengthM, this.site.climate, this.lengthFactor(rw, dir), this.shareFor(i));
          if (full.ok) {
            lim = full;
            back = rw.lengthM - toda;
          }
        }
        if (!lim.ok) {
          // Report the best an entry could offer, not the first entry that failed.
          if (!firstFail || lim.available > failAvail) {
            firstFail = `${lim.reason}|needed=${lim.needed}|available=${lim.available}`;
            failAvail = lim.available;
          }
          continue;
        }
        const limit = a.weights.mtowKg < 30000 ? 15 : 20;
        if (this.crosswind(hdg) > limit) {
          softFail = softFail || 'crosswind';
          continue;
        }
        const n = this.net.route(from, h.node, CODES_OF[t], ACR_OF[t], MASKS[t], this.tmpEdge, this.tmpDir, MAX_ROUTE);
        if (n < 0) {
          softFail = 'noRouteOut';
          continue;
        }
        let time = 0;
        for (let k = 0; k < n; k++) time += this.net.edgeLen[this.tmpEdge[k]] / Math.max(1, this.net.edgeSpeed[this.tmpEdge[k]]);
        if (back > 0) time += back / AIRFIELD.turnPad.backtrackSpeedMs + AIRFIELD.turnPad.turnSeconds;
        // Prefer a headwind and short taxi times.
        const score = time - this.headwind(hdg) * 3;
        if (score < bestScore) {
          bestScore = score;
          bestHold = h.entryIdx;
          bestDir = dir;
          bestBack = back;
        }
      }
    }
    if (bestHold < 0) {
      // Tell the player once why the aircraft stays on its stand. A length that would do in the
      // other direction is not the cause when the wind or a missing route ruled that direction out.
      if (!waitedOnly && this.stuckTicks[i] === 0) {
        if (softFail || this.net.holds.length === 0) {
          this.refuse(f, softFail || 'noRouteOut', '');
          this.stuckTicks[i] = 1;
        } else if (firstFail) {
          const parts = firstFail.split('|');
          this.refuse(f, parts[0], `|${parts[1]}|${parts[2]}`);
          this.stuckTicks[i] = 1;
        }
      }
      return;
    }
    const hold = this.net.holds.find((h) => h.entryIdx === bestHold);
    if (!hold) return;
    const rwyIdx = this.af.runways.findIndex((r) => r.id === this.af.entries[bestHold].runwayId);
    if (rwyIdx < 0) return;
    // The tower meters takeoffs too. A blocked aircraft stays on its stand and keeps its place in the queue.
    if (!this.movementFree(rwyIdx)) {
      this.depWait[i] += RETRY_TICKS;
      this.depRetryAt[i] = this.tick + RETRY_TICKS;
      return;
    }
    let bestN = this.forkPushback(s, this.net.route(from, hold.node, CODES_OF[t], ACR_OF[t], MASKS[t], this.tmpEdge, this.tmpDir, MAX_ROUTE), hold.node, t);
    // A pass through stand is left forward (T72): the aircraft first drives the rest of its lead in, from
    // its stop bar to the stand point, and then the lead out.
    const forward = bestN > 0 && bestN < MAX_ROUTE && this.net.edgeKind[this.tmpEdge[0]] === EdgeKind.StandLeadOut;
    if (forward) {
      for (let k = bestN; k > 0; k--) {
        this.tmpEdge[k] = this.tmpEdge[k - 1];
        this.tmpDir[k] = this.tmpDir[k - 1];
      }
      this.tmpEdge[0] = this.net.standEdge[s];
      this.tmpDir[0] = 1;
      bestN++;
    }
    const base = i * MAX_ROUTE;
    for (let k = 0; k < bestN; k++) {
      this.routeEdge[base + k] = this.tmpEdge[k];
      this.routeDir[base + k] = this.tmpDir[k];
    }
    this.routeLen[i] = bestN;
    this.routeIdx[i] = 0;
    // Push back starts where the aircraft stands: an aircraft parked on its stop bar sits behind the stand point.
    const behind = Math.hypot(this.x[i] - this.af.stands[s].x, this.y[i] - this.af.stands[s].y);
    this.dist[i] = bestN > 0 && this.net.edgeKind[this.tmpEdge[0]] === EdgeKind.StandLeadIn
      ? this.tmpDir[0] === -1
        ? Math.min(this.net.edgeLen[this.tmpEdge[0]], behind)
        : Math.max(0, this.net.edgeLen[this.tmpEdge[0]] - behind)
      : 0;
    this.speed[i] = 0;
    this.depWait[i] = 0;
    this.depRetryAt[i] = 0;
    this.spendMovement(rwyIdx);
    this.uncount(i);
    this.entryIdx[i] = bestHold;
    this.entryDeparting[bestHold]++;
    this.entryCounted[i] = 2;
    this.rwyIdx[i] = rwyIdx;
    this.rwyDir[i] = bestDir;
    this.rwyBack[i] = bestBack;
    this.goalX[i] = this.net.nodeX[hold.node];
    this.goalY[i] = this.net.nodeY[hold.node];
    this.state[i] = bestN === 1 ? AcState.TaxiOut : AcState.Pushback;
    this.stuckTicks[i] = 0;
    // The first edge is the stand lead in, driven backward as the push back.
    if (forward || this.net.edgeKind[this.tmpEdge[0]] !== EdgeKind.StandLeadIn) this.state[i] = AcState.TaxiOut;
    if (f >= 0) {
      this.fState[f] = FlState.Departing;
      this.hooks?.pushback(f);
    }
    // Leave the stand free for the next arrival once the aircraft is out of the way.
    this.standOwner[s] = i;
  }

  /**
   * Push back along a fork arc (docs/DESIGN_REVISION_2.md section 1). The planned route leaves the stand
   * nose first along one arc; the aircraft is instead pushed tail first along the other arc, or the side
   * the stand sets, onto the taxilane and then taxis forward from there. Rewrites tmpEdge and tmpDir and
   * returns the new length, or the planned length when the stand has no fork.
   */
  private forkPushback(s: number, n: number, goal: number, t: number): number {
    const net = this.net;
    if (n < 2 || this.tmpEdge[0] !== net.standEdge[s] || net.edgeKind[this.tmpEdge[1]] !== EdgeKind.StandFork) return n;
    const pref = this.af.stands[s].pushback;
    const away = 1 - net.edgeForkSide[this.tmpEdge[1]];
    // A set side is kept; otherwise the side away from the route, unless its stretch is taken and the other is clear.
    let side = pref === 'left' ? 0 : pref === 'right' ? 1 : away;
    if (pref === 'auto' && this.forkStretchBusy(s, away) && !this.forkStretchBusy(s, 1 - away)) side = 1 - away;
    const arc = net.forkEdge[s * 2 + side];
    if (arc < 0) return n;
    const m = net.route(net.edgeFrom[arc], goal, CODES_OF[t], ACR_OF[t], MASKS[t], this.tailEdge, this.tailDir, MAX_ROUTE);
    if (m < 0 || m + 2 > MAX_ROUTE) return n;
    this.tmpEdge[1] = arc;
    this.tmpDir[1] = -1;
    for (let k = 0; k < m; k++) {
      this.tmpEdge[k + 2] = this.tailEdge[k];
      this.tmpDir[k + 2] = this.tailDir[k];
    }
    return m + 2;
  }

  /** Takeoff weight share of the flight on aircraft i, from its stage length. */
  private shareFor(i: number): number {
    const f = this.flight[i];
    if (f < 0 || this.fStage[f] === 0) return 0.9;
    return takeoffWeight(AIRCRAFT[this.type[i]], this.fStage[f], 0.75).share;
  }

  private tryClearDeparture(i: number): void {
    const r = this.rwyIdx[i];
    if (r < 0) return;
    const t = this.type[i];
    const a = AIRCRAFT[t];
    const rw = this.af.runways[r];
    const roll = requiredTakeoffM(a, this.site.climate, rw ? this.lengthFactor(rw, this.rwyDir[i]) : 1, this.shareFor(i)) * 0.8;
    const vLof = a.performance.vrefKt * KT * 1.05;
    const rollTicks = Math.round(((2 * roll) / vLof) * 10);
    const start = this.tick;
    // A backtrack to a turn pad holds the runway for the taxi up it and the turn as well.
    const backTicks = this.rwyBack[i] > 0 ? Math.round((this.rwyBack[i] / AIRFIELD.turnPad.backtrackSpeedMs + AIRFIELD.turnPad.turnSeconds) * 10) : 0;
    const end = this.tick + RUNWAY_OCCUPANCY.lineUp * 10 + backTicks + rollTicks + 100;
    if (!this.slotFree(r, start, end, WAKE_OF[t])) return;
    const slot = this.reserve(r, start, end, WAKE_OF[t]);
    if (slot < 0) return;
    void rw;
    this.rwySlot[i] = slot;
    this.state[i] = AcState.LineUp;
  }

  private beginTakeoff(i: number): void {
    const en = this.af.entries[this.entryIdx[i]];
    const rw = this.af.runways[this.rwyIdx[i]];
    const along = Math.hypot(en.x - rw.x1, en.y - rw.y1);
    const dir = this.rwyDir[i];
    this.rwyS[i] = dir === 1 ? along : rw.lengthM - along;
    this.speed[i] = 2;
    this.releaseAll(i);
    const f = this.flight[i];
    void f;
    this.uncount(i);
    this.state[i] = AcState.Takeoff;
    if (this.rwyBack[i] > 0) {
      this.state[i] = AcState.Backtrack;
      this.speed[i] = AIRFIELD.turnPad.backtrackSpeedMs;
    }
    this.placeOnRunway(i);
    if (this.state[i] === AcState.Backtrack) this.heading[i] = turnWrap(this.heading[i] + PI);
  }

  /**
   * Taxies a departure back along the runway to the turn pad at the start of its roll, turns it round on
   * the pad and starts the takeoff (docs/GAME_DESIGN.md section 6, prefab pieces).
   */
  private updateBacktrack(i: number): void {
    const rw = this.af.runways[this.rwyIdx[i]];
    if (!rw) {
      this.removeAircraft(i, 'lost');
      return;
    }
    const turnTicks = AIRFIELD.turnPad.turnSeconds * 10;
    if (this.rwyS[i] > 0) {
      this.rwyS[i] = Math.max(0, this.rwyS[i] - AIRFIELD.turnPad.backtrackSpeedMs * DT);
      this.placeOnRunway(i);
      this.heading[i] = turnWrap(this.heading[i] + PI);
      if (this.rwyS[i] === 0) this.timer[i] = turnTicks;
      return;
    }
    // On the pad the aircraft swings out to the pad side and round to the takeoff heading.
    this.timer[i]--;
    const left = Math.max(0, this.timer[i]) / turnTicks;
    this.placeOnRunway(i);
    const side = this.rwyDir[i] === 1 ? rw.pads?.a : rw.pads?.b;
    const len = Math.hypot(rw.x2 - rw.x1, rw.y2 - rw.y1) || 1;
    const sign = side === 'right' ? -1 : 1;
    const out = (rw.widthM / 2 + padSize(rw).extra / 2) * sinLut(PI * (1 - left)) * sign;
    this.x[i] += ((rw.y2 - rw.y1) / len) * out;
    this.y[i] -= ((rw.x2 - rw.x1) / len) * out;
    this.heading[i] = turnWrap(this.heading[i] + PI * left);
    this.speed[i] = 3;
    if (this.timer[i] <= 0) {
      this.rwyBack[i] = 0;
      this.speed[i] = 2;
      this.state[i] = AcState.Takeoff;
    }
  }

  private updateTakeoff(i: number): void {
    const t = this.type[i];
    const a = AIRCRAFT[t];
    const rw = this.af.runways[this.rwyIdx[i]];
    if (!rw) {
      this.removeAircraft(i, 'departed');
      return;
    }
    const roll = requiredTakeoffM(a, this.site.climate, this.lengthFactor(rw, this.rwyDir[i]), this.shareFor(i)) * 0.8;
    const vLof = a.performance.vrefKt * KT * 1.05;
    const acc = (vLof * vLof) / (2 * roll);
    this.speed[i] += acc * DT;
    this.rwyS[i] += this.speed[i] * DT;
    this.placeOnRunway(i);
    if (this.rwySlot[i] >= 0 && this.rwyS[i] > rw.lengthM) {
      this.rsvEnd[this.rwySlot[i]] = Math.min(this.rsvEnd[this.rwySlot[i]], this.tick + 30);
      this.rwySlot[i] = -1;
    }
    if (this.rwyS[i] > rw.lengthM + 1500) this.removeAircraft(i, 'departed');
  }

  // Deadlocks and congestion -----------------------------------------------

  // Claims on two way pavement (T87) ---------------------------------------

  /** Block counts and directions from the claims, worked out again only after a claim changed. */
  private ensureCounts(): void {
    if (!this.countsDirty) return;
    this.countsDirty = false;
    const net = this.net;
    this.blockCount.fill(0);
    this.blockMixed.fill(0);
    for (let k = 0; k < this.count; k++) {
      const i = this.activeList[k];
      if (this.claimTo[i] < 0) continue;
      this.markStamp++;
      const base = i * MAX_ROUTE;
      for (let q = this.claimFrom[i]; q <= this.claimTo[i]; q++) {
        const e = this.routeEdge[base + q];
        const b = net.edgeBlock[e];
        if (b < 0 || this.blockMark[b] === this.markStamp) continue;
        this.blockMark[b] = this.markStamp;
        const d = this.routeDir[base + q] * net.edgeBlockSign[e];
        if (this.blockCount[b] === 0) this.blockDir[b] = d;
        else if (this.blockDir[b] !== d) this.blockMixed[b] = 1;
        this.blockCount[b]++;
      }
    }
  }

  /** The last route position of the run of two way edges that starts at k0, or k0 - 1 when route position k0 has no block. */
  private runEnd(i: number, k0: number): number {
    const base = i * MAX_ROUTE;
    let k = k0;
    while (k < this.routeLen[i] && this.net.edgeBlock[this.routeEdge[base + k]] >= 0) k++;
    return k - 1;
  }

  /** The last route position from k0 on that stays in the block of route position k0, or k0 - 1 when it has none. */
  private sameBlockEnd(i: number, k0: number): number {
    const base = i * MAX_ROUTE;
    const b = this.net.edgeBlock[this.routeEdge[base + k0]];
    if (b < 0) return k0 - 1;
    let k = k0;
    while (k + 1 < this.routeLen[i] && this.net.edgeBlock[this.routeEdge[base + k + 1]] === b) k++;
    return k;
  }

  private inClaim(i: number, q: number): boolean {
    return this.claimTo[i] >= 0 && q >= this.claimFrom[i] && q <= this.claimTo[i];
  }

  /** Direction of aircraft i's claim on block b, or 0 when it does not hold it. */
  private claimDir(i: number, b: number): number {
    if (this.claimTo[i] < 0) return 0;
    const base = i * MAX_ROUTE;
    for (let q = this.claimFrom[i]; q <= this.claimTo[i]; q++) {
      const e = this.routeEdge[base + q];
      if (this.net.edgeBlock[e] === b) return this.routeDir[base + q] * this.net.edgeBlockSign[e];
    }
    return 0;
  }

  /**
   * Who keeps aircraft i from claiming route positions k0 to k1: an aircraft holding one of their blocks the
   * other way, one that is itself waiting when there is a choice so the deadlock check sees whole cycles. -1 when free.
   */
  private claimBlocker(i: number, k0: number, k1: number): number {
    if (k1 < k0) return -1;
    this.ensureCounts();
    const net = this.net;
    const base = i * MAX_ROUTE;
    for (let q = k0; q <= k1; q++) {
      const e = this.routeEdge[base + q];
      const b = net.edgeBlock[e];
      if (b < 0 || this.blockCount[b] === 0) continue;
      const d = this.routeDir[base + q] * net.edgeBlockSign[e];
      if (this.blockDir[b] === d && this.blockMixed[b] === 0) continue;
      let first = -1;
      for (let k = 0; k < this.count; k++) {
        const j = this.activeList[k];
        if (j === i) continue;
        const dj = this.claimDir(j, b);
        if (dj === 0 || dj === d) continue;
        if (this.waitingFor[j] >= 0) return j;
        if (first < 0) first = j;
      }
      if (first >= 0) return first;
    }
    return -1;
  }

  private grantClaim(i: number, k0: number, k1: number): void {
    if (k1 < k0) return;
    if (this.claimTo[i] < 0) this.claimFrom[i] = k0;
    if (k1 > this.claimTo[i]) this.claimTo[i] = k1;
    this.countsDirty = true;
  }

  private dropClaim(i: number): void {
    if (this.claimTo[i] < 0 && this.claimFrom[i] < 0) return;
    this.claimFrom[i] = -1;
    this.claimTo[i] = -1;
    this.countsDirty = true;
  }

  /** The first route position past the stand edges a push back or a forward departure drives first, or -1 when the route has none. */
  private firstTaxiPos(i: number): number {
    const base = i * MAX_ROUTE;
    for (let q = this.routeIdx[i]; q < this.routeLen[i]; q++) {
      const k = this.net.edgeKind[this.routeEdge[base + q]];
      if (k !== EdgeKind.StandLeadIn && k !== EdgeKind.StandFork && k !== EdgeKind.StandLeadOut) return q;
    }
    return -1;
  }

  /** Who holds the two way stretch a push back would drive onto the other way, or -1. */
  private pushClaimBlocker(i: number): number {
    const k0 = this.firstTaxiPos(i);
    if (k0 < 0 || this.inClaim(i, k0)) return -1;
    return this.claimBlocker(i, k0, this.runEnd(i, k0));
  }

  /** A push back claims the two way stretch after its stand before it moves, so nothing enters it from the other end meanwhile. */
  private pushClaim(i: number): void {
    const k0 = this.firstTaxiPos(i);
    if (k0 >= 0 && !this.inClaim(i, k0)) this.grantClaim(i, k0, this.runEnd(i, k0));
  }

  /**
   * Center distance at which aircraft i holds short of a junction it may not enter yet: its nose the largest
   * taxiway object distance of the taxiways there clear of the node, the ICAO intermediate holding position.
   */
  private holdShortM(i: number, node: number): number {
    const d = AIRCRAFT[this.type[i]].dimensions;
    return Math.max(d.wingspanM * 0.5 + 12, this.net.nodeHoldM[node] + d.lengthM * 0.5);
  }

  /**
   * True when aircraft j waits at or behind the holding position of the junction ahead of it with no clearance
   * into it, and stands at least as far from `node` as it would hold short of that node: then it is clear of
   * whoever passes `node`, whether that is its own next junction or one nearby on the same taxiway (T87).
   */
  private holdingShort(j: number, node: number): boolean {
    const st = this.state[j];
    if (st !== AcState.TaxiIn && st !== AcState.TaxiOut) return false;
    if (this.routeIdx[j] + 1 >= this.routeLen[j]) return false;
    const k = j * MAX_ROUTE + this.routeIdx[j];
    const e = this.routeEdge[k];
    const ahead = this.routeDir[k] === 1 ? this.net.edgeTo[e] : this.net.edgeFrom[e];
    if (this.nextAcq[j] === this.routeEdge[k + 1]) return false;
    if (this.net.edgeLen[e] - this.dist[j] < this.holdShortM(j, ahead) - 0.5) return false;
    return ahead === node || Math.hypot(this.x[j] - this.net.nodeX[node], this.y[j] - this.net.nodeY[node]) >= this.holdShortM(j, node) - 0.5;
  }

  /**
   * Claims the stretch each taxiing aircraft stands on and the run ahead of it, in aircraft order, after the
   * network was rebuilt or an older save was loaded. An aircraft whose stretch is already held the other way
   * claims nothing; the deadlock check then tows one of the pair back.
   */
  private reclaimAll(): void {
    for (let k = 0; k < this.count; k++) {
      const i = this.activeList[k];
      this.claimFrom[i] = -1;
      this.claimTo[i] = -1;
    }
    this.countsDirty = true;
    for (let k = 0; k < this.count; k++) {
      const i = this.activeList[k];
      const st = this.state[i];
      if (st !== AcState.TaxiIn && st !== AcState.TaxiOut && st !== AcState.Holding && st !== AcState.LineUp && st !== AcState.Pushback && st !== AcState.TowBack) continue;
      if (this.routeLen[i] === 0) continue;
      const k0 = st === AcState.Pushback ? this.firstTaxiPos(i) : this.routeIdx[i];
      if (k0 < 0) continue;
      const k1 = this.runEnd(i, k0);
      if (k1 >= k0 && this.claimBlocker(i, k0, k1) < 0) this.grantClaim(i, k0, k1);
    }
  }

  // Tow back (T87) ------------------------------------------------------------

  /** Center distance of aircraft i behind the start node of its route position towIdx, negative while past it. */
  private towBehind(i: number): number {
    const base = i * MAX_ROUTE;
    const idx = this.routeIdx[i];
    const target = this.towIdx[i];
    let d: number;
    if (idx >= target) {
      d = -this.dist[i];
      for (let q = target; q < idx; q++) d -= this.net.edgeLen[this.routeEdge[base + q]];
    } else {
      d = this.net.edgeLen[this.routeEdge[base + idx]] - this.dist[i];
      for (let q = idx + 1; q < target; q++) d += this.net.edgeLen[this.routeEdge[base + q]];
    }
    return d;
  }

  /**
   * At the start of its route, puts the taxi edge that leads most straight on behind the aircraft in front of the
   * route, so a tow can go on backward. False at a dead end or with a full route.
   */
  private extendBehind(i: number): boolean {
    const net = this.net;
    const base = i * MAX_ROUTE;
    if (this.routeLen[i] >= MAX_ROUTE) return false;
    const e0 = this.routeEdge[base];
    const d0 = this.routeDir[base];
    const start = d0 === 1 ? net.edgeFrom[e0] : net.edgeTo[e0];
    const far = d0 === 1 ? net.edgeTo[e0] : net.edgeFrom[e0];
    const bx = net.nodeX[start] - net.nodeX[far];
    const by = net.nodeY[start] - net.nodeY[far];
    let best = -1;
    let bestDir = 0;
    let bestDot = 0;
    for (let p = net.adjStart[start]; p < net.adjStart[start + 1]; p++) {
      const f = net.adjEdge[p];
      if (f === e0 || !isTaxiEdge(net.edgeKind[f])) continue;
      // Driven forward it must lead into `start`.
      const dir = net.edgeTo[f] === start ? 1 : -1;
      if (dir === -1 && net.edgeOneWay[f] === 1) continue;
      const other = dir === 1 ? net.edgeFrom[f] : net.edgeTo[f];
      const ox = net.nodeX[other] - net.nodeX[start];
      const oy = net.nodeY[other] - net.nodeY[start];
      const dot = (ox * bx + oy * by) / (Math.sqrt((ox * ox + oy * oy) * (bx * bx + by * by)) || 1);
      if (dot > bestDot) {
        bestDot = dot;
        best = f;
        bestDir = dir;
      }
    }
    if (best < 0) return false;
    for (let q = this.routeLen[i]; q > 0; q--) {
      this.routeEdge[base + q] = this.routeEdge[base + q - 1];
      this.routeDir[base + q] = this.routeDir[base + q - 1];
    }
    this.routeEdge[base] = best;
    this.routeDir[base] = bestDir;
    this.routeLen[i]++;
    this.towIdx[i]++;
    this.dist[i] += net.edgeLen[best];
    return true;
  }

  /** True when another ground aircraft stands right behind aircraft i, in the way of a tow. */
  private towObstacle(i: number): boolean {
    const k = i * MAX_ROUTE + this.routeIdx[i];
    const e = this.routeEdge[k];
    const dir = this.routeDir[k];
    const len = this.net.edgeLen[e];
    this.net.pointAt(e, dir === 1 ? this.dist[i] : len - this.dist[i], this.cornerA);
    const h = dir === 1 ? this.cornerA.h : this.cornerA.h + PI;
    const bx = -cosLut(h);
    const by = -sinLut(h);
    const di = AIRCRAFT[this.type[i]].dimensions;
    for (let q = 0; q < this.count; q++) {
      const j = this.activeList[q];
      if (j === i) continue;
      const st = this.state[j];
      if (st !== AcState.TaxiIn && st !== AcState.TaxiOut && st !== AcState.Pushback && st !== AcState.Holding && st !== AcState.LineUp && st !== AcState.TowBack) continue;
      if (st === AcState.TowBack && this.speed[j] > 0.05) continue;
      const dj = AIRCRAFT[this.type[j]].dimensions;
      const rx = this.x[j] - this.x[i];
      const ry = this.y[j] - this.y[i];
      const along = rx * bx + ry * by;
      const lateral = Math.abs(-rx * by + ry * bx);
      if (along > 0 && along < 0.5 * (di.lengthM + dj.lengthM) + 8 && lateral < 0.5 * (di.wingspanM + dj.wingspanM)) return true;
    }
    return false;
  }

  /** Reverses at push back speed along the route until the junction is cleared, then waits and asks again. */
  private updateTow(i: number): void {
    const base = i * MAX_ROUTE;
    const left = this.towClearM[i] - this.towBehind(i);
    const stopped = left <= 0.05 || this.towObstacle(i);
    if (stopped) {
      this.speed[i] = 0;
      this.stuckTicks[i]++;
      // Done, or held at a dead end or behind another aircraft for a minute: taxi on from here.
      if (left <= 0.05 || this.stuckTicks[i] > 600) this.endTow(i);
      this.applyEdgePose(i);
      return;
    }
    this.stuckTicks[i] = 0;
    this.speed[i] = Math.min(PUSHBACK_SPEED, Math.sqrt(2 * TAXI_DECEL * left));
    this.dist[i] -= Math.min(this.speed[i] * DT, left);
    while (this.dist[i] < 0) {
      if (this.routeIdx[i] > 0) {
        this.routeIdx[i]--;
        this.dist[i] += this.net.edgeLen[this.routeEdge[base + this.routeIdx[i]]];
      } else if (!this.extendBehind(i)) {
        this.dist[i] = 0;
        this.endTow(i);
        break;
      }
    }
    this.applyEdgePose(i);
  }

  private endTow(i: number): void {
    this.state[i] = this.towState[i];
    this.towIdx[i] = -1;
    this.speed[i] = 0;
    this.stuckTicks[i] = 0;
    this.nextAcq[i] = -1;
    this.waitingFor[i] = -1;
    this.oppWait[i] = 0;
    this.yieldUntil[i] = this.tick + 100;
  }

  /** The earliest route position, at or before the current one, along which aircraft m will drive the other way soon, or -1. */
  private overlapStart(v: number, m: number): number {
    const vb = v * MAX_ROUTE;
    const mb = m * MAX_ROUTE;
    let start = -1;
    for (let q = this.routeIdx[v]; q >= 0; q--) {
      const e = this.routeEdge[vb + q];
      let hit = false;
      for (let r = this.routeIdx[m]; r < Math.min(this.routeLen[m], this.routeIdx[m] + 16); r++) {
        if (this.routeEdge[mb + r] === e && this.routeDir[mb + r] === -this.routeDir[vb + q]) hit = true;
      }
      if (!hit) break;
      start = q;
    }
    return start;
  }

  /**
   * Starts a tow of aircraft v away from m, which needs the pavement v stands on the other way. The aircraft
   * behind v on that stretch going the same way are towed with it, each held further back. False when v stands
   * nowhere m needs.
   */
  private startTow(v: number, m: number): boolean {
    const st = this.state[v];
    if (st !== AcState.TaxiIn && st !== AcState.TaxiOut) return false;
    const ke = this.overlapStart(v, m);
    if (ke < 0) return false;
    const net = this.net;
    const vb = v * MAX_ROUTE;
    const e = this.routeEdge[vb + ke];
    const d = this.routeDir[vb + ke];
    const node = d === 1 ? net.edgeFrom[e] : net.edgeTo[e];
    this.beginTow(v, ke, this.holdShortM(v, node));
    let prev = v;
    let clear = this.towClearM[v];
    let prevBehind = -Infinity;
    // Followers on the same stretch going the same way, from the nearest behind to the furthest back.
    for (;;) {
      let next = -1;
      let nextAt = -1;
      let nextBehind = Infinity;
      for (let k = 0; k < this.count; k++) {
        const j = this.activeList[k];
        const sj = this.state[j];
        if (sj !== AcState.TaxiIn && sj !== AcState.TaxiOut) continue;
        const jb = j * MAX_ROUTE;
        let kj = -1;
        for (let q = 0; q < this.routeLen[j] && kj < 0; q++) if (this.routeEdge[jb + q] === e && this.routeDir[jb + q] === d) kj = q;
        if (kj < 0) continue;
        this.towIdx[j] = kj;
        const behind = this.towBehind(j);
        this.towIdx[j] = -1;
        const need = Math.max(this.holdShortM(j, node), clear + 0.5 * (AIRCRAFT[this.type[prev]].dimensions.lengthM + AIRCRAFT[this.type[j]].dimensions.lengthM) + 15);
        if (behind > prevBehind && behind < need && behind < nextBehind) {
          next = j;
          nextAt = kj;
          nextBehind = behind;
        }
      }
      if (next < 0) break;
      clear = Math.max(this.holdShortM(next, node), clear + 0.5 * (AIRCRAFT[this.type[prev]].dimensions.lengthM + AIRCRAFT[this.type[next]].dimensions.lengthM) + 15);
      this.beginTow(next, nextAt, clear);
      prev = next;
      prevBehind = nextBehind;
    }
    return true;
  }

  private beginTow(i: number, idx: number, clearM: number): void {
    this.releaseAll(i);
    this.towState[i] = this.state[i];
    this.state[i] = AcState.TowBack;
    this.towIdx[i] = idx;
    this.towClearM[i] = clearM;
    this.speed[i] = 0;
    this.stuckTicks[i] = 0;
  }

  private detectDeadlocks(): void {
    for (let k = 0; k < this.count; k++) {
      const i = this.activeList[k];
      if (this.waitingFor[i] < 0 || this.ignoreLocks[i] > 0) continue;
      let j = this.waitingFor[i];
      if (j === i) {
        this.waitingFor[i] = -1;
        continue;
      }
      let steps = 0;
      while (j >= 0 && steps < 10 && j !== i) {
        j = this.waitingFor[j];
        steps++;
      }
      if (j === i) {
        // A wait cycle: the lowest priority aircraft in it, preferring departures, drops its
        // reservations and holds back for a while so the others can pass.
        let victim = i;
        let score = -1;
        let m = i;
        for (let n = 0; n < 10; n++) {
          const st = this.state[m];
          // An aircraft with no claim stands where it has no right to be, so it gives way first.
          const sc = (st === AcState.TaxiOut || st === AcState.Pushback ? 1000 : 0) + (this.claimTo[m] < 0 ? 2000 : 0) + m;
          if (sc > score) {
            score = sc;
            victim = m;
          }
          m = this.waitingFor[m];
          if (m === i || m < 0) break;
        }
        // A victim standing where another member of the cycle must drive the other way is towed back clear of
        // that stretch (T87); anywhere else letting go of its reservations is enough.
        let towed = false;
        let m2 = this.waitingFor[victim];
        for (let n = 0; n < 10 && m2 >= 0 && m2 !== victim && !towed; n++) {
          towed = this.startTow(victim, m2);
          m2 = this.waitingFor[m2];
        }
        if (!towed) {
          this.releaseAll(victim);
          this.yieldUntil[victim] = this.tick + 400;
        }
        this.deadlocks++;
        // Mark the whole cycle for the debug overlay.
        let w = i;
        for (let n = 0; n < 10 && w >= 0; n++) {
          this.deadlockUntil[w] = this.tick + 600;
          w = this.waitingFor[w];
          if (w === i) break;
        }
        this.emit('deadlock');
        return;
      }
    }
    // Aircraft stuck for a long time behind a closed loop of followers are also nudged.
    for (let k = 0; k < this.count; k++) {
      const i = this.activeList[k];
      if (this.stuckTicks[i] > 9000 && this.ignoreLocks[i] <= 0 && this.state[i] !== AcState.TowBack) {
        this.releaseAll(i);
        this.yieldUntil[i] = this.tick + 400;
        this.deadlocks++;
        this.stuckTicks[i] = 0;
      }
    }
  }

  private updateCongestion(): void {
    const c = this.net.congestion;
    this.ensureCounts();
    for (let e = 0; e < c.length; e++) c[e] = this.net.edgeBlock[e] >= 0 ? this.blockCount[this.net.edgeBlock[e]] * 8 : 0;
  }

  // Saving ------------------------------------------------------------------

  private arrays(): Record<string, Float64Array | Int32Array | Int16Array | Uint8Array | Int8Array> {
    return {
      active: this.active, state: this.state, type: this.type, livery: this.livery, flight: this.flight, x: this.x, y: this.y,
      heading: this.heading, speed: this.speed, dist: this.dist, routeLen: this.routeLen, routeIdx: this.routeIdx,
      routeEdge: this.routeEdge, routeDir: this.routeDir, heldNode: this.heldNode, claimFrom: this.claimFrom, claimTo: this.claimTo,
      oppWait: this.oppWait, towIdx: this.towIdx, towClearM: this.towClearM, towState: this.towState, nextAcq: this.nextAcq, waitingFor: this.waitingFor, reqNode: this.reqNode, reqTick: this.reqTick, reqClass: this.reqClass,
      ignoreLocks: this.ignoreLocks, yieldUntil: this.yieldUntil,
      standId: this.standId, rwyIdx: this.rwyIdx, rwyDir: this.rwyDir, rwyS: this.rwyS, rwyExitS: this.rwyExitS, rwyBack: this.rwyBack, rwySlot: this.rwySlot,
      entryIdx: this.entryIdx, timer: this.timer, stuckTicks: this.stuckTicks, goalX: this.goalX, goalY: this.goalY,
      entryCounted: this.entryCounted, fState: this.fState, fType: this.fType, fLivery: this.fLivery, fEta: this.fEta,
      fTurn: this.fTurn, fAc: this.fAc, fDelay: this.fDelay, fRetryAt: this.fRetryAt, fAirline: this.fAirline, fLate: this.fLate, fStage: this.fStage, fStand: this.fStand, fRot: this.fRot,
      fMovWait: this.fMovWait,
      nodeOwner: this.nodeOwner, standOwner: this.standOwner,
      rsvStart: this.rsvStart, rsvEnd: this.rsvEnd, rsvCat: this.rsvCat, entryInbound: this.entryInbound, entryDeparting: this.entryDeparting,
      movStart: this.movStart, movHead: this.movHead, movCount: this.movCount, depWait: this.depWait, depRetryAt: this.depRetryAt,
      boardHold: this.boardHold, fuelOwed: this.fuelOwed, fuelWait: this.fuelWait,
      tasked: this.tasked, fCause: this.fCause, fAirlineHold: this.fAirlineHold, fSerial: this.fSerial,
    };
  }

  saveState(): unknown {
    const arrays: Record<string, string> = {};
    const src = this.arrays();
    for (const k of Object.keys(src)) arrays[k] = packTyped(src[k]);
    return {
      arrays,
      completed: this.completedFlights, diverted: this.divertedFlights, deadlocks: this.deadlocks,
      autoStands: this.autoStands, nextSerial: this.nextSerial,
      windFromDeg: this.windFromDeg, windKt: this.windKt, testPerHour: this.testPerHour, testTurnScale: this.testTurnScale,
      tick: this.tick, weather: this.weather, rng: this.rng.getState(), weatherRng: this.weatherRng.getState(),
      gaNextTick: this.gaNextTick, gaRng: this.gaRng.getState(),
    };
  }

  /** Restores state on a traffic object whose airfield has already been loaded. */
  loadState(raw: unknown): void {
    const o = raw as { arrays: Record<string, string>; completed: number; diverted: number; deadlocks: number; windFromDeg: number; windKt: number; testPerHour: number; testTurnScale: number; tick: number; weather: 'clear' | 'rain' | 'fog' | 'wind'; rng: number; weatherRng: number; gaNextTick?: number; gaRng?: number };
    const dst = this.arrays();
    const ctors: Record<string, new (b: ArrayBuffer) => never> = {};
    for (const k of Object.keys(dst)) {
      const a = dst[k];
      const C = a.constructor as unknown as new (b: ArrayBuffer) => never;
      ctors[k] = C;
      if (o.arrays[k] !== undefined) unpackInto(o.arrays[k], a as never, C as never);
    }
    this.autoStands = (raw as { autoStands?: boolean }).autoStands ?? true;
    this.completedFlights = o.completed;
    this.divertedFlights = o.diverted;
    this.deadlocks = o.deadlocks;
    this.windFromDeg = o.windFromDeg;
    this.windKt = o.windKt;
    this.testPerHour = o.testPerHour;
    this.testTurnScale = o.testTurnScale;
    this.tick = o.tick;
    this.weather = o.weather;
    this.rng.setState(o.rng);
    this.weatherRng.setState(o.weatherRng);
    // Saves from before GA traffic have no GA state, so the check starts now and the stream keeps its fresh seed.
    this.gaNextTick = o.gaNextTick ?? 0;
    if (o.gaRng !== undefined) this.gaRng.setState(o.gaRng);
    const savedSerial = (raw as { nextSerial?: number }).nextSerial;
    if (savedSerial !== undefined) {
      this.nextSerial = savedSerial;
    } else {
      // Saves from before flight serials: number the live flights in slot order.
      this.fSerial.fill(0);
      this.nextSerial = 1;
      for (let f = 0; f < MAX_FLIGHTS; f++) {
        if (this.fState[f] !== FlState.Free && this.fState[f] !== FlState.Done) this.fSerial[f] = this.nextSerial++;
      }
    }
    this.rebuildActive();
    this.countsDirty = true;
    // Saves from before T87 kept per block counters instead of claims: claim again from where aircraft stand.
    if (o.arrays.claimTo === undefined) {
      this.towIdx.fill(-1);
      this.reclaimAll();
    }
  }

  // Snapshots and hashing --------------------------------------------------

  // hot
  writeSnapshot(views: SnapshotViews): void {
    const n = this.count;
    views.header[SnapHeader.AircraftCount] = n;
    for (let k = 0; k < n; k++) {
      const i = this.activeList[k];
      views.aircraftId[k] = i;
      views.aircraftX[k] = this.x[i];
      views.aircraftY[k] = this.y[i];
      views.aircraftHeading[k] = this.heading[i];
      views.aircraftType[k] = this.type[i];
      views.aircraftState[k] = this.state[i];
      views.aircraftLivery[k] = this.livery[i];
      views.aircraftFlags[k] = (this.waitingFor[i] >= 0 ? 1 : 0) | (this.deadlockUntil[i] > this.tick ? 2 : 0);
    }
  }

  hash(h: number): number {
    let acc = foldU32(h, this.count);
    acc = foldU32(acc, this.completedFlights);
    acc = foldU32(acc, this.deadlocks);
    acc = foldF64(acc, this.bits[0], MAX_AIRCRAFT);
    acc = foldF64(acc, this.bits[1], MAX_AIRCRAFT);
    acc = foldF64(acc, this.bits[2], MAX_AIRCRAFT);
    for (let i = 0; i < MAX_AIRCRAFT; i++) acc = foldU32(acc, this.state[i] + (this.routeIdx[i] << 8));
    acc = foldInts(acc, this.fMovWait, MAX_FLIGHTS);
    acc = foldInts(acc, this.fStand, MAX_FLIGHTS);
    for (let f = 0; f < MAX_FLIGHTS; f++) acc = foldU32(acc, this.fRot[f]);
    acc = foldInts(acc, this.claimFrom, MAX_AIRCRAFT);
    acc = foldInts(acc, this.claimTo, MAX_AIRCRAFT);
    acc = foldInts(acc, this.towIdx, MAX_AIRCRAFT);
    acc = foldInts(acc, this.depWait, MAX_AIRCRAFT);
    acc = foldInts(acc, this.depRetryAt, MAX_AIRCRAFT);
    acc = foldInts(acc, this.boardHold, MAX_AIRCRAFT);
    acc = foldInts(acc, this.fuelOwed, MAX_AIRCRAFT);
    acc = foldInts(acc, this.fuelWait, MAX_AIRCRAFT);
    acc = foldInts(acc, this.tasked, MAX_AIRCRAFT);
    acc = foldInts(acc, this.fCause, MAX_FLIGHTS);
    acc = foldInts(acc, this.fAirlineHold, MAX_FLIGHTS);
    acc = foldInts(acc, this.fSerial, MAX_FLIGHTS);
    acc = foldU32(acc, this.nextSerial);
    acc = foldInts(acc, this.movHead, this.movHead.length);
    acc = foldInts(acc, this.movCount, this.movCount.length);
    acc = foldInts(acc, this.movStart, this.movStart.length);
    acc = foldU32(acc, this.gaNextTick);
    acc = foldU32(acc, this.gaRng.getState());
    return acc;
  }

  /** Aircraft currently on the ground, for the stress tool and the HUD. */
  get onGround(): number {
    let n = 0;
    for (let k = 0; k < this.count; k++) {
      const s = this.state[this.activeList[k]];
      if (s !== AcState.Approach && s !== AcState.Rollout && s !== AcState.Takeoff && s !== AcState.Backtrack) n++;
    }
    return n;
  }

  runwayOf(i: number): Runway | null {
    return this.af.runways[this.rwyIdx[i]] ?? null;
  }
}
