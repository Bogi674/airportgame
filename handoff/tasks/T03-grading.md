# T03. Grading tool with cut and fill

Deferred by the user on 2026-11-10. Do not start it unasked.

Milestone M2. Roadmap line: "Grading tool with cut and fill cost (only an automatic grading cost is charged, terrain is not modified)".

## Goal

The player levels terrain inside a rectangle or along a runway, pays per cubic meter, sees cut and fill before confirming, and the terrain really changes: the map, obstacle surfaces and slope checks all see the new heights, and saves keep it.

## Read first

* `docs/GAME_DESIGN.md` section 6, "Terrain", and section 3 (site and land).
* `src/shared/validate.ts`: `stripGradingCost`, `estimateStripCost`, `checkPolygon`, `BuildContext`.
* `src/sim/world/site.ts`, `src/sim/world/terrain.ts`: how heights are generated (10 m cells, `GRID_N` 800).
* `src/sim/sim.ts`: `buildContext`, `updateObstacles`, `restore`, `saveState` (search `save`).
* `src/worker/sim.ts`: how the site payload goes to the UI (`staticData` kind `site`).
* `src/render/renderer.ts` and `src/render/chunks.ts`: how chunks are baked and marked dirty.
* `src/ui/tools/controller.ts`: the apron rectangle mode (`apronFrame`, `previewApronRect`, `commitApronRect`), the model for the tool.
* `handoff/PITFALLS.md` items 1, 2 and 7.

## Design (decided, follow it)

* A grading edit is `{ polygon: Pt[]; x0: number; y0: number; h0: number; gx: number; gy: number }`: inside the polygon every cell whose center lies inside is set to the plane `h0 + gx * (x - x0) + gy * (y - y0)`. Flat pads have `gx = gy = 0`.
* The sim keeps `gradeEdits: GradeEdit[]` in order and a `gradeVersion` counter. Heights are generated from the seed and then every edit is applied in order. The edit list is saved; restore regenerates the site and reapplies the list. Save format version bump (recipe R3).
* Cost: for each changed cell, volume = |old height minus new height| times 100 m²; cut is where the new height is lower, fill where it is higher; cost = (cut plus fill) times `gradingCostPerM3` from `airfield_codes.json`. Water cells and unowned cells refuse the edit (`onWater`, `notOwned`).
* Building a runway now grades its strip to the straight line between its threshold heights (it already charges `stripGradingCost` for this). Use the strip width of the runway's approach type for the polygon. This makes the charge real.
* Slope rule: a runway is refused when the average longitudinal slope |h(A) minus h(B)| / length is above the limit for its code: new data `slopeLimitsPct.runwayAvg` per code (A 2, B 2, C 1, D 1, E 1, F 1, from `docs/GAME_DESIGN.md` section 6 and ICAO). The problem text tells the player to grade first.
* After an edit the worker sends the changed heights to the UI (`staticData` kind `terrain`, the whole Float32Array, transferred), the renderer marks the chunks under the polygon dirty, and the obstacle key includes `gradeVersion`.

## Requirements

* R1. Command `grade { polygon; x0; y0; h0; gx; gy }` with validation, cost and the state above. Not undoable through undo (terrain is not an airfield object); say so in the inspector hint.
* R2. Saves keep the edits; a save made after grading restores identical heights and an identical `stateHash`.
* R3. Runway build grades the strip; the runway slope rule refuses steep runways with a clear problem text.
* R4. The UI terrain updates within one frame of the edit: map chunks rebake, the minimap updates.
* R5. Tool `grade` in the land category of the build menu: drag a rectangle (Shift for 15 degree frame steps like the apron rectangle), the target height is the terrain height at the first click, shown in the label. The preview tints cells: red where cut, blue where fill, with intensity by depth, and a label "Cut 1 200 m³, fill 800 m³, cost $14 400". Invalid areas show the problem.
* R6. A second mode "Runway profile": click a runway; the preview grades its strip to the end to end line (useful when an older save has ungraded runways).
* R7. Strings, `docs/UI_DESIGN.md` section 6, `docs/GAME_DESIGN.md` section 6 "Terrain".

## Tests (`tests/grading.test.ts`)

* A flat edit on a known hill sets every inside cell to `h0` and no outside cell changes.
* Cost equals the hand computed volume times the unit cost for a 3 by 3 cell area with known heights.
* Unowned and water cells refuse.
* Save, restore, compare heights array and `stateHash`.
* A runway steeper than the limit is refused; after grading its ends level it builds.
* Obstacle results change after grading away a hill that penetrated (use the synthetic site from `tests/obstacles.test.ts` as a model).
* Determinism (recipe R9).

## Visual check

Scenario `handoff/scenarios/T03.json` on the `riverValley` preset: shots of the preview over a slope (red and blue tint, label) and of the map after the edit, at about 0.5 px/m.

## Out of scope

Drainage, retaining walls, smooth blending at edges (edges are sharp at cell borders; record it as a decision).
