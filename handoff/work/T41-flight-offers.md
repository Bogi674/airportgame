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

Scenario `handoff/scenarios/T41.json`, run with `npm run shot` on the dev server. Shots in `shots/T41/`, copies in `handoff/work/T41-offers.png`, `T41-timeline.png` and `T41-refused.png`. Last run: `page errors: none`.

* `T41-refused.png` (shot 3): the toast "That stand is closed." shows over the map under "Summit Air signed a contract.". The Getting started card is shown, since no sheet is open. The shot is taken at the default zoom, so the stands are small. It is taken before any camera change, because the notice lasts 4 seconds. No difference from the spec.
* `T41-offers.png` (shot 1): the Flight offers sheet lists the two Summit Air offers with type (DH8D), arrival (09:50 and 17:20), turnaround (30 min), stage length and a stand select (stand "1" for the placed flight, "Automatic" for the other). The movements bar is captioned "Movements per hour, budget 40" and shows hours 09, 10 and 17. No time field is editable and no text is cut. The tab reads "FLIGHT OFFERS" and the build card reads "Flight offers". The Getting started card is hidden while the sheet is open, so it no longer touches the sheet edge.
* `T41-timeline.png` (shot 2): the Stand management sheet opens scrolled to the present, so the now line at 06:31 sits about one hour from the left edge of the grid, with hours 05 to 13 in view. The Stand 1 block near 09:50 is in frame and its label "DH8D" is whole. The block is 35 minutes, 42 px wide at 72 px per hour, with 3 px padding each side. The label shows only from 40 px, the width of the 32 px code plus 6 px padding and 2 px border, so narrower blocks show no text. The hour header and the rows share one scrolling element, so they stay in line. The unassigned lane shows a count of 1, and Stand 6 is closed with a red tint. Nothing overlaps or is cut. The green and red drag preview is not in this shot, because the scenario actions cannot drag DOM blocks (see the spec's Visual check section).
* Scenario change from the spec: no terminal, because the example has none. Shot 3 is taken first, then the camera moves for shots 1 and 2.

## Verify

Full `npm run verify` on 2026-11-10: rules, types, lint, tests and stress all pass. Stress total mean and p99 ms per tick: busy50 0.018 and 0.61, terminal640 0.004 and 0.035. Flights completed and deadlock counts per scenario equal the commit before T41.

## Report

* What now works, in player terms: flight offers per signed airline with fixed type and turnaround per rotation, a movements bar against the tower budget, drag and drop onto stands that refuses what the stand cannot take, remembered stands per rotation, and an automation toggle.
* Commits: 0ebb4b9 stands: one shared stand block rule for sim and UI (T41); a5d0552 stands: validated stand assignment and fixed daily slots (T41); c38f640 airlines: fixed type per rotation and remembered stand choices (T41); 02d3e80 flight offers: read only offers sheet with the tower movement load (T41); 8bc3f6a stand timeline: drag flights onto stands with a live fit preview (T41)
* Verify summary: all five checks pass, see Verify.
* Stress: within every budget, see Verify.
* Screenshots: shots/T41/T41-offers.png, shots/T41/T41-timeline.png, shots/T41/T41-refused.png (copies in handoff/work)
* Compared with the reference sheet: no reference sheet exists for this task. Differences are listed under Visual check.
* Roadmap lines ticked: none. The MVP 1 status paragraph (line 38) and the slot line (line 122) were corrected or annotated, and no criterion was ticked.
* Decisions added to docs/ARCHITECTURE.md: nine lines in section 12, dated 2026-11-10.
* Simplified or left out, and the new task created for it: the drag preview cannot be captured by the scenario script, so no mid drag shot exists (optional, see the spec). The block label threshold is 40 px, the smallest width at which the code fits whole. No task created yet.
