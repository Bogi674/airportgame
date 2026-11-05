# T01: Turn pad drawing and placement tool

Status: planning
Branch: glm/mvp1

## Requirements

* [ ] R1. One shared cost function: `padValue(r: Runway): number` in `src/shared/turnPad.ts` (pad area times the unit cost of the runway's surface and strength tier, rounded). The sim's `turnPad` uses it instead of its own formula. A test shows the sim charges exactly `padValue(r)`.
* [ ] R2. Drawing: every pad is painted with the runway's pavement color, under the runway markings, by the chunk painter. The yellow turn curve (`padCurve`) is painted with the taxiway centerline width from `src/data/paint.json`, with a black outline on concrete like other yellow lines. On the pad side, the white runway edge line stops at the runway end, so it is not drawn from the runway end to `lengthM + taper`.
* [ ] R3. Tool: a new tool `turnPad`, as a card in the runway category build tab, titled "Turn pad". Hovering within 150 m of a runway end previews a pad at that end, on the side of the runway axis where the cursor is (`runwaySide`). The preview shows the pad polygon and the curve, and a label with the cost and the works days from `runwayWorksDays(r, { areaM2: padArea(r) })`. Clicking sends `{ type: 'turnPad', runwayId, end, side }`.
* [ ] R4. Preview validation uses the same checks as the sim: land (`checkPolygon`), money (`padValue`) and an existing pad on that side (`padExists`). An invalid preview is red and shows the problem text.
* [ ] R5. Inspector: the runway inspector lists the pad at each end (designator plus side or none) and a Remove button per existing pad, which sends `side: null`.
* [ ] R6. Strings for every new text in `src/ui/strings/en.json`, including `notice.padExists`.

## Read first (done)

* [x] `docs/GAME_DESIGN.md` section 6 (Prefab pieces) and the full doc
* [x] `docs/ART_AND_ASSETS.md` section 8 (Turn pads: yellow centerline curves) and the full doc
* [x] `src/shared/turnPad.ts` (all of it)
* [x] `src/sim/airfield/airfield.ts` (`turnPad` at line 769, `closeForWorks` at line 677, `unitCost` at line 801)
* [x] `src/shared/surfaceRules.ts` (`unitCost` line 27, `runwayWorksDays` line 60)
* [x] `src/render/markings/airfieldPaint.ts` (`paintRunwayPavement` line 364, `paintRunwayMarks` line 413 with the `runwayBreaks` edge line gaps, `lineM` line 37)
* [x] `src/render/markings/taxiPlan.ts` (the `runwayBreaks` map, lines 72 and 419, breaks as `[s0, s1, side]` in runway local meters)
* [x] `src/ui/tools/controller.ts` (`previewRapidExit` line 1041, `commitRapidExit` line 1063, `show` line 366, `landProblem` line 350)
* [x] `src/ui/BuildMenu.tsx`, `src/ui/stores/toolStore.ts`, `src/ui/ObjectPanel.tsx`
* [x] `tests/turnPad.test.ts`
* [x] `handoff/PITFALLS.md`, `handoff/RECIPES.md`, `handoff/CODEBASE.md`
* [x] `src/shared/ghost.ts` (shapes the preview can use)

Notes from reading:

* `Airfield.turnPad` (airfield.ts 769) already does: find runway, end a or b, `value = Math.round(padArea(r) * this.unitCost(r))`, remove with refund `Math.round(value * REFUND_SHARE)`, refuse `padExists` when `r.pads?.[end] === side`, `checkPolygon(padPolygon(...))`, funds check, `closeForWorks(r, { ...r }, { areaM2: padArea(r) }, env)`, set `r.pads[end] = side`, `refresh()`. Only the cost formula moves to shared.
* `Airfield.unitCost` (801) is exactly `SURFACE_SPEC[r.surface].costPerM2 * tierFactor(surface, tierIndexOf(pcr))`. I will move this logic to shared as `runwayUnitCost(r)` in `surfaceRules.ts` and make both `padValue` and the two call sites in airfield.ts (lines 819 and 889 also use it) use it, so there is one source. Numbers do not change.
* The edge line in `paintRunwayMarks` already suppresses segments through `runwayBreaks` entries `[s0, s1, side]` in runway local meters, `side` in {-1, 1}. A pad break is the same list: from 0 (end a) or `lengthM` to `lengthM - (length + taper)` (end b) on the pad's local side. The mapping between `PadSide` ('left' | 'right') and the local `side` sign comes from the runway heading: in the local frame after the rotation used by the painter, left of the heading is local y = -1 for every heading (verified with the painter's threshold symmetry and the turnPad test: heading 090, left, pad at smaller y, local side -1). I will compute it from `compassVector` the way `frame()` in turnPad.ts does, not hard code a table.
* The chunk painter regenerates when the airfield version changes. `turnPad` calls `refresh()`, so the pad paint appears without an extra version counter. Pitfall 1 does not apply: pads are not derived data and `setAirfield` rebuild behavior is already the existing behavior for every airfield edit.
* Ghost preview: `poly` for the pad (valid and invalid both show the shape, `valid` false tints it red and the problem text shows through `show(g, problem, hint)`). The curve fits `strip` with the taxiway centerline width (0.15 m from `PAINT.taxiway.centerlineWidthM`).
* Cash for the preview money check comes from `useGameStore.getState().business.cash` (gameStore.ts line 23).
* `Test` component: `r.pads` type is `{ a?: PadSide; b?: PadSide }` in `src/shared/airfield.ts`.

## Design

* Data added: none. The curve width is already in `src/data/paint.json` (`taxiway.centerlineWidthM`); no new JSON keys are needed.
* Types added or changed: `Tool` in `src/ui/stores/toolStore.ts` gains `'turnPad'`. No saved shape changes.
* Functions added or changed:
  * `src/shared/surfaceRules.ts`: new `runwayUnitCost(r: Pick<Runway, 'surface' | 'pcr'>): number`, the existing per-square-meter cost of a runway at its current strength tier.
  * `src/shared/turnPad.ts`: new `padValue(r: Runway): number`, `Math.round(padArea(r) * runwayUnitCost(r))`.
  * `src/sim/airfield/airfield.ts`: `unitCost(r)` deleted, its three call sites (turnPad 773, resizeRunway 819, reclassRunway 889) use `runwayUnitCost`; `turnPad` builds `value` with `padValue(r)` so one function owns it. Undo stacks unchanged (`Op.cashDelta` keeps working).
  * `src/render/markings/airfieldPaint.ts`: `paintRunwayPavement` also fills `padPolygon` in runway pavement color for each pad of the runway (world coordinates, no extra transform), under the markings. `paintRunwayMarks` unchanged: the edge line stops because `taxiPlan` now emits the break.
  * `src/render/markings/taxiPlan.ts` `planFor`: for each runway pad, push the edge break `[0, length + taper, sign]` (end a) or `[lengthM - (length + taper), lengthM, sign]` (end b) into `plan.runwayBreaks`. After the curve: the yellow curve is painted as lines in `airfieldPaint.ts` (built here into the plan? see below).
  * The curve: geometry from `padCurve(r, end, side)` converted to a `Line`-compatible polyline with `padCurveWidthM = PAINT.taxiway.centerlineWidthM`, painted with `strokeLines` in `paintRunwayMarks` (after pavement, before the white paint? spec says under the runway markings, so paint the curve in the same pass ordering as `paintTaxiPlan`, that is after pavement fill and before runway white paint; on concrete the outline comes free from `strokeLines` when `outlined` is set). The line is emitted from `taxiPlan.ts` (which already imports `padSize` is false: it does not, so `padCurve` is imported there) into a new plan array `padCurves` with per line bounds for the `overlaps` win check and `outlined` true on concrete.
  * `src/ui/tools/controller.ts`: new `previewTurnPad(p)` (called from `move` for tool 'turnPad') and `commitTurnPad(p)` (from `up`). Preview: nearest runway end within 150 m (hard constant `TURN_PAD`, see below), end 'a' or 'b', side from `runwaySide(r, p.x, p.y)`, shapes pad polygon plus curve strip, valid from land (`landProblem({ polygon: pad })`), `padExists` when `r.pads?.[end] === side`, money when `padValue(r) > cash`. Label: cost plus works days via `runwayWorksDays(r, { areaM2: padArea(r) })` in the existing `inspector.runwayWorksPreview` string.
  * `src/ui/BuildMenu.tsx`: a card in the runway category build tab: `{ id: 'turnPad', run: (s) => s.set({ tool: 'turnPad' }), active: (s) => s.tool === 'turnPad' }`. Thumb: reuse the existing `rapidExit` thumb kind if a turn pad thumb would need a new drawing; check `thumbs.tsx` at coding time and prefer reuse to keep the slice small.
  * Recipe used: R7 (add a build tool, rapid exit as the model), R1 ideas for the new problem text, R8 rule 3 for the widths (`lineM` was renamed to the `Line`/plan path).
* Save format change: none. Pads and works are already saved and hashed.
* Why this design and not the obvious alternative: putting `padValue` next to `padArea` in `turnPad.ts` with `runwayUnitCost` in `surfaceRules.ts` keeps every gameplay number in one chain (data to `surfaceRules` to shared cost to sim) and the sim no longer owns its own copy of the formula, which is what R1 asks. Painting through the plan (taxiPlan emits the curve line and the edge break) is the existing pattern for anything baked (PITFALLS 14), so chunks regenerate on the existing version bump and the curve is never drawn over the white markings by accident.

## Slices

1. **Shared cost** (R1): `runwayUnitCost` + `padValue`, sim uses them, tests. Files: `src/shared/surfaceRules.ts`, `src/shared/turnPad.ts`, `src/sim/airfield/airfield.ts`, `tests/turnPad.test.ts`. Commit: `turn pads: one shared cost for a pad`.
2. **Chunk painting** (R2): pad pavement, curve lines in the plan, edge line break. Files: `src/render/markings/taxiPlan.ts`, `src/render/markings/airfieldPaint.ts`. Commit: `turn pads: pad pavement and turn curve painted`.
3. **Tool** (R3, R4, R6): tool id, build menu card, controller preview and commit, strings including `notice.padExists`, hint. Files: `src/ui/stores/toolStore.ts`, `src/ui/BuildMenu.tsx`, `src/ui/tools/controller.ts`, `src/ui/strings/en.json`. Commit: `turn pads: placement tool with cost and works preview`.
4. **Inspector** (R5): pad lines and Remove buttons in the runway inspector. Files: `src/ui/ObjectPanel.tsx`, `src/ui/strings/en.json`. Commit: `turn pads: show and remove them from the runway inspector`.
5. **Docs and close out**: screenshots, work file report, roadmap tick, decisions line, board update. Commit: `docs: turn pad tool recorded`.

## Tests

* `tests/turnPad.test.ts`:
  * existing geometry test unchanged;
  * new: "building a pad charges exactly padValue": fresh runway, `value = padValue(r)`, cash drops exactly `value` after the command succeeds;
  * new: "removing a pad refunds a quarter of padValue": cash rises exactly `Math.round(padValue * 0.25)`;
  * existing `padExists` case stays;
  * new determinism: two sims from one seed, `buildTestAirport`, one `turnPad` command, 2 000 ticks, identical `stateHash()` (R9 pattern).
* No new usually-failing feature besides the cost function, so slice 2 to 4 are covered by verify plus the screenshot check (render and UI have no vitest surface in this repo beyond what exists).

## Visual check

* Scenario: `handoff/scenarios/T01.json` from `example-airport.json` plus `turnPad` commands at both ends (A left, B right) before the camera and actions.
* Shot 1 (zoom about 1.5 px/m at end A): pad pavement joins the runway with no gap, the yellow curve leaves the centerline, turns on the pad and rejoins, the white edge line does not cross it.
* Shot 2 (tool at end B without a command, via tool card click and `move`): valid preview cyan or blue with cost and days label fully inside the frame, and a red preview over unowned land in a second pass.
* Shot 3 (zoom about 0.3 px/m): the pad is visible and not cluttered.
* Reference: `docs/ART_AND_ASSETS.md` section 8 turn pads line (yellow centerline curves, taxiway centerline width, black outline on concrete) against the rev2 runway art sheets in `docs/art/` (picked at shot time).

## Open questions

None. (R4's money check reads cash from the game store, confirmed present.)

## Verify

(to be pasted after `npm run verify`)

## Report

(to be filled from `handoff/templates/REPORT.md` when done)
