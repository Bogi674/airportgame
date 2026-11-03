import { describe, expect, it } from 'vitest';
import { bandForZoom, ChunkCache, chunkKey, CHUNKS_PER_SIDE } from '@render/chunks';

function setup() {
  const requests: number[] = [];
  const cache = new ChunkCache({ request: (key) => requests.push(key) });
  return { cache, requests };
}
const img = {} as CanvasImageSource;

describe('bandForZoom', () => {
  it('maps the zoom range onto three bands', () => {
    expect(bandForZoom(0.05)).toBe(0);
    expect(bandForZoom(1)).toBe(1);
    expect(bandForZoom(40)).toBe(2);
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
