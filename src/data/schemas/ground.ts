import { z } from 'zod';

const lane = z.strictObject({ laneOffsetM: z.number().positive(), speedKmh: z.number().positive() });

/** Service roads, apron lanes, the depot and vehicle trains (`src/data/ground.json`). */
export const groundSchema = z.strictObject({
  version: z.literal(1),
  note: z.string(),
  road: lane.extend({
    widthM: z.number().positive(),
    surface: z.enum(['asphalt', 'concrete']),
    snapM: z.number().positive(),
    minSegmentM: z.number().positive(),
  }),
  apronLane: lane,
  approach: z.strictObject({ slowLastM: z.number().positive(), speedKmh: z.number().positive() }),
  crossing: z.strictObject({ holdBackM: z.number().positive() }),
  noRoadTurnaroundFactor: z.number().min(1),
  depot: z.strictObject({
    widthM: z.number().positive(),
    depthM: z.number().positive(),
    cost: z.number().nonnegative(),
    capacity: z.number().int().positive(),
    exitGapM: z.number().positive(),
  }),
  cartsPerTrain: z.strictObject({ small: z.number().int().positive(), medium: z.number().int().positive(), large: z.number().int().positive(), xl: z.number().int().positive() }),
  train: z.strictObject({ hitchGapM: z.number().nonnegative() }),
  vehicleGapM: z.number().positive(),
  /** Game seconds before the turnaround ends at which the crew starts to leave, so the stand is clear for pushback. */
  crewClearLeadS: z.number().nonnegative(),
  /** Extra lateral room of a train's dock line, so the tractor's corners clear the belt loader as it turns out. */
  trainLateralExtraM: z.number().nonnegative(),
});

export type GroundData = z.infer<typeof groundSchema>;
