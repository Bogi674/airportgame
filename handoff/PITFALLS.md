# PITFALLS.md

Mistakes that already cost time on this project. Read before writing code.

## Architecture

1. **Changing the airfield version rebuilds the taxi network and resets runway reservations.** `Airfield.refresh()` bumps `data.version`; the sim then calls `traffic.setAirfield`, which rebuilds `TaxiNetwork` and replans every aircraft. Derived data that does not change the network (obstacle results, overlays) must use its own version counter. Copy the pattern of `obstaclesVersion` in `src/sim/airfield/airfield.ts` and `updateObstacles` in `src/sim/sim.ts`.
2. **Restored saves must behave exactly like an uninterrupted run.** Anything derived must be recomputed in `Sim.restore` before the first tick, and must not trigger a network rebuild that the uninterrupted run did not have. `tests/save.test.ts` checks the hash after a save and load.
3. **Render and UI must not import `src/sim` internals**, except `type` imports and `@sim/commands`. Logic both need goes in `src/shared`.
4. **The traffic keeps a shallow copy of the airfield payload** (`traffic.af`). Replacing an array on `airfield.data` after `setAirfield` is invisible to traffic. Mutate objects in place or hand the new value to traffic directly.
5. **Saved typed arrays in traffic** are listed in `Traffic.arrays()`. A new per aircraft array must be added there, or it is lost on save and missing from the hash.
6. **Fixture ids are indexes into `FIXTURE_KEYS`** (`src/shared/business.ts`) and are saved in terminal grids. Append new fixtures at the end only. `isShopFixture` uses the id range 6 to 11; keep it correct.

## Determinism

7. **`Math.sin`, `Math.cos` and `Math.atan2` differ between engines.** In sim code use `sinLut`, `cosLut`, `atan2Det` from `src/shared/trig.ts`. Pure render code may use `Math`. `compassVector` in `src/shared/airfield.ts` uses `Math.sin`; it is tolerated in existing sim code for headings in whole degrees, but do not spread it into new state math.
8. **Map and Set iteration** follows insertion order, which is fine only when insertion order is itself deterministic. Sort by id when in doubt.
9. **`structuredClone`** is fine in commands, never in a tick loop (allocation).

## Data and files

10. **Never reformat JSON files.** A previous attempt rewrote `en.json` and `airfield_codes.json` with a JSON serializer and broke the diff. Edit the lines you need by hand.
11. **Every data file is validated by a strict zod schema** in `src/data/schemas`. A new JSON key without a schema change fails at import with a long zod error. Add the key to the schema in the same edit.
12. **polygon-clipping must be imported through `src/shared/clip.ts`.** A direct import works in Vite and Vitest but crashes `npm run stress` (plain Node).
13. **Strings**: UI text lives in `src/ui/strings/en.json` and is read with `t('key')` or `tFormat('key', { n: 1 })`. Problem codes returned by the sim show as `notice.<code>`; add that key or the player sees the raw code.

## Rendering

14. **Static layers are baked into chunks** in a worker. A change to markings only shows after the airfield version changes, which marks chunks dirty. If your new drawing never appears, check that it is part of the plan built from the airfield payload (`src/render/markings/taxiPlan.ts`, `airfieldPaint.ts`).
15. **Fixed size screen elements** (snap markers, red penetration dots, labels) are drawn after `ctx.setTransform(1, 0, 0, 1, 0, 0)` in screen pixels times `this.dpr`. World elements are drawn in meters under the camera transform. Do not mix them.
16. **Overlapping labels and markers are a bug** (the user's rule). Thin out dots closer than their size, offset labels from markers, and check every screenshot.

## Tests and tools

17. **`tests/helpers.ts`** has `ownedSim()` (owns the whole site) and `buildTestAirport()`. Use them; do not rebuild an airport by hand unless the test needs a special layout.
18. **Long traffic tests** run 20 000 to 40 000 ticks; keep them under a few seconds by using small airports and `setTestTraffic`.
19. **`vitest` hides console output** unless you pass `--silent=false`.
20. **`npm run shot` needs `npm run dev` running.** If Playwright cannot find a browser, set `PW_CHROMIUM_PATH` to an installed Chromium or run `npx playwright install chromium`. Wait for `chunksReady`; the tool already does.
21. **The stress baseline** (`perf-baseline.json`) is only rewritten with `--update-baseline` after the user agrees the slowdown is intended.

## Process

22. **Do not tick a roadmap box for a partial feature.** Add a note in parentheses saying what is missing instead.
23. **Do not invent numbers.** Every gameplay number comes from the docs or the task spec. If it is missing, ask.
24. **Reference Python under `docs/reference/` is normative math.** Port formulas exactly, including constants, and cite the file and function in a comment.
25. **Walk graph node ids are compact and renumbered on every rebuild.** Never store one across an edit; compare `Business.walkVersion` and call `nearestNode` again.
26. **Service node ids are stale after `Business.serviceVersion` changes.** Find the node again by its logical cell and fixture kind, as `rebuildServiceNodes` does, and never keep a node index across an edit.
27. **Service queues, evicted cohorts and the service rng are saved since version 13.** A mid queue save restores identically. The done buffer is still unsaved, so it must be consumed in the tick that produced it.
