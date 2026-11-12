# DESIGN REVISION 2: Stands, taxiways, apron tool, terminal size

Status: approved by the user for implementation on 2026-11-04.
Authority: this document overrides `GAME_DESIGN.md` sections 6 (taxiway tool, code table, apron, stands) and `ART_AND_ASSETS.md` sections 8, 9 and 10 wherever they disagree. Everything not mentioned here stays as it was.

## 0. How to execute this document

1. Treat the seven reference images in `docs/art/rev2_*.png` as the acceptance target. The in game result must look like them: same line layout, same proportions, same colors. Do not reinterpret or "improve" the design.
2. The Python files in `docs/reference/geometry/` are the normative geometry. Port them to TypeScript in `src/render/markings/` and `src/sim/airfield/pavement/`. Port the math exactly (fillets, fork arcs, funnel search). They are not shipped. Hard rule 12 and the existing Python prototype policy apply.
3. Work in the order of section 9. After each step, produce a screenshot of the in game result next to the matching reference image and show it to the user.
4. Sim state stores geometry and settings in meters. Paint is a render concern. Every value in the tables below goes into data JSON (`src/data/airfield_codes.json`, `src/data/stand_sizes.json`, `src/data/surfaces.json`) validated by zod. No magic numbers in code.
5. Never use em dashes or a spaced hyphen as a sentence connector in code, UI text or commits (hard rule 15).
6. If something here conflicts with a hard rule in `CLAUDE.md`, stop and ask the user one focused question.

Open items with defaults chosen (the user did not answer yet, implement the default and keep it a data value):

| Item | Default | Where it lives |
| --- | --- | --- |
| Extra large stand width for An 225 (span 88.4 m) | Stand stays 95 m wide. The An 225 uses a special double stand: two adjacent XL stands merged by the player with one ERA | `stand_sizes.json`, `mergeable: true` on XL |
| Fork radius | Equals stand to taxilane clearance of the size (table 3.2), not player adjustable | `stand_sizes.json` |

## 1. Stand push back and lead in marking (image `rev2_01_pushback_fork.png`)

Replaces the old lead in. The old design ran the stand centerline straight across the taxilane and curved back. That is removed everywhere.

Geometry, in stand local meters with x across the stand and y away from the taxilane centerline (y = 0):

* The taxilane centerline is the line y = 0.
* The stand centerline runs from the stop bar down to the fork point F = (0, D), where D is the fork radius from table 3.2.
* Two quarter circle arcs of radius D leave F and join the taxilane centerline tangentially:
  * left arc: center (-D, D), from angle 0 to -90 degrees, ends at (-D, 0)
  * right arc: center (+D, D), from angle 180 to 270 degrees, ends at (+D, 0)
* Nothing crosses y = 0 and no line goes beyond F toward the taxilane except these two arcs.
* Adjacent stands whose forks overlap share one arc where they meet. Compute the union of lead in curves per taxilane and draw each curve once.
* Stand number box (yellow, black text) sits on the stand centerline at y = 0.35 D, between the two arcs.
* Push back: the aircraft is pushed tail first along the chosen arc (left, right or straight back is not allowed on a forked stand, choose left or right) onto the taxilane centerline, stops, then taxis forward. The push back path is the centerline of that arc extended 28 m along the taxilane. The sim reserves the arc and that 28 m of taxilane before starting.
* On concrete the yellow line gets a 1.1 px black outline each side so it stays visible. On asphalt no outline.

## 2. Taxiway pavement, junctions and markings (images `rev2_02`, `rev2_03`, `rev2_06`)

### 2.1 One node model, one pavement shape

* A taxiway network node has N arms (N >= 2). Pavement at a node is generated, never hand drawn.
* N = 2 is a bend: one continuous curve of centerline radius `turnRadius` (table 2.3) between the two arms, parallel edges. If the angle between arms is within 1 degree of straight, no curve.
* N >= 3 is a junction. For each pair of neighboring arms with an angle less than 170 degrees between them (taken CCW):
  1. Build the fillet curve between the two arm centerlines with centerline radius `turnRadius` (function `fillet(node, a, b, 0, rc)` in `netdraw.py`).
  2. Pavement = union of: node disc of radius half width, every arm strip (flat caps, half width each side), every fillet curve buffered by half width, and the polygon (node + fillet points).
* Arms that are about opposite (within 10 degrees of 180) keep a straight through centerline across the node. A stem arm without an opposite arm starts its centerline at the fork distance (the smallest tangent distance of its fillets) and forks into its curves, the same logic as the stand fork.
* Shoulders: for paved surfaces, buffer the pavement by `shoulderWidth` and draw it as a second, slightly lighter paved layer under the main pavement.
* Edge fillet inner radius is always `turnRadius - halfWidth`. This is the reason the junction now looks tight (see 2.3).

### 2.2 Snapping and junction merge (image `rev2_03_snapping.png`)

This replaces the old taxiway builder. The tool is a single polyline tool. No separate "branch", "junction" or "section" tools.

While the taxiway tool is active, show every node as a small circle and test the cursor against targets in this priority order:

| Priority | Target | Ring | Result on click |
| --- | --- | --- | --- |
| 1 | Existing node (junction or end) within 15 m | cyan ring plus dot | the new arm joins that node. A T becomes a 4 way, a 4 way becomes 5 way. No new node |
| 2 | Open end of a taxiway within 15 m | cyan square | continue that taxiway. The two pieces become one segment |
| 3 | Point on the middle of any segment within 15 m (projected) | cyan diamond | the segment splits at that point and a new junction node is created there |
| 4 | Angle guides | dotted rays | every 15 degrees, plus parallel and perpendicular to nearby taxiways and runways |

Rules:

* Hold Alt: no snapping at all. Hold Shift: force 15 degree steps.
* Invariant: no two nodes may be closer than 15 m. Creating or moving a node closer than 15 m to another merges them. Test this with a property test (random edits, then assert the invariant and that every pavement shape is a valid polygon).
* Whenever a node's arm set changes, regenerate only that node's pavement and markings and those of its adjacent segments.
* The ghost preview shows the new arm in cyan at 30 percent opacity and a tooltip "Snap to J1" (or "Split segment", "Continue taxiway") next to the cursor. Tooltips use the existing UI tokens.
* Undo and redo must restore the previous arm set exactly.

### 2.3 Dimensions (replaces the fillet inner radius column in `GAME_DESIGN.md`)

All in meters. Goes into `src/data/airfield_codes.json`.

| Code | Taxiway width | Centerline turn radius | Inner edge radius (turn radius minus half width) | Shoulder width each side |
| --- | --- | --- | --- | --- |
| A | 7.5 | 13 | 9.25 | 0 |
| B | 10.5 | 18 | 12.75 | 0 |
| C | 15 | 25 | 17.5 | 5 |
| D | 18 | 30 | 21 | 5.5 |
| E | 23 | 38 | 26.5 | 5.5 |
| F | 25 | 42 | 29.5 | 7.5 |

Separation columns in the old table are unchanged. The old centerline radius of 40 m for code C is wrong and is removed.

### 2.4 Markings (follow ICAO Annex 14 chapter 5 and FAA AC 150/5340-1)

Paved taxiways (asphalt, concrete):

* Centerline: continuous yellow, 0.15 m real width drawn at minimum 1.6 px, continuous through junctions along turn curves, tangent to the arms.
* Edge markings: double continuous yellow line (two lines 0.15 m wide, 0.15 m gap) at the full strength pavement edge, inset 0.25 m and 0.95 m in the reference geometry. Follows the fillets.
* Shoulder stripes: yellow transverse stripes 0.9 m long across the shoulder on the junction fillets, every 7 m (`junction2` in `fig6.py`). Not on straight sections.
* Location and direction signs: yellow on black location box and black on yellow direction boxes, placed 2 m beside the taxiway edge, 40 m before each junction on the approach side. Letters from the taxiway name.
* Runway holding position markings (pattern A) and intermediate holding positions are unchanged from `ART_AND_ASSETS.md` section 8.
* On concrete, every yellow line gets the black outline described in section 1.

Unpaved taxiways (grass, dirt, gravel): no paint. Yellow edge markers (5 px squares with dark outline) every 15 m along both pavement edges, as in `rev2_06` surface row.

### 2.5 Taxiway surfaces

New option in the taxiway tool context bar and in the taxiway properties panel. Same mechanic as stands.

| Surface | Allowed codes | Paint | Look |
| --- | --- | --- | --- |
| Grass | A, B, C | markers only | `#86ad5a` |
| Dirt | A, B, C | markers only | `#8a6c4c` |
| Gravel | A, B, C | markers only | `#9b968c` |
| Asphalt | A to F | full paint | `#4b4c52`, shoulders `#5e5f66` |
| Concrete | A to F | full paint plus black line outline | `#a9a7a2`, shoulders `#8e8c87`, 5 m slab joints |

* Choose the surface when building. Default Asphalt.
* After building, select a taxiway segment, pick another surface and press Apply. That is an upgrade (towards concrete) or downgrade (towards grass). Uses the same works system as stands and runways.
* Upgrade: cost per square meter from `surfaces.json`, works duration in game days, the segment is closed during works, markings regenerate when done. Sample numbers from the reference UI: 420 m code C segment, asphalt to concrete, 1.9 M cost, 21 days. These are tunable data, not rules.
* Downgrade: refunds a share of the value (`refundShare`, default 0.25). Downgrading below what an assigned aircraft type permits shows a validation message and is blocked, with the offending type named.
* Each aircraft type already has a surface list. Routing treats a segment as closed to a type whose list does not include the segment surface.
* Codes D to F cannot select unpaved surfaces. Raising a segment's code above C while it is unpaved forces a surface change in the same action.

## 3. Aircraft stands (images `rev2_04`, `rev2_05`)

### 3.1 Four sizes replace all previous stand options

| Size | Code | Wingspan range | Examples | Surfaces |
| --- | --- | --- | --- | --- |
| Small | A, B | up to 24 m | Cessna 172, King Air, PC 12, Learjet, Citation, Twin Otter | grass, dirt, gravel, asphalt, concrete |
| Medium | C | over 24 m up to 36 m | A320 family, 737, E195, ATR 72, Dash 8 | grass, dirt, gravel, asphalt, concrete |
| Large | D, E | over 36 m up to 65 m | 777, 787, A350, A330, 767, 757 | asphalt, concrete |
| Extra large | F | over 65 m up to 80 m | 747, A380, An 124, 777X with wingtips out | asphalt, concrete |

* Assignment uses wingspan (folded span when the folding wingtip rule is on). A type that exceeds XL (An 225) needs the merged double stand from section 0.
* Unpaved Medium stands only accept types whose surface list includes that surface (for example ATR 72 and Dash 8 yes, A320 no). Show the reason on the stand and in the assignment dialog.
* Surface can be upgraded or downgraded after building, same works system as taxiways. Large and XL can never be downgraded to unpaved.

### 3.2 Stand dimensions (goes into `src/data/stand_sizes.json`)

| Size | Width W | Depth | Fork radius D | Wingtip clearance | Nose clearance NC |
| --- | --- | --- | --- | --- | --- |
| Small | 30 | 24 | 16.5 | 3.0 | n/a |
| Medium | 45 | 52 | 24.5 | 4.5 | 6.0 |
| Large | 80 | 88 | 42.5 | 7.5 | 6.0 |
| Extra large | 95 | 94 | 50.5 | 7.5 | 6.0 |

Width = largest assigned wingspan plus 2 times wingtip clearance, rounded. Depth covers the longest assigned type plus nose clearance and tail clearance.

### 3.3 Contact stand markings for Medium, Large and XL (image `rev2_05`)

The old red diamond equipment restraint outline is removed. Replace it with this layout, all drawn from stand data:

1. **Stand safety line**: solid red line, 2.4 px, across the stand at y = D (the taxilane side edge), extending past the stand boundary to the neighbors.
2. **Stand boundary**: solid red line on each side. From y = D up to the funnel start ys at x = plus or minus W/2, then a diagonal inward to the nose point (plus or minus n, yn), then straight to the top edge at x = plus or minus n.
   * `n = fuselageWidth / 2 + 4.5` of the largest assigned type
   * `yn = standTop - 5`
   * `ys`: start at D + 2 and increase by 0.5 m until each front corner polygon `(W/2, ys), (n, yn), (n, top), (W/2, top)` and its mirror no longer intersects the union of all assigned type outlines buffered by 3 m. This keeps both corners clear of every assigned type. See `fig5.py`.
   * Boundaries of adjacent stands extend 12 m past the stand at the diagonal so two stands read as one connected apron.
3. **Front left corner**: red hatched jet bridge zone (45 degree red hatch, 1.6 px red outline). Contains the bridge rotunda and the fixed link. Marked no parking.
4. **Front right corner**: white hatched equipment staging area (45 degree white hatch, 1.6 px white outline).
5. **Service road**: 12 m wide, directly above the stand top, white edge lines, center dashes, one arrow per lane (flow left to right on the far lane, right to left on the near lane), arrows placed at x = 0.3 W away from the jet bridges. The terminal facade is above it.
6. **Jet bridges**: fixed link from the service road edge to a rotunda inside the red hatched zone, then a tunnel to the door with a cab (3.5 m by 4 m). Door stations come from the aircraft data (`doorStations`). Large and XL have two bridges. XL gets the second as the upper deck bridge. Draw rotundas as gray circles radius 2.6 m.
7. **Stop lines**: one yellow bar across the stand centerline per type group, from x = -1.5 to fuselage half width + 1 m, with a black box and white text of the type name to the right. Spacing between bars: 3.5 m Medium, 5 m Large and XL. First bar position `y = top - NC - noseGap(type0)`.
8. **Lead in**: the fork of section 1 plus stand number box.
9. **Hydrant fuel pits** (Large, XL): red square outline 2.2 m with a red diagonal, under each wing at the type's fuel coupling position. Medium stands refuel by truck, no pits.
10. **Red dashed wingtip lines are dropped** on contact stands because the stand boundary already marks clearance. They stay on Small stands.
11. Everything fades with pavement condition as before.

At low zoom only the lead in line, stand boundary and stand number show.

### 3.4 Small stand markings (image `rev2_04`, panel Small)

Paved (asphalt or concrete): yellow lead in fork, stand number, one yellow stop mark with label GA, red dashed wingtip clearance lines at plus or minus W/2 from y = D to the top, white tie down rings (circle 2 m diameter, 2 px white stroke) at both wing positions and the tail. No restraint area, no jet bridge, no hydrant.

Unpaved (grass, dirt, gravel): no paint. Orange and white cones along the lead in every 6 m, stand signboard, tie down rings, white edge markers at the corners (existing rule in `ART_AND_ASSETS.md` 9.2).

### 3.5 Remote stands

Remote stands use the same four sizes and the same fork lead in. They omit the jet bridge zone, the service road and the bridges. They keep the staging area and add a passenger bus bay marking.

## 4. Apron tool (image `rev2_07_apron_modes_terminal.png`)

Two modes in one tool, switch with the A hotkey or the two buttons in the context bar. Both produce the same apron object (a polygon with holes).

* **Free polygon** (current behavior): click to add corners, double click or Enter to close. Shift snaps corners to 15 degree steps relative to the nearest alignment frame. Live edge lengths and area in square meters.
* **Rectangle**: drag from corner to corner. The rectangle aligns to the nearest alignment frame (runway frame by default) and snaps its edges to existing apron edges, taxiway edges and terminal facades. Live width, height and area.
* Overlapping or touching pieces of the same surface merge into one apron (polygon union). Each apron has a name, area and surface.
* Ctrl drag a rectangle (or Ctrl click a polygon) cuts a piece out of the selected apron (polygon difference).
* Surface is chosen in the context bar, default concrete, and can be upgraded or downgraded later like stands.
* Undo and redo cover every piece.
* Use `polygon-clipping` or an equivalent only after asking the user, since the runtime dependency list is fixed (`preact`, `zustand`, `zod`). If not approved, implement orthogonal rectilinear union and general polygon union in `src/shared/geom`.

## 5. Terminal size (image `rev2_07`, bottom panel)

* Remove the 300 square meter terminal limit. It is not in the design docs, so search the code for it (`grep -rn "300"` in `src/sim/terminal`, `src/ui` and tool code, and for any area clamp on the terminal footprint) and delete it. Add a test that builds a 640 by 120 m terminal and passes.
* Allowed footprint is limited only by owned land, budget, building clearances to runways, taxiways and aprons, and the world size.
* The terminal footprint is built from rectangles that merge, exactly like the apron, and can be extended or shrunk later. Interior grid stays 2 m cells.
* Storage: the interior grid is stored in 64 m by 64 m chunks that are allocated only when touched. The walking graph rebuilds only affected chunks. This keeps large terminals within `docs/PERFORMANCE.md` budgets. Add a stress scenario with a 640 by 120 m terminal and report the numbers.

## 6. Data files

Create or update:

* `src/data/airfield_codes.json`: table 2.3 plus the existing separation columns.
* `src/data/stand_sizes.json`: sizes, code ranges, allowed surfaces, W, depth, fork radius, wingtip clearance, nose clearance, `mergeable`.
* `src/data/surfaces.json`: per surface `allowedCodes`, `paint` (`full` or `markers`), colors, `costPerM2`, `worksDaysPerKm2`, `refundShare`, `unpavedMarkerSpacingM`.
* zod schemas in `src/data/schemas`. A load test fails on any missing field.

## 7. Tests (all must pass)

1. Fork geometry: for each size, arcs end at (plus or minus D, 0) with tangent direction along the taxilane, and no stand line has y < 0.
2. Junction geometry: for N = 3, 4, 5 arms at random angles, the pavement is a single valid polygon, every arm centerline is tangent to its fillets (angle error under 0.5 degrees), and the inner edge radius equals `turnRadius - halfWidth` within 0.05 m.
3. Snapping: random edit sequences never leave two nodes closer than 15 m. Drawing a second arm onto a T node yields a 4 way node (arm count 4, node count unchanged). Segment snap splits the segment once. Undo restores the original arm set.
4. Funnel search: for each assigned type set, both front corner polygons are at least 3 m from every type outline.
5. Surface rules: Large and XL reject unpaved surfaces, codes D to F reject unpaved taxiways, a downgrade that excludes an assigned type is blocked.
6. Apron: union, difference and rectangle snapping produce valid polygons and correct areas (areas in the reference image: 15,342 m2 polygon, 6,300 m2 rectangle, 13,900 m2 merged).
7. Terminal: 640 by 120 m builds and the stress scenario holds the budget.
8. Determinism test still passes (2 000 ticks twice).
9. Visual tests (Playwright): render each reference scene (the six panels listed below) in the dev build and compare to the reference images by structure (line positions within 2 px at the same scale, colors within the palette). Store diffs under `e2e/__screenshots__`.

Reference scenes to reproduce in game for the visual test: pushback fork (3 medium stands), the four junction types, the snapping sequence J1 T to 4 way, Small, Medium, Large and XL stands, taxiway radius comparison with surfaces row, apron modes.

## 8. Palette used by the reference images

Yellow `#f2c230`, red `#e0414a`, white `#f4f4f4`, asphalt `#4b4c52`, shoulder asphalt `#5e5f66`, concrete `#a9a7a2`, grass `#6c9146` with 6 m stripes `#679041`, snapping cyan `#3cc8ea`, jet bridge `#cfd4da`, rotunda `#9aa3ae`. Use the existing UI tokens for panels and text, not the reference sheet backgrounds.

## 9. Implementation order

1. Data files and schemas (section 6). Load tests.
2. Pavement generator: bends, junctions, shoulders (2.1, 2.3). Visual test against `rev2_02` and the proposed panel of `rev2_06`.
3. Taxiway markings (2.4) and surfaces with upgrade and downgrade (2.5).
4. Snapping tool and node merge, undo and redo (2.2). Visual test against `rev2_03`.
5. Stand lead in fork and push back path (section 1). Visual test against `rev2_01`.
6. Stand sizes, surface rules, assignment (3.1, 3.2).
7. Contact stand marking generator (3.3), Small stand marking (3.4), remote stands (3.5). Visual test against `rev2_04` and `rev2_05`.
8. Apron tool modes (section 4).
9. Terminal limit removal and chunked grid (section 5).
10. Update `docs/GAME_DESIGN.md`, `docs/ART_AND_ASSETS.md`, `docs/UI_DESIGN.md`, `docs/ARCHITECTURE.md` and `ROADMAP.md` so they match this document, and record decisions under Decisions in `ARCHITECTURE.md`.

After each step show the user an in game screenshot next to the reference image and wait for the user's confirmation before the next step when the screenshot differs in any visible way.

## 10. Reference sheet index

| File | Shows |
| --- | --- |
| `docs/art/rev2_01_pushback_fork.png` | Old versus new stand lead in and push back |
| `docs/art/rev2_02_junction_geometry.png` | Bend, T, 4 way and angled junction pavement and centerlines (older radius, geometry still valid, use radii from table 2.3) |
| `docs/art/rev2_03_snapping.png` | Snap to existing junction, T becomes 4 way, snap targets |
| `docs/art/rev2_04_stand_sizes_and_small_ga.png` | First round stand sizes and the Small GA stand (the Small panel is final, Medium to XL panels are superseded by `rev2_05`) |
| `docs/art/rev2_05_contact_stands_medium_to_xl.png` | Final Medium, Large and XL contact stand markings |
| `docs/art/rev2_06_taxiway_radius_markings_surfaces.png` | Radius 40 versus 25, table of radii by code, surfaces, upgrade bar |
| `docs/art/rev2_07_apron_modes_terminal.png` | Free polygon and rectangle apron modes, merge and cut, terminal size |

Reference code: `docs/reference/geometry/` (`lib.py` helpers and aircraft planform, `netdraw.py` fillet and junction, `fig1.py` fork, `fig5.py` contact stands, `fig6.py` taxiway junction markings and surfaces, `fig7.py` apron modes, `fig4_stand_data.py` aircraft outlines and Small stand). Paths inside the scripts point to a scratch folder, change them to run locally. `fig5.py` imports `fig4_stand_data`.
