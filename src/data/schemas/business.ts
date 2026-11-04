import { z } from 'zod';

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
