# T11. Kiosk, bag drop, passport booth, gate desk

Milestone M4. Roadmap line: "Core fixtures: check in desk, kiosk, bag drop, security lane, passport booth, gate desk, bench, toilet block".

## Goal

The four missing fixtures can be placed in a terminal, are validated by room rules, and add the capacity the table in `docs/GAME_DESIGN.md` section 8 gives them.

## Read first

* `docs/GAME_DESIGN.md` section 8, the fixtures table and the passenger journey.
* `docs/ART_AND_ASSETS.md` section 11 (terminal interior kit).
* `handoff/RECIPES.md` R11 and `handoff/PITFALLS.md` item 6.
* `src/shared/business.ts` (`FIXTURE_KEYS`, `FIXTURE_ZONES`, zones), `src/shared/terminalOps.ts` (`planEdit`, `summarize`), `src/shared/terminalRooms.ts`.
* `src/data/business.json` (`modules`) and its schema.
* `src/sim/business/business.ts`: `depCapacity`, `arrCapacity`, `readiness`.
* `src/render/markings/airfieldPaint.ts`: `paintTerminal` (how fixtures are drawn).
* `src/ui/BuildMenu.tsx`: the terminal category and `fx`.

## Requirements

* R1. Append `kiosk`, `bagDrop`, `passport`, `gateDesk` to the end of `FIXTURE_KEYS`. Existing ids must not change; a test asserts the old ids.
* R2. Footprints from the table: kiosk 1 by 1 cell, bag drop 2 by 1, passport booth 1 by 1, gate desk 2 by 1, rotated with the building grid in 90 degree steps. If multi cell fixtures do not exist yet, add footprint support in `planEdit`: all cells must be floor and free, and erasing any cell removes the whole fixture.
* R3. Module data in `business.json`: cost, servers, service time in seconds, staff, from the table. Costs follow the existing modules' scale; write your chosen numbers in the plan and ask the user in `handoff/QUESTIONS.md` if no existing module is comparable.
* R4. Zones: kiosk and bag drop landside; passport booth on the boundary between landside or airside and an international zone if zones model it, otherwise airside; gate desk airside. Room validation warns when a gate area has no gate desk once gate desks exist in the building.
* R5. Capacity: until cohorts exist (T14), add their throughput to the existing aggregated capacity: kiosks and bag drops add to check in capacity with their service times; gate desks are required for contact stand boarding once any exists; passport booths add an international capacity that later tasks use. Record the interim rule as a decision.
* R6. Drawing and build menu cards with thumbnails, matching the interior kit style.
* R7. Save format: the fixture layer already stores ids; if footprints add a layer or an orientation, bump the version (recipe R3).

## Tests

* Old fixture ids unchanged. Placement, footprint, rotation and erase of a 2 by 1 fixture. Zone rules. Capacity numbers for a terminal with two kiosks and one bag drop.

## Visual check

A small terminal with one of each fixture at about 6 px/m, compared with the interior kit sheet in `docs/art/` (find it by name in the folder and in section 14).
