# T26. Footprints, overhead zones and the collision test

Milestone M5. Roadmap line: "Hard footprints and overhead zones, collision test over all stand templates and types".

## Goal

Every aircraft type has a hard footprint and overhead zones built from data; the game enforces the rules of `docs/GAME_DESIGN.md` section 10; and a test builds every stand size with every type it accepts and the full turnaround vehicle set, failing on any violation of `docs/ART_AND_ASSETS.md` section 12.

## Read first

* `docs/ART_AND_ASSETS.md` sections 4.8 and 12, `docs/GAME_DESIGN.md` section 10 vehicle rules.
* `docs/reference/sprite-prototypes/gse.py`: the reference checker `check`. Port it exactly.
* `src/render/markings/standLayout.ts` (`typeOutlines`, `polygonDistance`), `src/shared/standSizes.ts`.
* T24 docking poses.

## Requirements

* R1. `src/shared/footprints.ts`: hard footprint (fuselage polygon, nacelle boxes, prop bars, gear boxes, buffered by 0.5 m) and overhead zones (wing and stabilizer polygons with underside heights from `heights` in the aircraft data), cached per type.
* R2. The ported checker: vehicle versus hard footprint (docking vehicles at their service point may overlap up to 0.8 m²), vehicle height versus overhead zone, vehicle to vehicle at least 0.3 m, vehicle versus buildings and jet bridges.
* R3. `tests/collision.test.ts`: for each stand size, each accepted MVP 1 type, with all turnaround vehicles at their docking poses: zero violations. Fix data (poses, offsets) until it passes, never the checker.
* R4. In game, checks run at docking and at reservation, not per tick per pair. A failing docking delays the task and logs a debug event.
