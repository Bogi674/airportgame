import { z } from 'zod';

const CODE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
const codeLetter = z.enum(CODE_LETTERS);
const surfaceName = z.enum(['grass', 'dirt', 'gravel', 'asphalt', 'concrete']);
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/);

const codeRow = z.strictObject({
  spanM: z.number().positive(),
  standLengthM: z.number().positive(),
  runwayWidthM: z.number().positive(),
  runwayShoulderM: z.number().nonnegative(),
  taxiwayWidthM: z.number().positive(),
  turnRadiusM: z.number().positive(),
  taxiwayShoulderM: z.number().nonnegative(),
  taxiSepM: z.number().positive(),
  taxiObjectM: z.number().positive(),
});

const perCode = z.strictObject({ A: z.number(), B: z.number(), C: z.number(), D: z.number(), E: z.number(), F: z.number() });
const perApproach = z.strictObject({ visual: z.number(), nonPrecision: z.number(), precision: z.number() });

export const airfieldCodesSchema = z
  .strictObject({
    version: z.literal(1),
    note: z.string(),
    codes: z.strictObject({ A: codeRow, B: codeRow, C: codeRow, D: codeRow, E: codeRow, F: codeRow }),
    runwayToTaxiwaySepM: z.strictObject({ visual: perCode, nonPrecision: perCode, precision: perCode }),
    holdingDistanceM: perApproach,
    stripWidthM: perApproach,
    gradingCostPerM3: z.number().nonnegative(),
    standCost: z.strictObject({
      contact: z.number(),
      remotePushback: z.number(),
      remoteThrough: z.number(),
      gaTieDown: z.number(),
    }),
    /** Taxiway tool snapping (docs/DESIGN_REVISION_2.md section 2.2). */
    taxiwayTool: z.strictObject({ snapRadiusM: z.number().positive(), minNodeGapM: z.number().positive(), angleStepDeg: z.number().positive(), angleTolDeg: z.number().positive() }),
  })
  .superRefine((d, ctx) => {
    for (const c of CODE_LETTERS) {
      const r = d.codes[c];
      if (r.turnRadiusM <= r.taxiwayWidthM / 2) ctx.addIssue({ code: 'custom', path: ['codes', c, 'turnRadiusM'], message: 'turn radius must exceed half the taxiway width' });
    }
  });

export type AirfieldCodes = z.infer<typeof airfieldCodesSchema>;

const surfaceRow = z
  .strictObject({
    allowedCodes: z.array(codeLetter).min(1),
    paint: z.enum(['full', 'markers']),
    color: hexColor,
    shoulderColor: hexColor.nullable(),
    slabJointM: z.number().positive().nullable(),
    costPerM2: z.number().positive(),
    pcrTiers: z.array(z.number().positive()).min(1),
    upkeepPct: z.number().nonnegative(),
    worksDaysPerKm2: z.number().positive(),
    refundShare: z.number().min(0).max(1),
    unpavedMarkerSpacingM: z.number().positive().nullable(),
  })
  .refine((s) => (s.paint === 'markers') === (s.unpavedMarkerSpacingM !== null), { message: 'marker spacing is set exactly for unpainted surfaces' })
  .refine((s) => (s.paint === 'full') === (s.shoulderColor !== null), { message: 'shoulder color is set exactly for painted surfaces' });

export const surfacesSchema = z.strictObject({
  version: z.literal(1),
  note: z.string(),
  tierCostFactor: z.array(z.number().positive()).min(1),
  minWorksDays: z.number().positive(),
  surfaces: z.strictObject({ grass: surfaceRow, dirt: surfaceRow, gravel: surfaceRow, asphalt: surfaceRow, concrete: surfaceRow }),
});

export type SurfacesData = z.infer<typeof surfacesSchema>;

const standSize = z
  .strictObject({
    codes: z.array(codeLetter).min(1),
    maxSpanM: z.number().positive(),
    surfaces: z.array(surfaceName).min(1),
    widthM: z.number().positive(),
    depthM: z.number().positive(),
    forkRadiusM: z.number().positive(),
    wingtipClearanceM: z.number().positive(),
    noseClearanceM: z.number().positive().nullable(),
    mergeable: z.boolean(),
  })
  .refine((s) => s.widthM >= s.maxSpanM + 2 * s.wingtipClearanceM - 1, { message: 'stand width must hold the largest span plus both wingtip clearances' });

export const standSizesSchema = z
  .strictObject({
    version: z.literal(1),
    note: z.string(),
    sizes: z.strictObject({ small: standSize, medium: standSize, large: standSize, xl: standSize }),
  })
  .refine((d) => d.sizes.small.maxSpanM < d.sizes.medium.maxSpanM && d.sizes.medium.maxSpanM < d.sizes.large.maxSpanM && d.sizes.large.maxSpanM < d.sizes.xl.maxSpanM, {
    message: 'sizes must be ordered by span',
  });

export type StandSizesData = z.infer<typeof standSizesSchema>;
export type StandSize = keyof StandSizesData['sizes'];

const positive = z.number().positive();

export const paintSchema = z.strictObject({
  version: z.literal(1),
  note: z.string(),
  colors: z.strictObject({ yellow: hexColor, red: hexColor, white: hexColor, outline: hexColor, markerOutline: hexColor, signBlack: hexColor, snap: hexColor }),
  taxiway: z.strictObject({
    centerlineWidthM: positive,
    centerlineMinPx: positive,
    edgeLineWidthM: positive,
    edgeLineMinPx: positive,
    edgeLineInsetsM: z.array(positive).min(1),
    concreteOutlinePx: positive,
    shoulderStripeSpacingM: positive,
    shoulderStripeInsetM: positive,
    shoulderStripeEndGapM: positive,
    shoulderStripeWidthM: positive,
    shoulderStripeMinPx: positive,
    shoulderStripeEdgeClearM: positive,
    shoulderStripeReachFactor: positive,
    unpavedMarkerSizeM: positive,
    unpavedMarkerMinPx: positive,
    signOffsetM: positive,
    signBeforeJunctionM: positive,
    signHeightM: positive,
    signCharWidthM: positive,
  }),
});

export type PaintData = z.infer<typeof paintSchema>;
