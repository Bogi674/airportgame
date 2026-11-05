# T39: Turn pads sit beyond the runway threshold

Status: done
Branch: glm/mvp1

## Requirements

From `handoff/tasks/T39-turn-pad-beyond.md`.

* [x] R1. Shared geometry rework in `src/shared/turnPad.ts`: rectangle beyond the end, teardrop reattached at the end, area and price follow.
* [x] R2. Painter paints the pad beyond the end, no pad edge line gaps, bounds extended.
* [x] R3. Tool, inspector, works, backtrack behavior unchanged.
* [x] R4. Tests first for shared changes; determinism test green.
* [x] R5. Docs: GAME_DESIGN section 6, ARCHITECTURE decision, roadmap note.

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

## Slices (done)

1. Shared geometry and painter in one commit (R1, R2, R4): the taxiPlan break removal had to land with the geometry because the old test pinned the break.
2. Docs and close out (R5): GAME_DESIGN, ROADMAP note, ARCHITECTURE decision, board, screenshots, scenario.

## Tests

tests/turnPad.test.ts, 7 tests, all green:

* new: "the pad lies beyond the runway end with the far edge flush and the curve stays on the pad": for end a of a 090 runway, every pad corner has `s` in [-1, length] and `l` in `[-widthM/2, widthM/2 + extra]`, the minimum `l` is exactly `-widthM/2` (flush), and every curve point is inside the pad polygon.
* changed: "the plan carries the turn curve and no pad edge line gap": `runwayBreaks` empty for a padded runway, one `padCurves` entry equal to `padCurve`, same for end b.
* new: "padArea is the runway width plus the extra width times the pad length": extra 30, length 60, area exactly 3600 for a code C runway.
* kept: exact charge and refund equality between sim and `padValue`, determinism (2 000 ticks twice from one seed, identical `stateHash`), backtrack departure reaches Takeoff after Backtrack.

## Visual check (done)

Scenario `handoff/scenarios/T39.json` (runway 09/27 with a pad at each end), shots in `shots/T39/`:

* 1-endA: pad beyond the piano keys at the 09 threshold, extends outward (west) and north, far (south) edge flush with the runway's south edge, teardrop tail meets the centerline at the end, threshold stripe and designator untouched.
* 2-endB: mirrored at the 27 end, pad south, far edge flush with the north edge.
* 3-overview: both pads visible past both thresholds, nothing overlapping the runway markings.
* 4-preview: cyan preview on the opposite side of an existing pad (a paid move, full value, no problem), label with cost and works days.
* 5-endB-zoom (zoom 6): pad width on screen is the expected 60 m of runway width plus extra, 3 m margin between the curve top and the pad's far edge, 1 m overlap seam invisible.
* 6-preview-red: same end and side as the existing pad shows the red problem preview (padExists).

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

Stress: traffic34C mean 0.02719 ms/tick (p99 0.88320, budget 4), terminal640 mean 0.00558 ms/tick (p99 0.04830).

## Report

* What now works, in player terms: a turn pad is now an extension of the runway past the end, like a real turn pad: the player hovers a runway end, the cursor side picks where the pad widens, and the pavement is laid beyond the threshold with the yellow turn loop in it. The price follows the new, larger area and the backtrack to it is unchanged.
* Commits: b2a027f turn pads: pad beyond the runway threshold; (docs and scenario commit follows).
* Verify summary: all five checks passed (pasted above).
* Screenshots: shots/T39/T39-1-endA.png, T39-2-endB.png, T39-3-overview.png, T39-4-preview.png, T39-5-endB-zoom.png, T39-6-preview-red.png.
* Compared with the reference sheet: matches the user's reference diagram of a pad outside the threshold line. No differences found.
* Roadmap lines ticked: none (the prefab pieces line stays unticked for rapid exit, parallel taxiway, stand row, GA block; the note now mentions the revision).
* Decisions added to docs/ARCHITECTURE.md: pad beyond the threshold geometry and the painter consequences (edge line break dropped, bounds from the pad polygon).
* Simplified or left out: `padSize().taper` removed from the return value (unused by the new geometry; the `airfield_codes.json` value stays in the data). The preview on the opposite side of an existing pad shows the full value although the move would refund a share; that is pre T39 behavior and untouched here.
