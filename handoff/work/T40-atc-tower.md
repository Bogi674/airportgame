# T40: Standalone ATC tower with five levels

Status: doing
Branch: glm/mvp1

## Requirements

Copied from `handoff/tasks/T40-atc-tower.md`, which was repaired on 2026-11-06 to match `handoff/QUESTIONS.md`. Each line is testable on its own.

* [x] R1. New sim object `Tower { id, x, y, level }` in the airfield payload. Placed on owned land only, with a footprint rectangle from data (`tower.footprintM`, 15 m by 15 m at every level).
* [x] R2. New command `buildTower { x, y, level }`, plus `upgradeTower { id }` and `demolishTower { id }`. Money, land and overlap checks follow the GA block pattern.
* [ ] R3. The tower is the only ATC source. `atcOk` is true when at least one tower stands. Range is the whole airport with no distance limit, so the old 3.5 km control room range does not apply. The control room fixture keeps its `FIXTURE_KEYS` index for save compatibility, grants no coverage, and is removed from the buildable list. Saves that had a control room and no tower lose ATC until a tower is built, with a warning on load.
* [ ] R4. Capacity: the movement budget per hour per runway is 20 at level 1, 40 at level 2, 60 at level 3, 80 at level 4 and 100 at level 5. A movement is a landing or a takeoff. Taxiing is free, so a full turnaround costs 2 movements. The budget is a rolling 60 minute window, spent as the movement starts. When the budget is gone, further movements wait in a first in first out queue and are released as the budget frees. An aircraft that has already landed or is airborne is never held mid operation, and an aircraft already holding a runway reservation is never held either. Overload shows as an overload warning plus the queue length, not a hard refusal of the schedule.
* [x] R5. A runway count above the level's cap is refused at build time with a problem code naming the level needed. The caps are 1, 1, 2, 2 and unlimited.
* [x] R6. Upgrades are bought with cash only. There is no stage gate and no stage state in the sim.
* [ ] R7. Drawing: vector geometry in meters in the chunk painter, five distinct looks from a simple tower with a window to a tall 360 degree glazed tower. Drawn under aircraft and vehicles.
* [ ] R8. Placement follows the T42 construction grid once that lands. Until T42 lands, it places on 0 and 90 degree steps relative to the nearest frame, as `frameAt` does today.
* [x] R9. Save format bump with a migration that defaults `towers` to an empty list and keeps existing control rooms valid.
* [x] R10. Determinism test: 2 000 ticks twice from one seed, identical `stateHash`, including a tower build and upgrade.
* [ ] R11. Strings for every new text in `src/ui/strings/en.json`, appended next to related keys.
* [x] R12. Without a tower, GA and private aircraft only. No airline schedules commercial flights, and there is no default movement budget for commercial traffic.

## Read first (done)

* [x] every file the spec lists
* [x] handoff/PITFALLS.md
* [x] handoff/QUESTIONS.md, handoff/STATE.md, handoff/RECIPES.md, handoff/templates/PLAN.md, handoff/templates/REPORT.md

Notes from reading:

* `src/sim/ops/traffic.ts` 592 `trySpawnArrival` is the single place an arrival is admitted. It scans runways (601 to 641), picks the exit and the stand (659 to 672), checks `departureStarving` (674), then `slotFree` (684) and `reserve` (689). The budget gate belongs between the runway choice and `slotFree`, so a blocked flight keeps its chosen exit and stand and retries.
* `src/sim/ops/traffic.ts` 1328 `planDeparture` is the single place a departure is admitted. It picks the entry, direction and backtrack (1342 to 1394) and only then writes state at 1403 to 1434 (`entryDeparting++`, `rwyIdx`, `rwyDir`, state Pushback or TaxiOut, `hooks.pushback`). The budget gate belongs between 1402 and 1403, before any state change, so a blocked aircraft stays in `AcState.Turnaround` and keeps its stand.
* `src/sim/ops/traffic.ts` 1471 `tryClearDeparture` reserves the runway for an aircraft already at the holding point, and 876 `updateLanding`, 1516 `updateBacktrack` and 1549 `updateTakeoff` extend an existing reservation in place (902, 1564). None of these may consult the budget: they are mid movement. This is the answer to "where must the rolling budget be enforced so an aircraft already holding a runway reservation is never frozen".
* `src/sim/ops/traffic.ts` 578 `delay` adds `RETRY_TICKS` (300 ticks, 30 game seconds) to `fDelay` and diverts when `fDelay > MAX_DELAY_TICKS` (12000 ticks, 20 game minutes). The budget wait needs its own window of 30 game minutes, which is 18000 ticks, so `delay` gains a limit parameter.
* `src/sim/ops/traffic.ts` 447 `updateFlights` admits arrivals every 10 ticks (subsystem 4 of `Sim.step`, `src/sim/sim.ts` 138), and `Traffic.update` admits departures (subsystem 5, `src/sim/sim.ts` 141). Two flights can be admitted in one pass, so the budget check and the spend must be one atomic call.
* `src/sim/ops/traffic.ts` 1647 `arrays` lists every saved per aircraft array (PITFALLS 5). The new departure wait array goes there. 1720 `hash` folds aircraft state, so the wait array must reach the hash through the saved arrays or through an explicit fold.
* `src/sim/airfield/airfield.ts` 562 `buildGaBlock` is the pattern for a free standing build: `checkPolygon` for land, `place(items, cash)` for money, `record` for undo, `refresh` for the network. 131 `refresh` bumps `data.version`, which makes `Sim` call `traffic.setAirfield` (`src/sim/sim.ts` 129 to 132) and wipes runway reservations, so a tower change must NOT call `refresh`. It follows `obstaclesVersion` (91, 98) instead: a separate counter folded into `Sim.takeAirfieldDirty` (292).
* `src/sim/airfield/airfield.ts` 1068 `saveState` and 1073 `loadState` are the save pair, and 1091 `hash` folds every saved object. All three gain towers.
* `src/sim/business/business.ts` 266 `atcOk` reads `atcCells`, `atcX`, `atcY` and `BUSINESS.terminal.atcRangeM`. 285 `readiness` pushes `noAtc` or `atcRange`. 470 `scheduleToday` and 497 `dailyClose` return early when `atcOk` is false, which is what stops commercial flights. 355 `staffCount` keeps counting `modules.atc.staff`.
* `src/sim/save/migrations.ts` 6 `SAVE_VERSION` is 7. The recipe is R3.
* `src/ui/Sheets.tsx` 175 is the hardcoded `runways * 4` cap. `src/ui/BuildMenu.tsx` 195 is the control room card that must go. `src/ui/ContextBar.tsx` 216 is the fixture select that must stop offering id 12. `src/ui/thumbs.tsx` 160 is the control room thumbnail.
* `src/ui/alerts.ts` 5 `ALERT_CODES` and 31 the `noAtc` case are where the new load warning lands.
* `src/render/markings/airfieldPaint.ts` 41 `paintAirfield` bakes static airfield paint into chunks; 122 `paintTerminal` and 123 `paintStands` are the neighbours for the new tower paint.
* `scripts/stress.ts` 34 to 40 builds five scenarios with `setTestTraffic` and no tower. `busy50` requires a peak of 50 aircraft. Since the budget applies to every movement ATC admits, each stress scenario must build a level 5 tower, or the peak requirement breaks.
* `tests/helpers.ts` 101 to 102 `buildTestTerminal` paints the control room by default, and `tests/business.test.ts` 195 to 209 asserts that a control room makes `atcOk` true. Those tests move to a tower.

## Design

* Data added (file, keys, values with their source in the docs):
  * `src/data/business.json`, a new `tower` block, recipe R2, with a `note` naming the user decisions of 2026-11-06. It sits in business.json because the block is cost and capacity data, which is what that file holds, and because the airfield code file stays geometry only.
    * `cost: 100000` for level 1 and `upgradeCost: 50000` per level above it.
    * `footprintM: 15`, the square side at every level.
    * `levels: [{ movementsPerHour, maxRunways }]`, five rows, index 0 is level 1: 20, 40, 60, 80, 100 movements per hour and caps 1, 1, 2, 2, -1, where minus 1 means unlimited.
  * `src/data/schemas/business.ts`: a strict `tower` schema with a five row check and a refine that neither `movementsPerHour` nor `maxRunways` falls as the level rises.
  * `src/data/business.json` keeps `modules.atc` and `terminal.atcRangeM` untouched. `atcRangeM` becomes unused by the sim but stays in the file so no unrelated value changes (AGENTS.md, never change a value the task does not mention).
* Types added or changed:
  * `src/shared/airfield.ts`: `export interface Tower { id: number; x: number; y: number; level: number }` and `towers?: Tower[]` on `AirfieldPayload`, optional so the existing payload literals in `src/sim/ops/traffic.ts` 140 and 141 and in `EMPTY_AIRFIELD` need no edit. `towers` is read with `?? []` everywhere, following how `pads` and `holds` are handled.
  * `src/shared/business.ts`: `towerLevel: number` and `atcQueue: number` on `BusinessPayload`, both derived. No test builds a `BusinessPayload` literal, so nothing else changes.
* Functions added or changed, one line each with what they do:
  * `src/shared/towerBudget.ts` (new): `towerLevelOf(af)` the highest tower level or 0, `movementsPerHour(level)`, `runwayCapOf(level)`, `levelForRunways(n)` the cheapest level that allows n runways, and `towerCapacity(af)` returning `{ hasTower, level, perHour, total }`. Pure functions over `BUSINESS.tower`, no state, so the sim, the renderer and the UI cannot disagree. This is the shared home for the ladder because `SlotsSheet`, the tool preview and the traffic gate all read it.
  * `src/shared/towerGeom.ts` (new): `towerBlocked(af, rect)` true when the rectangle touches a runway strip, a taxiway strip, an apron or a stand, by sampling the footprint every metre, and `towersOverlap(a, b)` for two axis aligned footprints. Shared so the tool preview validates with the same test the sim uses (R7 of RECIPES). `towerRect` itself sits in `src/shared/airfield.ts` next to `Tower`, because the renderer needs it too.
  * `src/sim/airfield/airfield.ts`: `buildTower`, `upgradeTower`, `demolishTower` handlers in the `execute` switch, all following `buildGaBlock`: `checkPolygon` then `towerBlocked` then money, then state, then `record`. They bump a new `towersVersion` counter instead of calling `refresh`. `buildRunway` (230) gains the cap check at the top, using `runwayCapOf(towerLevelOf(this.data))` and refusing with `towerRunwayCap|level=<needed>`. `saveState` gains `towers`, `loadState` defaults `o.towers ?? []`, `hash` folds each tower's id, position and level.
  * `src/sim/ops/traffic.ts`: `setTowerLevel(level)` stores the effective level for the budget, called from `Sim.apply` and `Sim.restore` because `traffic.af` is a shallow copy that never sees the new towers array (PITFALLS 4). `movStart`, `movHead` and `movCount` form the rolling ledger, one ring per runway, reallocated in `setAirfield` next to `rsvStart` and carried across a rebuild by runway id. `fMovWait` and the new per aircraft `depWait` plus `depRetryAt` form the wait that the retry schedule serves, and the 30 game minute window counts only budget waits. `movementFree(runwayIdx)` is the check and `spendMovement(runwayIdx)` the spend, called only at the two admission points. `atcQueueLength()` returns the waiting movements for the UI.
  * `src/sim/business/business.ts`: `atcOk` becomes `towers.length > 0 && runways.length > 0`, dropping `atcCells`, `atcX`, `atcY` and `atcRangeM` from the decision. `readiness` pushes only `noAtc`. `payload` (664) gains `towerLevel` and `atcQueue`.
  * `src/sim/sim.ts`: `apply` gains the three tower commands and, after them, `this.business.version++` and `this.traffic.setTowerLevel(...)`, the same pattern as `setAutoStands` at 202. `restore` (373) emits `atcLost` when the loaded save had control room cells and no tower.
  * `src/render/markings/towerPaint.ts` (new): `paintTowers(ctx, af, win)`, called from `paintAirfield` between `paintTerminal` (122) and `paintStands` (123). Sizes come from `AIRFIELD.tower` in meters, and the shadow is drawn longer than other buildings per `docs/ART_AND_ASSETS.md`.
  * `src/ui/tools/controller.ts`: `previewTower` and `commitTower` next to the GA block pair at 1412 and 1462, plus a `tower` case in `up` (464) and the preview path near 528.
* Recipe used (handoff/RECIPES.md): R1 for the three commands, R2 for the data block, R3 for the save bump, R4 for the derived tower version counter that must not rebuild the network, R5 for the new per aircraft array, R6 for the strings, R7 for the build tool, R8 for the chunk paint, R9 for the determinism test, R10 for the screenshots.
* Save format change: version 7 to 8. The airfield payload gains `towers`, and a save without it has none. The migration step is:
  ```ts
  // Version 7 to 8: the ATC tower became a free standing building. Older saves have no towers and
  // their control rooms no longer grant coverage, so they keep flying GA only until a tower is built.
  if (save.version < 8) save.version = 8;
  ```
  No field conversion is needed because `Airfield.loadState` defaults `towers` to an empty list, which is what R3 of RECIPES calls for. `tests/save.test.ts` gains a version 7 object that loads with no towers and emits the load warning.
* Why this design and not the obvious alternative:
  * The budget gate sits at the two admission points and nowhere else, because a gate anywhere later would freeze an aircraft that already owns the runway. `tryClearDeparture` and the landing and takeoff updates only ever extend a reservation that exists, so they stay out of the budget path entirely.
  * The FIFO queue is not a new array of waiting movements. It is the retry schedule that already exists: a blocked arrival waits on `fRetryAt`, set by `atcWait`, and a blocked departure waits on `depRetryAt`. Both advance by the same `RETRY_TICKS` step, so the movement blocked earliest has the earliest retry phase and normally goes first. The user approved enforcing the budget on that 30 game second cadence, so a slot that frees between two retries is taken by the first retry after it, not at the tick it frees. An explicit ring of pending movements would need a per tick release path and more saved state for the same result.
  * The rolling window is a ring of movement start ticks per runway, keyed by runway id rather than by array index, because `setAirfield` rebuilds the network and reallocates the reservation arrays whenever the airfield version changes. Keying by id keeps the count correct across a rebuild, and expired entries are dropped as the head advances, so the scan is O(1) amortised.
  * The tower bumps its own `towersVersion` counter instead of `data.version`, because a version bump calls `traffic.setAirfield`, which replans every aircraft and clears every runway reservation (PITFALLS 1). The counter still reaches the UI through `Sim.takeAirfieldDirty`, which already folds `obstaclesVersion`, so the renderer re-bakes the chunks that hold the new tower.
  * Test traffic is metered like any other traffic, because the budget is a property of the tower, not of the airline. With no tower there is no budget at all, which keeps GA and private movement unscaled and matches "no default commercial budget". The consequence is that `scripts/stress.ts` must build a level 5 tower in every scenario or the `busy50` peak requirement fails; that edit is part of slice 3.

## Slices

1. Sim data, tower object and commands, no behaviour change. (R1, R2, R9, R5) Files: `src/data/business.json`, `src/data/schemas/business.ts`, `src/shared/airfield.ts`, `src/shared/towerBudget.ts`, `src/shared/towerGeom.ts`, `src/sim/airfield/airfield.ts`, `src/sim/commands.ts`, `src/sim/sim.ts`, `src/sim/save/migrations.ts`, `tests/tower.test.ts`. Done. The place strings (`towerLevel`, `towerMaxLevel`, `towerOnPavement`, `towerOverlap`, `towerRunwayCap`) landed here too. Ends green with `atcOk` still reading the control room, so nothing the player sees changes yet.
2. The tower becomes the only ATC source. (R3, R12, R6) Files: `src/sim/business/business.ts`, `src/sim/sim.ts`, `src/shared/business.ts`, `src/ui/strings/en.json`, `src/ui/alerts.ts`, `src/ui/BuildMenu.tsx`, `src/ui/ContextBar.tsx`, `src/ui/thumbs.tsx`, `src/ui/Guide.tsx`, `tests/business.test.ts`, `tests/save.test.ts`, `tests/helpers.ts`. Done. The control room card disappears, the checklist asks for a tower, the terminal helper builds a level 5 tower, and a loaded save that relied on a control room warns once with `atcLost`.
3. The rolling movement budget and the FIFO queue. (R4, R10) Files: `src/sim/ops/traffic.ts`, `src/shared/towerBudget.ts`, `src/sim/business/business.ts`, `src/sim/sim.ts`, `scripts/stress.ts`, `tests/tower.test.ts`, `tests/traffic.test.ts`. About 300 lines. The budget ledger, the queue, the 30 game minute divert window, the `atcQueue` payload field and the determinism test all land here, and the stress tool gains a level 5 tower. Done. The ledger is a ring of movement start ticks per runway, keyed by runway id when the network is rebuilt, so a taxiway edit cannot reset the budget. A blocked departure waits on `depRetryAt` and keeps its stand; only arrivals divert, after 18000 ticks of budget wait. `Sim.apply` refreshes the traffic level from `towersVersion`, which also covers undo and redo. The tests read admissions from the aircraft states instead of the sim internals.
4. Render the tower. (R7, R8) Files: `src/render/markings/towerPaint.ts`, `src/render/markings/airfieldPaint.ts`, `src/render/bake/bakeWorker.ts` if the worker needs the payload, `handoff/scenarios/T40-atc-tower.json`, `shots/T40`. About 200 lines plus the scenario. Five looks, true scale, checked at two zooms.
5. UI: the tower tool and the overload readout. (R4, R8, R11) Files: `src/ui/stores/toolStore.ts`, `src/ui/BuildMenu.tsx`, `src/ui/ContextBar.tsx`, `src/ui/tools/controller.ts`, `src/ui/Sheets.tsx`, `src/ui/strings/en.json`, `docs/UI_DESIGN.md`. About 220 lines. The last step is the `SlotsSheet` cap and the queue length, so the player sees the whole feature at once.
6. Docs. Files: `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/GAME_DESIGN.md`, `docs/ART_AND_ASSETS.md`, `docs/UI_DESIGN.md`, `handoff/TASKS.md`, `handoff/STATE.md`. Run `npm run rules` again after the edits.

## Tests

* `tests/tower.test.ts`, placement and money:
  * build at level 1 on owned land: one tower at the rounded position, `sim.cash` falls by exactly 100000, and the footprint is 15 m by 15 m.
  * build at level 3 on owned land: cash falls by 100000 plus 2 times 50000, so 200000, and the tower level is 3.
  * build on a parcel the player does not own: `notOwned`. Build on water: `onWater`. Build with the rectangle over a runway strip: `towerOnPavement`. Build with cash below the cost: `insufficientFunds` with `cost` in the args.
  * upgrade a level 1 tower: level 2 and cash down 50000. Upgrade a level 5 tower: `towerMaxLevel`. Demolish: refund of 25 percent of the money spent, following `REFUND_SHARE`.
  * runway cap: with a level 1 tower the second runway build returns `towerRunwayCap` with `level=2`. With a level 3 tower two runways build and the third returns `towerRunwayCap` with `level=5`. With a level 5 tower three runways build and a fourth is accepted.
* `tests/tower.test.ts`, the budget, using `setTestTraffic` and a small airport:
  * level 1 tower, 20 movements per hour, one runway, 120 arrivals offered per hour for 2 game hours: no more than 20 movements (landings plus takeoffs) are admitted in any rolling 60 minute window. Admissions are counted from the aircraft states, not from sim internals.
  * the 21st movement on a runway is admitted no earlier than 36000 ticks after the first one, which is the 60 minute window.
  * an arrival that has waited 18000 ticks for a movement emits `flightDiverted` with `reason=noMovement` and increments `divertedFlights`, and the payload shows a queue above zero before that.
  * mid movement safety: over 20000 ticks at 120 arrivals per hour with a level 1 tower, every aircraft in `AcState.Approach`, `Rollout`, `Takeoff` or `Backtrack` keeps `rwySlot >= 0` while it owns the runway, `rwyS` never jumps backwards on approach, rollout or takeoff, and no aircraft is removed while it holds a reservation. A takeoff hands its reservation back after rotation, so it is only checked while still on the runway.
  * no tower: `atcOk` is false, `readiness()` contains `noAtc`, and test traffic still lands more than 20 aircraft an hour because there is no budget at all.
  * determinism: two metered sims from one seed give the same `stateHash` after 4000 ticks under budget pressure, on top of the existing build and upgrade case (RECIPES R9).
  * save and restore: a metered sim saves after 5000 ticks, restores into a fresh sim with the same hash, and both continue another 5000 ticks to the hash of an uninterrupted run (RECIPES R9, second half).
* `tests/data.test.ts`: the three new refines on the `tower` block, one case each.
* `tests/save.test.ts`: a version 7 save object with an airfield that has no `towers` loads with an empty list, `atcOk` false, and the `atcLost` event once.
* `tests/business.test.ts`: the control room case moves to a tower. A control room alone leaves `readiness()` containing `noAtc`. A tower alone clears it.
* determinism: covered by the case above, 2000 ticks twice from one seed.

## Visual check

* Scenario: `handoff/scenarios/T40-atc-tower.json`, copied from `handoff/scenarios/example-airport.json`, with commands that build the runway, the parallel taxiway, the apron, the stands and the terminal, then five towers at levels 1 to 5 in a row on owned land east of the apron, then an upgrade of the first to level 5.
* Shot 1 `tower-levels` must show: five towers side by side, all five looks visibly different, level 1 a simple shaft with one window, level 5 a tall shaft with a full 360 degree glazed ring, each standing on a 15 m square pad, all drawn under the aircraft, and no label or readout overlapping another.
* Shot 2 `tower-detail` at about 2 px per meter must show: the 15 m footprint measured at 30 px, the cab ring, the base, the longer shadow, and no shape cut by the frame.
* Shot 3 `tower-overview` at about 0.3 px per meter must show: all five towers legible as distinct silhouettes against the apron, with no tower merging into the terminal.
* Shot 4 `tower-tool` must show: the tower tool active, the ghost preview on owned land with the problem line empty, the level select in the context bar, and the same preview over protected land showing `notOwned`.
* Shot 5 `slots-overload` must show: the Slots sheet with a level 1 tower, signed rotations above 20 per hour, bars over the cap in the bad colour, the queue length in the help line, and no text overflowing its box.
* Reference sheet: none exists in `docs/art/`. The only written reference is the control tower line in `docs/ART_AND_ASSETS.md`, a circular cab with a glass ring on a square base and a shadow longer than other buildings.
* True scale check: the 15 m footprint at 2 px per meter is 30 px, and the runway width from `AIRFIELD.codes` times the zoom. No asset is scaled for readability.
* Label overlap: the tower paint draws no text. The existing readout offsets in `drawGhost` are unchanged, and every screenshot is checked for a readout sitting on the snap ring.

## Open questions

These need the user before the slice named. Everything else in this plan is decided by `handoff/QUESTIONS.md`.

1. Tower art geometry per level, before slice 4. Shaft height, base height, cab radius, cab height and glazing per level are not given anywhere, and `docs/ART_AND_ASSETS.md` gives no numbers. Recommendation: keep the cab inside the 15 m footprint, cab radius 5 m and cab height 3.5 m at every level, and grow only the shaft, 8 m at level 1 to 45 m at level 5 in even steps, with glazing from one window at level 1 to a full ring at level 5. These are art values, not gameplay values, so the plan proposes them rather than inventing a rule.
2. Does the runway cap apply when no tower stands, before slice 1. Recommendation: no. Level 0 allows any number of runways, because the player builds the runway before the tower and GA needs a runway to fly from. The cap starts at level 1, which allows one. If the user wants the stricter reading, `runwayCapOf(0)` returns 0 and every runway build without a tower is refused, which breaks the tutorial flow and the existing tests.
3. May the player build more than one tower, before slice 1. Recommendation: yes, and the effective level is the highest, which is what `towerLevelOf` returns. The alternative, refusing a second tower, needs a new problem code and a rule the user has not given.
4. Queue release granularity, before slice 3. A waiting movement retries every `RETRY_TICKS`, which is 30 game seconds, so a slot that frees at an exact tick is taken up to 30 game seconds later. Recommendation: keep it, because a per tick release path costs more than it gives. The user should know the budget is enforced to within 30 game seconds, not to the tick.
5. Does the 30 game minute divert window replace the existing 20 minute `MAX_DELAY_TICKS`, before slice 3. Recommendation: no. The budget reason uses 18000 ticks and every other reason keeps 12000, so a flight that waited 10 minutes for a stand and then hits the budget diverts after 20 more minutes of accumulated delay.
6. Metering test traffic, before slice 3. The stress scenarios offer up to 720 movements per hour on one runway, which a level 5 tower caps at 100. Recommendation: meter test traffic like any other traffic and add a level 5 tower to every stress scenario. The alternative, exempting test traffic, leaves the benchmark measuring an unscaled airport that no player can reach.

## Verify

Paste the summary block of `npm run verify` here before every commit of this task.

Slice 1, `npm run verify -- quick`:

```
PASS  rules
PASS  types
PASS  lint
PASS  tests (32 files, 294 tests)
verify: all checks passed.
```

Slice 2, `npm run verify -- quick`:

```
PASS  rules
PASS  types
PASS  lint
PASS  tests (32 files, 294 tests)
verify: all checks passed.
```

Slice 3, `npm run verify -- quick`:

```
PASS  rules
PASS  types
PASS  lint
PASS  tests (32 files, 301 tests)
verify: all checks passed.
```

Slice 3, `npm run stress` (no baseline update, every scenario builds a level 5 tower):

```
small       peak 8,  total mean 0.00759 ms  budget 1
medium      peak 10, total mean 0.00578 ms  budget 4
large       peak 15, total mean 0.00668 ms  budget 8
busy50      peak 62, total mean 0.02349 ms  budget 4
terminal640 peak 9,  total mean 0.00534 ms  budget 4
no budget breach, no regression over 10 percent
```

The full `npm run verify`, with stress, still has to run before the last commit of the task.

## Report

Fill from `handoff/templates/REPORT.md` when done.
