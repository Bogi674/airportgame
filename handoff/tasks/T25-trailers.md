# T25. Trailer kinematics

Milestone M5. Roadmap line: "Trailer kinematics and free rotation".

## Goal

Baggage carts follow their tractor as separate rigid units, each pivoting about its axle, with free continuous headings.

## Read first

* `docs/ARCHITECTURE.md` section 6, the trailer formula: `axle = hitch - axleOffset * normalize(hitch - axle)`, heading from axle to hitch.
* `docs/reference/sprite-prototypes/gse.py` (the train geometry), `src/data/gse.json` (hitch and axle offsets; add them if missing).
* `src/sim/vehicles/gse.ts` (`parentIndex`), `src/render/sprites/vehicleSprite.ts`.

## Requirements

* R1. Vehicle struct of arrays gains `parentIndex` (minus one for powered units), and trailers update after their parent in index order with the formula above, using `sinLut`, `cosLut` and `atan2Det`.
* R2. Hitch and axle offsets per kind in `gse.json`.
* R3. A train of a tractor and up to four carts drives the T24 roads; carts never jump when the tractor turns.
* R4. Tests: on a straight path carts line up behind; on a 90 degree turn of radius 10 m each cart's off tracking stays within the analytic value for a single axle trailer within 5 percent; no allocation per tick.
