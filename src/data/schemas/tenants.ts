import { z } from 'zod';

/** Tenant category ids. A category id is its index in this list, so the order is saved. Append only. */
export const TENANT_CATEGORY_KEYS = ['convenience', 'quickFood', 'cafe', 'bar', 'booksGifts', 'pharmacy'] as const;
export type TenantCategory = (typeof TENANT_CATEGORY_KEYS)[number];
/** Furnishing element kinds. */
export const FURNISH_KINDS = ['counter', 'shelf', 'table', 'display'] as const;
export type FurnishKind = (typeof FURNISH_KINDS)[number];

const positive = z.number().positive();
const positiveInt = z.number().int().positive();
const color = z.string().regex(/^#[0-9a-f]{6}$/);

/** One furnishing rule: along a wall (back, sides, front), in rows parallel to the front, or as a grid of free standing items. */
const element = z.discriminatedUnion('at', [
  z.strictObject({ kind: z.enum(FURNISH_KINDS), at: z.enum(['back', 'sides', 'front']), depthM: positive }),
  z.strictObject({ kind: z.enum(FURNISH_KINDS), at: z.literal('rows'), depthM: positive, gapM: positive }),
  z.strictObject({ kind: z.enum(FURNISH_KINDS), at: z.literal('grid'), sizeM: positive, gapM: positive }),
]);

const category = z
  .strictObject({
    minM2: positive,
    maxM2: positive,
    nouns: z.array(z.string().min(1)).min(1),
    templates: z.array(z.array(element).min(1)).min(1),
  })
  .refine((c) => c.minM2 < c.maxM2, 'minM2 must be below maxM2');

export const tenantsSchema = z.strictObject({
  note: z.string(),
  rentPerM2Day: z.number().nonnegative(),
  salesShare: z.number().min(0).max(1),
  applicationDays: positiveInt,
  campaignCost: z.number().nonnegative(),
  poolBase: positiveInt,
  poolPaxPerBrand: positive,
  maxApplications: positiveInt,
  legacyCategory: z.strictObject({ note: z.string(), dutyFree: z.enum(TENANT_CATEGORY_KEYS) }),
  adjectives: z.array(z.string().min(1)).min(1),
  colors: z.array(color).min(1),
  categories: z.strictObject(Object.fromEntries(TENANT_CATEGORY_KEYS.map((k) => [k, category])) as Record<TenantCategory, typeof category>),
  paint: z.strictObject({ note: z.string(), outlineM: positive, marginM: positive, aisleM: positive, frontCounterMaxM: positive, signDepthM: positive, floor: color, counter: color, shelf: color, table: color, display: color }),
});

export type TenantsData = z.infer<typeof tenantsSchema>;
export type FurnishElement = z.infer<typeof element>;
