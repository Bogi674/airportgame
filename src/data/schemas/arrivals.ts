import { z } from 'zod';
import { PROFILE_KEYS } from './profiles';

const share = z.number().min(0).max(1);
const seconds = z.number().positive();
const points = z.number().nonnegative();
const servers = z.number().int().positive();

/** Arrival journey values (`src/data/arrivals.json`, T20). Game seconds and minutes. */
export const arrivalsSchema = z.strictObject({
  note: z.string(),
  doorOpenS: seconds,
  deboardSecondsPerPax: seconds,
  remoteBusS: seconds,
  strandedMin: z.number().positive(),
  claim: z.strictObject({ pollS: seconds, giveUpMin: z.number().positive() }),
  service: z.strictObject({
    note: z.string(),
    eGate: z.strictObject({
      servers,
      serviceSeconds: seconds,
      referralShare: share,
      noGateProfiles: z.array(z.enum(PROFILE_KEYS)),
    }),
    customs: z.strictObject({
      servers,
      serviceSeconds: seconds,
      redShare: share,
      redServiceSeconds: seconds,
    }),
  }),
  satisfaction: z.strictObject({ missingBagPoints: points, strandedPoints: points }),
});

export type ArrivalsData = z.infer<typeof arrivalsSchema>;
