# T39: Turn pads sit beyond the runway threshold

Status: coding
Branch: glm/mvp1

## Requirements

From `handoff/tasks/T39-turn-pad-beyond.md`.

* [ ] R1. Shared geometry rework in `src/shared/turnPad.ts`: rectangle beyond the end, teardrop reattached at the end, area and price follow.
* [ ] R2. Painter paints the pad beyond the end, no pad edge line gaps, bounds extended.
* [ ] R3. Tool, inspector, works, backtrack behavior unchanged.
* [ ] R4. Tests first for shared changes; determinism test green.
* [ ] R5. Docs: GAME_DESIGN section 6, ARCHITECTURE decision, roadmap note.

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

## Slices

1. Shared geometry (R1, R4): `turnPad.ts` + tests. Failing tests first: area exact (30+30) * 60 = 3600 for a C runway, no pad corner inside the runway strip beyond the 1 m overlap, curve points inside the pad polygon.
2. Painter (R2): `taxiPlan.ts` breaks removal, `airfieldPaint.ts` bounds. Visual check via shots.
3. Docs and close out (R5): GAME_DESIGN, ROADMAP note, ARCHITECTURE decision, board, screenshots.

## Tests

* tests/turnPad.test.ts:
  * new: "the pad lies beyond the runway end": for end a, every pad corner s <= length and the polygon covers the centerline end point, and it does not extend beyond `padSize.length - 1` outside the end; far edge flush: min l == -(widthM/2).
  * changed: "the curve stays on the pad pavement": all curve points inside `padPolygon` (the old runway-or-pad union drops because the curve no longer sweeps inside the runway).
  * kept: exact charge/refund `{...}` (value recomputed from the new area by both sides of the equality), determinism (2 000 ticks twice, same hash), backtrack flight (state machine untouched).

## Visual check

* Scenario: `handoff/scenarios/T39.json`, same example airport, both pads, shots at end A and end B zoom 2, plus the tool preview. Must show: pad beyond the threshold piano keys, curve teardrop in the pad meeting the centerline at the end, threshold and designator untouched at the runway end.

## Open questions

None: the two design points were answered by the user (side extra, sharp rectangle).
