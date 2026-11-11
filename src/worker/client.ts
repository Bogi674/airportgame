import SimWorker from './sim.ts?worker&inline';
import type { Command } from '@sim/commands';
import type { BusinessPayload, TerminalGrid } from '@shared/business';
import type { AirfieldMessage, FromSimMessage, GameOptions, OwnershipPayload, PerfReport, ToSimMessage } from '@shared/protocol';
import type { SitePayload } from '@shared/site';
import { createSnapshotViews, SnapHeader, type SnapshotViews } from '@shared/snapshot';
import { SNAPSHOT_INTERVAL_MS, type Speed } from '@shared/time';

interface Held {
  buffer: ArrayBuffer;
  views: SnapshotViews;
  receivedAt: number;
}

export interface CrashReport {
  message: string;
  tick: number;
  seed: string;
  commands: unknown[];
}

export interface ClientEvents {
  onPerf?(report: PerfReport): void;
  onError?(message: string): void;
  /** The sim stopped: the tick, seed, error and the last commands, for the crash panel and the copied report. */
  onCrash?(report: CrashReport): void;
  onSite?(site: SitePayload): void;
  onOwnership?(ownership: OwnershipPayload): void;
  onEvents?(list: string[]): void;
  onAirfield?(msg: AirfieldMessage): void;
  onBusiness?(b: BusinessPayload): void;
  onTerminals?(grids: TerminalGrid[]): void;
  onSaved?(id: number, data: string, tick: number): void;
  onQueryResult?: (id: number, data: unknown) => void;
}

/** Main thread side of the sim protocol. Owns the worker, batches commands per frame, recycles buffers. */
export class SimClient {
  private readonly worker: Worker;
  private curr: Held | null = null;
  private prev: Held | null = null;
  private readonly outbox: Command[] = [];
  private flushScheduled = false;

  constructor(private readonly events: ClientEvents = {}) {
    // Inline workers run from a blob URL, so the built game also runs from a single file on disk.
    this.worker = new SimWorker();
    this.worker.onmessage = (e: MessageEvent<FromSimMessage>) => this.handle(e.data);
    this.worker.onerror = (e) => {
      this.events.onError?.(e.message);
      this.events.onCrash?.({ message: e.message, tick: this.tick, seed: '', commands: [] });
    };
  }

  private post(msg: ToSimMessage, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  init(seed: string, options: GameOptions, saveData?: unknown): void {
    this.post({ type: 'init', seed, options, saveData });
  }

  /** Asks the worker for the full state. The answer arrives through `onSaved`. */
  requestSave(id: number): void {
    this.post({ type: 'save', id });
  }

  /** Asks the worker a question by kind. The answer arrives through `onQueryResult` with the same id. */
  query(id: number, kind: string, args: unknown): void {
    this.post({ type: 'query', id, kind, args });
  }

  setSpeed(multiplier: Speed): void {
    this.post({ type: 'setSpeed', multiplier });
  }

  /** Queues a command. Commands are sent in one batch per animation frame. */
  send(cmd: Command): void {
    this.outbox.push(cmd);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      requestAnimationFrame(() => this.flush());
    }
  }

  private flush(): void {
    this.flushScheduled = false;
    if (this.outbox.length === 0) return;
    this.post({ type: 'commands', list: this.outbox.splice(0, this.outbox.length) });
  }

  private handle(msg: FromSimMessage): void {
    switch (msg.type) {
      case 'snapshot': {
        // Return the buffer from two snapshots ago, keep the last two for interpolation.
        if (this.prev) this.post({ type: 'returnBuffer', buffer: this.prev.buffer }, [this.prev.buffer]);
        this.prev = this.curr;
        this.curr = { buffer: msg.buffer, views: createSnapshotViews(msg.buffer), receivedAt: performance.now() };
        break;
      }
      case 'staticData':
        if (msg.kind === 'site') this.events.onSite?.(msg.payload);
        else if (msg.kind === 'ownership') this.events.onOwnership?.(msg.payload);
        else if (msg.kind === 'airfield') this.events.onAirfield?.(msg.payload);
        else if (msg.kind === 'business') this.events.onBusiness?.(msg.payload);
        else this.events.onTerminals?.(msg.payload);
        break;
      case 'events':
        this.events.onEvents?.(msg.list);
        break;
      case 'saved':
        this.events.onSaved?.(msg.id, msg.data, msg.tick);
        break;
      case 'queryResult':
        this.events.onQueryResult?.(msg.id, msg.data);
        break;
      case 'perf':
        this.events.onPerf?.(msg.report);
        break;
      case 'error':
        this.events.onError?.(msg.message);
        this.events.onCrash?.({ message: msg.message, tick: msg.tick, seed: msg.seed, commands: msg.commands });
        break;
      default:
        break;
    }
  }

  /** Views for interpolation plus the factor between them, based on wall time since the newest snapshot. */
  frame(now: number): { prev: SnapshotViews | null; curr: SnapshotViews | null; alpha: number } {
    if (!this.curr) return { prev: null, curr: null, alpha: 1 };
    const alpha = Math.min(1, Math.max(0, (now - this.curr.receivedAt) / SNAPSHOT_INTERVAL_MS));
    return { prev: this.prev ? this.prev.views : null, curr: this.curr.views, alpha };
  }

  get tick(): number {
    return this.curr ? this.curr.views.header[SnapHeader.Tick] : 0;
  }

  dispose(): void {
    this.worker.terminate();
  }
}
