import { z } from 'zod';
import { FIXTURE_KEYS, type FixtureKey } from '@shared/business';

/** Staff role ids. A role id is its index in this list, so the order is saved. Append only. */
export const STAFF_ROLE_KEYS = ['agent', 'security', 'border'] as const;
export const STAFF_ROLE_COUNT = STAFF_ROLE_KEYS.length;
export type StaffRole = (typeof STAFF_ROLE_KEYS)[number];

const role = z.enum(STAFF_ROLE_KEYS);
const share = z.number().min(0).max(1);
const positive = z.number().positive();
const positiveInt = z.number().int().positive();
const nonnegative = z.number().nonnegative();
const hour = z.number().int().min(0).max(23);

const staffRole = z.strictObject({
  wagePerDay: nonnegative,
  sprites: z.array(positiveInt).min(1),
});

const roles = z.strictObject({
  note: z.string(),
  agent: staffRole,
  security: staffRole,
  border: staffRole,
});

const station = z.strictObject({
  role,
  need: z.number().int().min(1).max(8),
  needByLevel: z.tuple([z.number().int().min(1).max(8), z.number().int().min(1).max(8), z.number().int().min(1).max(8)]).optional(),
  unstaffedFactor: share.optional(),
});

/** One optional station entry per fixture key, so an unknown key fails. */
const stationShape = Object.fromEntries(FIXTURE_KEYS.map((key) => [key, station.optional()])) as Record<FixtureKey, z.ZodOptional<typeof station>>;

const stations = z.strictObject({ note: z.string(), ...stationShape });

const shifts = z
  .strictObject({
    note: z.string(),
    startsH: z
      .array(hour)
      .length(3)
      .refine((h) => h.every((v, i) => i === 0 || v > (h[i - 1] ?? v)), 'shift starts must rise'),
    lengthH: positiveInt,
    changeMin: nonnegative,
    overtimeMaxMin: nonnegative,
  })
  .refine((s) => s.startsH.length * s.lengthH === 24, 'the shifts must cover 24 hours');

const breaks = z.strictObject({
  note: z.string(),
  afterMin: nonnegative,
  jitterMin: z.number().int().nonnegative(),
  lengthMin: positive,
  reliefWaitMin: nonnegative,
  tiredSkill: share,
});

const skill = z.strictObject({ min: positive, max: positive }).refine((s) => s.min < s.max, 'staff.skill min must be below max');

const operator = z.strictObject({
  note: z.string(),
  backM: nonnegative,
  spacingM: nonnegative,
});

/** Airport staff roles, stations, shifts, breaks and skill (T68). */
export const staffSchema = z.strictObject({
  version: z.literal(1),
  note: z.string(),
  capacity: z.number().int().min(1).max(65535),
  stepMin: positiveInt,
  passEveryMin: positiveInt,
  sampleCap: positiveInt,
  roles,
  stations,
  shifts,
  breaks,
  skill,
  reliefShare: share,
  operator,
});

export type StaffData = z.infer<typeof staffSchema>;
