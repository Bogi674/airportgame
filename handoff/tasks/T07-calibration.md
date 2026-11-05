# T07. Calibration overlays saved

Milestone M3. Roadmap line: "Calibration overlays saved for all 10 types within tolerance".

## Goal

Every MVP 1 type has a saved calibration overlay and its data records the calibration status, following `docs/ART_AND_ASSETS.md` section 4.6.

## Read first

* `docs/ART_AND_ASSETS.md` section 4.6 and `docs/art/b777_calibration.png` (the worked example).
* `docs/AIRCRAFT_DATABASE.md` sections 5 and 6 (definition of ready).
* `src/data/aircraft.ts` (schema, the `sprite.calibration` field), `tests/sprites.test.ts`, `tests/aircraft.test.ts`.

## Important

The agent cannot fetch photos of real aircraft reliably and must not invent them. Calibration therefore has two parts:

1. **Data calibration (this task does it)**: an overlay of the baked sprite against a dimension drawing generated from the published data (length, span, wing root leading edge station, engine stations, stabilizer position, nose length), checked to the tolerances in section 4.6.
2. **Photo calibration (the user does it)**: ask the user for licensed top down photos or three views per type. Only with those may `sprite.calibration` become `photo calibrated`.

Write this split into `handoff/QUESTIONS.md` at the start of the task and ask the user for the photos. Continue with part 1 while waiting.

## Requirements

* R1. A script `scripts/calibrate.ts` (run with `npx tsx`) that bakes each MVP 1 type at a fixed px/m, draws the dimension lines from the data on top, and writes `docs/art/calibration/<type id>.png`. Use the browser canvas through Playwright, or `OffscreenCanvas` in Node if available; record the choice as a decision.
* R2. A test measures the same quantities from the sprite geometry (not from pixels) and checks section 4.6 tolerances: length and span within 1 percent, stations within 0.5 m. Tighten the existing 2 and 4 percent checks to these values once every type passes.
* R3. The aircraft JSON already uses three values for `sprite.calibration`: `needs photo calibration`, `dimension checked` and `photo calibrated`. Make the field a zod enum of these three in `src/data/aircraft.ts`, and set `dimension checked` for every MVP 1 type that passes R2. Never set `photo calibrated` without a user supplied image.
* R4. Types that fail are fixed in their sprite base data, quoting the published source of every changed number in the commit message.

## Visual check

The ten overlays themselves. Look at each: dimension lines must meet the sprite edges.

## Out of scope

Photo calibration without user supplied images.
