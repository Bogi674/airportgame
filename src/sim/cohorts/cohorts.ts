import { PROFILES } from '@data/index';
import { PROFILE_KEYS } from '@data/schemas/profiles';
import { FIXTURE_KEYS, TERMINAL_CELL_M, TICKS_PER_MINUTE } from '@shared/business';
import type { Business } from '../business/business';
import { foldU32 } from '../hash';
import { packTyped, unpackInto } from '../save/pack';
import type { Rng } from '../rng';
import { FlState, type Traffic } from '../ops/traffic';
import type { ServiceNodes } from '../terminal/serviceNodes';
import { SNAPSHOT_PEOPLE_CAPACITY, SnapHeader, type SnapshotViews } from '@shared/snapshot';
import { cosLut, sinLut } from '@shared/trig';

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
/** Ticks a cohort waits before it tries a step again when no service node or path is free. */
const RETRY_TICKS = 100;
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
const SECURITY = FIXTURE_KEYS.indexOf('security') + 1;
const GATE_DESK = FIXTURE_KEYS.indexOf('gateDesk') + 1;

const PROFILE_ROWS = PROFILE_KEYS.map((k) => PROFILES.profiles[k]);
/** Walk speed in metres per second, by profile id. */
const WALK_SPEED = Float32Array.from(PROFILE_ROWS, (r) => r.walkSpeed);
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
  /** The business service version the queued cohorts were last checked against. */
  private seenVersion: number;

  constructor(rng: Rng, business: Business, traffic: Traffic) {
    this.rng = rng.fork('cohorts');
    this.initialRng = this.rng.getState();
    this.business = business;
    this.traffic = traffic;
    this.flBoarded = new Int32Array(traffic.fState.length);
    this.flGate = new Int32Array(traffic.fState.length);
    this.flActive = new Int32Array(traffic.fState.length);
    this.seenVersion = business.serviceVersion;
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
      if (st === Stage.Missed) {
        this.free(c);
        continue;
      }
      if (st < Stage.Curb || st > Stage.Gate) continue;
      const f = this.flight[c];
      const n = this.size[c];
      this.missed += n;
      this.active -= n;
      this.flActive[f] -= n;
      if (st === Stage.ToGate || st === Stage.Gate) this.flGate[f] -= n;
      // Queued passengers are not on the wheel, the rest are.
      if (st !== Stage.CheckIn && st !== Stage.Security && st !== Stage.Gate) this.unlink(c);
      this.free(c);
    }
  }

  /**
   * Writes a sample of the live cohorts' positions for the renderer: the centre of the service node each one is at
   * or walking to. A stride keeps the sample under the cap. Reads only, the sim state does not change, and nothing is allocated.
   */
  writeSample(views: SnapshotViews): void {
    const cap = Math.min(PROFILES.sampleCap, SNAPSHOT_PEOPLE_CAPACITY);
    let live = 0;
    for (let c = 0; c < this.hi; c++) if (this.stage[c] !== Stage.Free) live++;
    const stride = Math.max(1, Math.ceil(live / cap));
    let n = 0;
    for (let g = 0; g < this.business.grids.length && n < cap; g++) {
      const t = this.table(g);
      if (!t) continue;
      const grid = this.business.grids[g]!;
      // Axes of the grid, as terminalOps gridAxes gives them. Constant per grid, so computed once here.
      const a = grid.headingDeg * DEG;
      const ux = sinLut(a);
      const uy = -cosLut(a);
      const vx = -uy;
      const vy = ux;
      for (let c = 0; c < this.hi && n < cap; c += stride) {
        if (this.building[c] !== g) continue;
        const st = this.stage[c];
        if (st === Stage.Free || st === Stage.Curb || st === Stage.Missed) continue;
        const k = this.node[c]!;
        if (k < 0 || k >= t.count) continue;
        // Half a cell past the anchor corner is the centre of the node's cell, 1 m on each axis.
        const cx = t.lx[k]! + 0.5;
        const cy = t.ly[k]! + 0.5;
        views.peopleX[n] = grid.ox + (ux * cx + vx * cy) * TERMINAL_CELL_M;
        views.peopleY[n] = grid.oy + (uy * cx + vy * cy) * TERMINAL_CELL_M;
        views.peopleProfile[n] = this.profile[c]!;
        views.peopleSize[n] = this.size[c]!;
        n++;
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
    for (let c = 0; c < this.hi; c++) {
      const st = this.stage[c];
      if (st === Stage.ToCheckIn || st === Stage.ToSecurity || st === Stage.Airside || st === Stage.ToGate) this.node[c] = -1;
    }
    this.seenVersion = this.business.serviceVersion;
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
    else return;
    this.node[c] = -1;
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
        if (st !== Stage.CheckIn && st !== Stage.Security && st !== Stage.Gate && st !== Stage.Missed) continue;
        // Node indices can renumber after an edit, so the done node is the one to trust.
        this.node[c] = t.doneNode[k];
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
    if (st === Stage.Security) {
      this.stage[c] = Stage.Airside;
      this.schedule(c, this.tick + STEP);
      return;
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
        this.toGate(g, c);
        break;
    }
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
    if (this.business.serviceJoin(this.gridId(g), this.node[c], c, this.size[c])) this.stage[c] = queued;
    else this.schedule(c, this.tick + JOIN_RETRY_TICKS);
  }

  /** Airside passengers walk to a gate desk once the flight is on the ground. The flight's gate count rises only on the first walk. */
  private toGate(g: number, c: number): void {
    const f = this.flight[c];
    const from = this.originWalk(g, c);
    const n = this.traffic.fState[f] === FlState.OnGround ? this.pickNode(g, GATE_DESK, GATE_DESK, from, c) : -1;
    if (n < 0) {
      this.schedule(c, this.tick + RETRY_TICKS);
      return;
    }
    this.flGate[f] += this.size[c];
    this.walk(g, c, n, from, Stage.ToGate);
  }

  /** Walk node a cohort leaves from: its service node when it has one, otherwise the curb. */
  private originWalk(g: number, c: number): number {
    const t = this.node[c] >= 0 ? this.table(g) : null;
    if (t) return t.walkNode[this.node[c]];
    return this.business.curbNode(g);
  }

  /** Cheapest node of a grid with one of two fixture kinds and queue room, by walk time plus wait. -1 when none. */
  private pickNode(g: number, kindA: number, kindB: number, fromWalk: number, c: number): number {
    const t = this.table(g);
    if (!t) return -1;
    const id = this.gridId(g);
    const speed = WALK_SPEED[this.profile[c]];
    let best = -1;
    let bestCost = Infinity;
    // Ascending scan with a strict comparison, so ties go to the lowest index and an infinite cost never wins.
    for (let n = 0; n < t.count; n++) {
      const k = t.kind[n];
      if ((k !== kindA && k !== kindB) || t.queueCap[n] <= 0) continue;
      const cost = this.business.walkDistance(id, fromWalk, t.walkNode[n]) / speed + this.business.serviceWait(id, n, this.tick);
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
    const to = t ? t.walkNode[node] : -1;
    const dist = this.business.walkDistance(this.gridId(g), from, to);
    this.schedule(c, this.tick + Math.max(STEP, Math.ceil((dist / WALK_SPEED[this.profile[c]]) * TICKS_PER_SECOND)));
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
    const slots = this.slotArrays();
    for (const k of Object.keys(slots)) {
      const a = slots[k];
      if (s.arrays[k] !== undefined) unpackInto(s.arrays[k], a, a.constructor as SlotCtor);
    }
    unpackInto(s.arrays.wheelHead, this.wheelHead, Int32Array);
    unpackInto(s.arrays.flBoarded, this.flBoarded, Int32Array);
    unpackInto(s.arrays.flGate, this.flGate, Int32Array);
    unpackInto(s.arrays.flActive, this.flActive, Int32Array);
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
    }
    return acc;
  }
}
