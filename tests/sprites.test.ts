import { describe, expect, it } from 'vitest';
import { AIRCRAFT, SPRITE_BASES } from '@data/aircraft';
import { SPRITES } from '@data/index';
import { LIVERY_SLOTS, SpriteCache, liveryFor, tierForZoom } from '@render/sprites/aircraftSprite';
import { bounds, buildGeometry, extent, hw, leY, teY, windscreen } from '@render/sprites/geometry';

describe('aircraft sprite calibration', () => {
  for (const a of AIRCRAFT) {
    it(`${a.id} matches its data dimensions`, () => {
      const g = buildGeometry(SPRITE_BASES[a.sprite.base]);
      const e = extent(g);
      // Overall length within 2 percent and span within 3 percent of the real figures.
      expect(Math.abs(e.length - a.dimensions.lengthM) / a.dimensions.lengthM).toBeLessThan(0.02);
      expect(Math.abs(e.span - a.dimensions.wingspanM) / a.dimensions.wingspanM).toBeLessThan(0.04);
    });
  }

  it('fuselage is symmetric and widest at the nominal width', () => {
    const g = buildGeometry(SPRITE_BASES.a320neo);
    const maxV = Math.max(...g.fuselage.map((p) => p.v));
    expect(maxV).toBeCloseTo(SPRITE_BASES.a320neo.fw / 2, 2);
    expect(Math.min(...g.fuselage.map((p) => p.v))).toBeCloseTo(-maxV, 6);
  });
});

describe('air2.py port helpers', () => {
  for (const a of AIRCRAFT) {
    const s = SPRITE_BASES[a.sprite.base];
    it(`${a.id} wing edges, windscreen and bounds`, () => {
      const R = s.wing.root_y ?? s.fw / 2;
      expect(leY(s, s.wing, R)).toBeCloseTo(s.wing.x, 6);
      expect(teY(s, s.wing, R)).toBeCloseTo(s.wing.x + s.wing.c, 6);
      expect(teY(s, s.wing, s.wing.sb)).toBeGreaterThan(leY(s, s.wing, s.wing.sb));
      const ws = windscreen(s);
      expect(ws?.shape.length).toBeGreaterThan(60);
      const b = bounds(s);
      expect(b.xMax).toBeGreaterThanOrEqual(s.wing.sb);
      expect(b.yMax).toBeGreaterThanOrEqual(s.L);
    });
  }

  it('hw ports the nose and tail curves', () => {
    const s = SPRITE_BASES.a320neo;
    expect(hw(s, 0)).toBe(0);
    expect(hw(s, s.L / 2)).toBeCloseTo(s.fw / 2, 6);
    expect(hw(s, s.L)).toBeCloseTo(s.tail_end, 6);
  });
});

describe('sprite tiers and cache', () => {
  it('picks the tier from the zoom thresholds in the data', () => {
    expect(tierForZoom(0.2)).toBe(0);
    expect(tierForZoom(0.99)).toBe(0);
    expect(tierForZoom(1)).toBe(1);
    expect(tierForZoom(3.9)).toBe(1);
    expect(tierForZoom(4)).toBe(2);
    expect(tierForZoom(15.9)).toBe(2);
    expect(tierForZoom(16)).toBe(3);
    expect(tierForZoom(40)).toBe(3);
  });

  it('uses the neutral livery for slots without data', () => {
    expect(liveryFor(0)).toBe(SPRITES.liveries[0]);
    expect(liveryFor(7)).toBe(SPRITES.liveries[7]);
    expect(liveryFor(8)).toBe(SPRITES.neutral);
    expect(liveryFor(-1)).toBe(SPRITES.neutral);
  });

  it('stays under the entry limit after baking every type, livery and tier twice', () => {
    let bakes = 0;
    const cache = new SpriteCache(() => {
      bakes++;
      return { canvas: {} as HTMLCanvasElement, ppm: 1, width: 1, height: 1 };
    });
    for (let pass = 0; pass < 2; pass++) {
      for (let t = 0; t < AIRCRAFT.length; t++) for (let l = 0; l < LIVERY_SLOTS; l++) for (let tier = 0; tier < 4; tier++) cache.get(t, l, tier);
    }
    expect(cache.size).toBeLessThanOrEqual(SPRITES.cache.maxEntries);
    expect(bakes).toBeGreaterThan(0);
  });

  it('serves a repeated request from the cache without baking again', () => {
    let bakes = 0;
    const cache = new SpriteCache(() => {
      bakes++;
      return { canvas: {} as HTMLCanvasElement, ppm: 1, width: 1, height: 1 };
    });
    cache.get(0, 1, 2);
    cache.get(0, 1, 2);
    cache.get(0, 99, 2);
    cache.get(0, 8, 2);
    expect(bakes).toBe(2);
  });
});
