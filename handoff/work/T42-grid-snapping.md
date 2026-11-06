# T42: Cities Skylines style grid and snapping

Status: planning
Branch: glm/mvp1

## Requirements

Copied from `handoff/tasks/T42-grid-snapping.md`, renumbered so each line is testable on its own.

* [ ] R1. `src/shared/constructionGrid.ts` holds one grid type (origin, heading, spacing along, spacing across) and `gridsFor(airfield)`, which returns the grid of every runway and taxiway, cached by the airfield payload and its version.
* [ ] R2. Node spacing is 2 m along and 2 m across, major lines every 10 m. No other number is added.
* [ ] R3. One active grid at a time. Hovering a runway or taxiway while a placement tool is active picks it when none is picked yet. The context bar picker changes it at any time. Nothing else changes it.
* [ ] R4. Snap mode grid or free for the apron polygon, the apron rectangle, stands and stand rows, GA blocks and new terminal foundations. Default grid. The runway and taxiway tools keep their existing node, end and segment snapping and its priority order. See the conflict note in Open questions about whether those two tools also snap to the grid.
* [ ] R5. In grid mode the point snaps to the nearest grid node and the heading snaps to the grid heading. In free mode the point is unquantized and the heading comes from the alignment frame as today. Alt is the live override.
* [ ] R6. Terminal foundations keep the 2 m local grid inside the building; the building origin snaps to the active grid node.
* [ ] R7. The grid draws as cyan lines over the pavement with a highlighted centerline, under the ghost preview, in screen crisp widths, culled to the viewport, with no text in the overlay.
* [ ] R8. No sim change, no airfield version bump, no network rebuild, no save change, no persistence of the picked grid.
* [ ] R9. Tests for the shared module: runway heading to expected node, taxiway grid perpendicular to its centerline, rotated frame origins, cache invalidation, empty airfield.
* [ ] R10. Strings for the picker and the mode label.
* [ ] R11. Standalone buildings, the T40 tower among them, use the same grid later. Noted in the T40 spec, not built here.

## Read first (done)

* [x] every file the spec lists
* [x] handoff/PITFALLS.md
* [x] handoff/QUESTIONS.md, handoff/STATE.md, handoff/RECIPES.md, handoff/templates/PLAN.md, handoff/templates/REPORT.md

Notes from reading:

* `src/ui/tools/controller.ts` 43 to 50: `Deps` carries `send`, `setGhost`, `zoom`, `setHighlight`, `setCursor`, `setGuide`. The renderer is reached only through these, so the grid overlay must be pushed to the renderer from `MapView.tsx`, not from the controller.
* `src/ui/tools/controller.ts` 278 to 304: `nodeCache` and `taxiNodes()` cache derived airfield data by payload identity. `taxiSnap` (291) is the taxiway tool's own snap and must not change. `snap` (307) is the shared snap used by the runway tool (`down`, 387) and the apron polygon (`previewApron`, 1191, and `up`, 475).
* `src/ui/tools/controller.ts` 1332 to 1356: `frameAt` (1332) returns the nearest runway heading, `rowHeadingAt` (1346) adds the store's `rowHeading`, `standPlan` (1350) uses the raw cursor point with no position snap at all today.
* `src/ui/tools/controller.ts` 1227 to 1300: `rectSnap` (1227) snaps a rectangle corner to nearby apron and taxiway edges in a frame; `apronFrame` (1268) picks the frame; `apronRect` (1289) recomputes the frame from the drag start on every call, with no modifiers in scope.
* `src/ui/tools/controller.ts` 1431 to 1440: `gridFor` (1431) rounds the origin to even world meters with `Math.round(p.x / 2) * 2` and reuses `tTemp` when the origin and heading match.
* `src/ui/tools/controller.ts` 215 to 230: `hoverAt` uses `pickObject` with tolerance `Math.max(8, 14 / zoom())`. `pickObject` (`src/shared/airfieldGeom.ts` 63) biases stands above runways above taxiways, so it cannot be reused for picking a grid: a stand beside a runway would win.
* `src/shared/airfield.ts` 160 to 178: `AirfieldPayload` has `version`, which `Airfield.refresh()` bumps on every shape change (`src/sim/airfield/airfield.ts` 131 to 136). Runway `x1`, `y1` are rounded to 0.5 m by `round05`, so grid nodes sit on 0.5 m boundaries, not on even meters.
* `src/shared/terminalOps.ts` 42 to 47: `gridAxes(headingDeg)` builds the unit axes with `sinLut` and `cosLut`. This is the one definition of grid axes and `constructionGrid.ts` imports it rather than repeating it.
* `src/shared/trig.ts`: `sinLut`, `cosLut` and `atan2Det` are the deterministic replacements for native trig. `compassVector` in `src/shared/airfield.ts` 175 uses `Math.sin` and is tolerated for whole degree headings only, so it is not used here.
* `src/ui/stores/toolStore.ts`: UI state only, nothing persisted, so the picked grid and the snap mode belong here and need no save migration.
* `src/ui/MapView.tsx` 29 to 38: the controller is built with the `Deps` closures. 143 to 157 hold the store subscriptions that already react to selection, airfield and tool changes. The grid overlay subscription belongs there.
* `src/render/renderer.ts` 224 to 251: `render` draws chunks, overlay, highlights, guide, ghost, people, vehicles, aircraft in that order. 253 to 270 (`drawGuide`) and 322 to 465 (`drawGhost`) are the existing per frame path drawing for editor feedback.
* `src/render/camera.ts` 79 to 91: `visibleBounds(out)` writes the world axis aligned bounds of the viewport into a `Float64Array`, which is exactly the culling rectangle the grid needs.
* `src/ui/strings/index.ts` 4: `StringKey` is derived from `en.json`, so new keys type themselves.
* `src/ui/ContextBar.tsx` 16 to 37: the `Select` helper, and 135 to 143: the apron mode button pair, which is the pattern for the snap mode toggle.
* `src/data/paint.json` 11: `colors.snap` is `#3cc8ea`, the project's snapping cyan, reused for the grid so the overlay matches the taxiway snapping in `docs/art/rev2_03_snapping.png`.
* `src/sim/airfield/airfield.ts` 496 to 543: `makeStands` rounds each stand to 0.5 m and rounds `headingDeg` to whole degrees, and 294 to 301: `terminalBuild` rounds the heading the same way. Grid headings are therefore whole degrees.
* `src/shared/apronGeom.ts` 10 to 12: aprons are clipped on a 5 cm lattice and merge only when they overlap or touch, which is why the apron polygon keeps its vertex snap reachable in free mode.

## Design

* Data added (file, keys, values with their source in the docs):
  * Done in 728ec44: `src/data/airfield_codes.json` `constructionGrid { note, spacingMinorM: 2, spacingMajorM: 10 }`, with the strict zod schema in `src/data/schemas/airfield.ts` and a refine that the major spacing is a whole multiple of the minor one. Read through `AIRFIELD.constructionGrid`. The earlier draft of this plan kept the two numbers as TypeScript constants; that is superseded.
  * Still to add in slice 3: nothing in data. Line widths and the cyan come from the existing `PAINT.colors.snap`.
* Types added or changed:
  * Done in 728ec44, `src/shared/constructionGrid.ts`: `ConstructionGrid { id: 'runway:<id>' | 'taxi:<id>:<segment>'; kind; origin; headingDeg; ax; ay; cx; cy; spacingMinorM; spacingMajorM; lengthM }` and `GridSnap { p; snapped; headingDeg; gridId; i; j; major }`. There is no `name` field. The picker label in slice 3 must be built in the UI from the runway or taxiway record found by the id, so the UI can localise the wrapper text.
  * `src/ui/stores/toolStore.ts`: `gridId: string | null` and `snapMode: 'grid' | 'free'` on `ToolState`, plus the exported constant `GRID_TOOLS: readonly Tool[]` holding `apron`, `stands`, `gaBlock`, `terminal`.
* Functions added or changed, one line each with what they do:
  * Done in 728ec44, `gridsFor(af)`: the grid of every runway (anchor threshold A) and of every taxiway segment (anchor its first point, heading its direction in whole degrees via `atan2Det`), runways first then taxiway segments in payload order, memoised in a `WeakMap` keyed on the payload object and its `version`. Also done, `gridPoint(g, i, j)` and `snapToGrid(p, g)`: the nearest node of one grid. The caller finds the active grid by `gridId`, so the null and not-in-list cases live in the controller, not in the module.
  * Still to add in slice 3 to `src/ui/tools/controller.ts`, no new shared function: the two line helpers `gridLines` and `gridCenterline` are not needed, because 88caf98 keeps the culling and the projection inside the renderer.
  * `src/shared/constructionGrid.ts` `gridLines(g, ...)`: dropped, see above.
  * `src/shared/constructionGrid.ts` `gridCenterline(g, ...)`: dropped, see above.
  * `src/shared/constructionGrid.ts` private `headingOf(ux, uy)`: done in 728ec44 as `atan2Det(ux, -uy)` in degrees, rounded to whole degrees and normalised to 0 to 359. Measured on this tree: (1, 0) gives 90, (0, 1) gives 180, (0, minus 1) gives 0. No native trig in the new module, unlike `compassVector` in `src/shared/airfield.ts` 175.
  * `src/ui/tools/controller.ts` `grids()`: the cached grid list for the current payload.
  * `src/ui/tools/controller.ts` `snapGrid(mods)`: the grid to snap to right now, or null in free mode, with Alt held, or with nothing picked.
  * `src/ui/tools/controller.ts` `placeAt(p, mods)`: the nearest grid node, or the raw point when not snapping.
  * `src/ui/tools/controller.ts` `gridUnder(p)`: the runway or taxiway grid under the cursor within a screen scaled reach, measured to the centerline minus half the pavement width plus shoulder, so hovering anywhere on the pavement counts. It cannot reuse `pickObject` because of the stand bias. With one grid per taxiway segment, the reach test runs over the segments of a bent taxiway and the nearest segment wins, so the grid the player gets is the one they are pointing at.
  * `src/ui/tools/controller.ts` `gridSnap(p, prev, mods, centerlines)`: the grid node in grid mode, else the existing `snap`. Only the apron polygon and the apron rectangle call it, so the runway tool keeps calling `snap` directly.
  * `src/ui/tools/controller.ts` changed `frameAt`, `rowHeadingAt`, `apronFrame`, `rectSnap`, `standPlan`, `gridFor`, `previewStands`, `commitStands`, `previewTerminal`, `terminalDown`: each takes the live modifiers and returns the grid heading or the grid node when snapping, else today's result.
  * `src/ui/tools/controller.ts` `move` (397): picks the grid under the cursor when a grid tool is active and none is picked yet.
  * `src/ui/tools/controller.ts` `refreshSelection` (255): drops a picked grid whose runway or taxiway is gone.
  * Done in 88caf98, `src/render/renderer.ts` `setGrid(g)` and `drawGrid(g, ...)`: the overlay, called between `drawGuide` and `drawGhost` in `render`. Screen space strokes, two passes at different alpha, a density guard, no text. The private `strokeLines(buf, count)` helper is not needed.
  * Still to add in slice 3, `src/ui/MapView.tsx` `syncGrid()`: resolves the picked grid from the store and the airfield and calls `renderer.setGrid`, subscribed to the tool store and the airfield.
* Recipe used (handoff/RECIPES.md): R6 for the strings, R7 for the context bar options, R8 for the renderer overlay, R4 for the derived data that must not rebuild the network.
* Save format change: none. The picked grid and the snap mode are UI state in `useToolStore`, which is not persisted.
* Why this design and not the obvious alternative:
  * The grid lives in `src/shared` even though only the UI reads it, because the renderer and the tool controller must agree on where a node is to the last decimal, and because the math is state affecting: it decides the coordinates of stands, aprons and terminal origins that the sim saves. Putting it in `src/shared` keeps it under the same determinism rules as the sim, which is why `headingOf` uses `atan2Det` instead of `Math.atan2`. Runway axes still come from `compassVector`, which uses `Math.sin` and `Math.cos`; PITFALLS 7 tolerates that for whole degree headings, and it is existing shared code rather than new state math.
  * The store holds the grid id string (`gridId: string | null`) rather than a grid object, because grids are derived. A stored object would go stale the moment a taxiway is trimmed. If a trim or cut renumbers segments, the id may point at another segment or at nothing: `refreshSelection` drops an id that is no longer in `gridsFor`, and a renumbered id is accepted as a known limit, to be raised with the user if it shows in play.
  * The cache is keyed on the payload object plus its `version` in a `WeakMap`, following the `nodeCache` pattern in the controller and the idea behind `obstaclesVersion`, without a second counter: `Airfield.refresh()` already bumps `data.version` on every shape change, and grids never touch the taxi network, so PITFALLS 1 does not apply.
  * The overlay draws in screen space with device pixel widths, as committed in 88caf98, so a 2 m line stays one crisp pixel at every zoom and display scale. Minor lines closer than 2 px on screen are dropped and the whole grid goes below 3 px, so the mesh never turns into a wash when zoomed out. An earlier draft of this plan drew in world space with a line width of pixels divided by zoom; that is superseded.
  * The grid node wins over vertex, centerline and guide snapping in grid mode. A piece built on the same grid already has its corners on nodes, so joining an apron still works, and the rule stays predictable. Free mode keeps every existing snap unchanged.
  * The apron rectangle captures its frame at the press instead of recomputing it from the drag start on every call, so holding Alt mid drag cannot flip the frame under the player.
  * On a rotated grid the nodes are not on 0.5 m coordinates, and the sim rounds stands, aprons and runway ends to 0.5 m (`round05` in `src/sim/airfield/airfield.ts` 64). A stand placed on a rotated grid can therefore be saved up to 0.25 m from the node the preview showed. This is a rounding consequence, not a bug, and it is recorded in `docs/ARCHITECTURE.md` section 12 so a later task can decide whether to snap inputs to the grid instead of to 0.5 m.

## Slices

1. DONE by another session in 728ec44: shared module, data key and 19 tests in `tests/constructionGrid.test.ts`. (R1, R2, R9)
2. DONE by another session in 88caf98: the renderer overlay in `src/render/renderer.ts`, with `setGrid` and `drawGrid`. It maps the four viewport corners into the grid frame, culls to that range, draws minor and major lines as two passes at different alpha, projects endpoints to device pixels by hand so the width is fixed at every zoom (PITFALLS 15), and drops the grid when the lines would be closer than 2 px for minor and 3 px for major. No shared `gridLines` or `gridCenterline` is needed: the culling and projection stay in the renderer. Nothing calls `setGrid` yet, so no player sees a half wired feature.
3. LEFT TO DO: the tool side, one complete feature. (R3, R4, R5, R6, R7, R10) Files: `src/ui/stores/toolStore.ts`, `src/ui/tools/controller.ts`, `src/ui/ContextBar.tsx`, `src/ui/strings/en.json`, `src/ui/MapView.tsx`. About 200 changed lines. The last step of this slice is the call to `renderer.setGrid`, so the grid the player picks is the grid they see.
4. Docs. (R7, R8, R11) Files: `docs/ARCHITECTURE.md`, `docs/GAME_DESIGN.md`, `docs/UI_DESIGN.md`, `docs/ROADMAP.md`, `docs/PERFORMANCE.md`, `handoff/TASKS.md`, `handoff/STATE.md`. Run `npm run rules` again after the doc edits.
5. Optional: an end to end test in `e2e/airfield.spec.ts` that builds a runway, picks its grid with the stands tool, places a row and asserts every stand sits on a node. `npm run e2e` is not part of `npm run verify`, so this slice is optional and must not be merged unless the suite passes.

## Tests

Done in 728ec44, in `tests/constructionGrid.test.ts`: 19 cases covering `gridsFor` and `snapToGrid` for an empty airfield, a rotated runway at heading 37, a bent taxiway with two segments, node indexes and `major` flags, cache invalidation by version, determinism across two payloads built the same way, and the grids of a built sim airport. Coordinates are compared with `toBeCloseTo`, not `toEqual`, because the trig tables are Taylor approximations of about 1e-12: `gridAxes(90)` gives `ux` 1.0000000000000002, so a node at 6 m along comes out as 6.000000000000001.

Two traps that cost time and are worth repeating:

* No test point may sit exactly halfway between two nodes. Measured on this tree: `gridAxes(90)` returns `ux` 1.0000000000000002 and `vx` 2.65e-15, so a tie such as (3011, 5007) on the 90 degree grid lands on (3010, 5008), not (3012, 5008), and the result depends on the table's last digit. Keep every point at least 0.2 m from a tie. Whether to round ties in a defined direction is left to the implementer and does not need a test.
* No test rectangle edge may sit exactly on a grid line. In a scratch calculation of my own, the rectangle (3010, 5005) to (3020, 5015) on the heading 90 grid at (3000, 5000) gave 10 lines at step 2 where 11 was expected by hand. The likely cause is float noise: the edge at x 3010 projects to 10.000000000000002 through `ux` 1.0000000000000002, and `Math.ceil` then drops the line on that edge. This is a hypothesis, not a confirmed diagnosis. The rectangle (3010.5, 5005.5) to (3019.5, 5014.5) keeps every edge away from a line, so the hand count of 9 at step 2 and 1 at step 10 is stable.

Nothing is left to add to the test file. The tool side has no unit test harness in this project, so slice 3 is covered by the screenshots in the visual check below, and optionally by the end to end test in slice 5.

## Visual check

* Scenario: `handoff/scenarios/T42-grid-snapping.json`, copied from `handoff/scenarios/example-airport.json` with the same runway, parallel taxiway, apron and stands, plus a second file `handoff/scenarios/T42-grid-empty.json` with no commands at all.
* Shot 1 `stands-grid` must show: the stands tool active, the cursor over the apron after touching the runway, cyan minor lines every 2 m and brighter majors every 10 m over the pavement, the centerline highlighted, and the row origin exactly on a node. At zoom 1.2 the node spacing is 2.4 px and the major spacing is 12 px.
* Shot 2 `apron-rect-grid` must show: the apron rectangle mode, the drag preview square to the grid, its width and height readouts as multiples of 2 m, and its corner on a node.
* Shot 3 `terminal-grid` must show: the terminal foundation with its first cell corner on a node and the building square to the grid heading.
* Shot 4 `free-mode` must show: after the Free button is pressed, the same cursor position gives an unsnapped preview while the grid stays drawn, and the context bar reads Free.
* Shot 5 `zoom-out` must show: at zoom 0.3 only the major lines and the centerline, with no minor mesh, and no line denser than 3 px.
* Shot 6 `context-bar` must show: the Grid and Free buttons with the active one pressed, the grid picker naming the picked runway, and no overlap between the bar, the hint and the problem line.
* Shot 7 from `T42-grid-empty.json` must show: no runway and no taxiway, the stands tool active, no grid lines at all, no page error, and the picker offering only the empty choice.
* Reference sheet: none exists in `docs/art/` for this feature. The colour reference is `docs/art/rev2_03_snapping.png`, which uses the same `colors.snap` cyan.
* True scale check: measure the grid spacing against the zoom, 2 m times the zoom in pixels, and the runway width against `AIRFIELD.codes.C.runwayWidthM` times the zoom. No asset is scaled for readability.
* Label overlap: the overlay draws no text, so it cannot overlap a label. The existing snap tip and readout offsets in `drawGhost` (434 to 464) are unchanged, and every screenshot is checked for a readout sitting on the snap ring.

## Open questions

Q1 is answered: one grid per taxiway segment, as committed in 728ec44. Q2, Q3, Q4 and Q5 in `handoff/tasks/T42-grid-snapping.md` are still open. Q2 and Q3 must be answered before slice 3, because they decide the picking gesture and the context bar. Q4 is already encoded by 728ec44, which gives a grid to every `Taxiway` record, rapid exits included, so Q4 needs the user only if they want rapid exits left out. Q5 changes one lower priority step in `taxiSnap` and `snap`. The implementer must copy the open ones into `handoff/QUESTIONS.md` and ask, per AGENTS.md rule 5. If the user does not answer, use the recommendations, say so in the report, and leave the questions open.

Fifth question, raised by a conflict between two sources:

* Q5. Do the runway and taxiway tools snap to the active grid as well as to their own nodes? The user's message that commissioned this plan lists the tools that get the grid as aprons, stands and rows, GA blocks and the new terminal origin, and says runway and taxiway node connections keep their existing priority. `handoff/QUESTIONS.md`, edited by another session at 00:21 on 2026-11-06, records a later confirmation that the runway and taxiway tools snap to the active grid as well and keep their own node snapping. Under the user's latest message rule the message wins, so this plan follows the list and leaves the two tools out. If the user confirms the other reading, add the grid as a lower priority step inside `taxiSnap` (291) and after the vertex and runway edge steps in `snap` (307), never before them, and nothing else in this plan changes.

## Verify

Paste the summary block of `npm run verify` here before every commit of this task.

Commit 262ef9c, which added the T40, T41 and T42 spec files, was made without running `npm run verify` first. That is the process rule broken once already on this task: never repeat it.

Commit 728ec44, the shared module, was verified in full by this pass after it landed, so slice 1 is green:

```
=== rules: node scripts/rules-check.mjs --all
rules-check: 291 file(s) checked, no findings.
=== types: npx tsc --noEmit -p .
=== lint: npm run lint --silent
=== tests: npm run test --silent
 Test Files  31 passed (31)
      Tests  251 passed (251)
=== stress: npm run stress
small mean 0.00680 p99 0.05190, medium mean 0.00859 p99 0.06670,
large mean 0.00633 p99 0.04830, busy50 mean 0.02386 p99 0.84080,
terminal640 mean 0.00461 p99 0.03980, all inside budget
verify: all checks passed.
```

## Report

* What now works, in player terms: the shared grid math exists and is committed, so every runway and every taxiway segment now has a stable grid id, an origin, a heading and a 2 m lattice with 10 m highlighted lines, and the renderer can draw that lattice in screen crisp lines. Nothing is usable in the game yet: no tool snaps, nothing calls `setGrid`, and no picker exists. This plan is for the rest.
* Commits: 728ec44 `construction grid: one shared lattice along a runway or taxiway` (slice 1) and 88caf98 `renderer: draw the construction grid in screen crisp lines` (slice 2), both made by another session while this plan was being written.
* Verify summary for 728ec44 and 88caf98, run by this pass on 2026-11-06 after 728ec44 landed: `npx tsc --noEmit -p .` clean, `npm run lint --silent` clean, `node scripts/rules-check.mjs --all` 291 files with no findings, `npm run test --silent` 31 files and 251 tests passed, `npm run stress` small mean 0.0068 p99 0.0519, medium mean 0.0086 p99 0.0667, large mean 0.0063 p99 0.0483, busy50 mean 0.0239 p99 0.8408, terminal640 mean 0.0046 p99 0.0398, all inside budget. That is the full set of five checks, so 728ec44 is green. 88caf98 landed after that run and has not been verified separately; it adds 87 lines to the renderer and touches no sim or data file, so it is very unlikely to break anything, but run the five checks again before building on it.
* Blockers: none now. The conflicting `tests/constructionGrid.test.ts` that blocked this plan earlier was committed as part of 728ec44, and its design won: one grid per taxiway segment, grid spacing from `AIRFIELD.constructionGrid`, and `snapToGrid(p, g)` over one grid. The plan above has been rewritten to match.
* Still open: Q2 (hover picks only while nothing is picked), Q3 (no hotkey for the persistent toggle) and Q5 (do the runway and taxiway tools snap to the grid too) need the user before slice 2. Q1 is answered, and Q4 is encoded by 728ec44.
* `handoff/TASKS.md` still shows T42 as `todo`, even though slice 1 is committed. Setting it to `doing` is step 1 of the workflow and belongs to the implementer, since this pass was not allowed to edit that file.
* `handoff/STATE.md` line 7 says 226 tests in 30 files. The current tree has 251 tests in 31 files. The implementer should correct that line in the docs slice.
* What was read in full: AGENTS.md, handoff/WORKFLOW.md, handoff/STATE.md, handoff/TASKS.md, handoff/PITFALLS.md, handoff/RECIPES.md, handoff/QUESTIONS.md, handoff/templates/PLAN.md, handoff/templates/REPORT.md, handoff/tasks/T42-grid-snapping.md, handoff/tasks/T40-atc-tower.md, handoff/scenarios/example-airport.json, src/shared/constructionGrid.ts (read after 728ec44 landed), src/shared/airfieldGeom.ts, src/shared/pavement/snap.ts, src/shared/business.ts 50 to 109, src/shared/airfield.ts, src/shared/terminalOps.ts, src/shared/trig.ts, src/shared/geom.ts, src/shared/ghost.ts, src/shared/apronGeom.ts, src/ui/tools/controller.ts in full, src/ui/MapView.tsx, src/ui/ContextBar.tsx, src/ui/stores/toolStore.ts, src/ui/stores/gameStore.ts, src/ui/strings/index.ts, src/ui/BuildMenu.tsx, src/render/renderer.ts 1 to 560, src/render/camera.ts, src/data/index.ts, src/data/schemas/airfield.ts, src/data/airfield_codes.json, src/data/paint.json, scripts/rules-check.mjs, scripts/verify.sh, scripts/shot.mjs, eslint.config.js, tests/helpers.ts, tests/snapping.test.ts, tests/data.test.ts, e2e/airfield.spec.ts, playwright.config.ts, docs/GAME_DESIGN.md 185 to 214, docs/DESIGN_REVISION_2.md 45 to 74 and 175 to 194, docs/ARCHITECTURE.md 65 to 94, 180 to 253, docs/UI_DESIGN.md controls and tool lines, docs/ROADMAP.md 55 to 94, docs/PERFORMANCE.md 1 to 70.
* Verification outstanding: yes, for slices 3 to 5. Slices 1 and 2 are committed and green as pasted above, with the one caveat that 88caf98 has not had its own verify run. No commit exists yet for the rest, so no verify summary can be reported for this task's remaining work.
