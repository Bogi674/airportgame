# T06 work notes

Decisions (asked 2026-11-10): tiers follow `docs/ART_AND_ASSETS.md` section 2 and `air2.py` (0 arrow, 1 silhouette, 2 reference, 3 close up), not the older T06 text. Livery colors stay on the 8 palette indexes already stored per aircraft, moved to `src/data/sprites.json`, so there is no save change and no sim change (R5).

* Data: `src/data/sprites.json` with zod schema `src/data/schemas/sprites.ts`: zoom thresholds, bake resolutions, cache limit, 8 liveries and a neutral default.
* Code: `src/render/sprites/aircraftSprite.ts`: `tierForZoom` from data, `liveryFor`, tier 0 arrow `bakeArrow`, tier 1 flat silhouette, fin, winglet, nacelle and crown band colors, bounded LRU `SpriteCache`.
* Tests: `tests/sprites.test.ts` covers thresholds, the neutral livery, the cache bound after baking every type, livery and tier twice, and cache hits. Baking itself needs a canvas, so it was checked in Chromium.
* Visual: `handoff/work/T06-tiers-and-liveries.png`: one A320 at tiers 0 to 3, a 777 in four liveries plus the neutral one, and turboprop and regional jet at tier 3.
* Checks: 316 tests, lint, rules check, chromium e2e (9) and stress pass. Sprites are not in the sim, so stress is unchanged (total mean 0.007 ms per tick).
* Not done: the busy apron at 1 px/m popping check and a browser profiler frame time number.
