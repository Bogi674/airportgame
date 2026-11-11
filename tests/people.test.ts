import { describe, expect, it } from 'vitest';
import peopleJson from '../src/data/people.json';
import { PEOPLE } from '../src/data/index';
import { peopleSchema } from '../src/data/schemas/people';
import { RECIPE_COUNT, memberHash, pickRecipe } from '../src/render/sprites/peopleRecipes';
import { personOps, opsBounds, type ShapeOp } from '../src/render/sprites/peopleShapes';
import { peopleTierForZoom } from '../src/render/sprites/peopleAtlas';
import { PeopleSelection } from '../src/render/peopleSelect';
import { PACK_MARGIN_M, packGroup, recipeFootprint } from '../src/render/peoplePack';

const SEED_COUNT = 6000;
/** Float32 storage of the packed origins and footprints rounds a little, so touching boxes may overlap by this much. */
const OVERLAP_EPS_M = 1e-6;
const PROFILE_TOTAL = PEOPLE.profiles.length;

describe('people data', () => {
  it('parses with 30 recipes in id order', () => {
    expect(PEOPLE.recipes).toHaveLength(RECIPE_COUNT);
    expect(PEOPLE.recipes.map((r) => r.id)).toEqual(Array.from({ length: RECIPE_COUNT }, (_, i) => i + 1));
  });

  it('rejects a recipe weight above 1000', () => {
    const bad = structuredClone(peopleJson);
    const first = bad.recipes[0];
    if (!first) throw new Error('no recipes in people.json');
    first.weights[0] = 1001;
    expect(peopleSchema.safeParse(bad).success).toBe(false);
  });
});

describe('pickRecipe', () => {
  it('returns the same recipe on repeat calls', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (let profile = 0; profile < PROFILE_TOTAL; profile++) {
        expect(pickRecipe(profile, seed, 3)).toBe(pickRecipe(profile, seed, 3));
      }
    }
  });

  it('only returns recipes with weight above zero for the profile', () => {
    for (let profile = 0; profile < PROFILE_TOTAL; profile++) {
      for (let seed = 0; seed < SEED_COUNT; seed++) {
        const recipe = pickRecipe(profile, seed, 0);
        expect(PEOPLE.recipes[recipe]?.weights[profile] ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('returns a child recipe for family at least once', () => {
    let child = false;
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const recipe = pickRecipe(2, seed, 0);
      if (recipe === 21 || recipe === 22) child = true;
    }
    expect(child).toBe(true);
  });

  it('clamps an unknown profile to profile 0', () => {
    expect(pickRecipe(99, 12345, 0)).toBe(pickRecipe(0, 12345, 0));
    expect(pickRecipe(-1, 12345, 0)).toBe(pickRecipe(0, 12345, 0));
  });
});

describe('memberHash', () => {
  it('differs between member 0 and member 1 for seed 12345', () => {
    expect(memberHash(12345, 0)).not.toBe(memberHash(12345, 1));
  });

  it('returns a uint32', () => {
    const h = memberHash(12345, 7);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

function opsFor(recipe: (typeof PEOPLE.recipes)[number], frame: number, detail: number): ShapeOp[] {
  const out: ShapeOp[] = [];
  personOps(recipe, frame, detail, false, out);
  return out;
}

describe('personOps', () => {
  it('keeps every recipe inside the sprite cell at all frames and details', () => {
    const half = PEOPLE.cellM / 2;
    for (const recipe of PEOPLE.recipes) {
      for (let frame = 0; frame <= 3; frame++) {
        for (let detail = 0; detail <= 2; detail++) {
          const ops = opsFor(recipe, frame, detail);
          expect(ops.length, `recipe ${recipe.id} frame ${frame} detail ${detail}`).toBeGreaterThan(0);
          const b = opsBounds(ops);
          const ok = b.minX >= -half && b.maxX <= half && b.minY >= -half && b.maxY <= half;
          expect(ok, `recipe ${recipe.id} frame ${frame} detail ${detail} bounds ${JSON.stringify(b)}`).toBe(true);
        }
      }
    }
  });

  it('gives fewer ops at detail 0 than at detail 2', () => {
    for (const recipe of PEOPLE.recipes) {
      expect(opsFor(recipe, 0, 0).length).toBeLessThan(opsFor(recipe, 0, 2).length);
    }
  });

  it('changes the figure between gait frames 0 and 1', () => {
    const recipe = PEOPLE.recipes[0];
    if (!recipe) throw new Error('no recipes in people.json');
    expect(JSON.stringify(opsFor(recipe, 0, 2))).not.toBe(JSON.stringify(opsFor(recipe, 1, 2)));
  });

  it('returns equal ops on repeat calls', () => {
    const recipe = PEOPLE.recipes[0];
    if (!recipe) throw new Error('no recipes in people.json');
    expect(opsFor(recipe, 1, 2)).toEqual(opsFor(recipe, 1, 2));
  });
});

describe('packGroup', () => {
  const PACK_SEEDS = 300;
  /** Plus or minus 1 m, the half of the 2 m queue cell that a group may use. */
  const EXTENT_M = 1;
  const MAX_SIZE = 6;
  const outX = new Float32Array(256);
  const outY = new Float32Array(256);
  const outRecipe = new Uint8Array(256);
  const fp = new Float32Array(4);

  /** True when a box lies within plus or minus the cell half. */
  function inside(l: number, b: number, r: number, t: number): boolean {
    return l >= -EXTENT_M && b >= -EXTENT_M && r <= EXTENT_M && t <= EXTENT_M;
  }

  /** Grown box of a placed member in block meters: left, bottom, right, top. */
  function boxOf(i: number): [number, number, number, number] {
    recipeFootprint(outRecipe[i]!, fp);
    return [outX[i]! + fp[0]! - PACK_MARGIN_M, outY[i]! + fp[1]! - PACK_MARGIN_M, outX[i]! + fp[2]! + PACK_MARGIN_M, outY[i]! + fp[3]! + PACK_MARGIN_M];
  }

  it('places at least one member and keeps the grown boxes disjoint and inside the cell', () => {
    for (let profile = 0; profile < PROFILE_TOTAL; profile++) {
      for (let seed = 0; seed < PACK_SEEDS; seed++) {
        for (let size = 1; size <= MAX_SIZE; size++) {
          const placed = packGroup(profile, seed, size, outX, outY, outRecipe);
          const label = `profile ${profile} seed ${seed} size ${size}`;
          expect(placed, label).toBeGreaterThanOrEqual(1);
          const boxes = Array.from({ length: placed }, (_, i) => boxOf(i));
          for (const [l, b, r, t] of boxes) {
            expect(inside(l, b, r, t), label).toBe(true);
            // A quarter turn of the block swaps the axes of every box, so the turned box must fit the same limit.
            expect(inside(b, l, t, r), label).toBe(true);
          }
          for (let i = 0; i < placed; i++) {
            for (let j = i + 1; j < placed; j++) {
              const [li, bi, ri, ti] = boxes[i]!;
              const [lj, bj, rj, tj] = boxes[j]!;
              const overlapX = Math.min(ri, rj) - Math.max(li, lj);
              const overlapY = Math.min(ti, tj) - Math.max(bi, bj);
              expect(overlapX <= OVERLAP_EPS_M || overlapY <= OVERLAP_EPS_M, label).toBe(true);
            }
          }
        }
      }
    }
  });

  it('returns the same layout on a second call', () => {
    const bx = new Float32Array(256);
    const by = new Float32Array(256);
    const br = new Uint8Array(256);
    for (let profile = 0; profile < PROFILE_TOTAL; profile++) {
      for (let seed = 0; seed < PACK_SEEDS; seed++) {
        const first = packGroup(profile, seed, MAX_SIZE, outX, outY, outRecipe);
        const xs = Array.from(outX.subarray(0, first));
        const ys = Array.from(outY.subarray(0, first));
        const rs = Array.from(outRecipe.subarray(0, first));
        const second = packGroup(profile, seed, MAX_SIZE, bx, by, br);
        expect(second).toBe(first);
        expect(Array.from(bx.subarray(0, second))).toEqual(xs);
        expect(Array.from(by.subarray(0, second))).toEqual(ys);
        expect(Array.from(br.subarray(0, second))).toEqual(rs);
      }
    }
  });
});

describe('peopleTierForZoom', () => {
  it('picks the highest tier whose minZoom is at or below the zoom', () => {
    expect(peopleTierForZoom(3.9)).toBe(-1);
    expect(peopleTierForZoom(4)).toBe(0);
    expect(peopleTierForZoom(8)).toBe(1);
    expect(peopleTierForZoom(24)).toBe(2);
    expect(peopleTierForZoom(40)).toBe(2);
  });
});

describe('PeopleSelection', () => {
  const n = 5;
  const x = Float32Array.from([3, 1, 2, 1, 9]);
  const y = Float32Array.from([0, 0, 0, 0, 0]);
  const size = Uint8Array.from([2, 2, 2, 2, 2]);

  it('keeps snapshot order under the cap', () => {
    const sel = new PeopleSelection();
    const count = sel.select(x, y, size, n, 0, 0, 100);
    expect(count).toBe(n);
    expect(Array.from(sel.order.subarray(0, count))).toEqual([0, 1, 2, 3, 4]);
  });

  it('sorts nearest first over the cap and keeps the figure sum within it', () => {
    const sel = new PeopleSelection();
    const count = sel.select(x, y, size, n, 0, 0, 6);
    expect(count).toBe(3);
    const drawn = Array.from(sel.order.subarray(0, count));
    expect(drawn).toEqual([1, 3, 2]);
    const figures = drawn.reduce((sum, i) => sum + (size[i] ?? 0), 0);
    expect(figures).toBeLessThanOrEqual(6);
  });

  it('orders equal distances by index and repeats the same order', () => {
    const sel = new PeopleSelection();
    const first = sel.select(x, y, size, n, 0, 0, 4);
    const a = Array.from(sel.order.subarray(0, first));
    const second = sel.select(x, y, size, n, 0, 0, 4);
    expect(a).toEqual([1, 3]);
    expect(Array.from(sel.order.subarray(0, second))).toEqual(a);
  });
});
