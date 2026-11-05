# T39: Turn pads sit beyond the runway threshold

Status: done (revision 2: tangent loop curve)
Branch: glm/mvp1

## Requirements

From `handoff/tasks/T39-turn-pad-beyond.md`.

* [x] R1. Shared geometry rework in `src/shared/turnPad.ts`: rectangle beyond the end, teardrop reattached at the end, area and price follow.
* [x] R2. Painter paints the pad beyond the end, no pad edge line gaps, bounds extended.
* [x] R3. Tool, inspector, works, backtrack behavior unchanged.
* [x] R4. Tests first for shared changes; determinism test green.
* [x] R5. Docs: GAME_DESIGN section 6, ARCHITECTURE decision, roadmap note.
* [x] R6. Revision 2: `padCurve` is the reference tangent loop (radius 0.33 of paved width, centre 0.53 of pad length out).
* [x] R7. Revision 2: the curve leaves the threshold along the centerline and returns on a straight diagonal.
* [x] R8. Revision 2: the loop keeps 10 percent of the paved width clear of the lateral and outward edges.
* [x] R9. Revision 2: painter, tool, sim unchanged; docs mention the tangent loop.

## Read first (done)

* [x] `src/shared/turnPad.ts` in full
* [x] `src/sim/ops/traffic.ts`: `updateBacktrack` reads `padSize(rw).extra` only, pivot stays at the runway end, so no sim change
* [x] `src/render/markings/taxiPlan.ts`, `airfieldPaint.ts` pad parts (from T01 work)
* [x] `tests/turnPad.test.ts`
* [x] `airfield_codes.json` turnPad values: C code width 60, length 60 (taper 50 unused by geometry now)

Notes from reading:

* `turnPad.ts` `frame()` currently measures `s` inward from the end into the runway; all coordinates flip by measuring `s` outward (past the end) from the same end point.
* `padSize()` = `{ extra = max(4, TP.widthM[code] - widthM), length = TP.lengthM[code], taper }`. The taper field becomes unused by geometry; remove it from the return and keep the JSON value in place (schema untouched), because no other module reads it (traffic reads `extra` only).
* `updateBacktrack` (traffic.ts 1516): pivots at `rwyS = 0`, swings out `widthM / 2 + extra / 2` on the pad side. With the far edge flush and extra on the pad side, the swing stays inside the new pad (outer edge is `h + extra`). No sim change.
* The plane of the new pad: `s` from -1 (overlap, joins fills) to `length`, `l` from `-(widthM / 2)` (flush with the far edge) to `widthM / 2 + extra` (outer, pad side).
* Curve: circle center `(cs, extra / 2)` with `cs = length / 2`, radius `(2h + extra) / 2 - 3`, tail attach at `(0, 0)`, beziers mirrored top and bottom. Tail control size `cs / 2`.
* `padArea` = `(widthM + extra) * length`; `padValue` code unchanged.
* taxiPlan: drop the pad `runwayBreaks` push (the pad no longer hems the runway edge) and keep `padCurves`; the `padSize` import there can go.
* airfieldPaint: `runwayBounds` gains the pad reach past the end AND the lateral extra; the pad fill loop code keeps working because `padPolygon` returns world points.

## Design

* Why this design: the geometry lives in one file the sim and painter both read; flipping the frame in `frame()` makes every consumer (polygon, curve, area, preview) consistent at once. The sim's pivot behavior needs no change, so the determinism hash of a normal run is unaffected by the geometry itself (it changes only through the painted pixels and the declared distances, neither hashed).
* Revision 2: the turn curve is the two tangents from the threshold point to a circle centred in the pad, plus the major arc between them and the curved start along the centerline. The proportions come from the user's reference diagram, measured on the file kept in the session: loop radius 0.33 of the paved width, loop centre at 0.53 of the pad length on the pad's lateral centre. The old shape used a 3 m margin, so the loop filled the pad and both branches doubled back at the threshold, which is what the user rejected.

## Slices (done)

1. Shared geometry and painter in one commit (R1, R2, R4): the taxiPlan break removal had to land with the geometry because the old test pinned the break.
2. Docs and close out (R5): GAME_DESIGN, ROADMAP note, ARCHITECTURE decision, board, screenshots, scenario.

## Tests

tests/turnPad.test.ts, 9 tests, all green:

* new (revision 2): "the turn curve leaves the runway centerline tangentially and returns on a straight line": first and last points are the threshold point, the first step slope is under 0.06, the second to last step slope is over 0.5.
* new (revision 2): "the loop keeps a clear margin from the pad edges": every curve point is at least 10 percent of the paved width inside the lateral and outward pad edges.
* new: "the pad lies beyond the runway end with the far edge flush and the curve stays on the pad": for end a of a 090 runway, every pad corner has `s` in [-1, length] and `l` in `[-widthM/2, widthM/2 + extra]`, the minimum `l` is exactly `-widthM/2` (flush), and every curve point is inside the pad polygon.
* changed: "the plan carries the turn curve and no pad edge line gap": `runwayBreaks` empty for a padded runway, one `padCurves` entry equal to `padCurve`, same for end b.
* new: "padArea is the runway width plus the extra width times the pad length": extra 30, length 60, area exactly 3600 for a code C runway.
* kept: exact charge and refund equality between sim and `padValue`, determinism (2 000 ticks twice from one seed, identical `stateHash`), backtrack departure reaches Takeoff after Backtrack.

## Visual check (done)

Scenario `handoff/scenarios/T39.json` (runway 09/27 with a pad at each end), shots in `shots/T39-rev2/` (revision 2):

* 1-endA and 2-endB (zoom 3): the pad beyond the piano keys at each threshold, far edge flush with the runway edge, turn curve attached at the threshold on the centerline.
* 3-overview: both pads past both thresholds, nothing overlapping the runway markings.
* 4-endA-zoom and 5-endB-zoom (zoom 6): the curved branch leaves the threshold along the centerline, the loop is round and keeps about 10 m clear of the pad edges (a sixth of the paved width) on all sides, and the straight diagonal returns to the threshold. Measured against the zoom: the loop is about 40 m across in the 60 m paved width, as the tests pin.
* 6-preview: cyan ghost on the opposite side of an existing pad (a paid move, full value, no problem), the ghost curve mirrors correctly with its neck at the threshold.
* 7-preview-red: same end and side as the existing pad shows the red problem preview (padExists) with the same tangent loop shape.

No overlaps, no cut labels; page errors: none.

## Verify

```
=== summary
PASS  rules
PASS  types
PASS  lint
PASS  tests
PASS  stress
verify: all checks passed.
```

Stress: traffic34C mean 0.02381 ms/tick (p99 0.83650, budget 4), terminal640 mean 0.00422 ms/tick (p99 0.03740).

## Report

* What now works, in player terms: a turn pad is an extension of the runway past the end, and its yellow turn curve now follows the reference diagram: a curved branch leaves the threshold along the runway centerline, a round loop set in the pad takes the aircraft round, and a straight diagonal brings it back to the threshold. The loop no longer fills the pavement edge to edge and no longer doubles back into a point at the threshold.
* Commits: b2a027f turn pads: pad beyond the runway threshold; e53274e docs: turn pad geometry beyond the threshold; (revision 2 geometry and docs commits follow).
* Verify summary: all five checks passed (pasted above).
* Screenshots: shots/T39-rev2/T39-1-endA.png, T39-2-endB.png, T39-3-overview.png, T39-4-endA-zoom.png, T39-5-endB-zoom.png, T39-6-preview.png, T39-7-preview-red.png.
* Compared with the reference diagram: the attachment and curvature now match: the marking leaves the threshold along the centerline, the loop is centred in the padding with clear margins, and the return is the straight diagonal. The remaining difference is the pad's proportions, because our code C pad is twice the runway width while the reference diagram's pad is narrower; the loop is therefore deeper into the pad side but the construction is the same.
* Roadmap lines ticked: none (the prefab pieces line stays unticked for rapid exit, parallel taxiway, stand row, GA block; the note mentions the revision).
* Decisions added to docs/ARCHITECTURE.md: the tangent loop proportions and the attachment (revision 2 line), plus the earlier pad beyond the threshold geometry.
* Simplified or left out: `padSize().taper` removed from the return value (unused by the new geometry; the `airfield_codes.json` value stays in the data). The preview on the opposite side of an existing pad shows the full value although the move would refund a share; that is pre T39 behavior and untouched here.
