import { z } from 'zod';
import { FIXTURE_KEYS } from '@shared/business';

/** Passenger need ids. A need id is its index in this list, so the order is saved. Append only. */
export const NEED_KEYS = ['hunger', 'thirst', 'toilet', 'rest', 'shop'] as const;
export const NEED_COUNT = NEED_KEYS.length;

const fixtureName = z.enum(FIXTURE_KEYS);
const share = z.number().min(0).max(1);
const minutes = z.number().nonnegative();
const range = z
  .strictObject({ min: z.number().nonnegative(), max: z.number().nonnegative() })
  .refine((r) => r.min < r.max, 'min must be below max');

const timedNeed = z.strictObject({
  thresholdH: z.number().positive(),
  fixtures: z.array(fixtureName).min(1),
  visitMin: minutes,
  spendShare: share,
});

const shop = z
  .strictObject({
    note: z.string(),
    threshold: share,
    visitMin: minutes,
    spendShare: share,
    favourites: z.number().int().positive(),
    categories: z.array(fixtureName).min(1),
  })
  .refine((s) => s.favourites <= s.categories.length, 'favourites cannot exceed the number of categories');

const satisfaction = z.strictObject({
  note: z.string(),
  start: z.number().min(0).max(100),
  queuePerMin: z.number().nonnegative(),
  walkComfortM: z.number().nonnegative(),
  walkPerM: z.number().nonnegative(),
  unmetPerHour: z.number().nonnegative(),
  missedPenalty: z.number().nonnegative(),
  windowDays: z.number().int().positive(),
});

export const needsSchema = z.strictObject({
  note: z.string(),
  needs: z.strictObject({
    note: z.string(),
    hunger: timedNeed,
    thirst: timedNeed,
    toilet: timedNeed,
    rest: timedNeed,
  }),
  factor: range,
  shop,
  budget: range,
  gateLeadMin: range,
  mobility: z.strictObject({ share, slowFactor: z.number().positive() }),
  satisfaction,
});

export type NeedsData = z.infer<typeof needsSchema>;
