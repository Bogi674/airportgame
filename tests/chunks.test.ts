import { describe, expect, it } from 'vitest';
import { BAND_COUNT, BAND_RASTER_SCALE, bandForZoom, ChunkCache, chunkKey, chunkPixelSize, chunksPerSide, chunkSizeM, CHUNKS_PER_SIDE, MAX_CHUNK_PX } from '@render/chunks';
import { SITE_SIZE_M } from '@shared/math';

function setup() {
  const requests: number[] = [];
  const cache = new ChunkCache({ request: (key) => requests.push(key) });
  return { cache, requests };
}
const img = {} as CanvasImageSource;

describe('bandForZoom', () => {
  it('maps the zoom range onto the bands, coarse to fine', () => {
    expect(bandForZoom(0.05)).toBe(0);
    expect(bandForZoom(80)).toBe(BAND_COUNT - 1);
  });

  it('never magnifies a chunk more than 1.25 times below the finest band', () => {
    for (let z = 0.3; z < BAND_RASTER_SCALE[BAND_COUNT - 1]; z *= 1.07) {
      expect(z / BAND_RASTER_SCALE[bandForZoom(z)]).toBeLessThanOrEqual(1.25 + 1e-9);
    }
  });

  it('keeps every chunk at most 2048 px, tiling the site with whole base chunks', () => {
    for (let b = 0; b < BAND_COUNT; b++) {
      expect(chunkPixelSize(b)).toBeLessThanOrEqual(MAX_CHUNK_PX);
      expect(512 % chunkSizeM(b)).toBe(0);
      expect(chunksPerSide(b) * chunkSizeM(b)).toBeGreaterThanOrEqual(SITE_SIZE_M);
    }
  });

  it('gives every chunk of every band its own key', () => {
    const seen = new Set<number>();
    for (let b = 0; b < BAND_COUNT; b++) {
      const n = chunksPerSide(b);
      for (const [x, y] of [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]]) seen.add(chunkKey(b, x, y));
    }
    expect(seen.size).toBe(BAND_COUNT * 4);
  });
});

describe('ChunkCache', () => {
  it('requests each visible chunk once', () => {
    const { cache, requests } = setup();
    cache.update(1, 2, 2, 3, 3);
    cache.update(1, 2, 2, 3, 3);
    expect(requests).toHaveLength(4);
  });

  it('reports ready only when every visible chunk is delivered', () => {
    const { cache } = setup();
    expect(cache.update(1, 0, 0, 1, 0)).toBe(false);
    cache.deliver(chunkKey(1, 0, 0), img);
    expect(cache.update(1, 0, 0, 1, 0)).toBe(false);
    cache.deliver(chunkKey(1, 1, 0), img);
    expect(cache.update(1, 0, 0, 1, 0)).toBe(true);
  });

  it('clamps requests to the site', () => {
    const { cache, requests } = setup();
    cache.update(0, -3, -3, 0, 0);
    expect(requests).toEqual([chunkKey(0, 0, 0)]);
    cache.update(0, CHUNKS_PER_SIDE - 1, CHUNKS_PER_SIDE - 1, CHUNKS_PER_SIDE + 5, CHUNKS_PER_SIDE + 5);
    expect(requests).toHaveLength(2);
  });

  it('keeps one ring around the view and evicts the rest', () => {
    const { cache } = setup();
    cache.update(1, 5, 5, 5, 5);
    cache.deliver(chunkKey(1, 5, 5), img);
    cache.update(1, 8, 8, 8, 8);
    expect(cache.get(chunkKey(1, 5, 5))).toBeUndefined();
    cache.update(1, 9, 9, 9, 9);
    expect(cache.get(chunkKey(1, 8, 8))).toBeDefined();
  });

  it('keeps another band as fallback until the new band is ready', () => {
    const { cache } = setup();
    cache.update(0, 4, 4, 4, 4);
    cache.deliver(chunkKey(0, 4, 4), img);
    cache.update(1, 4, 4, 4, 4);
    expect(cache.get(chunkKey(0, 4, 4))).toBeDefined();
    cache.deliver(chunkKey(1, 4, 4), img);
    cache.update(1, 4, 4, 4, 4);
    expect(cache.get(chunkKey(0, 4, 4))).toBeUndefined();
  });

  it('re-bakes only dirty chunks', () => {
    const { cache, requests } = setup();
    cache.update(1, 3, 3, 4, 3);
    cache.deliver(chunkKey(1, 3, 3), img);
    cache.deliver(chunkKey(1, 4, 3), img);
    requests.length = 0;
    cache.markDirty(4, 3);
    cache.update(1, 3, 3, 4, 3);
    expect(requests).toEqual([chunkKey(1, 4, 3)]);
  });
});

describe('ChunkCache fine bands', () => {
  it('marks every fine chunk under a dirty base chunk', () => {
    const { cache, requests } = setup();
    const fine = BAND_COUNT - 1;
    const k = 512 / chunkSizeM(fine);
    // The last fine chunk inside base chunk (1, 1).
    const x = 2 * k - 1;
    cache.update(fine, x, x, x, x);
    cache.deliver(chunkKey(fine, x, x), img);
    cache.markDirty(1, 1);
    cache.update(fine, x, x, x, x);
    expect(requests).toHaveLength(2);
  });
});
