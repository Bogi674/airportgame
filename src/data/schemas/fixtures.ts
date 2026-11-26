import { z } from 'zod';

/** Terminal asset kit: catalog and vector sprite packs, see docs/TERMINAL_FIXTURES.md section 10. */

const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
const pt = z.tuple([z.number(), z.number()]);

/** A fill: a plain color, a shading gradient on a base color, or a fine pattern. */
const fillSchema = z.union([
  color,
  z.strictObject({
    g: z.enum(['soft', 'lit', 'dome', 'screen', 'glow', 'water', 'ramp', 'escalator']),
    c: color.optional(),
    a: z.enum(['h', 'v']).optional(),
  }),
  z.strictObject({ pat: z.enum(['perf', 'weave']) }),
]);

/** Stroke width: px is screen pixels at the bake scale, m is meters. */
const strokeWidth = z.union([z.strictObject({ px: z.number().positive() }), z.strictObject({ m: z.number().positive() })]);

const paint = {
  f: fillSchema.optional(),
  s: color.optional(),
  sw: strokeWidth.optional(),
  /** Opacity 0 to 1. */
  o: z.number().min(0).max(1).optional(),
  /** Height of the part in meters, drives the baked shadow. Absent means flat on the floor. */
  ht: z.number().positive().optional(),
  dash: z.array(z.number().positive()).optional(),
  /** 1 when dash lengths are screen pixels rather than meters. */
  dashPx: z.literal(1).optional(),
  /** 1 for overhead parts, drawn last and only from tier 2. */
  ov: z.literal(1).optional(),
  /** 1 for floor layer parts (mats, tape, wait lines): drawn under shadows and bodies, never casting a shadow (Revision 6). */
  fl: z.literal(1).optional(),
  /** 1 for door swing clearance paint, which may leave the footprint and is a no build zone (Revision 6). */
  swing: z.literal(1).optional(),
  /** Livery parts: the fill or stroke takes the airline color shaded by this factor (negative darker, positive lighter). */
  fLiv: z.number().min(-1).max(1).optional(),
  sLiv: z.number().min(-1).max(1).optional(),
};

export const fixtureOpSchema = z.discriminatedUnion('k', [
  z.strictObject({ k: z.literal('r'), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(), rx: z.number().positive().optional(), ...paint }),
  z.strictObject({ k: z.literal('c'), x: z.number(), y: z.number(), r: z.number().positive(), ...paint }),
  z.strictObject({ k: z.literal('e'), x: z.number(), y: z.number(), rx: z.number().positive(), ry: z.number().positive(), rot: z.number().optional(), ...paint }),
  z.strictObject({ k: z.literal('p'), p: z.array(pt).min(3), ...paint }),
  /** SVG path data with absolute M, L, Q, C, A and Z commands. shp is the outline used for the shadow. */
  z.strictObject({ k: z.literal('a'), d: z.string().min(2), shp: z.array(pt).optional(), ...paint }),
  z.strictObject({
    k: z.literal('l'),
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
    s: color,
    sw: strokeWidth,
    cap: z.enum(['butt', 'round']).optional(),
    dash: z.array(z.number().positive()).optional(),
    o: z.number().min(0).max(1).optional(),
    swing: z.literal(1).optional(),
  }),
  z.strictObject({ k: z.literal('t'), x: z.number(), y: z.number(), s: z.string(), size: z.number().positive(), f: color, anchor: z.enum(['start', 'middle', 'end']).optional(), rot: z.number().optional() }),
  /** Screen light on the floor in front of a display: glow gradient, no outline, no shadow. */
  z.strictObject({ k: z.literal('glow'), p: z.array(pt).min(3) }),
  /** A scale model drawn by the aircraft baker. */
  z.strictObject({ k: z.literal('air'), type: z.string(), x: z.number(), y: z.number(), scale: z.number().positive(), rot: z.number() }),
]);

export const fixtureSpritePackSchema = z.strictObject({
  version: z.literal(1),
  category: z.string(),
  assets: z.record(
    z.string(),
    z.strictObject({
      size: z.tuple([z.number().positive(), z.number().positive()]),
      ops: z.array(fixtureOpSchema).min(1),
    }),
  ),
});

const statValue = z.union([z.number(), z.boolean(), z.string(), z.array(z.string())]);

const assetSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9.]+$/),
  name: z.string(),
  category: z.string(),
  /** Assets of one family share a role, levels and variants differ only in look and values. */
  family: z.string(),
  level: z.number().int().min(1).max(3).nullable(),
  /** Width and depth in meters, rotation 0. */
  size: z.tuple([z.number().positive(), z.number().positive()]),
  /** cell snaps to the 2 m terminal grid, sub to the 0.5 m prop grid. */
  grid: z.enum(['cell', 'sub']),
  mount: z.enum(['floor', 'floorLayer', 'wall', 'edge', 'overhead', 'desktop']),
  zones: z.array(z.enum(['public', 'commercial', 'secure', 'international', 'staff', 'apron'])).min(1),
  /** Existing entry of FIXTURE_KEYS in src/shared/business.ts, or null. */
  gameKey: z.string().nullable(),
  /** Key to append to FIXTURE_KEYS or to the prop list when the asset is built, or null. */
  newKey: z.string().nullable(),
  stats: z.record(z.string(), statValue),
  /** Stat names that are proposals waiting for the owner, see handoff/QUESTIONS.md. */
  confirm: z.array(z.string()),
  /**
   * Game footprint in whole 2 m cells as [along, across] in the sprite frame, present where it differs from the art
   * size divided by 2 (Revision 6: the check in desk art is 2, 3 and 4 m wide on 1, 2 and 2 cells).
   */
  cells: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  /** Points where an agent and a passenger stand at a service desk, in meters of the sprite frame (Revision 6). */
  service: z.strictObject({ agent: pt, passenger: pt }).optional(),
  /** Baggage ramp cells in 2 m cells relative to the footprint, see docs/BAGGAGE.md section 3.5. */
  ramps: z.array(z.strictObject({ cell: z.tuple([z.number().int(), z.number().int()]), dir: z.enum(['in', 'out']) })),
  sheet: z.string().nullable(),
  /** Python reference function in docs/reference/sprite-prototypes that drew the asset. */
  generator: z.string(),
});

export const fixtureCatalogSchema = z.strictObject({
  version: z.literal(1),
  note: z.string(),
  categories: z.array(z.strictObject({ id: z.string(), name: z.string(), note: z.string() })).min(1),
  assets: z.array(assetSchema).min(1),
});

export type FixtureOp = z.infer<typeof fixtureOpSchema>;
export type FixtureSpritePack = z.infer<typeof fixtureSpritePackSchema>;
export type FixtureCatalog = z.infer<typeof fixtureCatalogSchema>;
export type FixtureAsset = z.infer<typeof assetSchema>;
