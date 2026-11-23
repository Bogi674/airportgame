import { PROFILES, STAFF } from '@data/index';
import { STAFF_ROLE_COUNT, STAFF_ROLE_KEYS } from '@data/schemas/staff';
import { FIXTURE_KEYS, TERMINAL_CELL_M, fixtureKey, footprintOf, type StaffRow, minuteOfDay, START_MINUTE, TICKS_PER_DAY, TICKS_PER_MINUTE } from '@shared/business';
import { AUD } from '@shared/terminalZones';
import { gameSecondsToTicks } from '@shared/time';
import type { OverlayData } from '@shared/overlay';
import { cellIndex, cornerWorld, ROT_STEP } from '@shared/terminalOps';
import type { Airfield } from '../airfield/airfield';
import { HEADING_STEPS, PEOPLE_MODE, SnapHeader, SNAPSHOT_PEOPLE_CAPACITY, STAFF_ID_BASE, STAFF_PROFILE_BASE, type SnapshotViews } from '@shared/snapshot';
import { atan2Det, cosLut, sinLut, TWO_PI } from '@shared/trig';
import { nearestNode, newSampleCache, walkDistance, type SampleCache } from '../terminal/walkDistance';
import { ROUTE_OUT, cellAt, routePoint } from '../cohorts/walkSample';
import type { Business } from '../business/business';
import type { Baggage, BagNodeRec } from '../ops/baggage/baggage';
import { foldU32 } from '../hash';
import { packTyped, unpackInto } from '../save/pack';
import { breakJitterMin, staffSeed, staffSkill } from './staffTraits';

/** Life cycle state of a staff slot. Saved values, append only. */
export const STAFF_STATE = { Free: 0, Off: 1, ClockIn: 2, Commute: 3, ToStation: 4, OnDuty: 5, Leaving: 6, CommuteHome: 7, ClockOut: 8, Break: 9, Standby: 10 } as const;

/** Bits of the flags array. Saved values, append only. */
export const STAFF_FLAG = { Tired: 1, BreakDone: 2, OnBreak: 4, Relief: 8 } as const;

type SavedArray = Uint8Array | Int16Array | Int32Array | Uint32Array;
type SlotCtor = { new (buffer: ArrayBuffer): SavedArray; BYTES_PER_ELEMENT: number };

const SHIFTS = STAFF.shifts.startsH.length;
const MACHINE_KIND = FIXTURE_KEYS.indexOf('screeningMachine') + 1;
const SECURITY_ID = FIXTURE_KEYS.indexOf('security') + 1;
/** Cells a security lane runs along its flow, the across side of its footprint (T74). */
const LANE_ACROSS = footprintOf('security', 1)[1];
/** Cells from a lane anchor's centre to its walking strip across the lane: 2.6 m from its belt edge in the kit art. */
const LANE_STRIP = 0.8;
/** Cells between two officers along a security lane, 2.4 m. */
const LANE_OFFICER_SPACING = 1.2;
const MACHINE_STATION = STAFF.stations.screeningMachine!;
const CREW_SPEED_MPS = PROFILES.profiles.crew.walkSpeed;
const DEG = Math.PI / 180;
const TICKS_PER_SECOND = 10;
const CHANGE_TICKS = STAFF.shifts.changeMin * TICKS_PER_MINUTE;
const SHIFT_TICKS = STAFF.shifts.lengthH * 60 * TICKS_PER_MINUTE;
const OVERTIME_TICKS = STAFF.shifts.overtimeMaxMin * TICKS_PER_MINUTE;
const HOUR_TICKS = 60 * TICKS_PER_MINUTE;
const STEP_TICKS = STAFF.stepMin * TICKS_PER_MINUTE;
const BREAK_TICKS = Math.ceil(STAFF.breaks.lengthMin * TICKS_PER_MINUTE);
const RELIEF_WAIT_TICKS = Math.ceil(STAFF.breaks.reliefWaitMin * TICKS_PER_MINUTE);
/** stGrid of a member placed on the apron crew pool of a depot (T81), whose stX is the depot id. */
const POOL_GRID = -2;
const RAMP_ROLE = STAFF_ROLE_KEYS.indexOf('ramp');
/** walkStart value of a member sent home because its station could not be reached. */
const WALK_UNREACHABLE = -2;

/** Index of the shift running at the tick. Before the first start hour the last shift of the previous day runs. */
export function shiftAt(tick: number): number {
  const minute = minuteOfDay(tick);
  let run = SHIFTS - 1;
  for (let sh = 0; sh < SHIFTS; sh++) if (STAFF.shifts.startsH[sh]! * 60 <= minute) run = sh;
  return run;
}

/** Tick the running or latest instance of shift `sh` started, at or before `tick`. */
export function shiftStartTick(tick: number, sh: number): number {
  const clock = (tick + START_MINUTE * TICKS_PER_MINUTE) % TICKS_PER_DAY;
  const since = (clock - STAFF.shifts.startsH[sh]! * 60 * TICKS_PER_MINUTE + TICKS_PER_DAY) % TICKS_PER_DAY;
  return tick - since;
}

/** Tick the instance of shift `sh` that started at or before `tick` ends. */
export function shiftEndTick(tick: number, sh: number): number {
  return shiftStartTick(tick, sh) + STAFF.shifts.lengthH * 60 * TICKS_PER_MINUTE;
}

/** Saved form of the staff store. */
export interface StaffSave {
  hi: number;
  serial: number;
  caps: string;
  arrays: Record<string, string>;
}

/** Individual airport staff as a struct of arrays (T68). Slots are reused lowest first. */
export class Staff {
  readonly cap = STAFF.capacity;
  /** One past the highest slot in use. */
  hi = 0;
  /** Number of members ever hired, the input of the next seed. */
  serial = 0;
  /** Player cap of hired staff per role, -1 for automatic staffing with no cap. */
  readonly caps = new Int32Array(STAFF_ROLE_COUNT).fill(-1);

  /** Trait seed of the member. */
  readonly seed = new Uint32Array(this.cap);
  /** Role id, an index of STAFF_ROLE_KEYS. */
  readonly role = new Uint8Array(this.cap);
  /** Shift index the member works. */
  readonly shift = new Uint8Array(this.cap);
  /** STAFF_STATE value. */
  readonly state = new Uint8Array(this.cap);
  /** STAFF_FLAG bits. */
  readonly flags = new Uint8Array(this.cap);
  /** Building id the member commutes from, -1 for the curb door. */
  readonly home = new Int32Array(this.cap);
  /** Id of the terminal grid of the assigned station, -1 when unplaced. */
  readonly stGrid = new Int32Array(this.cap);
  /** Logical cell x of the assigned station. */
  readonly stX = new Int16Array(this.cap);
  /** Logical cell y of the assigned station. */
  readonly stY = new Int16Array(this.cap);
  /** Fixture id of the assigned station. */
  readonly stKind = new Uint8Array(this.cap);
  /** Slot of the member this one relieves on a break, -1 none. */
  readonly covering = new Int32Array(this.cap);
  /** Tick of the next state step. */
  readonly wake = new Int32Array(this.cap);
  /** Tick of the next break, -1 none. */
  readonly breakAt = new Int32Array(this.cap);
  /** Tick the current walk started, -1 none, -2 while the member is sent home from a station it cannot reach. */
  readonly walkStart = new Int32Array(this.cap);
  /** Start x of the current walk, in logical cells. */
  readonly walkFromX = new Int16Array(this.cap);
  /** Start y of the current walk, in logical cells. */
  readonly walkFromY = new Int16Array(this.cap);
  /** End x of the current walk, in logical cells. */
  readonly walkToX = new Int16Array(this.cap);
  /** End y of the current walk, in logical cells. */
  readonly walkToY = new Int16Array(this.cap);
  /** Derived, not saved: index of the station of the member, -1 none. */
  readonly stIdx = new Int32Array(this.cap).fill(-1);

  /** The saved arrays in hash order, built once. */
  private readonly saved: readonly SavedArray[] = [
    this.seed, this.role, this.shift, this.state, this.flags, this.home, this.stGrid, this.stX, this.stY, this.stKind,
    this.covering, this.wake, this.breakAt, this.walkStart, this.walkFromX, this.walkFromY, this.walkToX, this.walkToY,
  ];

  /** Station table, derived from the service nodes and rebuilt when they change. Never saved. */
  stCount = 0;
  /** Index into Business.grids of each station. */
  sGridIdx = new Int32Array(0);
  /** Id of the grid of each station. */
  sGridId = new Int32Array(0);
  /** Logical cell of each station. */
  sX = new Int16Array(0);
  sY = new Int16Array(0);
  /** Fixture id of each station. */
  sKind = new Uint8Array(0);
  /** Service node of each station, -1 for none. */
  sNode = new Int32Array(0);
  /** Baggage record id of each station, -1 for none. */
  sMachine = new Int32Array(0);
  /** Role id of each station. */
  sRole = new Uint8Array(0);
  /** Officers each station needs. */
  sNeed = new Uint16Array(0);
  /** Share of its rate each station serves with nobody on it (T81), 0 when it stops. */
  sUnstaffed = new Float32Array(0);
  /** Officers on duty at each station. */
  sPresent = new Uint8Array(0);
  /** Summed skill of the officers on duty at each station. */
  sSkill = new Float64Array(0);
  /** World point each station's staff commute to: the curb door of its grid, or the depot of the apron crew pool. */
  sWX = new Float64Array(0);
  sWY = new Float64Array(0);
  /** Station index of the apron crew pool, -1 without one (T81). */
  rampStation = -1;
  /** Apron crew pool input from the road net (T81): lowest id depot, its point, and the commercial stands with a road. */
  private rampDepot = -1;
  private rampX = 0;
  private rampY = 0;
  private rampStands = 0;
  /** Walk node of the curb door of each grid, -1 for none. */
  curbNode = new Int32Array(0);
  /** World point of the curb door of each grid. */
  curbX = new Float64Array(0);
  curbY = new Float64Array(0);
  /** Station index by `gridId|x|y|kind`, built at rebuild only. */
  private readonly stationOf = new Map<string, number>();
  /** serviceVersion, terminalVersion, grid count and baggage draw version the stations were built from. */
  private readonly builtFor = new Int32Array(6).fill(-1);
  /** Seats of each station and shift the pass keeps, and seats already held. Scratch sized at rebuild. */
  private keepSt = new Int32Array(0);
  private heldSt = new Int32Array(0);
  /** The same for the relief seats of each role and shift. */
  private readonly keepRelief = new Int32Array(STAFF_ROLE_COUNT * SHIFTS);
  private readonly heldRelief = new Int32Array(STAFF_ROLE_COUNT * SHIFTS);
  /** Station and seat within it found by the last seatOf call. */
  private seatStation = -1;
  private seatInStation = 0;
  /** Set when a cap changed, so the next update runs a staffing pass. */
  private capsDirty = false;
  /** Walk row caches of the staff audience per grid, for the people sample. Derived, never saved or hashed. */
  private sampleCaches: SampleCache[] = [];
  private sampleCacheVersion = -1;
  /** Last node passed and the route length walked to it, per slot, so a sample resumes its route. Derived. */
  private readonly trailNode = new Int32Array(STAFF.capacity).fill(-1);
  private readonly trailAt = new Float64Array(STAFF.capacity);
  /** walkStart of the walk the trail belongs to. */
  private readonly trailWalk = new Int32Array(STAFF.capacity).fill(-1);
  /** Members of each station met so far by the sample, to spread them sideways. Scratch sized at rebuild. */
  private sSeen = new Int32Array(0);
  private readonly route = new Float64Array(ROUTE_OUT);
  private readonly world = new Float64Array(2);
  /** Counts hires and releases, so the payload version moves when the roster changes. Not saved. */
  private churn = 0;
  /** True when a member state, a placement or the station set changed since the last applyPresence. Not saved. */
  private presenceDirty = true;
  private churnSeen = 0;

  /** Clock ins and clock outs counted per staff center building id, -1 without a center. For tests and sheets, not saved or hashed. */
  readonly clockIns = new Map<number, number>();
  readonly clockOuts = new Map<number, number>();

  constructor(
    readonly business: Business,
    readonly baggage: Baggage,
    readonly airfield: Airfield,
  ) {}

  /** Saved arrays by name. */
  private slotArrays(): Record<string, SavedArray> {
    return {
      seed: this.seed, role: this.role, shift: this.shift, state: this.state, flags: this.flags, home: this.home,
      stGrid: this.stGrid, stX: this.stX, stY: this.stY, stKind: this.stKind, covering: this.covering, wake: this.wake,
      breakAt: this.breakAt, walkStart: this.walkStart, walkFromX: this.walkFromX, walkFromY: this.walkFromY,
      walkToX: this.walkToX, walkToY: this.walkToY,
    };
  }

  saveState(): StaffSave {
    const arrays: Record<string, string> = {};
    const slots = this.slotArrays();
    for (const k of Object.keys(slots)) arrays[k] = packTyped(slots[k].subarray(0, this.hi));
    return { hi: this.hi, serial: this.serial, caps: packTyped(this.caps), arrays };
  }

  /** Restores the store from a save. `undefined` (a save from before staff) gives an empty store. */
  loadState(s: StaffSave | undefined): void {
    this.hi = 0;
    this.serial = 0;
    this.caps.fill(-1);
    this.stIdx.fill(-1);
    this.builtFor.fill(-1);
    this.churn = 0;
    this.churnSeen = 0;
    this.presenceDirty = true;
    if (!s) return;
    const slots = this.slotArrays();
    for (const k of Object.keys(slots)) {
      const a = slots[k];
      if (s.arrays[k] !== undefined) unpackInto(s.arrays[k], a, a.constructor as SlotCtor);
    }
    unpackInto(s.caps, this.caps, Int32Array);
    this.hi = s.hi;
    this.serial = s.serial;
  }

  /**
   * Runs in subsystem 3 before the business, so service factors follow the staff state of the same tick (spec decision 18).
   */
  update(tick: number): void {
    const changed = this.rebuildStationsIfStale();
    if (changed || this.capsDirty || tick % (STAFF.passEveryMin * TICKS_PER_MINUTE) === 0) {
      this.capsDirty = false;
      this.staffPass(tick);
    }
    if (tick % STEP_TICKS === 0) this.stateStep(tick);
    if (this.presenceDirty) this.applyPresence();
    if (this.churn !== this.churnSeen || tick % HOUR_TICKS === 0) {
      this.churnSeen = this.churn;
      this.business.version++;
    }
  }

  /** Caps the hired staff of a role, -1 for no cap. Returns a problem code or null. */
  setCap(role: number, cap: number): string | null {
    if (!Number.isInteger(role) || role < 0 || role >= STAFF_ROLE_COUNT) return 'badStaffCap';
    if (!Number.isInteger(cap) || cap < -1 || cap > STAFF.capacity) return 'badStaffCap';
    this.caps[role] = cap;
    this.capsDirty = true;
    this.business.version++;
    return null;
  }

  /** Screening machines of a grid with a spec, by id. */
  private machinesOf(gridId: number): BagNodeRec[] {
    return this.baggage.nodesOf(gridId).filter((r) => r.kind === 'machine' && r.spec !== null).sort((a, b) => a.id - b.id);
  }

  /** True when an officer stands on the screening machine with this record id. */
  machineOn(id: number): boolean {
    for (let s = 0; s < this.stCount; s++) if (this.sMachine[s] === id) return this.sPresent[s]! > 0;
    return false;
  }

  /** Rebuilds the stations when needed and applies the staff on duty to the service nodes. */
  refresh(): void {
    this.rebuildStationsIfStale();
    this.presenceDirty = true;
    this.applyPresence();
  }

  private rebuildStationsIfStale(): boolean {
    const b = this.business;
    const f = this.builtFor;
    if (f[0] === b.serviceVersion && f[1] === b.terminalVersion && f[2] === b.grids.length && f[3] === this.baggage.drawVersion() && f[4] === this.rampDepot && f[5] === this.rampStands) return false;
    f[0] = b.serviceVersion;
    f[1] = b.terminalVersion;
    f[2] = b.grids.length;
    f[3] = this.baggage.drawVersion();
    f[4] = this.rampDepot;
    f[5] = this.rampStands;
    this.rebuildStations();
    return true;
  }

  private rebuildStations(): void {
    this.presenceDirty = true;
    const b = this.business;
    let n = 0;
    for (let gi = 0; gi < b.grids.length; gi++) {
      const sn = b.serviceNodes[gi]!;
      for (let k = 0; k < sn.count; k++) if (sn.staffNeed[k]! > 0) n++;
      n += this.machinesOf(b.grids[gi]!.id).length;
    }
    const rampNeed = this.rampDepot >= 0 ? Math.min(65535, STAFF.ramp.crewSize * this.rampStands) : 0;
    if (rampNeed > 0) n++;
    this.stCount = n;
    this.sGridIdx = new Int32Array(n);
    this.sGridId = new Int32Array(n);
    this.sX = new Int16Array(n);
    this.sY = new Int16Array(n);
    this.sKind = new Uint8Array(n);
    this.sNode = new Int32Array(n).fill(-1);
    this.sMachine = new Int32Array(n).fill(-1);
    this.sRole = new Uint8Array(n);
    this.sNeed = new Uint16Array(n);
    this.sWX = new Float64Array(n);
    this.sWY = new Float64Array(n);
    this.rampStation = -1;
    this.sUnstaffed = new Float32Array(n);
    this.sPresent = new Uint8Array(n);
    this.sSkill = new Float64Array(n);
    this.sSeen = new Int32Array(n);
    this.keepSt = new Int32Array(n * SHIFTS);
    this.heldSt = new Int32Array(n * SHIFTS);
    this.curbNode = new Int32Array(b.grids.length).fill(-1);
    this.curbX = new Float64Array(b.grids.length);
    this.curbY = new Float64Array(b.grids.length);
    this.stationOf.clear();
    let s = 0;
    for (let gi = 0; gi < b.grids.length; gi++) {
      const g = b.grids[gi]!;
      const sn = b.serviceNodes[gi]!;
      for (let k = 0; k < sn.count; k++) {
        if (sn.staffNeed[k]! === 0) continue;
        const entry = STAFF.stations[fixtureKey(sn.kind[k]!)];
        if (entry === undefined) continue;
        this.sGridIdx[s] = gi;
        this.sGridId[s] = g.id;
        this.sX[s] = sn.lx[k]!;
        this.sY[s] = sn.ly[k]!;
        this.sKind[s] = sn.kind[k]!;
        this.sNode[s] = k;
        this.sRole[s] = STAFF_ROLE_KEYS.indexOf(entry.role);
        this.sNeed[s] = sn.staffNeed[k]!;
        this.sUnstaffed[s] = entry.unstaffedFactor ?? 0;
        this.stationOf.set(`${g.id}|${sn.lx[k]}|${sn.ly[k]}|${sn.kind[k]}`, s);
        s++;
      }
      for (const rec of this.machinesOf(g.id)) {
        this.sGridIdx[s] = gi;
        this.sGridId[s] = g.id;
        this.sX[s] = rec.cell[0];
        this.sY[s] = rec.cell[1];
        this.sKind[s] = MACHINE_KIND;
        this.sMachine[s] = rec.id;
        this.sRole[s] = STAFF_ROLE_KEYS.indexOf(MACHINE_STATION.role);
        this.sNeed[s] = MACHINE_STATION.need;
        this.stationOf.set(`${g.id}|${rec.cell[0]}|${rec.cell[1]}|${MACHINE_KIND}`, s);
        s++;
      }
      const curb = b.curbNode(gi);
      this.curbNode[gi] = curb;
      if (curb >= 0) {
        const c = b.walkGraphs[gi]!.nodeCell[curb]!;
        const x = c % g.w;
        const p = cornerWorld(g, g.x0 + x + 0.5, g.y0 + (c - x) / g.w + 0.5);
        this.curbX[gi] = p.x;
        this.curbY[gi] = p.y;
      }
    }
    for (let k = 0; k < s; k++) {
      this.sWX[k] = this.curbX[this.sGridIdx[k]!]!;
      this.sWY[k] = this.curbY[this.sGridIdx[k]!]!;
    }
    if (rampNeed > 0) {
      // The apron crew pool has no terminal cell: its staff commute to the depot and wait there for turnarounds.
      this.sGridIdx[s] = -1;
      this.sGridId[s] = POOL_GRID;
      this.sX[s] = this.rampDepot;
      this.sY[s] = 0;
      this.sKind[s] = 0;
      this.sRole[s] = RAMP_ROLE;
      this.sNeed[s] = rampNeed;
      this.sWX[s] = this.rampX;
      this.sWY[s] = this.rampY;
      this.stationOf.set(`${POOL_GRID}|${this.sX[s]}|0|0`, s);
      this.rampStation = s;
    }
    for (let m = 0; m < this.hi; m++) {
      this.stIdx[m] = this.state[m] === STAFF_STATE.Free ? -1 : (this.stationOf.get(`${this.stGrid[m]}|${this.stX[m]}|${this.stY[m]}|${this.stKind[m]}`) ?? -1);
    }
  }

  /** Sets seatStation and seatInStation for seat `q` of the stations of a role, counted in station order. */
  private seatOf(role: number, q: number): void {
    let left = q;
    for (let s = 0; s < this.stCount; s++) {
      if (this.sRole[s] !== role) continue;
      if (left < this.sNeed[s]!) {
        this.seatStation = s;
        this.seatInStation = left;
        return;
      }
      left -= this.sNeed[s]!;
    }
    this.seatStation = -1;
  }

  /** Lowest member of a role that holds no position, of shift `sh` or of any shift when `sh` is -1 and then only Off ones. */
  private findUnplaced(role: number, sh: number): number {
    for (let m = 0; m < this.hi; m++) {
      if (this.role[m] !== role || this.state[m] === STAFF_STATE.Free || this.stIdx[m]! >= 0 || (this.flags[m]! & STAFF_FLAG.Relief) !== 0) continue;
      if (sh >= 0 ? this.shift[m] === sh : this.state[m] === STAFF_STATE.Off) return m;
    }
    return -1;
  }

  private unplace(m: number): void {
    this.stGrid[m] = -1;
    this.stIdx[m] = -1;
    this.flags[m] &= ~STAFF_FLAG.Relief;
  }

  /**
   * Hires, places and releases staff so every role holds the positions its stations need on all shifts, within the player
   * cap. Positions fill the running shift first. A pass with nothing changed changes nothing.
   */
  private staffPass(tick: number): void {
    this.presenceDirty = true;
    const run = shiftAt(tick);
    this.keepSt.fill(0);
    this.heldSt.fill(0);
    this.keepRelief.fill(0);
    this.heldRelief.fill(0);
    for (let r = 0; r < STAFF_ROLE_COUNT; r++) this.passRole(tick, r, run);
  }

  private passRole(tick: number, r: number, run: number): void {
    let need = 0;
    for (let s = 0; s < this.stCount; s++) if (this.sRole[s] === r) need += this.sNeed[s]!;
    const relief = need > 0 ? Math.ceil(STAFF.reliefShare * need) : 0;
    const block = need + relief;
    const all = SHIFTS * block;
    const allowed = this.caps[r]! < 0 ? all : Math.min(all, this.caps[r]!);
    for (let p = 0; p < allowed; p++) {
      const i = Math.floor(p / block);
      const sh = (run + i) % SHIFTS;
      const q = p - i * block;
      if (q < need) {
        this.seatOf(r, q);
        this.keepSt[this.seatStation * SHIFTS + sh]++;
      } else {
        this.keepRelief[r * SHIFTS + sh]++;
      }
    }
    for (let m = 0; m < this.hi; m++) {
      if (this.role[m] !== r || this.state[m] === STAFF_STATE.Free) continue;
      const s = this.stIdx[m]!;
      const sh = this.shift[m]!;
      if ((this.flags[m]! & STAFF_FLAG.Relief) !== 0 && s >= 0) {
        // A relief standing in for a member on break keeps its copy of the station until the member returns.
        this.heldRelief[r * SHIFTS + sh]++;
      } else if (s >= 0) {
        if (this.heldSt[s * SHIFTS + sh]! < this.keepSt[s * SHIFTS + sh]!) this.heldSt[s * SHIFTS + sh]++;
        else this.unplace(m);
      } else if ((this.flags[m]! & STAFF_FLAG.Relief) !== 0) {
        if (this.heldRelief[r * SHIFTS + sh]! < this.keepRelief[r * SHIFTS + sh]!) this.heldRelief[r * SHIFTS + sh]++;
        else this.unplace(m);
      } else {
        this.stGrid[m] = -1;
      }
    }
    for (let p = 0; p < allowed; p++) {
      const i = Math.floor(p / block);
      const sh = (run + i) % SHIFTS;
      const q = p - i * block;
      let station = -1;
      if (q < need) {
        this.seatOf(r, q);
        station = this.seatStation;
        if (this.seatInStation < this.heldSt[station * SHIFTS + sh]!) continue;
      } else if (q - need < this.heldRelief[r * SHIFTS + sh]!) {
        continue;
      }
      let m = this.findUnplaced(r, sh);
      if (m < 0) m = this.findUnplaced(r, -1);
      if (m < 0) m = this.alloc(r, sh);
      if (m < 0) break;
      this.shift[m] = sh;
      if (station >= 0) {
        this.stGrid[m] = this.sGridId[station]!;
        this.stX[m] = this.sX[station]!;
        this.stY[m] = this.sY[station]!;
        this.stKind[m] = this.sKind[station]!;
        this.stIdx[m] = station;
        this.flags[m] &= ~STAFF_FLAG.Relief;
      } else {
        this.stGrid[m] = -1;
        this.stIdx[m] = -1;
        this.flags[m] |= STAFF_FLAG.Relief;
      }
      if (this.state[m] !== STAFF_STATE.Off) continue;
      if (sh === run) {
        this.state[m] = station >= 0 ? STAFF_STATE.OnDuty : STAFF_STATE.Standby;
        this.home[m] = this.homeNear(station);
        this.breakAt[m] = shiftStartTick(tick, sh) + (STAFF.breaks.afterMin + breakJitterMin(this.seed[m]!)) * TICKS_PER_MINUTE;
        this.wake[m] = tick + STEP_TICKS;
      } else {
        this.plan(m, tick);
      }
    }
    for (let m = 0; m < this.hi; m++) {
      if (this.role[m] !== r || this.stIdx[m]! >= 0 || (this.flags[m]! & STAFF_FLAG.Relief) !== 0) continue;
      if (this.state[m] === STAFF_STATE.Off || this.state[m] === STAFF_STATE.Standby) this.free(m);
    }
  }

  /**
   * Hands over the apron crew pool from the road net (T81): the lowest id depot and its centre, and the commercial stands
   * a depot reaches. depot -1 means no pool.
   */
  setRamp(depot: number, x: number, y: number, stands: number): void {
    this.rampDepot = depot;
    this.rampX = x;
    this.rampY = y;
    this.rampStands = depot >= 0 ? stands : 0;
  }

  /** Crews of the apron crew pool on duty now, -1 when the airport has no pool and turnarounds need no crew (T81). */
  rampCrews(): number {
    if (this.rampStation < 0) return -1;
    return Math.floor(this.sPresent[this.rampStation]! / STAFF.ramp.crewSize);
  }

  /** The point staff of a station commute to, or the curb of the first grid for a relief with none. */
  private endX(s: number): number {
    return s >= 0 ? this.sWX[s]! : (this.curbX[0] ?? 0);
  }

  private endY(s: number): number {
    return s >= 0 ? this.sWY[s]! : (this.curbY[0] ?? 0);
  }

  /** Id of the staff center nearest by straight line to where the staff of a station commute, ties to the lowest id, -1 for none. */
  homeNear(station: number): number {
    const buildings = this.airfield.data.buildings ?? [];
    const cx = this.endX(station);
    const cy = this.endY(station);
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i]!;
      if (b.kind !== 'staff') continue;
      const d = Math.hypot(b.x - cx, b.y - cy);
      if (d < bestD || (d === bestD && b.id < best)) {
        bestD = d;
        best = b.id;
      }
    }
    return best;
  }

  /** Ticks member m travels between a staff center and where its station's staff commute, 0 without a center or when it is gone. */
  private commuteTicks(home: number, m: number): number {
    if (home < 0) return 0;
    const buildings = this.airfield.data.buildings ?? [];
    const s = this.stIdx[m]!;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i]!;
      if (b.id !== home) continue;
      const d = Math.hypot(b.x - this.endX(s), b.y - this.endY(s));
      return gameSecondsToTicks(Math.ceil(d / CREW_SPEED_MPS));
    }
    return 0;
  }

  /** Ticks a member walks between two walk nodes of a grid, Infinity when the staff cannot get there. */
  private walkTicks(gridIdx: number, fromNode: number, toNode: number): number {
    const wg = this.business.walkGraphs[gridIdx];
    if (!wg || fromNode < 0 || toNode < 0) return Infinity;
    const d = walkDistance(wg, fromNode, toNode, AUD.Staff);
    return d === Infinity ? Infinity : gameSecondsToTicks(Math.ceil(d / CREW_SPEED_MPS));
  }

  /** Grid index a member works in: its station's grid, -1 on the apron crew pool, the first grid for a relief. */
  private gridOf(m: number): number {
    const s = this.stIdx[m]!;
    return s >= 0 ? this.sGridIdx[s]! : 0;
  }

  /** Walk node of the station of a member in its grid, -1 when it has none. */
  private stationNode(m: number): number {
    const s = this.stIdx[m]!;
    const g = s >= 0 ? this.business.grids[this.sGridIdx[s]!] : undefined;
    const wg = s >= 0 ? this.business.walkGraphs[this.sGridIdx[s]!] : undefined;
    if (!g || !wg) return -1;
    return nearestNode(wg, cellIndex(g, this.sX[s]!, this.sY[s]!));
  }

  /** End tick of the shift instance a member of `sh` serves at `tick`, counting an early arrival for the next instance. */
  private dutyEnd(tick: number, sh: number): number {
    const start = shiftStartTick(tick, sh);
    const end = start + SHIFT_TICKS;
    if (tick < end) return end;
    return start + TICKS_PER_DAY - tick < tick - end ? end + TICKS_PER_DAY : end;
  }

  /** Sets the wake of an Off member to clock in early enough to stand on its station at the start of its next shift. */
  private plan(m: number, tick: number, skipNow = false): void {
    const sh = this.shift[m]!;
    if (!skipNow && shiftAt(tick) === sh && tick < shiftEndTick(tick, sh) - 60 * TICKS_PER_MINUTE) {
      this.wake[m] = tick;
      return;
    }
    const gi = this.gridOf(m);
    let lead = CHANGE_TICKS + this.commuteTicks(this.homeNear(this.stIdx[m]!), m);
    const walk = this.walkTicks(gi, this.business.curbNode(gi), this.stationNode(m));
    if (walk !== Infinity) lead += walk;
    this.wake[m] = Math.max(tick, shiftStartTick(tick, sh) + TICKS_PER_DAY - lead);
  }

  /** Records a walk between the curb and the station of a member, in logical cells. Leaves the record alone without both. */
  private setWalk(m: number, tick: number, fromCurb: boolean): void {
    const gi = this.gridOf(m);
    const g = this.business.grids[gi];
    const wg = this.business.walkGraphs[gi];
    const curb = this.business.curbNode(gi);
    const s = this.stIdx[m]!;
    if (!g || !wg || curb < 0 || s < 0) return;
    const c = wg.nodeCell[curb]!;
    const cx = g.x0 + (c % g.w);
    const cy = g.y0 + Math.floor(c / g.w);
    this.walkFromX[m] = fromCurb ? cx : this.sX[s]!;
    this.walkFromY[m] = fromCurb ? cy : this.sY[s]!;
    this.walkToX[m] = fromCurb ? this.sX[s]! : cx;
    this.walkToY[m] = fromCurb ? this.sY[s]! : cy;
    this.walkStart[m] = tick;
  }

  private count(map: Map<number, number>, home: number): void {
    map.set(home, (map.get(home) ?? 0) + 1);
  }

  /** Sends an on duty member to the curb: a walk record and then the commute home. */
  private startLeaving(m: number, tick: number): void {
    this.state[m] = STAFF_STATE.Leaving;
    this.walkStart[m] = -1;
    const gi = this.gridOf(m);
    const walk = this.walkTicks(gi, this.stationNode(m), this.business.curbNode(gi));
    this.setWalk(m, tick, false);
    this.wake[m] = tick + (walk === Infinity ? 0 : walk);
  }

  /** Sends a member whose station cannot be reached home, to plan for its next shift. */
  private sendHome(m: number, tick: number): void {
    this.state[m] = STAFF_STATE.CommuteHome;
    this.walkStart[m] = WALK_UNREACHABLE;
    this.wake[m] = tick + this.commuteTicks(this.home[m]!, m);
  }

  /** Advances every member whose wake tick has come by one state, in slot order. */
  private stateStep(tick: number): void {
    for (let m = 0; m < this.hi; m++) {
      if (this.state[m] === STAFF_STATE.Free || this.wake[m]! > tick) continue;
      this.presenceDirty = true;
      const sh = this.shift[m]!;
      const gi = this.gridOf(m);
      switch (this.state[m]) {
        case STAFF_STATE.Off:
          if (this.stIdx[m]! < 0 && (this.flags[m]! & STAFF_FLAG.Relief) === 0) {
            this.free(m);
            break;
          }
          this.home[m] = this.homeNear(this.stIdx[m]!);
          this.count(this.clockIns, this.home[m]!);
          this.flags[m] &= ~(STAFF_FLAG.Tired | STAFF_FLAG.BreakDone);
          this.state[m] = STAFF_STATE.ClockIn;
          this.wake[m] = tick + CHANGE_TICKS;
          break;
        case STAFF_STATE.ClockIn:
          if ((this.flags[m]! & STAFF_FLAG.Relief) !== 0) {
            this.state[m] = STAFF_STATE.Standby;
            this.wake[m] = this.dutyEnd(tick, sh);
          } else {
            this.state[m] = STAFF_STATE.Commute;
            this.wake[m] = tick + this.commuteTicks(this.home[m]!, m);
          }
          break;
        case STAFF_STATE.Commute: {
          if (gi < 0 && this.stIdx[m]! >= 0) {
            // The apron crew pool has no walk: the member takes over at the depot.
            this.arrive(m, tick);
            break;
          }
          const walk = this.walkTicks(gi, this.business.curbNode(gi), this.stationNode(m));
          if (walk === Infinity) {
            this.sendHome(m, tick);
            break;
          }
          this.state[m] = STAFF_STATE.ToStation;
          this.setWalk(m, tick, true);
          this.wake[m] = tick + walk;
          break;
        }
        case STAFF_STATE.ToStation:
          this.arrive(m, tick);
          break;
        case STAFF_STATE.OnDuty: {
          const end = this.dutyEnd(tick, sh);
          const breakDone = (this.flags[m]! & STAFF_FLAG.BreakDone) !== 0;
          if (tick >= end + OVERTIME_TICKS) this.startLeaving(m, tick);
          else if (tick >= end) this.wake[m] = end + OVERTIME_TICKS;
          else if ((this.flags[m]! & STAFF_FLAG.OnBreak) !== 0) this.startLeaving(m, tick);
          else if (!breakDone && tick >= this.breakAt[m]!) this.beginBreak(m, tick, end);
          else this.wake[m] = breakDone ? end : Math.min(this.breakAt[m]!, end);
          break;
        }
        case STAFF_STATE.Leaving:
          this.walkStart[m] = -1;
          this.state[m] = STAFF_STATE.CommuteHome;
          this.wake[m] = tick + this.commuteTicks(this.home[m]!, m);
          break;
        case STAFF_STATE.CommuteHome:
          if (this.stIdx[m]! >= 0 && (this.flags[m]! & STAFF_FLAG.Relief) !== 0) {
            // A relief that stood in goes back to waiting, or home when its shift is over.
            this.stGrid[m] = -1;
            this.stIdx[m] = -1;
            this.covering[m] = -1;
            this.walkStart[m] = -1;
            const end = this.dutyEnd(tick, sh);
            this.state[m] = tick < end ? STAFF_STATE.Standby : STAFF_STATE.ClockOut;
            this.wake[m] = tick < end ? end : tick + CHANGE_TICKS;
          } else if ((this.flags[m]! & STAFF_FLAG.OnBreak) !== 0) {
            this.state[m] = STAFF_STATE.Break;
            this.wake[m] = tick + BREAK_TICKS;
          } else {
            this.state[m] = STAFF_STATE.ClockOut;
            this.wake[m] = tick + CHANGE_TICKS;
          }
          break;
        case STAFF_STATE.Break:
          this.flags[m] = (this.flags[m]! & ~STAFF_FLAG.OnBreak) | STAFF_FLAG.BreakDone;
          if (tick >= this.dutyEnd(tick, sh)) {
            this.state[m] = STAFF_STATE.ClockOut;
            this.wake[m] = tick + CHANGE_TICKS;
          } else {
            this.state[m] = STAFF_STATE.Commute;
            this.wake[m] = tick + this.commuteTicks(this.home[m]!, m);
          }
          break;
        case STAFF_STATE.ClockOut: {
          const unreachable = this.walkStart[m] === WALK_UNREACHABLE;
          this.count(this.clockOuts, this.home[m]!);
          this.endCover(m);
          this.covering[m] = -1;
          this.walkStart[m] = -1;
          this.flags[m] &= ~STAFF_FLAG.OnBreak;
          if (this.stIdx[m]! < 0 && (this.flags[m]! & STAFF_FLAG.Relief) === 0) {
            this.free(m);
            break;
          }
          this.state[m] = STAFF_STATE.Off;
          this.plan(m, tick, unreachable);
          break;
        }
        case STAFF_STATE.Standby:
          if (tick >= this.dutyEnd(tick, sh)) {
            this.state[m] = STAFF_STATE.ClockOut;
            this.wake[m] = tick + CHANGE_TICKS;
          } else {
            this.wake[m] = this.dutyEnd(tick, sh);
          }
          break;
        default:
          break;
      }
    }
  }

  /**
   * The member's one break of the shift. Without a staff center it is skipped and the member works tired. With one, the
   * lowest waiting relief of the role and shift is sent to the station and the member waits for it for reliefWaitMin.
   */
  private beginBreak(m: number, tick: number, end: number): void {
    if (this.home[m]! < 0) {
      this.flags[m] |= STAFF_FLAG.Tired | STAFF_FLAG.BreakDone;
      this.wake[m] = end;
      return;
    }
    this.flags[m] |= STAFF_FLAG.OnBreak;
    this.wake[m] = tick + RELIEF_WAIT_TICKS;
    for (let r = 0; r < this.hi; r++) {
      if (this.state[r] !== STAFF_STATE.Standby || this.role[r] !== this.role[m] || this.shift[r] !== this.shift[m] || this.covering[r]! >= 0) continue;
      this.covering[r] = m;
      this.stGrid[r] = this.stGrid[m]!;
      this.stX[r] = this.stX[m]!;
      this.stY[r] = this.stY[m]!;
      this.stKind[r] = this.stKind[m]!;
      this.stIdx[r] = this.stIdx[m]!;
      this.flags[r] |= STAFF_FLAG.BreakDone;
      this.state[r] = STAFF_STATE.Commute;
      this.wake[r] = tick + this.commuteTicks(this.home[r]!, r);
      return;
    }
  }

  /** A member reaches its station: it takes over, and the member it replaces leaves. */
  private arrive(m: number, tick: number): void {
    const s = this.stIdx[m]!;
    if (s < 0) {
      this.sendHome(m, tick);
      return;
    }
    const sh = this.shift[m]!;
    const end = this.dutyEnd(tick, sh);
    this.state[m] = STAFF_STATE.OnDuty;
    this.walkStart[m] = -1;
    if ((this.flags[m]! & STAFF_FLAG.BreakDone) === 0) this.breakAt[m] = end - SHIFT_TICKS + (STAFF.breaks.afterMin + breakJitterMin(this.seed[m]!)) * TICKS_PER_MINUTE;
    for (let o = 0; o < this.hi; o++) {
      if (o === m || this.state[o] !== STAFF_STATE.OnDuty || this.stIdx[o] !== s) continue;
      if (this.shift[o] !== sh || this.covering[o] === m || this.covering[m] === o) {
        this.startLeaving(o, tick);
        break;
      }
    }
    const breakDue = (this.flags[m]! & STAFF_FLAG.BreakDone) === 0 ? this.breakAt[m]! : end;
    this.wake[m] = Math.min(breakDue, end);
  }

  /** Counts the staff on duty per station and sets the staff factor of each service node. */
  private applyPresence(): void {
    this.presenceDirty = false;
    this.sPresent.fill(0);
    this.sSkill.fill(0);
    for (let m = 0; m < this.hi; m++) {
      const s = this.stIdx[m]!;
      if (this.state[m] !== STAFF_STATE.OnDuty || s < 0) continue;
      this.sPresent[s]++;
      this.sSkill[s] += staffSkill(this.seed[m]!) * ((this.flags[m]! & STAFF_FLAG.Tired) !== 0 ? STAFF.breaks.tiredSkill : 1);
    }
    for (let s = 0; s < this.stCount; s++) {
      const node = this.sNode[s]!;
      if (node < 0) continue;
      const table = this.business.serviceNodes[this.sGridIdx[s]!]!;
      table.staffPresent[node] = this.sPresent[s]!;
      table.staffFactor[node] = this.sPresent[s]! > 0 ? this.sSkill[s]! / this.sNeed[s]! : this.sUnstaffed[s]!;
    }
  }

  /** Allocates a slot for a new member in state Off, or returns -1 at capacity. */
  alloc(role: number, shift: number): number {
    let s = -1;
    for (let i = 0; i < this.hi; i++) {
      if (this.state[i] === STAFF_STATE.Free) {
        s = i;
        break;
      }
    }
    if (s < 0) {
      if (this.hi >= this.cap) return -1;
      s = this.hi++;
    }
    this.churn++;
    this.presenceDirty = true;
    this.seed[s] = staffSeed(this.serial++);
    this.role[s] = role;
    this.shift[s] = shift;
    this.state[s] = STAFF_STATE.Off;
    this.flags[s] = 0;
    this.home[s] = -1;
    this.stGrid[s] = -1;
    this.stX[s] = 0;
    this.stY[s] = 0;
    this.stKind[s] = 0;
    this.covering[s] = -1;
    this.wake[s] = 0;
    this.breakAt[s] = -1;
    this.walkStart[s] = -1;
    this.walkFromX[s] = 0;
    this.walkFromY[s] = 0;
    this.walkToX[s] = 0;
    this.walkToY[s] = 0;
    this.stIdx[s] = -1;
    return s;
  }

  /** Releases a slot and trims `hi` past trailing free slots. */
  free(s: number): void {
    this.endCover(s);
    this.churn++;
    this.presenceDirty = true;
    this.state[s] = STAFF_STATE.Free;
    this.stGrid[s] = -1;
    this.covering[s] = -1;
    this.stIdx[s] = -1;
    while (this.hi > 0 && this.state[this.hi - 1] === STAFF_STATE.Free) this.hi--;
  }

  /**
   * Ends the cover of every relief standing in for member `s`, so a slot that is freed and reused is never covered. A relief
   * still on its way goes back to Standby, one already on the station keeps it until its shift ends.
   */
  private endCover(s: number): void {
    for (let r = 0; r < this.hi; r++) {
      if (this.covering[r] !== s) continue;
      this.covering[r] = -1;
      const walking = this.state[r] === STAFF_STATE.ClockIn || this.state[r] === STAFF_STATE.Commute || this.state[r] === STAFF_STATE.ToStation;
      if (!walking) continue;
      this.stGrid[r] = -1;
      this.stIdx[r] = -1;
      this.walkStart[r] = -1;
      this.state[r] = STAFF_STATE.Standby;
      this.wake[r] = 0;
    }
  }

  /** Members of a role that are not free. */
  hired(role: number): number {
    let n = 0;
    for (let s = 0; s < this.hi; s++) if (this.role[s] === role && this.state[s] !== STAFF_STATE.Free) n++;
    return n;
  }

  /** Rebuilds the staff walk row caches when the walk graphs changed. Allocates only then. */
  private ensureSampleCaches(): void {
    const wgs = this.business.walkGraphs;
    let stale = this.sampleCacheVersion !== this.business.walkVersion || this.sampleCaches.length !== wgs.length;
    for (let g = 0; !stale && g < wgs.length; g++) stale = this.sampleCaches[g]!.sourceRow.length !== wgs[g]!.nodeCount;
    if (!stale) return;
    this.sampleCaches = wgs.map((wg) => newSampleCache(wg));
    this.sampleCacheVersion = this.business.walkVersion;
    this.trailNode.fill(-1);
  }

  /** Writes one staff entry n at this.world, facing the grid step (ex, ey), and counts it. */
  private putSample(views: SnapshotViews, n: number, m: number, axA: number, ex: number, ey: number, mode: number): void {
    views.peopleX[n] = this.world[0]!;
    views.peopleY[n] = this.world[1]!;
    views.peopleProfile[n] = STAFF_PROFILE_BASE + this.role[m]!;
    views.peopleSize[n] = 1;
    views.peopleSeed[n] = this.seed[m]!;
    views.peopleHeading[n] = Math.round(((axA + atan2Det(ey, ex)) * HEADING_STEPS) / TWO_PI) & (HEADING_STEPS - 1);
    views.peopleId[n] = STAFF_ID_BASE + m;
    views.peopleMode[n] = mode;
  }

  /**
   * Adds the staff to the people sample after the cohorts: members on duty stand behind their desk, away from the queue,
   * and members walking between the curb and their station are placed on the staff route by the time walked. Reads only,
   * the sim state does not change, and only the derived caches and trails are written.
   */
  writeSample(views: SnapshotViews, tick: number): void {
    this.ensureSampleCaches();
    const grids = this.business.grids;
    let n = views.header[SnapHeader.PeopleCount]!;
    const cap = Math.min(SNAPSHOT_PEOPLE_CAPACITY, n + STAFF.sampleCap);
    this.sSeen.fill(0);
    for (let m = 0; m < this.hi && n < cap; m++) {
      const state = this.state[m]!;
      const s = this.stIdx[m]!;
      if (state === STAFF_STATE.OnDuty && s >= 0) {
        const gi = this.sGridIdx[s]!;
        const grid = grids[gi];
        if (!grid) continue;
        const axA = grid.headingDeg * DEG;
        const ux = sinLut(axA);
        const uy = -cosLut(axA);
        // The step toward the first queue cell of the station's service node, snapped to its dominant grid axis.
        let sx = 0;
        let sy = 0;
        const node = this.sNode[s]!;
        const table = node >= 0 ? this.business.serviceNodes[gi] : undefined;
        if (table && table.qCellLen[node]! > 0) {
          const first = table.qCellOffset[node]!;
          const dx = table.qCellX[first]! - table.lx[node]!;
          const dy = table.qCellY[first]! - table.ly[node]!;
          sx = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
          sy = sx === 0 ? Math.sign(dy) : 0;
        }
        const back = STAFF.operator.backM / TERMINAL_CELL_M;
        const k = this.sSeen[s]!++;
        const side = ((k - (this.sNeed[s]! - 1) / 2) * STAFF.operator.spacingM) / TERMINAL_CELL_M;
        // Sideways is the step turned a quarter, (1, 0) for a station with no queue cell.
        const px = sx === 0 && sy === 0 ? 1 : -sy;
        const py = sx === 0 && sy === 0 ? 0 : sx;
        let lx = this.sX[s]! + 0.5 - sx * back + px * side;
        let ly = this.sY[s]! + 0.5 - sy * back + py * side;
        if (this.sKind[s] === SECURITY_ID) {
          // Officers of a 16 m security lane (T74) stand on its walking strip, clear of the bag belt, spread along the
          // lane round its middle, not past the anchor on the exit end.
          const code = grid.fixtureRot[cellIndex(grid, this.sX[s]!, this.sY[s]!)]!;
          const [ax, ay] = ROT_STEP[code > 0 && code < 5 ? code - 1 : 0]!;
          const along = (k - (this.sNeed[s]! - 1) / 2) * LANE_OFFICER_SPACING + (LANE_ACROSS - 1) / 2;
          lx = this.sX[s]! + 0.5 + ax * LANE_STRIP + sx * along;
          ly = this.sY[s]! + 0.5 + ay * LANE_STRIP + sy * along;
        }
        this.world[0] = grid.ox + (ux * lx + -uy * ly) * TERMINAL_CELL_M;
        this.world[1] = grid.oy + (uy * lx + ux * ly) * TERMINAL_CELL_M;
        this.putSample(views, n, m, axA, sx, sy === 0 && sx === 0 ? -1 : sy, PEOPLE_MODE.Dwelling);
        n++;
        continue;
      }
      if ((state !== STAFF_STATE.ToStation && state !== STAFF_STATE.Leaving) || this.walkStart[m]! < 0) continue;
      const gi = this.gridOf(m);
      const grid = grids[gi];
      const wg = this.business.walkGraphs[gi];
      const cache = this.sampleCaches[gi];
      if (!grid || !wg || !cache) continue;
      const from = nearestNode(wg, cellAt(wg, this.walkFromX[m]!, this.walkFromY[m]!));
      const to = nearestNode(wg, cellAt(wg, this.walkToX[m]!, this.walkToY[m]!));
      if (from < 0 || to < 0) continue;
      const walked = Math.max(0, ((tick - this.walkStart[m]!) * CREW_SPEED_MPS) / TICKS_PER_SECOND);
      if (this.trailWalk[m] !== this.walkStart[m]) {
        this.trailWalk[m] = this.walkStart[m]!;
        this.trailNode[m] = -1;
      }
      const resume = this.trailNode[m]! >= 0 && this.trailAt[m]! <= walked;
      const r = resume
        ? routePoint(wg, cache, this.trailNode[m]!, this.trailAt[m]!, to, walked, this.route, AUD.Staff)
        : routePoint(wg, cache, from, 0, to, walked, this.route, AUD.Staff);
      if (r !== 1) continue;
      this.trailNode[m] = this.route[4]!;
      this.trailAt[m] = this.route[5]!;
      const ex = this.route[2]!;
      const ey = this.route[3]!;
      const sx = Math.abs(ex) >= Math.abs(ey) ? Math.sign(ex) : 0;
      const sy = sx === 0 ? Math.sign(ey) : 0;
      const axA = grid.headingDeg * DEG;
      const ux = sinLut(axA);
      const uy = -cosLut(axA);
      const lx = this.route[0]!;
      const ly = this.route[1]!;
      this.world[0] = grid.ox + (ux * lx + -uy * ly) * TERMINAL_CELL_M;
      this.world[1] = grid.oy + (uy * lx + ux * ly) * TERMINAL_CELL_M;
      this.putSample(views, n, m, axA, sx, sy, PEOPLE_MODE.Walking);
      n++;
    }
    views.header[SnapHeader.PeopleCount] = n;
  }

  /** Fills the staffing coverage of one grid into an overlay: one entry per station, in station order. Changes no sim state. */
  fillCoverage(out: OverlayData, gridIdx: number): void {
    const grid = this.business.grids[gridIdx];
    let count = 0;
    for (let s = 0; s < this.stCount; s++) if (this.sGridIdx[s] === gridIdx) count++;
    out.stationCell = out.stationCell.length === count ? out.stationCell : new Int32Array(count);
    out.stationNeed = out.stationNeed.length === count ? out.stationNeed : new Uint8Array(count);
    out.stationPresent = out.stationPresent.length === count ? out.stationPresent : new Uint8Array(count);
    let k = 0;
    for (let s = 0; s < this.stCount; s++) {
      if (this.sGridIdx[s] !== gridIdx) continue;
      out.stationCell[k] = grid ? cellIndex(grid, this.sX[s]!, this.sY[s]!) : -1;
      out.stationNeed[k] = this.sNeed[s]!;
      out.stationPresent[k] = this.sPresent[s]!;
      k++;
    }
  }

  /** Wages of every hired member per game day. */
  wagesPerDay(): number {
    let sum = 0;
    for (let s = 0; s < this.hi; s++) if (this.state[s] !== STAFF_STATE.Free) sum += STAFF.roles[STAFF_ROLE_KEYS[this.role[s]!]!].wagePerDay;
    return sum;
  }

  /** The staffing table: one row per role. */
  rows(): StaffRow[] {
    const out: StaffRow[] = [];
    for (let r = 0; r < STAFF_ROLE_COUNT; r++) {
      let hired = 0;
      let onDuty = 0;
      let away = 0;
      for (let s = 0; s < this.hi; s++) {
        if (this.role[s] !== r || this.state[s] === STAFF_STATE.Free) continue;
        hired++;
        const st = this.state[s];
        if (st === STAFF_STATE.OnDuty) onDuty++;
        else if (st !== STAFF_STATE.Off) away++;
      }
      let needed = 0;
      for (let s = 0; s < this.stCount; s++) if (this.sRole[s] === r) needed += this.sNeed[s]!;
      out.push({ role: r, hired, onDuty, away, needed, cap: this.caps[r]!, wagePerDay: STAFF.roles[STAFF_ROLE_KEYS[r]!].wagePerDay });
    }
    return out;
  }

  /** Folds the saved state into a running hash. */
  hash(h: number): number {
    let acc = foldU32(h, this.hi);
    acc = foldU32(acc, this.serial);
    for (let r = 0; r < STAFF_ROLE_COUNT; r++) acc = foldU32(acc, this.caps[r]);
    for (let a = 0; a < this.saved.length; a++) {
      const arr = this.saved[a];
      for (let s = 0; s < this.hi; s++) acc = foldU32(acc, arr[s]);
    }
    return acc;
  }
}
