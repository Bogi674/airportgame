import { z } from 'zod';

const module = z.object({
  cost: z.number().nonnegative(),
  capacityPerHour: z.number().nonnegative(),
  staff: z.number().nonnegative(),
  servers: z.number().positive().optional(),
  serviceSeconds: z.number().positive().optional(),
});
const shop = z.object({ cost: z.number().positive(), rentPerDay: z.number().positive(), spendPerPax: z.number().positive(), minRating: z.number().min(0).max(100) });

const towerLevel = z.strictObject({
  movementsPerHour: z.number().int().positive(),
  maxRunways: z.number().int().refine((n) => n === -1 || n >= 1, 'maxRunways must be -1 (unlimited) or at least 1'),
});

/** The ATC tower: five cash bought levels that never lose budget or runway allowance as the level rises. */
const tower = z
  .strictObject({
    note: z.string(),
    cost: z.number().positive(),
    upgradeCost: z.number().nonnegative(),
    footprintM: z.number().positive(),
    levels: z.array(towerLevel).length(5),
  })
  .superRefine((t, ctx) => {
    const cap = (n: number): number => (n === -1 ? Infinity : n);
    for (let i = 1; i < t.levels.length; i++) {
      if (t.levels[i].movementsPerHour < t.levels[i - 1].movementsPerHour) ctx.addIssue({ code: 'custom', message: `tower level ${i + 1} has a smaller movement budget than level ${i}` });
      if (cap(t.levels[i].maxRunways) < cap(t.levels[i - 1].maxRunways)) ctx.addIssue({ code: 'custom', message: `tower level ${i + 1} allows fewer runways than level ${i}` });
    }
  });

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
  terminal: z.object({ foundationPerCell: z.number().positive(), tilePerCell: z.number().nonnegative(), carpetPerCell: z.number().nonnegative(), wallPerEdge: z.number().nonnegative(), glassPerEdge: z.number().nonnegative(), doorPerEdge: z.number().nonnegative(), contactReachM: z.number().positive(), atcRangeM: z.number().positive(), walk: z.object({ latticeCells: z.number().int().positive(), dirtyMarginCells: z.number().int().positive(), cacheSources: z.number().int().positive() }) }),
  modules: z.object({ checkIn: module, security: module, belt: module, seating: module, toilet: module, atc: module, kiosk: module, bagDrop: module, passport: module, gateDesk: module }),
  tower,
  shops: z.object({ convenience: shop, quickFood: shop, cafe: shop, dutyFree: shop, booksGifts: shop, pharmacy: shop }),
  airlines: z.object({ regionalNames: z.array(z.string()).min(4), nationalNames: z.array(z.string()).min(4), suffixes: z.array(z.string()).min(2) }),
});

export type BusinessData = z.infer<typeof businessSchema>;
