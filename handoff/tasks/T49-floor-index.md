# T49. Floor index in the terminal data model

Milestone M4. User decision, 2026-11-10: add a floor index to the terminal data model before T12, with only floor 0 buildable for now.

## Goal

Every terminal cell, wall, fixture and room carries a floor index, so the walking graph, cohorts and baggage are built on a model that can grow to several floors without another shape change. The player sees no difference: floor 0 is the only floor that can be built.

## Read first

* `docs/ARCHITECTURE.md` section 7 and section 10.
* `src/shared/business.ts` (grid layout), `src/shared/terminalOps.ts` (`planEdit`, cell and edge indexing), `src/shared/terminalRooms.ts`.
* `src/sim/business/business.ts`: `terminalBuild`, `saveState`, `loadState`.
* `src/sim/save/migrations.ts` and `handoff/RECIPES.md` R3.
* `handoff/tasks/T12-walking-graph.md` and `handoff/tasks/T43-baggage-system.md`, the first users of the index.

## Requirements

* R1. The terminal data model addresses cells, edges, fixtures and rooms by floor index as well as by cell.
* R2. Only floor 0 is buildable. A build command for another floor is refused with a problem code.
* R3. Save version bump with a migration that puts every existing terminal on floor 0.
* R4. No behaviour change: capacity, room validation, drawing and costs give the same results as before for every existing test.
* R5. No allocation is added to a tick or render loop, and the stress numbers hold.
* R6. No UI for floors. The floor selector belongs to T51.

## Tests

* An old save loads with all terminal content on floor 0 and the same room validation result.
* A command for floor 1 is refused.
* Determinism: 2 000 ticks twice from one seed, identical `stateHash`.

## Open questions

The storage shape (one grid per floor, or a floor dimension in the existing arrays) is an implementation choice for the plan. It is a save shape change, so show it to the user before coding.
