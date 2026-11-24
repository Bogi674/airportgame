import { z } from 'zod';

/** Footprint and price of a building. */
const footprint = z.strictObject({ widthM: z.number().positive(), depthM: z.number().positive(), cost: z.number().nonnegative() });

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
    /** Length of the road stub ghost at the cursor before the first click (T84). */
    stubM: z.number().positive(),
    /** Road snap points within this distance of the cursor show their markers (T84). */
    nearbyM: z.number().positive(),
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
  /** Share of a supporting building's cost paid as upkeep each game day (user, 2026-11-18). */
  buildingUpkeepShare: z.number().nonnegative(),
  /** Supporting buildings of T65: footprint and price (D19 to D22). */
  buildings: z.strictObject({ fuelFarm: footprint, catering: footprint, fire: footprint, staff: footprint, cleaning: footprint, workshop: footprint }),

  /** Fire station (D21, GAME_DESIGN section 10): category by vehicles, response limit, grace before refusals. */
  fire: z.strictObject({
    vehicleCost: z.number().nonnegative(),
    maxVehicles: z.number().int().positive(),
    responseS: z.number().positive(),
    speedKmh: z.number().positive(),
    graceDays: z.number().int().nonnegative(),
    categories: z.array(z.strictObject({ category: z.number().int(), maxLengthM: z.number().positive(), vehicles: z.number().int().positive() })).min(1),
  }),
  /** Fuel farm (D19): tanks, tanker orders, prices, grounding, and the liters each type takes per turnaround (user: fixed per type). */
  fuel: z.strictObject({
    tankCount: z.number().int().positive(),
    tankM3: z.number().positive(),
    tankerM3: z.number().positive(),
    orderBelowShare: z.number().min(0).max(1),
    leadHours: z.number().nonnegative(),
    buyPerL: z.number().nonnegative(),
    sellPerL: z.number().nonnegative(),
    groundAfterMin: z.number().nonnegative(),
    upliftL: z.record(z.string(), z.number().nonnegative()),
  }),
  catering: z.strictObject({ trucks: z.number().int().nonnegative() }),
});

export type GroundData = z.infer<typeof groundSchema>;
