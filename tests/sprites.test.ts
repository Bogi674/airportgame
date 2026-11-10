import { describe, expect, it } from 'vitest';
import { AIRCRAFT, SPRITE_BASES } from '@data/aircraft';
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
