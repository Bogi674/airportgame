import { z } from 'zod';

const positive = z.number().positive();
const positiveInt = z.number().int().positive();
const cell = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

/** Automatic baggage network values, docs/BAGGAGE.md section 11. */
export const baggageSchema = z.strictObject({
  version: z.literal(1),
  note: z.string(),
  beltSpeedMps: positive,
  linkCapacityBagsPerHour: positive,
  maxLinkLengthM: positive,
  dropPoint: z.strictObject({ bufferBags: positive }),
  screeningMachine: z.strictObject({ secondsPerBag: positive, bufferBags: positive, officers: positive }),
  bay: z.strictObject({
    depthM: positive,
    slotWidthM: positive,
    bufferBags: positive,
    loadSecondsPerBag: positive,
    stagingLaneM: positive,
  }),
  carousel: z.strictObject({ capacityBags: positive }),
  footprints: z.strictObject({
    machine: z.strictObject({ w: positiveInt, d: positiveInt, in: cell, out: cell }),
    bay: z.strictObject({ widths: z.array(positiveInt).min(1), d: positiveInt, in: cell, outFromRight: z.number().int().nonnegative() }),
    carousel: z.strictObject({ w: positiveInt, d: positiveInt, in: cell }),
  }),
  screeningRoom: z.strictObject({ minAreaM2: positive }),
  loadingDeadlineMin: positive,
  lateBagHoldMin: positive,
  missingBagWeight: positive,
  linkCostPerM: positive,
  linkUpkeepPctPerYear: positive,
  costs: z.strictObject({ machine: positive, bayPerCell: positive, carousel: positive }),
});

export type BaggageData = z.infer<typeof baggageSchema>;
