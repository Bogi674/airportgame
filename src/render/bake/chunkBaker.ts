import type { FromBakeMessage, ToBakeMessage } from '@shared/protocol';
import { chunkPixelSize, type ChunkRequester } from '../chunks';
import { bakeChunkPlaceholder } from './bakeChunk';

type Deliver = (key: number, image: CanvasImageSource) => void;

/** Bakes in the bake worker when OffscreenCanvas exists, otherwise on the main thread in 4 ms slices. */
export function createChunkBaker(deliver: Deliver): ChunkRequester & { dispose(): void } {
  if (typeof OffscreenCanvas !== 'undefined') return new WorkerBaker(deliver);
  return new MainThreadBaker(deliver);
}

class WorkerBaker implements ChunkRequester {
  private readonly worker = new Worker(new URL('./bakeWorker.ts', import.meta.url), { type: 'module' });

  constructor(deliver: Deliver) {
    this.worker.onmessage = (event: MessageEvent<FromBakeMessage>) => {
      const msg = event.data;
      if (msg.type === 'baked') deliver(msg.key, msg.bitmap);
    };
  }

  request(key: number, band: number, cx: number, cy: number): void {
    const msg: ToBakeMessage = { type: 'bake', key, band, cx, cy };
    this.worker.postMessage(msg);
  }

  dispose(): void {
    this.worker.terminate();
  }
}

class MainThreadBaker implements ChunkRequester {
  private readonly queue: { key: number; band: number; cx: number; cy: number }[] = [];
  private scheduled = false;

  constructor(private readonly deliver: Deliver) {}

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
    while (this.queue.length > 0 && performance.now() - start < 4) {
      const job = this.queue.shift();
      if (!job) break;
      const px = chunkPixelSize(job.band);
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      bakeChunkPlaceholder(ctx, job.band, job.cx, job.cy);
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
