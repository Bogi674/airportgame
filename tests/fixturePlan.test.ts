import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureSpritePackSchema, type FixtureOp } from '../src/data/schemas';
import {
  hull,
  planFixture,
  shade,
  shadowOffset,
  tierForZoom,
  type Pt,
  type Rot,
  type Tier,
} from '../src/render/sprites/fixturePlan';

const PPM = 10;
const ROTS: Rot[] = [0, 90, 180, 270];
const TIERS: Tier[] = [1, 2, 3];
const SPRITE_DIR = join(process.cwd(), 'src', 'data', 'fixtures', 'sprites');

const rect = (over: Partial<Extract<FixtureOp, { k: 'r' }>>): FixtureOp => ({ k: 'r', x: 0, y: 0, w: 1, h: 1, f: '#ffffff', ...over });

describe('color helpers', () => {
  it('darkens and lightens toward black and white', () => {
    expect(shade('#808080', -0.5)).toBe('#404040');
    expect(shade('#000000', 0.5)).toBe('#808080');
    expect(shade('#808080', 0.5)).toBe('#c0c0c0');
  });

  it('returns the four corners of a square when an inner point is added', () => {
    const pts: Pt[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
    ];
    const h = hull(pts);
    expect(h).toHaveLength(4);
    for (const corner of pts.slice(0, 4)) {
      expect(h).toContainEqual(corner);
    }
  });
});

describe('zoom tiers', () => {
  it('maps pixels per meter to tiers at the edges', () => {
    expect(tierForZoom(5)).toBe(0);
    expect(tierForZoom(6)).toBe(1);
    expect(tierForZoom(11.9)).toBe(1);
    expect(tierForZoom(12)).toBe(2);
    expect(tierForZoom(24)).toBe(2);
    expect(tierForZoom(24.1)).toBe(3);
  });
});

describe('shadow offset', () => {
  it('rotates the sun offset for each placement rotation', () => {
    expect(shadowOffset(1, 0)).toEqual([0.13, 0.18]);
    expect(shadowOffset(1, 90)).toEqual([0.18, -0.13]);
    expect(shadowOffset(1, 180)).toEqual([-0.13, -0.18]);
    expect(shadowOffset(1, 270)).toEqual([-0.18, 0.13]);
  });

  it('caps the height at 2.6 m', () => {
    const [dx, dy] = shadowOffset(5, 0);
    expect(dx).toBeCloseTo(0.13 * 2.6);
    expect(dy).toBeCloseTo(0.18 * 2.6);
  });
});

describe('tier gating', () => {
  it('drops a 0.05 m2 rect at tier 1 and a rect without height', () => {
    const small = planFixture([rect({ w: 0.5, h: 0.1, ht: 1 })], 1, 0, PPM, null);
    expect(small.body).toHaveLength(0);
    const flat = planFixture([rect({ w: 2, h: 2 })], 1, 0, PPM, null);
    expect(flat.body).toHaveLength(0);
  });

  it('keeps a 1 m2 tall rect at tier 1 with a flat color and no stroke', () => {
    const plan = planFixture([rect({ ht: 1, s: '#000000', sw: { m: 0.02 } })], 1, 0, PPM, null);
    expect(plan.body).toHaveLength(1);
    expect(plan.body[0].fill).toEqual({ kind: 'color', color: '#ffffff' });
    expect(plan.body[0].stroke).toBeNull();
  });

  it('drops a 0.01 m2 rect at tier 2 and keeps 0.02 m2', () => {
    const plan = planFixture([rect({ w: 0.1, h: 0.1 }), rect({ w: 0.2, h: 0.1 })], 2, 0, PPM, null);
    expect(plan.body).toHaveLength(1);
    expect(plan.body[0].op).toMatchObject({ w: 0.2 });
  });

  it('drops overhead ops at tier 1 and puts them in over at tier 2', () => {
    const ops = [rect({ ov: 1 })];
    const t1 = planFixture(ops, 1, 0, PPM, null);
    expect(t1.body).toHaveLength(0);
    expect(t1.over).toHaveLength(0);
    const t2 = planFixture(ops, 2, 0, PPM, null);
    expect(t2.body).toHaveLength(0);
    expect(t2.over).toHaveLength(1);
  });

  it('drops pattern fills below tier 3', () => {
    const ops = [rect({ f: { pat: 'perf' } })];
    expect(planFixture(ops, 2, 0, PPM, null).body).toHaveLength(0);
    const t3 = planFixture(ops, 3, 0, PPM, null);
    expect(t3.body[0].fill).toEqual({ kind: 'pat', pat: 'perf' });
  });

  it('gives a gradient the default c and a', () => {
    const plan = planFixture([rect({ f: { g: 'soft' } })], 3, 0, PPM, null);
    expect(plan.body[0].fill).toEqual({ kind: 'grad', g: 'soft', c: '#888888', a: 'h' });
  });

  it('keeps glow and air only from tier 2', () => {
    const ops: FixtureOp[] = [{ k: 'glow', p: [[0, 0], [1, 0], [1, 1]] }, { k: 'air', type: 'a320', x: 0, y: 0, scale: 1, rot: 0 }];
    expect(planFixture(ops, 1, 0, PPM, null).body).toHaveLength(0);
    expect(planFixture(ops, 2, 0, PPM, null).body).toHaveLength(2);
  });

  it('puts floor layer ops under the bodies and gives them no shadow (Revision 6)', () => {
    const plan = planFixture([rect({ fl: 1, ht: 1 }), rect({ ht: 1 })], 3, 0, PPM, null);
    expect(plan.floor).toHaveLength(1);
    expect(plan.body).toHaveLength(1);
    expect(plan.shadows).toHaveLength(1);
  });

  it('always keeps text ops in body', () => {
    const ops: FixtureOp[] = [{ k: 't', x: 0, y: 0, s: 'GATE', size: 0.5, f: '#ffffff' }];
    expect(planFixture(ops, 1, 0, PPM, null).body).toHaveLength(1);
  });
});

describe('livery', () => {
  const ops = [rect({ f: '#000000', fLiv: 0.5, s: '#000000', sLiv: -0.5, sw: { m: 0.02 } })];

  it('replaces the fill and stroke with the shaded livery', () => {
    const plan = planFixture(ops, 3, 0, PPM, '#808080');
    expect(plan.body[0].fill).toEqual({ kind: 'color', color: '#c0c0c0' });
    expect(plan.body[0].stroke).toBe('#404040');
    expect(plan.body[0].strokeM).toBe(0.02);
  });

  it('keeps the exported colors when livery is null', () => {
    const plan = planFixture(ops, 3, 0, PPM, null);
    expect(plan.body[0].fill).toEqual({ kind: 'color', color: '#000000' });
    expect(plan.body[0].stroke).toBe('#000000');
  });
});

describe('shadows', () => {
  it('adds one shadow per kept op with a height and none for overhead ops', () => {
    const ops: FixtureOp[] = [
      rect({ ht: 1 }),
      rect({ w: 2, h: 2 }),
      { k: 'c', x: 3, y: 3, r: 0.5, f: '#ffffff', ht: 1 },
      rect({ ht: 1, ov: 1 }),
    ];
    const plan = planFixture(ops, 3, 90, PPM, null);
    expect(plan.shadows).toHaveLength(2);
    expect(plan.over).toHaveLength(1);
  });
});

describe('sprite packs', () => {
  const files = readdirSync(SPRITE_DIR).filter((f) => f.endsWith('.json'));

  it('reads at least one pack', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('plans every asset at every tier and rotation without throwing', () => {
    let count = 0;
    for (const file of files) {
      const pack = fixtureSpritePackSchema.parse(JSON.parse(readFileSync(join(SPRITE_DIR, file), 'utf8')));
      for (const asset of Object.values(pack.assets)) {
        for (const tier of TIERS) {
          for (const rot of ROTS) {
            expect(() => planFixture(asset.ops, tier, rot, PPM, '#c8102e')).not.toThrow();
            count++;
          }
        }
      }
    }
    expect(count).toBeGreaterThan(0);
  });
});
