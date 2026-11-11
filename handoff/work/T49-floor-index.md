# T49: Floor index in the terminal data model

Status: done
Branch: claude/eager-cerf-s72vbq

## Requirements

* [x] R1 The terminal data model addresses cells, edges, fixtures and rooms by floor index as well as by cell.
* [x] R2 Only floor 0 is buildable. A build command for another floor is refused with a problem code.
* [x] R3 Save version bump with a migration that puts every existing terminal on floor 0.
* [x] R4 No behaviour change: capacity, room validation, drawing and costs give the same results as before for every existing test.
* [x] R5 No allocation is added to a tick or render loop, and the stress numbers hold.
* [x] R6 No UI for floors. The floor selector belongs to T51.

## Read first (done)

* [x] every file the spec lists
* [x] handoff/PITFALLS.md

Notes from reading: `TerminalGrid` in `src/shared/business.ts:60`, `newGrid` in `src/shared/terminalOps.ts:50`, `Business.terminalBuild` at `src/sim/business/business.ts:285`, `Business.hash` at 815, `SavedGrid`, `saveGrid` and `loadGrid` at 848 to 912, `migrate` in `src/sim/save/migrations.ts`, the `terminalBuild` command in `src/sim/commands.ts:48` dispatched at `src/sim/sim.ts:203`.

## Design

* Data added: none.
* Types added or changed: `TerminalGrid` gains `building: number` and `level: number`. One grid is one floor of one building. Floors of the same building share `building`. `level` is signed: 0 is the apron level, negative values are basements, positive values are upper floors. `TERMINAL_LEVEL_MIN = -2`, `TERMINAL_LEVEL_MAX = 3` (user decision, 2026-11-11). The `terminalBuild` command gains an optional `level`, which defaults to 0 so older command logs replay unchanged.
* Functions added or changed:
  * `newGrid` sets `building = id` and `level = 0`.
  * `gridOnLevel(grids, building, level)` in `terminalOps.ts` returns the grid of one floor of one building, or undefined.
  * `Business.terminalBuild` takes `level` and refuses any level other than 0 with `floorNotBuildable`.
  * `saveGrid` and `loadGrid` carry `building` and `level`. `loadGrid` defaults them to the grid id and 0.
  * `Business.hash` folds `building` and `level` per grid.
* Recipe used: R3.
* Save format change: version 10 to 11, because every saved terminal grid gains `building` and `level`. The migration writes `building = id` and `level = 0` on every saved grid.
* Why this design and not the obvious alternative: a floor dimension inside the cell arrays would force every floor of a building into one bounding box and would change every index calculation. One grid per floor leaves all cell, edge, fixture and room code untouched, because each of them already works on one grid. Approved by the user on 2026-11-11.

## Slices

1. Model, save, migration and hash (R1, R3, R4). Files: `src/shared/business.ts`, `src/shared/terminalOps.ts`, `src/sim/business/business.ts`, `src/sim/save/migrations.ts`, `tests/save.test.ts`.
2. Command level and refusal (R2, R6). Files: `src/sim/commands.ts`, `src/sim/sim.ts`, `src/sim/business/business.ts`, `src/ui/strings/*.json`, `tests/business.test.ts`.

## Tests

* tests/save.test.ts: a version 10 save, with `building` and `level` removed from every saved grid, loads with `level` 0 and `building` equal to `id` on every grid, the same room validation result and the same `stateHash` as the source sim.
* tests/business.test.ts: a `terminalBuild` command with `level: 1` returns `floorNotBuildable`, leaves cash and grids unchanged. The same command with `level: 0` succeeds.
* determinism: the existing 2 000 tick test in tests/sim.test.ts and the business determinism tests stay green.

## Visual check

None. The player sees no difference (R6). The e2e terminal test must stay green.

## Open questions

* Storage shape: one grid per floor. Answered by the user, 2026-11-11.
* Index meaning: signed, 0 is the apron level, range -2 to 3. Answered by the user, 2026-11-11.

## Verify

PASS rules
PASS types
PASS lint
PASS tests
PASS stress
verify: all checks passed.
E2E Chromium: smoke, terminal and playthrough pass.

## Report

* What now works, in player terms: Nothing visible changes. Terminals now record which floor they are, and saves from before load onto floor 0.
* Commits: 72af04a terminal: floor index on grids, save format 11
35842a9 terminal: only floor 0 can be built
* Verify summary: all checks passed (PASS rules, PASS types, PASS lint, PASS tests, PASS stress, verify: all checks passed.)
* Stress, mean and p99 ms per tick for every scenario:
  * small: total 0.00654 mean, 0.04495 p99
  * medium: total 0.00574 mean, 0.04893 p99
  * large: total 0.00667 mean, 0.06637 p99
  * busy50: total 0.02413 mean, 0.81070 p99
  * terminal640: total 0.00642 mean, 0.06239 p99
* Screenshots: none, no visible change.
* Compared with the reference sheet: no visible change, so nothing to compare.
* Roadmap lines ticked: none, T49 has no roadmap box of its own.
* Decisions added to docs/ARCHITECTURE.md: the four 2026-11-11 bullets at the end of the Decisions list (grid per floor, save format 11, optional command level, state hash covers building and level).
* Simplified or left out, and the new task created for it: nothing.
