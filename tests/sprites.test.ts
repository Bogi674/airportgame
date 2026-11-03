import { describe, expect, it } from 'vitest';
import { AIRCRAFT, SPRITE_BASES } from '@data/aircraft';
import { buildGeometry, extent } from '@render/sprites/geometry';

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
