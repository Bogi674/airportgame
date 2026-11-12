# T57. Visual repair: stand clearance, GSE paths, ground contact

Milestone M5. Priority zero of the 2026-11-12 revamp (`docs/DESIGN_REVISION_4.md` once written). Source: the user's screenshot after T16, which showed three defects.

## Goal

The current game is visually clean on its own: no stand whose parked aircraft breaks a taxiway, no taxiway line broken by a lead in, no vehicle drawn through an aircraft, no vehicle that looks like it floats.

## Read first

* `docs/ART_AND_ASSETS.md` sections 3, 4.8, 5 and 12.
* `docs/reference/sprite-prototypes/gse.py`: `boundary`, `check`, `draw_order`.
* `src/sim/airfield/airfield.ts` `makeStands`, `buildGaBlock`.
* `src/render/markings/taxiPlan.ts`, `standPaint.ts`, `src/shared/standFork.ts`.
* `src/sim/vehicles/gse.ts`, `src/data/gse.json`.
* `src/render/renderer.ts` frame draw order.
* `handoff/PITFALLS.md`.

## Decisions (user, 2026-11-12)

* D1. Clearance rule: the parked aircraft box of a stand (stand width by length) must stay at least `taxiObjectM` of the taxiway's code (`src/data/airfield_codes.json`) from every taxiway or taxilane centerline it does not lead into. It must not overlap the pavement of the taxiway it leads into.
* D2. Stands in old saves that break the rule are kept and flagged with a warning in the stand inspector. Their bookings keep working. No save shape change.
* D3. Only the refueller and the hydrant dispenser may sit under the wing, at the fuel coupling, and only where the wing underside is higher than the vehicle. Every other vehicle stays outside the hard footprint at every tick.

## Requirements

* R1. Placement validation refuses any stand, of any size or usage, GA blocks included, that breaks D1, with a notice naming the taxiway.
* R2. Restored stands that break D1 carry a derived flag and the inspector shows the warning (D2).
* R3. Every lead in joins its taxiway with continuous centerline and edge paint: no gap in the taxiway centerline, the edge line opens only where the fork pavement meets it.
* R4. GSE docking poses come from data per vehicle and service point, placed outside the hard footprint per `docs/ART_AND_ASSETS.md` section 12.
* R5. Vehicles approach and leave through waypoints in the aircraft frame that never cross the hard footprint (D3 exceptions only).
* R6. Draw order per `docs/ART_AND_ASSETS.md` section 3. Every vehicle has a ground shadow that touches its footprint. Vehicles use the same interpolation as aircraft so they never lag or float.
* R7. Guards: a property test that no vehicle footprint intersects the hull, wing or engine footprint at any tick of a turnaround for every MVP 1 type (D3 exceptions only); a test that every lead in joins with continuous markings; Playwright screenshot tests of the fixed scenes per stand size.
* R8. Before shots `handoff/work/T57-before-*.png` and after shots `handoff/work/T57-after-*.png`, inspected for overlap.
