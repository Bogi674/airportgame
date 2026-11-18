# T66. Stand upgrades and gate desk assignment

## Goal

Stands gain upgrades built through works (bus bay, hydrant pit, fixed ground power) that change their turnaround tasks, and each stand can be assigned a gate desk for boarding.

## Read first

* `docs/DESIGN_REVISION_4.md` 2.5, 2.6; `docs/DESIGN_REVISION_3.md` section 4; `handoff/QUESTIONS.md` T58 batch rows D5 to D8 and the 2026-11-18 T66 answers
* `src/shared/airfield.ts` Stand, `src/sim/airfield/airfield.ts` works (`startWorks`, `update`), `src/sim/ops/turnaround.ts`, `src/sim/vehicles/gse.ts` `crewOf`, `src/sim/cohorts/cohorts.ts` `toGate`

## Decisions

* Jet bridges (access types 1 to 4) wait for T51 multi floor terminals (owner, 2026-11-18). The bridge painter stays removed.
* Upgrades and values (D6): bus bay 20 000 and 1 works day, hydrant pit 45 000 and 2 days, fixed ground power 30 000 and 1 day. The stand is closed while its works run.
* Effects: a hydrant pit makes the fuel task use a hydrant dispenser instead of a refueller; fixed ground power removes the GPU from the power task; a stand farther than 150 m from its gate desk needs a bus bay, and its boarding task then waits for a depot bus. Without a bus bay a far stand boards 25 percent slower and raises an alert (owner, 2026-11-18).
* Distance from gate desk to stand is the straight line from the desk's world position to the stand center (orchestrator: no walking graph exists outside the terminal).
* Assignment: the stand inspector picks one gate desk. A stand without a valid assignment uses the nearest gate desk by walk cost as today and shows a warning (owner, 2026-11-18).

## Requirements

1. `src/data/stand_access.json` with a zod schema: upgrade costs and days, `stairsWalkLimitM` 150, `farBoardingSlowdown` 0.25.
2. Stand fields `upgrades` (bitmask), `upgradeWorks` (`{ upgrade, doneTick }` or absent) and `gate` (`{ building, x, y }` or absent), saved with a migration; old saves load with none.
3. Command `startStandUpgrade { id, upgrade }`: refuses when built, running or unaffordable, books the cost, closes the stand until done.
4. Turnaround kinds per stand: fuel and power follow the upgrades, boarding needs a bus at a far stand with a bus bay, a far stand without one takes 25 percent longer to board.
5. Command `setStandGate { id, building, x, y }` (building -1 clears); cohorts of a flight board at the stand's gate desk when valid.
6. Stand inspector: upgrade rows with cost, days and state; gate desk dropdown; warnings for no gate and far without bus bay. Markings for the bus bay.

## Acceptance

* Unit tests for every upgrade effect, works timing, refusal codes, assignment fallback; determinism test over 2 000 ticks; save and restore hash test.
* The inspector shows upgrades and the gate desk; a hydrant pit turnaround uses no refueller.
* `npm run verify` green, stress within budget.
