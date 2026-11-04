import { SnapshotPool } from '@shared/bufferPool';
import type { FromSimMessage, ToSimMessage } from '@shared/protocol';
import { createSnapshotViews, type SnapshotViews } from '@shared/snapshot';
import {
  BACKLOG_SPEED_CAP_TICKS,
  SNAPSHOT_INTERVAL_MS,
  TICKS_PER_REAL_SECOND_AT_1X,
  type Speed,
} from '@shared/time';
import { Sim } from '@sim/sim';
import { toPayload } from '@sim/world/site';
import type { WorkerScope } from './scope';

const scope = self as unknown as WorkerScope<ToSimMessage, FromSimMessage>;

/** Wall clock slice per loop pass, so the worker stays responsive to messages. */
const MAX_SLICE_MS = 8;
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
let msAccumulator = 0;
let ticksMeasured = 0;
const eventScratch: string[] = [];
let loopHandle: ReturnType<typeof setTimeout> | null = null;

function viewsFor(buffer: ArrayBuffer): SnapshotViews {
  let v = viewCache.get(buffer);
  if (!v) {
    v = createSnapshotViews(buffer);
    viewCache.set(buffer, v);
  }
  return v;
}

function effectiveSpeed(): number {
  // Over 50 ticks of backlog the speed caps automatically.
  return backlog > BACKLOG_SPEED_CAP_TICKS ? Math.min(speed, 1) : speed;
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
    payload: { airfield: sim.airfield.data, canUndo: sim.airfield.canUndo, canRedo: sim.airfield.canRedo },
  });
}

function postBusinessIfDirty(): void {
  if (!sim) return;
  const grids = sim.takeTerminalGrids();
  if (grids) scope.postMessage({ type: 'staticData', kind: 'terminals', payload: grids });
  const payload = sim.takeBusiness();
  if (payload) scope.postMessage({ type: 'staticData', kind: 'business', payload });
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

  if (speed > 0) {
    tickAccumulator += (dt / 1000) * TICKS_PER_REAL_SECOND_AT_1X * effectiveSpeed();
    const start = performance.now();
    while (tickAccumulator >= 1 && performance.now() - start < MAX_SLICE_MS) {
      const t0 = performance.now();
      sim.step();
      msAccumulator += performance.now() - t0;
      ticksMeasured++;
      tickAccumulator -= 1;
    }
    backlog = Math.floor(tickAccumulator);
    // Never replay lost real time: drop the backlog beyond one second of ticks.
    if (tickAccumulator > TICKS_PER_REAL_SECOND_AT_1X) tickAccumulator = TICKS_PER_REAL_SECOND_AT_1X;
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
      },
    });
    msAccumulator = 0;
    ticksMeasured = 0;
    lastPerf = now;
  }

  loopHandle = setTimeout(loop, 4);
}

scope.onmessage = (event) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init':
        sim = new Sim(msg.seed, msg.options);
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
      case 'commands':
        if (sim) for (let i = 0; i < msg.list.length; i++) sim.enqueue(msg.list[i]);
        break;
      case 'setSpeed':
        speed = msg.multiplier;
        break;
      case 'save':
        if (sim) scope.postMessage({ type: 'saved', id: msg.id, data: JSON.stringify(sim.serialize()), tick: sim.tick });
        break;
      case 'returnBuffer':
        pool.release(msg.buffer);
        break;
      case 'query':
        // Queries arrive with the panels that need them. M0 answers with null.
        scope.postMessage({ type: 'queryResult', id: msg.id, data: null });
        break;
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
