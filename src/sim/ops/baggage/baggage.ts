import { BAGGAGE, PROFILES } from '@data/index';
import { PROFILE_KEYS } from '@data/schemas/profiles';
import type { BayAnchor } from '@shared/airfield';
import { BAG_LINK_ARRIVAL, BAG_LINK_FLOW, BAG_NODE_BLOCKED, type BagOverlay } from '@shared/overlay';
import { FIXTURE_KEYS, FIXTURE_ZONES, TERMINAL_CELL_M, TICKS_PER_MINUTE, type BagWarningCode, type BaggageInfo, type BagNodeInfo, type FixtureKey, type TerminalGrid } from '@shared/business';
import { bagKey, bagNodeCost, bayFrame, bayRoadPoint, carouselSize, drawCenter, type BayFrame, dropOutCell, nodeCells, nodeSize, rampCell, screeningRoomOk, validateBagNode, type BagDrawNode, type BagNodeSpec } from '@shared/baggageNodes';
import { cellIndex } from '@shared/terminalOps';
import { CLOCK_SCALE, gameSecondsToTicks } from '@shared/time';
import { foldU32 } from '../../hash';
import { packTyped, unpackTyped } from '../../save/pack';
import type { Rng } from '../../rng';
import type { Business } from '../../business/business';
import { BaggageNetwork, type BagNode, type BagNodeKind, type BagWarning, type Cell, type LinkMode, type RouteResult } from './network';

/** One node as the player sees it. Drops follow the grid and have no spec, the others carry the spec they were placed with. */
export interface BagNodeRec {
  id: number;
  kind: BagNodeKind;
  building: number;
  spec: BagNodeSpec | null;
  /** Anchor cell for drops, spec origin otherwise. */
  cell: [number, number];
}

export interface BaggageHost {
  getCash(): number;
  /** Books a construction cash change, negative for a cost. */
  book(amount: number): void;
  standExists(standId: number): boolean;
  /** Stand id of the live flight with this serial, -1 when it has none yet and -2 when the flight is gone. */
  standOfSerial(serial: number): number;
  /** True when a depot reaches the bay's road connection point (T78). */
  bayConnected(bayId: number): boolean;
}

export interface PlaceBagNode {
  building: number;
  kind: 'machine' | 'bay' | 'carousel';
  cx: number;
  cy: number;
  rot: 0 | 1 | 2 | 3;
  widthCells: number;
}

export interface BaggageSave {
  nextId: number;
  nodes: BagNodeRec[];
  /** Stands served per bay id. */
  bayStands: { id: number; stands: number[] }[];
  links: { building: number; links: [number, number, LinkMode][] }[];
  /** Bag batches and counters, since save version 24. Missing in older saves, which start with no bags in flight. */
  flow?: BagFlowSave;
}

/** Batch arrays are packed up to the highest slot ever used. */
export interface BagFlowSave {
  hi: number;
  nextSeq: number;
  missingToday: number;
  checkedToday: number;
  loadedTotal: number;
  serial: string;
  count: string;
  stage: string;
  node: string;
  origin: string;
  ready: string;
  seq: string;
  screened: string;
  /** Screening tokens per machine id. */
  tokens: [number, number][];
  missNext: number;
  missSerial: string;
  missCount: string;
  /** Arrival bags, since the arrival slice. Older saves have none and start with zeros. */
  born?: string;
  claimedTotal?: number;
  claimWaitSumS?: number;
  claimFlights?: number;
  /** Per flight serial, the tick its first bags reached a carousel (T20). Absent in saves from before version 31. */
  deliSerial?: string;
  deliTick?: string;
  deliNext?: number;
}

/**
 * Batch store size. A batch holds the bags of one cohort, so even a busy terminal has far fewer in flight at once.
 * Bags beyond it count as missing at check in.
 */
const BATCH_CAP = 4096;
/** The baggage subsystem runs every this many ticks (docs/ARCHITECTURE.md section 3). */
export const BAG_RUN_TICKS = 10;
/** Game clock tenths of a second that pass between two runs, the unit of the machine token budget. */
const RUN_DECI = BAG_RUN_TICKS * CLOCK_SCALE;
const DECI_PER_SECOND = 10;
/** Rows of the per serial missing bag table. The oldest row is overwritten when it is full. */
const MISS_ROWS = 64;

/** Where a batch is. Free slots are 0. */
export const BagStage = { Free: 0, Drop: 1, ToMachine: 2, Queue: 3, ToBay: 4, Bay: 5, BayIn: 6, ToCarousel: 7, Carousel: 8, TrainOut: 9, TrainIn: 10 } as const;

/** True for the stages of arriving bags: on the train to the bay, in the bay, on the carousel link and on the carousel. */
const isArrival = (stage: number): boolean => (stage >= BagStage.BayIn && stage <= BagStage.Carousel) || stage === BagStage.TrainIn;

/** Bags per passenger of an arriving flight: the mean of the profile table weighted by the profile mix. */
const ARRIVAL_BAGS_PER_PAX = (() => {
  let weighted = 0;
  let mix = 0;
  for (const key of PROFILE_KEYS) {
    weighted += PROFILES.profiles[key].mix * PROFILES.profiles[key].bagsPerPax;
    mix += PROFILES.profiles[key].mix;
  }
  return mix > 0 ? weighted / mix : 0;
})();

/** Per machine and per bay state the tick keeps, in node id order. Rebuilt when the layout changes. */
interface NodeState {
  id: number;
  isMachine: boolean;
  /** Machine only: screening time banked toward the head batch, in game tenths of a second. */
  tok: number;
  /** Machine only: cached screeningRoomOk and the terminal version it was worked out for. */
  ok: boolean;
  okTerminal: number;
  /** Bags held now: queue bags for a machine, staged bags for a bay. Recounted every run. */
  held: number;
}

const KIND_INDEX: readonly BagNodeKind[] = ['drop', 'machine', 'bay', 'carousel'];
const keyId = (key: FixtureKey): number => FIXTURE_KEYS.indexOf(key) + 1;
const CHECK_IN_ID = keyId('checkIn');
const BELT_ID = keyId('belt');
/** Window of the Baggage load overlay in game minutes, and in ticks (docs/BAGGAGE.md 6.1, T78). */
const LOAD_WINDOW_MIN = 10;
const LOAD_WINDOW_TICKS = LOAD_WINDOW_MIN * TICKS_PER_MINUTE;
/** Node ids stay far below this, so src * LINK_KEY + dst names a link uniquely. */
const LINK_KEY = 1 << 20;
const BAG_DROP_ID = keyId('bagDrop');

interface Anchor {
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
}

/**
 * The saved, hashed baggage subsystem: node records, one automatic link network per building, and the commands
 * that place and remove nodes. Drop points are not placed, they follow the check in and bag drop fixtures of the grid.
 */
export class Baggage {
  private recs: BagNodeRec[] = [];
  private nets: { building: number; net: BaggageNetwork }[] = [];
  private nextId = 1;
  /** True while this class edits the grid itself, so the grid hook does not sync again. */
  private editing = false;
  /** Set by the sim (T68): false while no officer stands on the machine. */
  machineStaffed: ((id: number) => boolean) | null = null;

  /** Reserved for belt jitter. Nothing draws from it yet, so it never advances and needs no save. */
  readonly rng: Rng;
  /** Bag batches as a struct of arrays. A slot is free when its stage is 0, and the lowest free slot is taken first so a restore keeps the order. */
  private readonly serial = new Int32Array(BATCH_CAP);
  private readonly count = new Int16Array(BATCH_CAP);
  private readonly stage = new Uint8Array(BATCH_CAP);
  /** Node id where the batch waits, or the link target while it is on a link. */
  private readonly node = new Int32Array(BATCH_CAP);
  /** Drop point the batch was checked in at. */
  private readonly origin = new Int32Array(BATCH_CAP);
  /** Tick the batch reaches the end of its link. */
  private readonly ready = new Int32Array(BATCH_CAP);
  /** Arrival order, so a machine serves first in first out. */
  private readonly seq = new Int32Array(BATCH_CAP);
  /** 1 once a machine has screened the batch. */
  private readonly screened = new Uint8Array(BATCH_CAP);
  /** Arrival batches: tick the unload task finished, the start of the claim wait. */
  private readonly born = new Int32Array(BATCH_CAP);
  /** Origins of batches that reached a full machine this run, so their drop points stop sending. */
  private readonly stalled = new Int32Array(BATCH_CAP);
  private stalledCount = 0;
  private hi = 0;
  private live = 0;
  private nextSeq = 1;
  missingToday = 0;
  checkedToday = 0;
  loadedTotal = 0;
  /** Today's claim waits in game seconds and the flights they were measured on, reset daily. */
  claimWaitSumS = 0;
  claimFlights = 0;
  /** Arrival bags claimed at a carousel, all time. */
  claimedTotal = 0;
  private readonly missSerial = new Int32Array(MISS_ROWS);
  private readonly missCount = new Int32Array(MISS_ROWS);
  private missNext = 0;
  /** Ring of the flights whose first bags reached a carousel: serial and tick, the arrival cohorts' claim signal. Tick -1 for an empty row. */
  private readonly deliSerial = new Int32Array(MISS_ROWS);
  private readonly deliTick = new Int32Array(MISS_ROWS).fill(-1);
  private deliNext = 0;
  private states: NodeState[] = [];
  /** Bumped whenever a record is added or dropped, so the state table and the orphan sweep know to run. */
  /** Bags that entered each link in the current and the last load period. Display only: never saved or hashed. */
  private linkNow = new Map<number, number>();
  private linkLast = new Map<number, number>();
  private linkWindow = -1;
  private layoutStamp = 0;
  /** Bumped with every layout or link change for drawVersion. */
  private drawStamp = 0;
  private statesStamp = -1;
  private sweptStamp = -1;
  private anyBlocked = false;

  constructor(
    private readonly business: Business,
    private readonly host: BaggageHost,
    rng: Rng,
  ) {
    this.rng = rng.fork('baggage');
  }

  /** Share of today's checked bags that are missing, 0 to 1. */
  missingShare(): number {
    return this.missingToday / Math.max(1, this.checkedToday);
  }

  /** Starts a new counting day. */
  resetDay(): void {
    this.missingToday = 0;
    this.checkedToday = 0;
    this.claimWaitSumS = 0;
    this.claimFlights = 0;
  }

  /**
   * The unload task of a flight finished. Its arriving bags become one batch on the train to the bay of the flight's
   * stand, resolved once here so the batch never follows another flight's stand. Without a train that makes the trip
   * (no bay, or no road between the depot, the bay and the stand, T78) they count missing. GA flights carry no passengers.
   */
  unloaded(serial: number, pax: number, tick: number, onTrain: boolean): void {
    const bags = Math.round(pax * ARRIVAL_BAGS_PER_PAX);
    if (bags <= 0 || serial <= 0) return;
    this.checkedToday += bags;
    const standId = this.host.standOfSerial(serial);
    const bay = standId < 0 || !onTrain ? null : this.bayOfStand(standId);
    const b = bay === null ? -1 : this.allocBatch();
    if (b < 0 || bay === null) {
      this.addMissing(serial, bags);
      return;
    }
    this.serial[b] = serial;
    this.count[b] = bags;
    this.stage[b] = BagStage.TrainIn;
    this.node[b] = bay;
    this.origin[b] = bay;
    this.ready[b] = 0;
    this.seq[b] = this.nextSeq++;
    this.screened[b] = 0;
    this.born[b] = tick;
  }

  /** Bags of a serial missing so far, from the recent rows. */
  missingFor(serial: number): number {
    for (let r = 0; r < MISS_ROWS; r++) if (this.missSerial[r] === serial) return this.missCount[r];
    return 0;
  }

  /** Bags of a serial in one stage of the system. */
  bagsOf(serial: number, stage: number): number {
    let n = 0;
    for (let b = 0; b < this.hi; b++) if (this.serial[b] === serial && this.stage[b] === stage) n += this.count[b];
    return n;
  }

  /** Bag batches in the system, of any stage. */
  get batchCount(): number {
    return this.live;
  }

  /** Node id of the stage 5 batches of a serial, -1 when there are none. For tests and the stand inspector. */
  bayOfBags(serial: number): number {
    for (let b = 0; b < this.hi; b++) if (this.serial[b] === serial && this.stage[b] === BagStage.Bay) return this.node[b];
    return -1;
  }

  /** Node id of the first batch of a serial in the given stage, -1 when there is none. For tests and the stand inspector. */
  nodeOfBags(serial: number, stage: number): number {
    for (let b = 0; b < this.hi; b++) if (this.serial[b] === serial && this.stage[b] === stage) return this.node[b];
    return -1;
  }

  /**
   * A cohort finished at the check in or bag drop node whose anchor is array cell `cell` of grid `gridId`. Its bags become
   * one batch in that drop point's buffer. A drop point with no machine, or a full store, counts them missing at once.
   */
  checkIn(gridId: number, cell: number, serial: number, bags: number): void {
    if (bags <= 0 || serial <= 0) return;
    this.checkedToday += bags;
    const drop = this.dropAt(gridId, cell);
    const net = drop === null ? null : this.netOf(drop.building);
    const b = net !== null && drop !== null && net.machineOf(drop.id) !== null ? this.allocBatch() : -1;
    if (b < 0 || drop === null) {
      this.addMissing(serial, bags);
      return;
    }
    this.serial[b] = serial;
    this.count[b] = bags;
    this.stage[b] = BagStage.Drop;
    this.node[b] = drop.id;
    this.origin[b] = drop.id;
    this.ready[b] = 0;
    this.seq[b] = this.nextSeq++;
    this.screened[b] = 0;
    this.born[b] = 0;
  }

  /** True while the drop point at the anchor holds more bags than its buffer, so its desk starts no new service. */
  dropBlocked(gridId: number, cell: number): boolean {
    const drop = this.dropAt(gridId, cell);
    return drop !== null && this.dropBags(drop.id) > BAGGAGE.dropPoint.bufferBags;
  }

  /**
   * The load task of a flight may start when none of its bags is still on the way to the bay, or once the flight is
   * lateBagHoldMin past its departure tick.
   */
  loadReady(serial: number, tick: number, departTick: number): boolean {
    let onTheWay = false;
    for (let b = 0; b < this.hi; b++) {
      if (this.serial[b] === serial && this.stage[b] >= BagStage.Drop && this.stage[b] <= BagStage.ToBay) {
        onTheWay = true;
        break;
      }
    }
    return !onTheWay || tick >= departTick + Math.round(BAGGAGE.lateBagHoldMin * TICKS_PER_MINUTE);
  }

  /**
   * The flight is loaded or has pushed back: bags its train brought count as loaded, all others as missing, those left in
   * the bay too (T78: bags reach the aircraft only by train).
   */
  freeFlight(serial: number): void {
    if (serial <= 0 || this.live === 0) return;
    for (let b = 0; b < this.hi; b++) {
      // Arrival bags leave through the carousel, a departing flight's load does not settle them.
      if (this.serial[b] !== serial || this.stage[b] === BagStage.Free || isArrival(this.stage[b])) continue;
      if (this.stage[b] === BagStage.TrainOut) this.loadedTotal += this.count[b];
      else this.addMissing(serial, this.count[b]);
      this.freeBatch(b);
    }
  }

  /** A departure train loaded at its bay slot: the flight's bags staged in the bay go onto it (T78). */
  pickUp(serial: number): void {
    for (let b = 0; b < this.hi; b++) if (this.serial[b] === serial && this.stage[b] === BagStage.Bay) this.stage[b] = BagStage.TrainOut;
  }

  /** A departure train that will not reach its stand brings its bags back to the bay they came from. */
  putBack(serial: number): void {
    for (let b = 0; b < this.hi; b++) if (this.serial[b] === serial && this.stage[b] === BagStage.TrainOut) this.stage[b] = BagStage.Bay;
  }

  /**
   * An arrival train unloads at its bay slot: its bags wait in the bay for the carousel link. False while the bay holds
   * arriving bags up to its buffer, so the train waits at its slot; force puts them in regardless.
   */
  dropOff(serial: number, force: boolean): boolean {
    let n = 0;
    let bay = -1;
    for (let b = 0; b < this.hi; b++) {
      if (this.serial[b] !== serial || this.stage[b] !== BagStage.TrainIn) continue;
      n += this.count[b];
      bay = this.node[b];
    }
    if (n === 0) return true;
    if (!force) {
      let held = 0;
      for (let b = 0; b < this.hi; b++) if (this.stage[b] === BagStage.BayIn && this.node[b] === bay) held += this.count[b];
      if (held > 0 && held + n > BAGGAGE.bay.bufferBags) return false;
    }
    for (let b = 0; b < this.hi; b++) if (this.serial[b] === serial && this.stage[b] === BagStage.TrainIn) this.stage[b] = BagStage.BayIn;
    return true;
  }

  /** One run of the subsystem, every BAG_RUN_TICKS ticks. */
  update(tick: number): void {
    this.syncStates();
    if (this.sweptStamp !== this.layoutStamp) {
      this.sweptStamp = this.layoutStamp;
      this.sweepOrphans();
    }
    if (this.live === 0) {
      if (this.anyBlocked) this.refreshBlocked();
      return;
    }
    this.recount();
    this.claim();
    this.admitToCarousels(tick);
    this.leaveBays(tick);
    this.admitToMachines(tick);
    this.screen();
    this.route(tick);
    this.admitToBays(tick);
    this.launch(tick);
    this.refreshBlocked();
  }

  nodesOf(building: number): BagNodeRec[] {
    return this.recs.filter((r) => r.building === building);
  }

  /**
   * The Baggage load overlay of one building (docs/BAGGAGE.md 6.1, T78): every link with its path, its load over the last
   * full period against the link capacity and whether bags flow, and every node's buffer fill. Built at overlay cadence,
   * never in the tick; null for a building with no baggage network.
   */
  overlay(building: number, tick: number): BagOverlay | null {
    const net = this.netOf(building);
    if (net === null) return null;
    this.rollLinkWindow(tick);
    const links = net.linkList();
    const kinds = new Map(net.nodeList().map((n) => [n.id, n.kind]));
    let pts = 0;
    for (const l of links) pts += l.cells.length;
    const out: BagOverlay = {
      linkPts: new Float32Array(2 * pts),
      linkStart: new Int32Array(links.length + 1),
      linkLoad: new Uint16Array(links.length),
      linkFlags: new Uint8Array(links.length),
      nodePos: new Float32Array(0),
      nodeFill: new Uint16Array(0),
      nodeFlags: new Uint8Array(0),
    };
    // Links that carry a batch right now, so bags on a belt show as flowing even before a period has counted them.
    const moving = new Set<number>();
    for (let b = 0; b < this.hi; b++) {
      const st = this.stage[b];
      if (st === BagStage.ToMachine || st === BagStage.ToCarousel) moving.add(this.origin[b] * LINK_KEY + this.node[b]);
      else if (st === BagStage.ToBay) moving.add((net.machineOf(this.origin[b]) ?? -1) * LINK_KEY + this.node[b]);
    }
    let p = 0;
    const perHour = 60 / LOAD_WINDOW_MIN;
    for (let k = 0; k < links.length; k++) {
      const l = links[k];
      out.linkStart[k] = p;
      for (const [x, y] of l.cells) {
        out.linkPts[2 * p] = x + 0.5;
        out.linkPts[2 * p + 1] = y + 0.5;
        p++;
      }
      const key = l.src * LINK_KEY + l.dst;
      // The busier of the last full period and the one running now, so a fresh rush shows at once.
      const bags = Math.max(this.linkLast.get(key) ?? 0, this.linkNow.get(key) ?? 0);
      out.linkLoad[k] = Math.min(65535, Math.round((100 * bags * perHour) / BAGGAGE.linkCapacityBagsPerHour));
      const flowing = bags > 0 || moving.has(key);
      out.linkFlags[k] = (flowing ? BAG_LINK_FLOW : 0) | (kinds.get(l.dst) === 'carousel' ? BAG_LINK_ARRIVAL : 0);
    }
    out.linkStart[links.length] = p;
    const recs = this.nodesOf(building).sort((a, b) => a.id - b.id);
    out.nodePos = new Float32Array(2 * recs.length);
    out.nodeFill = new Uint16Array(recs.length);
    out.nodeFlags = new Uint8Array(recs.length);
    for (let k = 0; k < recs.length; k++) {
      const rec = recs[k];
      const c: [number, number] = rec.spec === null ? [rec.cell[0] + 0.5, rec.cell[1] + 0.5] : (drawCenter({ building, kind: rec.kind, cx: rec.spec.cx, cy: rec.spec.cy, rot: rec.spec.rot, widthCells: rec.spec.widthCells, linked: false }) ?? [rec.cell[0] + 0.5, rec.cell[1] + 0.5]);
      out.nodePos[2 * k] = c[0];
      out.nodePos[2 * k + 1] = c[1];
      const cap = this.capacityOf(rec);
      const held = this.heldAt(rec);
      out.nodeFill[k] = cap > 0 ? Math.min(100, Math.round((100 * held) / cap)) : 0;
      out.nodeFlags[k] = held >= cap && cap > 0 ? BAG_NODE_BLOCKED : 0;
    }
    return out;
  }

  /** Counts bags entering a link, for the overlay load. */
  private countLink(src: number, dst: number, bags: number, tick: number): void {
    this.rollLinkWindow(tick);
    const key = src * LINK_KEY + dst;
    this.linkNow.set(key, (this.linkNow.get(key) ?? 0) + bags);
  }

  /** Starts a new load period when the tick has moved past the current one; a gap of more than one period clears both. */
  private rollLinkWindow(tick: number): void {
    const w = Math.floor(tick / LOAD_WINDOW_TICKS);
    if (w === this.linkWindow) return;
    const swap = this.linkLast;
    this.linkLast = this.linkNow;
    this.linkNow = swap;
    this.linkNow.clear();
    if (w !== this.linkWindow + 1) this.linkLast.clear();
    this.linkWindow = w;
  }

  /** Truck edge frame of a bay by id, null when it is gone (T78). */
  bayFrameOf(id: number): BayFrame | null {
    const rec = this.recById(id);
    if (!rec || rec.kind !== 'bay' || rec.spec === null) return null;
    const g = this.business.grids.find((x) => x.id === rec.building);
    return g ? bayFrame(g, rec.spec) : null;
  }

  /** Road connection point of every bay, in bay id order, for the road net (T78). A bay whose grid is gone has none. */
  bayAnchors(): BayAnchor[] {
    const out: BayAnchor[] = [];
    for (const rec of this.recs.slice().sort((a, b) => a.id - b.id)) {
      if (rec.kind !== 'bay' || rec.spec === null) continue;
      const g = this.business.grids.find((x) => x.id === rec.building);
      const f = g ? bayFrame(g, rec.spec) : null;
      if (!f) continue;
      const p = bayRoadPoint(f);
      out.push({ bay: rec.id, x: p.x, y: p.y });
    }
    return out;
  }

  /** Changes whenever a node, a drop link or a grid sync may have changed what drawList returns. Not saved. */
  drawVersion(): number {
    return this.drawStamp;
  }

  /** Every node of one building in id order, as the painter needs it. Drops with a machine link are marked linked. */
  drawList(building: number): BagDrawNode[] {
    const g = this.business.grids.find((x) => x.id === building);
    const net = this.netOf(building);
    const out: BagDrawNode[] = [];
    for (const rec of this.nodesOf(building).sort((a, b) => a.id - b.id)) {
      if (rec.spec === null) {
        const anchor = g ? this.anchorsOf(g).find((a) => a.x === rec.cell[0] && a.y === rec.cell[1]) : undefined;
        out.push({ building, kind: 'drop', cx: rec.cell[0], cy: rec.cell[1], rot: anchor ? anchor.rot : 0, widthCells: 1, linked: net !== null && net.machineOf(rec.id) !== null });
        continue;
      }
      const w = rec.kind === 'bay' ? rec.spec.widthCells : (nodeSize(rec.spec)?.w ?? 1);
      out.push({ building, kind: rec.kind, cx: rec.spec.cx, cy: rec.spec.cy, rot: rec.spec.rot, widthCells: w, linked: false });
    }
    return out;
  }

  warnings(): BagWarning[] {
    const out: BagWarning[] = [];
    for (const n of this.nets) out.push(...n.net.warnings());
    return out;
  }

  /**
   * Read only facts for the inspectors, built at payload cadence. It scans the batch store and the networks and changes nothing,
   * so it never touches the state hash. `standIds` is the stand order of the airfield.
   */
  inspect(standIds: readonly number[]): BaggageInfo {
    const nodes: BagNodeInfo[] = [];
    const bays: BaggageInfo['bays'] = [];
    const sorted = this.recs.slice().sort((a, b) => a.id - b.id);
    for (const rec of sorted) {
      const net = this.netOf(rec.building);
      if (net === null) continue;
      const node = net.nodeList().find((n) => n.id === rec.id);
      const links = net
        .linkList()
        .filter((l) => l.src === rec.id || l.dst === rec.id)
        .map((l) => ({ from: l.src, to: l.dst, mode: l.mode }));
      const warnings = net
        .warnings()
        .filter((w) => w.id === rec.id)
        .map((w): BagWarningCode => w.code);
      // A bay the road net does not reach from a depot gets no trains, so its stands lose their bags (T78).
      const road = rec.kind !== 'bay' || this.host.bayConnected(rec.id);
      if (!road) warnings.push('bayNoRoad');
      // Info chip of docs/BAGGAGE.md 6.2: a full carousel makes its bays hold arriving bags.
      if (rec.kind === 'carousel' && this.heldAt(rec) >= this.capacityOf(rec)) warnings.push('carouselFull');
      const cells: [number, number][] = rec.spec === null ? [[rec.cell[0], rec.cell[1]]] : nodeCells(rec.spec).map(([x, y]): [number, number] => [x, y]);
      nodes.push({ id: rec.id, kind: rec.kind, building: rec.building, cells, held: this.heldAt(rec), capacity: this.capacityOf(rec), links, warnings });
      if (rec.kind === 'bay' && rec.spec !== null) {
        bays.push({ id: rec.id, building: rec.building, slots: Math.floor((rec.spec.widthCells * TERMINAL_CELL_M) / BAGGAGE.bay.slotWidthM), stands: node ? node.stands.slice() : [], carousel: net.carouselOf(rec.id), road });
      }
    }
    return { standBay: standIds.map((id) => this.bayOfStand(id) ?? -1), bays, nodes };
  }

  private capacityOf(rec: BagNodeRec): number {
    if (rec.kind === 'drop') return BAGGAGE.dropPoint.bufferBags;
    if (rec.kind === 'machine') return BAGGAGE.screeningMachine.bufferBags;
    if (rec.kind === 'bay') return BAGGAGE.bay.bufferBags;
    return carouselSize(rec.spec?.widthCells ?? 0).capacityBags;
  }

  /** Bags a node holds right now, counted straight from the batch store. */
  private heldAt(rec: BagNodeRec): number {
    if (rec.kind === 'drop') return this.dropBags(rec.id);
    if (rec.kind === 'carousel') return this.carouselHeld(rec.id);
    // A bay holds departure bags staged for loading and arrival bags waiting for the carousel link.
    const stage = rec.kind === 'machine' ? BagStage.Queue : BagStage.Bay;
    const arrival = rec.kind === 'bay' ? BagStage.BayIn : -1;
    let n = 0;
    for (let b = 0; b < this.hi; b++) if ((this.stage[b] === stage || this.stage[b] === arrival) && this.node[b] === rec.id) n += this.count[b];
    return n;
  }

  bayOfStand(standId: number): number | null {
    for (const n of this.nets) {
      const bay = n.net.bayOfStand(standId);
      if (bay !== null) return bay;
    }
    return null;
  }

  carouselOf(bayId: number): number | null {
    const rec = this.recs.find((r) => r.id === bayId);
    const net = rec ? this.netOf(rec.building) : null;
    return net ? net.carouselOf(bayId) : null;
  }

  routeDeparture(dropId: number, standId: number): RouteResult {
    const rec = this.recs.find((r) => r.id === dropId && r.kind === 'drop');
    const net = rec ? this.netOf(rec.building) : null;
    return net ? net.routeDeparture(dropId, standId) : { problem: 'noMachine' };
  }

  /** Places a machine, bay or carousel. Returns a problem code or null. A free placement (the belt migration) costs nothing. */
  place(cmd: PlaceBagNode, free = false): string | null {
    const g = this.business.grids.find((x) => x.id === cmd.building);
    if (!g) return 'nothingThere';
    // A carousel keeps its size in widthCells; an unlisted length places the default size.
    const widthCells = cmd.kind === 'carousel' ? carouselSize(cmd.widthCells).w : cmd.widthCells;
    const spec: BagNodeSpec = { kind: cmd.kind, cx: cmd.cx, cy: cmd.cy, rot: cmd.rot, widthCells };
    const problem = validateBagNode(g, spec);
    if (problem) return problem;
    const cost = free ? 0 : bagNodeCost(spec.kind, spec.widthCells);
    if (cost > this.host.getCash()) return `insufficientFunds|cost=${cost}`;
    if (cost > 0) this.host.book(-cost);
    const key = bagKey(spec.kind);
    const id = keyId(key);
    const cells = nodeCells(spec);
    for (const [x, y] of cells) {
      const i = cellIndex(g, x, y);
      g.fixture[i] = id;
      g.fixtureRot[i] = 0;
      if (g.zone[i] === 0) g.zone[i] = FIXTURE_ZONES[key][0];
    }
    this.refreshCells(g.id, cells);
    const rec: BagNodeRec = { id: this.nextId++, kind: spec.kind, building: g.id, spec, cell: [spec.cx, spec.cy] };
    this.recs.push(rec);
    this.layoutStamp++;
    this.drawStamp++;
    this.ensureNet(g.id).add(this.netNode(rec, g));
    this.syncBuilding(g.id);
    return null;
  }

  /**
   * Save format 33 (T78): every legacy belt becomes the largest carousel whose footprint, in some rotation, covers the
   * belt's cell and fits on the grid. The belts are cleared first, so neighbouring belts make room for one carousel, and
   * a belt already under an earlier carousel is absorbed. A belt no size fits stays. Returns the belts kept.
   */
  convertBelts(): number {
    const sizes = BAGGAGE.carousel.sizes.slice().sort((a, b) => b.w - a.w);
    let kept = 0;
    for (const g of this.business.grids.slice().sort((a, b) => a.id - b.id)) {
      const belts: Cell[] = [];
      for (let i = 0; i < g.fixture.length; i++) if (g.fixture[i] === BELT_ID) belts.push([g.x0 + (i % g.w), g.y0 + Math.floor(i / g.w)]);
      if (belts.length === 0) continue;
      for (const [x, y] of belts) this.setCell(g, x, y, 0);
      this.refreshCells(g.id, belts);
      const back: Cell[] = [];
      for (const [x, y] of belts) {
        if (g.fixture[cellIndex(g, x, y)] !== 0) continue;
        if (!this.carouselOver(g, x, y, sizes)) back.push([x, y]);
      }
      for (const [x, y] of back) this.setCell(g, x, y, BELT_ID);
      if (back.length > 0) this.refreshCells(g.id, back);
      kept += back.length;
    }
    return kept;
  }

  /** Places, at no cost, the first size and rotation of carousel whose footprint covers the cell and fits. */
  private carouselOver(g: TerminalGrid, x: number, y: number, sizes: readonly { w: number }[]): boolean {
    for (const z of sizes) {
      for (let rot = 0; rot < 4; rot++) {
        const r = rot as 0 | 1 | 2 | 3;
        for (const [dx, dy] of nodeCells({ kind: 'carousel', cx: 0, cy: 0, rot: r, widthCells: z.w })) {
          if (this.place({ building: g.id, kind: 'carousel', cx: x - dx, cy: y - dy, rot: r, widthCells: z.w }, true) === null) return true;
        }
      }
    }
    return false;
  }

  /** Sets a one cell fixture, or clears the cell with id 0. */
  private setCell(g: TerminalGrid, x: number, y: number, id: number): void {
    const i = cellIndex(g, x, y);
    g.fixture[i] = id;
    g.fixtureRot[i] = 0;
    g.fixtureOff[i] = 0;
    g.fixtureLevel[i] = id === 0 ? 0 : 1;
    g.fixtureMode[i] = 0;
  }

  /** Id the node placed last took, for the undo history (T85). */
  get lastId(): number {
    return this.nextId - 1;
  }

  /** The placement that would put a placed node back, null for a drop point or an unknown id (T85). */
  placementOf(id: number): PlaceBagNode | null {
    const rec = this.recs.find((r) => r.id === id);
    if (!rec || rec.spec === null) return null;
    const s = rec.spec;
    return { building: rec.building, kind: s.kind as PlaceBagNode['kind'], cx: s.cx, cy: s.cy, rot: s.rot, widthCells: s.widthCells };
  }

  /** Removes a placed node and clears its cells. Drop points cannot be removed, they follow the grid. */
  remove(id: number): string | null {
    const rec = this.recs.find((r) => r.id === id);
    if (!rec || rec.spec === null) return 'nothingThere';
    const g = this.business.grids.find((x) => x.id === rec.building);
    this.dropRec(rec);
    if (g) this.clearCells(g, rec.spec);
    this.syncBuilding(rec.building);
    return null;
  }

  /** Assigns a stand to a bay, or with bayId -1 unassigns it. A stand has at most one bay. */
  setStandBay(standId: number, bayId: number): string | null {
    if (!this.host.standExists(standId)) return 'nothingThere';
    const rec = bayId === -1 ? null : this.recs.find((r) => r.id === bayId && r.kind === 'bay');
    if (bayId !== -1 && !rec) return 'nothingThere';
    for (const n of this.nets) {
      const prev = n.net.bayOfStand(standId);
      if (prev !== null && prev !== bayId) n.net.unassignStand(prev, standId);
    }
    if (rec) {
      const net = this.netOf(rec.building);
      if (net) net.assignStand(rec.id, standId);
    }
    this.business.version++;
    return null;
  }

  fix(id: number): string | null {
    const rec = this.recs.find((r) => r.id === id);
    const net = rec ? this.netOf(rec.building) : null;
    if (!rec || !net) return 'nothingThere';
    net.fix(id);
    this.drawStamp++;
    this.business.version++;
    return null;
  }

  /** The grid hook. Brings nodes in line with a building after any edit or its demolition. */
  onGridEdited(building: number): void {
    if (!this.editing) this.syncBuilding(building);
  }

  /**
   * Removes placed nodes whose cells no longer all hold their fixture, then syncs the drop points
   * with the check in and bag drop fixtures. A grid that is gone drops all its nodes and its network.
   */
  syncBuilding(building: number): void {
    const g = this.business.grids.find((x) => x.id === building);
    this.layoutStamp++;
    this.drawStamp++;
    if (!g) {
      this.recs = this.recs.filter((r) => r.building !== building);
      this.nets = this.nets.filter((n) => n.building !== building);
      return;
    }
    const net = this.ensureNet(building);
    for (const rec of this.nodesOf(building)) {
      if (rec.spec === null) continue;
      const id = keyId(bagKey(rec.spec.kind));
      const intact = nodeCells(rec.spec).every(([x, y]) => g.fixture[cellIndex(g, x, y)] === id);
      if (intact) continue;
      this.dropRec(rec);
      this.clearCells(g, rec.spec);
    }
    const anchors = this.anchorsOf(g);
    for (const rec of this.nodesOf(building)) {
      if (rec.kind !== 'drop') continue;
      const a = anchors.find((x) => x.x === rec.cell[0] && x.y === rec.cell[1]);
      if (!a) {
        this.dropRec(rec);
        continue;
      }
      const node = net.nodeList().find((n) => n.id === rec.id);
      if (node && !sameCell(node.outPort, this.dropPort(g, a))) net.remove(rec.id);
    }
    for (const a of anchors) {
      let rec = this.recs.find((r) => r.kind === 'drop' && r.building === building && r.cell[0] === a.x && r.cell[1] === a.y);
      if (!rec) {
        rec = { id: this.nextId++, kind: 'drop', building, spec: null, cell: [a.x, a.y] };
        this.recs.push(rec);
      }
      if (!net.nodeList().some((n) => n.id === rec!.id)) net.add(this.netNode(rec, g));
    }
    this.business.version++;
  }

  saveState(): BaggageSave {
    this.syncStates();
    const hi = this.hi;
    return {
      flow: {
        hi,
        nextSeq: this.nextSeq,
        missingToday: this.missingToday,
        checkedToday: this.checkedToday,
        loadedTotal: this.loadedTotal,
        serial: packTyped(this.serial.subarray(0, hi)),
        count: packTyped(this.count.subarray(0, hi)),
        stage: packTyped(this.stage.subarray(0, hi)),
        node: packTyped(this.node.subarray(0, hi)),
        origin: packTyped(this.origin.subarray(0, hi)),
        ready: packTyped(this.ready.subarray(0, hi)),
        seq: packTyped(this.seq.subarray(0, hi)),
        screened: packTyped(this.screened.subarray(0, hi)),
        born: packTyped(this.born.subarray(0, hi)),
        claimWaitSumS: this.claimWaitSumS,
        claimFlights: this.claimFlights,
        claimedTotal: this.claimedTotal,
        tokens: this.states.filter((s) => s.isMachine).map((s): [number, number] => [s.id, s.tok]),
        missNext: this.missNext,
        missSerial: packTyped(this.missSerial),
        missCount: packTyped(this.missCount),
        deliSerial: packTyped(this.deliSerial),
        deliTick: packTyped(this.deliTick),
        deliNext: this.deliNext,
      },
      nextId: this.nextId,
      nodes: this.recs.map((r) => ({ id: r.id, kind: r.kind, building: r.building, spec: r.spec ? { ...r.spec } : null, cell: [r.cell[0], r.cell[1]] })),
      bayStands: this.nets.flatMap((n) => n.net.nodeList().filter((x) => x.kind === 'bay').map((x) => ({ id: x.id, stands: x.stands.slice() }))),
      links: this.nets.map((n) => ({ building: n.building, links: n.net.linkList().map((l): [number, number, LinkMode] => [l.src, l.dst, l.mode]) })),
    };
  }

  /** Undefined means a save from before the baggage network: every grid is synced so its drop points appear. */
  loadState(raw: BaggageSave | undefined): void {
    this.recs = [];
    this.nets = [];
    this.nextId = 1;
    this.clearFlow();
    if (raw === undefined) {
      for (const g of this.business.grids) this.syncBuilding(g.id);
      this.refreshBlocked();
      return;
    }
    this.nextId = raw.nextId;
    const stands = new Map<number, number[]>(raw.bayStands.map((b) => [b.id, b.stands]));
    for (const n of raw.nodes) {
      const rec: BagNodeRec = { id: n.id, kind: n.kind, building: n.building, spec: n.spec ? { ...n.spec } : null, cell: [n.cell[0], n.cell[1]] };
      this.recs.push(rec);
      const g = this.business.grids.find((x) => x.id === rec.building);
      if (!g) continue;
      const node = this.netNode(rec, g);
      node.stands = (stands.get(rec.id) ?? []).slice();
      this.ensureNet(rec.building).insertRaw(node);
    }
    this.recs.sort((a, b) => a.id - b.id);
    for (const group of raw.links) {
      const net = this.netOf(group.building);
      if (net) for (const [src, dst, mode] of group.links) net.link(src, dst, mode);
    }
    this.layoutStamp++;
    this.drawStamp++;
    this.syncStates();
    if (raw.flow !== undefined) this.loadFlow(raw.flow);
    this.refreshBlocked();
  }

  hash(h: number): number {
    let acc = foldU32(h, this.nextId);
    for (const r of this.recs) {
      acc = foldU32(foldU32(foldU32(foldU32(foldU32(acc, r.id), KIND_INDEX.indexOf(r.kind)), r.building), r.cell[0] + 65536), r.cell[1] + 65536);
      if (r.spec === null) acc = foldU32(acc, 0);
      // A carousel folds the size it has, so a save that migrates its length to the size it was drawn at hashes the same.
      else acc = foldU32(foldU32(foldU32(foldU32(foldU32(acc, 1), r.spec.cx + 65536), r.spec.cy + 65536), r.spec.rot), r.spec.kind === 'carousel' ? carouselSize(r.spec.widthCells).w : r.spec.widthCells);
    }
    for (const n of this.nets) {
      for (const node of n.net.nodeList()) {
        if (node.kind !== 'bay') continue;
        acc = foldU32(foldU32(acc, node.id), node.stands.length);
        for (const s of node.stands) acc = foldU32(acc, s);
      }
      for (const l of n.net.linkList()) acc = foldU32(foldU32(foldU32(acc, l.src), l.dst), l.mode === 'auto' ? 0 : 1);
    }
    this.syncStates();
    for (const s of this.states) if (s.isMachine) acc = foldU32(foldU32(acc, s.id), s.tok);
    acc = foldU32(foldU32(foldU32(foldU32(acc, this.nextSeq), this.missingToday), this.checkedToday), this.loadedTotal);
    for (let b = 0; b < this.hi; b++) {
      if (this.stage[b] === BagStage.Free) continue;
      acc = foldU32(foldU32(foldU32(foldU32(acc, b), this.serial[b]), this.count[b]), this.stage[b]);
      acc = foldU32(foldU32(foldU32(foldU32(acc, this.node[b]), this.origin[b]), this.ready[b]), this.seq[b]);
      acc = foldU32(foldU32(acc, this.screened[b]), this.born[b]);
    }
    acc = foldU32(foldU32(foldU32(acc, this.claimWaitSumS), this.claimFlights), this.claimedTotal);
    for (let r = 0; r < MISS_ROWS; r++) acc = foldU32(foldU32(acc, this.missSerial[r]), this.missCount[r]);
    acc = foldU32(acc, this.missNext);
    for (let r = 0; r < MISS_ROWS; r++) acc = foldU32(foldU32(acc, this.deliSerial[r]), this.deliTick[r]);
    return foldU32(acc, this.deliNext);
  }

  private netOf(building: number): BaggageNetwork | null {
    for (let i = 0; i < this.nets.length; i++) if (this.nets[i].building === building) return this.nets[i].net;
    return null;
  }

  // Batch store and the tick steps. Everything below runs in the baggage subsystem with plain loops and no allocation. -----

  private recById(id: number): BagNodeRec | null {
    for (let i = 0; i < this.recs.length; i++) if (this.recs[i].id === id) return this.recs[i];
    return null;
  }

  private gridById(id: number): TerminalGrid | null {
    const grids = this.business.grids;
    for (let i = 0; i < grids.length; i++) if (grids[i].id === id) return grids[i];
    return null;
  }

  /** The drop point whose anchor is array cell `cell` of the grid. */
  private dropAt(gridId: number, cell: number): BagNodeRec | null {
    const g = this.gridById(gridId);
    if (g === null || cell < 0 || cell >= g.w * g.h) return null;
    const x = g.x0 + (cell % g.w);
    const y = g.y0 + Math.floor(cell / g.w);
    for (let i = 0; i < this.recs.length; i++) {
      const r = this.recs[i];
      if (r.kind === 'drop' && r.building === gridId && r.cell[0] === x && r.cell[1] === y) return r;
    }
    return null;
  }

  private dropBags(dropId: number): number {
    let n = 0;
    for (let b = 0; b < this.hi; b++) if (this.stage[b] === BagStage.Drop && this.origin[b] === dropId) n += this.count[b];
    return n;
  }

  private stateIdx(id: number): number {
    for (let k = 0; k < this.states.length; k++) if (this.states[k].id === id) return k;
    return -1;
  }

  /** The lowest free slot, so a restored store gives the same order as the one that was saved. -1 when full. */
  private allocBatch(): number {
    for (let b = 0; b < this.hi; b++) {
      if (this.stage[b] === BagStage.Free) {
        this.live++;
        return b;
      }
    }
    if (this.hi >= BATCH_CAP) return -1;
    this.live++;
    return this.hi++;
  }

  private freeBatch(b: number): void {
    this.stage[b] = BagStage.Free;
    this.live--;
  }

  /** Counts bags as missing for a serial, in today's counter and in the per serial table. */
  private addMissing(serial: number, bags: number): void {
    this.missingToday += bags;
    for (let r = 0; r < MISS_ROWS; r++) {
      if (this.missSerial[r] === serial) {
        this.missCount[r] += bags;
        return;
      }
    }
    this.missSerial[this.missNext] = serial;
    this.missCount[this.missNext] = bags;
    this.missNext = (this.missNext + 1) % MISS_ROWS;
  }

  private clearFlow(): void {
    this.stage.fill(BagStage.Free);
    this.hi = 0;
    this.live = 0;
    this.nextSeq = 1;
    this.missingToday = 0;
    this.checkedToday = 0;
    this.loadedTotal = 0;
    this.claimWaitSumS = 0;
    this.claimFlights = 0;
    this.claimedTotal = 0;
    this.born.fill(0);
    this.missSerial.fill(0);
    this.missCount.fill(0);
    this.missNext = 0;
    this.deliSerial.fill(0);
    this.deliTick.fill(-1);
    this.deliNext = 0;
    this.states = [];
    this.statesStamp = -1;
    this.sweptStamp = -1;
    this.anyBlocked = false;
  }

  private loadFlow(f: BagFlowSave): void {
    const hi = Math.min(f.hi, BATCH_CAP);
    this.serial.set(unpackTyped(f.serial, Int32Array).subarray(0, hi));
    this.count.set(unpackTyped(f.count, Int16Array).subarray(0, hi));
    this.stage.set(unpackTyped(f.stage, Uint8Array).subarray(0, hi));
    this.node.set(unpackTyped(f.node, Int32Array).subarray(0, hi));
    this.origin.set(unpackTyped(f.origin, Int32Array).subarray(0, hi));
    this.ready.set(unpackTyped(f.ready, Int32Array).subarray(0, hi));
    this.seq.set(unpackTyped(f.seq, Int32Array).subarray(0, hi));
    this.screened.set(unpackTyped(f.screened, Uint8Array).subarray(0, hi));
    if (f.born !== undefined) this.born.set(unpackTyped(f.born, Int32Array).subarray(0, hi));
    this.hi = hi;
    this.live = 0;
    for (let b = 0; b < hi; b++) if (this.stage[b] !== BagStage.Free) this.live++;
    this.nextSeq = f.nextSeq;
    this.missingToday = f.missingToday;
    this.checkedToday = f.checkedToday;
    this.loadedTotal = f.loadedTotal;
    this.claimWaitSumS = f.claimWaitSumS ?? 0;
    this.claimFlights = f.claimFlights ?? 0;
    this.claimedTotal = f.claimedTotal ?? 0;
    for (const [id, tok] of f.tokens) {
      const k = this.stateIdx(id);
      if (k >= 0) this.states[k].tok = tok;
    }
    this.missNext = f.missNext;
    this.missSerial.set(unpackTyped(f.missSerial, Int32Array));
    this.missCount.set(unpackTyped(f.missCount, Int32Array));
    if (f.deliSerial !== undefined) this.deliSerial.set(unpackTyped(f.deliSerial, Int32Array));
    if (f.deliTick !== undefined) this.deliTick.set(unpackTyped(f.deliTick, Int32Array));
    this.deliNext = f.deliNext ?? 0;
  }

  /** Rebuilds the machine and bay state table when records changed, keeping each machine's tokens. */
  private syncStates(): void {
    if (this.statesStamp === this.layoutStamp) return;
    this.statesStamp = this.layoutStamp;
    const next: NodeState[] = [];
    for (const rec of this.recs) {
      if (rec.kind !== 'machine' && rec.kind !== 'bay') continue;
      const prev = this.stateIdx(rec.id);
      next.push({ id: rec.id, isMachine: rec.kind === 'machine', tok: prev >= 0 ? this.states[prev].tok : 0, ok: false, okTerminal: -1, held: 0 });
    }
    this.states = next;
  }

  /** Bags whose node or drop point is gone after an edit count as missing. */
  private sweepOrphans(): void {
    for (let b = 0; b < this.hi; b++) {
      const st = this.stage[b];
      if (st === BagStage.Free) continue;
      if (this.recById(this.node[b]) === null || (st <= BagStage.Queue && this.recById(this.origin[b]) === null)) {
        this.addMissing(this.serial[b], this.count[b]);
        this.freeBatch(b);
      }
    }
  }

  private recount(): void {
    for (let k = 0; k < this.states.length; k++) this.states[k].held = 0;
    for (let b = 0; b < this.hi; b++) {
      const st = this.stage[b];
      if (st !== BagStage.Queue && st !== BagStage.Bay) continue;
      const k = this.stateIdx(this.node[b]);
      if (k >= 0) this.states[k].held += this.count[b];
    }
  }

  private machineOk(s: NodeState): boolean {
    const version = this.business.terminalVersion;
    if (s.okTerminal !== version) {
      s.okTerminal = version;
      const rec = this.recById(s.id);
      const g = rec === null || rec.spec === null ? null : this.gridById(rec.building);
      s.ok = rec !== null && rec.spec !== null && g !== null && screeningRoomOk(g, rec.spec);
    }
    return s.ok;
  }

  private linkTicks(lengthM: number): number {
    return gameSecondsToTicks(lengthM / BAGGAGE.beltSpeedMps);
  }

  /** A batch that reached the end of its link enters the machine when the buffer has room, else it waits and stalls its drop point. */
  private admitToMachines(tick: number): void {
    this.stalledCount = 0;
    const room = BAGGAGE.screeningMachine.bufferBags;
    for (let b = 0; b < this.hi; b++) {
      if (this.stage[b] !== BagStage.ToMachine || this.ready[b] > tick) continue;
      const k = this.stateIdx(this.node[b]);
      if (k < 0) continue;
      const s = this.states[k];
      // An empty machine takes any batch, so one large batch can always start.
      if (s.held === 0 || s.held + this.count[b] <= room) {
        s.held += this.count[b];
        this.stage[b] = BagStage.Queue;
      } else {
        this.stalled[this.stalledCount++] = this.origin[b];
      }
    }
  }

  /** First in first out batch of a machine that is not screened yet, -1 for none. */
  private headOf(machineId: number): number {
    let best = -1;
    for (let b = 0; b < this.hi; b++) {
      if (this.stage[b] !== BagStage.Queue || this.screened[b] === 1 || this.node[b] !== machineId) continue;
      if (best < 0 || this.seq[b] < this.seq[best]) best = b;
    }
    return best;
  }

  /** Each machine in a valid staff room banks screening time and screens its head batches. */
  private screen(): void {
    const perBag = Math.round(BAGGAGE.screeningMachine.secondsPerBag * DECI_PER_SECOND);
    for (let k = 0; k < this.states.length; k++) {
      const s = this.states[k];
      if (!s.isMachine) continue;
      let head = this.headOf(s.id);
      if (head < 0 || !this.machineOk(s) || (this.machineStaffed !== null && !this.machineStaffed(s.id))) {
        s.tok = 0;
        continue;
      }
      s.tok += RUN_DECI;
      while (head >= 0 && s.tok >= this.count[head] * perBag) {
        s.tok -= this.count[head] * perBag;
        this.screened[head] = 1;
        head = this.headOf(s.id);
      }
      if (head < 0) s.tok = 0;
    }
  }

  /** Screened batches go to the bay of their flight's stand. Without a route they stay in the machine queue. */
  private route(tick: number): void {
    for (let b = 0; b < this.hi; b++) {
      if (this.stage[b] !== BagStage.Queue || this.screened[b] === 0) continue;
      const standId = this.host.standOfSerial(this.serial[b]);
      if (standId === -2) {
        this.addMissing(this.serial[b], this.count[b]);
        this.freeBatch(b);
        continue;
      }
      if (standId === -1) continue;
      const drop = this.recById(this.origin[b]);
      const net = drop === null ? null : this.netOf(drop.building);
      if (net === null) continue;
      const r = net.routeDeparture(this.origin[b], standId);
      if (!('route' in r)) continue;
      const bay = r.route[2];
      this.node[b] = bay;
      this.stage[b] = BagStage.ToBay;
      this.countLink(r.route[1], bay, this.count[b], tick);
      this.ready[b] = tick + this.linkTicks(net.linkLengthM(r.route[1], bay));
    }
  }

  /** A batch that reached the end of its bay link is staged in the bay up to its buffer. */
  private admitToBays(tick: number): void {
    const room = BAGGAGE.bay.bufferBags;
    for (let b = 0; b < this.hi; b++) {
      if (this.stage[b] !== BagStage.ToBay || this.ready[b] > tick) continue;
      const k = this.stateIdx(this.node[b]);
      if (k < 0) continue;
      const s = this.states[k];
      if (s.held === 0 || s.held + this.count[b] <= room) {
        s.held += this.count[b];
        this.stage[b] = BagStage.Bay;
      }
    }
  }

  /** Bags on a carousel are claimed at once, no arrival passengers exist yet. Runs first, so a batch that arrived last run frees its place now. */
  private claim(): void {
    for (let b = 0; b < this.hi; b++) {
      if (this.stage[b] !== BagStage.Carousel) continue;
      this.claimedTotal += this.count[b];
      this.freeBatch(b);
    }
  }

  /** Bags the carousel holds at most, by its size. */
  private carouselRoom(carouselId: number): number {
    const rec = this.recById(carouselId);
    return carouselSize(rec?.spec?.widthCells ?? 0).capacityBags;
  }

  private carouselHeld(carouselId: number): number {
    let n = 0;
    for (let b = 0; b < this.hi; b++) if (this.stage[b] === BagStage.Carousel && this.node[b] === carouselId) n += this.count[b];
    return n;
  }

  /** A batch at the end of its carousel link goes on the carousel while it has room, else it holds the link (back pressure). */
  private admitToCarousels(tick: number): void {
    for (let b = 0; b < this.hi; b++) {
      if (this.stage[b] !== BagStage.ToCarousel || this.ready[b] > tick) continue;
      const room = this.carouselRoom(this.node[b]);
      const held = this.carouselHeld(this.node[b]);
      // An empty carousel takes any batch, so one large batch can always arrive.
      if (held !== 0 && held + this.count[b] > room) continue;
      this.stage[b] = BagStage.Carousel;
      this.recordDelivery(this.serial[b], tick);
      this.claimWaitSumS += Math.round(((tick - this.born[b]) * CLOCK_SCALE) / DECI_PER_SECOND);
      this.claimFlights++;
    }
  }

  /** Notes the tick the first bags of a serial reached a carousel. A serial already in the ring keeps its earliest tick. */
  private recordDelivery(serial: number, tick: number): void {
    for (let r = 0; r < MISS_ROWS; r++) if (this.deliSerial[r] === serial && this.deliTick[r]! >= 0) return;
    this.deliSerial[this.deliNext] = serial;
    this.deliTick[this.deliNext] = tick;
    this.deliNext = (this.deliNext + 1) % MISS_ROWS;
  }

  /** The tick the first bags of a flight reached a carousel, -1 when none did or the row was overwritten. */
  deliveredAt(serial: number): number {
    for (let r = 0; r < MISS_ROWS; r++) if (this.deliSerial[r] === serial && this.deliTick[r]! >= 0) return this.deliTick[r]!;
    return -1;
  }

  /**
   * The carousel the bay of a flight's stand feeds: its building id and logical cell go to out[0..2]. False when the
   * stand has no bay or the bay no carousel.
   */
  arrivalCarousel(serial: number, out: Int32Array): boolean {
    const standId = this.host.standOfSerial(serial);
    if (standId < 0) return false;
    const bay = this.bayOfStand(standId);
    const carousel = bay === null ? null : this.carouselOf(bay);
    if (carousel === null) return false;
    for (let i = 0; i < this.recs.length; i++) {
      const rec = this.recs[i]!;
      if (rec.id !== carousel) continue;
      out[0] = rec.building;
      out[1] = rec.cell[0];
      out[2] = rec.cell[1];
      return true;
    }
    return false;
  }

  /** The oldest batch waiting in a bay enters the bay's link to its carousel once the previous one has left it. */
  private leaveBays(tick: number): void {
    for (let b = 0; b < this.hi; b++) {
      if (this.stage[b] !== BagStage.BayIn) continue;
      const bay = this.node[b];
      let blocked = false;
      for (let o = 0; o < this.hi && !blocked; o++) {
        if (o === b || this.origin[o] !== bay) continue;
        if (this.stage[o] === BagStage.ToCarousel || (this.stage[o] === BagStage.BayIn && this.seq[o] < this.seq[b])) blocked = true;
      }
      if (blocked) continue;
      const rec = this.recById(bay);
      const net = rec === null ? null : this.netOf(rec.building);
      const carousel = net === null ? null : net.carouselOf(bay);
      if (net === null || carousel === null) continue;
      this.node[b] = carousel;
      this.stage[b] = BagStage.ToCarousel;
      this.countLink(bay, carousel, this.count[b], tick);
      this.ready[b] = tick + this.linkTicks(net.linkLengthM(bay, carousel));
    }
  }

  private isStalled(dropId: number): boolean {
    for (let i = 0; i < this.stalledCount; i++) if (this.stalled[i] === dropId) return true;
    return false;
  }

  /** Drop point buffers feed their belt to the machine, unless a batch from that drop point is waiting at a full machine. */
  private launch(tick: number): void {
    for (let b = 0; b < this.hi; b++) {
      if (this.stage[b] !== BagStage.Drop) continue;
      const drop = this.recById(this.origin[b]);
      const net = drop === null ? null : this.netOf(drop.building);
      if (net === null || this.isStalled(this.origin[b])) continue;
      const machine = net.machineOf(this.origin[b]);
      if (machine === null) continue;
      this.node[b] = machine;
      this.stage[b] = BagStage.ToMachine;
      this.countLink(this.origin[b], machine, this.count[b], tick);
      this.ready[b] = tick + this.linkTicks(net.linkLengthM(this.origin[b], machine));
    }
  }

  /** Sets the back pressure flag of every drop point's service node from its buffer. */
  private refreshBlocked(): void {
    this.anyBlocked = false;
    const limit = BAGGAGE.dropPoint.bufferBags;
    for (let i = 0; i < this.recs.length; i++) {
      const rec = this.recs[i];
      if (rec.kind !== 'drop') continue;
      const g = this.gridById(rec.building);
      const table = this.business.serviceTable(rec.building);
      if (g === null || table === null) continue;
      const cell = cellIndex(g, rec.cell[0], rec.cell[1]);
      let k = -1;
      for (let j = 0; j < table.count; j++) {
        if (table.cell[j] === cell) {
          k = j;
          break;
        }
      }
      if (k < 0) continue;
      const blocked = this.dropBags(rec.id) > limit;
      table.blocked[k] = blocked ? 1 : 0;
      if (blocked) this.anyBlocked = true;
    }
  }

  private ensureNet(building: number): BaggageNetwork {
    const found = this.netOf(building);
    if (found) return found;
    const net = new BaggageNetwork({ blocked: [], owned: null, maxLenM: BAGGAGE.maxLinkLengthM });
    const at = this.nets.findIndex((n) => n.building > building);
    this.nets.splice(at < 0 ? this.nets.length : at, 0, { building, net });
    return net;
  }

  /** Removes the record and its network node with its links (rule F). */
  private dropRec(rec: BagNodeRec): void {
    this.layoutStamp++;
    this.drawStamp++;
    this.netOf(rec.building)?.remove(rec.id);
    this.recs = this.recs.filter((r) => r !== rec);
  }

  /** Clears the cells of a spec that still hold its fixture, then refreshes the grid derived data over them. */
  private clearCells(g: TerminalGrid, spec: BagNodeSpec): void {
    const id = keyId(bagKey(spec.kind));
    const cells = nodeCells(spec);
    for (const [x, y] of cells) {
      const i = cellIndex(g, x, y);
      if (i < 0 || g.fixture[i] !== id) continue;
      g.fixture[i] = 0;
      g.fixtureRot[i] = 0;
      g.leased[i] = 0;
    }
    this.refreshCells(g.id, cells);
  }

  private refreshCells(building: number, cells: Cell[]): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of cells) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    this.editing = true;
    try {
      this.business.refreshGrid(building, x0, y0, x1, y1);
    } finally {
      this.editing = false;
    }
  }

  /** Every drop point anchor of the grid in cell index order. A bag drop anchor holds fixtureRot code 1 to 4. */
  private anchorsOf(g: TerminalGrid): Anchor[] {
    const out: Anchor[] = [];
    for (let i = 0; i < g.fixture.length; i++) {
      const x = g.x0 + (i % g.w);
      const y = g.y0 + Math.floor(i / g.w);
      if (g.fixture[i] === CHECK_IN_ID) out.push({ x, y, rot: 0 });
      else if (g.fixture[i] === BAG_DROP_ID && g.fixtureRot[i] >= 1 && g.fixtureRot[i] <= 4) out.push({ x, y, rot: (g.fixtureRot[i] - 1) as 0 | 1 | 2 | 3 });
    }
    return out;
  }

  /** Out port of a drop: null when the cell is outside the grid, has no floor or holds a fixture. */
  private dropPort(g: TerminalGrid, a: Anchor): Cell | null {
    const [x, y] = dropOutCell(a.x, a.y, a.rot);
    const i = cellIndex(g, x, y);
    return i < 0 || g.floor[i] === 0 || g.fixture[i] !== 0 ? null : [x, y];
  }

  /** The network node of a record, with ports derived from its spec or from the grid. */
  private netNode(rec: BagNodeRec, g: TerminalGrid): BagNode {
    if (rec.spec === null) {
      const anchor = this.anchorsOf(g).find((a) => a.x === rec.cell[0] && a.y === rec.cell[1]);
      return { id: rec.id, kind: 'drop', floor: 0, inPort: null, outPort: anchor ? this.dropPort(g, anchor) : null, stands: [] };
    }
    return { id: rec.id, kind: rec.kind, floor: 0, inPort: rampCell(rec.spec, 'in'), outPort: rampCell(rec.spec, 'out'), stands: [] };
  }
}

const sameCell = (a: Cell | null, b: Cell | null): boolean => (a === null || b === null ? a === b : a[0] === b[0] && a[1] === b[1]);
