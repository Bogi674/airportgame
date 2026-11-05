# T01. Turn pad drawing and placement tool

Milestone M2. Roadmap line: "Prefab pieces: runway end with turn pad, rapid exit, parallel taxiway with connectors, stand row, GA apron block".

## Goal

The player can place a turn pad at either end of a runway, on either side, see it drawn with its yellow turn curve, see its cost and the works days before clicking, and remove it from the runway inspector. The sim side already works.

## Read first

* `docs/GAME_DESIGN.md` section 6, "Prefab pieces".
* `docs/ART_AND_ASSETS.md` section 8, the "Turn pads" line, and the taxiway centerline width in the "Taxiway" line.
* `src/shared/turnPad.ts` (all of it): `padPolygon`, `padCurve`, `padArea`, `padSize`.
* `src/sim/airfield/airfield.ts`: `turnPad`, `closeForWorks`, `unitCost`.
* `src/shared/surfaceRules.ts`: `unitCost`, `tierOf`, `runwayWorksDays`.
* `src/render/markings/airfieldPaint.ts`: the runway painting function (search `THRESHOLD_STRIPES`) and `lineM`.
* `src/ui/tools/controller.ts`: `previewRapidExit` and `commitRapidExit` (the model for this tool), `show`, `landProblem`.
* `src/ui/BuildMenu.tsx` (runway category), `src/ui/stores/toolStore.ts`, `src/ui/ObjectPanel.tsx` (runway inspector).
* `tests/turnPad.test.ts`.

## Current state

`Runway.pads` holds `{ a?: 'left' | 'right'; b?: 'left' | 'right' }`. The `turnPad` command builds (`side`) or removes (`side: null`) a pad. Departures backtrack to a padded end. Nothing draws the pad and no tool sends the command.

## Requirements

* R1. One shared cost function. Add `padValue(r: Runway): number` to `src/shared/turnPad.ts`: the pad area times the unit cost of the runway's surface and strength tier, rounded. The sim's `turnPad` uses it instead of its own formula. A test shows the sim charges exactly `padValue(r)`.
* R2. Drawing. Every pad is painted with the runway's pavement color, under the runway markings, by the chunk painter. The yellow turn curve (`padCurve`) is painted with the taxiway centerline width from `src/data/paint.json`, with a black outline on concrete like other yellow lines. On the pad side, the white runway edge line is not drawn from the runway end to `length + taper` (from `padSize`), so the curve is never crossed by it.
* R3. Tool. A new tool `turnPad`, as a card in the runway category build tab, with the title "Turn pad". Hovering within 150 m of a runway end previews a pad at that end, on the side of the runway axis where the cursor is (`runwaySide`). The preview shows the pad polygon and the curve, and a label: cost, and "Closes the runway for N days" from `runwayWorksDays(r, { areaM2: padArea(r) })`. Clicking sends `{ type: 'turnPad', runwayId, end, side }`.
* R4. Preview validation uses the same checks as the sim: land (`checkPolygon`), money (`padValue`), and an existing pad on that side (`padExists`). An invalid preview is red and shows the problem text.
* R5. Inspector. The runway inspector lists "Turn pads: 09 left, 27 none" style lines and a "Remove" button per existing pad, which sends `side: null`.
* R6. Strings for every new text in `src/ui/strings/en.json`, including `notice.padExists`.

## Tests

* `tests/turnPad.test.ts`: the sim charges `padValue(r)` when building; removing refunds the refund share of it.
* A Playwright test in `e2e/airfield.spec.ts` is optional; the screenshot check below is required.

## Visual check

Scenario `handoff/scenarios/T01.json`: the example airport plus `turnPad` commands at both ends (one left, one right). Shots:

1. Zoom about 1.5 px/m on end A: pad pavement joins the runway with no gap, the curve leaves the centerline, turns on the pad and rejoins, no white edge line crosses it.
2. The tool preview over end B (use `actions`: tool card click, then `move` near the end): red when on unowned land, cyan or blue when valid, label fully inside the frame and not over the pad.
3. Zoom about 0.3 px/m: the pad is visible and not cluttered.

## Docs

* `docs/UI_DESIGN.md` section 6: a "Turn pad" bullet.
* `docs/ROADMAP.md`: tick the prefab line, removing the T01 note.

## Out of scope

Arrivals backtracking. Pads on taxiways. Blast pads.
