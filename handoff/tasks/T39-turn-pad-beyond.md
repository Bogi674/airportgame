# T39. Turn pads sit beyond the runway threshold

Milestone M2. Design revision from the user (session of 2026-11-05): a turn pad is an extension of the runway past the end, like a real turn pad (user reference: a runway turn pad diagram showing the pad outside the threshold line).

## Goal

A pad is paved ground beyond the runway end, adjoined to the runway, wider than the runway on the pad side, with the yellow turn curve in it. The threshold and declared distances do not move and are not lengthened by the pad.

## Read first

* `src/shared/turnPad.ts` (all), `src/data/airfield_codes.json` (`turnPad` note: total paved width at the pad).
* `src/sim/ops/traffic.ts` `updateBacktrack`: the sim pivots at the runway end and sways out by `widthM / 2 + extra / 2`, so it needs no change.
* `src/render/markings/taxiPlan.ts` and `airfieldPaint.ts` pad parts from T01.
* Tests in `tests/turnPad.test.ts`.

## Design decisions (asked and answered by the user)

* Lateral: the pad's far edge is flush with the runway's far edge, and all the extra width sticks out on the side the player picked. Total paved width is the runway width plus `padSize.extra`, so it matches the `turnPad.widthM` note in `airfield_codes.json`.
* Shape: a sharp rectangle. No chamfer, no taper on the ground.
* Placement: flush at the runway end and extending outward `turnPad.lengthM`, with a 1 m overlap into the runway so the pavement fills join.

## Requirements

* R1. `padPolygon`, `padCurve` and `padArea` reworked in `src/shared/turnPad.ts`. The teardrop keeps its proportions (3 m margins inside the new rectangle) and its tail meets the runway centerline at the end. `padValue` stays `padArea` times the unit cost, so the price follows the new area.
* R2. Painter: the pad pavement is painted beyond the end (no runway edge line gap needed any more, the pad is outside the runway); culling bounds extend past the end by the pad length. The context of the old break mechanism goes away for pads.
* R3. Tool, inspector, works and backtrack behavior unchanged in behavior and cost formulas. The player interaction stays: hover picks the end, cursor side picks the side.
* R4. Tests first for every change under `src/shared`; determinism test unchanged and green.
* R5. Docs updated: `GAME_DESIGN.md` section 6 turn pad paragraph, `UI_DESIGN.md` bullet stays valid, one decision line in `ARCHITECTURE.md` section 12.

## Out of scope

Chamfered corners. Changing declared distances or the backtrack pivot.
