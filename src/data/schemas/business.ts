import { z } from 'zod';
import { PROFILE_KEYS } from './profiles';

/** A value per fixture level, index level minus 1. */
const levels3 = <T extends z.ZodTypeAny>(v: T) => z.tuple([v, v, v]);

const module = z.object({
  cost: z.number().nonnegative(),
  capacityPerHour: z.number().nonnegative(),
  staff: z.number().nonnegative(),
  servers: z.number().int().positive().optional(),
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
  terminal: z.object({ foundationPerCell: z.number().positive(), tilePerCell: z.number().nonnegative(), carpetPerCell: z.number().nonnegative(), wallPerEdge: z.number().nonnegative(), glassPerEdge: z.number().nonnegative(), doorPerEdge: z.number().nonnegative(), staffDoorPerEdge: z.number().nonnegative(), contactReachM: z.number().positive(), atcRangeM: z.number().positive(), walk: z.object({ latticeCells: z.number().int().positive(), dirtyMarginCells: z.number().int().positive(), cacheSources: z.number().int().positive() }), service: z.strictObject({ cv: z.number().positive().max(1), queueDensityPerM2: z.number().positive(), queueReachCells: z.number().int().positive(), queueSlots: z.number().int().positive() }) }),
  modules: z.object({ checkIn: module, security: module, belt: module, seating: module, toilet: module, atc: module, kiosk: module, bagDrop: module, passport: module, gateDesk: module }),
  fixtureLevels: z.strictObject({
    note: z.string(),
    costFactor: levels3(z.number().positive()),
    worksDays: z.number().positive(),
    upkeepShare: z.number().nonnegative(),
    serviceSeconds: z.strictObject({ checkIn: levels3(z.number().positive()), security: levels3(z.number().positive()), passport: levels3(z.number().positive()), gateDesk: levels3(z.number().positive()) }),
    staffNeed: z.strictObject({ checkIn: levels3(z.number().int().positive()), security: levels3(z.number().int().positive()), passport: levels3(z.number().int().positive()), gateDesk: levels3(z.number().int().positive()) }),
    premiumProfiles: z.array(z.enum(PROFILE_KEYS)).min(1),
    premiumPoints: levels3(z.number().nonnegative()),
    priorityLevel: z.number().int().min(1).max(3),
  }),
  fixtureCosts: z.strictObject({
    note: z.string(),
    'securityExit.staffed': z.number().nonnegative(),
    'securityExit.auto': z.number().nonnegative(),
    'securityExit.revolving': z.number().nonnegative(),
    eGate: z.number().nonnegative(),
    customs: z.number().nonnegative(),
  }),
  tower,
  shops: z.object({ convenience: shop, quickFood: shop, cafe: shop, dutyFree: shop, booksGifts: shop, pharmacy: shop }),
  airlines: z.object({ regionalNames: z.array(z.string()).min(4), nationalNames: z.array(z.string()).min(4), suffixes: z.array(z.string()).min(2) }),
});

export type BusinessData = z.infer<typeof businessSchema>;
