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
});

export const profilesSchema = z
  .strictObject({
    capacity: z.number().int().positive(),
    maxGroup: z.number().int().positive(),
    sampleCap: z.number().int().positive(),
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
  });

export type ProfilesData = z.infer<typeof profilesSchema>;
