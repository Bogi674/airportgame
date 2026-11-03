# ART_AND_ASSETS.md

How to build every visual asset: aircraft, ground vehicles, people, buildings, terminal interiors, surfaces and markings. Assets are generated in code from data, not drawn as bitmaps. Reference sheets are in `docs/art/`. A Python reference implementation of the aircraft, vehicle, people and stand generators is in `docs/reference/sprite-prototypes/`. Port its geometry to TypeScript under `src/render/sprites/` and match the sheets.

## 1. Style

* Clean, toned down, flat 2D top down. Flat fills, very soft shading, thin outlines, one baked soft shadow per object. No textures on vehicles and aircraft except subtle gradients.
* Everything at true scale in meters. A person is about 0.5 m wide, an A320 is 37.6 m long, a 777-300ER 73.9 m. Never scale an asset for readability. Use detail tiers instead.
* Sun from the upper left. Shadow offset in world space: 0.9 m right and 1.3 m down for aircraft, 0.25 m and 0.35 m for vehicles and people, blur radius 0.35 m, opacity 0.28 to 0.32.
* Core palette tokens (`src/render/palette.ts`):

| Token | Hex | Use |
| --- | --- | --- |
| skin | #ffffff | Aircraft fuselage |
| skinEdge | #cfd6de | Fuselage shading edge |
| wing | #e9ecef | Wings, stabilizers |
| outline | #8f99a5 | Aircraft outlines |
| glass | #1c2530 | Windscreens |
| window | #6f7a86 | Cabin windows |
| asphalt | #4b5058 | Asphalt base |
| concrete | #bcc0c3 | Concrete base |
| grass | #6b9a4c | Grass base |
| markYellow | #f2c230 | Aircraft guidance paint |
| markRed | #d9312b | Safety paint |
| markWhite | #f4f6f8 | Vehicle and runway paint |
| markOrange | #f28c28 | Alternate MARS lines |
| markBlack | #141414 | Type boxes, sign backgrounds |

## 2. Units, zoom bands and baking

* World units are meters. The camera zoom is in pixels per meter (px/m), from 0.05 to 40.
* Every sprite is baked at runtime from vector geometry into an `ImageBitmap` at the active zoom band and device pixel ratio, then rotated at draw time. Bake again only when the zoom crosses a band or the livery changes.
* Zoom bands: 0.5, 1, 2, 4, 8, 16, 32 px/m. Bake at the next band up and scale down at draw time.
* Stroke widths are defined in screen pixels (outline 0.9 px, detail lines 0.6 to 0.8 px) and converted to meters at bake time, so lines stay crisp at every zoom.
* Least recently used caches: aircraft and vehicles 64 MB, people atlas 8 MB per tier, static chunks 128 MB.

Detail tiers:

| Asset | Tier 3 close up | Tier 2 default | Tier 1 simple | Tier 0 far |
| --- | --- | --- | --- | --- |
| Aircraft | Above 16 px/m: slats, spoilers, nav lights, antennas, pylons, chevron detail | 4 to 16: reference style | 1 to 4: flat silhouette plus shadow | Below 1: heading arrow in airline color |
| Vehicles | Above 16: full detail | 4 to 16: body, cab, key parts | 1 to 4: colored rectangle | Below 1: hidden |
| People | Above 24: full figure | 8 to 24: torso ellipse and head | 4 to 8: dot | Below 4: hidden, heat map only |
| Markings | All paint | All paint | Lead in, restraint outline, numbers, runway edge and centerline | Runway outline only |
| Terminal | Interior visible, roof hidden | Interior visible above 6 px/m, roof below | Roof | Roof |

## 3. Map layer order

Bottom to top. Static layers bake into 512 m chunks (`docs/ARCHITECTURE.md`).

1. Terrain hillshade, water, vegetation ground
2. Pavement surfaces
3. Paint and markings, unpaved markers
4. Building footprints, interior floors and walls when zoomed in
5. Ground vehicles and their shadows
6. Jet bridges
7. Aircraft and their shadows
8. People
9. Building roofs when zoomed out, tree canopies
10. Overlays (heat maps, envelopes, routes)
11. Labels and selection markers

A vehicle is never drawn above an aircraft. A vehicle under a wing or tail is covered by it.

## 4. Aircraft

### 4.1 Geometry model

Each family has a base geometry in meters in `spriteBases` of `src/data/aircraft/aircraft.mvp.json`. Coordinates: x lateral (right wing positive), y longitudinal with the nose at y = 0. Drawn nose up.

* **Fuselage half width** `hw(y)`:
  * Nose, `0 <= y < nose`: `R * (1 - (1 - y / nose) ^ n) ^ m` with `n = nose_n` (about 1.2) and `m = nose_m` (0.55 to 0.66). This ogive was fitted to a top down photo of a 777. Never use a half circle.
  * Constant section: `R = fw / 2`.
  * Tail cone, `y > L - tail`: `R - (R - tail_end) * u ^ tail_p`, with `u` from 0 to 1 over the tail cone.
* **Wing** right half: root leading edge at (R, x), leading edge swept by `sweep` to the tip, optional raked tip (`rake` length with `rake_extra` more sweep), tip chord `tip`, trailing edge kink at span station `kink`, inboard trailing edge sweep `te_in`. The kink is rounded with a quadratic curve controlled by `kink_round`. Mirror for the left wing. High wings span across the fuselage as one polygon.
* **Winglets**, projected from above: `fence` (none visible), `blended` and `sharklet` (thin swept sliver of width `ext`), `split` (737 MAX, two prong sliver), `canted` (short sliver), `none`.
* **Horizontal stabilizer**: root station, root chord, leading edge sweep, span, tip chord. T tails span across the centerline and are drawn last.
* **Fin**: a thin lens along the centerline from the dorsal fillet to the tip, width `w`.
* **Engines**:
  * `fan` underwing: nacelle at lateral station `y`, front station `x`, length `len`, diameter `d`. `flow = separate` draws the fan cowl to `fan_end` of the length, then a narrower core cowl and a dark plug. `flow = longduct` draws one long cowl to a single nozzle with a small plug. Optional chevrons on the fan nozzle edge.
  * `rear`: fuselage mounted nacelles with a pylon to the fuselage side.
  * `prop`: turboprop nacelle plus propeller. From above the disc is seen edge on, so blades project onto a lateral bar, each blade length `R * |cos(angle)|`.
  * `nose_prop`: single engine propeller and spinner at the nose.
* **Cockpit windscreen**: a dark band whose front edge follows `y + c * |u| ^ k` and back edge `y + d + (c + d * side) * |u| ^ kb` across the nose, with pane dividers. Styles and parameters:

| Style | Types | Shape |
| --- | --- | --- |
| `airbus` | A320, A330, A340 | Six panes, gentle V, side windows run back |
| `b737` | 737 | Sharp pointed V, six panes |
| `boeing` | 747, 777 | Six panes, moderate V. 747 sits on the upper deck and is narrower |
| `b787` | 787 | Four large panes, round front, wraps far back |
| `a350` | A350 | Four panes inside a black mask |
| `crj` | CRJ, Citations | Small pointed four pane |
| `atr` | ATR | Four rounded panes |
| `q400` | Dash 8-400 | Six panes, longer sides |
| `kingair` | King Air | Wraparound, center post |
| `ga` | Cessna 172, 208 | Wraparound, center post, plus rear window behind the high wing |

* **Cabin**: door outlines at door stations, overwing exits, window rows (start, end, pitch), the 747 upper deck outline and its windows.

### 4.2 Layer order inside one aircraft

Low wing: shadow, flap track fairings, underwing nacelles, wing, livery tint on nacelles, horizontal stabilizer if low, fuselage, doors and windows and windscreen, upper deck outline, rear engines, fin, T tail stabilizer, props and spinners.

High wing: shadow, low stabilizer, fuselage, sponsons, doors and windows and windscreen, flap track fairings, nacelles, wing, fin, T tail stabilizer, props.

Underwing nacelles always sit under the wing, so only the part ahead of the leading edge shows. Livery tint is drawn in the same pass as the part it colors, never as a final overlay.

### 4.3 Default style (tier 2)

White fuselage with a horizontal gradient (edges #cfd6de, center #ffffff), light grey wings with flap and aileron hinge lines, flap track fairings protruding behind the trailing edge, engine aft fairings, door outlines, window dots, dark windscreen, soft shadow. Reference: `docs/art/aircraft_style.png`.

### 4.4 Livery

Baked separately and composited per airline: fin color, nacelle color, winglet color, optional fuselage crown band. Airlines have `liveryPrimary` and `liverySecondary` in `src/data/airlines`.

### 4.5 Unique features per MVP 1 type

| Type | Windscreen | Wing | Winglet | Engines |
| --- | --- | --- | --- | --- |
| Cessna 172S | ga, rear window | High, constant chord inboard | none | Nose prop, 2 blades |
| Cessna 208B | ga, rear window | High, rectangular inboard, taper outboard | none | Nose prop, 3 blades |
| King Air 360 | kingair | Low, slight taper | canted | Overwing turboprops, 4 blades, T tail |
| ATR 72-600 | atr | High, straight, taper outboard, sponsons | none | Underwing turboprops, 6 blades, T tail |
| Dash 8-400 | q400 | High, longer nacelles past the trailing edge | none | Underwing turboprops, 6 blades, T tail |
| CRJ900 | crj | Low, 27 degree sweep | canted | Rear fuselage, separate flow, T tail |
| A320neo | airbus | 27.5 degree sweep, kink at engine | sharklet | LEAP or GTF, separate flow |
| 737-800 | b737 | 29 degree sweep, engines close to the fuselage and far forward | blended | CFM56-7, short separate flow |
| 787-9 | b787 | 34.5 degree sweep, smooth curved trailing edge | raked tip | GEnx with chevrons |
| 777-300ER | boeing | 34.6 degree sweep, nearly straight inboard trailing edge | raked tip | GE90, very large nacelle |

Release 1.0 adds the remaining Phase 1 types with their own features (A330 long duct Trent 700, A340 four long duct engines, A350 mask and curved sharklet, 747 hump and four engines, 737 MAX split winglet and chevrons).

### 4.6 Calibration (required for every type)

1. Find a true top down photo or manufacturer 3 view with a known length.
2. Scale it to px/m from the published length.
3. Overlay the sprite at 55 percent opacity.
4. Tolerances: length and span within 1 percent. Wing root leading edge, engine stations, stabilizer position and nose length within 0.5 m. Fit the nose profile to the photo.
5. Save the overlay as `docs/art/calibration/<type>.png` and set `sprite.calibration` to `photo calibrated`.

`docs/art/b777_calibration.png` is the worked example.

### 4.7 Variants

Variants reference a base and give `plugFwd` and `plugAft` in meters plus overrides (span, winglet, engine, wing, tail, windows). Stations behind the wing root leading edge minus 1 m move by `plugFwd`. Stations behind the wing root trailing edge plus 1 m move by a further `plugAft`.

### 4.8 Boundaries and service points

From `gear` (nose gear station, wheelbase, track), `heights` (wing and tail underside) and the planform, build:

* **Hard footprint**: fuselage polygon, nacelle boxes, prop bars, gear boxes, all buffered by 0.5 m.
* **Overhead zones**: wing polygon with its underside height, stabilizer polygon with its underside height.
* **Service points** in local meters with side: L1, R1, L2, R2 doors, forward and aft cargo doors, bulk door, fuel coupling, ground power, potable water, lavatory.

## 5. Ground support equipment

Catalog in `src/data/gse.json`. All sizes are real. Front is the end that leads when driving, except docking vehicles, whose working end is the front.

| Vehicle | L x W m | Height m | Shape from above | Docking |
| --- | --- | --- | --- | --- |
| Push back tug | 5.8 x 2.5 | 1.9 | Low dark slab, offset cab at the rear, ballast lines, tow hitch | Towbar to nose gear |
| Baggage tractor | 2.9 x 1.45 | 1.9 | Small red body, dark seat canopy, hitch at rear | Pulls carts |
| Baggage cart | 3.9 x 1.55 incl. drawbar | 2.0 | Covered cart with roof slats, triangle drawbar | Follows hitch |
| Belt loader | 7.6 x 2.1 | 1.8 | Long conveyor with cross ridges, yellow rails, small cab at rear left | Belt end at cargo door sill |
| Catering high loader | 9.5 x 2.5 | 4.6 raised | White box body with livery bands, platform at the rear, cab at front | Box end at a service door |
| Hydrant dispenser | 6.8 x 2.5 | 2.2 | Cab, yellow deck with hose reels and lift platform | Parks under the wing beside the pit |
| Refueller truck | 10.0 x 2.5 | 3.2 | Cab, white tank with red band, rear hose cabinet | Parks beside or under the wing near the coupling |
| Ground power unit | 3.2 x 1.7 | 1.6 | Blue box with grille lines, tow bar | Beside the nose gear |
| Apron bus | 13.8 x 3.0 | 3.1 | White roof, AC units, door outlines on one side | At the bus bay |
| Passenger stairs | 7.2 x 2.4 | 3.2 | Cab plus stair steps | Top step at a door |

Later releases: container loader, water truck, lavatory truck, de-icing rig, follow me car, fire tenders, ambulance, maintenance van.

Rules:

* Free continuous heading. Articulated units (tractor and carts, tug and dollies) draw one sprite per unit with its own heading.
* Each unit has an oriented footprint rectangle and a working height.
* Livery: handler color stripe (`handlerColor`) on carts, catering and dispensers.
* Reference: `docs/art/gse_sheet.png`, code `gse.py`.

## 6. People

Top down walking figures, about 0.5 m wide. Reference: `docs/art/people_sheet.png`, code `people2.py`.

### 6.1 Layers

Shadow, shoes (one forward, one back), trailing items (suitcase, trolley, stroller, cart), torso in shirt color with a slightly darker lower band, torso overlay (suit and tie, blazer and scarf, hi vis vest with reflective bands, police vest with checker band, turnout coat, paramedic stripes and cross, apron, overalls), epaulettes, radio, items on the back (backpack, big backpack, baby carrier, shoulder bag), arms as round capsules with hands (one forward, one back while walking), items in hand (phone, coffee, clipboard, handbag, toolbox, medical bag, extinguisher, marshalling wands, cane), head, hair or headwear, head accessories (ear defenders, headset).

Hair and headwear: short, side part, spiky, long, ponytail, bun, curly, afro, braids, buzz, balding, bald, hijab, peci, turban, cap, sun hat, beanie, helmet, firefighter helmet, police cap, pilot cap, beret.

Skin tones: 8 from #f6d7c3 to #4e2c1a. Hair colors: black, dark brown, brown, auburn, blonde, grey, white, red.

### 6.2 Passenger recipes (30)

Business suit with suitcase, business with phone, business hijab with suitcase, executive with coffee, consultant with shoulder bag, tourist with sun hat and suitcase, tourist with cap and backpack, backpacker with long hair, backpacker with beanie, student with backpack and phone, leisure ponytail with suitcase, leisure hijab with handbag, leisure bun with coffee, leisure curly with suitcase, leisure afro with shoulder bag, leisure braids with suitcase, peci and batik with suitcase, turban with suitcase, parent with trolley, parent with stroller, parent hijab with baby carrier, child with cap and backpack, child with pigtails, teen with headphones, elderly with cane, elderly hijab with handbag, wheelchair user, pilgrim, premium traveler, budget traveler.

Each cohort draws recipes from a profile weighted table with its seeded stream.

### 6.3 Staff roles (16)

| Role | Uniform |
| --- | --- |
| Security officer (2 variants, one with hijab) | Navy shirt, radio, one bar epaulettes |
| Police | Police cap, dark shirt, police vest |
| Customs officer | Beret, khaki shirt, two bar epaulettes |
| Check in agent | Airline blazer, scarf, bun |
| Administrator | Light shirt, tie, clipboard |
| Pilot | Pilot cap, white shirt, four bar epaulettes, flight bag |
| Cabin crew | Airline blazer and scarf, roller bag |
| Ground handler | Orange hi vis, cap, ear defenders, gloves |
| Baggage handler | Yellow hi vis, ear defenders, gloves |
| Marshaller | Orange hi vis, orange wands |
| Maintenance worker | Blue overalls, white helmet, ear defenders, toolbox |
| Cleaner | Grey uniform, cleaning cart |
| Retail staff | White shirt, colored apron |
| ARFF firefighter | Turnout coat with reflective bands, yellow helmet, extinguisher |
| Paramedic | Green with reflective band and cross, medical bag, radio |

### 6.4 Animation and tiers

Walk cycle of 4 frames (stride, pass, mirrored stride, pass). Recipes bake into one atlas per tier at load. Tiers per section 2.

## 7. Buildings and structures

All buildings are vector footprints with a roof style and, for gridded buildings, an interior.

| Structure | Roof from above | Details |
| --- | --- | --- |
| Terminal | Light grey flat roof, parapet edge, rooftop plant boxes, skylight strips | Glass facade line on the airside. Roof fades out above 6 px/m to reveal the interior |
| Pier and concourse | As terminal, narrow | Jet bridge rotundas along the facade |
| Jet bridge | Fixed rotunda circle, telescoping tunnel segments, cab with bumper | Drawn above vehicles, below aircraft. Extends and rotates to the door |
| Control tower | Circular cab with a glass ring on a square base | Shadow longer than other buildings |
| Fire station | Flat roof with red edge band | Bay doors facing the apron, vehicle apron |
| Hangar | Curved roof with ribs | Door width and height decide which types fit |
| Fuel farm | Round tanks with roof rings inside a bund wall | Pipe rack to the hydrant network |
| GSE depot | Shed roof plus striped parking | Vehicle spawn and charging bays |
| Car park, surface | Asphalt with white bays | Trees optional |
| Car park, multi storey | Concrete deck with ramps and bay lines on the top deck | Floors shown in the inspector |
| Rail station | Long canopy | Platform edges |
| Trees and vegetation | Round canopies in two greens with shadow | Not on owned airside land |

Interior visibility: above 6 px/m the roof is hidden and the interior drawn, below it the roof is drawn.

## 8. Runway and taxiway markings

Generated from settings. Dimensions follow ICAO Annex 14. All in meters.

* **Designator**: magnetic heading divided by 10, rounded, two digits, plus L, C or R for parallels. Magnetic variation comes from the site seed. Digit height 9 m, placed 12 m beyond the threshold stripes.
* **Threshold stripes**: start 6 m from the threshold, 30 m long, 1.8 m wide, 1.8 m apart. Count by width: 18 m gives 4, 23 m gives 6, 30 m gives 8, 45 m gives 12, 60 m gives 16.
* **Centerline**: dashes 30 m long with 20 m gaps. Width 0.9 m for CAT II and III, 0.45 m for CAT I and non-precision on codes C and up, 0.3 m otherwise.
* **Aiming point**: two bars 45 to 60 m long and 6 to 10 m wide starting 400 m from the threshold when landing distance is 2 400 m or more, closer on shorter runways.
* **Touchdown zone**: pairs of bars every 150 m from the threshold, 22.5 m long and 3 m wide, in groups of 3, 2, 2, 1, 1 stripes. Pairs by landing distance: under 900 m 1, under 1 200 m 2, under 1 500 m 3, under 2 400 m 4, 2 400 m and more 6. Precision runways only, or as set.
* **Edge lines**: continuous, 0.9 m wide on runways 30 m wide or more, 0.45 m otherwise.
* **Displaced threshold**: white arrows along the centerline and a transverse bar.
* **Blast pad**: yellow chevrons on paved areas before the threshold.
* **Runway holding position**: pattern A, two solid and two dashed yellow lines across the taxiway at the holding point. A red sign with white runway designators beside it.
* **Taxiway**: yellow centerline 0.15 m continuous, double yellow edge lines where shoulders are paved, single dashed intermediate holding positions, yellow on black location signs at junctions.
* **Turn pads**: yellow centerline curves.
* **Surface look**: asphalt runways have grooving texture and darker rubber deposits in the touchdown zones. Concrete runways show slab joints.
* **Unpaved runways**: no paint. White edge markers every 60 m, threshold boards, a windsock.
* **Lights** (later release): edge, centerline, threshold and approach lights in a night layer.

## 9. Stand markings

Reference: `docs/art/surfaces_stands.png`, code `stands2.py` and `stands3.py`.

### 9.1 Painted stands (concrete, asphalt)

* Yellow lead in lines from both taxilane directions with a curve, straight centerline to the stop area, lead out line with arrow on taxi through stands.
* Stand number boxes, black text on yellow, at the lead in start and before the stop area. MARS alternates use orange boxes and orange dashed lines.
* Stop position ladder: one yellow bar across the centerline per type group, black boxes with white type text on both sides. A type group is all assigned types whose stop positions are within 0.8 m.
* Equipment restraint area (red, double line: solid outer 0.28 m, dashed inner 0.16 m, 0.7 m inside):
  1. For each assigned type at its stop position, take its planform outline (fuselage, wings, tail, nacelles).
  2. Buffer by 3 m.
  3. Union all outlines.
  4. Simplify with a 1 m tolerance, then snap near parallel edges to the centerline direction and keep swept edges at the wing sweep angle.
  5. The result is drawn as the double line. Swept wing stands get swept rear lines. Straight wing stands get a near rectangle.
* Red dashed wingtip clearance lines along both sides at the stand boundary.
* Red hatched no parking band where the jet bridge wheels drive, labeled `NO PARKING`.
* Red hatched `EMERGENCY EQUIPMENT ONLY` triangle at the head of stand.
* Red square fuel pits labeled `FUEL` under each wing at the type's fuel coupling, yellow `GPU` pit, red circle extinguisher points.
* White: head of stand road with edge lines, center dashes, arrows and zebra crossings. GSE parking box with diagonal stripes. Push back limit line. Passenger walkways as zebra bands from the door to the bus bay or building.
* VDGS board on the facade at the centerline end.
* Paint fades with pavement condition (alpha from 1.0 at condition 100 to 0.5 at 40).

### 9.2 Unpaved stands (gravel, grass, dirt)

No paint. Orange and white cones along the lead in every 6 m, a stand signboard (black post with yellow number board), tie down rings at wing and tail positions, white edge markers at the stand corners. Grass stands add mowed stripes.

### 9.3 GA tie down rows

Asphalt: painted yellow T marks for the nose wheel and wingtip marks. Unpaved: tie down rings and cones only.

## 10. Surfaces

Repeating textures in meters, generated once per surface and condition band:

* Dirt: brown base with darker and lighter specks.
* Gravel: grey base with dense small stones.
* Grass: green base with 6 m mowing stripes and blade specks.
* Asphalt: dark grey with fine specks. Aged asphalt adds patches and crack sealing lines as condition drops.
* Concrete: 5 m slabs with joints and slight tone variation per slab, tire marks on taxilanes.
* Runway asphalt: grooving and rubber deposits.

Reference: `docs/art/surfaces_stands.png`.

## 11. Terminal interior kit

On the 2 m grid. Reference: `docs/art/terminal_kit.png` and `docs/art/terminal_scene.png` from the first sample set.

* **Floors**: terrazzo (halls), stone (concourse), security grey, carpet (gate lounges), wood (restaurants), marble (duty free), dark tile (fashion), clinic white (pharmacy), toilet tile, office, each a 2 m repeating pattern.
* **Walls**: solid 0.6 m wall color #2c3441, glass partitions 0.4 m with a light blue fill, doors as gaps with a swing arc. Wall pieces autotile at corners and T junctions.
* **Fixtures**: check in desk, kiosk, bag drop, gate desk, bench, round table, planter, bin, column, trolley rack, queue stanchions, info screen, shop counter, clothing rack, shelf, toilet stall, sink, escalator, elevator, carousel segment, moving walkway, security lane parts (divest table, x-ray, walk through arch, tray return).
* **Shop storefronts**: a colored plaque with the category name and a glass front line. Storefront and layout styles change colors and fixture sets.

## 12. Collision QA for art and game scenes

Every apron scene, in game and in reference art, must pass:

* No vehicle footprint intersects any aircraft hard footprint, except docking vehicles at their service point with at most 0.8 m2 overlap.
* No vehicle sits under an overhead zone that is lower than its height.
* No two vehicle footprints come within 0.3 m.
* No vehicle overlaps a building or jet bridge.
* Draw order follows section 3.

`docs/reference/sprite-prototypes/gse.py` contains the reference checker (`check`).

## 13. Asset QA checklist

* True scale, compared against the published dimensions.
* Matches the reference sheets in style.
* All detail tiers implemented.
* Calibration overlay saved for aircraft.
* No text overflows its box, no element overlaps another unless it is physically under it.
* Collision QA passes for any scene the asset appears in.

## 14. Reference sheets

| File | Shows |
| --- | --- |
| `docs/art/aircraft_style.png` | Default style, layers and detail tiers |
| `docs/art/aircraft_mvp_lineup.png` | All 14 sprite bases at one scale |
| `docs/art/b777_calibration.png` | Calibration against a real photo |
| `docs/art/gse_sheet.png` | GSE catalog, articulated trains, push back, collision boundaries |
| `docs/art/people_sheet.png` | 30 passengers, 16 staff, walk cycle, tiers |
| `docs/art/surfaces_stands.png` | Surfaces and stand templates, empty and in use |
| `docs/art/terminal_scene.png` | Terminal interior example |
| `docs/art/terminal_kit.png` | Floors, walls and fixtures |
| `docs/art/apron_scene.png` | First airfield sample, superseded by the stand sheet for markings |
