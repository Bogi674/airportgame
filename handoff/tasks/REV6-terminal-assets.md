# REV6 BUILD PROMPT: for Claude Code

## Status (2026-11-25)

**Slice 1 is done** (T96): check in desk sizes, level aware span, upgrade rules, security level 1 art and the kit import. The footprint decision changed after the grill-me round: **whole cells only**, level 1 is 1 x 1, levels 2 and 3 are 2 x 1 cells (level 2 draws 3 m of art with a 1 m walkable strip at the tail end), and there is no half cell snap. This overrides Step 2 items 1 and 2 below. Decisions are in `handoff/QUESTIONS.md` (2026-11-25) and `docs/ARCHITECTURE.md` section 12.

**Slice 2 remains** (T97): Step 1 item 3 (category `openings`, pack `openings.json`, six assets), Step 4 and Step 4b (wall types, placement tools, rendering, walking, zones, UI) and their tests. The converter in `docs/reference/sprite-prototypes/export_fixtures.py` already maps the Revision 6 ops (`rev6_ops`), so slice 2 adds the six openings to it and extends the zod enums (grid `edge`, mount `edge`, `edgeSpan`, `nominalOpeningM`, `clearM`, `swingRadiusM`, `walkable`). The `swing` flag is already in the op schema.

Paste or point Claude Code at this file. Read first: `docs/CLAUDE.md`, `docs/DESIGN_REVISION_6.md` (this task's spec), `docs/DESIGN_REVISION_5.md`, `docs/TERMINAL_FIXTURES.md` sections 1 to 4, 8, 10 and 11, `docs/BAGGAGE.md` sections 3 and 7, `docs/TERMINAL_ZONING.md` section 7. Follow every hard rule in `docs/CLAUDE.md`. Never insert into saved lists, only append. Do not write em dashes or hyphen joined sentences in docs, comments or UI strings.

## Goal

Replace the check in desk levels 1 to 3 and the security lane level 1 in the fixture kit with the new art and sizes, and add six opening assets (doors and windows in small, medium, large) with placement, rendering and walking support.

## Inputs (already in the repo under docs/art/rev6/)

* `docs/art/rev6/ops_pack_rev6.json`: draw ops in meters for the 10 assets, keyed by id.
* `docs/art/rev6/catalog_rev6.json`: catalog entries for the 10 assets.
* `docs/art/rev6/svg/*.svg`: one standalone preview per asset, and `docs/art/rev6/sheet_rev6.svg` as the acceptance target.
* `docs/reference/sprite-prototypes/fixtures_rev6.py`: the generator, run it with `python3 fixtures_rev6.py docs/art/rev6`. It is self contained and does not import `fixture_core.py`.

## Step 0: map the formats (do this first, report in the PR)

The ops use the kinds of TERMINAL_FIXTURES 11.3 (`r c e p a l`) and the paint fields `f s sw o ht dash ov fLiv`. Geometry field names are the generator's own: rect `x y w h rx`, circle `x y r`, ellipse `x y rx ry rot`, polygon `pts`, path `d`, line `x1 y1 x2 y2`. Compare with `fixtureOpSchema` in `src/data/schemas/fixtures.ts` and `fixture_ops.py`. Write a converter (`scripts/importRev6.ts` or extend `export_fixtures.py`) that maps field names, gradient specs `{g, c}` (`lit`, `soft`, `dome`) and the `sw` forms `{px}` and `{m}`. Two extra flags exist:
* `fl: true`: floor layer, drawn under shadows and bodies, never casts a shadow.
* `swing: true`: floor clearance paint that may leave the footprint. Treat as a declared overhang in the footprint test, and also as a no build zone (section 4).

Livery: ops with `fLiv` take the airline `liveryPrimary` shaded by that factor with `fixture_core.shade`. The exported default livery is `#2f6fd1`.

## Step 1: data

1. Replace the sprite ops of `checkIn.l1`, `checkIn.l2`, `checkIn.l3` and `securityLane.l1` in `src/data/fixtures/sprites/processing.json`. Check the real security lane id in `catalog.json` first and use that id if it differs from `securityLane.l1`.
2. Update their catalog entries: `size`, `cells`, `ramps`, `service` (new field, `agent` and `passenger` points in meters) from `catalog_rev6.json`. Keep every existing stat, `gameKey`, `confirm` list and `sheet` field.
3. Add category `openings` with a new pack `src/data/fixtures/sprites/openings.json` and the six entries. Extend the zod enums: category `openings`, grid `edge`, mount `edge`, and the new fields `edgeSpan`, `nominalOpeningM`, `clearM`, `swingRadiusM`, `walkable`. Update `fixtureKit.test.ts` (14 packs, 150 assets).
4. The generated JSON is never edited by hand. If the Python reference `export_fixtures.py` is the source of truth, port the new assets into it through `fixtures_rev6.py` so `npm run export:fixtures` reproduces the files byte for byte.

## Step 2: check in desk sizes

1. (Done, whole cells.) The check in footprint is level aware through `FIXTURE_FOOTPRINT` and the helper `checkInSpan(level)`: level 1 [1,1], level 2 [2,1], level 3 [2,1] cells. `FIXTURE_KEYS` is not reordered.
2. (Settled by the owner, 2026-11-25.) Whole cells, no half cell snap: level 2 occupies 2 x 1 cells with 3 m of art. The `CHECKIN_HALF_CELL` switch was not built.
3. The ramp cell never moves: cell (0,-1) behind the left cell, for every level and every rotation. Add a test that the belt lane x 0.6 to 1.4 m meets the ramp stub for all levels and 4 rotations (reuse the existing ramp alignment test from `docs/TERMINAL_FIXTURES.md` section 10).
4. `upgradeFixture` for `checkIn`: it now needs a free strip to the right of the current footprint (level 1 to 2 needs one more cell, level 2 to 3 none, rotated with the desk). If blocked, reject with Needs room to the right and show the blocked cells in the ghost, red. Closing, queue move and undo work as in `docs/TERMINAL_FIXTURES.md` 4. Undo restores the old level and footprint.
5. Queue, service points and the staffing system read the `service` points (agent, passenger) rotated with the fixture. Stats per level stay as documented, `confirm` entries stay out of the sim or use the proposed value with a note in `handoff/QUESTIONS.md`.
6. Save migration: existing level 1 to 3 desks keep their anchor cell. Level 2 and 3 desks that no longer fit their new width are downgraded to level 1 with a one time alert, never deleted.

## Step 3: security lane level 1

Art swap only. Footprint, stats, officers, throughput, ramp rules and upgrade path are unchanged. Add the note about 3 officers to `handoff/QUESTIONS.md`. Visual regression: new snapshot for level 1, levels 2 and 3 snapshots must not change.

## Step 4: doors and windows

1. Wall types: append, never reorder. Existing: None 0, Wall 1, Glass 2, Door 3, StaffDoor 4. Append `DoorS 5`, `DoorL 6`, `WindowS 7`, `WindowM 8`, `WindowL 9`. Existing `Door` (3) is the medium door `door.m`, so saved games need no migration. `Glass` stays the glass partition.
2. A large opening spans two edges. Store openings as a per floor list `{ edge, rot, kind, size, mirrorX, mirrorY }` and mirror the wall byte onto both edges for room validation and the walking graph. This avoids pairing two adjacent large openings by parity. Placement of a large opening needs two free collinear wall edges, else Needs two free wall edges.
3. Tools: the wall tool gets a door size and a window size selector (S, M, L) with hotkeys. R rotates, a Flip control mirrors the hinge side and the swing side. The ghost shows the swing arc and turns red with the reason when a fixture, prop or ramp cell is on it.
4. Rendering: bake with the generic baker like any fixture, per zoom band and rotation. Openings go in the wall layer, above floors and below fixtures. Do not add shadows (the ops have no `ht`). Wall stubs in the sprite replace the wall piece on that edge, so the autotiler must skip the edge. Check corners and T junctions next to an opening, the wall must meet the sprite without a gap or a double edge line.
5. Swing arcs (`swing: true`) are a no build zone for fixtures, props and ramp cells, and are walkable for people. Large doors and all windows have none.
6. Walking: doors are walkable edges and windows are blocked edges. Edge capacity scales with `clearM`. Keep the current door rate for the medium door and scale from it. **Confirm** the rate with the owner, use the scaled value with a note in `handoff/QUESTIONS.md`.
7. Zones: an opening between two zones follows the existing breach rules. A door is a breach unless it is a staff door or inside a transition fixture. A window never breaches, like glass. Large doors on an exterior wall are valid terminal entrances.
8. Prices, upkeep and build time are not set. Put the six assets in `src/data/business.json` with a `TODO price` marker and add them to the decision batch.

## Step 4b: UI

Terminal flyout: the Doors card and the Windows card each show S, M, L with a mini preview of the sprite and the width in meters. Inspector for a placed opening shows size, clear width and, for doors, the swing side with a Flip button.

## Tests

* `tests/fixtureKit.test.ts`: 150 assets, unique ids, one footprint per processing family except `checkIn`, whose footprints are exactly 2x2, 3x2, 4x2 m, solid parts inside the footprint, `swing` and `fl` ops allowed to leave it, ramp cell (0,-1) for all three desk levels.
* Upgrade tests: level 1 to 2 and 2 to 3 with and without room, undo, queue handover.
* Placement tests for openings: single and large, blocked swing, two free edges, mirror and rotation.
* Walking tests: door passable, window blocked, capacity scales with clear width, breach rules.
* Visual regression for `docs/art/rev6/sheet_rev6.svg` against a Playwright shot of the same assets at tier 3, compared by structure, plus tiers 2 and 1 for one desk and one door.
* Determinism and save hash tests with openings in a saved building.
* `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` must pass.

## Acceptance

* The three desks show three distinct sizes in game at the default terminal zoom of 14 px per meter, level 3 is 2 x 1 cells.
* Security level 1 is visibly simpler than level 2.
* Doors and windows can be placed on walls in three widths each, with arcs, flips and rotation working.
* Docs updated: add a pointer note at the top of `docs/TERMINAL_FIXTURES.md` and `docs/DESIGN_REVISION_5.md` saying Revision 6 overrides the same footprint rule for the check in desk, extend `docs/ART_AND_ASSETS.md` section 14 with `docs/art/terminal_rev6_sheet.png` (render `docs/art/rev6/sheet_rev6.svg` to PNG), and log the decisions in `docs/ARCHITECTURE.md`.

## Report back

List the converter mapping, the choice made for the level 2 footprint (A or B), every **Confirm** item still open, and the screenshots of the three desks, the security lane level 1 and the six openings in a small test building.
