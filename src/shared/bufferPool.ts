import { createSnapshotBuffer } from './snapshot';

/**
 * Pool of snapshot buffers owned by the sim worker. A buffer leaves the pool when it is
 * transferred to the main thread and comes back through `release` when the main thread
 * returns it (`returnBuffer` message). With no free buffer the worker drops the snapshot.
 */
export class SnapshotPool {
  private readonly free: ArrayBuffer[] = [];

  constructor(size = 3) {
    for (let i = 0; i < size; i++) this.free.push(createSnapshotBuffer());
  }

  get available(): number {
    return this.free.length;
  }

  /** Returns a free buffer, or null when all are in flight. */
  acquire(): ArrayBuffer | null {
    return this.free.pop() ?? null;
  }

  /** Takes a returned buffer back. Detached or foreign sized buffers are ignored. */
  release(buffer: ArrayBuffer): void {
    if (buffer.byteLength === 0) return;
    this.free.push(buffer);
  }
}
