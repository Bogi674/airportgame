import { z } from 'zod';

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

const levelTriple = z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]);
/** One fixture family in three levels (T74). Higher levels never cost less or serve slower. */
const fixtureLevel = z
  .strictObject({ cost: levelTriple, serviceSeconds: levelTriple, worksDays: z.number().int().positive() })
  .superRefine((f, ctx) => {
    for (let i = 1; i < 3; i++) {
      if (f.cost[i] < f.cost[i - 1]) ctx.addIssue({ code: 'custom', message: `level ${i + 1} costs less than level ${i}` });
      if (f.serviceSeconds[i] > f.serviceSeconds[i - 1]) ctx.addIssue({ code: 'custom', message: `level ${i + 1} serves slower than level ${i}` });
    }
  });

export const businessSchema = z.object({
  version: z.literal(1),
  note: z.string(),
  sandboxCash: z.number().positive(),
  skipDay: z.object({ note: z.string(), realSeconds: z.number().positive(), untilMinute: z.number().int().min(0).max(1439) }),
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
  terminal: z.object({ foundationPerCell: z.number().positive(), tilePerCell: z.number().nonnegative(), carpetPerCell: z.number().nonnegative(), wallPerEdge: z.number().nonnegative(), glassPerEdge: z.number().nonnegative(), doorPerEdge: z.number().nonnegative(), staffDoorPerEdge: z.number().nonnegative(), atcRangeM: z.number().positive(), transitionPadCells: z.number().int().nonnegative(), walk: z.object({ latticeCells: z.number().int().positive(), dirtyMarginCells: z.number().int().positive(), cacheSources: z.number().int().positive(), travelatorRefWalkMps: z.number().positive() }), service: z.strictObject({ cv: z.number().positive().max(1), queueDensityPerM2: z.number().positive(), queueReachCells: z.number().int().positive(), queueSlots: z.number().int().positive() }) }),
  modules: z.object({ checkIn: module, security: module, belt: module, seating: module, toilet: module, atc: module, kiosk: module, bagDrop: module, passport: module, gateDesk: module }),
  fixtureCosts: z.strictObject({
    note: z.string(),
    'securityExit.staffed': z.number().nonnegative(),
    'securityExit.auto': z.number().nonnegative(),
    'securityExit.revolving': z.number().nonnegative(),
    eGate: z.number().nonnegative(),
    customs: z.number().nonnegative(),
    'travelator.8': z.number().nonnegative(),
    'travelator.16': z.number().nonnegative(),
    'travelator.24': z.number().nonnegative(),
  }),
  fixtureLevels: z.strictObject({
    note: z.string(),
    checkIn: fixtureLevel,
    security: fixtureLevel,
    passport: fixtureLevel,
    gateDesk: fixtureLevel,
    premiumLevel: z.number().int().min(1).max(3),
    premiumPenalty: z.number().nonnegative(),
    priorityLevel: z.number().int().min(1).max(3),
  }),
  props: z.strictObject({
    note: z.string(),
    costByCategory: z.strictObject({
      seating: z.number().nonnegative(),
      lounge: z.number().nonnegative(),
      washroom: z.number().nonnegative(),
      decoration: z.number().nonnegative(),
      vending: z.number().nonnegative(),
      screens: z.number().nonnegative(),
      service: z.number().nonnegative(),
      office: z.number().nonnegative(),
      backOfHouse: z.number().nonnegative(),
    }),
    perSeat: z.number().nonnegative(),
    perAmbience: z.number().nonnegative(),
    costById: z.record(z.string(), z.number().nonnegative()),
    upkeepPctPerMonth: z.number().nonnegative(),
    blockShare: z.number().gt(0).max(1),
    comfortWeight: z.number().nonnegative(),
    seatsPerGateDesk: z.number().positive(),
    ambienceAreaM2: z.number().positive(),
    toiletServersTarget: z.number().positive(),
    seatingAsset: z.string(),
    toiletAsset: z.string(),
    effectsNote: z.string(),
    vendingNeeds: z.record(z.string(), z.array(z.enum(['hunger', 'thirst', 'shop'])).min(1)),
    adPerPax: z.record(z.string(), z.number().nonnegative()),
    paxPerAdSlot: z.number().positive(),
    wayfindingAreaM2: z.number().positive(),
  }),
  tower,
  shops: z.object({ convenience: shop, quickFood: shop, cafe: shop, dutyFree: shop, booksGifts: shop, pharmacy: shop }),
  useAreas: z.strictObject({
    note: z.string(),
    fixtures: z.record(z.string(), z.strictObject({ front: z.number().int().min(0).max(3), back: z.number().int().min(0).max(3) })),
    propFrontM: z.strictObject({
      seating: z.number().nonnegative(),
      lounge: z.number().nonnegative(),
      washroom: z.number().nonnegative(),
      decoration: z.number().nonnegative(),
      vending: z.number().nonnegative(),
      screens: z.number().nonnegative(),
      service: z.number().nonnegative(),
      office: z.number().nonnegative(),
      backOfHouse: z.number().nonnegative(),
    }),
  }),
  airlines: z.object({ regionalNames: z.array(z.string()).min(4), nationalNames: z.array(z.string()).min(4), suffixes: z.array(z.string()).min(2) }),
});

export type BusinessData = z.infer<typeof businessSchema>;
