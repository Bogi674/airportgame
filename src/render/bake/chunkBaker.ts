import BakeWorker from './bakeWorker.ts?worker&inline';
import type { BakeSite, FromBakeMessage, ToBakeMessage } from '@shared/protocol';
import { chunkPixelSize, type ChunkRequester } from '../chunks';
import { TerrainBaker } from '../terrain';
import { paintAirfield } from '../markings/airfieldPaint';
import { EMPTY_AIRFIELD, type AirfieldPayload } from '@shared/airfield';
import type { TerminalGrid } from '@shared/business';

type Deliver = (key: number, image: CanvasImageSource) => void;

export interface ChunkBaker extends ChunkRequester {
  setSite(site: BakeSite): void;
  setAirfield(airfield: AirfieldPayload): void;
  setTerminals(terminals: TerminalGrid[]): void;
  setOwner(owner: Uint8Array): void;
  dispose(): void;
}

/** Bakes in the bake worker when OffscreenCanvas exists, otherwise on the main thread in 4 ms slices. */
export function createChunkBaker(deliver: Deliver): ChunkBaker {
  if (typeof OffscreenCanvas !== 'undefined') return new WorkerBaker(deliver);
  return new MainThreadBaker(deliver);
}

class WorkerBaker implements ChunkBaker {
  private readonly worker = new BakeWorker();

  constructor(deliver: Deliver) {
    this.worker.onmessage = (event: MessageEvent<FromBakeMessage>) => {
      const msg = event.data;
      if (msg.type === 'baked') deliver(msg.key, msg.bitmap);
    };
  }

  setSite(site: BakeSite): void {
    const msg: ToBakeMessage = { type: 'site', site };
    this.worker.postMessage(msg);
  }

  setAirfield(airfield: AirfieldPayload): void {
    const msg: ToBakeMessage = { type: 'airfield', airfield };
    this.worker.postMessage(msg);
  }

  setTerminals(terminals: TerminalGrid[]): void {
    const msg: ToBakeMessage = { type: 'terminals', terminals };
    this.worker.postMessage(msg);
  }

  setOwner(owner: Uint8Array): void {
    const msg: ToBakeMessage = { type: 'owner', owner: owner.slice() };
    this.worker.postMessage(msg);
  }

  request(key: number, band: number, cx: number, cy: number): void {
    const msg: ToBakeMessage = { type: 'bake', key, band, cx, cy };
    this.worker.postMessage(msg);
  }

  dispose(): void {
    this.worker.terminate();
  }
}

class MainThreadBaker implements ChunkBaker {
  private readonly queue: { key: number; band: number; cx: number; cy: number }[] = [];
  private scheduled = false;
  private terrain: TerrainBaker | null = null;
  private airfield: AirfieldPayload = EMPTY_AIRFIELD;
  private terminals: TerminalGrid[] = [];

  constructor(private readonly deliver: Deliver) {}

  setTerminals(terminals: TerminalGrid[]): void {
    this.terminals = terminals;
  }

  setOwner(owner: Uint8Array): void {
    this.terrain?.setOwner(owner);
  }

  setAirfield(airfield: AirfieldPayload): void {
    this.airfield = airfield;
  }

  setSite(site: BakeSite): void {
    this.terrain = new TerrainBaker(site);
  }

  request(key: number, band: number, cx: number, cy: number): void {
    this.queue.push({ key, band, cx, cy });
    if (!this.scheduled) {
      this.scheduled = true;
      requestAnimationFrame(() => this.drain());
    }
  }

  private drain(): void {
    this.scheduled = false;
    const start = performance.now();
    while (this.queue.length > 0 && this.terrain && performance.now() - start < 4) {
      const job = this.queue.shift();
      if (!job) break;
      const px = chunkPixelSize(job.band);
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.putImageData(this.terrain.bake(job.band, job.cx, job.cy), 0, 0);
      paintAirfield(ctx, this.airfield, this.terminals, job.band, job.cx, job.cy);
      this.deliver(job.key, canvas);
    }
    if (this.queue.length > 0) {
      this.scheduled = true;
      requestAnimationFrame(() => this.drain());
    }
  }

  dispose(): void {
    this.queue.length = 0;
  }
}
