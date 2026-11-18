import { GSE_INDEX, STAND_ACCESS, TURNAROUNDS } from '@data/index';
import { STAND_UPGRADE } from '@shared/airfield';
import { CAUSE_BAGS, VEHICLE_CAUSE } from '@shared/turnaround';
import { foldInts } from '../hash';
import { packTyped, unpackInto } from '../save/pack';
import { AcState, MAX_AIRCRAFT, type Traffic } from './traffic';

/** Task list from data, with each task's kind and prerequisites resolved to indexes. */
const TASKS = TURNAROUNDS.tasks;
const N = TASKS.length;
const KIND = TASKS.map((t) => (t.kind === null ? -1 : (GSE_INDEX[t.kind] ?? -1)));
const AFTER = TASKS.map((t) => t.after.map((id) => TASKS.findIndex((o) => o.id === id)));
const CLEAN = TASKS.findIndex((t) => t.id === 'clean');
const LOAD = TASKS.findIndex((t) => t.id === 'load');
const UNLOAD = TASKS.findIndex((t) => t.id === 'unload');
const FUEL = TASKS.findIndex((t) => t.id === 'fuel');
const POWER = TASKS.findIndex((t) => t.id === 'power');
const DISPENSER = GSE_INDEX.dispenser;

const BOARD = TASKS.findIndex((t) => t.id === 'board');
const BUS = GSE_INDEX.bus;

/** How an aircraft's stand boards: on foot, by bus from a far stand with a bus bay, or on foot but slowly from a far stand without one. */
export const BOARDING = { near: 0, bus: 1, farSlow: 2 } as const;

/** Vehicle kind of a task at a stand with the given upgrades, -1 for none: a hydrant pit fuels by dispenser, fixed power needs no GPU. */
function kindFor(k: number, upgrades: number): number {
  if (k === FUEL && (upgrades & STAND_UPGRADE.hydrantPit) !== 0) return DISPENSER;
  if (k === POWER && (upgrades & STAND_UPGRADE.fixedPower) !== 0) return -1;
  return KIND[k];
}

/** The turnaround engine runs every this many ticks (docs/ARCHITECTURE.md section 2 cadences). */
export const TURN_STEP = 10;

const Waiting = 0;
const NeedsVehicle = 1;
const Running = 2;
const Done = 3;

/** What the engine reads from the vehicles. */
export interface TurnVehicles {
  /** One bit per vehicle kind docked at the aircraft. */
  readonly dockedMask: Uint32Array;
  /** True when the type's crew has a vehicle of the kind at all. */
  crewHas(type: number, kind: number): boolean;
  /** `STAND_UPGRADE` bits of the stand the aircraft occupies, 0 when none. */
  upgradesOf(a: number): number;
  /** `BOARDING` mode of the stand the aircraft occupies. */
  boardingOf(a: number): number;
  /** Vehicles of a kind the airport owns. */
  owned(kind: number): number;
}

/**
 * Turnaround task lists of airline flights (T63, docs/DESIGN_REVISION_4.md section 4). At docking each task gets
 * its share of the planned turnaround. A task starts once its prerequisites are done and, for a vehicle task, once
 * that vehicle is docked; while the vehicle is missing the task waits and its kind is the flight's delay cause.
 */
export class Turnarounds {
  /** Flight each aircraft slot's task list belongs to, or -1. */
  readonly flightOf = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly phase = new Uint8Array(MAX_AIRCRAFT * N);
  readonly left = new Int32Array(MAX_AIRCRAFT * N);
  /** 1 once every vehicle task of the aircraft is done, so its crew may leave. */
  readonly vehDone = new Uint8Array(MAX_AIRCRAFT);
  /** 1 once every task is done. */
  readonly done = new Uint8Array(MAX_AIRCRAFT);
  /** Delay cause of the vehicle kind waited on most recently, 0 for none. */
  readonly lastBlock = new Int32Array(MAX_AIRCRAFT);
  /** Called once per turnaround when cleaning ends; the business tells whether a cleaning depot did it. */
  cleaned: (() => void) | null = null;
  /** Asked with the flight before the load task starts; false holds it and names the bags as the delay cause (T43). */
  bagsReady: ((f: number) => boolean) | null = null;
  /** Called with the flight once its load task is done, so the bags still in the baggage system are settled (T43). */
  loaded: ((f: number) => void) | null = null;
  /** Called with the flight once its unload task is done, so its arriving bags enter the bay (T43). */
  unloaded: ((f: number) => void) | null = null;

  constructor(
    private readonly traffic: Traffic,
    private readonly vehicles: TurnVehicles,
  ) {}

  static get taskCount(): number {
    return N;
  }

  // hot
  update(): void {
    const t = this.traffic;
    for (let i = 0; i < MAX_AIRCRAFT; i++) {
      const f = t.flight[i];
      if (t.active[i] === 0 || t.state[i] !== AcState.Turnaround || t.tasked[i] === 0 || f < 0) {
        if (this.flightOf[i] !== -1) this.flightOf[i] = -1;
        continue;
      }
      if (this.flightOf[i] !== f) this.start(i, f);
      this.step(i);
    }
  }

  private start(i: number, f: number): void {
    this.flightOf[i] = f;
    this.vehDone[i] = 0;
    this.done[i] = 0;
    this.lastBlock[i] = 0;
    const plan = this.traffic.timer[i];
    for (let k = 0; k < N; k++) {
      this.phase[i * N + k] = Waiting;
      this.left[i * N + k] = Math.round(TASKS[k].share * plan);
    }
    if (this.vehicles.boardingOf(i) === BOARDING.farSlow) this.left[i * N + BOARD] = Math.round(TASKS[BOARD].share * (1 + STAND_ACCESS.farBoardingSlowdown) * plan);
  }

  private step(i: number): void {
    const type = this.traffic.type[i];
    const docked = this.vehicles.dockedMask[i];
    const upgrades = this.vehicles.upgradesOf(i);
    const bus = this.phase[i * N + BOARD] < Running && this.vehicles.boardingOf(i) === BOARDING.bus;
    let allDone = 1;
    let vehDone = 1;
    for (let k = 0; k < N; k++) {
      const p = i * N + k;
      const kind = kindFor(k, upgrades);
      // Boarding by bus needs a bus the airport owns, but the bus never docks and does not hold the crew.
      const busTask = bus && k === BOARD;
      let ph = this.phase[p];
      if (ph === Waiting) {
        let ready = true;
        for (const d of AFTER[k]) if (this.phase[i * N + d] !== Done) ready = false;
        if (ready && k === LOAD && this.bagsReady !== null && !this.bagsReady(this.flightOf[i])) {
          ready = false;
          this.lastBlock[i] = CAUSE_BAGS;
        }
        if (ready) ph = busTask || (kind >= 0 && this.vehicles.crewHas(type, kind)) ? NeedsVehicle : Running;
      }
      if (ph === NeedsVehicle) {
        if (busTask ? this.vehicles.owned(BUS) > 0 : kind < 0 || (docked & (1 << kind)) !== 0) ph = Running;
        else this.lastBlock[i] = VEHICLE_CAUSE + (busTask ? BUS : kind);
      }
      if (ph === Running) {
        this.left[p] -= TURN_STEP;
        if (this.left[p] <= 0) {
          ph = Done;
          if (k === CLEAN && this.cleaned) this.cleaned();
          if (k === LOAD && this.loaded) this.loaded(this.flightOf[i]);
          if (k === UNLOAD && this.unloaded) this.unloaded(this.flightOf[i]);
        }
      }
      this.phase[p] = ph;
      if (ph !== Done) {
        allDone = 0;
        if (kind >= 0) vehDone = 0;
      }
    }
    this.vehDone[i] = vehDone;
    this.done[i] = allDone;
  }

  /** The cause of a vehicle task waiting now, else the last one waited on, else 0. */
  blocker(i: number): number {
    const upgrades = this.vehicles.upgradesOf(i);
    for (let k = 0; k < N; k++) {
      if (this.phase[i * N + k] !== NeedsVehicle) continue;
      return VEHICLE_CAUSE + (k === BOARD ? BUS : kindFor(k, upgrades));
    }
    return this.lastBlock[i];
  }

  /** Task phases of one aircraft for the inspector: 0 waiting, 1 needs its vehicle, 2 running, 3 done. */
  phasesOf(i: number, out: number[]): void {
    out.length = 0;
    for (let k = 0; k < N; k++) out.push(this.flightOf[i] >= 0 ? this.phase[i * N + k] : Waiting);
  }

  private arrays(): Record<string, Int32Array | Uint8Array> {
    return { flightOf: this.flightOf, phase: this.phase, left: this.left, vehDone: this.vehDone, done: this.done, lastBlock: this.lastBlock };
  }

  saveState(): unknown {
    const out: Record<string, string> = {};
    const src = this.arrays();
    for (const k of Object.keys(src)) out[k] = packTyped(src[k]);
    return { tasks: N, arrays: out };
  }

  /** Restores the task state. A save with another task count starts every list over at its next step. */
  loadState(raw: unknown): void {
    this.flightOf.fill(-1);
    const o = raw as { tasks?: number; arrays?: Record<string, string> } | undefined;
    if (!o?.arrays || o.tasks !== N) return;
    const dst = this.arrays();
    for (const k of Object.keys(dst)) {
      const a = dst[k];
      if (o.arrays[k] !== undefined) unpackInto(o.arrays[k], a as never, a.constructor as never);
    }
  }

  hash(h: number): number {
    let acc = foldInts(h, this.flightOf, MAX_AIRCRAFT);
    acc = foldInts(acc, this.phase, this.phase.length);
    acc = foldInts(acc, this.left, this.left.length);
    return acc;
  }
}
