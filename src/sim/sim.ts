import { SITE_SIZE_M } from '@shared/math';
import type { GameOptions } from '@shared/protocol';
import { SnapHeader, SNAPSHOT_AIRCRAFT_CAPACITY, SNAPSHOT_VERSION, type SnapshotViews } from '@shared/snapshot';
import { TICK_SECONDS } from '@shared/time';
import { cosLut, sinLut } from '@shared/trig';
import { CommandLog, type Command } from './commands';
import { foldF64, foldInts, foldU32, HASH_INIT } from './hash';
import { Rng } from './rng';

export const AIRCRAFT_CAPACITY = SNAPSHOT_AIRCRAFT_CAPACITY;

/** Subsystems in execution order. The stress tool times each one separately. */
const SUBSYSTEMS = ['commands', 'clock', 'aircraft'] as const;
export type SubsystemName = (typeof SUBSYSTEMS)[number];

/**
 * The simulation core. Pure TypeScript with no DOM and no wall clock, so the same seed
 * and the same commands always give the same result. In M0 the only entities are test
 * aircraft that fly straight and wrap around the site, which exercises the loop,
 * snapshots and replay before real systems exist.
 */
export class Sim {
  readonly seed: string;
  readonly options: GameOptions;
  readonly log = new CommandLog();
  readonly rng: Rng;

  tick = 0;
  /** Game seconds since start. Integer ticks times TICK_SECONDS, kept as a sum for exactness checks. */
  gameSeconds = 0;

  // Aircraft struct of arrays with a free list and an active index list.
  readonly aircraftActive = new Uint8Array(AIRCRAFT_CAPACITY);
  readonly aircraftX = new Float64Array(AIRCRAFT_CAPACITY);
  readonly aircraftY = new Float64Array(AIRCRAFT_CAPACITY);
  readonly aircraftHeading = new Float64Array(AIRCRAFT_CAPACITY);
  readonly aircraftSpeed = new Float64Array(AIRCRAFT_CAPACITY);
  aircraftCount = 0;
  private readonly aircraftFree = new Int32Array(AIRCRAFT_CAPACITY);
  private aircraftFreeTop = 0;
  private readonly aircraftIndexList = new Int32Array(AIRCRAFT_CAPACITY);

  private readonly aircraftRng: Rng;
  private readonly pending: Command[] = [];
  private readonly bitsX: Uint32Array;
  private readonly bitsY: Uint32Array;
  private readonly bitsHeading: Uint32Array;
  private readonly bitsSpeed: Uint32Array;

  constructor(seed: string, options: GameOptions) {
    this.seed = seed;
    this.options = options;
    this.rng = Rng.fromString(seed);
    this.aircraftRng = this.rng.fork('aircraft');
    for (let i = 0; i < AIRCRAFT_CAPACITY; i++) {
      this.aircraftFree[i] = AIRCRAFT_CAPACITY - 1 - i;
    }
    this.aircraftFreeTop = AIRCRAFT_CAPACITY;
    this.bitsX = new Uint32Array(this.aircraftX.buffer);
    this.bitsY = new Uint32Array(this.aircraftY.buffer);
    this.bitsHeading = new Uint32Array(this.aircraftHeading.buffer);
    this.bitsSpeed = new Uint32Array(this.aircraftSpeed.buffer);
  }

  get subsystemCount(): number {
    return SUBSYSTEMS.length;
  }

  subsystemName(index: number): SubsystemName {
    return SUBSYSTEMS[index];
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
        this.updateAircraft();
        break;
    }
  }

  /**
   * Applies queued commands without advancing time, so builds work while paused. They are
   * logged at the current tick and replay applies them at the start of that same tick.
   */
  flushCommands(): void {
    this.applyPending();
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

  /** Applies a command to state. Also used by replay for commands logged at this tick. */
  apply(cmd: Command): void {
    switch (cmd.type) {
      case 'spawnTestAircraft':
        this.spawnAircraft(cmd.x, cmd.y, cmd.heading, cmd.speed);
        break;
      case 'clearTestAircraft':
        this.clearAircraft();
        break;
    }
  }

  private spawnAircraft(x: number, y: number, heading: number, speed: number): void {
    if (this.aircraftFreeTop === 0) return;
    const id = this.aircraftFree[--this.aircraftFreeTop];
    this.aircraftActive[id] = 1;
    this.aircraftX[id] = x;
    this.aircraftY[id] = y;
    this.aircraftHeading[id] = heading;
    // A little per aircraft variation from the aircraft stream keeps the RNG in the hash.
    this.aircraftSpeed[id] = speed * (0.9 + 0.2 * this.aircraftRng.next());
    this.rebuildAircraftIndex();
  }

  private clearAircraft(): void {
    this.aircraftActive.fill(0);
    for (let i = 0; i < AIRCRAFT_CAPACITY; i++) this.aircraftFree[i] = AIRCRAFT_CAPACITY - 1 - i;
    this.aircraftFreeTop = AIRCRAFT_CAPACITY;
    this.rebuildAircraftIndex();
  }

  /** Active index list, rebuilt only when aircraft are added or removed. */
  private rebuildAircraftIndex(): void {
    let n = 0;
    for (let i = 0; i < AIRCRAFT_CAPACITY; i++) {
      if (this.aircraftActive[i] === 1) this.aircraftIndexList[n++] = i;
    }
    this.aircraftCount = n;
  }

  // hot
  private updateAircraft(): void {
    const n = this.aircraftCount;
    const list = this.aircraftIndexList;
    const x = this.aircraftX;
    const y = this.aircraftY;
    const speed = this.aircraftSpeed;
    const heading = this.aircraftHeading;
    for (let k = 0; k < n; k++) {
      const i = list[k];
      const step = speed[i] * TICK_SECONDS;
      let nx = x[i] + cosLut(heading[i]) * step;
      let ny = y[i] + sinLut(heading[i]) * step;
      if (nx < 0) nx += SITE_SIZE_M;
      else if (nx >= SITE_SIZE_M) nx -= SITE_SIZE_M;
      if (ny < 0) ny += SITE_SIZE_M;
      else if (ny >= SITE_SIZE_M) ny -= SITE_SIZE_M;
      x[i] = nx;
      y[i] = ny;
    }
  }

  /** 32 bit hash of the state that matters, for determinism tests. */
  stateHash(): number {
    let h = HASH_INIT;
    h = foldU32(h, this.tick);
    h = foldU32(h, this.rng.getState());
    h = foldU32(h, this.aircraftRng.getState());
    h = foldInts(h, this.aircraftActive, AIRCRAFT_CAPACITY);
    h = foldF64(h, this.bitsX, AIRCRAFT_CAPACITY);
    h = foldF64(h, this.bitsY, AIRCRAFT_CAPACITY);
    h = foldF64(h, this.bitsHeading, AIRCRAFT_CAPACITY);
    h = foldF64(h, this.bitsSpeed, AIRCRAFT_CAPACITY);
    return h;
  }

  /** Writes the current state into a snapshot buffer's views. */
  // hot
  writeSnapshot(views: SnapshotViews): void {
    const n = this.aircraftCount;
    const list = this.aircraftIndexList;
    views.header[SnapHeader.Version] = SNAPSHOT_VERSION;
    views.header[SnapHeader.Tick] = this.tick;
    views.header[SnapHeader.AircraftCount] = n;
    for (let k = 0; k < n; k++) {
      const i = list[k];
      views.aircraftId[k] = i;
      views.aircraftX[k] = this.aircraftX[i];
      views.aircraftY[k] = this.aircraftY[i];
      views.aircraftHeading[k] = this.aircraftHeading[i];
      views.aircraftType[k] = 0;
      views.aircraftState[k] = 0;
      views.aircraftLivery[k] = 0;
    }
  }
}
