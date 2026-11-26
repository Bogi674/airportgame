import { z } from 'zod';

/** Passenger profile ids. A profile id is its index in this list. */
export const PROFILE_KEYS = ['business', 'leisure', 'family', 'budget', 'premium', 'crew'] as const;

const profile = z.strictObject({
  leadMin: z.number().nonnegative(),
  walkSpeed: z.number().positive(),
  patienceS: z.number().nonnegative(),
  spend: z.number().nonnegative(),
  bagsPerPax: z.number().nonnegative(),
  mix: z.number().nonnegative(),
  /** Weights for group sizes 1 to maxGroup, index 0 is size 1 (docs/DESIGN_REVISION_4.md D24). */
  groupSize: z.array(z.number().int().nonnegative()),
});

export const profilesSchema = z
  .strictObject({
    capacity: z.number().int().positive(),
    maxGroup: z.number().int().positive(),
    sampleCap: z.number().int().positive(),
    walkSample: z.strictObject({
      note: z.string(),
      laneOffsetCells: z.number().int().positive(),
      minGapM: z.number().positive(),
      dwellRingCells: z.number().int().positive().max(8),
      dwellTries: z.number().int().positive(),
      queueRunCells: z.number().int().positive(),
      trailSteps: z.number().int().nonnegative(),
      trailStepM: z.number().positive(),
      seatReachCells: z.number().int().positive().max(12),
    }),
    arrivalSpread: z.number().min(0).max(1),
    boardingHoldS: z.number().nonnegative(),
    profiles: z.strictObject({
      business: profile,
      leisure: profile,
      family: profile,
      budget: profile,
      premium: profile,
      crew: profile,
    }),
  })
  .superRefine((d, ctx) => {
    const sum = PROFILE_KEYS.reduce((acc, k) => acc + d.profiles[k].mix, 0);
    if (Math.abs(sum - 1) > 1e-6) ctx.addIssue({ code: 'custom', message: `profile mix sums to ${sum}, expected 1` });
    const spiral = (2 * d.walkSample.dwellRingCells + 1) ** 2;
    if (d.walkSample.dwellTries > spiral) {
      ctx.addIssue({ code: 'custom', message: 'walkSample.dwellTries is above the spiral size' });
    }
    for (const k of PROFILE_KEYS) {
      const weights = d.profiles[k].groupSize;
      const total = weights.reduce((acc, w) => acc + w, 0);
      if (weights.length !== d.maxGroup || total <= 0) {
        ctx.addIssue({ code: 'custom', message: `profiles.${k}.groupSize needs maxGroup weights with a positive sum` });
      }
    }
  });

export type ProfilesData = z.infer<typeof profilesSchema>;
