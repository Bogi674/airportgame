import { ParcelType, START_CASH } from '@shared/site';
import type { BuildContext } from '@shared/validate';
import type { GameOptions } from '@shared/protocol';
import { SnapHeader, SNAPSHOT_VERSION, type SnapshotViews } from '@shared/snapshot';
import { TICK_SECONDS } from '@shared/time';
import { CommandLog, type Command } from './commands';
import { Airfield, isProblem } from './airfield/airfield';
import { Traffic } from './ops/traffic';
import { generateSite, type SiteSpec } from './world/site';
import { foldInts, foldU32, HASH_INIT } from './hash';
import { Rng } from './rng';

/** Subsystems in execution order. The stress tool times each one separately. */
const SUBSYSTEMS = ['commands', 'clock', 'network', 'flights', 'aircraft'] as const;
export type SubsystemName = (typeof SUBSYSTEMS)[number];

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
  private airfieldSent = -1;
  private networkVersion = -1;
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
    this.traffic = new Traffic({ windFreq: this.site.wind.freq, windMeanKt: this.site.wind.meanKt, climate: this.site.climate }, this.rng, (code) => this.eventQueue.push(code));
  }

  get subsystemCount(): number {
    return SUBSYSTEMS.length;
  }

  subsystemName(index: number): SubsystemName {
    return SUBSYSTEMS[index];
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
        if (this.networkVersion !== this.airfield.version) {
          this.networkVersion = this.airfield.version;
          this.traffic.setAirfield(this.airfield.data);
        }
        break;
      case 3:
        if (this.tick % 10 === 0) this.traffic.updateFlights(this.tick);
        break;
      case 4:
        this.traffic.update(this.tick);
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

  /** Applies a command to state. */
  apply(cmd: Command): void {
    switch (cmd.type) {
      case 'setTestTraffic':
        this.traffic.setTestTraffic(cmd.perHour, cmd.turnScale);
        break;
      case 'testArrival':
        this.traffic.scheduleArrival(cmd.typeIdx, this.tick + Math.max(0, cmd.inTicks), 0, cmd.turnTicks);
        break;
      case 'buyParcel':
        this.buyParcel(cmd.parcelId);
        break;
      case 'buyParcels':
        this.buyParcels(cmd.ids);
        break;
      default: {
        const r = this.airfield.execute(cmd, this.buildContext(), this.cash);
        if (r === null) break;
        if (isProblem(r)) {
          let e = r.code;
          if (r.args) for (const k of Object.keys(r.args).sort()) e += `|${k}=${r.args[k]}`;
          this.eventQueue.push(e);
        } else if (r.cashDelta !== 0) {
          this.cash += r.cashDelta;
          this.ownershipDirty = true;
        }
      }
    }
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
    this.cash -= total;
    this.ownershipDirty = true;
  }

  /** True once per airfield change. */
  takeAirfieldDirty(): boolean {
    if (this.airfield.version === this.airfieldSent) return false;
    this.airfieldSent = this.airfield.version;
    return true;
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
    this.cash -= price;
    this.parcelOwner[id] = 1;
    this.ownershipDirty = true;
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

  /** 32 bit hash of the state that matters, for determinism tests. */
  stateHash(): number {
    let h = HASH_INIT;
    h = foldU32(h, this.tick);
    h = foldU32(h, this.rng.getState());
    h = foldInts(h, this.parcelOwner, this.parcelOwner.length);
    h = foldU32(h, Math.floor(this.cash));
    h = this.airfield.hash(h);
    h = this.traffic.hash(h);
    return h;
  }

  /** Writes the current state into a snapshot buffer's views. */
  // hot
  writeSnapshot(views: SnapshotViews): void {
    views.header[SnapHeader.Version] = SNAPSHOT_VERSION;
    views.header[SnapHeader.Tick] = this.tick;
    this.traffic.writeSnapshot(views);
  }
}
