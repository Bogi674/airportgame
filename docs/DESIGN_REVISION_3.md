# DESIGN REVISION 3: Aircraft look, proportion check, stand markings, stand access types

Status: approved by the user on 2026-11-10.
Authority: this document overrides `docs/DESIGN_REVISION_2.md` section 3.3 and `docs/ART_AND_ASSETS.md` sections 4.6 and 9.2 wherever they disagree. Everything not mentioned here stays as it was. Geometry rules from revision 2 that are already built stay in force: the lead in fork, the four stand sizes, the dimensions in table 3.2 and the funnel search.

## 0. Why this revision exists

The user reviewed the plan on 2026-11-10 and agreed to defer the rest of T02 (runway marking details), T03 (grading) and T07 (photo calibration). The reference sheets below replace the look and proportion targets those tasks would have delivered. The sheets are the acceptance target. Do not reinterpret or improve them.

| Target | Sheet |
| --- | --- |
| Look and proportion of every MVP 1 aircraft | `docs/art/aircraft_mvp_lineup.png` |
| Aircraft detail by zoom band and sprite layers | `docs/art/aircraft_style.png` |
| Stand markings | `docs/art/surfaces_stands.png` |
| Stand with a jet bridge, and the five access types | Section 4 of this document. The user's reference screenshot is not stored in the repo, see 4.5 |

## 1. Aircraft look (sheets `aircraft_mvp_lineup.png` and `aircraft_style.png`)

* Every one of the 10 MVP 1 types must match its panel in `aircraft_mvp_lineup.png` at the default tier: same planform, same engine position and size, same tail, same nose and windscreen shape, same white skin with soft cylinder shading and baked shadow. The sheet shows 14 bases. The four that are not MVP 1 types (747-400, A340-600, A350-900, A330-300) are the target for their later release.
* Underwing engines sit forward of the leading edge with the wing drawn over them. High wing types draw the wing over the fuselage. T tails draw the stabilizer last. Props are drawn edge on as a lateral bar.
* Sprites are baked from vector geometry at the zoom band in use and rotated at draw time. Nothing is a fixed size bitmap. Hard rule 12 applies.
* Layers, composited once per airline and zoom band: 1 shadow (blurred silhouette at a fixed sun offset), 2 base body (shared by every airline flying the type), 3 livery tint (fin, nacelles and winglets in airline colors), 4 composite (what the renderer blits each frame).
* Detail by zoom band:

| Tier | Zoom | Content |
| --- | --- | --- |
| 3 Close up | above 16 px per meter | Tier 2 plus slats, spoilers, nav lights and antennas |
| 2 Default | 4 to 16 px per meter | White skin with cylinder shading, nacelles ahead of the leading edge, six pane windscreen, door outlines, window rows, flap track fairings, baked shadow |
| 1 Simplified | 1 to 4 px per meter | One flat shape plus shadow, no lines |
| 0 Marker | below 1 px per meter | Heading arrow tinted by airline |

* The close up tier must be crisp at maximum zoom. A blurry sprite at the closest zoom fails this section. This is the acceptance rule for the sharpness report recorded as T45 in `handoff/QUESTIONS.md`.

## 2. Proportion check, replaces photo calibration for MVP 1

`docs/ART_AND_ASSETS.md` section 4.6 asked for a licensed top down photo per type. That is no longer required for MVP 1.

* A type is ready for MVP 1 when its sprite geometry passes the data check and its baked sprite matches its panel in `aircraft_mvp_lineup.png` side by side.
* Data check, measured from the sprite geometry and not from pixels: length and span within 1 percent of the published values. Wing root leading edge, engine stations, stabilizer position and nose length within 0.5 m.
* `sprite.calibration` is set to `dimension checked` for a type that passes. `photo calibrated` stays reserved for a type checked against a user supplied image and is not needed for MVP 1.
* This closes open question 7 (licensed calibration photos for the 10 types).

## 3. Stand markings (sheet `surfaces_stands.png`)

The look target for every stand is `surfaces_stands.png`. Revision 2 section 3.3 simplified the contact stand. This section restores the detail the sheet shows, on top of the revision 2 geometry.

Kept from revision 2: the lead in fork of two arcs, the stand number box in black on yellow, the four sizes and their dimensions, the red boundary that funnels in to the nose, hydrant fuel pits, the 12 m service road, paint fading with pavement condition.

Restored or added from the sheet, all generated from stand and aircraft data:

1. **Double red restraint line.** A solid red line following the funnel boundary, plus a dashed red outer line at the stand edge. The dashed wingtip lines dropped in revision 2 item 10 come back as this outer line.
2. **Stop ladder per type.** One yellow stop bar per type group across the centerline, with a black box and white type codes on both sides of the centerline, as on the sheet.
3. **Push limit.** A short white bar across the centerline with the white text PUSH LIMIT, at the point where the tug stops pushing.
4. **Fuel pit labels.** The red pit square with the small red text FUEL below it.
5. **Emergency equipment zone.** A red hatched triangle in the front corner on the side away from the bridge, with the text EMERGENCY EQUIPMENT ONLY and a fire point symbol.
6. **Bridge no parking band.** A red hatched area under the bridge sweep with the text NO PARKING.
7. **GSE parking.** A white outlined box with white hatching at its base and the text GSE, in the front corner beside the no parking band.
8. **Service road.** White edge lines, center dashes, lane arrows, a zebra crossing where staff cross to the stand, and a black STOP box with yellow text at the road edge on the stand centerline.
9. **Remote taxi through stand.** Lead in and lead out line with an arrow, a marshaller spot, a dashed fuel truck box, a zebra walkway and a bus only bay, as on the sheet.
10. **General aviation apron.** Painted T marks on asphalt. Tie down rings and cones on gravel and grass, because paint fails there. Stand labels G1, G2 and so on.

Color key, from the sheet: yellow for aircraft guidance and stop bars, red for restraint lines, hatched no parking and fuel pits, orange for alternate MARS lines, white for roads, crossings, GSE parking and walkways, black boxes for the aircraft type at each stop bar.

MARS stands (one widebody or two narrowbodies, lines 21, 21L and 21R) stay in MVP 2 milestone M8. When they are built they must match the sheet.

At low zoom only the lead in line, the boundary and the stand number show, as before.

## 4. Stand access types and the jet bridge upgrade

A stand's passenger access is a property of the stand that the player can change after building, through the works system. The stand markings follow the access type.

### 4.1 The five access types

| Type | Name | Access | Marking difference |
| --- | --- | --- | --- |
| 1 | Regular | One jet bridge on the left of the nose, to the forward left door | Red hatched bridge zone front left, white hatched staging triangles front right |
| 2 | Mirrored | Same as type 1, mirrored, so two neighbours can share one terminal link | Bridge zone front right, staging front left |
| 3 | Upgraded with two accesses | Two bridges: one to the forward door, one running over the wing to an aft door | Bridge zone widened for the second rotunda |
| 4 | Side load | One bridge reaching the aircraft from a pier beside the stand, not from the terminal face ahead | Bridge zone on the pier side, no service road crossing under the bridge |
| 5 | Bus connection | No bridge. Passengers use stairs and an apron bus | Bridge zone replaced by a stairs position, plus a bus bay marking |

### 4.2 Look of a stand with a jet bridge

* The terminal face, or a pier, is above the service road. The fixed link leaves the building at a gate door, crosses over the service road, and ends at a rotunda inside the red hatched bridge zone. The tunnel runs from the rotunda to the aircraft door and ends in a cab.
* The service road runs between the building and the stand, with white edge lines, center dashes and one arrow per lane.
* White outlined staging triangles with white hatching sit in the front corner opposite the bridge. Ground equipment parks inside them.
* Solid red boundary lines run down both sides of the stand and angle in toward the nose.
* The lead in comes from the taxilane behind the stand, with the stand number sign on the centerline near the taxilane.
* The gate area inside the building, at the head of the fixed link, has its own floor and seating. The bridge connects that gate room to the aircraft door.

### 4.3 Rules

* A stand is built with access type 5 unless a terminal face or pier lies within reach of the fixed link. Reach is a data value.
* Changing the access type is a works job on the stand. The stand is closed for the works duration, and the markings regenerate when the works finish.
* Boarding follows the access type: through the bridge for types 1 to 4, by stairs when the stand has no bridge and lies within walking distance of a gate door, and by apron bus otherwise.
* Door stations for each bridge come from the aircraft data (`doorStations`). A type with no usable aft door refuses the second bridge of type 3 and uses the forward bridge only.
* Revision 2 said only Large and Extra large stands have two bridges. With this revision a Medium stand can be upgraded to type 3 as well.

### 4.4 Open values, not yet given by the user

Do not invent these. Ask, then store them in `src/data/stand_sizes.json` or a new `src/data/stand_access.json` with a zod schema.

* Cost and works days for each access type change.
* Fixed link reach in meters, and the walking distance limit for stairs boarding.
* Whether type 3 and type 4 are available on every stand size.

### 4.5 The reference screenshot

The user supplied a screenshot showing the five types side by side as the target for section 4. It is not committed to this repository, because it appears to come from another published game and this repository is public. Sections 4.1 and 4.2 describe everything the implementer needs from it. If the user confirms the image is theirs to publish, add it as `docs/art/rev3_stand_access_types.png` and reference it here.

## 5. Task impact

| Task | Change |
| --- | --- |
| T05, T06 | Acceptance target is sections 1 of this document and the two aircraft sheets |
| T07 | Replaced by section 2. No photos, no overlay files. The data check and the side by side comparison remain |
| T02 | The runway marking remainder stays deferred. The stand marking part is covered by section 3 |
| T03 | Stays deferred. Nothing in this revision concerns grading |
| New task | Stand markings per section 3 |
| New task | Stand access types, the jet bridge upgrade and the three boarding modes per section 4, after the open values in 4.4 are answered |

The new tasks get ids and spec files in `ROADMAP.md` (tasks T47 and T66).

## 6. Tests

1. Data check of section 2 for all 10 MVP 1 types.
2. Stand marking generator: for every size and access type, no marking polygon intersects an assigned type outline buffered by the clearance of its size, and every text label lies inside its box.
3. Access type change: the works close the stand, the markings regenerate, and undo restores the previous type.
4. Visual tests in Playwright: each of the 10 types at tier 2 against its lineup panel, and a Medium contact stand empty and in use against `surfaces_stands.png`, compared by structure.
5. The determinism test still passes.
