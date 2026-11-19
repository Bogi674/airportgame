import { STAFF } from '@data/index';
import { STAFF_ROLE_COUNT, STAFF_ROLE_KEYS } from '@data/schemas/staff';
import { fixtureKey, minuteOfDay, START_MINUTE, TICKS_PER_DAY, TICKS_PER_MINUTE } from '@shared/business';
import { cornerWorld } from '@shared/terminalOps';
import type { Business } from '../business/business';
import type { Baggage } from '../ops/baggage/baggage';
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
  /** Tick the current walk started, -1 none. */
  readonly walkStart = new Int32Array(this.cap);
  /** Start x of the current walk, in meters. */
  readonly walkFromX = new Int16Array(this.cap);
  /** Start y of the current walk, in meters. */
  readonly walkFromY = new Int16Array(this.cap);
  /** End x of the current walk, in meters. */
  readonly walkToX = new Int16Array(this.cap);
  /** End y of the current walk, in meters. */
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
  sNeed = new Uint8Array(0);
  /** Officers on duty at each station. */
  sPresent = new Uint8Array(0);
  /** Summed skill of the officers on duty at each station. */
  sSkill = new Float64Array(0);
  /** Walk node of the curb door of each grid, -1 for none. */
  curbNode = new Int32Array(0);
  /** World point of the curb door of each grid. */
  curbX = new Float64Array(0);
  curbY = new Float64Array(0);
  /** Station index by `gridId|x|y|kind`, built at rebuild only. */
  private readonly stationOf = new Map<string, number>();
  /** serviceVersion, terminalVersion and grid count the stations were built from. */
  private readonly builtFor = new Int32Array(3).fill(-1);
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

  constructor(
    readonly business: Business,
    readonly baggage: Baggage,
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
    this.applyPresence();
  }

  /** Caps the hired staff of a role, -1 for no cap. Returns a problem code or null. */
  setCap(role: number, cap: number): string | null {
    if (!Number.isInteger(role) || role < 0 || role >= STAFF_ROLE_COUNT) return 'badStaffCap';
    if (!Number.isInteger(cap) || cap < -1 || cap > STAFF.capacity) return 'badStaffCap';
    this.caps[role] = cap;
    this.capsDirty = true;
    return null;
  }

  /** Rebuilds the stations when needed and applies the staff on duty to the service nodes. */
  refresh(): void {
    this.rebuildStationsIfStale();
    this.applyPresence();
  }

  private rebuildStationsIfStale(): boolean {
    const b = this.business;
    if (this.builtFor[0] === b.serviceVersion && this.builtFor[1] === b.terminalVersion && this.builtFor[2] === b.grids.length) return false;
    this.builtFor[0] = b.serviceVersion;
    this.builtFor[1] = b.terminalVersion;
    this.builtFor[2] = b.grids.length;
    this.rebuildStations();
    return true;
  }

  private rebuildStations(): void {
    const b = this.business;
    let n = 0;
    for (let gi = 0; gi < b.grids.length; gi++) {
      const sn = b.serviceNodes[gi]!;
      for (let k = 0; k < sn.count; k++) if (sn.staffNeed[k]! > 0) n++;
    }
    this.stCount = n;
    this.sGridIdx = new Int32Array(n);
    this.sGridId = new Int32Array(n);
    this.sX = new Int16Array(n);
    this.sY = new Int16Array(n);
    this.sKind = new Uint8Array(n);
    this.sNode = new Int32Array(n).fill(-1);
    this.sMachine = new Int32Array(n).fill(-1);
    this.sRole = new Uint8Array(n);
    this.sNeed = new Uint8Array(n);
    this.sPresent = new Uint8Array(n);
    this.sSkill = new Float64Array(n);
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
        this.sNeed[s] = entry.need;
        this.stationOf.set(`${g.id}|${sn.lx[k]}|${sn.ly[k]}|${sn.kind[k]}`, s);
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
      if (s >= 0) {
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
        this.home[m] = -1;
        this.breakAt[m] = shiftStartTick(tick, sh) + (STAFF.breaks.afterMin + breakJitterMin(this.seed[m]!)) * TICKS_PER_MINUTE;
        this.wake[m] = tick + STAFF.stepMin * TICKS_PER_MINUTE;
      } else {
        this.wake[m] = tick;
      }
    }
    for (let m = 0; m < this.hi; m++) {
      if (this.role[m] !== r || this.stIdx[m]! >= 0 || (this.flags[m]! & STAFF_FLAG.Relief) !== 0) continue;
      if (this.state[m] === STAFF_STATE.Off || this.state[m] === STAFF_STATE.Standby) this.free(m);
    }
  }

  /** Counts the staff on duty per station and sets the staff factor of each service node. */
  private applyPresence(): void {
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
      table.staffFactor[node] = this.sPresent[s]! > 0 ? this.sSkill[s]! / this.sNeed[s]! : 0;
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
    this.state[s] = STAFF_STATE.Free;
    this.stGrid[s] = -1;
    this.covering[s] = -1;
    this.stIdx[s] = -1;
    while (this.hi > 0 && this.state[this.hi - 1] === STAFF_STATE.Free) this.hi--;
  }

  /** Members of a role that are not free. */
  hired(role: number): number {
    let n = 0;
    for (let s = 0; s < this.hi; s++) if (this.role[s] === role && this.state[s] !== STAFF_STATE.Free) n++;
    return n;
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
