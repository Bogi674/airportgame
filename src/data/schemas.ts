import { z } from 'zod';

const surface = z.object({
  costPerM2: z.number().positive(),
  pcrTiers: z.array(z.number().positive()).min(1),
  upkeepPct: z.number().nonnegative(),
});

const codeRow = z.object({
  spanM: z.number().positive(),
  standLengthM: z.number().positive(),
  runwayWidthM: z.number().positive(),
  runwayShoulderM: z.number().nonnegative(),
  taxiwayWidthM: z.number().positive(),
  filletRadiusM: z.number().positive(),
  taxiSepM: z.number().positive(),
  taxiObjectM: z.number().positive(),
});

const perCode = z.object({ A: z.number(), B: z.number(), C: z.number(), D: z.number(), E: z.number(), F: z.number() });
const perApproach = z.object({ visual: z.number(), nonPrecision: z.number(), precision: z.number() });

export const airfieldCodesSchema = z.object({
  version: z.literal(1),
  note: z.string(),
  codes: z.object({ A: codeRow, B: codeRow, C: codeRow, D: codeRow, E: codeRow, F: codeRow }),
  runwayToTaxiwaySepM: z.object({ visual: perCode, nonPrecision: perCode, precision: perCode }),
  holdingDistanceM: perApproach,
  stripWidthM: perApproach,
  surfaces: z.object({ dirt: surface, gravel: surface, grass: surface, asphalt: surface, concrete: surface }),
  tierCostFactor: z.array(z.number().positive()),
  gradingCostPerM3: z.number().nonnegative(),
  standCost: z.object({
    contact: z.number(),
    remotePushback: z.number(),
    remoteThrough: z.number(),
    gaTieDown: z.number(),
  }),
});

export type AirfieldCodes = z.infer<typeof airfieldCodesSchema>;
