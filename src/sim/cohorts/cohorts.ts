import { ARRIVALS, BUSINESS, DEPARTURES, NEEDS, PROFILES, STAND_ACCESS } from '@data/index';
import { NEED_COUNT, NEED_KEYS } from '@data/schemas/needs';
import { PROFILE_KEYS } from '@data/schemas/profiles';
import { FIXTURE_KEYS, TERMINAL_CELL_M, TICKS_PER_MINUTE, ZONE } from '@shared/business';
import { CLOCK_SCALE, gameSecondsToTicks } from '@shared/time';
import type { Business } from '../business/business';
import { foldU32 } from '../hash';
import { packTyped, unpackInto } from '../save/pack';
import type { Rng } from '../rng';
import { FlState, type Traffic } from '../ops/traffic';
import { BOARDING } from '../ops/turnaround';
import type { ServiceNodes } from '../terminal/serviceNodes';
import { SIDE, buildVisitPoints, findPoint, type VisitPoints } from '../terminal/visitPoints';
import type { TerminalGrid } from '@shared/business';
import { distanceRowIn, nearestNode, newSampleCache, type SampleCache } from '../terminal/walkDistance';
import type { WalkGraph } from '../terminal/walkGraph';
import { ROUTE_OUT, cellAt, routePoint } from './walkSample';
import { COHORT_DRAW, TRAIT, TRAIT_COUNT, memberSeedOf, needRatePerTick, traitU, writeTraits } from './traits';
import { HEADING_STEPS, PEOPLE_MODE, SNAPSHOT_PEOPLE_CAPACITY, SnapHeader, type SnapshotViews } from '@shared/snapshot';
import { atan2Det, cosLut, sinLut, TWO_PI } from '@shared/trig';
import { flowStep } from '@shared/terminalZones';
import { TRAVELATOR } from '@shared/travelator';
import { AIRCRAFT, standGeometry } from '@data/aircraft';

/** Where a cohort is in its journey. Free slots are on the free list. Missed and Boarded are terminal. */
export const Stage = {
  Free: 0,
  Curb: 1,
  ToCheckIn: 2,
  CheckIn: 3,
  ToSecurity: 4,
  Security: 5,
  Airside: 6,
  ToGate: 7,
  Gate: 8,
  Boarded: 9,
  Missed: 10,
  /** A cohort walking to a visit point, standing at one, and walking back to its group. Wheel stages. */
  ToVisit: 11,
  Visit: 12,
  /** A cohort waiting in a toilet queue (T67 slice 7). A queued stage. */
  VisitQueue: 13,
  Rejoin: 14,
  // Arrival stages (T20): passengers leave the aircraft, walk from the entry desk through the terminal and leave at the curb.
  /** Waiting for the doors to open and for the cohort's turn to leave the aircraft. */
  Deboard: 15,
  /** Walking to an immigration node. */
  ToImmigration: 16,
  /** Waiting in an immigration queue or being served (a queued stage). */
  Immigration: 17,
  /** Walking to the carousel of the stand's bay. */
  ToClaim: 18,
  /** Waiting at the carousel for the bags of the flight. */
  Claim: 19,
  /** Walking to a customs node. */
  ToCustoms: 20,
  /** Waiting in a customs queue or being served (a queued stage). */
  Customs: 21,
  /** Standing in the red channel for the long check. */
  CustomsRed: 22,
  /** Walking to the curb. Reaching it ends the journey. */
  ToExit: 23,
  // International departure stages (T79), appended: after security the cohort passes passport control in departure mode.
  /** Walking from security to a passport booth or eGate in departure mode. */
  ToEmigration: 24,
  /** Waiting in a departure passport queue or being served (a queued stage). */
  Emigration: 25,
  // Security exit stages (T80), appended: a domestic arrival leaves the secure zone through an exit queue.
  /** Walking from the aircraft to a security exit. */
  ToSecExit: 26,
  /** Waiting in a security exit queue or being served (a queued stage). */
  SecExit: 27,
} as const;

/** Timer wheel buckets and the tick step between bucket visits. */
const WHEEL = 4096;
const STEP = 5;
/** Ticks a cohort waits before it tries a step again when no service node or path is free. */
const RETRY_TICKS = 100;
/** Cells scanned past a transition fixture's anchor for the first cell outside it. */
const EXIT_SCAN = 8;
/** Ticks a cohort waits before it tries to join a full service queue again. */
const JOIN_RETRY_TICKS = 50;
/** Service tables finish cohorts every this many ticks, so the done buffers are read on the same beat. */
const DONE_EVERY = 10;
const TICKS_PER_SECOND = 10;
const RECIPE_RANGE = 4294967296;
const PERCENT = 100;
const DEG = Math.PI / 180;

const CHECK_IN = FIXTURE_KEYS.indexOf('checkIn') + 1;
const KIOSK = FIXTURE_KEYS.indexOf('kiosk') + 1;
const BAG_DROP = FIXTURE_KEYS.indexOf('bagDrop') + 1;
const SECURITY = FIXTURE_KEYS.indexOf('security') + 1;
const GATE_DESK = FIXTURE_KEYS.indexOf('gateDesk') + 1;
const TOILET = FIXTURE_KEYS.indexOf('toilet') + 1;
const PASSPORT = FIXTURE_KEYS.indexOf('passport') + 1;
const EGATE = FIXTURE_KEYS.indexOf('eGate') + 1;
const CUSTOMS = FIXTURE_KEYS.indexOf('customs') + 1;
const SEC_EXIT = FIXTURE_KEYS.indexOf('securityExit') + 1;

/** Side step of a sampled walker in cells, the squared least gap between drawn groups in metres, and the lanes tried in order. */
const LANE = PROFILES.walkSample.laneOffsetCells;
const MIN_GAP2 = PROFILES.walkSample.minGapM ** 2;
const LANES = Int8Array.of(0, 1, -1);

/** Offsets (dx, dy) of the cells around a dwell anchor, nearest first, as flat pairs. Built once. */
const SPIRAL = (() => {
  const r = PROFILES.walkSample.dwellRingCells;
  const cells: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) cells.push([dx, dy]);
  cells.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
  const out = new Int8Array(cells.length * 2);
  cells.forEach((c, i) => {
    out[2 * i] = c[0];
    out[2 * i + 1] = c[1];
  });
  return out;
})();
const DWELL_TRIES = Math.min(PROFILES.walkSample.dwellTries, SPIRAL.length / 2);

const PROFILE_ROWS = PROFILE_KEYS.map((k) => PROFILES.profiles[k]);
/** Profile index of premium passengers, whom fixture levels treat apart (T74). */
const PREMIUM = PROFILE_KEYS.indexOf('premium');
const LEVELS = BUSINESS.fixtureLevels;

/** Satisfaction points a passenger of a profile loses at a check in desk of a level: premium passengers expect a premium desk (T74). */
export function checkInPenalty(profile: number, level: number): number {
  return profile === PREMIUM && level < LEVELS.premiumLevel ? LEVELS.premiumPenalty : 0;
}
/** Walk speed in metres per second, by profile id. */
const WALK_SPEED = Float32Array.from(PROFILE_ROWS, (r) => r.walkSpeed);
/** 1 for the profiles that never use an automated passport gate, by profile id. */
const NO_GATE = Uint8Array.from(PROFILE_KEYS, (k) => (ARRIVALS.service.eGate.noGateProfiles.includes(k) ? 1 : 0));
/** The same for eGates in departure mode (T79). */
const NO_GATE_DEP = Uint8Array.from(PROFILE_KEYS, (k) => (DEPARTURES.service.eGate.noGateProfiles.includes(k) ? 1 : 0));
/** Cumulative profile mix, so one uniform float picks a profile in a fixed order. */
const MIX_CUM = (() => {
  const out = new Float64Array(PROFILE_ROWS.length);
  let acc = 0;
  for (let k = 0; k < PROFILE_ROWS.length; k++) {
    acc += PROFILE_ROWS[k].mix;
    out[k] = acc;
  }
  return out;
})();
/** Last profile with a positive mix, the fallback when rounding leaves the uniform above the total. */
const LAST_MIXED = (() => {
  let last = 0;
  for (let k = 0; k < PROFILE_ROWS.length; k++) if (PROFILE_ROWS[k].mix > 0) last = k;
  return last;
})();

/** Member slots per cohort block. */
const M = PROFILES.maxGroup;
/** Cohort flag bits: a sub cohort split off a group, a group with a reduced mobility member, and a cohort standing at the point it last walked to with no service node. */
const FLAG_SUB = 1;
export const FLAG_SLOW = 2;
const FLAG_AT_VISIT = 4;
/** Cohort of an international flight, arriving or departing (T79). */
const FLAG_INTL = 8;
/** A cohort an eGate sent to an officer: it queues at a passport booth only. */
const FLAG_REFERRED = 16;
/** An arrival that is done with the baggage claim, so a retry of the next step never claims again. */
const FLAG_CLAIMED = 32;
/** A cohort that was served at passport control and is on its way to the next step, so a retry of that step is a wheel stage and never queues again. */
const FLAG_PASSED = 64;
const SLOW = NEEDS.mobility.slowFactor;
/** Cumulative group size weights per profile, normalised to 1. Index 0 is size 1. */
const GROUP_CUM = PROFILE_ROWS.map((r) => {
  const total = r.groupSize.reduce((a, w) => a + w, 0);
  const out = new Float64Array(r.groupSize.length);
  let acc = 0;
  for (let k = 0; k < out.length; k++) {
    acc += r.groupSize[k]! / total;
    out[k] = acc;
  }
  return out;
});
/** Largest group size with a positive weight per profile, the fallback when rounding leaves the uniform above the total. */
const LAST_SIZE = PROFILE_ROWS.map((r) => {
  let last = 1;
  for (let k = 0; k < r.groupSize.length; k++) if (r.groupSize[k]! > 0) last = k + 1;
  return last;
});

/** Need ids by name, and the per need tables: level of 1 000 is the threshold, visit minutes, spend share and the two fixtures that serve it. */
const NEED_TOILET = NEED_KEYS.indexOf('toilet');
const NEED_SHOP = NEED_KEYS.indexOf('shop');
const NEED_THRESHOLD_H = Float64Array.from(NEED_KEYS, (k) => (k === 'shop' ? 0 : NEEDS.needs[k].thresholdH));
const NEED_THRESHOLD = Float64Array.from(NEED_KEYS, (k) => (k === 'shop' ? NEEDS.shop.threshold * 1000 : 1000));
const NEED_VISIT_MIN = Float64Array.from(NEED_KEYS, (k) => (k === 'shop' ? NEEDS.shop.visitMin : NEEDS.needs[k].visitMin));
const NEED_SPEND_SHARE = Float64Array.from(NEED_KEYS, (k) => (k === 'shop' ? NEEDS.shop.spendShare : NEEDS.needs[k].spendShare));
const fixtureId = (name: (typeof FIXTURE_KEYS)[number]): number => FIXTURE_KEYS.indexOf(name) + 1;
const NEED_KIND_A = Int32Array.from(NEED_KEYS, (k) => (k === 'shop' ? 0 : fixtureId(NEEDS.needs[k].fixtures[0]!)));
const NEED_KIND_B = Int32Array.from(NEED_KEYS, (k) => (k === 'shop' ? 0 : fixtureId(NEEDS.needs[k].fixtures[1] ?? NEEDS.needs[k].fixtures[0]!)));
/** Counters of the current day: visits per need, visitor spend, the satisfaction of passengers rated today and their number, then the penalty points taken by cause, then the arrival counters (passengers exited and stranded, claim wait seconds and claims, passengers without bags) and their penalty points. */
export const DAY = { Visits0: 0, Spend: NEED_COUNT, SatSum: NEED_COUNT + 1, SatCount: NEED_COUNT + 2, PenQueue: NEED_COUNT + 3, PenWalk: NEED_COUNT + 4, PenUnmet: NEED_COUNT + 5, PenMissed: NEED_COUNT + 6, ArrExited: NEED_COUNT + 7, ArrStranded: NEED_COUNT + 8, ClaimWaitS: NEED_COUNT + 9, ClaimCount: NEED_COUNT + 10, NoBags: NEED_COUNT + 11, PenMissingBag: NEED_COUNT + 12, PenStranded: NEED_COUNT + 13, Count: NEED_COUNT + 14 } as const;
const SAT = NEEDS.satisfaction;
const SECONDS_PER_MINUTE = 60;
const HOURS_PER_LEVEL = 1000;

/** Points a cohort loses for a queue wait: one rate per game minute over the profile's patience. */
export function queuePoints(waitTicks: number, patienceS: number): number {
  const waitS = (waitTicks * CLOCK_SCALE) / TICKS_PER_SECOND;
  return (Math.max(0, waitS - patienceS) / SECONDS_PER_MINUTE) * SAT.queuePerMin;
}

/** Points lost for a walk leg of `distM` metres: a rate per metre over the comfortable leg. */
export function walkPoints(distM: number): number {
  return Math.max(0, distM - SAT.walkComfortM) * SAT.walkPerM;
}

/** Points lost for a need still over its threshold: a rate per game hour spent over it. Level 1 000 is the threshold. */
export function unmetPoints(level: number, need: number, factor: number): number {
  if (level <= HOURS_PER_LEVEL) return 0;
  const hours = ((level - HOURS_PER_LEVEL) * NEED_THRESHOLD_H[need]!) / (HOURS_PER_LEVEL * factor);
  return hours * SAT.unmetPerHour;
}

/** Room id of the walk node nearest to an array cell, -1 when there is none. */
function nearestNodeRoom(wg: WalkGraph, cell: number): number {
  const node = nearestNode(wg, cell);
  return node < 0 ? -1 : wg.nodeRoom[node]!;
}

/** Per slot arrays the save packs up to `hi`, and the per flight arrays and wheel that it packs whole. */
type SlotArray = Int16Array | Uint8Array | Uint16Array | Int32Array | Uint32Array;
type SlotCtor = { new (buffer: ArrayBuffer): SlotArray; BYTES_PER_ELEMENT: number };

export interface CohortsSave {
  generated: number;
  boarded: number;
  missed: number;
  active: number;
  hi: number;
  freeHead: number;
  rng: number;
  arrays: Record<string, string>;
  /** Day counters, and the ring of the last days of rated passengers. Absent in saves from before version 30. */
  day?: string;
  ringSum?: string;
  ringCount?: string;
  ringHead?: number;
  /** Arrival counters [arrGenerated, arrExited, arrStranded, arrActive] and the arrivals rng. Absent in saves from before version 31. */
  arr?: number[];
  arrRng?: number;
}

/**
 * Passenger cohorts of the departures: a struct of arrays of groups that share a flight, a profile and a journey.
 * Slots come from a free list, and the cohorts due to move sit in a timer wheel. People are counted, never drawn.
 */
export class Cohorts {
  readonly cap = PROFILES.capacity;
  flight = new Int16Array(this.cap);
  size = new Uint8Array(this.cap);
  profile = new Uint8Array(this.cap);
  stage = new Uint8Array(this.cap);
  /** Service node index in the grid's ServiceNodes, -1 for none. */
  node = new Int32Array(this.cap);
  /** Wake tick. */
  timer = new Int32Array(this.cap);
  bags = new Uint8Array(this.cap);
  spendBudget = new Uint16Array(this.cap);
  satisfaction = new Uint8Array(this.cap);
  recipeSeed = new Uint32Array(this.cap);
  flags = new Uint8Array(this.cap);
  /** Grid index the cohort uses. */
  building = new Uint8Array(this.cap);
  /** Logical cell of the walk node the cohort left and the one it heads for, valid while walkStart is not -1. */
  walkFromX = new Int16Array(this.cap);
  walkFromY = new Int16Array(this.cap);
  walkToX = new Int16Array(this.cap);
  walkToY = new Int16Array(this.cap);
  /** Tick the current walk began, -1 for none. */
  walkStart = new Int32Array(this.cap).fill(-1);
  /** Tick the need levels of the cohort's members were last brought up to date. */
  needTick = new Int32Array(this.cap);
  /** Stable serial of the flight of an arrival cohort, since flight indexes are reused, and the tick its doors opened. */
  serial = new Int32Array(this.cap);
  born = new Int32Array(this.cap);
  /** Main cohort slot a sub cohort came from, -1 for a main cohort. */
  parent = new Int32Array(this.cap).fill(-1);
  /** Tick the cohort joined its current queue, -1 when it is not waiting. */
  waitStart = new Int32Array(this.cap).fill(-1);
  /** Anchor cell of the visit point a sub cohort heads for, -1 for none. */
  target = new Int32Array(this.cap).fill(-1);
  /** Need id of the visit in progress. */
  visitNeed = new Uint8Array(this.cap);
  /** Per member, block of M per cohort slot: seed (identity, saved), the NEED_COUNT need levels (1 000 is the threshold) and satisfaction 0 to 100. */
  memberSeed = new Uint32Array(this.cap * M);
  memberNeed = new Uint16Array(this.cap * M * NEED_COUNT);
  memberSat = new Uint8Array(this.cap * M);
  /** Free list link and wheel link. */
  next = new Int32Array(this.cap);
  /** One past the highest slot ever used. */
  hi = 0;
  freeHead = -1;
  readonly wheelHead = new Int32Array(WHEEL).fill(-1);
  /** Passengers, not cohorts. */
  generated = 0;
  boarded = 0;
  missed = 0;
  active = 0;
  /** Arriving passengers: generated, left at the curb, stranded and still in the terminal. Passengers, not cohorts. */
  arrGenerated = 0;
  arrExited = 0;
  arrStranded = 0;
  arrActive = 0;
  readonly flBoarded: Int32Array;
  readonly flGate: Int32Array;
  readonly flActive: Int32Array;
  /** Called with grid id, anchor cell index, flight serial and bag count when a cohort finishes at a check in or bag drop node. Set by the sim (T43). */
  onCheckIn: ((gridId: number, cell: number, serial: number, bags: number) => void) | null = null;
  /** The baggage side of the claim, set by the sim (T20): when the first bags of a flight reached a carousel and which carousel serves it. */
  bagLookup: { deliveredAt(serial: number): number; arrivalCarousel(serial: number, out: Int32Array): boolean } | null = null;
  private readonly carOut = new Int32Array(3);
  private readonly rng: Rng;
  private readonly initialRng: number;
  private readonly arrRng: Rng;
  private readonly initialArrRng: number;
  private readonly business: Business;
  private readonly traffic: Traffic;
  private tick = 0;
  /** The business service version the queued cohorts were last checked against. */
  private seenVersion: number;
  /** One mark per cell of the grid being sampled, 1 once a figure stands there in the current sample. */
  private occupied = new Int32Array(0);
  /** Sample caches of the walk rows, one per grid. Derived, never saved or hashed. */
  private sampleCaches: SampleCache[] = [];
  private sampleCacheVersion = -1;
  /** Visit points per grid. Derived from the grids, never saved or hashed. */
  private visitTables: VisitPoints[] = [];
  private readonly route = new Float64Array(ROUTE_OUT);
  /** Counters of the current day, layout in DAY. */
  readonly day = new Float64Array(DAY.Count);
  /** The last closed day, copied from `day` at the daily close. Derived, never saved or hashed. */
  readonly lastDay = new Float64Array(DAY.Count);
  /** Ring of the satisfaction sum and the passenger count of the last windowDays days, and the slot written next. */
  private readonly ringSum = new Float64Array(SAT.windowDays);
  private readonly ringCount = new Float64Array(SAT.windowDays);
  private ringHead = 0;
  /** Scratch trait vector of one member. */
  private readonly traits = new Float64Array(TRAIT_COUNT);
  /** Per slot: last route node a walker was resumed from and the length walked up to it. Derived, never saved or hashed. */
  private trailNode = new Int32Array(this.cap).fill(-1);
  private trailAt = new Float64Array(this.cap);
  /** World position written by toWorld. */
  private readonly world = new Float64Array(2);
  /** Axes and heading of the grid being sampled. */
  private axUx = 0;
  private axUy = 0;
  private axVx = 0;
  private axVy = 0;
  private axA = 0;

  constructor(rng: Rng, business: Business, traffic: Traffic) {
    this.rng = rng.fork('cohorts');
    this.initialRng = this.rng.getState();
    this.arrRng = rng.fork('arrivals');
    this.initialArrRng = this.arrRng.getState();
    this.business = business;
    this.traffic = traffic;
    this.flBoarded = new Int32Array(traffic.fState.length);
    this.flGate = new Int32Array(traffic.fState.length);
    this.flActive = new Int32Array(traffic.fState.length);
    this.seenVersion = business.serviceVersion;
    this.ensureOccupancy();
  }

  /** A free slot, or -1 when the store is full. */
  alloc(): number {
    if (this.freeHead >= 0) {
      const c = this.freeHead;
      this.freeHead = this.next[c];
      return c;
    }
    return this.hi < this.cap ? this.hi++ : -1;
  }

  /** Returns a slot to the free list. The caller has taken it out of the wheel. */
  free(c: number): void {
    this.stage[c] = Stage.Free;
    this.next[c] = this.freeHead;
    this.freeHead = c;
  }

  /** Generates the passengers of a flight that is scheduled. Flights with too few seats, or with no eligible grid, get none. */
  onScheduled(f: number, tick: number): void {
    this.tick = tick;
    if (this.flActive[f] > 0) this.onPushback(f);
    this.flBoarded[f] = 0;
    this.flGate[f] = 0;
    if (!this.business.needsTerminal(f)) return;
    const grid = this.business.cohortGrid(f);
    if (grid < 0) return;
    let remaining = this.business.paxFor(f);
    const dep = this.traffic.fEta[f] + this.traffic.fTurn[f];
    const intl = this.business.market.isInternational(f);
    while (remaining > 0) {
      const c = this.alloc();
      if (c < 0) break;
      const p = this.pickProfile(this.rng.next());
      const row = PROFILE_ROWS[p];
      const size = Math.min(remaining, this.pickSize(p, this.rng.next()));
      const lead = row.leadMin * TICKS_PER_MINUTE;
      const u = this.rng.next();
      const curb = dep - Math.round(lead * (1 + PROFILES.arrivalSpread * (2 * u - 1)));
      this.flight[c] = f;
      this.size[c] = size;
      this.profile[c] = p;
      this.building[c] = grid;
      this.bags[c] = Math.round(size * row.bagsPerPax);
      this.spendBudget[c] = size * row.spend;
      this.satisfaction[c] = PERCENT;
      this.recipeSeed[c] = Math.floor(this.rng.next() * RECIPE_RANGE);
      this.flags[c] = intl ? FLAG_INTL : 0;
      this.node[c] = -1;
      this.walkStart[c] = -1;
      this.parent[c] = -1;
      this.waitStart[c] = -1;
      this.target[c] = -1;
      this.visitNeed[c] = 0;
      this.initMembers(c, curb);
      this.stage[c] = Stage.Curb;
      this.schedule(c, curb);
      this.generated += size;
      this.active += size;
      this.flActive[f] += size;
      remaining -= size;
    }
  }

  /**
   * Generates the arriving cohorts of a flight that just docked (T20 D3, D4). They leave the aircraft one after the
   * other from doors open, the stagger shared by the door count of the type, stretched at a far stand without a bus and
   * delayed by the bus ride at a remote one. Drawn from the arrivals stream so the departure draws do not move.
   */
  onDocked(f: number, tick: number, boarding: number): void {
    this.tick = tick;
    const pax = this.business.flightPaxOf(f);
    if (pax <= 0 || !this.business.arrivalEntry(f)) return;
    const g = this.business.entryOut[0]!;
    const entry = this.business.entryOut[1]!;
    const intl = this.business.entryOut[2] === 1;
    const wg = this.business.walkGraphs[g];
    if (!wg) return;
    const doors = Math.max(1, standGeometry(AIRCRAFT[this.traffic.fType[f]!]!).doorStationsM.length);
    const born = tick + gameSecondsToTicks(ARRIVALS.doorOpenS);
    const per = (ARRIVALS.deboardSecondsPerPax * (boarding === BOARDING.farSlow ? 1 + STAND_ACCESS.farBoardingSlowdown : 1)) / doors;
    const bus = boarding === BOARDING.bus ? gameSecondsToTicks(ARRIVALS.remoteBusS) : 0;
    const serial = this.traffic.serialOf(f);
    let remaining = pax;
    let ahead = 0;
    while (remaining > 0) {
      const c = this.alloc();
      if (c < 0) break;
      const p = this.pickProfile(this.arrRng.next());
      const row = PROFILE_ROWS[p]!;
      const size = Math.min(remaining, this.pickSize(p, this.arrRng.next()));
      const release = born + bus + (ahead > 0 ? gameSecondsToTicks(ahead * per) : 0);
      this.flight[c] = f;
      this.size[c] = size;
      this.profile[c] = p;
      this.building[c] = g;
      this.bags[c] = Math.round(size * row.bagsPerPax);
      this.spendBudget[c] = 0;
      this.satisfaction[c] = PERCENT;
      this.recipeSeed[c] = Math.floor(this.arrRng.next() * RECIPE_RANGE);
      this.serial[c] = serial;
      this.born[c] = born;
      this.flags[c] = (intl ? FLAG_INTL : 0) | FLAG_AT_VISIT;
      this.node[c] = -1;
      this.walkStart[c] = -1;
      this.parent[c] = -1;
      this.waitStart[c] = -1;
      this.target[c] = -1;
      this.visitNeed[c] = 0;
      this.walkToX[c] = wg.nodeX[entry]!;
      this.walkToY[c] = wg.nodeY[entry]!;
      this.walkFromX[c] = this.walkToX[c]!;
      this.walkFromY[c] = this.walkToY[c]!;
      this.initMembers(c, release);
      this.stage[c] = Stage.Deboard;
      this.schedule(c, release);
      this.arrGenerated += size;
      this.arrActive += size;
      ahead += size;
      remaining -= size;
    }
  }

  /** True for the stages a passenger can be in before boarding or missing the flight. */
  private live(st: number): boolean {
    return (st >= Stage.Curb && st <= Stage.Gate) || (st >= Stage.ToVisit && st <= Stage.Rejoin) || st === Stage.ToEmigration || st === Stage.Emigration;
  }

  /** True for the stages in which a cohort waits in a service queue, off the timer wheel. */
  private queued(st: number): boolean {
    return (
      st === Stage.CheckIn || st === Stage.Security || st === Stage.Gate || st === Stage.VisitQueue || st === Stage.Immigration || st === Stage.Customs ||
      st === Stage.Emigration || st === Stage.SecExit
    );
  }

  /** True for the stages in which a cohort walks between two walk nodes. */
  private walking(st: number): boolean {
    return (
      st === Stage.ToCheckIn || st === Stage.ToSecurity || st === Stage.ToGate || st === Stage.ToVisit || st === Stage.Rejoin ||
      st === Stage.ToImmigration || st === Stage.ToClaim || st === Stage.ToCustoms || st === Stage.ToExit || st === Stage.ToEmigration ||
      st === Stage.ToSecExit
    );
  }

  /**
   * The zone rule the sample applies to a stage: 0 any zone, 1 airside (not Public), 2 landside (not Secure).
   * Arrivals use any zone, since one walk crosses from airside to Public (T20 D14).
   */
  private zoneRule(st: number): number {
    if (this.arriving(st)) return 0;
    return st === Stage.Airside || st === Stage.ToGate || st === Stage.ToVisit || st === Stage.Rejoin || st === Stage.Visit || st === Stage.ToEmigration ? 1 : 2;
  }

  /** True for the stages of an arriving passenger. */
  private arriving(st: number): boolean {
    return (st >= Stage.Deboard && st <= Stage.ToExit) || st === Stage.ToSecExit || st === Stage.SecExit;
  }

  /** Group size for a uniform float: the first size whose cumulative weight exceeds it. */
  private pickSize(p: number, u: number): number {
    const cum = GROUP_CUM[p]!;
    for (let k = 0; k < cum.length; k++) if (u < cum[k]!) return k + 1;
    return LAST_SIZE[p]!;
  }

  /** Seeds the members of cohort `c` from its recipe seed, with full satisfaction, empty needs and the shopping want. Also the entry for arrival cohorts. */
  initMembers(c: number, tick: number): void {
    const b = c * M;
    const profile = this.profile[c]!;
    for (let i = 0; i < this.size[c]!; i++) {
      const seed = memberSeedOf(this.recipeSeed[c]!, i);
      writeTraits(seed, profile, this.traits);
      this.memberSeed[b + i] = seed;
      this.memberSat[b + i] = NEEDS.satisfaction.start;
      const n = (b + i) * NEED_COUNT;
      for (let k = 0; k < NEED_COUNT - 1; k++) this.memberNeed[n + k] = 0;
      this.memberNeed[n + NEED_COUNT - 1] = Math.floor(this.traits[TRAIT.Desire]! * 1000);
    }
    this.needTick[c] = tick;
    this.syncFlags(c);
    this.syncSat(c);
  }

  /** Sets the SLOW bit when any live member has reduced mobility. Keeps the other bits. */
  private syncFlags(c: number): void {
    const b = c * M;
    const profile = this.profile[c]!;
    let slow = false;
    for (let i = 0; i < this.size[c]! && !slow; i++) {
      writeTraits(this.memberSeed[b + i]!, profile, this.traits);
      slow = this.traits[TRAIT.Slow] === 1;
    }
    this.flags[c] = slow ? this.flags[c]! | FLAG_SLOW : this.flags[c]! & ~FLAG_SLOW;
  }

  /** Cohort satisfaction is the rounded mean of its live members. */
  private syncSat(c: number): void {
    const n = this.size[c]!;
    if (n === 0) return;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.memberSat[c * M + i]!;
    this.satisfaction[c] = Math.round(sum / n);
  }

  /** Walk speed in metres per second: the profile speed, slowed when a member has reduced mobility. */
  private speed(c: number): number {
    return WALK_SPEED[this.profile[c]!]! * (this.flags[c]! & FLAG_SLOW ? SLOW : 1);
  }

  /** The flight leaves the stand: the passengers still in the terminal miss it. Those in a queue wait for their done event. */
  onPushback(f: number): void {
    for (let c = 0; c < this.hi; c++) {
      const st = this.stage[c];
      if (this.flight[c] !== f || !this.live(st)) continue;
      const n = this.size[c];
      this.missed += n;
      this.active -= n;
      this.rollUp(c, true);
      if (this.queued(st)) {
        this.stage[c] = Stage.Missed;
      } else {
        this.unlink(c);
        this.free(c);
      }
    }
    this.flActive[f] = 0;
    this.flGate[f] = 0;
  }

  /** True when no passenger of the flight is at a gate desk or on the way to one. Aircraft without a flight never hold. */
  boardingReady(f: number): boolean {
    return f < 0 || this.flGate[f] === 0;
  }

  /**
   * A terminal building was demolished. Its passengers miss their flight, since no service table is left for them,
   * and the grids after it shift down one index.
   */
  onGridRemoved(g: number): void {
    for (let c = 0; c < this.hi; c++) {
      const st = this.stage[c];
      if (st === Stage.Free) continue;
      const b = this.building[c];
      if (b > g) {
        this.building[c] = b - 1;
        continue;
      }
      if (b !== g) continue;
      if (this.arriving(st)) {
        if (!this.queued(st)) this.unlink(c);
        this.strand(c);
        continue;
      }
      if (st === Stage.Missed) {
        this.free(c);
        continue;
      }
      if (!this.live(st)) continue;
      const f = this.flight[c];
      const n = this.size[c];
      this.missed += n;
      this.active -= n;
      this.rollUp(c, true);
      this.flActive[f] -= n;
      if (st === Stage.ToGate || st === Stage.Gate) this.flGate[f] -= n;
      // Queued passengers are not on the wheel, the rest are.
      if (!this.queued(st)) this.unlink(c);
      this.free(c);
    }
  }

  /** Sizes the cell marks for the largest grid. Runs when the tables change or a save loads, never per snapshot. */
  private ensureOccupancy(): void {
    let largest = 0;
    for (const g of this.business.grids) largest = Math.max(largest, g.w * g.h);
    if (this.occupied.length < largest) this.occupied = new Int32Array(largest);
  }

  /** Rebuilds the walk row caches of the sample when the graphs changed. Allocates only then. */
  private ensureSampleCaches(): void {
    const wgs = this.business.walkGraphs;
    let stale = this.sampleCacheVersion !== this.business.walkVersion || this.sampleCaches.length !== wgs.length;
    for (let g = 0; !stale && g < wgs.length; g++) stale = this.sampleCaches[g]!.sourceRow.length !== wgs[g]!.nodeCount;
    if (!stale) return;
    this.sampleCaches = wgs.map((wg) => newSampleCache(wg));
    this.sampleCacheVersion = this.business.walkVersion;
    this.trailNode.fill(-1, 0, this.hi);
  }

  /** World position in metres of the centred logical point (lx, ly) of a grid, left in this.world. */
  private toWorld(grid: TerminalGrid, lx: number, ly: number): void {
    this.world[0] = grid.ox + (this.axUx * lx + this.axVx * ly) * TERMINAL_CELL_M;
    this.world[1] = grid.oy + (this.axUy * lx + this.axVy * ly) * TERMINAL_CELL_M;
  }

  /**
   * True when a walker may stand at this.world on array cell `cell`: floor, free, in its zone, in its room and clear of
   * other groups. With ride set, a free travelator cell also counts, so riders show on the belt (T77).
   */
  private clear(views: SnapshotViews, grid: TerminalGrid, wg: WalkGraph, cell: number, rule: number, room: number, ride = false): boolean {
    if (cell < 0 || this.occupied[cell] !== 0) return false;
    if (!ride || grid.fixture[cell] !== TRAVELATOR) {
      if (wg.cellMain[cell]! < 0 || grid.fixture[cell] !== 0) return false;
      const zone = grid.zone[cell];
      if (rule === 1 ? zone === ZONE.Public : rule === 2 && zone === ZONE.Secure) return false;
      if (room >= 0) {
        const node = nearestNode(wg, cell);
        if (node < 0 || wg.nodeRoom[node] !== room) return false;
      }
    }
    const cx = cell % grid.w;
    const cy = (cell - cx) / grid.w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
        const m = this.occupied[ny * grid.w + nx]! - 1;
        if (m < 0) continue;
        const gx = views.peopleX[m]! - this.world[0]!;
        const gy = views.peopleY[m]! - this.world[1]!;
        if (gx * gx + gy * gy < MIN_GAP2) return false;
      }
    }
    return true;
  }

  /** Writes entry n for cohort c at this.world, facing the grid step (ex, ey), and marks its cell. */
  private put(views: SnapshotViews, n: number, c: number, ex: number, ey: number, mode: number, cell: number): void {
    views.peopleX[n] = this.world[0]!;
    views.peopleY[n] = this.world[1]!;
    views.peopleProfile[n] = this.profile[c]!;
    views.peopleSize[n] = this.size[c]!;
    views.peopleSeed[n] = this.recipeSeed[c]!;
    views.peopleHeading[n] = Math.round(((this.axA + atan2Det(ey, ex)) * HEADING_STEPS) / TWO_PI) & (HEADING_STEPS - 1);
    views.peopleId[n] = c;
    views.peopleMode[n] = mode;
    this.occupied[cell] = n + 1;
  }

  /**
   * Writes the people for the renderer in three passes per grid: queued, walking and dwelling. Queued cohorts stand
   * in the queue cell of their rank at their node and face the cell they were reached from, the node cell for the
   * first ring. Walking cohorts are placed on their route, by the time walked, on the first of three lanes that is
   * clear. Dwelling cohorts (airside, or arrived and waiting for their wake) stand on the nearest clear cell of a
   * spiral around the node they walked to. A cell already held by a figure in this sample is skipped, so no two
   * figures share a spot, and walkers and dwellers keep a least gap to other groups. Reads only, the sim state does
   * not change, and only the derived caches are written.
   */
  writeSample(views: SnapshotViews, tick: number): void {
    this.ensureSampleCaches();
    const cap = Math.min(PROFILES.sampleCap, SNAPSHOT_PEOPLE_CAPACITY);
    let n = 0;
    for (let g = 0; g < this.business.grids.length && n < cap; g++) {
      const t = this.table(g);
      if (!t) continue;
      const grid = this.business.grids[g]!;
      const wg = this.business.walkGraphs[g]!;
      this.occupied.fill(0, 0, grid.w * grid.h);
      // Axes of the grid, as terminalOps gridAxes gives them. Constant per grid, so computed once here.
      this.axA = grid.headingDeg * DEG;
      this.axUx = sinLut(this.axA);
      this.axUy = -cosLut(this.axA);
      this.axVx = -this.axUy;
      this.axVy = this.axUx;
      for (let k = 0; k < t.count && n < cap; k++) {
        const ranks = Math.min(t.qCount[k]!, t.qCellLen[k]!);
        const off = t.qCellOffset[k]!;
        for (let i = 0; i < ranks && n < cap; i++) {
          const cell = off + i;
          const lx = t.qCellX[cell]!;
          const ly = t.qCellY[cell]!;
          const mark = (ly - grid.y0) * grid.w + (lx - grid.x0);
          if (this.occupied[mark] !== 0) continue;
          const parent = t.qCellParent[cell]!;
          const frontX = parent < 0 ? t.lx[k]! : t.qCellX[off + parent]!;
          const frontY = parent < 0 ? t.ly[k]! : t.qCellY[off + parent]!;
          const c = t.qCohort[k * t.slots + ((t.qHead[k]! + i) % t.slots)]!;
          // The step from this cell toward the cell it was reached from, snapped to its dominant grid axis.
          const dx = frontX - lx;
          const dy = frontY - ly;
          const sx = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
          const sy = sx === 0 ? Math.sign(dy) : 0;
          // Figure forward is local minus y, which maps to (sin, -cos) at heading zero, so the grid frame angle
          // of the step is atan2(sy, sx) turned by the grid heading. Half a cell past the corner is the centre.
          this.toWorld(grid, lx + 0.5, ly + 0.5);
          this.put(views, n, c, sx, sy, PEOPLE_MODE.Queued, mark);
          n++;
        }
      }
      const cache = this.sampleCaches[g]!;
      for (let c = 0; c < this.hi && n < cap; c++) {
        const st = this.stage[c]!;
        if (this.building[c] !== g || this.walkStart[c]! < 0) continue;
        if (!this.walking(st)) continue;
        const from = nearestNode(wg, cellAt(wg, this.walkFromX[c]!, this.walkFromY[c]!));
        const to = nearestNode(wg, cellAt(wg, this.walkToX[c]!, this.walkToY[c]!));
        if (from < 0 || to < 0) continue;
        const s = Math.max(0, ((tick - this.walkStart[c]!) * this.speed(c)) / TICKS_PER_SECOND);
        const resume = this.trailNode[c]! >= 0 && this.trailAt[c]! <= s;
        const r = resume
          ? routePoint(wg, cache, this.trailNode[c]!, this.trailAt[c]!, to, s, this.route)
          : routePoint(wg, cache, from, 0, to, s, this.route);
        if (r !== 1) continue;
        this.trailNode[c] = this.route[4]!;
        this.trailAt[c] = this.route[5]!;
        const ex = this.route[2]!;
        const ey = this.route[3]!;
        const sx = Math.abs(ex) >= Math.abs(ey) ? Math.sign(ex) : 0;
        const sy = sx === 0 ? Math.sign(ey) : 0;
        const px = this.route[0]!;
        const py = this.route[1]!;
        const room = nearestNodeRoom(wg, cellAt(wg, Math.floor(px), Math.floor(py)));
        const rule = this.zoneRule(st);
        for (let l = 0; l < LANES.length; l++) {
          const off = LANES[l]! * LANE;
          const qx = px - sy * off;
          const qy = py + sx * off;
          this.toWorld(grid, qx, qy);
          const cellIdx = cellAt(wg, Math.floor(qx), Math.floor(qy));
          if (!this.clear(views, grid, wg, cellIdx, rule, room, true)) continue;
          this.put(views, n, c, sx, sy, PEOPLE_MODE.Walking, cellIdx);
          n++;
          break;
        }
      }
      for (let c = 0; c < this.hi && n < cap; c++) {
        const st = this.stage[c]!;
        if (this.building[c] !== g || this.walkStart[c]! < 0) continue;
        const rule = this.zoneRule(st);
        const dwelling = st === Stage.Airside || st === Stage.Visit || st === Stage.Claim || st === Stage.CustomsRed;
        if (!dwelling) {
          if (!this.walking(st)) continue;
          const from = nearestNode(wg, cellAt(wg, this.walkFromX[c]!, this.walkFromY[c]!));
          const to = nearestNode(wg, cellAt(wg, this.walkToX[c]!, this.walkToY[c]!));
          if (from < 0 || to < 0) continue;
          const base = distanceRowIn(wg, cache, to);
          if (base < 0) continue;
          const total = cache.rows[base + from]!;
          const s = Math.max(0, ((tick - this.walkStart[c]!) * this.speed(c)) / TICKS_PER_SECOND);
          if (!Number.isFinite(total) || s < total) continue;
        }
        const ax = this.walkToX[c]!;
        const ay = this.walkToY[c]!;
        const anchor = nearestNode(wg, cellAt(wg, ax, ay));
        if (anchor < 0) continue;
        const room = wg.nodeRoom[anchor]!;
        for (let i = 0; i < DWELL_TRIES; i++) {
          const dx = SPIRAL[2 * i]!;
          const dy = SPIRAL[2 * i + 1]!;
          this.toWorld(grid, ax + dx + 0.5, ay + dy + 0.5);
          const cellIdx = cellAt(wg, ax + dx, ay + dy);
          if (!this.clear(views, grid, wg, cellIdx, rule, room)) continue;
          const fx = i === 0 ? 0 : dwelling ? dx : -dx;
          const fy = i === 0 ? -1 : dwelling ? dy : -dy;
          this.put(views, n, c, fx, fy, PEOPLE_MODE.Dwelling, cellIdx);
          n++;
          break;
        }
      }
    }
    views.header[SnapHeader.PeopleCount] = n;
  }

  /** Passengers of the flight that have boarded so far. */
  boardedFor(f: number): number {
    return this.flBoarded[f];
  }

  /** Runs the cohorts due at this tick. The wheel is visited every STEP ticks. */
  update(tick: number): void {
    this.tick = tick;
    // Node ids go stale on the tick of an edit, so walkers are reset on every tick and no edit is pending at a tick boundary.
    if (this.business.serviceVersion !== this.seenVersion) this.resetWalkers();
    if (tick % STEP !== 0) return;
    // Evicted cohorts are moved on the wheel beat. Evictions still pending after a load are picked up here too.
    if (this.evictionsPending()) this.evictQueues();
    if (tick % DONE_EVERY === 0) this.drainDone();
    const b = (tick / STEP) & (WHEEL - 1);
    let c = this.wheelHead[b];
    this.wheelHead[b] = -1;
    while (c >= 0) {
      const after = this.next[c];
      if (this.timer[c] > tick) this.link(c);
      else this.step(c);
      c = after;
    }
  }

  /** The service tables were rebuilt: walking cohorts lose their node ids, which may have renumbered. */
  private resetWalkers(): void {
    this.ensureOccupancy();
    for (let c = 0; c < this.hi; c++) {
      const st = this.stage[c];
      if (st === Stage.ToCheckIn || st === Stage.ToSecurity || st === Stage.Airside || st === Stage.ToGate || (st === Stage.ToVisit && this.visitNeed[c] === NEED_TOILET)) this.node[c] = -1;
      else if (st === Stage.ToImmigration || st === Stage.ToCustoms || st === Stage.ToEmigration || st === Stage.ToSecExit) {
        this.node[c] = -1;
        this.flags[c] = this.flags[c]! | FLAG_AT_VISIT;
        this.keepAnchor(c);
      }
    }
    this.rebuildVisitTables();
    this.seenVersion = this.business.serviceVersion;
  }

  /** Builds the visit points of every grid from the current grids and walk graphs. */
  private rebuildVisitTables(): void {
    const grids = this.business.grids;
    this.visitTables = [];
    for (let g = 0; g < grids.length; g++) {
      const wg = this.business.walkGraphs[g];
      if (wg) this.visitTables.push(buildVisitPoints(grids[g]!, wg));
    }
  }

  /** Visit points of a grid index, null when there is none. Public for tests only. */
  visitTable(g: number): VisitPoints | null {
    return this.visitTables[g] ?? null;
  }

  /** Cohorts evicted from a removed queue node go back to the step they queued from. */
  private evictQueues(): void {
    for (let g = 0; g < this.business.grids.length; g++) {
      const t = this.table(g);
      if (!t) continue;
      for (let k = 0; k < t.evictedCount; k++) {
        const c = t.evicted[k];
        if (this.building[c] === g) this.evict(c);
      }
      t.evictedCount = 0;
    }
  }

  private evictionsPending(): boolean {
    for (let g = 0; g < this.business.grids.length; g++) {
      const t = this.table(g);
      if (t && t.evictedCount > 0) return true;
    }
    return false;
  }

  /** A cohort whose queue node was removed: a missed one leaves, the others walk again from the curb. */
  private evict(c: number): void {
    const st = this.stage[c];
    if (st === Stage.Missed) {
      this.free(c);
      return;
    }
    if (st === Stage.CheckIn) this.stage[c] = Stage.ToCheckIn;
    else if (st === Stage.Security) this.stage[c] = Stage.ToSecurity;
    else if (st === Stage.Gate) this.stage[c] = Stage.ToGate;
    else if (st === Stage.VisitQueue) this.stage[c] = Stage.ToVisit;
    else if (st === Stage.Immigration) {
      this.stage[c] = Stage.ToImmigration;
      this.flags[c] = this.flags[c]! | FLAG_AT_VISIT;
      this.keepAnchor(c);
    } else if (st === Stage.Customs) {
      this.stage[c] = Stage.ToCustoms;
      this.flags[c] = this.flags[c]! | FLAG_AT_VISIT;
      this.keepAnchor(c);
    } else if (st === Stage.Emigration) {
      this.stage[c] = Stage.ToEmigration;
      this.flags[c] = this.flags[c]! | FLAG_AT_VISIT;
      this.keepAnchor(c);
    } else if (st === Stage.SecExit) {
      this.stage[c] = Stage.ToSecExit;
      this.flags[c] = this.flags[c]! | FLAG_AT_VISIT;
      this.keepAnchor(c);
    } else return;
    this.node[c] = -1;
    this.waitStart[c] = -1;
    this.schedule(c, this.tick + STEP);
  }

  /** Cohorts that finished at a service node: check in hands on to security, the gate desk boards, missed ones leave. */
  private drainDone(): void {
    for (let g = 0; g < this.business.grids.length; g++) {
      const t = this.table(g);
      if (!t) continue;
      for (let k = 0; k < t.doneCount; k++) {
        const c = t.doneCohort[k];
        if (this.building[c] !== g) continue;
        const st = this.stage[c];
        if (!this.queued(st) && st !== Stage.Missed) continue;
        // Node indices can renumber after an edit, so the done node is the one to trust.
        this.node[c] = t.doneNode[k];
        if (st !== Stage.Missed && this.waitStart[c]! >= 0) {
          this.penalize(c, queuePoints(this.tick - this.waitStart[c]!, PROFILE_ROWS[this.profile[c]!]!.patienceS), DAY.PenQueue);
          this.waitStart[c] = -1;
        }
        // Premium passengers expect a premium desk: a check in below the premium level costs them points (T74).
        if (st === Stage.CheckIn && t.kind[t.doneNode[k]!] === CHECK_IN) {
          const points = checkInPenalty(this.profile[c]!, this.business.grids[g]!.fixtureLevel[t.cell[t.doneNode[k]!]!]!);
          if (points > 0) this.penalize(c, points, DAY.PenQueue);
        }
        this.finish(g, c, st, t);
      }
    }
  }

  private finish(g: number, c: number, st: number, t: ServiceNodes): void {
    if (st === Stage.Missed) {
      this.free(c);
      return;
    }
    if (st === Stage.Gate) {
      this.board(c);
      return;
    }
    if (st === Stage.VisitQueue) {
      // Levels are brought up to date first, so the reset starts the toilet need over from now.
      this.bringNeeds(c);
      this.recordVisit(c);
      this.resetNeed(c, NEED_TOILET);
      this.afterVisit(g, c);
      return;
    }
    if (st === Stage.Immigration) {
      this.finishImmigration(g, c, t);
      return;
    }
    if (st === Stage.Customs) {
      this.finishCustoms(g, c, t);
      return;
    }
    if (st === Stage.Emigration) {
      this.finishEmigration(g, c, t);
      return;
    }
    if (st === Stage.SecExit) {
      this.finishSecExit(g, c, t);
      return;
    }
    if (st === Stage.Security) {
      if (this.flags[c]! & FLAG_INTL) {
        this.toEmigration(g, c);
        return;
      }
      this.stage[c] = Stage.Airside;
      this.schedule(c, this.tick + STEP);
      return;
    }
    const kind = t.kind[this.node[c]];
    if (this.onCheckIn !== null && (kind === CHECK_IN || kind === BAG_DROP) && this.bags[c] > 0) {
      this.onCheckIn(this.gridId(g), t.cell[this.node[c]], this.traffic.serialOf(this.flight[c]), this.bags[c]);
    }
    const from = t.walkNode[this.node[c]];
    const n = this.pickNode(g, SECURITY, SECURITY, from, c);
    if (n < 0) {
      this.node[c] = -1;
      this.stage[c] = Stage.ToSecurity;
      this.schedule(c, this.tick + RETRY_TICKS);
      return;
    }
    this.walk(g, c, n, from, Stage.ToSecurity);
  }

  /** Passengers at a gate desk board. The flight counts them as boarded and no longer waiting. */
  private board(c: number): void {
    const f = this.flight[c];
    const n = this.size[c];
    this.boarded += n;
    this.flBoarded[f] += n;
    this.active -= n;
    this.flActive[f] -= n;
    this.flGate[f] -= n;
    this.rollUp(c, false);
    this.free(c);
  }

  /** Runs one journey step of a cohort that is due. Only wheel stages reach here. */
  private step(c: number): void {
    const g = this.building[c];
    switch (this.stage[c]) {
      case Stage.Curb: {
        const from = this.business.curbNode(g);
        const n = this.pickNode(g, CHECK_IN, KIOSK, from, c);
        if (n < 0) this.schedule(c, this.tick + RETRY_TICKS);
        else this.walk(g, c, n, from, Stage.ToCheckIn);
        break;
      }
      case Stage.ToCheckIn:
        this.join(g, c, CHECK_IN, KIOSK, Stage.CheckIn);
        break;
      case Stage.ToSecurity:
        this.join(g, c, SECURITY, SECURITY, Stage.Security);
        break;
      case Stage.ToGate:
        this.join(g, c, GATE_DESK, GATE_DESK, Stage.Gate);
        break;
      case Stage.Airside:
        if (!this.decide(g, c)) this.toGate(g, c);
        break;
      case Stage.ToVisit:
        if (this.visitNeed[c] === NEED_TOILET) this.toToilet(g, c);
        else this.arriveVisit(g, c);
        break;
      case Stage.Visit:
        this.bringNeeds(c);
        this.recordVisit(c);
        this.resetNeed(c, this.visitNeed[c]!);
        this.afterVisit(g, c);
        break;
      case Stage.Rejoin:
        this.rejoin(c);
        break;
      case Stage.Deboard:
        this.afterDeboard(g, c);
        break;
      case Stage.ToExit:
        this.exitArrival(c);
        break;
      case Stage.ToClaim:
        this.stage[c] = Stage.Claim;
        this.waitStart[c] = this.tick;
        this.atClaim(c);
        break;
      case Stage.Claim:
        this.atClaim(c);
        break;
      case Stage.ToCustoms: {
        const t = this.table(g);
        if (this.node[c]! < 0 || !t) this.toCustoms(g, c);
        else this.join(g, c, CUSTOMS, CUSTOMS, Stage.Customs);
        break;
      }
      case Stage.CustomsRed:
        this.toExit(g, c);
        break;
      case Stage.ToImmigration: {
        const t = this.table(g);
        if (this.flags[c]! & FLAG_PASSED) this.afterImmigration(g, c);
        else if (this.node[c]! < 0 || !t) this.toImmigration(g, c);
        else this.join(g, c, t.kind[this.node[c]!]!, t.kind[this.node[c]!]!, Stage.Immigration);
        break;
      }
      case Stage.ToEmigration: {
        const t = this.table(g);
        if (this.node[c]! < 0 || !t) this.toEmigration(g, c);
        else this.join(g, c, t.kind[this.node[c]!]!, t.kind[this.node[c]!]!, Stage.Emigration);
        break;
      }
      case Stage.ToSecExit: {
        const t = this.table(g);
        if (this.flags[c]! & FLAG_PASSED) this.toClaim(g, c);
        else if (this.node[c]! < 0 || !t) this.toSecExit(g, c);
        else this.join(g, c, SEC_EXIT, SEC_EXIT, Stage.SecExit);
        break;
      }
    }
  }

  /** The cohort has left the aircraft. */
  private afterDeboard(g: number, c: number): void {
    if (this.flags[c]! & FLAG_INTL) this.toImmigration(g, c);
    else this.toSecExit(g, c);
  }

  /**
   * Walks a domestic arrival to the cheapest security exit it can reach, by walk time plus wait (T80). A grid with no
   * exit, or none reachable from where the cohort stands, skips the exit as one with no customs skips customs.
   */
  private toSecExit(g: number, c: number): void {
    const here = this.hereNode(g, c);
    const n = this.pickNode(g, SEC_EXIT, SEC_EXIT, here, c);
    if (n < 0) this.toClaim(g, c);
    else this.walk(g, c, n, here, Stage.ToSecExit);
  }

  /**
   * A domestic arrival was served at a security exit. It stands on the first cell past the exit along its flow, in
   * Public, and leaves the queued stage, so a retry of the claim step is a wheel stage that never queues again.
   */
  private finishSecExit(g: number, c: number, t: ServiceNodes): void {
    const wg = this.business.walkGraphs[g]!;
    const node = this.node[c]!;
    const at = this.exitNode(g, t.cell[node]!, t.walkNode[node]!);
    this.flags[c] = this.flags[c]! | FLAG_PASSED | FLAG_AT_VISIT;
    this.walkToX[c] = wg.nodeX[at]!;
    this.walkToY[c] = wg.nodeY[at]!;
    this.node[c] = -1;
    this.stage[c] = Stage.ToSecExit;
    this.toClaim(g, c);
  }

  /** Walks an international arrival to the cheapest immigration node. With none it retries, and strands after the limit. */
  private toImmigration(g: number, c: number): void {
    const here = this.hereNode(g, c);
    const n = this.pickImmigration(g, here, c);
    if (n < 0) this.retryOrStrand(c);
    else this.walk(g, c, n, here, Stage.ToImmigration);
  }

  /**
   * Cheapest passport booth or automated gate set to arrival mode, by walk time plus wait. Families and referred
   * cohorts skip the gates. Ascending scan with a strict comparison, as pickNode does. -1 when none.
   */
  private pickImmigration(g: number, from: number, c: number): number {
    return this.pickPassport(g, from, c, 1);
  }

  /** Cheapest passport booth or eGate in a mode (0 departure, 1 arrival) for the cohort, by walk time plus wait. -1 when none. */
  private pickPassport(g: number, from: number, c: number, mode: number): number {
    const t = this.table(g);
    const grid = this.business.grids[g];
    if (!t || !grid) return -1;
    const id = this.gridId(g);
    const speed = this.speed(c);
    const noGate = (mode === 1 ? NO_GATE : NO_GATE_DEP)[this.profile[c]!] === 1 || (this.flags[c]! & FLAG_REFERRED) !== 0;
    let best = -1;
    let bestCost = Infinity;
    for (let n = 0; n < t.count; n++) {
      const k = t.kind[n];
      if ((k !== PASSPORT && k !== EGATE) || t.queueCap[n] <= 0 || grid.fixtureMode[t.cell[n]!] !== mode) continue;
      if (k === EGATE && noGate) continue;
      const cost = this.business.walkDistance(id, from, t.walkNode[n]) / speed + this.business.serviceWait(id, n, this.tick) / CLOCK_SCALE;
      if (cost < bestCost) {
        bestCost = cost;
        best = n;
      }
    }
    return best;
  }

  /** An international arrival was served at an immigration node: an eGate may send it to an officer, else it goes on. */
  private finishImmigration(g: number, c: number, t: ServiceNodes): void {
    const node = this.node[c]!;
    if (t.kind[node] === EGATE && !(this.flags[c]! & FLAG_REFERRED) && traitU(this.recipeSeed[c]!, COHORT_DRAW.Referral) < ARRIVALS.service.eGate.referralShare) {
      const wg = this.business.walkGraphs[g]!;
      const at = t.walkNode[node]!;
      this.flags[c] = this.flags[c]! | FLAG_REFERRED | FLAG_AT_VISIT;
      this.walkToX[c] = wg.nodeX[at]!;
      this.walkToY[c] = wg.nodeY[at]!;
      this.node[c] = -1;
      this.stage[c] = Stage.ToImmigration;
      this.toImmigration(g, c);
      return;
    }
    // The cohort leaves the queued stage before the next step, so a retry of that step is an ordinary wheel stage.
    const wg = this.business.walkGraphs[g]!;
    const at = t.walkNode[node]!;
    this.flags[c] = (this.flags[c]! & ~FLAG_REFERRED) | FLAG_PASSED | FLAG_AT_VISIT;
    this.walkToX[c] = wg.nodeX[at]!;
    this.walkToY[c] = wg.nodeY[at]!;
    this.node[c] = -1;
    this.stage[c] = Stage.ToImmigration;
    this.afterImmigration(g, c);
  }

  /**
   * An international departure left security (T79): it walks to the cheapest passport booth or eGate in departure mode.
   * With none, because the flow was removed after the flight was scheduled, it skips passport control and goes airside.
   */
  private toEmigration(g: number, c: number): void {
    const here = this.hereNode(g, c);
    const n = this.pickPassport(g, here, c, 0);
    if (n >= 0) {
      this.walk(g, c, n, here, Stage.ToEmigration);
      return;
    }
    // Booths exist but none takes this cohort now (full, or only eGates for a family): it tries again until the flight leaves.
    if (this.hasPassport(g, 0)) {
      this.stage[c] = Stage.ToEmigration;
      this.schedule(c, this.tick + RETRY_TICKS);
      return;
    }
    this.stage[c] = Stage.Airside;
    this.schedule(c, this.tick + STEP);
  }

  /** True when the grid has a passport booth or eGate in the mode. */
  private hasPassport(g: number, mode: number): boolean {
    const t = this.table(g);
    const grid = this.business.grids[g];
    if (!t || !grid) return false;
    for (let n = 0; n < t.count; n++) if ((t.kind[n] === PASSPORT || t.kind[n] === EGATE) && grid.fixtureMode[t.cell[n]!] === mode) return true;
    return false;
  }

  /**
   * A departure was served at passport control: an eGate may send it to an officer, else it stands on the exit side of
   * the booth, in the International zone, and goes airside.
   */
  private finishEmigration(g: number, c: number, t: ServiceNodes): void {
    const node = this.node[c]!;
    const wg = this.business.walkGraphs[g]!;
    if (t.kind[node] === EGATE && !(this.flags[c]! & FLAG_REFERRED) && traitU(this.recipeSeed[c]!, COHORT_DRAW.Referral) < DEPARTURES.service.eGate.referralShare) {
      const at = t.walkNode[node]!;
      this.flags[c] = this.flags[c]! | FLAG_REFERRED | FLAG_AT_VISIT;
      this.walkToX[c] = wg.nodeX[at]!;
      this.walkToY[c] = wg.nodeY[at]!;
      this.node[c] = -1;
      this.stage[c] = Stage.ToEmigration;
      this.toEmigration(g, c);
      return;
    }
    const at = this.exitNode(g, t.cell[node]!, t.walkNode[node]!);
    this.flags[c] = (this.flags[c]! & ~FLAG_REFERRED) | FLAG_AT_VISIT;
    this.walkToX[c] = wg.nodeX[at]!;
    this.walkToY[c] = wg.nodeY[at]!;
    this.node[c] = -1;
    this.stage[c] = Stage.Airside;
    this.schedule(c, this.tick + STEP);
  }

  /**
   * Walk node just past a transition fixture along its flow, so a cohort that passed it stands in the zone it leads
   * into. Steps from the anchor cell until the first cell outside the fixture. Falls back to the anchor's node.
   */
  private exitNode(g: number, anchor: number, fallback: number): number {
    const grid = this.business.grids[g]!;
    const wg = this.business.walkGraphs[g]!;
    const [fx, fy] = flowStep(grid.fixtureRot[anchor]!);
    let x = anchor % grid.w;
    let y = (anchor - x) / grid.w;
    for (let k = 0; k < EXIT_SCAN; k++) {
      x += fx;
      y += fy;
      if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) break;
      const cell = y * grid.w + x;
      if (grid.fixture[cell] !== 0) continue;
      const n = wg.cellNode[cell]!;
      return n >= 0 ? n : fallback;
    }
    return fallback;
  }

  /** Immigration is done, the cohort stands at its node. */
  private afterImmigration(g: number, c: number): void {
    this.toClaim(g, c);
  }

  /** Walks an arrival to the carousel of its stand's bay. Bags missing from the claim, or none to claim, skip it. */
  private toClaim(g: number, c: number): void {
    if (this.flags[c]! & FLAG_CLAIMED) {
      this.afterClaim(g, c);
      return;
    }
    const wg = this.business.walkGraphs[g];
    const look = this.bagLookup;
    if (this.bags[c]! === 0) {
      this.afterClaim(g, c);
      return;
    }
    if (!look || !wg || !look.arrivalCarousel(this.serial[c]!, this.carOut) || this.carOut[0] !== this.gridId(g)) {
      this.noBags(c);
      this.afterClaim(g, c);
      return;
    }
    const here = this.hereNode(g, c);
    const to = nearestNode(wg, cellAt(wg, this.carOut[1]!, this.carOut[2]!));
    if (here < 0 || to < 0 || !Number.isFinite(this.business.walkDistance(this.gridId(g), here, to))) {
      this.retryOrStrand(c);
      return;
    }
    this.walkTo(g, c, here, to, Stage.ToClaim);
  }

  /** The cohort waits at the carousel. It leaves when the first bags of its flight are on it, or gives up after the limit. */
  private atClaim(c: number): void {
    if (this.flags[c]! & FLAG_CLAIMED) {
      this.afterClaim(this.building[c]!, c);
      return;
    }
    if (this.bagLookup !== null && this.bagLookup.deliveredAt(this.serial[c]!) >= 0) this.leaveClaim(c, false);
    else if (this.tick - this.born[c]! >= ARRIVALS.claim.giveUpMin * TICKS_PER_MINUTE) this.leaveClaim(c, true);
    else this.schedule(c, this.tick + gameSecondsToTicks(ARRIVALS.claim.pollS));
  }

  /** Ends the claim wait: the wait over the profile's patience costs points, and a cohort without its bags the missing bag points. */
  private leaveClaim(c: number, missing: boolean): void {
    const waited = this.tick - this.waitStart[c]!;
    this.penalize(c, queuePoints(waited, PROFILE_ROWS[this.profile[c]!]!.patienceS), DAY.PenQueue);
    this.day[DAY.ClaimWaitS] += (waited * CLOCK_SCALE) / TICKS_PER_SECOND;
    this.day[DAY.ClaimCount] += 1;
    this.waitStart[c] = -1;
    if (missing) this.noBags(c);
    this.afterClaim(this.building[c]!, c);
  }

  /** A cohort that did not get its bags: every member loses the missing bag points. */
  private noBags(c: number): void {
    this.penalize(c, ARRIVALS.satisfaction.missingBagPoints, DAY.PenMissingBag);
    this.day[DAY.NoBags] += this.size[c]!;
  }

  /** The claim is over. International cohorts pass customs, the others go to the curb. */
  private afterClaim(g: number, c: number): void {
    this.flags[c] = this.flags[c]! | FLAG_CLAIMED;
    if (this.flags[c]! & FLAG_INTL) this.toCustoms(g, c);
    else this.toExit(g, c);
  }

  /** Walks an international arrival to the cheapest customs node of its grid. A grid with none skips customs. */
  private toCustoms(g: number, c: number): void {
    const here = this.hereNode(g, c);
    const n = this.pickNode(g, CUSTOMS, CUSTOMS, here, c);
    if (n < 0) this.toExit(g, c);
    else this.walk(g, c, n, here, Stage.ToCustoms);
  }

  /**
   * An arrival was served at customs. It leaves the queued stage first, so a retry of the next step is a wheel stage.
   * A cohort whose recipe seed draws red stands the red channel time before it goes on.
   */
  private finishCustoms(g: number, c: number, t: ServiceNodes): void {
    const wg = this.business.walkGraphs[g]!;
    const at = t.walkNode[this.node[c]!]!;
    this.flags[c] = this.flags[c]! | FLAG_AT_VISIT;
    this.walkToX[c] = wg.nodeX[at]!;
    this.walkToY[c] = wg.nodeY[at]!;
    this.node[c] = -1;
    this.stage[c] = Stage.CustomsRed;
    if (traitU(this.recipeSeed[c]!, COHORT_DRAW.Red) < ARRIVALS.service.customs.redShare) {
      this.schedule(c, this.tick + gameSecondsToTicks(ARRIVALS.service.customs.redServiceSeconds));
    } else {
      this.toExit(g, c);
    }
  }

  /** Walks an arrival from where it stands to the curb. With no curb or no way there it retries, and strands after the limit. */
  private toExit(g: number, c: number): void {
    const curb = this.business.curbNode(g);
    const here = this.hereNode(g, c);
    if (curb < 0 || here < 0 || !Number.isFinite(this.business.walkDistance(this.gridId(g), here, curb))) {
      this.retryOrStrand(c);
      return;
    }
    this.walkTo(g, c, here, curb, Stage.ToExit);
  }

  /** A step with nowhere to go: the same step runs again later, until the stranded limit counted from doors open. */
  private retryOrStrand(c: number): void {
    if (this.tick - this.born[c]! >= ARRIVALS.strandedMin * TICKS_PER_MINUTE) this.strand(c);
    else this.schedule(c, this.tick + RETRY_TICKS);
  }

  /** An arrival that could not finish its journey takes the stranded points, is rated and freed. The caller has taken it off the wheel. */
  private strand(c: number): void {
    const n = this.size[c]!;
    this.penalize(c, ARRIVALS.satisfaction.strandedPoints, DAY.PenStranded);
    this.rateArrival(c);
    this.arrStranded += n;
    this.day[DAY.ArrStranded] += n;
    this.arrActive -= n;
    this.free(c);
  }

  /** An arrival reached the curb: it is rated and freed. */
  private exitArrival(c: number): void {
    const n = this.size[c]!;
    this.rateArrival(c);
    this.arrExited += n;
    this.day[DAY.ArrExited] += n;
    this.arrActive -= n;
    this.free(c);
  }

  /** Rates an arrival cohort. Arrivals have no needs (T20 D3), so the levels are not brought up. */
  private rateArrival(c: number): void {
    this.needTick[c] = this.tick;
    this.rollUp(c, false);
  }

  private readonly isPremium = (c: number): boolean => this.profile[c] === PREMIUM;

  /** True when a cohort joins its node through the priority lane: premium passengers at a gate desk of the priority level (T74). */
  private priorityJoin(g: number, c: number, queued: number): boolean {
    if (queued !== Stage.Gate || this.profile[c] !== PREMIUM) return false;
    const t = this.table(g);
    const n = this.node[c];
    if (!t || n < 0 || n >= t.count || t.kind[n] !== GATE_DESK) return false;
    return this.business.grids[g]!.fixtureLevel[t.cell[n]!]! >= LEVELS.priorityLevel;
  }

  /** A due cohort joins the queue of its node, or walks to a node first when it has none. */
  private join(g: number, c: number, kindA: number, kindB: number, queued: number): void {
    if (this.node[c] < 0) {
      const from = this.business.curbNode(g);
      const n = this.pickNode(g, kindA, kindB, from, c);
      if (n < 0) this.schedule(c, this.tick + RETRY_TICKS);
      else this.walk(g, c, n, from, this.stage[c]);
      return;
    }
    if (this.business.serviceJoin(this.gridId(g), this.node[c], c, this.size[c], this.priorityJoin(g, c, queued) ? this.isPremium : undefined)) {
      this.stage[c] = queued;
      this.waitStart[c] = this.tick;
    } else this.schedule(c, this.tick + JOIN_RETRY_TICKS);
  }

  /** Airside passengers walk to a gate desk once the flight is on the ground. The flight's gate count rises only on the first walk. */
  private toGate(g: number, c: number): void {
    const f = this.flight[c];
    const from = this.hereNode(g, c);
    let n = -1;
    if (this.traffic.fState[f] === FlState.OnGround) {
      n = this.assignedDeskNode(g, this.traffic.fStand[f]);
      if (n < 0) n = this.pickNode(g, GATE_DESK, GATE_DESK, from, c);
    }
    if (n < 0) {
      this.schedule(c, this.tick + RETRY_TICKS);
      return;
    }
    this.flGate[f] += this.size[c];
    this.walk(g, c, n, from, Stage.ToGate);
  }

  /**
   * Service node of the gate desk a stand is assigned to, found again by its cell (node ids go stale after edits).
   * -1 when the stand has no valid assignment, the desk is in another grid or it has no queue room.
   */
  private assignedDeskNode(g: number, standId: number): number {
    const desk = this.business.assignedGate(standId);
    const t = this.table(g);
    if (!desk || !t || desk.building !== this.gridId(g)) return -1;
    for (let n = 0; n < t.count; n++) {
      if (t.kind[n] === GATE_DESK && t.lx[n] === desk.x && t.ly[n] === desk.y) return t.queueCap[n] > 0 ? n : -1;
    }
    return -1;
  }

  /** Walk node a cohort leaves from: its service node when it has one, otherwise the curb. */
  private originWalk(g: number, c: number): number {
    const t = this.node[c] >= 0 ? this.table(g) : null;
    if (t) return t.walkNode[this.node[c]];
    return this.business.curbNode(g);
  }

  /** Cheapest node of a grid with one of two fixture kinds and queue room, by walk time plus wait. -1 when none. With skipPublic, nodes on public ground are left out. */
  private pickNode(g: number, kindA: number, kindB: number, fromWalk: number, c: number, skipPublic = false): number {
    const t = this.table(g);
    if (!t) return -1;
    const zones = skipPublic ? this.business.walkGraphs[g]?.effective : undefined;
    const id = this.gridId(g);
    const speed = this.speed(c);
    let best = -1;
    let bestCost = Infinity;
    // Ascending scan with a strict comparison, so ties go to the lowest index and an infinite cost never wins.
    for (let n = 0; n < t.count; n++) {
      const k = t.kind[n];
      if ((k !== kindA && k !== kindB) || t.queueCap[n] <= 0) continue;
      if (zones && zones[t.cell[n]!] === ZONE.Public) continue;
      const cost = this.business.walkDistance(id, fromWalk, t.walkNode[n]) / speed + this.business.serviceWait(id, n, this.tick) / CLOCK_SCALE;
      if (cost < bestCost) {
        bestCost = cost;
        best = n;
      }
    }
    return best;
  }

  /** Sends a cohort to a node of its grid. It is due when the walk ends. */
  private walk(g: number, c: number, node: number, from: number, stage: number): void {
    const t = this.table(g);
    this.node[c] = node;
    this.stage[c] = stage;
    this.flags[c] = this.flags[c]! & ~FLAG_AT_VISIT;
    this.trailNode[c] = -1;
    const to = t ? t.walkNode[node] : -1;
    this.setRoute(g, c, from, to);
    const dist = this.business.walkDistance(this.gridId(g), from, to);
    if (Number.isFinite(dist)) this.penalize(c, walkPoints(dist), DAY.PenWalk);
    this.schedule(c, this.tick + Math.max(STEP, Math.ceil((dist / this.speed(c)) * TICKS_PER_SECOND)));
  }

  /** Sends a cohort on a walk between two walk nodes, with no service node. It is due when the walk ends. */
  private walkTo(g: number, c: number, fromWalk: number, toWalk: number, stage: number): void {
    this.node[c] = -1;
    this.stage[c] = stage;
    this.flags[c] = this.flags[c]! | FLAG_AT_VISIT;
    this.trailNode[c] = -1;
    this.setRoute(g, c, fromWalk, toWalk);
    const dist = this.business.walkDistance(this.gridId(g), fromWalk, toWalk);
    if (Number.isFinite(dist)) this.penalize(c, walkPoints(dist), DAY.PenWalk);
    const ticks = Number.isFinite(dist) ? Math.ceil((dist / this.speed(c)) * TICKS_PER_SECOND) : RETRY_TICKS;
    this.schedule(c, this.tick + Math.max(STEP, ticks));
  }

  /** Takes whole points off every live member of a cohort and counts them in day counter `slot`, per member. */
  private penalize(c: number, points: number, slot: number): void {
    const p = Math.round(points);
    if (p <= 0) return;
    const b = c * M;
    const n = this.size[c]!;
    for (let i = 0; i < n; i++) this.memberSat[b + i] = Math.max(0, this.memberSat[b + i]! - p);
    this.day[slot] += p * n;
    this.syncSat(c);
  }

  /**
   * Rates a cohort as it boards or misses its flight: each need still over its threshold costs points by the hours it
   * has been over, a missed flight costs its penalty, and every member's satisfaction goes into the day counters.
   * The one exit point for members, which arrival cohorts reuse.
   */
  rollUp(c: number, missed: boolean): void {
    this.bringNeeds(c);
    const b = c * M;
    const n = this.size[c]!;
    const profile = this.profile[c]!;
    for (let i = 0; i < n; i++) {
      writeTraits(this.memberSeed[b + i]!, profile, this.traits);
      for (let k = 0; k < NEED_SHOP; k++) {
        const p = Math.round(unmetPoints(this.memberNeed[(b + i) * NEED_COUNT + k]!, k, this.traits[k]!));
        if (p <= 0) continue;
        this.memberSat[b + i] = Math.max(0, this.memberSat[b + i]! - p);
        this.day[DAY.PenUnmet] += p;
      }
    }
    this.syncSat(c);
    if (missed) this.penalize(c, SAT.missedPenalty, DAY.PenMissed);
    for (let i = 0; i < n; i++) this.day[DAY.SatSum] += this.memberSat[b + i]!;
    this.day[DAY.SatCount] += n;
  }

  /**
   * Closes the day: its satisfaction sum and passenger count go into the ring, the counters move to `lastDay` and
   * restart. Returns the mean satisfaction over the ring, or -1 while it holds no passenger.
   */
  closeDay(): number {
    this.ringSum[this.ringHead] = this.day[DAY.SatSum]!;
    this.ringCount[this.ringHead] = this.day[DAY.SatCount]!;
    this.ringHead = (this.ringHead + 1) % SAT.windowDays;
    this.lastDay.set(this.day);
    this.day.fill(0);
    let sum = 0;
    let count = 0;
    for (let d = 0; d < SAT.windowDays; d++) {
      sum += this.ringSum[d]!;
      count += this.ringCount[d]!;
    }
    return count > 0 ? sum / count : -1;
  }

  /**
   * A cohort that stands at a point it last walked to needs a walk node there. When the node it headed for is gone
   * (its fixture was removed) it goes back to the point it started that walk from.
   */
  private keepAnchor(c: number): void {
    const wg = this.business.walkGraphs[this.building[c]!];
    if (!wg || nearestNode(wg, cellAt(wg, this.walkToX[c]!, this.walkToY[c]!)) >= 0) return;
    this.walkToX[c] = this.walkFromX[c]!;
    this.walkToY[c] = this.walkFromY[c]!;
  }

  /** Walk node a cohort stands at: its service node, else the point it last walked to, else the curb. */
  private hereNode(g: number, c: number): number {
    if (this.node[c]! < 0 && this.flags[c]! & FLAG_AT_VISIT) {
      const wg = this.business.walkGraphs[g];
      const at = wg ? nearestNode(wg, cellAt(wg, this.walkToX[c]!, this.walkToY[c]!)) : -1;
      if (at >= 0) return at;
    }
    return this.originWalk(g, c);
  }

  /** Brings the hunger, thirst, toilet and rest levels of the live members up to date. Levels grow linearly from needTick. */
  private bringNeeds(c: number): void {
    const dt = Math.max(0, this.tick - this.needTick[c]!);
    this.needTick[c] = this.tick;
    if (dt === 0) return;
    const b = c * M;
    const profile = this.profile[c]!;
    for (let i = 0; i < this.size[c]!; i++) {
      writeTraits(this.memberSeed[b + i]!, profile, this.traits);
      const base = (b + i) * NEED_COUNT;
      for (let k = 0; k < NEED_SHOP; k++) {
        const level = this.memberNeed[base + k]! + Math.floor(needRatePerTick(k, this.traits[k]!) * dt);
        this.memberNeed[base + k] = Math.min(65535, level);
      }
    }
  }

  /**
   * Airside decision point. Picks the most urgent want over its threshold, and when a reachable airside point serves it
   * and the group can be back in time, sends the members with that want on a visit. True when the cohort left.
   */
  private decide(g: number, c: number): boolean {
    this.bringNeeds(c);
    const n = this.size[c]!;
    const b = c * M;
    let need = -1;
    let lead = -1;
    let bestOver = -1;
    for (let k = 0; k < NEED_COUNT; k++) {
      for (let m = 0; m < n; m++) {
        const over = this.memberNeed[(b + m) * NEED_COUNT + k]! - NEED_THRESHOLD[k]!;
        if (over >= 0 && over > bestOver) {
          bestOver = over;
          need = k;
          lead = m;
        }
      }
    }
    if (need < 0) return false;
    const vp = this.visitTable(g);
    if (!vp) return false;
    writeTraits(this.memberSeed[b + lead]!, this.profile[c]!, this.traits);
    const gateLeadMin = this.traits[TRAIT.GateLeadMin]!;
    const kindA = need === NEED_SHOP ? this.traits[TRAIT.Fav1]! : NEED_KIND_A[need]!;
    const kindB = need === NEED_SHOP ? this.traits[TRAIT.Fav2]! : NEED_KIND_B[need]!;
    const here = this.hereNode(g, c);
    const id = this.gridId(g);
    const speed = this.speed(c);
    let point = -1;
    let toilet = -1;
    let bestSeconds = Infinity;
    let visitTicks = NEED_VISIT_MIN[need]! * TICKS_PER_MINUTE;
    if (need === NEED_TOILET) {
      // A toilet node off public ground, with the queue wait and one service as the time spent there.
      toilet = this.pickNode(g, TOILET, TOILET, here, c, true);
      if (toilet < 0) return false;
      const t = this.table(g)!;
      bestSeconds = this.business.walkDistance(id, here, t.walkNode[toilet]!) / speed;
      visitTicks = gameSecondsToTicks(this.business.serviceWait(id, toilet, this.tick) + t.meanS[toilet]!);
    } else {
      // Ascending scan with a strict comparison, so ties go to the lowest point and an infinite walk never wins.
      for (let p = 0; p < vp.count; p++) {
        const kind = vp.kind[p]!;
        if ((kind !== kindA && kind !== kindB) || vp.side[p] !== SIDE.Air || vp.walkNode[p]! < 0) continue;
        const seconds = this.business.walkDistance(id, here, vp.walkNode[p]!) / speed;
        if (seconds < bestSeconds) {
          bestSeconds = seconds;
          point = p;
        }
      }
      if (point < 0) return false;
    }
    const f = this.flight[c]!;
    const walkTicks = Math.ceil(bestSeconds * TICKS_PER_SECOND);
    const departure = this.traffic.fEta[f]! + this.traffic.fTurn[f]!;
    if (walkTicks * 2 + visitTicks > departure - gateLeadMin * TICKS_PER_MINUTE - this.tick) return false;
    const v = this.splitMovers(c, need, lead);
    if (v < 0) return false;
    // The members who stay keep their place on the timer wheel, or the group would never wake again.
    if (v !== c) this.schedule(c, this.tick + STEP);
    this.visitNeed[v] = need;
    if (toilet >= 0) {
      this.walk(g, v, toilet, here, Stage.ToVisit);
      return true;
    }
    this.target[v] = vp.cell[point]!;
    this.walkTo(g, v, here, vp.walkNode[point]!, Stage.ToVisit);
    return true;
  }

  /**
   * Moves the members of `c` whose level of `need` is over its threshold to a sub cohort, keeping member order on both
   * sides. When every member goes the cohort itself is returned. -1 when the store has no free slot.
   */
  private splitMovers(c: number, need: number, lead: number): number {
    const n = this.size[c]!;
    const b = c * M;
    const threshold = NEED_THRESHOLD[need]!;
    let movers = 0;
    for (let i = 0; i < n; i++) if (this.memberNeed[(b + i) * NEED_COUNT + need]! >= threshold) movers++;
    if (movers === n) return c;
    const v = this.alloc();
    if (v < 0) return -1;
    const vb = v * M;
    this.flight[v] = this.flight[c]!;
    this.profile[v] = this.profile[c]!;
    this.building[v] = this.building[c]!;
    this.recipeSeed[v] = this.memberSeed[b + lead]!;
    this.bags[v] = 0;
    this.spendBudget[v] = 0;
    this.node[v] = -1;
    this.walkStart[v] = -1;
    this.flags[v] = FLAG_SUB;
    this.parent[v] = this.flags[c]! & FLAG_SUB ? this.parent[c]! : c;
    this.needTick[v] = this.tick;
    this.waitStart[v] = -1;
    this.target[v] = -1;
    this.visitNeed[v] = need;
    let kept = 0;
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const from = b + i;
      const to = this.memberNeed[from * NEED_COUNT + need]! >= threshold ? vb + moved++ : b + kept++;
      if (to === from) continue;
      this.memberSeed[to] = this.memberSeed[from]!;
      this.memberSat[to] = this.memberSat[from]!;
      for (let k = 0; k < NEED_COUNT; k++) this.memberNeed[to * NEED_COUNT + k] = this.memberNeed[from * NEED_COUNT + k]!;
    }
    this.size[v] = moved;
    this.size[c] = kept;
    this.syncFlags(c);
    this.syncSat(c);
    this.syncFlags(v);
    this.syncSat(v);
    return v;
  }

  /** A cohort on its way to a toilet joins the queue of its node. After an edit it picks a node again, and gives up when there is none. */
  private toToilet(g: number, c: number): void {
    if (this.node[c]! < 0) {
      const from = this.hereNode(g, c);
      const n = this.pickNode(g, TOILET, TOILET, from, c, true);
      if (n < 0) this.afterVisit(g, c);
      else this.walk(g, c, n, from, Stage.ToVisit);
      return;
    }
    this.join(g, c, TOILET, TOILET, Stage.VisitQueue);
  }

  /** The cohort reached its visit point. It stays for the visit time, or ends the visit when an edit removed the point. */
  private arriveVisit(g: number, c: number): void {
    const vp = this.visitTable(g);
    const kind = this.business.grids[g]?.fixture[this.target[c]!] ?? 0;
    if (!vp || findPoint(vp, this.target[c]!, kind) < 0) {
      this.afterVisit(g, c);
      return;
    }
    this.stage[c] = Stage.Visit;
    this.schedule(c, this.tick + NEED_VISIT_MIN[this.visitNeed[c]!]! * TICKS_PER_MINUTE);
  }

  /** Counts a finished visit of need k and the spend of its members, in the day counters. The single place a visit is counted. */
  private recordVisit(c: number): void {
    const k = this.visitNeed[c]!;
    this.day[DAY.Visits0 + k]!++;
    const b = c * M;
    for (let i = 0; i < this.size[c]!; i++) {
      writeTraits(this.memberSeed[b + i]!, this.profile[c]!, this.traits);
      this.day[DAY.Spend] += Math.floor(this.traits[TRAIT.Budget]! * NEED_SPEND_SHARE[k]!);
    }
  }

  /** Sets the level of need k of the live members to 0. */
  private resetNeed(c: number, k: number): void {
    const b = c * M;
    for (let i = 0; i < this.size[c]!; i++) this.memberNeed[(b + i) * NEED_COUNT + k] = 0;
  }

  /** A visit ended. A sub cohort walks back to its group when the group is still airside, anything else carries on airside. */
  private afterVisit(g: number, c: number): void {
    this.target[c] = -1;
    const p = this.parent[c]!;
    if (this.flags[c]! & FLAG_SUB && this.canRejoin(c, p)) {
      this.walkTo(g, c, this.hereNode(g, c), this.hereNode(g, p), Stage.Rejoin);
      return;
    }
    this.stage[c] = Stage.Airside;
    this.schedule(c, this.tick + STEP);
  }

  /** True when `p` is a live airside main cohort of the same flight with room for the members of sub cohort `c`. */
  private canRejoin(c: number, p: number): boolean {
    return (
      p >= 0 &&
      this.stage[p] === Stage.Airside &&
      this.flight[p] === this.flight[c] &&
      !(this.flags[p]! & FLAG_SUB) &&
      this.size[p]! + this.size[c]! <= M
    );
  }

  /** A sub cohort reached its group: its members are appended and the slot is freed. Otherwise it carries on airside on its own. */
  private rejoin(c: number): void {
    const p = this.parent[c]!;
    if (!this.canRejoin(c, p)) {
      this.stage[c] = Stage.Airside;
      this.schedule(c, this.tick + STEP);
      return;
    }
    this.bringNeeds(p);
    this.bringNeeds(c);
    const dst = p * M + this.size[p]!;
    const src = c * M;
    for (let i = 0; i < this.size[c]!; i++) {
      this.memberSeed[dst + i] = this.memberSeed[src + i]!;
      this.memberSat[dst + i] = this.memberSat[src + i]!;
      for (let k = 0; k < NEED_COUNT; k++) this.memberNeed[(dst + i) * NEED_COUNT + k] = this.memberNeed[(src + i) * NEED_COUNT + k]!;
    }
    this.size[p] = this.size[p]! + this.size[c]!;
    this.syncFlags(p);
    this.syncSat(p);
    this.free(c);
  }

  /** Records the walk between two nodes of the grid, or no walk when either id is not a node. */
  private setRoute(g: number, c: number, from: number, to: number): void {
    const wg = this.business.walkGraphs[g];
    if (!wg || from < 0 || to < 0 || from >= wg.nodeCount || to >= wg.nodeCount) {
      this.walkStart[c] = -1;
      return;
    }
    this.walkFromX[c] = wg.nodeX[from]!;
    this.walkFromY[c] = wg.nodeY[from]!;
    this.walkToX[c] = wg.nodeX[to]!;
    this.walkToY[c] = wg.nodeY[to]!;
    this.walkStart[c] = this.tick;
  }

  private gridId(g: number): number {
    return this.business.grids[g]?.id ?? -1;
  }

  /** Service table of a grid index, null when there is none. */
  private table(g: number): ServiceNodes | null {
    return this.business.serviceTable(this.gridId(g));
  }

  private pickProfile(r: number): number {
    for (let k = 0; k < MIX_CUM.length; k++) if (r < MIX_CUM[k]) return k;
    return LAST_MIXED;
  }

  /** Sets the wake tick, never earlier than the next wheel visit, and puts the cohort in its bucket. */
  private schedule(c: number, wake: number): void {
    this.timer[c] = Math.max(wake, this.tick + STEP);
    this.link(c);
  }

  private bucketOf(c: number): number {
    return Math.ceil(this.timer[c] / STEP) & (WHEEL - 1);
  }

  private link(c: number): void {
    const b = this.bucketOf(c);
    this.next[c] = this.wheelHead[b];
    this.wheelHead[b] = c;
  }

  /** Takes a cohort out of its wheel bucket. It must be in the wheel. */
  private unlink(c: number): void {
    const b = this.bucketOf(c);
    let prev = -1;
    let cur = this.wheelHead[b];
    while (cur >= 0 && cur !== c) {
      prev = cur;
      cur = this.next[cur];
    }
    if (cur < 0) return;
    if (prev < 0) this.wheelHead[b] = this.next[c];
    else this.next[prev] = this.next[c];
  }

  private slotArrays(): Record<string, SlotArray> {
    return {
      flight: this.flight, size: this.size, profile: this.profile, stage: this.stage, node: this.node, timer: this.timer,
      bags: this.bags, spendBudget: this.spendBudget, satisfaction: this.satisfaction, recipeSeed: this.recipeSeed,
      flags: this.flags, building: this.building, next: this.next,
      walkFromX: this.walkFromX, walkFromY: this.walkFromY, walkToX: this.walkToX, walkToY: this.walkToY, walkStart: this.walkStart,
      needTick: this.needTick, parent: this.parent, waitStart: this.waitStart, target: this.target, visitNeed: this.visitNeed,
      serial: this.serial, born: this.born,
    };
  }

  /** Member arrays packed up to `hi` blocks. */
  private memberArrays(): Record<string, SlotArray> {
    const n = this.hi * M;
    return {
      memberSeed: this.memberSeed.subarray(0, n),
      memberSat: this.memberSat.subarray(0, n),
      memberNeed: this.memberNeed.subarray(0, n * NEED_COUNT),
    };
  }

  saveState(): CohortsSave {
    const arrays: Record<string, string> = {};
    const slots = this.slotArrays();
    for (const k of Object.keys(slots)) arrays[k] = packTyped(slots[k].subarray(0, this.hi));
    const members = this.memberArrays();
    for (const k of Object.keys(members)) arrays[k] = packTyped(members[k]);
    arrays.wheelHead = packTyped(this.wheelHead);
    arrays.flBoarded = packTyped(this.flBoarded);
    arrays.flGate = packTyped(this.flGate);
    arrays.flActive = packTyped(this.flActive);
    return {
      generated: this.generated, boarded: this.boarded, missed: this.missed, active: this.active,
      hi: this.hi, freeHead: this.freeHead, rng: this.rng.getState(), arrays,
      day: packTyped(this.day), ringSum: packTyped(this.ringSum), ringCount: packTyped(this.ringCount), ringHead: this.ringHead,
      arr: [this.arrGenerated, this.arrExited, this.arrStranded, this.arrActive], arrRng: this.arrRng.getState(),
    };
  }

  /**
   * Restores the store from a save. `undefined` (a save from before cohorts) gives an empty store. `lastTick` is the tick
   * `update` last ran at, one before the saved tick, so commands and the business that run ahead of `update` in the next
   * tick see the same clock as in an uninterrupted run.
   */
  loadState(s: CohortsSave | undefined, lastTick: number): void {
    this.tick = lastTick;
    this.ensureOccupancy();
    this.sampleCacheVersion = -1;
    this.trailNode.fill(-1);
    if (!s) {
      this.generated = 0;
      this.boarded = 0;
      this.missed = 0;
      this.active = 0;
      this.hi = 0;
      this.freeHead = -1;
      this.rng.setState(this.initialRng);
      this.arrRng.setState(this.initialArrRng);
      this.arrGenerated = 0;
      this.arrExited = 0;
      this.arrStranded = 0;
      this.arrActive = 0;
      this.day.fill(0);
      this.ringSum.fill(0);
      this.ringCount.fill(0);
      this.ringHead = 0;
      this.wheelHead.fill(-1);
      this.flBoarded.fill(0);
      this.flGate.fill(0);
      this.flActive.fill(0);
      this.rebuildVisitTables();
      this.seenVersion = this.business.serviceVersion;
      return;
    }
    this.generated = s.generated;
    this.boarded = s.boarded;
    this.missed = s.missed;
    this.active = s.active;
    this.hi = s.hi;
    this.freeHead = s.freeHead;
    this.rng.setState(s.rng);
    this.arrRng.setState(s.arrRng ?? this.initialArrRng);
    this.arrGenerated = s.arr?.[0] ?? 0;
    this.arrExited = s.arr?.[1] ?? 0;
    this.arrStranded = s.arr?.[2] ?? 0;
    this.arrActive = s.arr?.[3] ?? 0;
    this.day.fill(0);
    this.ringSum.fill(0);
    this.ringCount.fill(0);
    this.ringHead = s.ringHead ?? 0;
    if (s.day !== undefined) unpackInto(s.day, this.day, Float64Array);
    if (s.ringSum !== undefined) unpackInto(s.ringSum, this.ringSum, Float64Array);
    if (s.ringCount !== undefined) unpackInto(s.ringCount, this.ringCount, Float64Array);
    const slots = this.slotArrays();
    for (const k of Object.keys(slots)) {
      const a = slots[k];
      if (s.arrays[k] !== undefined) unpackInto(s.arrays[k], a, a.constructor as SlotCtor);
    }
    const members = this.memberArrays();
    for (const k of Object.keys(members)) {
      const a = members[k];
      if (s.arrays[k] !== undefined) unpackInto(s.arrays[k], a, a.constructor as SlotCtor);
    }
    unpackInto(s.arrays.wheelHead, this.wheelHead, Int32Array);
    unpackInto(s.arrays.flBoarded, this.flBoarded, Int32Array);
    unpackInto(s.arrays.flGate, this.flGate, Int32Array);
    unpackInto(s.arrays.flActive, this.flActive, Int32Array);
    this.rebuildVisitTables();
    this.seenVersion = this.business.serviceVersion;
  }

  /** Folds the state that matters into a running hash. */
  hash(h: number): number {
    let acc = foldU32(h, this.generated);
    acc = foldU32(acc, this.boarded);
    acc = foldU32(acc, this.missed);
    acc = foldU32(acc, this.active);
    acc = foldU32(acc, this.hi);
    acc = foldU32(acc, this.freeHead);
    acc = foldU32(acc, this.rng.getState());
    for (let c = 0; c < this.hi; c++) {
      acc = foldU32(acc, this.flight[c]);
      acc = foldU32(acc, this.size[c]);
      acc = foldU32(acc, this.profile[c]);
      acc = foldU32(acc, this.stage[c]);
      acc = foldU32(acc, this.node[c]);
      acc = foldU32(acc, this.timer[c]);
      acc = foldU32(acc, this.walkFromX[c]);
      acc = foldU32(acc, this.walkFromY[c]);
      acc = foldU32(acc, this.walkToX[c]);
      acc = foldU32(acc, this.walkToY[c]);
      acc = foldU32(acc, this.walkStart[c]);
      acc = foldU32(acc, this.flags[c]);
      acc = foldU32(acc, this.needTick[c]);
      acc = foldU32(acc, this.parent[c]);
      acc = foldU32(acc, this.waitStart[c]);
      acc = foldU32(acc, this.target[c]);
      acc = foldU32(acc, this.visitNeed[c]);
      acc = foldU32(acc, this.serial[c]);
      acc = foldU32(acc, this.born[c]);
      acc = foldU32(acc, this.satisfaction[c]);
      if (this.stage[c] === Stage.Free) continue;
      const b = c * M;
      for (let i = 0; i < this.size[c]; i++) {
        acc = foldU32(acc, this.memberSeed[b + i]);
        for (let k = 0; k < NEED_COUNT; k++) acc = foldU32(acc, this.memberNeed[(b + i) * NEED_COUNT + k]);
        acc = foldU32(acc, this.memberSat[b + i]);
      }
    }
    for (let k = 0; k < this.day.length; k++) acc = foldU32(acc, Math.round(this.day[k]!) >>> 0);
    acc = foldU32(acc, this.ringHead);
    acc = foldU32(acc, this.arrGenerated);
    acc = foldU32(acc, this.arrExited);
    acc = foldU32(acc, this.arrStranded);
    acc = foldU32(acc, this.arrActive);
    acc = foldU32(acc, this.arrRng.getState());
    for (let d = 0; d < this.ringSum.length; d++) {
      acc = foldU32(acc, Math.round(this.ringSum[d]!) >>> 0);
      acc = foldU32(acc, Math.round(this.ringCount[d]!) >>> 0);
    }
    return acc;
  }
}
