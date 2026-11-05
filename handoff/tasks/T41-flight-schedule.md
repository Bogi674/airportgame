# T41. Flight schedule with exact times and automation

Milestone M6. Answers to the design questions are in `handoff/QUESTIONS.md` (2026-11-05 T41 entry).

## Goal

Airport CEO style flight management. For each flight of a signed airline, the player sets the exact arrival time, the exact departure time, the stand, and optionally the runway. An automate toggle per airline and a global one fill every unset field the way the sim does today. The sim refuses a schedule that cannot work and says why.

## Read first

* `src/shared/business.ts` 98 to 132 (`Airline`, `BoardRow`), 3 to 9 (time constants)
* `src/sim/business/business.ts` 118 to 189 (airlines, `setSlot`), 470 to 542 (`scheduleToday`, `dailyClose`), 621 to 662 (`board`), 696 to 723 (save), 799 to 811 (`SLOT_FIRST`, `SLOT_LAST`, `fitSlots`)
* `src/sim/ops/traffic.ts` 35 (`ROLE_TURNAROUND_MIN`), 115 to 133 (flight arrays), 412 to 414, 470 to 576 (`slotFree`, `reserve`, `standFits`, `standAllows`, `pickStand`, `autoAssign`), 582 to 672 (`delay`, `trySpawnArrival`), 1070 to 1091 (turnaround end), 1325 to 1435 (departure planner), 1653 to 1660 (`arrays()`)
* `src/sim/commands.ts` (`assignStand`, `setAutoStands`, `autoAssignStands`, `cancelFlight`, `setSlot`) and `src/sim/sim.ts` 195 to 207
* `src/ui/Sheets.tsx` 163 to 436 (`clock`, `SlotsSheet`, `StandsSheet`, `FlightsSheet`)
* `tests/edit.test.ts` 105 to 135, `tests/business.test.ts` 167 to 221, `tests/save.test.ts`
* `handoff/RECIPES.md` R1, R3, R5, R6, R9
* `docs/AIRLINES.md` 28 to 40 and 161 to 171, `docs/GAME_DESIGN.md` 24 and 423, `docs/UI_DESIGN.md` 121 and 149

## Requirements

* R1. Each airline rotation stores a schedule entry: arrival minute, departure minute, stand id or automatic, runway id or automatic. Today's `slots` array becomes the arrival minute of that entry; old saves migrate one to one.
* R2. Departure time: the player may set it, but never earlier than arrival plus the type's minimum turnaround from `ROLE_TURNAROUND_MIN`. When unset it stays arrival plus that turnaround, as today. A departure later than the minimum keeps the aircraft on its stand until the set time.
* R3. A new per flight value `fDep` (scheduled off block tick) in traffic, added to `arrays()`, saved and hashed. The turnaround end waits for `fDep`.
* R4. Stand choice per rotation uses the existing `standFits` and `standAllows`. A stand already booked for an overlapping window (arrival minus the existing buffer to departure plus the buffer) is refused with a problem code. The schedule editor shows the conflict before the command is sent.
* R5. Runway choice per rotation is a preference. Wind, crosswind, closures and length still win, as today; the flights board shows when the preference was overridden and why.
* R6. Automate: one toggle per airline and one global, defaulting on. When on, unset fields are filled by the existing `pickStand` and `autoAssign` logic and today's `fitSlots` spread. Turning automate off keeps the current values so the player can edit them.
* R7. UI: the Slots sheet becomes the Schedule sheet. One row per rotation: aircraft type, arrival time, departure time, stand, runway, automate, with 5 minute steps as today. The Stands timeline shows the planned blocks and marks conflicts in red.
* R8. Commands: `setSchedule { airlineId, index, arrMinute?, depMinute?, standId?, runwayId? }` (null clears a field back to automatic) and `setAutomate { airlineId | null, on }`. `setSlot` stays as an alias of `setSchedule` with `arrMinute` for replay compatibility.
* R9. Save format bump with a migration. Determinism test with a custom schedule: 2 000 ticks twice, identical `stateHash`; save and load mid run, identical hash.
* R10. Strings appended next to `slots.*` and `stands.*`.

## Out of scope

Route demand, seasons and contract minimum movements (T31). Aircraft type choice per rotation stays random from the airline's fleet. Weekly schedules: one daily pattern repeats every day.

## Numbers to confirm with the user before coding

None new. The time step (5 minutes), the operating window (06:00 to 21:00) and the buffers come from the current code.
