import { PROFILES } from '@data/index';
import { PROFILE_KEYS } from '@data/schemas/profiles';
import { TICKS_PER_MINUTE } from '@shared/business';
import type { Business } from '../business/business';
import { foldU32 } from '../hash';
import { packTyped, unpackInto } from '../save/pack';
import type { Rng } from '../rng';
import type { Traffic } from '../ops/traffic';

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
} as const;

/** Timer wheel buckets and the tick step between bucket visits. */
const WHEEL = 4096;
const STEP = 5;
/** Ticks a due cohort waits again until its journey step is written. */
const RETRY_TICKS = 100;
const RECIPE_RANGE = 4294967296;
const PERCENT = 100;

const PROFILE_ROWS = PROFILE_KEYS.map((k) => PROFILES.profiles[k]);
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
  readonly flBoarded: Int32Array;
  readonly flGate: Int32Array;
  readonly flActive: Int32Array;
  private readonly rng: Rng;
  private readonly initialRng: number;
  private readonly business: Business;
  private readonly traffic: Traffic;
  private tick = 0;

  constructor(rng: Rng, business: Business, traffic: Traffic) {
    this.rng = rng.fork('cohorts');
    this.initialRng = this.rng.getState();
    this.business = business;
    this.traffic = traffic;
    this.flBoarded = new Int32Array(traffic.fState.length);
    this.flGate = new Int32Array(traffic.fState.length);
    this.flActive = new Int32Array(traffic.fState.length);
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
    while (remaining > 0) {
      const c = this.alloc();
      if (c < 0) break;
      const p = this.pickProfile(this.rng.next());
      const row = PROFILE_ROWS[p];
      const size = Math.min(remaining, this.rng.int(1, PROFILES.maxGroup));
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
      this.flags[c] = 0;
      this.node[c] = -1;
      this.stage[c] = Stage.Curb;
      this.schedule(c, curb);
      this.generated += size;
      this.active += size;
      this.flActive[f] += size;
      remaining -= size;
    }
  }

  /** The flight leaves the stand: the passengers still in the terminal miss it. Those in a queue wait for their done event. */
  onPushback(f: number): void {
    for (let c = 0; c < this.hi; c++) {
      const st = this.stage[c];
      if (this.flight[c] !== f || st < Stage.Curb || st > Stage.Gate) continue;
      const n = this.size[c];
      this.missed += n;
      this.active -= n;
      if (st === Stage.CheckIn || st === Stage.Security || st === Stage.Gate) {
        this.stage[c] = Stage.Missed;
      } else {
        this.unlink(c);
        this.free(c);
      }
    }
    this.flActive[f] = 0;
    this.flGate[f] = 0;
  }

  /** True when no passenger of the flight is at a gate desk or on the way to one. */
  boardingReady(f: number): boolean {
    return this.flGate[f] === 0;
  }

  /** Passengers of the flight that have boarded so far. */
  boardedFor(f: number): number {
    return this.flBoarded[f];
  }

  /** Runs the cohorts due at this tick. The wheel is visited every STEP ticks. */
  update(tick: number): void {
    this.tick = tick;
    if (tick % STEP !== 0) return;
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

  /** Journey steps are written in a later slice. Until then a due cohort waits again, so none is lost. */
  private step(c: number): void {
    this.schedule(c, this.tick + RETRY_TICKS);
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
    };
  }

  saveState(): CohortsSave {
    const arrays: Record<string, string> = {};
    const slots = this.slotArrays();
    for (const k of Object.keys(slots)) arrays[k] = packTyped(slots[k].subarray(0, this.hi));
    arrays.wheelHead = packTyped(this.wheelHead);
    arrays.flBoarded = packTyped(this.flBoarded);
    arrays.flGate = packTyped(this.flGate);
    arrays.flActive = packTyped(this.flActive);
    return {
      generated: this.generated, boarded: this.boarded, missed: this.missed, active: this.active,
      hi: this.hi, freeHead: this.freeHead, rng: this.rng.getState(), arrays,
    };
  }

  /** Restores the store from a save. `undefined` (a save from before cohorts) gives an empty store. */
  loadState(s: CohortsSave | undefined): void {
    if (!s) {
      this.generated = 0;
      this.boarded = 0;
      this.missed = 0;
      this.active = 0;
      this.hi = 0;
      this.freeHead = -1;
      this.rng.setState(this.initialRng);
      this.wheelHead.fill(-1);
      this.flBoarded.fill(0);
      this.flGate.fill(0);
      this.flActive.fill(0);
      return;
    }
    this.generated = s.generated;
    this.boarded = s.boarded;
    this.missed = s.missed;
    this.active = s.active;
    this.hi = s.hi;
    this.freeHead = s.freeHead;
    this.rng.setState(s.rng);
    const slots = this.slotArrays();
    for (const k of Object.keys(slots)) {
      const a = slots[k];
      if (s.arrays[k] !== undefined) unpackInto(s.arrays[k], a, a.constructor as SlotCtor);
    }
    unpackInto(s.arrays.wheelHead, this.wheelHead, Int32Array);
    unpackInto(s.arrays.flBoarded, this.flBoarded, Int32Array);
    unpackInto(s.arrays.flGate, this.flGate, Int32Array);
    unpackInto(s.arrays.flActive, this.flActive, Int32Array);
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
    }
    return acc;
  }
}
