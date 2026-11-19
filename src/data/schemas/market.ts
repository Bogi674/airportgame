import { z } from 'zod';

const scopeNumbers = <T extends z.ZodTypeAny>(v: T) => z.object({ regional: v, national: v, international: v }).strict();
const band = z.tuple([z.number().positive(), z.number().positive()]);

/** Destinations, flight series, airline satisfaction and growth (docs/DESIGN_REVISION_4.md section 3, values D9 to D16). */
export const marketSchema = z
  .object({
    destinations: z
      .object({
        count: z.number().int().positive(),
        minKm: z.number().positive(),
        maxKm: z.number().positive(),
        minSize: z.number().int().positive(),
        maxSize: z.number().int().positive(),
        /** Share of generated destinations that flights reach as international (T20). */
        internationalShare: z.number().min(0).max(1),
        regions: z.array(z.string()).length(6),
        syllables: z.object({ start: z.array(z.string()).min(8), middle: z.array(z.string()).min(2), end: z.array(z.string()).min(8) }).strict(),
      })
      .strict(),
    series: z
      .object({
        contractWeeks: z.number().int().positive(),
        renewalWeeks: z.number().int().positive(),
        onSigning: scopeNumbers(z.number().int().positive()),
        perStar: z.number().int().nonnegative(),
        largeTypesStars: z.number().int().nonnegative(),
        largeTypeCodes: z.array(z.enum(['A', 'B', 'C', 'D', 'E', 'F'])),
        windowMin: z.number().int().positive(),
        windowStartFirstMin: z.number().int().nonnegative(),
        windowStartLastMin: z.number().int().nonnegative(),
        slotStepMin: z.number().int().positive(),
        patterns: z.array(z.object({ id: z.enum(['daily', 'weekdays', 'alternate', 'twiceWeekly', 'weekend']), weight: z.number().positive() }).strict()).min(1),
        stageKm: scopeNumbers(band),
      })
      .strict(),
    satisfaction: z
      .object({
        start: z.number(),
        min: z.number(),
        max: z.number(),
        unplacedFlight: z.number(),
        delayedFlight: z.number(),
        onTimeFlight: z.number(),
        outsideWindowFlight: z.number(),
        weeklyDrift: z.number().nonnegative(),
        onTimeMin: z.number().positive(),
        cancelBelow: z.number(),
        cancelWeeks: z.number().int().positive(),
        endBelow: z.number(),
        endWeeks: z.number().int().positive(),
      })
      .strict(),
    approach: z.object({ everyDays: z.number().int().positive(), chancePerStar: z.number().nonnegative() }).strict(),
    stars: z.object({ cuts: z.array(z.number()).min(1) }).strict(),
  })
  .strict();

export type MarketData = z.infer<typeof marketSchema>;
export type SeriesPattern = MarketData['series']['patterns'][number]['id'];
