# T32. Tenants: zoned units, generated brands, applications, sales

Replaces the pre revamp draft. Design: `docs/DESIGN_REVISION_4.md` section 7.1 and 7.2, values D29 to D31, answers in `handoff/QUESTIONS.md` (2026-11-23 T32).

## Goal

The player zones a rectangle of terminal floor as a tenant unit of one category. Brands generated per seed apply for vacant units, the player accepts or declines, and the accepted tenant furnishes the unit from data templates. Passengers visit leased units for their needs and wants, and the unit pays rent plus a share of the sales counted from those visits. Campaigns buy extra applications, and the brand pool grows with yearly passengers.

## Read first

`src/sim/business/business.ts` (daily close, rent, rating), `src/sim/cohorts/cohorts.ts` (visit choice, recordVisit), `src/sim/terminal/visitPoints.ts`, `src/data/needs.json`, `src/shared/business.ts`.

## Requirements

1. R1 data: `src/data/tenants.json` with a zod schema: categories (convenience, quickFood, cafe, bar, booksGifts, pharmacy) with min and max m2 (D29), brand name parts, colors, furnishing templates; rent per m2 per day 1.2 and sales share 0.12 (D31); application period 10 days, campaign cost 20 000, pool base 3, pool growth 1 per 100 000 yearly passengers (D30), at most 3 pending applications.
2. R2 commands `zoneUnit`, `removeUnit`, `acceptTenant`, `declineTenant`, `adCampaign`, validated with problem codes.
3. R3 brands are generated from forks of the seed by category and index, so the same seed gives the same brands. Applications arrive every 10 days per category with a vacant unit, a brand not leased elsewhere.
4. R4 leased units are visit points of their category; bar meets thirst and is a shop category; visits add the members' spend to the unit's sales.
5. R5 the daily close books rent plus the sales share as rent income; the shops rating term counts leased units.
6. R6 units, brands in use, applications and the trailing yearly passengers are saved (version 39), hashed, and old shop fixtures convert to units with a generated tenant on load.
7. R7 render: unit outline, furnishing from the template in the brand color, the brand sign; ghost of the unit tool with the size check.
8. R8 UI: Unit tool with a category picker, Tenants sheet listing units, tenants, sales and applications with accept and decline, campaign buttons per category, remove unit.
9. R9 tests: commands, applications, sales from visits, migration, determinism 2 000 ticks twice.

## Acceptance

Two seeds show different brands; shop income follows real visits; an old save with shop fixtures loads with leased units.
