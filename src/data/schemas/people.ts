import { z } from 'zod';
import { PROFILE_KEYS } from './profiles';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Hair and headwear styles that people2.py hair_shape() draws. */
export const HAIR_STYLES = [
  'short',
  'side_part',
  'spiky',
  'long',
  'ponytail',
  'bun',
  'curly',
  'afro',
  'buzz',
  'balding',
  'bald',
  'braids',
  'hijab',
  'cap',
  'sunhat',
  'beanie',
  'turban',
  'peci',
  'helmet',
  'fire_helmet',
  'police_cap',
  'pilot_cap',
  'beret',
] as const;

/** Torso overlays that people2.py person() draws. */
export const PERSON_OVERLAYS = [
  'vest_orange',
  'vest_yellow',
  'vest_police',
  'turnout',
  'paramedic',
  'apron',
  'blazer',
  'suit',
  'overalls',
] as const;

/** Carried and trailing items that people2.py person() draws. */
export const PERSON_ITEMS = [
  'suitcase',
  'trolley',
  'stroller',
  'cart',
  'backpack',
  'big_backpack',
  'baby_carrier',
  'shoulder_bag',
  'phone',
  'coffee',
  'clipboard',
  'handbag',
  'toolbox',
  'medbag',
  'cane',
  'extinguisher',
  'wands',
  'wheelchair',
] as const;

/** Head accessories that people2.py hair_shape() draws. */
export const HEAD_ACCESSORIES = ['ear_defenders', 'headset'] as const;

const RECIPE_COUNT = 30;
const SKIN_COUNT = 8;
const MAX_WEIGHT = 1000;

const recipeSchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string().min(1),
  /** Index into the skin list. */
  skin: z.number().int().min(0).max(SKIN_COUNT - 1),
  hair: z.enum(HAIR_STYLES),
  /** Key of the hair color table. */
  hairCol: z.string().min(1),
  shirt: hex,
  sleeve: hex.optional(),
  shoes: hex.optional(),
  case: hex.optional(),
  pack: hex.optional(),
  scarf: hex.optional(),
  tie: hex.optional(),
  overlay: z.enum(PERSON_OVERLAYS).optional(),
  headAcc: z.enum(HEAD_ACCESSORIES).optional(),
  items: z.array(z.enum(PERSON_ITEMS)),
  scale: z.number().positive().optional(),
  /** One weight per profile, in profiles order. Capped so a profile column total fits in a Uint16Array. */
  weights: z.array(z.number().int().min(0).max(MAX_WEIGHT)).length(PROFILE_KEYS.length),
});

/** A staff recipe: the passenger shape without weights, plus the extras people2.py reads for uniforms. */
const staffRecipeSchema = recipeSchema.omit({ weights: true }).extend({
  gloves: hex.optional(),
  epaulettes: z.number().int().min(0).max(4).optional(),
  radio: z.literal(true).optional(),
  apron: hex.optional(),
});

export const STAFF_RECIPE_COUNT = 16;

const tierSchema = z.strictObject({
  minZoom: z.number().nonnegative(),
  ppm: z.number().positive(),
  detail: z.number().int().min(0).max(2),
});

export const peopleSchema = z
  .strictObject({
    version: z.literal(1),
    note: z.string(),
    cellM: z.number().positive(),
    motion: z.strictObject({
      note: z.string(),
      strideM: z.number().positive(),
      interpMaxJumpM: z.number().positive(),
      memberMarginM: z.number().nonnegative(),
      cellHalfM: z.number().positive(),
    }),
    tiers: z.array(tierSchema).min(1),
    skin: z.array(hex).length(SKIN_COUNT),
    hair: z.record(z.string().min(1), hex),
    profiles: z.array(z.enum(PROFILE_KEYS)).length(PROFILE_KEYS.length),
    recipes: z.array(recipeSchema),
    staff: z.array(staffRecipeSchema),
  })
  .superRefine((d, ctx) => {
    if (d.recipes.length !== RECIPE_COUNT) {
      ctx.addIssue({ code: 'custom', message: `expected ${RECIPE_COUNT} recipes, got ${d.recipes.length}` });
    }
    d.recipes.forEach((r, i) => {
      if (r.id !== i + 1) ctx.addIssue({ code: 'custom', message: `recipe at index ${i} has id ${r.id}, expected ${i + 1}` });
      if (!Object.hasOwn(d.hair, r.hairCol)) {
        ctx.addIssue({ code: 'custom', message: `recipe ${r.id} hairCol ${r.hairCol} is not a hair key` });
      }
    });
    if (d.staff.length !== STAFF_RECIPE_COUNT) {
      ctx.addIssue({ code: 'custom', message: `expected ${STAFF_RECIPE_COUNT} staff recipes, got ${d.staff.length}` });
    }
    d.staff.forEach((r, i) => {
      if (r.id !== i + 1) ctx.addIssue({ code: 'custom', message: `staff recipe at index ${i} has id ${r.id}, expected ${i + 1}` });
      if (!Object.hasOwn(d.hair, r.hairCol)) {
        ctx.addIssue({ code: 'custom', message: `staff recipe ${r.id} hairCol ${r.hairCol} is not a hair key` });
      }
    });
    d.tiers.forEach((t, i) => {
      const prev = d.tiers[i - 1];
      if (prev && t.minZoom <= prev.minZoom) {
        ctx.addIssue({ code: 'custom', message: `tier ${i} minZoom must be above tier ${i - 1}` });
      }
    });
    if (d.profiles.some((key, col) => key !== PROFILE_KEYS[col])) {
      ctx.addIssue({ code: 'custom', message: `profiles must list ${PROFILE_KEYS.join(', ')} in order` });
    }
    PROFILE_KEYS.forEach((key, col) => {
      const sum = d.recipes.reduce((acc, r) => acc + (r.weights[col] ?? 0), 0);
      if (sum <= 0) ctx.addIssue({ code: 'custom', message: `profile ${key} has no recipe weight` });
    });
  });

export type PeopleData = z.infer<typeof peopleSchema>;
export type PersonRecipe = z.infer<typeof recipeSchema>;
export type StaffRecipe = z.infer<typeof staffRecipeSchema>;
