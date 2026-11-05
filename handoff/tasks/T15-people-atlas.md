# T15. People rendering from the atlas

Milestone M4. Roadmap line: "People rendering from the atlas: 30 recipes, walk cycle, tiers, sample cap".

## Goal

Passengers on screen are drawn from a baked atlas of the 30 recipes in `docs/ART_AND_ASSETS.md` section 6.2, with a 4 frame walk cycle and detail tiers, sampled from cohorts within a cap, matching `docs/art/people_sheet.png`.

## Read first

* `docs/ART_AND_ASSETS.md` sections 2 and 6 (all), `docs/art/people_sheet.png`.
* `docs/reference/sprite-prototypes/people2.py` (all) and its README entry.
* `docs/PERFORMANCE.md` section 5 (rendering) and the quality governor.
* `src/render/people.ts` (the current dot sample), `src/render/renderer.ts` (`drawPeople`), `src/render/sprites/aircraftSprite.ts` (how sprites are baked and cached).
* T14's cohort snapshot.

## Requirements

* R1. Port the layers of section 6.1 and the 30 recipes from `people2.py` to a TypeScript baker in `src/render/sprites/peopleAtlas.ts`, exact math, at true scale (about 0.5 m wide).
* R2. Recipes, skin tones and hair colors live in `src/data/people.json` with a schema; a profile weighted table picks recipes per cohort from `recipeSeed`.
* R3. Atlas: one canvas per tier, baked once at load (or lazily per tier), 4 walk frames per recipe and direction handled by rotation at draw time.
* R4. The render sample shows at most the cap from the quality preset (keep 3 000 high, 1 500 under the governor), choosing cohorts nearest the camera center first, deterministic for a given snapshot.
* R5. Frame time: the dynamic layer stays under the budget for the medium scenario. Measure with the browser profiler in the dev build at 4x and record it.

## Visual check

A terminal scene at about 8 px/m with every recipe visible, side by side with `docs/art/people_sheet.png`; and a crowded check in hall at 2 px/m. No figure overlaps a wall in a way the sheet does not show.

## Out of scope

Staff roles (T28).
