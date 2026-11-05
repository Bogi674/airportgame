# T42. Cities Skylines style grid and snapping

Milestone M2. Answers to the design questions are in `handoff/QUESTIONS.md` (2026-11-05 T40 entry).

## Goal

Every runway and taxiway carries a snappable construction grid along it. The player picks which grid is active, and can switch any tool between snapping to that grid and free placement. This replaces today's scattered behaviour, where each tool snaps differently, only the taxiway tool has real snapping, and free placement is hard to aim.

The model is Cities Skylines: the road (here the runway or taxiway) is drawn freely, a grid then forms along it, and the player builds snapped to that grid or freely.

## Read first

* `src/ui/tools/controller.ts`: `frameAt` (1332), `rowHeadingAt` (1346), `snap` (307), `taxiSnap` (291), `previewRapidExit` (1051), `parallelPlan` (1130), `rectSnap` (1227), `apronFrame` (1268), `gridFor` (1431), `originFor` (1435)
* `src/shared/airfieldGeom.ts` (`frameHeadings`, 199 to 203)
* `src/shared/pavement/snap.ts` (`findSnap`, `taxiNodes`, `snapPolyline`)
* `src/shared/business.ts` 60 to 83 (`TerminalGrid`, `TERMINAL_CELL_M`, `TERMINAL_CHUNK`, `TERMINAL_MARGIN`)
* `src/shared/airfield.ts` (`Runway`, `Taxiway`)
* `src/render/renderer.ts` (`setGuide` 178, `drawGuide` 253, `drawMarker` 512, `drawGhost` 322)
* `src/data/airfield_codes.json` `taxiwayTool` (122), `src/data/paint.json` `snap` (11)
* `docs/GAME_DESIGN.md` 195 to 203, `docs/DESIGN_REVISION_2.md` 52 to 70 and 182 to 183, `docs/ARCHITECTURE.md` 74, 187, 243
* `handoff/RECIPES.md` R7 (build tool), R8 (draw), R2 (data), R6 (strings)

## Requirements

* R1. One shared module `src/shared/constructionGrid.ts`: a grid is an origin, a heading, a spacing along and a spacing across. A function `gridsFor(airfield)` returns the snappable grid of every runway and taxiway, built from their geometry, cached by the airfield version. A function `snapToGrid(p, grids, active)` returns the snapped point and the grid it snapped to.
* R2. One active grid at a time. The player selects it by hovering a runway or taxiway while any placement tool is active, or from a picker in the context bar. The active grid is drawn as cyan lines on the pavement with a highlighted centerline.
* R3. Each placement tool gains a snap mode: grid, or free. Default grid for stands, stand rows, aprons, apron rectangles, GA blocks, terminal foundations and the ATC tower from T40. The runway and taxiway tools keep their existing node, end and segment snapping, because they create the grids.
* R4. In grid mode the cursor point snaps to the nearest grid node, and the heading snaps to the grid heading. In free mode the point is unquantized and the heading comes from the alignment frame as today. One modifier switches modes live: hold Alt for free, as today, and the context bar shows which mode is active.
* R5. Terminal foundations keep the existing 2 m local grid inside the building, but the building's origin snaps to the active grid node.
* R6. The grid lines are drawn in the renderer under the ghost preview, in screen crisp widths, and are culled to the viewport. They never appear over the UI.
* R7. No sim change. Grids are derived from the airfield and are recomputed on `refresh()`; they use their own version counter like `obstaclesVersion` (PITFALLS 1).
* R8. Tests for the shared module: a grid built from a runway of a known heading snaps a point to the expected node; a taxiway grid is perpendicular to its centerline; the cache invalidates when the airfield version bumps.
* R9. Strings for the picker and the mode label, appended near `tool.*` and `ghost.*`.

## Out of scope

Changing the taxiway tool's node snapping. Grid spacing changes per object (stands, terminals) beyond the one value in data. Curved grids. Moving an object after placement.

## Numbers (confirmed by the user, 2026-11-05)

Grid is 2 m minor and 10 m major. It is anchored to the runway or taxiway the player explicitly selects. Grid and free placement is a persistent toggle, with Alt as a temporary override. Guides are drawn only in the viewport.

## Numbers to confirm with the user before coding

| Value | Proposed | Source |
| --- | --- | --- |
| Grid length drawn | 2 000 m from the origin | proposed |
| Grid snap radius | 40 m | proposed |

## Interaction model to confirm

* Select grid: hover a runway or taxiway with any placement tool active, or pick from the context bar.
* Toggle mode: hold Alt for free placement, release to snap. The context bar shows the active mode and grid.
* The runway and taxiway tools keep their own node snapping, because they create the grids.
