# T23. Hydrant dispenser and apron bus

Milestone M5. Roadmap line: "GSE data and sprites for tug, tractor and carts, belt loader, refueller, hydrant dispenser, GPU, apron bus". All but the dispenser and the bus are spawned.

## Goal

Stands with hydrant pits use a hydrant dispenser instead of a refueller, and remote stands use apron buses to move passengers to and from the terminal bus gate.

## Read first

* `docs/ART_AND_ASSETS.md` section 5 (the table and rules), `docs/art/gse_sheet.png`, `docs/reference/sprite-prototypes/gse.py`.
* `src/data/gse.json` (both kinds exist: `dispenser`, `bus`), `src/data/stand_sizes.json` (`hydrants` per size).
* `src/sim/vehicles/gse.ts`, `src/render/sprites/vehicleSprite.ts`.
* T22's task scheduler.

## Requirements

* R1. Fuel task: dispenser when the stand has hydrants and the airport owns a dispenser, otherwise refueller. The dispenser parks under the wing beside the pit.
* R2. Buses: remote stand deboarding and boarding need a bus; capacity from data; trips between the stand bus bay and the terminal's bus gate add their drive time to the task. Until service roads exist (T24) drive time is distance over speed from data.
* R3. Sprites match the sheet at true size.
* R4. Tests: fuel task picks the right vehicle; a remote stand turnaround waits for a bus when none is free.
