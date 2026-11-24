import { SnapshotPool } from '@shared/bufferPool';
import type { OverlayData } from '@shared/overlay';
import type { FromSimMessage, ToSimMessage } from '@shared/protocol';
import { createSnapshotViews, type SnapshotViews } from '@shared/snapshot';
import {
  BACKLOG_SPEED_CAP_TICKS,
  SNAPSHOT_INTERVAL_MS,
  TICKS_PER_REAL_SECOND_AT_1X,
  type Speed,
} from '@shared/time';
import { BUSINESS } from '@data/index';
import { nextClockTick, TICKS_PER_DAY } from '@shared/business';
import { Sim } from '@sim/sim';
import { generateSite, toPayload } from '@sim/world/site';
import type { WorkerScope } from './scope';
import { OverlayPublisher } from './overlayPublisher';

const scope = self as unknown as WorkerScope<ToSimMessage, FromSimMessage>;

/** Wall clock slice per loop pass, so the worker stays responsive to messages. */
const MAX_SLICE_MS = 8;
/** Longer slice while skipping to the morning (T92): the frame rate matters less than the skip, messages still get through. */
const SKIP_SLICE_MS = 30;
/** Ticks per real second while skipping: one game day in the configured real seconds. */
const SKIP_TICKS_PER_SECOND = TICKS_PER_DAY / BUSINESS.skipDay.realSeconds;
const PERF_INTERVAL_MS = 500;

const pool = new SnapshotPool(3);
const viewCache = new WeakMap<ArrayBuffer, SnapshotViews>();

let sim: Sim | null = null;
let speed: Speed = 1;
let backlog = 0;
let lastLoop = 0;
let lastSnapshot = 0;
let lastPerf = 0;
let tickAccumulator = 0;
/** The tick a running skip ends at, and the tick it started at; -1 when no skip runs (T92). */
let skipUntil = -1;
let skipFrom = 0;
let msAccumulator = 0;
let ticksMeasured = 0;
const eventScratch: string[] = [];
let loopHandle: ReturnType<typeof setTimeout> | null = null;
const overlayPublisher = new OverlayPublisher();
/** One reusable overlay per terminal building, filled in place each publish. */
const overlayScratch: OverlayData[] = [];

function viewsFor(buffer: ArrayBuffer): SnapshotViews {
  let v = viewCache.get(buffer);
  if (!v) {
    v = createSnapshotViews(buffer);
    viewCache.set(buffer, v);
  }
  return v;
}

function effectiveSpeed(): number {
  // Over 50 ticks of backlog the speed drops to half (at least 1x), so 8x on a busy airport settles near what the CPU holds (T91).
  return backlog > BACKLOG_SPEED_CAP_TICKS ? Math.max(Math.min(speed, 1), speed / 2) : speed;
}

function postOwnershipIfDirty(): void {
  if (!sim || !sim.takeOwnershipDirty()) return;
  const owner = new Uint8Array(sim.parcelOwner);
  scope.postMessage({ type: 'staticData', kind: 'ownership', payload: { owner, cash: sim.cash } }, [owner.buffer]);
}

function postAirfieldIfDirty(): void {
  if (!sim || !sim.takeAirfieldDirty()) return;
  scope.postMessage({
    type: 'staticData',
    kind: 'airfield',
    payload: { airfield: sim.airfield.data, canUndo: sim.canUndo, canRedo: sim.canRedo },
  });
}

function postBusinessIfDirty(): void {
  if (!sim) return;
  const grids = sim.takeTerminalGrids();
  if (grids) scope.postMessage({ type: 'staticData', kind: 'terminals', payload: grids });
  const payload = sim.takeBusiness();
  if (payload) scope.postMessage({ type: 'staticData', kind: 'business', payload });
}

function blankOverlay(): OverlayData {
  return { building: 0, w: 0, h: 0, density: new Uint16Array(0), nodeCell: new Int32Array(0), nodeQueue: new Uint16Array(0), nodeWaitS: new Uint16Array(0), gateCell: new Int32Array(0), gateDistM: new Uint16Array(0), stationCell: new Int32Array(0), stationNeed: new Uint8Array(0), stationPresent: new Uint8Array(0) };
}

/** A copy of an overlay that owns its arrays, so the scratch buffers stay in the worker. */
function copyOverlay(o: OverlayData): OverlayData {
  return {
    building: o.building,
    w: o.w,
    h: o.h,
    density: o.density.slice(),
    nodeCell: o.nodeCell.slice(),
    nodeQueue: o.nodeQueue.slice(),
    nodeWaitS: o.nodeWaitS.slice(),
    gateCell: o.gateCell.slice(),
    gateDistM: o.gateDistM.slice(),
    stationCell: o.stationCell.slice(),
    stationNeed: o.stationNeed.slice(),
    stationPresent: o.stationPresent.slice(),
    bag: o.bag
      ? { linkPts: o.bag.linkPts.slice(), linkStart: o.bag.linkStart.slice(), linkLoad: o.bag.linkLoad.slice(), linkFlags: o.bag.linkFlags.slice(), nodePos: o.bag.nodePos.slice(), nodeFill: o.bag.nodeFill.slice(), nodeFlags: o.bag.nodeFlags.slice() }
      : undefined,
  };
}

/** Publishes the terminal overlays of every building when the feed is due. Nothing is built while it is off. */
function postOverlayIfDue(): void {
  if (!sim || !overlayPublisher.due(sim.tick)) return;
  const count = sim.terminalCount();
  const buildings: OverlayData[] = [];
  for (let i = 0; i < count; i++) {
    const out = sim.overlayData(i, overlayScratch[i] ?? blankOverlay());
    overlayScratch[i] = out;
    buildings.push(copyOverlay(out));
  }
  scope.postMessage({ type: 'overlayData', tick: sim.tick, buildings });
  overlayPublisher.mark(sim.tick);
}

function postEvents(): void {
  if (!sim) return;
  sim.drainEvents(eventScratch);
  if (eventScratch.length > 0) {
    scope.postMessage({ type: 'events', list: eventScratch.slice() });
    eventScratch.length = 0;
  }
}

function transferList(site: ReturnType<typeof toPayload>): ArrayBuffer[] {
  return [
    site.heights.buffer,
    site.landClass.buffer,
    site.parcelId.buffer,
    site.parcelType.buffer,
    site.parcelAreaHa.buffer,
    site.parcelPrice.buffer,
    site.parcelExtraCost.buffer,
    site.parcelResettleDays.buffer,
    site.parcelCx.buffer,
    site.parcelCy.buffer,
    site.windFreq.buffer,
    site.windMeanKt.buffer,
  ] as ArrayBuffer[];
}

function loop(): void {
  loopHandle = null;
  if (!sim) return;
  const now = performance.now();
  const dt = Math.min(now - lastLoop, 250);
  lastLoop = now;

  if (skipUntil >= 0) {
    // Skip to the morning: every tick runs, at the skip rate or as fast as the slice allows, whatever the speed.
    tickAccumulator += (dt / 1000) * SKIP_TICKS_PER_SECOND;
    const start = performance.now();
    while (tickAccumulator >= 1 && sim.tick < skipUntil && performance.now() - start < SKIP_SLICE_MS) {
      const t0 = performance.now();
      sim.step();
      postOverlayIfDue();
      msAccumulator += performance.now() - t0;
      ticksMeasured++;
      tickAccumulator -= 1;
    }
    if (tickAccumulator > SKIP_TICKS_PER_SECOND / 4) tickAccumulator = SKIP_TICKS_PER_SECOND / 4;
    backlog = 0;
    if (sim.tick >= skipUntil) {
      skipUntil = -1;
      tickAccumulator = 0;
      lastPerf = 0;
    }
  } else if (speed > 0) {
    tickAccumulator += (dt / 1000) * TICKS_PER_REAL_SECOND_AT_1X * effectiveSpeed();
    const start = performance.now();
    while (tickAccumulator >= 1 && performance.now() - start < MAX_SLICE_MS) {
      const t0 = performance.now();
      sim.step();
      postOverlayIfDue();
      msAccumulator += performance.now() - t0;
      ticksMeasured++;
      tickAccumulator -= 1;
    }
    backlog = Math.floor(tickAccumulator);
    // Never replay lost real time: drop the backlog beyond one real second of ticks at the current speed.
    const backlogCap = TICKS_PER_REAL_SECOND_AT_1X * Math.max(1, effectiveSpeed());
    if (tickAccumulator > backlogCap) tickAccumulator = backlogCap;
  } else {
    // Paused: keep applying queued commands so builds work while paused, without advancing time.
    sim.flushCommands();
    tickAccumulator = 0;
    backlog = 0;
  }

  postOwnershipIfDirty();
  postAirfieldIfDirty();
  postBusinessIfDirty();
  postEvents();

  if (now - lastSnapshot >= SNAPSHOT_INTERVAL_MS) {
    const buffer = pool.acquire();
    if (buffer) {
      sim.writeSnapshot(viewsFor(buffer));
      scope.postMessage({ type: 'snapshot', tick: sim.tick, buffer }, [buffer]);
      lastSnapshot = now;
    }
  }

  if (now - lastPerf >= PERF_INTERVAL_MS) {
    scope.postMessage({
      type: 'perf',
      report: {
        simMsPerTick: ticksMeasured > 0 ? msAccumulator / ticksMeasured : 0,
        tickBacklog: backlog,
        aircraftCount: sim.aircraftCount,
        standsFree: sim.standsFree,
        skip: skipUntil >= 0 ? (sim.tick - skipFrom) / Math.max(1, skipUntil - skipFrom) : -1,
      },
    });
    msAccumulator = 0;
    ticksMeasured = 0;
    lastPerf = now;
  }

  loopHandle = setTimeout(loop, 4);
}

/** The grid id of a walkGraph query, null when the args are not an object with a number grid. */
function gridArg(args: unknown): number | null {
  if (typeof args !== 'object' || args === null || !('grid' in args)) return null;
  return typeof args.grid === 'number' ? args.grid : null;
}

scope.onmessage = (event) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init':
        scope.postMessage({ type: 'reset' });
        sim = new Sim(msg.seed, msg.options);
        skipUntil = -1;
        if (msg.saveData !== undefined) sim.restore(msg.saveData);
        lastLoop = performance.now();
        tickAccumulator = 0;
        {
          const payload = toPayload(sim.site);
          scope.postMessage({ type: 'staticData', kind: 'site', payload }, transferList(payload));
        }
        postOwnershipIfDirty();
        postAirfieldIfDirty();
        scope.postMessage({ type: 'ready' });
        if (loopHandle === null) loopHandle = setTimeout(loop, 0);
        break;
      case 'preview': {
        const payload = toPayload(generateSite(msg.seed, msg.preset));
        scope.postMessage({ type: 'staticData', kind: 'preview', payload }, transferList(payload));
        break;
      }
      case 'commands':
        if (sim) for (let i = 0; i < msg.list.length; i++) sim.enqueue(msg.list[i]);
        break;
      case 'setSpeed':
        speed = msg.multiplier;
        break;
      case 'skipDay':
        if (sim && msg.on) {
          skipFrom = sim.tick;
          skipUntil = nextClockTick(sim.tick, BUSINESS.skipDay.untilMinute);
        } else skipUntil = -1;
        tickAccumulator = 0;
        lastPerf = 0;
        break;
      case 'overlaySub':
        // Publishes at once, even while paused, so an overlay opened in pause shows data.
        overlayPublisher.setOn(msg.on);
        postOverlayIfDue();
        break;
      case 'save':
        if (sim) scope.postMessage({ type: 'saved', id: msg.id, data: JSON.stringify(sim.serialize()), tick: sim.tick });
        break;
      case 'returnBuffer':
        pool.release(msg.buffer);
        break;
      case 'query': {
        // Only the walkGraph kind is answered, for the debug overlay. Every other kind gets null.
        const grid = msg.kind === 'walkGraph' ? gridArg(msg.args) : null;
        const data = sim && grid !== null ? sim.business.walkGraphView(grid) : null;
        if (data) {
          scope.postMessage({ type: 'queryResult', id: msg.id, data }, [data.nodeX.buffer, data.nodeY.buffer, data.nodeKind.buffer, data.edgeStart.buffer, data.edgeTo.buffer]);
        } else {
          scope.postMessage({ type: 'queryResult', id: msg.id, data: null });
        }
        break;
      }
    }
  } catch (err) {
    scope.postMessage({
      type: 'error',
      tick: sim ? sim.tick : 0,
      seed: sim ? sim.seed : '',
      message: String(err),
      commands: sim ? sim.log.tail(500) : [],
    });
  }
};
