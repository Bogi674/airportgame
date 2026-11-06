# T42. Cities Skylines style grid and snapping

Milestone M2. Open questions are listed at the end of this file and in `handoff/work/T42-grid-snapping.md`. The `handoff/QUESTIONS.md` entry of 2026-11-05 proposed values that the user has since replaced, so this file is the authority.

## Goal

Every runway and taxiway carries a snappable construction grid along it. The player picks which grid is active, and can switch any placement tool between snapping to that grid and free placement. This replaces today's scattered behaviour, where each tool snaps differently, only the taxiway tool has real snapping, and free placement is hard to aim.

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

Confirmed by the user on 2026-11-05 and 2026-11-06. The numbers that were marked proposed in the first draft of this file are gone: there is no snap radius and no fixed drawn length, because the grid is viewport local.

* R1. One shared module `src/shared/constructionGrid.ts`: a grid is an origin, a heading, a spacing along and a spacing across. A function `gridsFor(airfield)` returns the snappable grid of every runway and of every taxiway segment, built from their geometry, cached by the airfield payload and its version. A function `snapToGrid(p, grid)` returns the nearest node of one grid as `{ p, snapped, headingDeg, gridId, i, j, major }`. Implemented and committed as 728ec44.
* R2. One active grid at a time. The player picks it by hovering a runway or taxiway while a placement tool is active and no grid is picked yet, or from a picker in the context bar. Once picked, the grid never changes on its own.
* R3. Each placement tool gains a snap mode: grid, or free. Default grid for the apron polygon, the apron rectangle, stands and stand rows, GA blocks and new terminal foundations. The runway and taxiway tools keep their existing node, end and segment snapping, because they create the grids.
* R4. In grid mode the cursor point snaps to the nearest grid node, and the heading snaps to the grid heading. In free mode the point is unquantized and the heading comes from the alignment frame as today. One modifier switches modes live: hold Alt for free, as today, and the context bar shows which mode is active.
* R5. Terminal foundations keep the existing 2 m local grid inside the building, but the building's origin snaps to the active grid node.
* R6. The grid lines are drawn in the renderer under the ghost preview, in screen crisp widths, and are culled to the viewport. They never appear over the UI. The overlay carries no text, so it cannot overlap a label.
* R7. No sim change. Grids are derived in the UI from the airfield payload and cached by the payload's own version. No airfield version bump, no taxi network rebuild, no save change, no persistence of the picked grid.
* R8. Tests for the shared module: a grid built from a runway of a known heading snaps a point to the expected node; a taxiway grid is perpendicular to its centerline; rotated frame origins snap to the expected node; the cache invalidates when the airfield version bumps; an empty airfield yields no grid and no snap.
* R9. Strings for the picker and the mode label, appended near `tool.*` and `ghost.*`.
* R10. Standalone buildings placed later, the ATC tower of task T40 among them, use the same grid. That is out of scope here and stays a note in the T40 spec.

## Out of scope

Changing the taxiway tool's node snapping. Grid spacing changes per object (stands, terminals) beyond the one value in data. Curved grids. Moving an object after placement. A snap radius or a fixed drawn extent: the grid is viewport local, so the cursor rounds to the nearest node anywhere in the visible frame and the lines are culled to the viewport.

## Numbers (confirmed by the user, 2026-11-05 and 2026-11-06)

* Grid node spacing: 2 m along and 2 m across.
* Major lines: every 10 m.
* Both values live in `src/data/airfield_codes.json` under `constructionGrid`, with `spacingMinorM` and `spacingMajorM`, read through `AIRFIELD.constructionGrid`. The schema requires the major spacing to be a whole multiple of the minor one.
* The grid is anchored to the runway or taxiway the player explicitly picks. It is not chosen by proximity.
* Grid and free placement is a persistent toggle, with Alt as a temporary override while held.
* Guides are drawn only in the viewport.
* Tools that use the grid: apron polygon, apron rectangle, stands and stand rows, GA block, new terminal origin. Standalone buildings come later. The runway and taxiway tools keep their existing node, end and segment snapping, and their priority order is unchanged. `handoff/QUESTIONS.md` records a later line saying those two tools also snap to the active grid; that line is not in the list above, so it is open question Q5 in `handoff/work/T42-grid-snapping.md` until the user settles it.
* No gameplay value is invented. The 2 m and 10 m values are the only numbers this task adds, and they come from the user.

## Interaction model

* Pick the grid: hover a runway or taxiway while a placement tool is active and no grid is picked yet, or choose one in the context bar picker. After the first pick, hovering another object does not change the grid.
* Toggle mode: the Grid and Free buttons in the context bar, with Alt as a temporary override while held. The context bar shows the active mode and the picked grid.
* With no runway and no taxiway there is no grid, every tool falls back to today's behaviour, and the picker offers only the empty choice.

## Numbers to confirm with the user before coding

None. The values above are confirmed.

## Open questions

Each question has a recommendation. Ask the user before coding the slice that depends on it, and record the answer here.

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | A bent taxiway has several straight segments. Which one anchors its grid? | A the longest straight segment, ties to the earliest. B the first segment. C the segment nearest the cursor when the grid is picked. D one grid per segment | Answered 2026-11-06: D. Every taxiway segment carries its own grid, with the stable id `taxi:<id>:<segment>` counting segments from 0. It is implemented and committed as 728ec44, with tests, so this row records the answer rather than a choice. The consequence is that the context bar picker lists one entry per segment of a bent taxiway |
| Q2 | Does hovering pick the grid only while none is picked, or does hovering always pick the nearest one? | A hover picks only while none is picked, the picker changes it afterwards. B hover always picks the object under the cursor | A. The user asked for no automatic switching of a locked anchor. A click cannot pick the grid, because the click places the object |
| Q3 | Does the persistent toggle need a keyboard shortcut? | A context bar buttons only. B a new hotkey | A. No binding is invented in this task |
| Q4 | Do rapid exits carry a grid? They are `Taxiway` records with `kind` `rapidExit` | A every `Taxiway` record gets a grid, per R1. B only `taxiway` and `taxilane` | A, per the wording of R1. The player can ignore them |
| Q5 | Do the runway and taxiway tools snap to the active grid as well as to their own nodes? The commissioning message lists only aprons, stands and rows, GA blocks and the new terminal origin, while `handoff/QUESTIONS.md` (2026-11-06) records that the runway and taxiway tools snap to the grid too and keep their own node snapping | A the two tools stay out, per the list in Numbers above. B they snap to the grid after their node, end and segment steps | A, because the user's latest message wins and the list is explicit. B costs one lower priority step in `taxiSnap` and `snap` and changes nothing else, so it is cheap to add later |
