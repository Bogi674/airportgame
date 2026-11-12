import { z } from 'zod';

const dockSchema = z.strictObject({
  /** Fraction of the aircraft length from the nose, aft positive. Null takes the stand fuel coupling station instead. */
  station: z.number().min(0).max(1).nullable(),
  /** Side of the aircraft: L is the left wing side, R the right. */
  side: z.enum(['L', 'R']),
  /** perp puts the vehicle length across the fuselage, along puts it along the fuselage. */
  orient: z.enum(['perp', 'along']),
  /** May sit under the wing when the wing is higher than the vehicle, otherwise parks beyond the wingtip. */
  underWing: z.boolean(),
  /** Shortest aircraft that gets this kit. Shorter aircraft are loaded by hand. */
  minAircraftLengthM: z.number().positive().optional(),
});

const vehicleSchema = z.strictObject({
    id: z.string(),
    name: z.string(),
    lengthM: z.number().positive(),
    widthM: z.number().positive(),
    heightM: z.number().positive(),
    docks: z.boolean(),
    articulated: z.boolean(),
    towedBy: z.string().nullable(),
    dock: dockSchema.optional(),
});

export const gseSchema = z.strictObject({
  version: z.literal(1),
  units: z.literal('meters'),
  note: z.string(),
  vehicles: z.array(vehicleSchema).min(1),
});

export type GseData = z.infer<typeof gseSchema>;
