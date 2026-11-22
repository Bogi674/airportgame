import { z } from 'zod';
import { PROFILE_KEYS } from './profiles';

const seconds = z.number().positive();
const servers = z.number().int().positive();

/** International departure values (`src/data/departures.json`, T79): passport booths and eGates in departure mode. Game seconds. */
export const departuresSchema = z.strictObject({
  note: z.string(),
  service: z.strictObject({
    passport: z.strictObject({ servers, serviceSeconds: seconds }),
    eGate: z.strictObject({
      servers,
      serviceSeconds: seconds,
      referralShare: z.number().min(0).max(1),
      noGateProfiles: z.array(z.enum(PROFILE_KEYS)),
    }),
  }),
});

export type DeparturesData = z.infer<typeof departuresSchema>;
