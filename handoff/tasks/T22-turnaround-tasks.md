# T22. Turnaround task lists

Milestone M5. Roadmap line: "Turnaround task lists for the 10 types with dependencies (a fixed turnaround time per role)".

## Goal

Each MVP 1 type has a task list in `src/data/turnarounds.json`: tasks with durations, dependencies and the vehicle or staff each needs. The turnaround ends when the last task ends, and missing resources delay tasks with the delay attributed to the airport or the airline.

## Read first

* `docs/GAME_DESIGN.md` section 10 "Ground handling".
* `src/sim/ops/traffic.ts`: `updateTurnaround`, `ROLE_TURNAROUND_MIN`.
* `src/sim/vehicles/gse.ts`: how vehicles are placed today (`spawnCrew`).
* `src/data/gse.json`, `src/data/aircraft/aircraft.mvp.json` (`stand` geometry, service data).

## Requirements

* R1. `turnarounds.json` with schema: per type or per role, tasks such as `deboard`, `unloadBags`, `clean`, `cater`, `fuel`, `loadBags`, `board`, `pushbackReady`, with `durationS`, `after: [task ids]`, `needs: { vehicle?: kind, staff?: role }`. Use published ground handling charts for the durations where known; otherwise scale the current role minutes and say so in the data note.
* R2. A task scheduler per docked aircraft in typed arrays: earliest start from dependencies, start when the resource is available, end after the duration. Fuel and boarding may not overlap unless data allows it.
* R3. Resources come from the airport's GSE pool (bought in the handling menu); none available delays the task and records `delayCause: airport`. Airline caused delays (late inbound) are `airline`.
* R4. The flights board shows the turnaround progress and the delay cause.
* R5. Remove `ROLE_TURNAROUND_MIN` once every MVP 1 type has a list.
* R6. Tests: the critical path length equals the turnaround time with unlimited resources; one fewer belt loader lengthens it; determinism.
