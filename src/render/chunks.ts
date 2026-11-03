import { CHUNK_SIZE_M, SITE_SIZE_M } from '@shared/math';

/** Zoom bands in px/m. Each band bakes chunks at its own raster scale. */
export const BAND_MAX_ZOOM = [0.4, 3.2, Infinity] as const;
/** Raster scale in pixels per meter used when baking each band. */
export const BAND_RASTER_SCALE = [0.25, 1, 4] as const;
export const BAND_COUNT = BAND_MAX_ZOOM.length;

export const CHUNKS_PER_SIDE = Math.ceil(SITE_SIZE_M / CHUNK_SIZE_M);

export function bandForZoom(zoom: number): number {
  for (let b = 0; b < BAND_COUNT; b++) if (zoom < BAND_MAX_ZOOM[b]) return b;
  return BAND_COUNT - 1;
}

export function chunkKey(band: number, cx: number, cy: number): number {
  return (band * CHUNKS_PER_SIDE + cy) * CHUNKS_PER_SIDE + cx;
}

export function chunkPixelSize(band: number): number {
  return Math.round(CHUNK_SIZE_M * BAND_RASTER_SCALE[band]);
}

export type ChunkState = 'pending' | 'ready';

export interface ChunkEntry {
  key: number;
  band: number;
  cx: number;
  cy: number;
  state: ChunkState;
  dirty: boolean;
  image: CanvasImageSource | null;
  lastUsed: number;
}

/** Asks something to bake a chunk. The result comes back through `ChunkCache.deliver`. */
export interface ChunkRequester {
  request(key: number, band: number, cx: number, cy: number): void;
}

/**
 * Cache of baked static chunks. Keeps the visible chunks plus one ring in the current band.
 * Other bands stay as a fallback until every visible chunk of the current band is ready.
 */
export class ChunkCache {
  private readonly entries = new Map<number, ChunkEntry>();
  private frame = 0;

  constructor(private readonly requester: ChunkRequester) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: number): ChunkEntry | undefined {
    return this.entries.get(key);
  }

  /** Marks a chunk dirty so it re-bakes the next time it is visible. */
  markDirty(cx: number, cy: number): void {
    for (let b = 0; b < BAND_COUNT; b++) {
      const e = this.entries.get(chunkKey(b, cx, cy));
      if (e) e.dirty = true;
    }
  }

  /** Called with a baked image. Releases ImageBitmaps that were replaced. */
  deliver(key: number, image: CanvasImageSource): void {
    const e = this.entries.get(key);
    if (!e) {
      closeImage(image);
      return;
    }
    if (e.image && e.image !== image) closeImage(e.image);
    e.image = image;
    e.state = 'ready';
  }

  /**
   * Ensures every chunk in the inclusive range [minCx..maxCx] x [minCy..maxCy] of `band`
   * exists, requests missing or dirty ones, and evicts what is outside the range plus a ring.
   * Returns true when every visible chunk is ready.
   */
  update(band: number, minCx: number, minCy: number, maxCx: number, maxCy: number): boolean {
    this.frame++;
    const x0 = Math.max(0, minCx);
    const y0 = Math.max(0, minCy);
    const x1 = Math.min(CHUNKS_PER_SIDE - 1, maxCx);
    const y1 = Math.min(CHUNKS_PER_SIDE - 1, maxCy);
    let allReady = true;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = chunkKey(band, cx, cy);
        let e = this.entries.get(key);
        if (!e) {
          e = { key, band, cx, cy, state: 'pending', dirty: false, image: null, lastUsed: this.frame };
          this.entries.set(key, e);
          this.requester.request(key, band, cx, cy);
        } else if (e.dirty && e.state === 'ready') {
          e.dirty = false;
          e.state = 'pending';
          this.requester.request(key, band, cx, cy);
        }
        e.lastUsed = this.frame;
        if (e.state !== 'ready') allReady = false;
      }
    }
    this.evict(band, x0 - 1, y0 - 1, x1 + 1, y1 + 1, allReady);
    return allReady;
  }

  private evict(band: number, x0: number, y0: number, x1: number, y1: number, keepOtherBands: boolean): void {
    for (const e of this.entries.values()) {
      const inRing = e.band === band && e.cx >= x0 && e.cx <= x1 && e.cy >= y0 && e.cy <= y1;
      const keepAsFallback = e.band !== band && !keepOtherBands && e.lastUsed >= this.frame - 120;
      if (inRing || keepAsFallback) continue;
      closeImage(e.image);
      this.entries.delete(e.key);
    }
  }

  /** Drops every chunk, for example when a new game starts. Late deliveries are ignored. */
  clear(): void {
    for (const e of this.entries.values()) closeImage(e.image);
    this.entries.clear();
  }

  dispose(): void {
    this.clear();
  }
}

function closeImage(image: CanvasImageSource | null): void {
  if (image && typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
}
