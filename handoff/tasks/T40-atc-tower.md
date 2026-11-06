# T40. Standalone ATC tower with five levels

Milestone M7 (player facing), with sim work in M2. Answers to the design questions are in `handoff/QUESTIONS.md` (the T40 entries dated 2026-11-06). Those answers are the source of truth for every number below.

## Goal

ATC stops being a four cell control room fixture inside a terminal and becomes a dedicated tower building the player places anywhere on owned land inside the airport perimeter. The tower has five levels bought with cash. A level changes one thing only: movements per hour capacity per runway.

## Read first

* `src/shared/business.ts` (`FIXTURE_KEYS`, `isShopFixture`, `ATC_MIN_CELLS`, `Airline`, `BoardRow`, `BusinessPayload`, `TICKS_PER_DAY`, `TICKS_PER_MINUTE`, `dayIndex`, `minuteOfDay`)
* `src/data/business.json` and `src/data/schemas/business.ts` (`modules.atc`, `terminal.atcRangeM`)
* `src/sim/ops/traffic.ts` (`trySpawnArrival` at 592, `slotFree` at 470, `reserve` at 487, `tryClearDeparture` at 1471, the departure planner `planDeparture` at 1328, `delay` at 578, `updateBacktrack` at 1516, `arrays` at 1647, `hash` at 1720)
* `src/sim/business/business.ts` (`atcOk` at 266, `readiness` at 275, `scheduleToday` at 470, `dailyClose` at 497, `staffCount` at 355)
* `src/ui/Sheets.tsx` (`SlotsSheet` hourly load bar chart, cap is `runways * 4` at line 175)
* `src/sim/airfield/airfield.ts` (`checkPolygon`, `place`, `record`, `hash`, `refresh`, `obstaclesVersion`, the GA block command `buildGaBlock` at 562, `buildRunway` at 230)
* `src/sim/commands.ts` (the `Command` union) and `src/sim/sim.ts` (`apply` dispatch at 172, `restore` at 373)
* `src/shared/airfield.ts` (`AirfieldPayload`, `Runway`) and the GA block command, the closest existing free standing building on the airfield
* `handoff/RECIPES.md` R1 (command), R2 (data), R3 (save), R8 (draw on the airfield), R6 (strings), R7 (build tool)
* `docs/GAME_DESIGN.md` sections 6 (prefab pieces) and 8 (ATC); `docs/ART_AND_ASSETS.md` control tower line; `docs/UI_DESIGN.md` buildings menu line
* `handoff/tasks/T42-grid-snapping.md` and `handoff/work/T42-grid-snapping.md`, for the grid the tower placement snaps to

## Requirements

* R1. New sim object `Tower { id, x, y, level }` in the airfield payload. Placed on owned land only, with a footprint rectangle from data (`tower.footprintM`, 15 m by 15 m at every level).
* R2. New command `buildTower { x, y, level }`, plus `upgradeTower { id }` and `demolishTower { id }`. Money, land and overlap checks follow the GA block pattern.
* R3. The tower is the only ATC source. `atcOk` is true when at least one tower stands. Range is the whole airport with no distance limit, so the old 3.5 km control room range does not apply. The terminal control room fixture keeps its `FIXTURE_KEYS` index for save compatibility, but it grants no coverage and is removed from the buildable list. Saves that had a control room and no tower lose ATC until a tower is built, with a warning on load.
* R4. Capacity: the movement budget per hour per runway is 20 at level 1, 40 at level 2, 60 at level 3, 80 at level 4 and 100 at level 5. A movement is a landing or a takeoff. Taxiing is free, so a full turnaround costs 2 movements. The budget is a rolling 60 minute window, not a clock hour reset, and it is spent as the movement starts. When the budget is gone, further movements wait in a first in first out queue and are released as the budget frees. An aircraft that has already landed or is airborne is never held mid operation, and an aircraft already holding a runway reservation is never held either. Overload is shown as an overload warning plus the queue length, not a hard refusal of the schedule.
* R5. A runway count above the level's cap is refused at build time with a problem code naming the level needed. The caps are 1, 1, 2, 2 and unlimited.
* R6. Upgrades are bought with cash only. There is no stage gate and no stage state in the sim. `docs/GAME_DESIGN.md` section 15 stages are not used as a ladder here; a separate task is filed later if stages are wanted.
* R7. Drawing: the tower is vector geometry in meters in the chunk painter, with the cab ring and base per `docs/ART_AND_ASSETS.md`, in five distinct looks from a simple tower with a window to a tall 360 degree glazed tower. It is drawn under aircraft and vehicles.
* R8. Placement follows the T42 construction grid once that lands: the tower origin snaps to the active grid node in grid mode. Until T42 lands, it places on 0 and 90 degree steps relative to the nearest frame, as `frameAt` does today.
* R9. Save format bump with a migration that defaults `towers` to an empty list and keeps existing control rooms valid.
* R10. Determinism test: 2 000 ticks twice from one seed, identical `stateHash`, including a tower build and upgrade.
* R11. Strings for every new text in `src/ui/strings/en.json`, appended next to related keys.
* R12. Without a tower, GA and private aircraft only. No airline schedules commercial flights, and there is no default movement budget for commercial traffic.

## Out of scope

Controllers on shift, departure metering, intersection departures, crossing rules, radar and low visibility procedures (all MVP 2, `docs/ROADMAP.md` line 155). Staff sprites for the tower. Stage names and stage gating. Airport class.

## Numbers (given by the user, 2026-11-06)

Tower level, movement budget per runway and runway cap:

| Level | Movements per hour per runway | Max runways |
| --- | --- | --- |
| 1 | 20 | 1 |
| 2 | 40 | 1 |
| 3 | 60 | 2 |
| 4 | 80 | 2 |
| 5 | 100 | unlimited |

The total budget is the per runway budget times the runway count.

The window is a rolling 60 minute window. Only landings and takeoffs count, taxiing is free, so a full turnaround costs 2 movements. When the budget is used up, further landing and takeoff admissions wait in a first in first out queue and are released as the budget frees. An aircraft that has already landed or is airborne is never held mid operation.

Level 1 costs 100 000 to build and each upgrade costs 50 000. The starting budget is about 120 000 000, so these are cheap by design.

The tower is the only source of ATC coverage. There is no control room fallback and no distance limit: tower range is the whole airport.

The control room fixture stops granting ATC coverage. It stays in `FIXTURE_KEYS` because indexes are saved, but it is removed from the buildable fixture list and no longer satisfies `atcOk`. Saves that had a control room and no tower lose ATC until a tower is built, with a warning on load.

Tower looks: five distinct vector looks in meters, one per level. Level 1 is a simple tower with a window, level 5 is a large tall tower with a 360 degree window view. The footprint is 15 m by 15 m at every level. Looks differ, footprint does not.

An arriving aircraft that cannot get a movement waits 30 game minutes, then diverts.

The budget replaces the hardcoded `SlotsSheet` cap of `runways * 4` at `src/ui/Sheets.tsx` line 175.

## Superseded numbers, do not use them

The earlier ladder of 10, 20, 30, 45 and 50 movements per hour per runway. The earlier runway caps of 1, 1, 2, 2 and 3 or more. The proposed build cost of 40 000 with upgrades of 15 000, 25 000, 40 000 and 60 000. The proposal that the footprint side grows with the level. Any reading that a movement counts taxis, or that the tower level is gated by the airport stage.
