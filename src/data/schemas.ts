import { z } from 'zod';

const surface = z.object({
  costPerM2: z.number().positive(),
  pcrTiers: z.array(z.number().positive()).min(1),
  upkeepPct: z.number().nonnegative(),
});

const codeRow = z.object({
  spanM: z.number().positive(),
  standLengthM: z.number().positive(),
  runwayWidthM: z.number().positive(),
  runwayShoulderM: z.number().nonnegative(),
  taxiwayWidthM: z.number().positive(),
  filletRadiusM: z.number().positive(),
  taxiSepM: z.number().positive(),
  taxiObjectM: z.number().positive(),
});

const perCode = z.object({ A: z.number(), B: z.number(), C: z.number(), D: z.number(), E: z.number(), F: z.number() });
const perApproach = z.object({ visual: z.number(), nonPrecision: z.number(), precision: z.number() });

export const airfieldCodesSchema = z.object({
  version: z.literal(1),
  note: z.string(),
  codes: z.object({ A: codeRow, B: codeRow, C: codeRow, D: codeRow, E: codeRow, F: codeRow }),
  runwayToTaxiwaySepM: z.object({ visual: perCode, nonPrecision: perCode, precision: perCode }),
  holdingDistanceM: perApproach,
  stripWidthM: perApproach,
  surfaces: z.object({ dirt: surface, gravel: surface, grass: surface, asphalt: surface, concrete: surface }),
  tierCostFactor: z.array(z.number().positive()),
  gradingCostPerM3: z.number().nonnegative(),
  standCost: z.object({
    contact: z.number(),
    remotePushback: z.number(),
    remoteThrough: z.number(),
    gaTieDown: z.number(),
  }),
});

export type AirfieldCodes = z.infer<typeof airfieldCodesSchema>;

const module = z.object({ cost: z.number().nonnegative(), capacityPerHour: z.number().nonnegative(), staff: z.number().nonnegative() });
const shop = z.object({ cost: z.number().positive(), rentPerDay: z.number().positive(), spendPerPax: z.number().positive(), minRating: z.number().min(0).max(100) });

export const businessSchema = z.object({
  version: z.literal(1),
  note: z.string(),
  gse: z.record(z.string(), z.object({ price: z.number().nonnegative(), start: z.number().int().nonnegative() })),
  fees: z.object({
    landingPerTonne: z.number().positive(),
    passengerDeparting: z.number().positive(),
    passengerArriving: z.number().positive(),
    parkingPerStandHour: z.number().nonnegative(),
    wageStaffPerDay: z.number().positive(),
    gseUpkeepPerDay: z.number().nonnegative(),
    interestAnnualPct: z.number().nonnegative(),
    loanMax: z.number().positive(),
    loanTermDays: z.number().int().positive(),
  }),
  terminal: z.object({ foundationPerCell: z.number().positive(), tilePerCell: z.number().nonnegative(), carpetPerCell: z.number().nonnegative(), wallPerEdge: z.number().nonnegative(), glassPerEdge: z.number().nonnegative(), doorPerEdge: z.number().nonnegative(), contactReachM: z.number().positive(), atcRangeM: z.number().positive() }),
  modules: z.object({ checkIn: module, security: module, belt: module, seating: module, toilet: module, atc: module }),
  shops: z.object({ convenience: shop, quickFood: shop, cafe: shop, dutyFree: shop, booksGifts: shop, pharmacy: shop }),
  airlines: z.object({ regionalNames: z.array(z.string()).min(4), nationalNames: z.array(z.string()).min(4), suffixes: z.array(z.string()).min(2) }),
});

export type BusinessData = z.infer<typeof businessSchema>;
