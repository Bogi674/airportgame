import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const liverySchema = z.strictObject({
  body: hex,
  fin: hex,
  /** Nacelle cowl tint, null for plain white cowls. */
  nacelle: hex.nullable(),
  winglet: hex,
  /** Fuselage crown band, null for none. */
  crown: hex.nullable(),
});

export const spritesSchema = z.strictObject({
  version: z.literal(1),
  note: z.string(),
  tiers: z.strictObject({
    minZoom: z.tuple([z.number().nonnegative(), z.number().positive(), z.number().positive(), z.number().positive()]),
    bakePpm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive(), z.number().positive()]),
  }),
  cache: z.strictObject({ maxEntries: z.number().int().min(8) }),
  padM: z.number().positive(),
  liveries: z.array(liverySchema).length(8),
  neutral: liverySchema,
});

export type SpritesData = z.infer<typeof spritesSchema>;
export type LiveryData = z.infer<typeof liverySchema>;
