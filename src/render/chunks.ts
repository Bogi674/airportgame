import { CHUNK_SIZE_M, SITE_SIZE_M } from '@shared/math';

/** Raster scale in pixels per meter used when baking each band, doubling from band to band. */
export const BAND_RASTER_SCALE = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64] as const;
export const BAND_COUNT = BAND_RASTER_SCALE.length;
/** How far a band may be magnified on screen before the next band takes over, so the map stays sharp. */
const MAX_MAGNIFY = 1.25;
/** Device zoom in px/m up to which each band is used; the last band takes every closer zoom. */
export const BAND_MAX_ZOOM: readonly number[] = BAND_RASTER_SCALE.map((s, b) => (b === BAND_COUNT - 1 ? Infinity : s * MAX_MAGNIFY));
/** Largest chunk side in pixels. Fine bands use smaller chunks so no chunk exceeds it. */
export const MAX_CHUNK_PX = 2048;

/** Base chunk grid (512 m), used where something marks a site area dirty. */
export const CHUNKS_PER_SIDE = Math.ceil(SITE_SIZE_M / CHUNK_SIZE_M);

/** Side of one chunk of a band in meters: 512 m, halved per band above 4 px/m so a chunk stays at most 2048 px. */
export function chunkSizeM(band: number): number {
  return Math.min(CHUNK_SIZE_M, MAX_CHUNK_PX / BAND_RASTER_SCALE[band]);
}

/** Chunks along one side of the site in a band. */
export function chunksPerSide(band: number): number {
  return Math.ceil(SITE_SIZE_M / chunkSizeM(band));
}

const BAND_KEY_BASE: number[] = [];
for (let b = 0, k = 0; b < BAND_COUNT; b++) {
  BAND_KEY_BASE.push(k);
  k += chunksPerSide(b) * chunksPerSide(b);
}

/**
 * Band for a zoom in device pixels per meter (camera zoom times device pixel ratio): the coarsest band
 * that is magnified at most `MAX_MAGNIFY` times, so chunks are never blurry (user, 2026-11-17).
 */
export function bandForZoom(deviceZoom: number): number {
  for (let b = 0; b < BAND_COUNT; b++) if (deviceZoom < BAND_MAX_ZOOM[b]) return b;
  return BAND_COUNT - 1;
}

export function chunkKey(band: number, cx: number, cy: number): number {
  return BAND_KEY_BASE[band] + cy * chunksPerSide(band) + cx;
}

export function chunkPixelSize(band: number): number {
  return Math.round(chunkSizeM(band) * BAND_RASTER_SCALE[band]);
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

const byBand = (a: ChunkEntry, b: ChunkEntry): number => a.band - b.band;

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

  /** Marks a base (512 m) chunk dirty in every band, so it re-bakes the next time it is visible. */
  markDirty(cx: number, cy: number): void {
    for (let b = 0; b < BAND_COUNT; b++) {
      const k = Math.round(CHUNK_SIZE_M / chunkSizeM(b));
      for (let y = cy * k; y < (cy + 1) * k; y++) {
        for (let x = cx * k; x < (cx + 1) * k; x++) {
          const e = this.entries.get(chunkKey(b, x, y));
          if (e) e.dirty = true;
        }
      }
    }
  }

  /** Every baked chunk of another band than `band`, for drawing under the current band while it bakes. */
  fallbacks(band: number, out: ChunkEntry[]): ChunkEntry[] {
    out.length = 0;
    for (const e of this.entries.values()) if (e.band !== band && e.image) out.push(e);
    // Coarse bands first, so the finest fallback ends on top.
    out.sort(byBand);
    return out;
  }

  /** Marks every cached chunk dirty. Dirty chunks keep their old image until the new bake arrives. */
  markAllDirty(): void {
    for (const e of this.entries.values()) e.dirty = true;
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
    const side = chunksPerSide(band);
    const x1 = Math.min(side - 1, maxCx);
    const y1 = Math.min(side - 1, maxCy);
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
