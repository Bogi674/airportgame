# T73. Fixture sprite baker and kit loading (draft)

Phase 3b. Draft written 2026-11-18 with the asset kit. Run the `grill-me` skill before code and refresh this spec.

## Goal

Every terminal fixture is drawn from the asset kit in `src/data/fixtures/` by one generic baker, so the game matches `docs/art/fixture_catalog.png` and `docs/art/terminal_scene_kit.png`.

## Read first

* `docs/DESIGN_REVISION_5.md`, `docs/TERMINAL_FIXTURES.md` sections 1 to 3, 8 and 11
* `docs/reference/sprite-prototypes/fixture_ops.py` (the behaviour to port) and `fixture_core.py` (`shade`, `hull`, `rect_pts`, `ell_pts`)
* `src/data/schemas/fixtures.ts`, `tests/fixtureKit.test.ts`
* `src/render/sprites/aircraftSprite.ts` and `src/render/chunks.ts` for the bake and cache pattern
* `handoff/PITFALLS.md`

## Settled

* Data: catalog plus one sprite pack per category, loaded with a dynamic import when the category is first drawn.
* Baker rules: `docs/TERMINAL_FIXTURES.md` section 11.4. Shadows are baked per rotation toward the world sun.
* Livery: ops with `fLiv` or `sLiv` take the airline color through `shade`.
* `air` ops call the aircraft baker with the scale model transform.

## Open for the interview

* Bake on the main thread or in the bake worker.
* Which existing fixture ids map to which kit asset when a fixture has no level yet (proposed: level 1 of its family, `seating` to `bench.beam3`, `toilet` to a washroom block of `washroom.wcStall`).

## Requirements

1. `src/render/sprites/fixtureSprite.ts`: `bakeFixture(assetId, tier, rot, ppm, livery)` returns an `ImageBitmap` in sprite meters with padding for the shadow.
2. Path ops parsed once into `Path2D` and cached per asset.
3. Gradients built per bake with `createLinearGradient` and `createRadialGradient` from the spec.
4. The terminal layer draws fixtures through the baker; old fixture drawing code is deleted.
5. A cache entry per asset, tier, rotation and livery, inside the static chunk budget.

## Acceptance

* Playwright shot of every asset at tier 3 compared by structure with `docs/art/fixture_catalog.png`.
* The terminal at 14 px per meter compared with the matching part of `docs/art/terminal_scene_kit.png`.
* Unit tests for tier gating, shadow offset per rotation and livery shading.
* `npm run verify` green, stress within budget.
