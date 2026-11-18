import { z } from 'zod';

const upgrade = z.strictObject({
  /** Cash paid when the works start. */
  cost: z.number().positive(),
  /** Game days the stand is closed for the works. */
  days: z.number().positive(),
});

/** Stand upgrades and far stand boarding (`src/data/stand_access.json`, T66). */
export const standAccessSchema = z.strictObject({
  version: z.literal(1),
  note: z.string(),
  upgrades: z.strictObject({ busBay: upgrade, hydrantPit: upgrade, fixedPower: upgrade }),
  /** A stand farther than this from its gate desk needs a bus bay. */
  stairsWalkLimitM: z.number().positive(),
  /** Extra boarding time at a far stand without a bus bay, as a fraction. */
  farBoardingSlowdown: z.number().min(0).max(1),
});

export type StandAccessData = z.infer<typeof standAccessSchema>;
