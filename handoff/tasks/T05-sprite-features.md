# T05. Sprite port: features and layer order

Acceptance target since 2026-11-10: `docs/DESIGN_REVISION_3.md` section 1 and the sheets `docs/art/aircraft_mvp_lineup.png` and `docs/art/aircraft_style.png`. M4 no longer waits for this task.

Milestone M3. Roadmap line: "Sprite baker in TypeScript ported from the prototypes: all features, layer order, livery, tiers 0 to 3". This task covers features and layer order. T06 covers liveries and tiers.

## Goal

The TypeScript sprite baker draws every feature of `docs/reference/sprite-prototypes/air2.py` for the 10 MVP 1 types, in the layer order of `docs/ART_AND_ASSETS.md` section 4.2, with the math ported exactly.

## Read first

* `docs/ART_AND_ASSETS.md` sections 1, 2, 4.1, 4.2, 4.3, 4.5 and 14.
* `docs/AIRCRAFT_DATABASE.md` section 5 (sprite geometry).
* `docs/reference/sprite-prototypes/air2.py`, the whole file, and `README.md` in that folder.
* `src/render/sprites/geometry.ts` and `src/render/sprites/aircraftSprite.ts`.
* The reference sheets in `docs/art/` that show aircraft. List them in your plan.

## Step 1. Gap table (first commit, docs only)

Write `docs/art/sprite-port.md` with one row per Python function in `air2.py`: function, what it draws, the TypeScript function that ports it or "missing", and the tier it appears in. At the time of handoff, `geometry.ts` ports the fuselage, wings, winglets, stabilizers and engines; `aircraftSprite.ts` bakes them with liveries. Expect these to be missing or partial: `windscreen` styles, `doors_windows`, `flap_tracks`, `upper_deck`, `lights`, `pylon`, `prop` blade projection, `spinner`, `nacelle_fan` flow types and chevrons, `tail_parts` fin lens and T tail ordering. Confirm each by reading the code.

## Requirements

* R1. Every function marked missing in the gap table is ported, with a comment naming the Python function it ports. Keep constants exactly as in Python.
* R2. Layer order follows section 4.2 for low wing and high wing types. Underwing nacelles sit under the wing. Livery tint is drawn in the pass of the part it colors.
* R3. Windscreen styles from section 4.1, chosen by the data field the prototype uses (`specs2.py` shows the mapping). Add the field to the aircraft schema if missing, with values for the 10 MVP 1 types.
* R4. No allocation per frame: sprites are baked once per type, livery and tier and cached, as now.
* R5. `tests/sprites.test.ts` keeps passing, and a new test checks for each MVP 1 type that the baked sprite's bounding box matches length and span within 2 percent and 4 percent, as today.

## Visual check

A scenario with one parked aircraft of each MVP 1 type on remote stands at about 4 px/m, one shot per type. Compare each with the reference sheets and with the Python output: run `python3 docs/reference/sprite-prototypes/air2.py` if it renders sheets (read its `__main__` block), and put both images side by side in the work file.

## Out of scope

Liveries and tiers (T06), calibration overlays (T07), variants beyond the 10 MVP 1 types.
