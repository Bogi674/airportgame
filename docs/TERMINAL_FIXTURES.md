# TERMINAL_FIXTURES.md

> **Revision 6 note (2026-11-25):** `docs/DESIGN_REVISION_6.md` overrides the same footprint rule for the check in desk: its art is 2, 3 and 4 m wide on 1, 2 and 2 whole cells, and security lane level 1 has the simpler Revision 6 look. Everything else here stays.

The terminal asset kit: processing fixtures in three levels, their automated variants, zone transition fixtures, baggage nodes, and the general fixtures, furniture and building infrastructure of a terminal. Approved scope and authority are in `docs/DESIGN_REVISION_5.md`. This document adds to `docs/ART_AND_ASSETS.md` section 11 and to the fixture table in `docs/GAME_DESIGN.md` section 8. Where they disagree, this document wins for fixture art, fixture levels and the asset data. `docs/BAGGAGE.md` wins for everything about bag nodes and ramps, `docs/TERMINAL_ZONING.md` for zones and transitions.

The finished assets the game loads are in `src/data/fixtures/` (section 11).

Reference sheets are the acceptance target, in the same way as the aircraft sheets in `docs/DESIGN_REVISION_3.md`:

| Sheet | Shows |
| --- | --- |
| `docs/art/terminal_processing_kit.png` | Check in desk, passport control and boarding gate desk in three levels, self check in kiosk, self bag drop, automated passport gate, detail tiers |
| `docs/art/terminal_security_kit.png` | Security lane in three levels with numbered parts |
| `docs/art/terminal_furniture_kit.png` | Waiting seating, lounge furniture, washroom fixtures |
| `docs/art/terminal_amenities_kit.png` | Decoration, vending and service machines, screens and signs, other airport items |
| `docs/art/terminal_office_infra_kit.png` | Airline office furniture, pantry, executive office, escalators, stairs, elevators, travelator, janitor room |
| `docs/art/terminal_zones_kit.png` | Zone types, transition fixtures (security exits, staff door, customs) and the terminal scene with the zone overlay |
| `docs/art/baggage_kit.png` | Ramp stubs, baggage nodes, under floor link overlay and an automatically linked chain |
| `docs/art/terminal_scene_kit.png` | All of the above in one terminal slice at 14 px per meter, ending at contact stand 22 with an A320neo on the jet bridge during a turnaround |
| `docs/art/fixture_catalog.png` | Every one of the 144 assets by category, drawn only from the exported data in `src/data/fixtures/` |

The Python reference implementation is in `docs/reference/sprite-prototypes/`: `fixture_core.py` (drawing context, shadows, tiers, shared parts), `fixtures_processing.py`, `fixtures_general.py`, `terminal_sheets.py`, `fixtures_building.py` (offices and building infrastructure), `fixtures_zoning.py` (zone transitions and the zone overlay), `fixtures_baggage.py` (baggage nodes and overlay), `baggage_links.py` (automatic baggage links), `terminal_scene.py`, `apron_stand.py` (contact stand for scenes), `export_fixtures.py` (writes `src/data/fixtures/`), `fixture_ops.py` (reference baker for the exported data) and the sheet scripts `terminal_sheets.py`, `baggage_sheet.py`, `zoning_sheet.py` and `catalog_sheet.py`. Port the geometry to TypeScript under `src/render/sprites/fixtures/`. Do not ship Python.

## 1. Style rules

These follow `docs/ART_AND_ASSETS.md` section 1 and match the aircraft, GSE and people sheets.

* Flat 2D top down, true scale in meters. A check in desk is 2 m wide, a person 0.5 m, an A320neo 37.6 m. Never scale a fixture for readability.
* Soft cylinder shading on every rounded part, using the same gradient recipe as the fuselage: darker edges, light center. Panels use a top lit gradient. Round parts use a radial dome.
* Thin outlines in `fxOutline` at 0.9 px, detail lines at 0.5 to 0.8 px. Strokes are defined in screen pixels and converted to meters at bake time.
* One baked shadow per fixture. Every solid part declares its height. The shadow of a part is the hull of its outline and the outline moved by (0.13 h, 0.18 h) meters, capped at h = 2.6 m. A 1.9 m part gets the documented vehicle offset of 0.25 m and 0.35 m. All parts of one fixture share one shadow group, blurred once (0.07 m) and drawn at 28 percent black, so overlaps never darken twice.
* Sun from the upper left in world space. Fixtures rotate in 90 degree steps, so the shadow is baked once per rotation (four bakes at most) and never rotated with the sprite.
* Screens: a dark slab with a glowing face edge in `glow`, plus a faint glow fan on the floor in front of large boards.
* Overhead items (ceiling flight boards, overhead wayfinding, smoking hoods) are drawn in a last overhead pass, translucent with a dashed edge, so the people under them stay readable. They are not obstacles for walking.
* Airline desks carry a livery tint in the airline's `liveryPrimary`: the fascia band, the back panel and the self service crowns. The tint is baked in the same pass as the part, never as a final overlay, as for aircraft.

### 1.1 Palette tokens to add to `src/render/palette.ts`

| Token | Hex | Use |
| --- | --- | --- |
| fxOutline | #5d6672 | Fixture outlines |
| counter | #f4f2ec | Desk counters, level 1 |
| stone | #efece5 | Stone tops, level 2 and 3 |
| walnut | #6e4a33 | Premium fronts and lounge wood |
| oak | #b88a5c | Benches, tables, shelves |
| steel | #c3cad2 | Steel parts, ledges, frames |
| machine | #dfe3e8 | X-ray and CT housings |
| belt | #4a5058 | Belts, matching the ramp stub in `docs/BAGGAGE.md` 7.1 |
| screen | #1d2a38 | Screens |
| glow | #5fa8d3 | Screen face edge, LED trim |
| glass | #bfe3f5 | Glass partitions, flaps, fins |
| porcelain | #fbfcfd | Washroom ceramics |
| leaf | #4f8a4a | Plants |
| ok | #3ec46d | Status lights |

## 2. Frame, footprint and placement

* Local frame: meters, top left at (0, 0), the side people use is the bottom edge (+y). Staff sides and wall backs are the top edge. Security lanes are drawn with the flow along +x.
* Processing fixtures snap to the building's 2 m grid and rotate with R, as in `docs/GAME_DESIGN.md` section 8.
* General fixtures snap to a 0.5 m sub grid inside rooms, so small items (a 0.7 m planter, a 0.42 m bin) sit naturally. **Confirm.**
* Wall mounted items (hand dryer, wall TV, water filler, fire cabinet, towel dispenser, baby changing, urinals, vanities, cupboards) must touch a wall with their top edge. The ghost turns red with the reason Needs a wall otherwise.
* Every fixture has a footprint rectangle used by walking and collision. Overhead items have none. Floor layer items (rug, floor medallion, prayer mats, premium mats) are walkable and drawn under people.

## 3. Detail tiers

Interior is visible above 6 px per meter (`docs/ART_AND_ASSETS.md` section 2). The tiers are generated from the same geometry by rules in the drawing context, so no fixture needs hand made tiers.

| Tier | Zoom | Rule |
| --- | --- | --- |
| 3 Close up | above 24 px/m | Everything |
| 2 Default | 12 to 24 px/m | Drops parts under 0.012 m2 and detail lines under 1 px. The default terminal zoom of 14 px/m is tier 2 |
| 1 Simplified | 6 to 12 px/m | Only parts of 0.1 m2 or more that stand 0.3 m or taller, as flat base colors with no outline, plus the shadow |
| 0 Roof | below 6 px/m | Interior hidden, roof drawn |

## 4. Fixture levels

Check in desk, security lane, passport control and boarding gate desk come in three levels. Every level of one fixture keeps the same footprint, ramp cells and service positions, so an upgrade is done in place.

* Upgrade is a works job on the fixture. The fixture closes for the works time, its queue moves to the nearest fixture of the same kind, and the sprite changes when the works finish. Undo restores the old level.
* A higher level lowers service time, raises satisfaction of passengers served there, and costs more to build and run.
* Level 3 check in desks are needed to serve business and first class passengers at full satisfaction. Level 3 gate desks add a priority lane.

### 4.1 Check in desk, 2 by 2 m

The belt runs down the middle of the cell, x 0.6 to 1.4 m, so it lines up with the out ramp cell behind the desk exactly as `docs/BAGGAGE.md` 7.1 and 7.2 require. Agent counter on the left, passenger ledge on the right.

| Level | Look | Service time | Agents | Notes |
| --- | --- | --- | --- | --- |
| 1 Basic | Laminate counter, flat scale plate, plain transfer belt, one monitor, livery fascia band | 120 s per party | 1 | Same as the current `GAME_DESIGN.md` value |
| 2 Standard | Stone counters, powered weigh belt with rails, customer display, airline back panel, glass divider | 105 s | 1 | **Confirm** |
| 3 Premium | Curved walnut and stone counters, chrome belt with status light, backlit airline panel, glass fins, premium floor mat | 95 s | 1 | Full satisfaction for premium classes. **Confirm** |

### 4.2 Security lane, 16 by 4 m

Bags ride a conveyor band along the top edge (y 0.4 to 1.2 m), people walk below it. The sheet numbers every part.

| Level | Parts | Throughput | Officers |
| --- | --- | --- | --- |
| 1 Basic | Pass check podium, retractable belt funnel, static divest table with tray stack, single view x-ray, walk through metal detector, operator desk, search mat, gravity reclaim, tray cart, re-dress bench, bin | About 300 per hour (12 s), the current value | 4 |
| 2 Standard | Pass reader with status light, glass guides, roller divest with two positions, dual view x-ray, metal detector, two screen operator desk, search mat, powered reclaim, reject table, trace detection table, tray cart, re-dress bench | About 360 per hour (10 s). **Confirm** | 5 |
| 3 Smart lane | Lane status pillar, automatic tray return along the back, four parallel divest stations with tray dispensers and status screens, CT scanner, body scanner, automatic reject lane with diverter, resolution table, re-dress bench | About 450 per hour (8 s). **Confirm** | 4 on the lane plus 1 remote screener seat |

The remote screener needs a staff room with a work desk in the secure zone. **Confirm** whether this is a separate room type or any staff office.

### 4.3 Passport control, 2 by 2 m

Officer on the left, passenger lane x 1.15 to 1.95 m, flow from the bottom edge to the top edge. Used for departures and arrivals.

| Level | Look | Service time | Notes |
| --- | --- | --- | --- |
| 1 Desk | Open podium desk with monitor, document reader and stamp, lane post with belt at the exit, yellow wait line | 45 s | Current value |
| 2 Booth | Enclosed booth with door, glass window, fingerprint ledge on the lane side, glass exit flap | 38 s | **Confirm** |
| 3 Biometric booth | Rounded booth with LED trim, face camera pillar, fingerprint pad, double glass exit doors, floor feet marks | 30 s | **Confirm** |

### 4.4 Boarding gate desk, 4 by 2 m

Agents at the top, passengers at the bottom.

| Level | Look | Time per passenger | Agents |
| --- | --- | --- | --- |
| 1 Podium | Single desk, pass reader, gate sign on a pole | 5 s, current value | 1 |
| 2 Twin desk | Stone desk with two positions and two readers, gate display on a stand, queue belt | 3.5 s. **Confirm** | 2 |
| 3 Premium | Curved walnut desk, LED wall, priority lane with its own scanner and glass flap on a burgundy mat | 3 s. **Confirm** | 2 |

## 5. Automated variants

| Fixture | Footprint | Service time | Staff | Notes |
| --- | --- | --- | --- | --- |
| Self check in kiosk | 2 by 2 m | 75 s | None | Branded crown, angled touch screen, passport scanner, card reader, print slot, privacy wings, floor decal. Lower satisfaction for elderly travelers, as in `GAME_DESIGN.md` |
| Self bag drop | 4 by 2 m | 40 s | 1 roaming agent per 4 units. **Confirm** | Lane centered on the left cell so it meets the out ramp, light curtain posts, rear shutter with hazard edge, screen tower, side glass, tag bin |
| Automated passport gate | 2 by 2 m | 20 s. **Confirm** | 1 officer per 5 gates. **Confirm** | Mantrap lane between two cabinets, entry and exit glass flaps, passport reader, camera mast with screen. A share of passengers (8 percent proposed) is referred to a booth, and children under 12 always are. **Confirm** |

## 5a. Zone transitions and baggage nodes

* **Security exit**, the way out of the secure zone (`docs/TERMINAL_ZONING.md` section 6): level 1 staffed lane (4 x 4 m), level 2 automated anti return lane (2 x 6 m), level 3 one way revolving door (2.6 m). Unlike the processing families the three security exit levels have different footprints, so an upgrade is a replace, not an in place change.
* **Staff door** with card reader on a wall edge, and the **customs channel** (4 x 4 m) for the international arrival journey.
* **Baggage nodes** from `docs/BAGGAGE.md`: ramp stubs in five states, screening machine with both ramps and its console, baggage bay in four widths, staging lane and carousel.

## 6. General fixtures

Sizes are the drawn sizes. Grid cells round up on the 0.5 m sub grid.

### 6.1 Waiting seating

| Fixture | Size m | Seats | Notes |
| --- | --- | --- | --- |
| Beam seat 3 | 1.9 x 0.7 | 3 | Perforated steel, 0.63 m pitch. Matches the existing Bench row in `GAME_DESIGN.md` |
| Beam seat 5 | 3.2 x 0.7 | 5 | Gate lounge standard |
| Back to back 6 | 1.9 x 1.4 | 6 | Island rows |
| Beam seat with charging | 3.2 x 0.7 | 4 | Side table with four outlets, satisfies the charging want |
| Padded row 3 | 2.1 x 0.7 | 3 | Higher comfort |
| Slat bench | 1.9 x 0.5 | 3 | Landside, no back |
| Recliner | 0.8 x 1.9 | 1 | Quiet zone and lounge, rest need |

### 6.2 Lounge furniture

Sofa 3 seat (2.2 x 0.9), sofa 2 seat (1.6 x 0.9), armchair (0.9 x 0.9), coffee table (1.2 x 0.6), end table with lamp (0.5 round), floor lamp (0.8 x 0.8), dining set for 4 (2 x 2), bar with 4 stools (3 x 1.5), TV on credenza (2 x 0.55, wall), cupboard (1.6 x 0.55, 2 m tall, wall), magazine shelf (1.2 x 0.35, wall), work desk with chair (1.4 x 1.2), buffet counter (2.4 x 0.8), coffee station (1.6 x 0.6), rug (2.4 x 1.7, floor layer). Upholstery colors are a per item tint so lounge styles can recolor them.

### 6.3 Washrooms

Toilet stall (1 x 1.6, wall hung pan, door swing), accessible toilet (2.2 x 2.2, grab bars, 1.5 m turning circle, alarm pull), urinal row of 3 with dividers (2.4 x 0.5, wall), vanity with 2 or 3 basins and mirror line (0.8 m per basin x 0.6, wall), sink (0.6 x 0.5, wall), hand dryer (0.3 x 0.2, wall), towel dispenser with bin (0.4 x 0.6, wall), trash can (0.42 round), recycling bins (1.2 x 0.45), baby changing (0.9 x 0.55, wall), janitor cart (0.95 x 0.55). The existing Toilet block row in `GAME_DESIGN.md` becomes a washroom room type whose capacity is the count of stalls and urinals inside it. **Confirm.**

### 6.4 Decoration

Planter small (0.7 round), planter large (1.6 round), planter trough (2 x 0.6), bamboo trough (2.4 x 0.5), potted palm (2 x 2 canopy), tree with ring bench (3.6 round, 16 seats), fountain (2.4 round), sculpture on plinth (1.6 x 1.6), floor medallion (3 round, floor layer), aircraft model case (2 x 1.3, holds a 1:32 model baked by the aircraft generator, so any type in the database can be shown). Decoration raises a room's ambience score. **Confirm** the ambience values.

### 6.5 Vending and service machines

Snack, drink, coffee, fresh food and travel essentials vending (1 x 0.85 each, 1.9 m tall, body and accent colors per brand), water bottle filler (0.5 x 0.35, wall), charging tower (0.6 x 0.6), ATM pair (1.9 x 0.8). Vending machines are small tenants: they earn a share of sales and need restocking by retail staff. **Confirm.**

### 6.6 Screens and signs

Flight board on a stand with 3 or 5 screens (2.6 or 4.2 x 0.35), info totem (0.6 x 0.35), wall TV (1.4, wall), gate display on a pole (1.2 x 0.3), digital ad totem (0.8 x 0.4), LED video wall (6 x 0.4), ceiling flight board (3 x 0.3, overhead), overhead wayfinding sign (3 x 0.3, overhead, yellow on black as on the airfield signs). Flight boards lower the wayfinding penalty in their room. Ad totems and the LED wall carry advertising income. **Confirm.**

### 6.7 Other airport items

Luggage trolley (1.1 x 0.6), trolley bay with 5 trolleys (3.4 x 1), information desk for 2 agents (3 x 2), queue belt kit as a serpentine (sized by columns and rows), premium rope posts (3 x 0.4), bag wrap station (2 x 2, a service tenant), prayer room set with shoe rack and four mats (3.5 x 2), wheelchair station (1.9 x 0.9), kids play area (3 x 3), smoking point with an overhead hood (1.6), fire cabinet and AED (1.4 x 0.3, wall), help point (0.4 round), round column (0.9) and ad column (0.9).

### 6.8 Airline office furniture

Offices are staff only rooms (airline office, airport management, crew room). All items snap to the 0.5 m sub grid.

| Group | Items |
| --- | --- |
| Computers | Dual screen computer and single screen computer (1.2 x 0.5, placed on a desk top, with keyboard, mouse and desk phone) |
| Work desks and chairs | Work desk with computer and task chair (1.6 x 1.4), L desk with corner computer and printer (1.8 x 1.6), desk pod for 4 with an acoustic screen (3.2 x 2.8), reception desk for 2 with an airline livery band (3 x 1.9) |
| Sofas | Office sofa (1.6 x 0.9), corner sofa (2.4 x 2.4) |
| Tables | Meeting table for 6 with conference phone (2.8 x 2.4), round table for 4 (2 x 2), pantry high table with 4 stools (1.6 x 1.5) |
| Pantry | Pantry counter with sink, dish rack, coffee machine, microwave and kettle (2.4 x 0.65, wall), fridge (0.7 x 0.7, 1.9 m tall), water cooler (0.36) |
| Executive office | Executive desk with leather chair and two visitor chairs (2 x 2.4), credenza with books, globe and plant (2 x 0.5, wall), desk model aircraft (0.6 x 0.5) |
| Office support | Copier (1.2 x 0.7), filing cabinets (1.5 x 0.6), whiteboard (1.8, wall) |

Rule: chairs always face their desk or table, with the backrest away from it.

Proposed effect: offices raise staff morale and lower fatigue for the roles assigned to them. A desk seat counts as one administrative workplace. Pantry items satisfy the staff hunger and thirst needs. **Confirm.**

### 6.9 Building infrastructure

Circulation items link floor indexes (`docs/ARCHITECTURE.md` terminal floor index, multi floor in MVP 2). On the upper floor each one cuts a void in the floor with a glass balustrade around it. Escalators and stairs have a lower end (bottom edge) and an upper end (top edge).

| Item | Size m | Proposed capacity | Notes |
| --- | --- | --- | --- |
| Escalator | 1.65 x 13.2 for a 5 m rise | 4 500 people per hour nominal, 3 000 in use. **Confirm** | 1 m steps at 30 degrees, comb plates, yellow step edges, direction chevrons, status light. Placed singly or as an up and down pair (3.6 x 13.2) |
| Stairs, straight | 1.8 x 10.4 | 2 000 per hour per direction. **Confirm** | 30 risers of 0.167 m, going 0.28 m, upper half dashed after the break line, UP arrow |
| Stairs, switchback | 3.9 x 6.4 | Same as straight. **Confirm** | Two flights and a half landing, fits where a straight run does not |
| Elevator | 2.6 x 2.8 shaft | 13 people per trip, 60 s round trip. **Confirm** | Car with handrails, sliding doors on the bottom edge, call buttons and floor indicator. Glass variant and a bank of two (5.4 x 2.8). Required for wheelchair users and strollers between floors |
| Travelator | 1.65 wide, any length in 2 m steps | Speed 0.65 m/s added to walking speed. **Confirm** | Comb plates, yellow edges, flow chevrons, placed singly or as a pair (3.6 wide) |
| Janitor room | 4 x 3 inside | Base for 2 cleaners. **Confirm** | Room type `janitor`: mop sink, supply shelf, mop rack, floor scrubber, janitor cart, wet floor sign, bin. Cleaners start and refill here; cleaning response time grows with the distance to the nearest janitor room |

## 7. Scene rules

* Draw order inside the terminal: floors, walls and glass, fixtures with their shadows, people, overhead items, labels. On the apron the order of `docs/ART_AND_ASSETS.md` section 3 applies.
* Passengers inside a security lane carry nothing. Their bags ride the x-ray.
* Queues use the queue belt kit. A queue kit placed in front of a processing fixture links to it automatically.
* `terminal_scene_kit.png` is the reference for density and readability at the default zoom.
* Any scene that shows an aircraft stand uses the stand markings of `docs/art/surfaces_stands.png`, generated from the `stands2.py` primitives: concrete stand surface, taxilane with the lead in fork, double red restraint line, stop ladder, push limit, fuel and GPU pits, bridge no parking zone, emergency zone, GSE parking, service road with crossings and the VDGS board on the facade.
* The jet bridge follows `docs/DESIGN_REVISION_3.md` section 4.2 and is drawn by `apron_stand.jet_bridge`: a fixed link with roof ribs from the gate door across the service road, a rotunda inside the hatched no parking zone, a three section telescoping tunnel with its wheel bogie, and a cab with a dark bumper at the forward left door. Gate doors in the facade line up with the service road crossings and the fixed link.
* Aircraft use the tier 2 sprite of `docs/art/aircraft_mvp_lineup.png` with the composite livery of `docs/art/aircraft_style.png` (fin, winglets and nacelles tinted). Ground equipment on the stand comes from `gse.py` and must pass `gse.check` against the aircraft, the bridge and the building.
* When a scene rotates a stand, every shadow (aircraft, vehicles, bridge, fixtures) is baked toward the world sun, never rotated with the sprite.

## 8. Implementation notes

* Rendering: one generic baker, `src/render/sprites/fixtureSprite.ts`, draws any asset from its exported draw ops (section 11). No per fixture drawing code is written in TypeScript. The Python modules stay the source: change a fixture there, run `export_fixtures.py`, commit the regenerated JSON.
* Data: `src/data/fixtures/catalog.json` with the zod schema in `src/data/schemas/fixtures.ts`. Gameplay values the sim needs (service time, staff, capacity, throughput) are read from `stats`. Build cost, upkeep and works time live in `src/data/business.json` next to the existing module prices, keyed by asset id or family, added in the task that first prices them. The kit JSON is generated and never edited by hand.
* Two placement layers. Fixtures (grid `cell`) live in the terminal grid as today, one byte per cell. Props (grid `sub`) are a list per floor of `{ asset, x, y, rot }` in meters on a 0.5 m grid, with their footprint marked as blocked in the walking graph. Seating, lounge, washroom, decoration, vending, screens, service, office and back of house items are props.
* Cache: sprites bake per zoom band, rotation and livery into the static chunk cache, like other static layers.
* Commands: `placeFixture`, `upgradeFixture`, `removeFixture`, `placeProp`, `removeProp`, serializable and undoable.

## 9. Open values

Every row marked **Confirm** above, plus build cost, upkeep and works time for each fixture and level. These are not invented here. Add them to the decision batch in `handoff/QUESTIONS.md` with the proposed values from this document.

## 10. Tests

* `tests/fixtureKit.test.ts` validates the catalog and every sprite pack with zod, checks one sprite per asset, unique ids, existing `FIXTURE_KEYS`, confirm lists, solid parts within 0.6 m of the footprint, and levels 1 to 3 with one footprint for every processing family.

* Visual regression for each sheet against its PNG, compared by structure.
* For every fixture and level: no part lies outside its footprint except declared overhangs (premium mats, door swings), every text label fits its box, and ramp cells line up with `docs/BAGGAGE.md` 7.1.
* Upgrade test: an in place upgrade keeps the footprint, closes the fixture for the works time and undo restores the previous level.
* Shadow test: the shadow offset points right and down in world space for all four rotations.

## 11. Assets for the game build

The kit is finished as data in `src/data/fixtures/`, so the build loads the same geometry the sheets show.

### 11.1 Files

| File | Contents |
| --- | --- |
| `src/data/fixtures/catalog.json` | 144 assets in 13 categories: id, name, category, family, level, size, grid, mount, zones, `gameKey`, `newKey`, stats, confirm, ramps, sheet, generator |
| `src/data/fixtures/sprites/<category>.json` | Per asset its size and draw ops in meters, rotation 0, full detail. 13 packs, about 370 KB in total. Load a pack when its category is first needed, with a dynamic import |
| `src/data/schemas/fixtures.ts` | zod schemas `fixtureCatalogSchema`, `fixtureSpritePackSchema`, `fixtureOpSchema` |

Categories: processing, zoning, baggage, seating, lounge, washroom, decoration, vending, screens, service, office, circulation, backOfHouse. `docs/art/fixture_catalog.png` shows every asset with its id.

### 11.2 Catalog fields

* `size` is width and depth in meters at rotation 0. `grid` is `cell` (2 m terminal grid) or `sub` (0.5 m prop grid). `mount` is floor, floorLayer (walkable, drawn under people), wall (back edge on a wall), edge (on a wall edge, the staff door), overhead (no footprint, drawn last) or desktop (placed on a desk).
* `zones` lists the zones the asset may stand on (`docs/TERMINAL_ZONING.md`).
* `gameKey` names the existing entry of `FIXTURE_KEYS` the asset draws. `newKey` names the key to append when the asset is built. Never insert keys in the middle of a saved list.
* `stats` holds the gameplay values. `confirm` lists the ones still waiting for the owner; they must stay out of the sim until confirmed, or be used with the proposed value and a note in `handoff/QUESTIONS.md`.
* `ramps` holds baggage ramp cells in 2 m cells relative to the footprint, with in or out.

### 11.3 Draw ops

Each op is one shape in sprite meters. Kinds: `r` rect, `c` circle, `e` ellipse (with `rot`), `p` polygon, `a` SVG path with absolute M, L, Q, C, A, Z (and `shp`, its outline for the shadow), `l` line, `t` text, `glow` floor light polygon, `air` an aircraft model drawn by the aircraft baker. Paint fields: `f` fill (a color, a gradient spec `{g, c, a}` or a pattern `{pat}`), `s` stroke color, `sw` stroke width (`{px}` screen pixels or `{m}` meters), `o` opacity, `ht` part height in meters, `dash`, `dashPx`, `ov` overhead, `fLiv` and `sLiv` livery shade factors.

### 11.4 Baker rules (port of `fixture_ops.py`)

1. Draw ops in order. Overhead ops go to a last pass, only from tier 2.
2. Tier gating per section 3: tier 2 drops shapes under 0.012 m2, lines under 1 px and open paths under 1.2 px; tier 1 keeps only shapes of 0.1 m2 or more with `ht` 0.3 m or more, as flat base colors without outline.
3. Gradients: `soft` is the fuselage cylinder recipe (edge 12 percent darker, center 14 percent lighter), `lit` a top lit panel, `dome` a radial highlight, plus the fixed `screen`, `glow`, `water`, `ramp` and `escalator` gradients. Exact stops are in `fixture_ops._grad`.
4. Shadow: for every kept shape with `ht`, the hull of its outline and the outline moved by `(0.13 ht, 0.18 ht)` in world space, `ht` capped at 2.6 m, rotated into the sprite frame for the placement rotation. Union all, blur 0.07 m, fill 28 percent black, draw before the body. Bake once per rotation.
5. Strokes in `px` are divided by the bake scale, so lines stay crisp at every zoom band.
6. Livery: an op with `fLiv` or `sLiv` is an airline part. Its fill or stroke (for a gradient spec, the base color `c`) becomes the airline's `liveryPrimary` shaded by that factor with `fixture_core.shade` (negative mixes toward black, positive toward white). The exported color is the default for unassigned and common use desks.
7. Text ops use the UI font in bold at the given size in meters.
8. Acceptance: a Playwright shot of every asset next to `docs/art/fixture_catalog.png` at tier 3, compared by structure.
