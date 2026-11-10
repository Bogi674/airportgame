# GAME_DESIGN.md

Gameplay systems, rules, formulas and starting data. All numbers are starting values. They belong in JSON under `src/data` so they can be tuned without touching logic. Visual rules live in `docs/ART_AND_ASSETS.md`, menus and HUD in `docs/UI_DESIGN.md`, and what ships when in `docs/ROADMAP.md`.

## 1. Vision and pillars

The player is the airport CEO. They plan and build a real scale airport on a procedurally generated site, shape how aircraft, vehicles and passengers move, curate shops, negotiate with airlines, manage staff and keep the business healthy.

Pillars:

1. **Real scale, forgiving rules.** Dimensions, clearances and aircraft data are real. Rules give bonuses for doing it well and fall back to a baseline when the player is approximate. Nothing is game breaking because the player missed an exact number.
2. **Layout is the game.** A good layout shows up as smooth flows, a bad one as queues, delays, empty shops and unhappy airlines. The player sees why, through overlays and clear messages.
3. **Readable and calm.** A clean top down 2D look, a modern uncluttered interface, and information when the player asks for it.
4. **Light in the browser.** Late game with 150 aircraft movements and 100 000 passengers still runs smoothly on a mid range laptop.
5. **Seeded and repeatable.** The same seed and the same commands always give the same airport.

There is no noise complaint system, no rival airport and no combat. Pressure comes from demand, money, capacity, weather and airline expectations.

## 2. Core loop

1. **Read the site**: terrain, wind rose, owned land, city direction and demand.
2. **Build the airfield**: runway, taxiways, apron and stands.
3. **Build the terminal**: check in, security, gates, shops, baggage, landside access.
4. **Sign airlines**: contracts, fees and slots.
5. **Operate**: flights arrive and depart, passengers flow, vehicles turn aircraft around.
6. **Read the results**: overlays, alerts, finance and airline satisfaction.
7. **Expand and refine**: more land, longer runways, bigger terminals, better tenants.

A session starts with a small regional strip and a few turboprop flights per day and can grow into a hub.

## 3. Site and land

The seed produces a `SiteSpec` before the game starts.

* **World**: a square terrain of 8 by 8 km at 10 m height resolution. Only owned land is buildable.
* **Land parcels**: the site is divided into irregular parcels shaped by fields, roads, rivers and hills. The player starts with a few owned parcels and buys neighbors to expand. The fence follows owned land.

| Parcel type | Price per hectare | Extra work | Notes |
| --- | --- | --- | --- |
| Farmland | Low | None | Most common |
| Scrub or forest | Low | Clearing cost per hectare | |
| Village | High | Resettlement time of 60 game days before building | No other effect |
| Industrial | Medium | Demolition cost | |
| Road | Medium | Relocation cost, the road is rerouted around the airport automatically | |
| Wetland or water | Medium | Fill cost per cubic meter | Some wetland is protected |
| Protected | Not for sale | | Shown hatched |

  Price also rises with closeness to the city. There are no noise complaints and no penalties from neighbors.
* **Terrain presets**: `Flat Coastal`, `River Valley`, `Hilly Inland`. Each constrains the generator, and all remain seed driven.
* **Wind rose**: 16 directional bins with frequencies and strengths per season.
* **Climate**: tropical, temperate, arid, continental or maritime. Sets temperature range, rain, fog, snow and density altitude.
* **City**: population, growth, distance and direction, income, tourism share and business share. Drives demand.
* **Fairness guarantee**: every seed has at least one straight corridor of 3.5 km by 400 m inside land the player can afford in the first two years, aligned within the Acceptable wind band (section 4). The Optimal band may need more land or grading.

## 4. Wind and runway orientation

Wind is a soft bonus, not a gate.

* The game computes the **ideal heading**: the runway direction with the best crosswind coverage for the wind rose, using a 20 knot crosswind limit for jets and 15 knots for turboprops.
* While placing a runway, a live ring shows the band and the coverage percentage.

| Band | Angle from ideal | Effect |
| --- | --- | --- |
| Optimal | within 15 degrees | Bonus: required takeoff and landing length minus 5 percent, weather diversions halved, airline satisfaction plus 2 points |
| Acceptable | 15 to 40 degrees | Baseline. No bonus, no penalty |
| Poor | beyond 40 degrees | Mild penalty only on strong crosswind days, capped at 3 percent of days per season. On those days the runway closes for the affected types and the game warns a day ahead |

* A second runway in a different alignment removes the Poor penalty on days when it has better coverage.
* The bonus applies per runway end used, so a runway that is Optimal for the prevailing wind gets the bonus most days.

## 5. Aircraft data and rules

The roster and schema live in `docs/AIRCRAFT_DATABASE.md`. MVP 1 uses 10 models, Release 1.0 uses all 42 Phase 1 models, and later phases add more. Every model carries real dimensions, weights, engines, performance and capacity, and every number drives a rule.

Rules for every model:

* Code letter from wingspan: A under 15 m, B 15 to under 24, C 24 to under 36, D 36 to under 52, E 52 to under 65, F 65 to under 80.
* Wake category from MTOW: L up to 7 t, M up to 136 t, H above, J for the A380.
* Approach category from Vref: A under 91 kt, B to 120, C to 140, D to 165, E above.
* Maximum crosswind 15 knots under 30 t MTOW, 20 knots above, unless the model overrides it.

### Required runway length

```
required = takeoffFieldM
         * (1 + 0.07 * (temperatureC - 15) / 10)     temperature
         * (1 + 0.07 * elevationM / 300)             altitude
         * (1 + 0.15 * wetSurface)                   wet surface
         * (1 + 0.10 * uphillSlopePercent)           runway slope
         * (takeoffWeightKg / mtowKg) ^ 2            weight
         * windBandFactor                            0.95 in the Optimal band, else 1.0
```

Landing uses `landingFieldM * (landingWeightKg / mlwKg) ^ 2 * (1 + 0.15 * wetSurface) * windBandFactor`. A flight can operate only if both fit the takeoff distance available from its entry point and the landing distance available. The UI names the limiting factor, for example "777-300ER to London needs 3 420 m at 34 C, entry B2 gives 3 200 m".

### Weight, payload and range

```
fuelKg          = tripKm * burnKgPerKm * 1.12 + reserveKg
burnKgPerKm     = roleBurn * (mtowKg / roleReferenceMtow) ^ 0.8 * generationFactor    classic 1.15, mature 1.0, modern 0.85
takeoffWeightKg = oewKg + payloadKg + fuelKg                     must be <= mtowKg
landingWeightKg = takeoffWeightKg - tripFuelKg                   must be <= mlwKg
```

* `rangeKm` is the ceiling at typical payload. Beyond it, payload is cut until the weight fits.
* Seats come from `seatsTypical` scaled by the airline's cabin density, up to `seatsMax`.

### Where each data field is used

| Field | Gameplay effect |
| --- | --- |
| Wingspan | Code letter, stand width, taxiway clearance, wingtip envelopes |
| Length | Stand depth, push back distance, fire category |
| Height | Hangar door height |
| Fuselage width, door stations | Jet bridge reach and count, stop bar positions |
| Wheelbase, gear track | Fillet radius check, nose wheel stop position |
| MTOW, MLW | Wake category, runway length, pavement load (ACR), landing fee |
| OEW, payload | Seats or cargo on a given route length |
| Engines and thrust or power | Jet blast area behind the aircraft at breakaway, de-icing time, fire category multiplier |
| Range, cruise speed | Reachable destinations, block time, rotations per day |
| Ceiling | Weather delay sensitivity |
| Takeoff and landing field length | Required runway length |
| Vref, approach category | Approach spacing, runway occupancy time |
| Surfaces | Which pavements the type may use |
| Gear, wing and tail heights | Collision boundaries for vehicles, see section 10 |

## 6. Airfield building

### Tools

Runway, taxiway, taxilane, rapid exit taxiway, holding point, apron, stand, stand row, de-icing pad, service road, perimeter road, control tower, fire station, fuel farm, hangar, GSE depot, plus prefab pieces. Every airfield object is vector geometry in meters, never tiles.

### Runway tool

1. Click and drag from threshold to threshold. Length shows live.
2. Pick a profile: design code letter, approach type (visual, non-precision, precision CAT I, II or III), surface and strength tier.
3. Width and shoulders fill in from the code. The player may widen within the allowed options.
4. The wind band ring, runway numbers and the obstacle surfaces preview update while dragging.

| Code | Runway width | Shoulders total | Typical aircraft |
| --- | --- | --- | --- |
| A | 18 m | none | Cessna 172 |
| B | 18 or 23 m | none | Caravan, King Air |
| C | 30 m | 7.5 m each side for 45 m paved | A320, 737, ATR, Q400, CRJ |
| D | 45 m | 7.5 m each side | 767 class |
| E | 45 m | 7.5 m each side | 777, 787, A330, A350 |
| F | 60 m | 7.5 m each side | A380, 747-8, 777X |

Editing a runway later (lengthen, widen, upgrade code or approach type, resurface) changes the same object. Markings regenerate. The runway closes for the works duration, shown before confirming in the inspector and the resize readout. Days come from the pavement area that changes at the surface's works rate (times `runwayWorks.areaFactor`, runway crews are larger) plus fitting out a new approach type (10 days non precision, 21 days precision). While closed the runway takes no arrivals or departures; flights wait or divert.

### Taxiway tool

Revised by `docs/DESIGN_REVISION_2.md` section 2.

* One polyline tool. While it is open every node shows as a small circle, junctions with their label (J1, J2).
* Snap targets in priority order, within 15 m: an existing node (the new arm joins it, a T becomes a 4 way), an open end (the taxiway is continued), a point on the middle of a segment (the segment splits and a junction is made there), then angle guides every 15 degrees and along the runway frames. Alt places freely, Shift forces 15 degree steps.
* No two nodes are ever closer than 15 m. Undo and redo restore the exact arm set.
* Pavement at a node is generated: a bend is one curve at the code's turn radius, a junction gets fillets between neighbouring arms under 170 degrees, a straight through centerline and a forked stem. Shoulders are a lighter paved band.
* Segment properties set by the player: one way or two way, open or closed, maximum code, speed limit, surface, name (letters such as A, B, B1 are suggested automatically).

| Code | Taxiway width | Centerline turn radius | Inner edge radius | Shoulder each side | Min separation taxiway to taxiway (centerlines) | Taxiway to object |
| --- | --- | --- | --- | --- | --- | --- |
| A | 7.5 m | 13 m | 9.25 m | none | 23 m | 15.5 m |
| B | 10.5 m | 18 m | 12.75 m | none | 32 m | 20 m |
| C | 15 m | 25 m | 17.5 m | 5 m | 44 m | 26 m |
| D | 18 m | 30 m | 21 m | 5.5 m | 63 m | 37 m |
| E | 23 m | 38 m | 26.5 m | 5.5 m | 76 m | 43.5 m |
| F | 25 m | 42 m | 29.5 m | 7.5 m | 91 m | 51 m |

Values are ICAO based and live in `src/data/airfield_codes.json`.

### Clearances shown as ghost envelopes

* **Runway strip**: about 280 m wide for instrument runways and 150 m for visual ones, shown as a faint band. Objects inside it raise a warning and block precision approaches.
* **Wingtip envelope**: while drawing a taxiway, a faint outline of the largest aircraft for that code slides along it at the cursor. Stretches closer than the code's taxiway to object distance to a stand or building, or running beside another taxiway closer than the taxiway separation, show as red bands with a tooltip. They are warnings, the taxiway can still be built.
* **Separations**: runway to parallel taxiway distance scales with code and approach type (for example about 168 m for a precision runway with code C to E taxiways). If a taxiway is built closer than its code needs, it is not forbidden. Its maximum code drops to the largest code that fits, and the label shows it.
* **Obstacle surfaces**: an approach surface from each threshold (1:50 for precision, 1:40 for non precision and visual) and a transitional surface along both sides of the strip (1:7, 1:5 for visual) up to 45 m. Obstacles are terrain, the cover on land the player does not own (forest 12 m, villages 8 m, industry 12 m) and terminals (16 m). Buying land clears its cover. A penetration disables that approach type in that direction: the direction falls back to the best type whose surfaces are clear, and in fog only an instrument approach works. The runway tool and a selected runway show the surfaces dashed in amber and the penetrations as red dots; the inspector names the usable approach per direction. Values live in `airfield_codes.json` under `obstacleSurfaces`.

### Holding points and entries

* Holding points are placed automatically where a taxiway meets a runway: 90 m from the runway centerline for precision runways and 75 m for visual ones. The player may drag them further out, never closer.
* Each runway entry shows its **takeoff distance available** in meters. Aircraft that need the full length use the threshold entry. Shorter ones may depart from an intersection, which raises runway throughput. The player can forbid intersection departures per entry.

### Rapid exit taxiways

* The rapid exit tool places a standard 30 degree exit from a clicked point on the runway, with presets for 45 and 90 degrees. Curves and the turn off lights are generated.
* The tool suggests the best distance from the threshold for the current fleet mix, based on approach speeds. An exit at the right distance cuts landing occupancy by up to 20 seconds.

### Prefab pieces

Parametric pieces that generate normal editable objects: runway end with turn pad, rapid exit, parallel taxiway with N connectors at a chosen spacing, stand row with taxilane, GA apron block, terminal starter shell. After placement every node is editable.

A turn pad is an extension of the runway beyond its end, like a real runway turn pad: a sharp rectangle from the end out to the code's pad length, flush with the runway's far edge and wider than the runway by the code's extra width on the side the player picked, with the yellow turn curve in it. It does not move the threshold and does not change the declared distances; the takeoff roll still counts the full runway length. A departure at an end without enough length ahead backtracks to the pad and turns there. The turn curve follows the reference diagram: it leaves the threshold along the runway centerline, loops round a circle set in the pad and comes back on a straight diagonal to the threshold.

### Placement, rotation and alignment

* The main runway can take any heading in 1 degree steps. It creates an **alignment frame**.
* Taxiways, aprons, stands and buildings snap to 0 and 90 degrees relative to the nearest alignment frame by default. Holding the snap key gives 15 degree steps, holding the free key gives free placement.
* A runway in a different direction creates a second alignment frame. New objects snap to the nearest frame.
* **Construction grid.** Every runway and every taxiway segment carries a grid of nodes 2 m apart along and across, with highlighted lines every 10 m, running along its heading from its first point. The grid is offered by proximity, as in Cities Skylines: while a placement tool hovers within the pavement edge plus a small screen margin of a runway or taxiway, that grid is drawn and the cursor snaps to its nodes and its heading. Away from every grid placement is free. Aprons, stands and rows, GA blocks and new terminal foundations snap to it by default. The runway and taxiway tools use it as the lowest priority snap, after their node, end, segment, centerline and guide snaps. Grid and Free is a toggle per tool, and holding Alt overrides it while held.
* Inside buildings, walls, rooms, doors and fixtures snap to the building's local 2 m grid in 90 degree steps. No 45 degree pieces inside the grid.
* Stands align to the apron edge or taxilane they attach to. The player picks side, spacing and push back direction.
* Aircraft, vehicles and people move with continuous headings.
* **Align view to runway**: a camera toggle rotates the view so the main runway runs left to right. Text stays upright and a compass shows north.

| Asset | Rotation | Snapping |
| --- | --- | --- |
| Runway | Free, 1 degree steps | Wind ring and runway numbers |
| Taxiway, taxilane, service road | Free polyline | Alignment frame, pavement edges, centerlines |
| Apron | Free polygon | Alignment frame, taxiways, terminal facade |
| Stand | Aligned to its apron edge or taxilane | Side, spacing, push back direction |
| Terminal and gridded buildings | Rotates once when placed | Alignment frame by default, sets a local 2 m grid |
| Interior walls, rooms, fixtures | 90 degree steps in the local grid | Whole cells |
| Free standing airside buildings | Free, 1 degree steps | Alignment frame, roads, aprons |
| Landside roads | Free curves | Junctions |
| Car parks, landside buildings | Aligned to the road they front | Optional free |
| Aircraft, vehicles, people | Continuous | None |

### Terrain

* Runways and taxiways have slope limits (runway longitudinal 1 percent average, 1.25 percent maximum for codes C to F). The grading tool levels terrain at a cost per cubic meter and shows cut and fill.

### Runway capacity

* Single runway mixed mode: 60 to 90 seconds occupancy per movement in practice.
* Wake separation by leader and follower pair in `src/data/wake.json`.
* Rapid exits, intersection departures and departure sequencing raise capacity.
* A second parallel runway adds full capacity only with spacing for independent operation, otherwise less.

### Surfaces and pavement

Per surface rules, colors, costs and works rates live in `src/data/surfaces.json` (`docs/DESIGN_REVISION_2.md` section 2.5). Grass, dirt and gravel allow codes A to C only and get edge markers instead of paint; asphalt and concrete allow every code and get full paint, concrete with a dark outline on every yellow line. A taxiway's surface is chosen when building and changed later in its inspector: an upgrade pays the new pavement, a downgrade refunds a share of the old value, and either one closes the taxiway for works that take `worksDaysPerKm2` of the new surface. A downgrade that would shut out a type an airline flies here is refused and names the type. Routing treats a segment as closed to a type whose surface list does not include it.

| Surface | Build cost per m2 | Strength tiers (PCR) | Upkeep per year | Rain | Allowed users |
| --- | --- | --- | --- | --- | --- |
| Dirt | 3 | fixed 5 | 4 percent of build | Closes after heavy rain until dry | Types with `dirt` in `surfaces` |
| Gravel | 8 | fixed 10 | 5 percent | Usable, braking reduced | Types with `gravel` |
| Grass | 5 | fixed 6 | 6 percent, mowing contract | Closes after 2 days of rain | Types with `grass` |
| Asphalt | 45 | 30, 50, 70, 90 | 2 percent | Wet factor 1.15 | All |
| Concrete | 90 | 40, 60, 80, 100, 120 | 1 percent | Wet factor 1.15 | All |

```
acr = mtowKg / 1000 * gearFactor / mainWheelCount ^ 0.5 * surfaceFactor
gearFactor    = 1.0 single, 0.8 dual, 0.65 dual tandem, 0.55 triple tandem
surfaceFactor = 1.0 asphalt, 1.1 concrete
```

* A type may use a pavement if `acr <= pcr`. Up to 10 percent overload is allowed with a 3 times wear rate and a warning.
* Condition falls from 100 with traffic weighted by `(acr / pcr) ^ 4`, weather and age. Below 60 the PCR drops one tier and paint fades. Below 40 the pavement sheds debris and closes for inspection. Resurfacing restores it.

### Stands

Revised by `docs/DESIGN_REVISION_2.md` sections 1 and 3. Four sizes, each contact (jet bridges at a terminal) or remote (bus or stairs); small stands are always remote. Sizes and dimensions live in `src/data/stand_sizes.json`.

| Size | Codes | Wingspan | Examples | Surfaces | Width | Depth | Fork radius |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Small | A, B | up to 24 m | Cessna 172, King Air, Citation | grass, dirt, gravel, asphalt, concrete | 30 m | 24 m | 16.5 m |
| Medium | C | over 24 up to 36 m | A320 family, 737, ATR 72, Dash 8 | grass, dirt, gravel, asphalt, concrete | 45 m | 52 m | 24.5 m |
| Large | D, E | over 36 up to 65 m | 777, 787, A350, A330 | asphalt, concrete | 80 m | 88 m | 42.5 m |
| Extra large | F | over 65 up to 80 m | 747, A380, An 124 | asphalt, concrete | 95 m | 94 m | 50.5 m |

* A type fits a stand when its wingspan is within the size and the stand surface is on its list, so an unpaved medium stand takes an ATR 72 but not an A320. The inspector names the types a stand refuses.
* An An 225 needs two adjacent extra large stands merged into a double stand (`mergeable` in the data; no released type needs it yet).
* Lead in and push back: the stand centerline runs from the stop bar to the fork point at the fork radius from the taxilane, and two quarter circle arcs join the taxilane tangentially, one each way. Nothing crosses the taxilane. Neighbouring forks share the point where they meet.
* Push back runs tail first along one arc onto the taxilane, then the aircraft taxis forward. The stand sets left or right, or by default the side away from the departure route. Before starting the aircraft needs the arc's taxilane node and the 28 m of taxilane beyond it clear.
* MARS and cargo stands arrive with MVP 2 as variants of these sizes.

A stand takes its surface from what it is built on, and its markings follow the surface:

| Surface | Markings | Restrictions |
| --- | --- | --- |
| Concrete | Full paint set, lines outlined in black | Size rules above |
| Asphalt | Full paint set, fading with condition | Size rules above |
| Gravel, grass, dirt | No paint. Cones along the lead in, stand signboard, tie down rings, white edge markers | Small and medium only, types rated for the surface |

Contact stands (medium, large, extra large) are marked from the stand data and the assigned types (full rules in `docs/ART_AND_ASSETS.md` section 9): the red stand safety line at the fork radius, a red stand boundary that narrows into a funnel at the nose, found so both front corners stay 3 m clear of every assigned type, a red hatched jet bridge zone front left and a white hatched staging area front right, the service road with lane arrows above the stand, jet bridges to the door stations, stop bars per type group and hydrant pits on large and extra large stands. Remote stands drop the bridges and the road and show a bus bay. Small stands get the GA stop mark, red dashed wingtip lines and tie down rings. At low zoom only the lead in, the boundary and the stand number show.

The sim stores stand size, type, surface and push back side. Paint is a render concern.

### Apron tool

`docs/DESIGN_REVISION_2.md` section 4. Two modes in one tool, switched with A or the buttons in the build bar: free polygon (click corners, double click or Enter to close, Shift for 15 degree steps, live edge lengths and area) and rectangle (drag corner to corner, aligned to the runway frame or the nearest apron edge, snapping to apron and taxiway edges, live width, height and area). Pieces of the same surface that overlap or touch merge into one named apron and only the new area is paid for. Ctrl drag or Ctrl click cuts a piece out, which can leave a hole or split the apron. Undo and redo cover every piece.

### Runway and taxiway markings

Generated from the runway and taxiway settings, following ICAO Annex 14 (exact geometry in `docs/ART_AND_ASSETS.md` section 8): designators from the magnetic heading, threshold stripes by width, centerline, touchdown zone and aiming point markings by length and approach type, edge lines, displaced threshold arrows, blast pad chevrons, runway holding position markings, taxiway centerlines and edge lines, intermediate holding positions and stand lead ins. Unpaved runways get edge markers and threshold boards instead of paint.

## 7. Ground movement rules

What the player controls (implementation in `docs/ARCHITECTURE.md` section 5):

* **Segment rules**: one way, two way, closed, maximum code, speed limit.
* **Holding points**: aircraft stop and wait for ATC clearance to enter or cross a runway.
* **Preferred flows**: the player can paint standard taxi routes, for example an inbound loop and an outbound loop, or "stand group 1 to runway 27 via A and B2". Aircraft use preferred routes when they are open and fall back to the fastest legal route otherwise.
* **Push back**: tail first along one fork arc of the stand, left or right (straight back is not allowed on a forked stand), then 28 m along the taxilane. The aircraft starts only when the arc's taxilane node, the 28 m stretch beyond it and the taxiway past it are clear.
* **Congestion**: route cost includes live traffic, so new routes avoid jammed taxiways. Aircraft never meet head on, never pass through each other and keep a safe gap.
* **Deadlocks**: when a wait cycle forms, the lowest priority aircraft holds or reroutes. A debug overlay shows the cycle so the player can fix the layout.
* **Vehicles**: GSE use service roads and apron lanes with the same reservation rules. Where a service road crosses a taxiway, vehicles always give way to aircraft.

## 8. Terminal

### Tools

Walls, doors, floor types, rooms with a type, fixtures and shop units, all on the building's local 2 m grid with 90 degree rotation. A room type check gives live warnings, for example a gate lounge with no door to the airside.

A building has no fixed size (`docs/DESIGN_REVISION_2.md` section 5). Its footprint is laid in rectangles that merge and can be extended or shrunk in any direction; only owned land, money, clearances to runways, taxiways and aprons, and the world size limit it. The grid grows in 64 m steps as edits reach past it.

### Fixtures and starting parameters

| Fixture | Footprint | Servers | Service time | Notes |
| --- | --- | --- | --- | --- |
| Check in desk | 2 by 2 m (1 cell) | 1 | 120 s | Airline assigned or common use |
| Self service kiosk | 2 by 2 m | 1 | 75 s | Cheaper, lower satisfaction for older travelers |
| Bag drop | 4 by 2 m | 1 | 40 s | Feeds the baggage network |
| Security lane | 4 by 16 m | 1 | 12 s | About 300 per hour |
| Passport booth | 2 by 2 m | 1 | 45 s | Departures and arrivals |
| Gate desk | 4 by 2 m | 1 | 5 s per passenger | Sets boarding time |
| Baggage carousel | 4 by 20 m | n/a | n/a | Holds 60 bags |
| Bench | 2 by 2 m, 3 seats | n/a | n/a | Comfort |
| Toilet block | 4 by 6 m | 6 | 90 s | Demand scales with dwell time |

### Passenger journey

Departure: access, drop off or parking or station, landside walk, check in (or bag drop only), security, passport control if international, airside dwell and retail, gate, boarding, aircraft.

Arrival: aircraft, gate, immigration if international, baggage claim, customs if international, landside exit, ground transport.

Transfer: gate to gate with a minimum connection time check and transfer security.

### Dwell, spend and satisfaction

* Arrival time before departure per profile: business 60 minutes, leisure domestic 90, leisure international 150, families 150.
* Time after security is the retail window. Late or far gates shrink it.
* Profiles: `business`, `leisure`, `family`, `budget`, `premium`, `crew and staff`, each with walk speed, patience, spend budget, shop preferences and sensitivity to queues and walking.

```
satisfaction = 100
             - queueWait * patienceWeight
             - walkDistanceOverComfort * walkWeight
             - delayMinutes * delayWeight
             - missedFlight * 40
             + comfortBonus + cleanlinessBonus + shopVarietyBonus + wayfindingBonus
```

Clamped to 0 to 100 per cohort and averaged into the airport rating over a trailing 30 day window.

## 9. Shops and tenants

* **Units**: rectangles on the terminal grid, merged or split in 4 m2 steps from 12 to 800 m2. Zone landside or airside. Frontage along a corridor drives footfall capture.
* **Categories**: duty free, convenience, food and beverage (quick, casual, fine), fashion, electronics, books and gifts, pharmacy, currency exchange, services and lounges, pop up kiosks. Each has minimum and ideal area, spend per passenger, margin, footfall sensitivity, profile affinity and visit time.
* **Customization** per unit: category target, size, storefront style, layout style, price tier, opening hours, signage.
* **Tenant lifecycle** (monthly): vacant units gather applicants based on airport rating, passengers in that zone, mix match, asking rent and fit. The player accepts, negotiates or waits, with optional auto accept rules. Leases run 1 to 5 years with base rent, turnover share, reviews and a break clause. Each tenant computes a health score. Three months below threshold means notice. Premium brands leave first when the rating drops below their minimum. A leaving tenant leaves a fit out reset cost.
* Rent income is the higher of base rent and turnover share.

## 10. Operations

### Check in and baggage

* Check in opens 3 hours before departure and closes 45 minutes before. Desk banks are assigned to airlines or common use.
* Bags travel through an abstract network of belt segments with capacity and transit time, plus sorting with a processing rate. Saturation queues bags and risks missed cut off.
* Arrival bags go from aircraft to carousel with an unload time per bag.

### Ground handling

* Each turnaround has a task list per aircraft type with durations and dependencies, in `src/data/turnarounds.json`.
* Vehicles come from pools at GSE depots, assigned nearest idle first. Travel uses service roads and apron lanes.
* Missing resources delay tasks. Delay is attributed to the airport or the airline for penalties.

Vehicle rules:

* Real dimensions, working height and continuous heading. Catalog in `src/data/gse.json`.
* Trains are chains of separate rigid units. Each trailer follows its hitch and pivots about its axle.
* Every aircraft has a **hard footprint** (fuselage, nacelles, props, gear plus 0.5 m) that nothing may enter except docking vehicles at their service point.
* Every aircraft has **overhead zones** (wing and tail with underside heights). A vehicle may pass under only if it is lower, and is then drawn beneath the aircraft.
* Every vehicle unit has its own footprint. Footprints never touch each other, buildings, bridges or people.
* Each type lists **service points** (doors, cargo doors, fuel panel, ground power, water, lavatory). Vehicles dock there with a fixed pose. Example A320: belt loader at the forward cargo door on the right, hydrant dispenser under the right wing by the pit, catering at R2, GPU by the nose gear, bridge at L1.
* No vehicle moves inside a restraint area while an aircraft moves onto or off the stand.

### ATC

* MVP 1: ATC comes from a free standing tower that the player builds anywhere on owned land that is not paved. The footprint is 15 m by 15 m at every level. Without a tower only GA and private aircraft fly. More than one tower may stand, and the highest level counts.
* MVP 1: the tower has five levels, bought with cash only. Level 1 costs 100 000 and each upgrade costs 50 000. The movement budget per runway per rolling hour is 20, 40, 60, 80 and 100, counting landings and takeoffs only. The runway cap is 1, 1, 2, 2 and unlimited, and applies once a tower stands.
* MVP 1: movements over the budget wait first in, first out. An arrival that waits 30 game minutes for a movement diverts. The tower panel shows the queue and an alert fires when queueing starts.
* MVP 2: tower capacity depends on controllers on shift and movements per hour each.
* Sequencing uses wake separation and a priority score. Options: departure metering, intersection departures, runway crossing rules.
* Without radar, approach spacing is larger.
* Low visibility procedures reduce capacity in fog.

### Staff

Roles: check in agent, security officer, police, customs and immigration officer, ground handler, baggage handler, marshaller, cleaner, retail staff, firefighter, paramedic, controller, maintenance technician, administrative staff, terminal manager. Airline pilots and cabin crew also walk through.

* 3 shifts per day with a roster per role, manual or auto.
* Group level skill, morale and fatigue. Fatigue raises error rate. Low morale raises sick leave and strike risk.
* Wages follow a yearly market index. Training raises skill.

### Emergency facilities

| Fire category | Largest aircraft length | Fire vehicles |
| --- | --- | --- |
| 5 | up to 28 m | 1 |
| 6 | 28 to 39 m | 1 |
| 7 | 39 to 49 m | 2 |
| 8 | 49 to 61 m | 3 |
| 9 | 61 to 76 m | 3 |
| 10 | 76 to 90 m | 3 |

Below the needed category, affected flights are refused or a regulator fine applies until fixed. Fire station position sets response time to each runway end.

## 11. Landside

* Roads: access road, ring road, curbside, parking, as placeable vector objects.
* Modes: car, taxi, ride share, bus, rail, shuttle. Mode share follows city traits and what is built.
* Curbside is a service node. Too little space spills queues onto the road.
* Parking: short stay, long stay, valet, premium, each with price, capacity and walk time.
* Public transport stations need a corridor. Frequency and capacity come from operator contracts.

## 12. Airlines and demand

Full system in `docs/AIRLINES.md`. Airlines have a scope (regional, national, international), a 1 to 5 star fleet rating and a business model. Fleets come from released aircraft only.

```
demand(route) = citySize * routeAttractiveness * seasonality * (1 + marketing) / (1 + routeSaturation)
```

* Airlines open routes when demand and airport facilities allow, and cut them when load factor, fees or punctuality are poor.
* Slot requests arrive per season. Contracts set fee discounts, minimum movements, desk and gate leases, incentives and delay penalties.
* There are no rival airports. Airlines leave when their satisfaction falls below a hidden outside option.

## 13. Finance

Aggregated ledger with an account tree and a daily close.

* **Revenue**: landing fees (`baseRate * MTOW tonnes * discount`), aircraft parking per stand hour, passenger service charge, security charge, rents, tenant income, car parks and ground transport concessions, fuel throughput fee, ground handling, advertising, penalties received.
* **Costs**: wages, fuel purchases, utilities, maintenance, cleaning, insurance, depreciation, interest, taxes, fines and penalties paid, land purchases, grading.
* **Fuel contracts**: seeded spot price with mean reversion and shocks. Forward contracts for 3, 6 or 12 months. Tank capacity limits stock. Stock outs ground flights.
* **Loans**: credit rating AAA to CCC from rating, debt to earnings, cash history and repayment record. Term loans, construction facilities and bonds. Covenants with consequences.
* **Construction**: costs are paid in phases over the build duration.
* **Reports**: daily cash, monthly profit and loss, balance sheet, KPI board.

## 14. Events

A seeded event deck weighted by climate: heavy rain, fog, storm, snow, heatwave, bird strike, runway debris, medical emergency, security alert, runway incursion, diversion arrivals, power cut, strike, fuel shortage, IT failure, VIP visit. Each has a trigger window, duration, effect and player responses with costs. Preparation such as backup generators or snow fleets reduces effects.

## 15. Progression, modes and difficulty

* **Stages**: Regional strip, Domestic airport, Regional international, Major international, Hub. Each unlocks tools and brings demand that stresses the previous layout.
* **Unlocks** from airport rating, passengers per year and cash milestones.
* **Modes**: Career (seeded site, full economy), Sandbox (no finance pressure, everything unlocked, all released aircraft), Scenarios (later releases, fixed goals on fixed seeds).
* **Difficulty presets**: starting cash, demand growth, event frequency, airline pickiness, wind penalty strength.
* **Optional rules** in the new game screen, off by default: night curfew, strict wind (Poor band penalty days doubled), realistic construction times.
* **Tutorial**: a guided first hour that builds a strip, one stand, a small terminal and the first turboprop route, teaching one tool at a time.
