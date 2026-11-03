import { describe, expect, it } from 'vitest';
import { SnapshotPool } from '@shared/bufferPool';
import { SNAPSHOT_BYTES, createSnapshotBuffer, createSnapshotViews } from '@shared/snapshot';
import { cosLut, sinLut } from '@shared/trig';

describe('trig tables', () => {
  it('match Math.sin and Math.cos closely', () => {
    for (let a = -20; a < 20; a += 0.0137) {
      expect(Math.abs(sinLut(a) - Math.sin(a))).toBeLessThan(2e-6);
      expect(Math.abs(cosLut(a) - Math.cos(a))).toBeLessThan(2e-6);
    }
  });
});

describe('snapshot layout', () => {
  it('views do not overlap and fit the buffer', () => {
    const buf = createSnapshotBuffer();
    expect(buf.byteLength).toBe(SNAPSHOT_BYTES);
    const v = createSnapshotViews(buf);
    const ranges = Object.values(v).map((a) => [a.byteOffset, a.byteOffset + a.byteLength] as const);
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBeGreaterThanOrEqual(ranges[i - 1][1]);
    expect(ranges[ranges.length - 1][1]).toBeLessThanOrEqual(SNAPSHOT_BYTES);
  });
});

describe('SnapshotPool', () => {
  it('hands out three buffers then runs dry', () => {
    const pool = new SnapshotPool();
    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();
    expect(a && b && c).toBeTruthy();
    expect(pool.acquire()).toBeNull();
  });

  it('gets a buffer back after transfer and return', () => {
    const pool = new SnapshotPool(1);
    const buf = pool.acquire() as ArrayBuffer;
    const moved = structuredClone(buf, { transfer: [buf] });
    expect(buf.byteLength).toBe(0);
    expect(pool.acquire()).toBeNull();
    pool.release(moved);
    expect(pool.acquire()).toBe(moved);
  });

  it('ignores detached buffers', () => {
    const pool = new SnapshotPool(1);
    const buf = pool.acquire() as ArrayBuffer;
    structuredClone(buf, { transfer: [buf] });
    pool.release(buf);
    expect(pool.available).toBe(0);
  });
});
