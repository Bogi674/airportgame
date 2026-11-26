import { describe, expect, it } from 'vitest';
import type { Taxiway } from '@shared/airfield';
import { alignSegmentHit, findSnap, taxiNodes } from '@shared/pavement/snap';

const tw = (id: number, pts: { x: number; y: number }[]): Taxiway => ({ id, points: pts, code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 0, name: 'B' }) as unknown as Taxiway;

describe('piece ending on a taxiway segment', () => {
  const taxiways = [tw(1, [{ x: 0, y: 0 }, { x: 0, y: 400 }])];
  const nodes = taxiNodes(taxiways);
  const prev = { x: -100, y: 200 };

  it('slides to meet the taxiway square when the drawn heading is near a right angle', () => {
    const hit = findSnap(taxiways, nodes, { x: 2, y: 208 });
    expect(hit?.kind).toBe('segment');
    const a = alignSegmentHit(hit!, taxiways, nodes, prev, [30]);
    expect(a?.square).toBe(true);
    expect(a?.hit.p.x).toBeCloseTo(0, 6);
    expect(a?.hit.p.y).toBeCloseTo(200, 6);
  });

  it('falls back to a heading step of the frame', () => {
    const hit = findSnap(taxiways, nodes, { x: 0, y: 140 })!;
    const a = alignSegmentHit(hit, taxiways, nodes, prev, [0]);
    expect(a?.square).toBe(false);
    expect(a?.headingDeg).toBe(60);
    expect(a?.hit.p.y).toBeCloseTo(200 - 100 / Math.tan((60 * Math.PI) / 180), 6);
  });

  it('leaves the hit alone when no candidate is close', () => {
    const hit = findSnap(taxiways, nodes, { x: 0, y: 120 })!;
    expect(alignSegmentHit(hit, taxiways, nodes, prev, [0])).toBeNull();
  });
});
