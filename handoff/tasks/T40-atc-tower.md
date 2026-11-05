# T40. Standalone ATC tower with stage levels

Milestone M7 (player facing), with sim work in M2. Answers to the design questions are in `handoff/QUESTIONS.md` (2026-11-05 T40 entries).

## Goal

ATC stops being a four cell control room fixture inside a terminal and becomes a dedicated tower building the player places anywhere on owned land inside the airport perimeter. The tower has five levels tied to the five progression stages in `docs/GAME_DESIGN.md` section 15. A level changes one thing only: movements per hour capacity.

## Read first

* `src/shared/business.ts` (`CONTROL_CELLS`, `atcRangeM`, `Airline`, `BoardRow`, `TICKS_PER_DAY`, `dayIndex`, `minuteOfDay`)
* `src/data/business.json` and `src/data/schemas/business.ts` (`modules.atc`, `terminal.atcRangeM`)
* `src/sim/ops/traffic.ts` (`pickStand`, `autoAssign`, `slotFree`, `reserve`, the departure planner at 1325 to 1435, `updateBacktrack`)
* `src/ui/Sheets.tsx` (`SlotsSheet` hourly load bar chart, cap is `runways * 4`)
* `src/sim/airfield/airfield.ts` (`checkPolygon`, `place`, `record`, `hash`, `refresh`, `obstaclesVersion`)
* `src/sim/commands.ts` (the `Command` union) and `src/sim/sim.ts` (`apply` dispatch)
* `src/shared/airfield.ts` (`Runway`, `AirfieldData`, `pads`) and the GA block command, the closest existing free standing building on the airfield
* `handoff/RECIPES.md` R1 (command), R2 (data), R3 (save), R8 (draw on the airfield), R6 (strings)
* `docs/GAME_DESIGN.md` sections 6 (prefab pieces), 8 (ATC), 15 (stages); `docs/ART_AND_ASSETS.md` control tower line; `docs/UI_DESIGN.md` buildings menu line

## Requirements

* R1. New sim object `Tower { id, x, y, level }` in the airfield payload. Placed on owned land only, with a footprint rectangle from data (`tower.footprintM` per level, a square whose side grows with the level).
* R2. New command `buildTower { x, y, level }`, plus `upgradeTower { id }` and `demolishTower { id }` (reuse `demolish { kind, id }` if the pattern allows). Money, land and overlap checks follow the GA block pattern.
* R3. The tower satisfies the ATC requirement when at least one tower stands within `atcRangeM` of every runway midpoint. The terminal control room fixture remains in old saves for migration compatibility, but whether it still grants ATC coverage needs user confirmation.
* R4. Capacity: the movement budget per hour per runway is the table above. A movement is a taxi, a landing or a takeoff. The budget is spent as the movement starts; when the hour's budget is gone, further movements join a first in first out queue and are released as the budget frees. The `SlotsSheet` load bar uses the tower's budget instead of `runways * 4`. Overload is shown as an overload warning plus the queue length, not a hard refusal of the schedule.
* R5. Upgrade ladder maps to the five stages. The tower level a stage allows is derived from stage state; a tower above the stage level is refused. A runway count above the level's cap is refused at build time with a problem code naming the level needed.
* R6. Drawing: the tower is vector geometry in meters in the chunk painter, with the cab ring and base per `docs/ART_AND_ASSETS.md`. It is drawn under aircraft and vehicles.
* R7. Placement uses the alignment frame snapping from T42 once that lands; until then it places on 0 and 90 degree steps relative to the nearest frame.
* R8. Save format bump with a migration that defaults `towers` to an empty list and keeps existing control rooms valid.
* R9. Determinism test: 2 000 ticks twice from one seed, identical `stateHash`, including a tower build and upgrade.
* R10. Strings for every new text in `src/ui/strings/en.json`, appended next to related keys.

## Out of scope

Controllers on shift, departure metering, intersection departures, crossing rules, radar and low visibility procedures (all MVP 2, `docs/ROADMAP.md` line 155). Staff sprites for the tower. A tower silhouette change per level beyond the footprint size.

## Stage model

`docs/GAME_DESIGN.md` section 15 names five stages: Regional strip, Domestic airport, Regional international, Major international, Hub. No stage state exists in the sim today. The tower level cap comes from the airport's current stage, derived from rating, passengers per year and cash as that section says. The exact thresholds and the derivation need user confirmation before coding.

## Numbers (given by the user, 2026-11-05)

Tower level, movement budget per runway, runway cap and total:

| Level | Movements per hour per runway | Max runways | Max total movements per hour |
| --- | --- | --- | --- |
| 1 | 10 | 1 | 10 |
| 2 | 20 | 1 | 20 |
| 3 | 30 | 2 | 60 |
| 4 | 45 | 2 | 90 |
| 5 | 50 | 3 or more | 50 times the runway count |

The budget is a rolling 60 minute window, not a clock hour reset. A movement is a landing or a takeoff. Taxiing is free, so a full turnaround costs 2 movements. When the budget is used up, further landing and takeoff admissions wait in a first in first out queue and are released as the budget frees. An aircraft that has already landed or is airborne is never held mid operation.

Levels are bought with cash. There is no stage gate and no stage state in the sim (user answer, 2026-11-05).

A runway count above the level's cap is refused at build time with a problem code naming the level needed.

The budget replaces the hardcoded `SlotsSheet` cap of `runways * 4` at `src/ui/Sheets.tsx` line 175.

The control room fixture stops granting ATC coverage (user answer, 2026-11-05). It stays in `FIXTURE_KEYS` because indexes are saved, but it is removed from the buildable fixture list and no longer satisfies `atcOk`. Saves that had a control room and no tower lose ATC until a tower is built, with a warning on load.

Tower looks: five distinct vector looks in meters, one per level. Level 1 is a simple tower with a window, level 5 is a large tall tower with a 360 degree window view. Level 1 footprint is 15 m by 15 m. The footprint for levels 2 to 5 still needs a value.

## Numbers to confirm with the user before coding

| Value | Proposed | Source |
| --- | --- | --- |
| Tower footprint side, levels 2 to 5 | 15 m for all levels, looks differ only | proposed |
| Tower build cost at level 1 | 40 000 | proposed |
| Tower upgrade cost, level 2 to 5 | 15 000, 25 000, 40 000, 60 000 | proposed |
