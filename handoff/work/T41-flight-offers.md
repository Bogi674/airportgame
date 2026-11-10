# T41: Flight offers and stand management

## Requirements

R1 to R31 of `handoff/tasks/T41-flight-schedule.md`. Decisions answered by the user on 2026-11-10:

* D1: the aircraft type is fixed per rotation. It is no longer drawn from the rng each day.
* D2: a stand the player assigns is remembered per rotation and applied every morning. Save version 9 to 10.
* D3: unassign and cancel both stay, with no penalty yet.
* D4: the visible gap between two blocks on one stand is the existing 5 minute buffer.
* D5: a block that stops fitting its stand is flagged red in the timeline and the player fixes it. Left alone, the flight waits and diverts as today.
* D6: settled by T40 being done. The load bar reads the tower's movement budget.
* D7: no preview of tomorrow's offers in MVP 1.

## Read first (done)

Inventory taken on 2026-11-10 against current line numbers. The spec's line numbers have drifted.

## Design

* `src/shared/flightBlock.ts`: `STAND_BLOCK_BUFFER_MIN`, `blockWindow`, `blocksOverlap`, `StandFacts`, `refuseStand`, `refuseBlock`. Sim and UI both call it (RECIPES R7).
* Refusal codes: `standSpan`, `standSurfaceType`, `standClosed`, `standUsage`, `standNoTerminal`, `standNoLink`, `standBusy`. The spec's `standSurface` is taken by the build tool with another meaning, so the surface refusal is `standSurfaceType`.
* Fixed type: `usable[(airline.id + rotation) % usable.length]`, with `usable` from `usableTypesFor`. The stage length keeps its one rng draw.
* Stand memory: `Airline.standPrefs: number[]`, one stand id per rotation, -1 for none. Flights carry their rotation in a new `Traffic.fRot` array. Only the player's `assignStand` writes a preference. A preference that no longer passes the shared rule is skipped that morning and kept.
* Automation pass runs at the five points of R21 only, and collects assigned blocks once per pass.
* Payload: `offers`, `standLinked`, `standContact`, `movementBudget`.

## Slices

1. Shared block rule, and `Traffic` reads it.
2. `assignStand` validation, `setSlot` removed, the player's stand respected at arrival, automation triggers.
3. Fixed type per rotation, stand memory, save version 10, determinism.
4. Payload and the read only offers sheet with the movement load bar.
5. Stand timeline: true block widths, red conflicts, pointer drag and drop, Playwright test.
6. Docs, scenario, screenshots, full verify, handoff files.

## Tests

* flightBlock: window is arr + turn + 5; touching windows do not overlap; each refusal code.
* edit: too small stand refused with `standSpan`; overlapping block refused with `standBusy`; valid drop assigns; automation off leaves an unplaced offer waiting; a set stand that is taken makes the flight wait.
* business: fixed pattern; more rotations append at the end; fewer drop from the end; the type of a rotation is the same on two days; a remembered stand is applied the next morning.
* save: a version 9 save loads with empty preferences.
* determinism: 2 000 ticks twice with one assigned offer, automation on and off pairs, save and restore mid run.

## Visual check

`handoff/scenarios/T41.json`, three shots per the spec.

## Open questions

None.

## Verify

## Report
