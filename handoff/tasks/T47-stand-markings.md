# T47. Stand markings per design revision 3

Milestone M5. Source: `docs/DESIGN_REVISION_3.md` section 3, approved by the user on 2026-11-10. The look target is `docs/art/surfaces_stands.png`. Do not reinterpret or improve the sheet.

## Goal

Every stand shows the marking set of the sheet, generated from stand and aircraft data on top of the revision 2 geometry that is already built.

## Read first

* `docs/DESIGN_REVISION_3.md` sections 3 and 6, then `docs/DESIGN_REVISION_2.md` section 3 for the geometry that stays.
* `docs/art/surfaces_stands.png`.
* `docs/ART_AND_ASSETS.md` sections 9 and 12.
* `docs/reference/sprite-prototypes/` and `docs/reference/geometry/` for the marking and funnel code to port.
* `src/data/stand_sizes.json`, `src/data/paint.json` and their schemas.
* `src/render/markings/airfieldPaint.ts`: the stand marking painter and its plan.
* `handoff/PITFALLS.md`.

## Requirements

* R1. Kept from revision 2 and not changed: the lead in fork of two arcs, the stand number box in black on yellow, the four sizes and their dimensions, the red boundary that funnels in to the nose, hydrant fuel pits, the 12 m service road, paint fading with pavement condition.
* R2. Double red restraint line: a solid red line along the funnel boundary plus a dashed red outer line at the stand edge.
* R3. Stop ladder per type: one yellow stop bar per type group across the centerline, with a black box and white type codes on both sides.
* R4. Push limit: a short white bar across the centerline with the white text PUSH LIMIT where the tug stops pushing.
* R5. Fuel pit labels: the red pit square with the small red text FUEL below it.
* R6. Emergency equipment zone: a red hatched triangle in the front corner away from the bridge, with the text EMERGENCY EQUIPMENT ONLY and a fire point symbol.
* R7. Bridge no parking band: a red hatched area under the bridge sweep with the text NO PARKING.
* R8. GSE parking: a white outlined box with white hatching at its base and the text GSE, beside the no parking band.
* R9. Service road: white edge lines, center dashes, lane arrows, a zebra crossing where staff cross to the stand, and a black STOP box with yellow text at the road edge on the stand centerline.
* R10. Remote taxi through stand: lead in and lead out line with an arrow, a marshaller spot, a dashed fuel truck box, a zebra walkway and a bus only bay.
* R11. General aviation apron: painted T marks on asphalt, tie down rings and cones on gravel and grass, stand labels G1, G2 and so on.
* R12. Colors follow the key in section 3. Every dimension lives in data, none in code.
* R13. At low zoom only the lead in line, the boundary and the stand number show, as before.
* R14. MARS stands stay out of scope. They belong to MVP 2 milestone M8.

## Tests

* For every size, no marking polygon intersects an assigned type outline buffered by the clearance of its size, and every text label lies inside its box (revision 3 section 6 item 2).
* The plan is deterministic: the same stand and data give the same plan.
* A Playwright visual test of a Medium contact stand, empty and in use, compared by structure with the sheet.

## Visual check

`npm run shot` of one stand of each kind at about 8 px/m and one row at 1 px/m, side by side with `docs/art/surfaces_stands.png`.

## Open questions

Marking dimensions that neither the sheet, the reference code nor the data files give must be asked in `handoff/QUESTIONS.md`. Do not invent them.
