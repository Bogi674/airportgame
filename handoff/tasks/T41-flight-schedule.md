# T41. Flight offers and stand management

Milestone M6. Answers to the design questions are in `handoff/QUESTIONS.md` (2026-11-06 T41 entry).

## Goal

Airport CEO style flight management, kept simple. Every signed airline offers a set of flights per day with a fixed schedule and a fixed turnaround duration. The player drags a flight block into a stand timeline, and the drop is accepted only where the block fits: the stand must take the type, and the block must not overlap another block on that stand. Automation assigns the flights the player has not placed, using the same rule, and can be toggled off. There is no exact time editing and no manual runway choice.

## Direction change, 2026-11-06

The 2026-11-05 answer in `handoff/QUESTIONS.md` asked for exact arrival and departure times per flight plus stand and runway choice. The user withdrew that on 2026-11-06: exact time editing is too realistic. This spec replaces it. The words that govern this task are: fixed schedule, fixed turnaround, drag a block where it fits, automation can be toggled, no exact time edit, no manual runway choice unless the user asks for one.

## Read first

* `src/shared/business.ts` 3 to 9 (time constants), 98 to 113 (`Airline`), 117 to 132 (`BoardRow`), 134 to 164 (`BusinessPayload`)
* `src/sim/business/business.ts` 137 to 165 (`generateAirlines`), 167 to 181 (`signAirline`), 183 to 189 (`setSlot`, to be removed), 198 to 213 (`maxRotations`, `assignedTypes`), 365 to 441 (traffic hooks), 470 to 488 (`scheduleToday`, `stageFor`), 490 to 495 (`usableTypesFor`), 497 to 542 (`dailyClose`), 621 to 662 (`board`), 664 to 692 (`payload`), 694 to 744 (`saveState`, `loadState`), 799 to 811 (`SLOT_FIRST`, `SLOT_LAST`, `fitSlots`)
* `src/sim/ops/traffic.ts` 35 (`ROLE_TURNAROUND_MIN`), 115 to 137 (flight arrays, `autoStands`), 388 to 414 (`scheduleArrival`, `turnaroundTicks`), 417 to 435 (`usableTypes`), 447 to 460 (`updateFlights`), 470 to 498 (`slotFree`, `reserve`), 502 to 518 (`standFits`, `standAllows`), 520 to 546 (`pickStand`), 549 to 576 (`autoAssign`), 578 to 590 (`refuse`, `delay`), 592 to 727 (`trySpawnArrival`, runway choice at 596 to 641, `pickStand` call at 662), 1070 to 1091 (`checkArrivedAtEnd`, turnaround timer at 1078), 1328 to 1435 (departure planner), 1647 to 1660 (`arrays`)
* `src/sim/commands.ts` 32 to 35 (`assignStand`, `cancelFlight`, `setAutoStands`, `autoAssignStands`) and 45 (`setSlot`)
* `src/sim/sim.ts` 118 to 147 (`runSubsystem`), 172 to 235 (`apply`, dispatch at 195 to 213 and the airfield fallback at 223 to 233), 269 to 273 (`takeBusiness`), 292 to 297 (`takeAirfieldDirty`), 303 to 322 (`updateObstacles`), 373 to 394 (`restore`)
* `src/ui/Sheets.tsx` 163 to 218 (`clock`, `SLOT_OPTIONS`, `SlotsSheet`), 220 to 275 (`HOUR_PX`, `airlineHue`, `StandsSheet` block and lane helpers), 276 to 395 (the timeline), 397 to 436 (`FlightsSheet`), 466 to 475 (`Sheets`)
* `src/ui/BuildMenu.tsx` 163 to 166 (the scheduling tab, test ids `card-slots` and `card-standManagement`), `src/ui/theme.css` 62 to 75 (timeline and block styles), `src/ui/strings/en.json` 201 to 205 (`slots.*`) and 257 to 273 (`stands.*`), `src/ui/alerts.ts` (event codes)
* `tests/edit.test.ts` 105 to 135, `tests/business.test.ts` 167 to 221, `tests/save.test.ts`
* `handoff/RECIPES.md` R1, R3, R4, R6, R9, R10
* `handoff/PITFALLS.md` 1, 2, 3, 4, 5, 10, 13, 16, 23, 24
* `docs/AIRLINES.md` 28 to 30 and 156 to 171, `docs/GAME_DESIGN.md` 24 and 417 to 424, `docs/UI_DESIGN.md` 147 to 149, `docs/ROADMAP.md` 119

## Requirements

### Offer generation

* R1. One offer per rotation per signed airline per day. An offer is the scheduled flight the sim already creates in `Business.dailyClose` (business.ts 522 to 540) and in `scheduleToday` (470 to 482). T41 adds no second scheduling system. The offer list is a view over the `Traffic` flight arrays.
* R2. No invented numbers. The offer count comes from `Airline.rotations`. The arrival minutes come from `Airline.slots`, filled by `fitSlots` between `SLOT_FIRST` 06:00 and `SLOT_LAST` 21:00. The turnaround comes from `ROLE_TURNAROUND_MIN` (traffic.ts 35) through `Traffic.turnaroundTicks`. The stage length comes from `stageFor`. Nothing else sets a frequency or a time window.
* R3. Generation stays deterministic and in this exact order: airlines in `this.airlines` order, which is id ascending; rotations in index order 0 to rotations minus one; `usableTypesFor(a)` once per airline; per rotation one `this.rng.int` for the type and one for the stage in `stageFor`; arrival tick is the midnight that starts the day plus `a.slots[k] * TICKS_PER_MINUTE`; turnaround ticks are `traffic.turnaroundTicks(t)`. Two runs from one seed produce identical offers. Offer generation never reads the wall clock, the renderer or the UI.
* R4. The offers are visible before they are needed. At day rollover every rotation of the day exists as a `FlState.Scheduled` flight, so the sheet lists the whole day from midnight. `scheduleToday` keeps its existing 45 minute cutoff, so an airline signed late today only offers the rotations still ahead.
* R5. The schedule sheet lists offers read only. `SlotsSheet` becomes the flight offers sheet and keeps the sheet id `slots`, so the store, the rail and the build menu do not change. Per signed airline it shows one row per offer: aircraft type, scheduled arrival, turnaround minutes, the stand it is on or auto, and the stage length. No time field is editable anywhere. A stand select per row assigns or unassigns the stand through the existing `assignStand` command. An offer that no stand can take at all is flagged on its row with the reason from the shared rule in R8. Empty cases are handled: no signed airline, no stand, no runway, no offer left today. The flights board at Sheets.tsx 397 to 436 keeps its columns and gains the scheduled off block minute, computed from `turnMin` and the shared buffer, because the player now plans in blocks.
* R6. `BusinessPayload` gains `offers: OfferRow[]`, built by a new `Business.offers()`. Fields: `flight`, `airline`, `type` (icao code), `arrMin`, `turnMin`, `endMin`, `code`, `stageKm`, `standId`. `endMin` is `arrMin + turnMin + STAND_BLOCK_BUFFER_MIN`. Order is arrival tick then flight id, the same tie break `autoAssign` uses at traffic.ts 552. The list is capped at the 60 rows `board()` already uses for scheduled flights, and the cap is display only. `turnMin` is the nominal turnaround, not the one stretched by `serviceSlowdown`. No new saved state is needed for the offers themselves.
* R7. No exact time editing. `setSlot` is removed from the `Command` union (commands.ts 45), from `Sim.apply` (sim.ts 211 to 213) and from `Business` (business.ts 183 to 189). The 15 minute select in `SlotsSheet` (Sheets.tsx 164 to 165 and 198 to 209) goes with it. `Airline.slots` stays: it is the fixed daily pattern, saved, generated by `fitSlots`, and the player changes only how many rotations a contract has, through the existing `signAirline`. The slots test at `tests/business.test.ts` 211 to 221 is rewritten, not deleted: it now asserts that the pattern is fixed, that signing more rotations appends offers at the end, and that signing fewer drops from the end.

### One shared stand block rule

* R8. New module `src/shared/flightBlock.ts`, imported by the sim and by the UI, so the preview and the sim run the same code (RECIPES R7 step 5). It holds:
  * `STAND_BLOCK_BUFFER_MIN = 5`, with a comment naming the 3000 tick buffer in `Traffic.autoAssign` (traffic.ts 555 to 565) as its source. `autoAssign` and the UI both read this constant, so the buffer exists once.
  * `blockWindow(arrMin, turnMin)` returning `{ startMin, endMin }`, where `startMin` is `arrMin` and `endMin` is `arrMin + turnMin + STAND_BLOCK_BUFFER_MIN`.
  * `blocksOverlap(a, b)` as a pure comparison of two windows.
  * `StandFacts`: `closed`, `usage`, `size`, `surface`, `type`, `code`, `linked`, `contactOk`.
  * `refuseStand(facts, spec)` returning a refusal code or null. It calls `standRefusal` from `@shared/standSizes` for span and surface, and ports `standAllows` (traffic.ts 511 to 518) for closed and usage. Codes: `standSpan`, `standSurface`, `standClosed`, `standUsage`, `standNoTerminal`, `standNoLink`.
  * `refuseBlock(window, others)` returning `standBusy` with the conflicting flight number when the window overlaps a block already on that stand.
  * `Traffic.standFits` and `Traffic.standAllows` become calls into this module. The contact check and the lead in check stay where their inputs live: `Business.hasTerminalNear` for contact, `Traffic.net.standNode` for the lead in.
* R9. The UI gets the two facts it cannot compute. `BusinessPayload` gains `standLinked: number[]` and `standContact: number[]`, indexed the same way as `airfield.data.stands`, built in `Business.payload()` from a new public `Traffic.standLinkedPublic(index)` following the `usableTypesPublic` pattern, and from `Business.hasTerminalNear` for contact stands. Without them the preview would promise drops the sim refuses.

### Validation and the assign command

* R10. `assignStand` validates. `Sim.apply` (sim.ts 195 to 197) checks the flight is still `FlState.Scheduled`, then runs `refuseStand` and `refuseBlock`, then checks the stand has a lead in in the taxi network. A `standId` of -1 always succeeds and only clears the assignment. On refusal it reports the problem code through `this.report(...)` and leaves `fStand` unchanged, so the block stays where it was. On success it sets `fStand`, bumps `business.version` so the sheet refreshes at once, and returns null. Every new code gets a `notice.*` string (RECIPES R6): `notice.standSpan`, `notice.standSurface`, `notice.standClosed`, `notice.standUsage`, `notice.standNoTerminal`, `notice.standNoLink`, `notice.standBusy`. A missing taxi route still surfaces at arrival as it does today, with the existing `noStand` delay.
* R11. Conflict, size and timing rules, all from existing values:
  * Size: `standRefusal` gives `span` and `surface`. A stand too small for the wingspan, or with a surface the type cannot use, refuses the drop.
  * Usage and state: a closed stand refuses, a `ga` stand refuses a commercial type, a `commercial` stand refuses a type under 20 seats. Ported from `standAllows`.
  * Timing: the block is `blockWindow(arrMin, turnMin)`. Two blocks on one stand that overlap by the shared buffer refuse the drop with `standBusy` and name the flight in the way. A block is never moved in time by the player, so there is no other timing rule to check.
  * A block may run past 21:00. The latest arrival is 21:00 and the longest turnaround is 75 minutes, so a block can end at 22:20. The timeline keeps its 24 hour axis and no wrap rule is added.
* R12. The stands sheet draws the block from the shared rule. `Sheets.tsx` 243 and 270 replace `Math.max(30, r.turnMin + 10)` with `blockWindow`, so the drawn width is the true block and two invented numbers leave the render path. Overlapping blocks on one stand are drawn red with the conflict named in the title, and the sheet keeps the `Assign all now` button.

### Drag and drop

* R13. Blocks are dragged with pointer events on the sheet: `pointerdown`, `pointermove`, `pointerup`, matching the app's existing pointer handling in `MapView.tsx`. HTML5 drag and drop is not used.
* R14. A drag starts on a scheduled block only. A block for a flight already on the ground is not draggable, which is the existing `disabled={active}` at Sheets.tsx 246 to 252. A block keeps a minimum pointer target of 24 px even when the drawn block is narrower, and the drawn width still shows the true time. This is a hit area, not a scale change to an asset.
* R15. During the drag the block becomes a ghost that snaps to the row under the pointer and keeps its own fixed horizontal position, because the offer's schedule is fixed. The ghost shows the refusal reason in its title. Each stand row is a drop target and carries `data-drop="ok"` or `data-drop="bad"` while a drag is over it, painted green or red. The check is `refuseStand` plus `refuseBlock`, with `linked` and `contactOk` from the payload, so the preview never promises what the sim refuses.
* R16. Drop behavior: on a row that passes, send `assignStand { flight, standId }`. On a row that fails, send nothing and raise the notice toast with the reason code. Outside any row, cancel. On the unassigned lane, send `assignStand { flight, standId: -1 }`.
* R17. The existing click to select, then click a row, and the `Move to` select in the flight menu both stay as the pointer and keyboard fallback, and both go through the same command. The help text is updated to name both paths.
* R18. Test ids for the new behaviour, appended next to the existing ones: `offer-<flight>` on a block, `drop-ok` and `drop-bad` on a row during a drag, `offer-row-<flight>` on a schedule row, and `offer-stand-<flight>` on its stand select.

### Automation and ATC

* R19. One global toggle, the existing `autoStands` (traffic.ts 131), with its existing label and tooltip. There is no per airline toggle.
* R20. When automation is on, every offer without a stand gets one whose whole block is free, earliest offer first, by the existing `autoAssign` order (traffic.ts 549 to 576). Automation never overrides a stand the player set.
* R21. The auto pass also runs at these points, and nowhere else: the `autoAssignStands` command (sim.ts 205 to 207), as today; the `setAutoStands` case (sim.ts 201 to 204), after the flag is set and only when it is on; the `default` branch of `Sim.apply` (sim.ts 223 to 233), when the command is `buildStands`, `setStandProps` or `demolish` with kind stand and it returned no problem; and the end of `Business.dailyClose` (business.ts 541), after the offers are generated. The pass stays out of the tick loop, and it collects the assigned flights once per pass instead of scanning all 1024 flight slots for every stand, so a pass with many stands stays cheap.
* R22. A stand the player set is respected at arrival. `Traffic.pickStand` (traffic.ts 520 to 546) must not fall back to the best free stand when the flight has a stand set. With a stand set and that stand taken, the flight waits with the existing `noStand` delay and shows the delay on the board, and it diverts only after `MAX_DELAY_TICKS` as today. With automation off and no stand set, the flight waits, as the test at `tests/edit.test.ts` 119 to 128 already asserts.
* R23. No manual runway choice. No runway field appears in the offers sheet or the stand timeline. The runway is chosen by `trySpawnArrival` (traffic.ts 596 to 641) and the departure planner (1328 to 1435) exactly as today. A runway preference may be added later only if the user asks for it.
* R24. ATC rolling cap. The load bar in the offers sheet counts movements, not arrivals. One rotation costs two movements, its landing and its takeoff, which is the 2026-11-06 T40 answer. An hour's count is the landings plus takeoffs scheduled in that hour. The bar turns red above the tower's rolling hourly budget, and the budget is read from the tower state, never hard coded in the sheet. Until T40 lands, the existing placeholder `runways.length * 4` (Sheets.tsx 175) stays and the caption says it is the runway count heuristic. An overloaded hour never refuses or moves an offer; the excess movements queue, which is T40 R4. The existing ATC readiness gate in `Business.readiness` and `atcOk` still decides whether commercial offers are generated at all, and T41 does not change what satisfies it.

### Save, replay and determinism

* R25. No save format bump is needed for R1 to R24. Offers are derived from arrays that are already saved, `fStand` is already in `Traffic.arrays()`, and the new payload fields are derived. If decision D2 is taken, `Airline` gains a saved field, so `SAVE_VERSION` goes 7 to 8 with a migration that defaults it (RECIPES R3).
* R26. Determinism test (RECIPES R9): 2000 ticks twice from one seed, with a signed airline, one offer dragged to a stand, automation on in one run and off in the other, identical `stateHash` per pair. Then save mid run, restore into a fresh sim, run both on, identical `stateHash`. Replaying the same command log onto the same seed gives the same hash. Removing `setSlot` needs no migration, because saves do not store the command log.
* R27. Restored saves behave like an uninterrupted run. Nothing derived is recomputed in a way that rebuilds the taxi network, and the offers come back from the saved flight arrays, so a save and load mid run changes no offer and no assignment (PITFALLS 2).
* R28. Tests in `tests/edit.test.ts` next to the existing cases at 105 to 135: a drop on a stand too small for the type is refused with `notice.standSpan` and `fStand` stays -1; a drop whose block overlaps another block on that stand is refused with `notice.standBusy`; a drop on a valid stand assigns it; with automation off an offer with no stand still waits; with a stand set and that stand taken the flight waits instead of moving to another stand.

### Docs, strings and style

* R29. Strings are appended near `slots.*` and `stands.*` in `src/ui/strings/en.json`, never re sorted (PITFALLS 10). New keys cover the offers sheet title and help, the per row field labels, the movement load caption, the drag hints, the refusal reasons, and every `notice.*` code in R10. Existing keys keep their names; only values that no longer describe the sheet change.
* R30. Docs updated in the same commits: `docs/ROADMAP.md` line 119 gains a note that the slot manager is now a read only offer list, `docs/GAME_DESIGN.md` step 4 of the core loop says contracts, fees and rotations instead of slots, `docs/UI_DESIGN.md` side sheets section names the drag and drop in the stand timeline, and every new decision gets one line in `docs/ARCHITECTURE.md` section 12 with the date and the reason. `npm run rules` passes on the docs too.
* R31. Writing style holds everywhere: no em dashes, no en dashes, no spaced hyphen joining two parts of a sentence, and no parenthetical aside where a second sentence works.

## Out of scope

Route demand, seasons and contract minimum movements, which stay with T31. Per airline automation toggles. Manual runway choice. Turnaround task lists and vehicles, which stay with T22 to T26. Controllers on shift, departure metering and low visibility procedures, which stay with T40 and MVP 2. The tower itself and its numbers, which stay with T40.

## Numbers used, with their source

| Value | Where it comes from |
| --- | --- |
| Rotations per day per airline | `Airline.rotations`, set by `signAirline`, capped by `maxRotations` at business.ts 198 to 200 |
| Arrival minutes | `fitSlots` between `SLOT_FIRST` 06:00 and `SLOT_LAST` 21:00, business.ts 799 to 811 |
| Turnaround per type | `ROLE_TURNAROUND_MIN`, traffic.ts 35, through `turnaroundTicks` |
| Stand block buffer | 5 game minutes, the 3000 tick buffer in `autoAssign`, traffic.ts 555 to 565 |
| 45 minute cutoff for a late signing | `scheduleToday`, business.ts 478 |
| Movements per rotation | 2, the 2026-11-06 T40 answer |
| Hourly movement cap | the tower budget from T40, or the `runways.length * 4` placeholder at Sheets.tsx 175 until T40 lands |
| Offer list row cap | the 60 scheduled rows `board()` already uses, business.ts 644 |
| Minimum block hit area | 24 px, a UI affordance only, with no effect on the sim |

## Decisions still missing, do not guess

Each of these needs the user's answer before the code that depends on it. Nothing below is decided in this spec.

* D1. Is the aircraft type of an offer fixed for the life of the contract, or drawn per day as today? Today `dailyClose` draws the type from the business rng each day, so the same rotation can be a turboprop one day and a jet the next, and a block the player placed yesterday may not fit today. Option A keeps the per day draw, which is the smallest change and leaves the rng stream untouched. Option B fixes the type per rotation from the airline id and the rotation index over the airline's fleet, which makes offers stable across days and removes the rng from type choice, and changes the state hash. The word fixed in the user's direction points to B, but B changes how the fleet is used, so it needs confirming. R3, R6 and R26 are written to hold under either answer.
* D2. Does a stand assignment survive to the next day? Option A: no, the player assigns each day, because flight indexes change daily. Option B: yes, a per rotation stand preference saved on the airline and applied when the day's flights are created, which needs a save bump and a migration. Recommendation is B, because re dragging six flights every morning is busywork, but it is the user's call. R25 covers both.
* D3. May the player unassign an offer back to the unassigned lane, and cancel one? Both already exist through `assignStand` with -1 and `cancelFlight`. Recommendation is to keep both. Confirm, because a cancelled offer under contract may later need a penalty, which belongs to T31.
* D4. Is the 5 minute buffer the right visible separation between two blocks on one stand? It is the buffer `autoAssign` already uses, so reusing it invents nothing. Recommendation is to reuse it. Confirm before it becomes visible in the UI.
* D5. What happens when an assigned block stops fitting after a build? Option A: keep the assignment, and the flight waits or diverts as today. Option B: the sim moves it to the next free stand. Option C: the sheet flags the block red and the player fixes it. Recommendation is C with A as the fallback, because B silently overrides the player. Needs confirming.
* D6. Does T41 wait for T40? The rolling cap in R24 needs the tower state, and T40 is still todo with its level 1 budget being re-proposed. Option A: add T40 to the T41 dependency row in `handoff/TASKS.md`. Option B: T41 ships the movement count and keeps the `runways * 4` placeholder, and a follow up swaps in the tower budget. Recommendation is B, so T41 is not blocked. This is the only item that touches `handoff/TASKS.md` beyond the row title.
* D7. Does the player see tomorrow's offers? Today's model generates a day's offers at that day's midnight, so tomorrow does not exist until the day rolls. If D1 is answered B, a preview becomes possible. Recommendation is no preview for MVP 1. Confirm.

## Visual check

* Scenario: `handoff/scenarios/T41.json`, copied from `handoff/scenarios/example-airport.json`, with `hideUi` left off so the sheets are visible. Commands build a runway, a parallel taxiway, an apron, stands, a terminal and one signed airline, then `assignStand` on one offer and `setAutoStands` off. Actions open the scheduling category with `tool-flightops`, then `card-slots` and `card-standManagement`, and take the shots.
* Shot 1, the offers sheet, must show: one row per offer of the signed airline with type, arrival, turnaround and stand, the hourly movement bar with the overload hours in red, and no editable time field anywhere.
* Shot 2, the stand timeline, must show: every offer block at its true width on the row of its stand, the unassigned lane holding the offers automation did not place, the now line, and no overlapping blocks.
* Shot 3, after an invalid `assignStand` command in the scenario, must show: the notice toast naming the reason, and the block still on its original row.
* Reference sheet: none. This task changes no airfield art, so the comparison is against the current sheets and the side sheet rules in `docs/UI_DESIGN.md` 147 to 149.
* A mid drag frame is not reachable through the scenario actions, because `scripts/shot.mjs` maps `click`, `move`, `down` and `up` through world coordinates. The drag itself is covered by a Playwright test in `e2e/` that uses the block and row bounding boxes. If a mid drag screenshot is wanted, `scripts/shot.mjs` needs one new action that takes page coordinates, which is optional and not required by this spec.
* `page errors: none` in the tool output. Any page error is a bug to fix.
