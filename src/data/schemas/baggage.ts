import { z } from 'zod';

const positive = z.number().positive();

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
  loadingDeadlineMin: positive,
  lateBagHoldMin: positive,
  missingBagWeight: positive,
  linkCostPerM: positive,
  linkUpkeepPctPerYear: positive,
});

export type BaggageData = z.infer<typeof baggageSchema>;
