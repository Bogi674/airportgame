# T02. Runway marking details

Milestone M2. Roadmap line: "Runway, taxiway and stand markings per `docs/ART_AND_ASSETS.md` sections 8 and 9, with surface rules and generated restraint envelopes". Taxiway and stand markings are complete (design revision 2). This task closes the runway gaps.

## Goal

Runway paint follows `docs/ART_AND_ASSETS.md` section 8 for everything the game models, with every dimension in data.

## Read first

* `docs/ART_AND_ASSETS.md` section 8 (all bullets) and section 10 (surfaces).
* `src/render/markings/airfieldPaint.ts`: `paintRunwayMarks`, `tdzPairs`, `aimingDistance`, `THRESHOLD_STRIPES`, `stencil`, `lineM`, and how taxiway slab joints are painted (search `slabJointM`).
* `src/data/paint.json` and its schema in `src/data/schemas/airfield.ts`.
* `src/sim/airfield/geometry.ts`: `assignRunwayNames`, `designatorNumber`.
* `src/sim/world/site.ts`: `generateSite` and how it forks the RNG.
* `tests/airfield.test.ts` and `tests/site.test.ts` (they check runway names and the golden site hash).

## Gaps found in the current painter (fix these)

| # | Spec (section 8) | Now |
| --- | --- | --- |
| G1 | Designator from the magnetic heading; variation from the site seed | true heading |
| G2 | Centerline 0.45 m for precision and non precision on codes C and up, 0.3 m otherwise (0.9 m is for CAT II and III, which the game does not model) | 0.9 m when the runway is 30 m or wider |
| G3 | Edge lines 0.9 m on runways 30 m wide or more, 0.45 m otherwise | always 0.9 m |
| G4 | Aiming point: 400 m from the threshold when landing distance is 2 400 m or more, closer on shorter runways; bars 45 to 60 m long, 6 to 10 m wide | 300 m, 45 m by 6 m |
| G5 | Unpaved runways: white edge markers every 60 m, threshold boards, a windsock | markers every 25 m, no boards, no windsock |
| G6 | Asphalt runways: grooving texture and darker rubber deposits in the touchdown zones. Concrete runways: slab joints | plain fill |

## Requirements

* R1. All runway marking dimensions move to a `runway` block in `src/data/paint.json` (with schema): threshold stripe count by width, stripe length, width, gap and offset, designator digit height and offset, centerline dash, gap and widths per rule, edge line widths, the aiming point table by landing distance (distance, bar length, bar width; use ICAO Annex 14 table 5-1: under 800 m none, 800 to 1 200 m at 150 m with 30 m by 4 m bars, 1 200 to 2 400 m at 250 m with 45 m by 6 m bars, 2 400 m and more at 400 m with 45 m by 6 m bars), the touchdown zone pair rule, unpaved marker spacing. No numeric marking constant stays in `airfieldPaint.ts`.
* R2 (G1). Add `magVarDeg` to the site: drawn once from a new RNG fork named `magvar`, created after all existing forks so nothing else changes, uniform in a range from new data `site.magVarRangeDeg` (use 8, meaning minus 8 to plus 8, whole degrees). East variation is positive; magnetic heading = true heading minus variation. `assignRunwayNames` takes the variation. The golden site hash test must still pass unchanged; if `hashSite` should include the new value, add it and update the golden value in the same commit with a note. Show the variation in the runway inspector ("Magnetic variation 3° E").
* R3 (G2, G3). Centerline and edge line widths by the rules above.
* R4 (G4). Aiming point distance and bar size from the data table, by runway length (the game uses runway length as landing distance).
* R5 (G5). Unpaved runways: markers every 60 m from data; threshold boards (two white boards 3 m by 1 m, one each side, 3 m outside the edge at each threshold); a windsock drawn in the dynamic layer of `renderer.ts`, 8 m tall cone at true scale, placed 60 m beside the runway 300 m from threshold A, on the side away from taxiways, pointing downwind from the current wind. Paved instrument runways get a windsock too (ICAO requires one per runway end used for landing; one per runway is enough here).
* R6 (G6). Asphalt runways: fine grooving lines across the runway every 0.5 m drawn only when the zoom shows them as at least 1 px apart (otherwise skip, never a moire), and rubber deposits as darker translucent bands on the centerline 300 to 900 m from each threshold. Concrete runways: slab joints using the concrete `slabJointM` from `surfaces.json`, like concrete taxiways.

## Tests

* `tests/airfield.test.ts`: names with variation. For example heading 090 with variation plus 5 gives designators 09 and 27 (85 rounds to 09 within 85 to 94); heading 095 with plus 5 gives 09; with minus 5 gives 10. Compute expectations, do not hard code from a run.
* A data test: the aiming table is sorted by distance and every bar fits inside the runway half width.
* `tests/site.test.ts`: `magVarDeg` is an integer within the range and the same for the same seed.

## Visual check

Scenario `handoff/scenarios/T02.json` with four runways side by side (300 m apart): precision code C asphalt 2 800 m, non precision code B asphalt 1 400 m, visual code A grass 900 m, precision code E concrete 3 200 m. Shots at the threshold of each (about 1 px/m) and one overview. Compare with ICAO pattern descriptions in section 8; write the comparison per gap.

## Docs

* `docs/ART_AND_ASSETS.md` section 8: note that CAT II and III, displaced thresholds and blast pads are not modeled.
* `docs/ROADMAP.md`: tick the markings line when R1 to R6 are done.

## Out of scope

Displaced thresholds and blast pad chevrons (no paved area before a threshold exists in the model). Lights. Intermediate holding positions.
