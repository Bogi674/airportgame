# T32. Tenants: zoned units, applications, furnishing

Milestone M6. Roadmap line: "Shop units with 6 categories, simple tenant fill by rating, sales and rent". Redesigned by the user on 2026-11-10. This spec replaces the earlier "shop sales and tenant fill" spec. Status `blocked` until the user answers the open questions.

## Goal

The player zones a unit inside a terminal and gives it a category. Generated brands apply for the unit. The player accepts one, and the tenant furnishes the unit from templates. Advertising raises the number of applications. Tenant variety is unlimited and grows with the airport.

## Read first

* `docs/GAME_DESIGN.md` section 9 (shops and tenants) and section 13 (finance).
* `docs/AIRLINES.md` for the generator pattern that brands should follow.
* `src/shared/business.ts`, `src/shared/terminalOps.ts`, `src/shared/terminalRooms.ts`: zones, rooms and fixtures.
* `src/sim/business/business.ts`: the current shop rent.
* `src/data/business.json` and its schema.
* `handoff/tasks/T17-satisfaction.md` and `handoff/tasks/T14-cohorts-departure.md`: sales need cohorts and satisfaction.

## Requirements

* R1. Zoning: the player marks a unit as a set of floor cells in a terminal and picks its category.
* R2. Applications: brands are generated from data on a forked seeded stream, so the same seed gives the same applicants. The pool is not a fixed list.
* R3. The player accepts or declines an application. Nothing moves in without the player's accept command.
* R4. Furnishing: the accepted tenant fills the unit from templates in data, matched to the unit's size and category.
* R5. Advertising raises the application rate.
* R6. Variety grows with the airport.
* R7. Sales and rent run through the daily finance tick (hard rule 8), driven by cohorts passing the unit.
* R8. Tenant state is saved, with a save version bump and a migration.
* R9. Determinism test: 2 000 ticks twice from one seed, identical `stateHash`, including a zone, an application and an accept.

## Open questions, all block the task

Ask the user, never invent:

1. The category list, and whether the six MVP 1 shop types stay as categories.
2. Unit size limits per category.
3. Application rate, what drives it, and how advertising changes it and what it costs.
4. The rent and sales model: fixed rent, a share of sales, or both, with the numbers.
5. What "grows with the airport" is measured by.
6. What happens to the shop fixtures and rent that exist today.
