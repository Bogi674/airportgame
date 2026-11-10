# T06. Sprite liveries and tiers 0 to 3

Acceptance target since 2026-11-10: `docs/DESIGN_REVISION_3.md` section 1 and the sheets `docs/art/aircraft_mvp_lineup.png` and `docs/art/aircraft_style.png`. M4 no longer waits for this task.

Milestone M3. Same roadmap line as T05.

## Goal

Each aircraft sprite exists in four detail tiers chosen by zoom, and liveries color the right parts, following `docs/ART_AND_ASSETS.md` sections 2, 4.3 and 4.4.

## Read first

* `docs/ART_AND_ASSETS.md` sections 2 (zoom bands and baking), 4.3, 4.4.
* `docs/PERFORMANCE.md` section 5 and the quality governor.
* `docs/reference/sprite-prototypes/air2.py`: `render` (the `tier` argument), `livery_layer`, `silhouette`.
* `src/render/sprites/aircraftSprite.ts`, `src/render/quality.ts`, `src/render/renderer.ts` (`drawAircraft`).
* `docs/art/sprite-port.md` from T05.

## Requirements

* R1. Tier 0 is the silhouette only; tier 1 adds engines and livery; tier 2 adds panel lines (the default style); tier 3 adds seams, window strips and flap tracks. Match what `render(tier=...)` draws in Python, and write the mapping in `docs/art/sprite-port.md`.
* R2. The tier comes from the on screen size of the aircraft, with thresholds in data (`src/data/paint.json` or a new `sprites` block) and the quality governor able to cap it.
* R3. Liveries: fin, nacelle and fuselage stripe colors from airline data, drawn in the pass of each part. Airlines without data use a neutral default.
* R4. The sprite cache key includes type, livery and tier. The cache is bounded: count the cache size in a test and keep it under the limit you set in data.
* R5. No change in sim code.

## Tests

* For every MVP 1 type and tier, baking succeeds and the bounding box rule of T05 holds.
* Cache stays bounded after baking every type, tier and livery combination twice.

## Visual check

One aircraft at four zooms that select tiers 0 to 3, shots side by side; then a busy apron at 1 px/m to check that tiers mix without popping. Run `npm run stress` and report the dynamic layer cost if the stress output shows it, otherwise measure frame time in the dev build with the browser profiler and record it.

## Out of scope

Night lighting. Shadows beyond what the Python draws.
