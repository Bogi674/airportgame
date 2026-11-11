import { describe, expect, it } from 'vitest';
import peopleJson from '../src/data/people.json';
import { PEOPLE } from '../src/data/index';
import { peopleSchema } from '../src/data/schemas/people';
import { RECIPE_COUNT, memberHash, pickRecipe } from '../src/render/sprites/peopleRecipes';
import { personOps, opsBounds, type ShapeOp } from '../src/render/sprites/peopleShapes';

const SEED_COUNT = 6000;
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
