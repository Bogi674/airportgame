import { STAFF } from '@data/index';
import { STAFF_ROLE_COUNT } from '@data/schemas/staff';
import { foldU32 } from '../hash';
import { packTyped, unpackInto } from '../save/pack';
import { staffSeed } from './staffTraits';

/** Life cycle state of a staff slot. Saved values, append only. */
export const STAFF_STATE = { Free: 0, Off: 1, ClockIn: 2, Commute: 3, ToStation: 4, OnDuty: 5, Leaving: 6, CommuteHome: 7, ClockOut: 8, Break: 9, Standby: 10 } as const;

/** Bits of the flags array. Saved values, append only. */
export const STAFF_FLAG = { Tired: 1, BreakDone: 2, OnBreak: 4, Relief: 8 } as const;

type SavedArray = Uint8Array | Int16Array | Int32Array | Uint32Array;
type SlotCtor = { new (buffer: ArrayBuffer): SavedArray; BYTES_PER_ELEMENT: number };

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
    void tick;
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
