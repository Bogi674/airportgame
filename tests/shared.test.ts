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

import { atan2Det } from '@shared/trig';
import { distToSegment, pointInPolygon, polylineLength, segmentIntersection } from '@shared/geom';

describe('atan2Det', () => {
  it('matches Math.atan2 in every quadrant', () => {
    for (let a = -3.1; a < 3.1; a += 0.0173) {
      const y = Math.sin(a) * 7;
      const x = Math.cos(a) * 7;
      expect(Math.abs(atan2Det(y, x) - Math.atan2(y, x))).toBeLessThan(1e-7);
    }
    expect(atan2Det(0, 0)).toBe(0);
    expect(atan2Det(0, -1)).toBeCloseTo(Math.PI, 9);
  });
});

describe('geom', () => {
  it('measures segments and polygons', () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distToSegment(-4, 3, 0, 0, 10, 0)).toBe(5);
    expect(segmentIntersection(0, 0, 10, 0, 5, -5, 5, 5)).toBeCloseTo(0.5);
    expect(segmentIntersection(0, 0, 10, 0, 5, 1, 5, 5)).toBe(-1);
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11);
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon(5, 5, sq)).toBe(true);
    expect(pointInPolygon(15, 5, sq)).toBe(false);
  });
});

describe('trig lookup edge', () => {
  it('stays finite for angles a hair below zero', async () => {
    const { cosLut, sinLut } = await import('@shared/trig');
    for (const a of [-1e-17, -2.2e-16, -1.5707963267948968]) {
      expect(Number.isFinite(sinLut(a))).toBe(true);
      expect(Number.isFinite(cosLut(a))).toBe(true);
    }
    expect(cosLut(-1.5707963267948968)).toBeCloseTo(0, 6);
  });
});
