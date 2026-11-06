import { ParcelType, START_CASH } from '@shared/site';
import type { BuildContext } from '@shared/validate';
import { checkRunwayObstacles } from '@shared/obstacles';
import type { GameOptions } from '@shared/protocol';
import { Gse, MAX_VEHICLES } from './vehicles/gse';
import { SnapHeader, SNAPSHOT_VERSION, type SnapshotViews } from '@shared/snapshot';
import { TICK_SECONDS } from '@shared/time';
import { CommandLog, type Command } from './commands';
import { Airfield, isProblem } from './airfield/airfield';
import { FlState, Traffic } from './ops/traffic';
import { Business } from './business/business';
import { ATC_MIN_CELLS, type LedgerCategory, type TerminalGrid } from '@shared/business';
import { generateSite, type SiteSpec } from './world/site';
import { foldInts, foldU32, HASH_INIT } from './hash';
import { Rng } from './rng';
import { packTyped, unpackInto } from './save/pack';
import { migrate, SAVE_VERSION, type SaveData } from './save/migrations';

/** Subsystems in execution order. The stress tool times each one separately. */
const SUBSYSTEMS = ['commands', 'clock', 'network', 'business', 'flights', 'aircraft', 'vehicles'] as const;
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
  readonly business: Business;
  readonly gse: Gse;
  private businessSent = -1;
  private gridsSent = -1;
  private businessSentTick = -1000000;
  private airfieldSent = -1;
  private obstaclesSent = -1;
  private towersSent = -1;
  private networkVersion = -1;
  /** Bumped whenever the player buys land, which clears the cover on it. */
  private ownerVersion = 0;
  /** Airfield, terminal and ownership versions last looked at, and the inputs the results are for. */
  private readonly obstacleSeen = [-1, -1, -1];
  private obstacleKey = '';
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
    // The business keeps the ledger, so every cash change goes through `book`.
    this.traffic = new Traffic({ windFreq: this.site.wind.freq, windMeanKt: this.site.wind.meanKt, climate: this.site.climate, idealHeadingDeg: this.site.idealHeadingDeg }, this.rng, (code) => this.eventQueue.push(code));
    const host = {
      getCash: (): number => this.cash,
      book: (category: LedgerCategory, amount: number): void => this.book(category, amount),
      emit: (code: string): void => {
        this.eventQueue.push(code);
      },
    };
    this.gse = new Gse(this.traffic);
    this.business = new Business(this.site, this.rng, host, this.traffic, this.airfield);
    this.traffic.hooks = { ...(this.traffic.hooks ?? { docked: () => undefined, pushback: () => undefined, departed: () => undefined }), contactOk: (x, y) => this.business.hasTerminalNear(x, y) };
  }

  /** Changes cash and records it in today's ledger. */
  book(category: LedgerCategory, amount: number): void {
    this.cash += amount;
    this.business.record(category, amount);
    this.ownershipDirty = true;
  }

  get subsystemCount(): number {
    return SUBSYSTEMS.length;
  }

  subsystemName(index: number): SubsystemName {
    return SUBSYSTEMS[index];
  }

  get standsFree(): number {
    return this.traffic.standsFree;
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
        this.airfield.update(this.tick);
        this.updateObstacles();
        if (this.networkVersion !== this.airfield.version) {
          this.networkVersion = this.airfield.version;
          this.traffic.setAirfield(this.airfield.data);
        }
        break;
      case 3:
        this.business.update(this.tick);
        break;
      case 4:
        if (this.tick % 10 === 0) this.traffic.updateFlights(this.tick);
        break;
      case 5:
        this.traffic.update(this.tick);
        break;
      case 6:
        this.gse.update();
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
      case 'terminalBuild':
        this.report(this.business.terminalBuild(cmd.building, cmd.ox, cmd.oy, cmd.headingDeg, cmd.edit, this.buildContext()));
        break;
      case 'demolishTerminal':
        this.report(this.business.demolishTerminal(cmd.id));
        break;
      case 'signAirline':
        this.report(this.business.signAirline(cmd.airlineId, cmd.rotations));
        break;
      case 'assignStand':
        if (this.traffic.fState[cmd.flight] === FlState.Scheduled) this.traffic.fStand[cmd.flight] = cmd.standId;
        break;
      case 'cancelFlight':
        if (this.traffic.fState[cmd.flight] === FlState.Scheduled) this.traffic.fState[cmd.flight] = FlState.Done;
        break;
      case 'setAutoStands':
        this.traffic.autoStands = cmd.on;
        this.business.version++;
        break;
      case 'autoAssignStands':
        this.traffic.autoAssign();
        break;
      case 'buyGse':
        this.report(this.business.buyGse(cmd.kind, cmd.count));
        break;
      case 'setSlot':
        this.business.setSlot(cmd.airlineId, cmd.index, cmd.minute);
        break;
      case 'setAirlineFee':
        this.business.setFee(cmd.airlineId, cmd.level);
        break;
      case 'takeLoan':
        this.report(this.business.takeLoan(cmd.amount));
        break;
      case 'repayLoan':
        this.report(this.business.repayLoan(cmd.amount));
        break;
      default: {
        const r = this.airfield.execute(cmd, this.buildContext(), this.cash, { tick: this.tick, assignedTypes: this.business.assignedTypes() });
        if (r === null) break;
        if (isProblem(r)) {
          let e = r.code;
          if (r.args) for (const k of Object.keys(r.args).sort()) e += `|${k}=${r.args[k]}`;
          this.eventQueue.push(e);
        } else if (r.cashDelta !== 0) {
          this.book('construction', r.cashDelta);
        }
        // A tower changes ATC coverage, so the sheet and the checklist refresh at once.
        if (!isProblem(r) && (cmd.type === 'buildTower' || cmd.type === 'upgradeTower' || cmd.type === 'demolishTower')) this.business.version++;
      }
    }
  }

  private report(problem: string | null): void {
    if (problem) this.eventQueue.push(problem);
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
    this.ownerVersion++;
    this.book('land', -total);
  }

  /** The business payload when it changed or ten game minutes passed, otherwise null. */
  takeBusiness(): ReturnType<Business['payload']> | null {
    if (this.business.version === this.businessSent && this.tick - this.businessSentTick < 6000) return null;
    this.businessSent = this.business.version;
    this.businessSentTick = this.tick;
    return this.business.payload(this.tick);
  }

  /** Copies of the terminal grids when they changed since the last call, otherwise null. */
  takeTerminalGrids(): TerminalGrid[] | null {
    if (this.business.terminalVersion === this.gridsSent) return null;
    this.gridsSent = this.business.terminalVersion;
    return this.business.grids.map((g) => ({
      ...g,
      floor: g.floor.slice(),
      zone: g.zone.slice(),
      fixture: g.fixture.slice(),
      hWall: g.hWall.slice(),
      vWall: g.vWall.slice(),
      leased: g.leased.slice(),
    }));
  }

  /** True once per airfield change. */
  takeAirfieldDirty(): boolean {
    if (this.airfield.version === this.airfieldSent && this.airfield.obstaclesVersion === this.obstaclesSent && this.airfield.towersVersion === this.towersSent) return false;
    this.airfieldSent = this.airfield.version;
    this.obstaclesSent = this.airfield.obstaclesVersion;
    this.towersSent = this.airfield.towersVersion;
    return true;
  }

  /**
   * Works out the obstacle surfaces again after the airfield, a terminal or the land owned changed.
   * The results go to the traffic directly, so they never rebuild the taxi network.
   */
  private updateObstacles(): void {
    if (this.airfield.version === this.obstacleSeen[0] && this.business.terminalVersion === this.obstacleSeen[1] && this.ownerVersion === this.obstacleSeen[2]) return;
    this.obstacleSeen[0] = this.airfield.version;
    this.obstacleSeen[1] = this.business.terminalVersion;
    this.obstacleSeen[2] = this.ownerVersion;
    // Only runways, building outlines and land change the result, so most edits stop here.
    const runways = this.airfield.data.runways;
    const buildings = this.business.footprints();
    let key = `${this.ownerVersion}`;
    for (const r of runways) key += `|${r.id},${r.x1},${r.y1},${r.x2},${r.y2},${r.approach},${r.widthM}`;
    for (const b of buildings) for (const p of b) key += `|${p.x},${p.y}`;
    if (key === this.obstacleKey) return;
    this.obstacleKey = key;
    if (runways.length === 0 && (this.airfield.data.obstacles?.length ?? 0) === 0) return;
    const site = this.site;
    const input = { heights: site.heights, landClass: site.landClass, parcelId: site.parcelId, parcelOwner: this.parcelOwner, buildings };
    const list = runways.map((r) => checkRunwayObstacles(r, input));
    this.airfield.setObstacles(list);
    this.traffic.obstacles = list;
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
    this.book('land', -price);
    this.parcelOwner[id] = 1;
    this.ownerVersion++;
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

  /** The full game state as plain data. The site is not saved, the seed regenerates it. */
  serialize(): SaveData {
    return {
      version: SAVE_VERSION,
      seed: this.seed,
      options: this.options,
      tick: this.tick,
      gameSeconds: this.gameSeconds,
      cash: this.cash,
      rng: this.rng.getState(),
      parcelOwner: packTyped(this.parcelOwner),
      airfield: this.airfield.saveState(),
      traffic: this.traffic.saveState(),
      business: this.business.saveState(),
    };
  }

  /** Replaces the state of a fresh sim with saved state. The save is migrated to the current version first. */
  restore(raw: unknown): void {
    const save = migrate(raw);
    if (save.seed !== this.seed) throw new Error('Save belongs to a different seed');
    this.tick = save.tick;
    this.gameSeconds = save.gameSeconds;
    this.cash = save.cash;
    this.rng.setState(save.rng);
    unpackInto(save.parcelOwner, this.parcelOwner, Uint8Array);
    this.airfield.loadState(save.airfield);
    // Build the network for the loaded airfield, then put the traffic state on top of it.
    this.networkVersion = this.airfield.version;
    this.traffic.setAirfield(this.airfield.data);
    this.traffic.loadState(save.traffic);
    this.business.loadState(save.business);
    // A save from before the tower that relied on a control room has no coverage now (handoff/tasks/T40-atc-tower.md R3).
    if (this.business.atcCells >= ATC_MIN_CELLS && (this.airfield.data.towers?.length ?? 0) === 0) this.eventQueue.push('atcLost');
    this.ownershipDirty = true;
    this.airfieldSent = -1;
    this.obstaclesSent = -1;
    this.towersSent = -1;
    this.obstacleKey = '';
    this.obstacleSeen.fill(-1);
    this.updateObstacles();
    this.businessSent = -1;
    this.gridsSent = -1;
    this.pending.length = 0;
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
    h = this.business.hash(h);
    return h;
  }

  /** Writes the current state into a snapshot buffer's views. */
  // hot
  writeSnapshot(views: SnapshotViews): void {
    views.header[SnapHeader.Version] = SNAPSHOT_VERSION;
    views.header[SnapHeader.Tick] = this.tick;
    this.traffic.writeSnapshot(views);
    const g = this.gse;
    let n = 0;
    for (let v = 0; v < MAX_VEHICLES; v++) {
      if (g.active[v] === 0) continue;
      views.vehicleId[n] = v;
      views.vehicleX[n] = g.x[v];
      views.vehicleY[n] = g.y[v];
      views.vehicleHeading[n] = g.heading[v];
      views.vehicleKind[n] = g.kind[v];
      n++;
    }
    views.header[SnapHeader.VehicleCount] = n;
  }
}
