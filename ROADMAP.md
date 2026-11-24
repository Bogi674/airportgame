# ROADMAP.md

The single plan for Airfield Tycoon: what is built, what is left for MVP 1, and in which order. Scope and status live here and nowhere else. Design lives in `docs/`, starting with `docs/DESIGN_REVISION_4.md`.

Last restructured on 2026-11-12, after the revamp brief.

## Next session: start here

1. Read `CLAUDE.md`, then this file.
2. Phases 1, 2, 3, 3b and 4 are done. T81, T32, T82 (prop effects), T50 (events) and T45 (asset sharpness) closed on 2026-11-23; T83 moved to MVP 2 (owner, 2026-11-23). T35 (menus) closed on 2026-11-23, T36 (flyouts, alert center, overlay list) on 2026-11-24. T37 (three engines) closed on 2026-11-24. Next is **T38** (acceptance): the automated part is done, see `handoff/work/T38.md`; it waits for the owner's 3 hour session. Run the `grill-me` skill and write the spec first.
3. Build on what T59 and T47 left: `src/shared/standSnap.ts` (single stand snapping), `Stand.accepts`, the marking layout in `src/render/markings/standLayout.ts` (`sheetFunnel`, `frontZones`) with its painter in `standPaint.ts`, and the map badges in `src/render/standStates.ts`.
4. Findings for T71 from the 2026-11-16 session are in `handoff/work/SESSION-2026-11-16.md`.
5. A second session may take **T54** (people walk and dwell along routes) at the same time. It touches the cohort store and the people renderer only.
5a. Phase 3b, the terminal kit (T73 to T77, `docs/DESIGN_REVISION_5.md`), depends only on finished work and may also run in a second session. Its assets are already in `src/data/fixtures/` with reference sheets in `docs/art/`. Start with T73.
6. Known leftovers are in `handoff/BACKLOG.md`, known limits in `docs/ARCHITECTURE.md` section 13.
7. Browser tests in the cloud session run with `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --project=chromium --trace off`. Firefox and WebKit are in `/opt/pw-browsers` too: add `E2E_ALL=1 --project=firefox --workers=1` (or webkit); more workers run out of memory.

## 1. Direction

The game benchmarks the mechanics of Airport CEO and gives them its own flavor:

* Mirrored mechanics: prefab stands that must connect to a taxiway, a weekly flight planner, drawn service roads, vehicle depots, a fuel farm, hired staff, franchise tenants and incidents with choices.
* Own flavor: real world scale, free or grid placement, real aircraft data, and procedural airlines, destinations, tenants and events, so no two seeds play alike.
* Only mechanics and player experience are mirrored. No art, text or screenshot of that game enters this repository.

`docs/DESIGN_REVISION_4.md` holds the rules. Its 33 values (D1 to D33, listed in `handoff/QUESTIONS.md` under 2026-11-12 T58) are accepted as recommended by the owner on 2026-11-12. D9 and D12 were set by the user directly. Each value moves into `src/data` with a zod schema in the task that first uses it.

## 2. How to use this file

* Work goes phase by phase, top to bottom. Inside a phase, take the first `todo` task whose dependencies are `done`.
* Status values: `done`, `doing`, `todo`.
* A task gets a spec only when it starts. The `grill-me` interview settles the open decisions, and the result is written to `handoff/tasks/<id>.md`. When the task closes, its decisions go to `docs/ARCHITECTURE.md` section 12, its row here is set to `done` with the commit hashes, and the spec and work notes are deleted. Git keeps the history.
* The specs already in `handoff/tasks/` for `todo` tasks were written before the revamp. Treat them as drafts and refresh them against design revision 4 when the task starts.
* A phase closes when every exit criterion is seen working in the dev build and the full `npm run verify` is green.
* The "Replaces" column names older task ids whose content the task absorbs. Their old specs can be read with `git show 16e5468:handoff/tasks/<file>`. The old milestone checklist is `git show 16e5468:docs/ROADMAP.md`.
* Bugs passed with notice or skipped as minor are logged in `handoff/BACKLOG.md`, per the bug triage rule in `CLAUDE.md`.

## 3. What is built (2026-11-23, after T82, T50 and T45)

A player can start a seeded game, buy land, build an airport, sign airlines and watch flights operate. Aircraft move at twice real time at speed 1 and a game day takes 60 real minutes. People walk along their routes in lanes with spacing and stand spread out where they wait. Terminals are zoned into Public, Secure, Commercial, Staff and International areas joined only through security lanes, security exits, eGates, customs and staff doors, with a zones overlay that shows breaches. Every transition fixture places a block of its exit zone past its exit and of its entry zone before its intake, its ghost labels the intake and the exit, and its exit badge pulses until the zone beyond is carried on; clicking a fixture or prop selects only that item. Passengers travel in groups of individuals who get hungry, thirsty or tired, visit shops, seats and toilets airside and rejoin their group, and their satisfaction drives the airport rating. Arriving passengers walk from the gate through immigration (international flights), baggage claim and customs to the curb, and their satisfaction counts in the rating. International departures queue at passport control in departure mode after security, and airlines offer and fly international routes only once a terminal holds the whole international flow (departure and arrival passport control, an international gate desk and customs). Bags travel between the bays and the aircraft on tractor trains that reverse into bay slots, bays need a service road, and a Baggage load overlay shows the belts. Domestic arrivals queue at a security exit whose rate follows its level before they reach the claim. Check in desks, 16 m security lanes, passport control and gate desks come in three levels that serve faster and cost more, placed at any level or upgraded in place through works that close the fixture, with a cancel and full refund; premium passengers want a level 3 check in and get a priority lane at a level 3 gate desk. Players furnish terminals with 100 kit props on a 0.5 m grid (seating, lounge, washroom, decoration, vending, screens, service, office and back of house) from a Furnishing menu; props block walking, washroom props of a room are its toilets, and seats and decoration raise the rating. Every fixture and prop turns in quarter turns and needs a clear use area (the side people use, and the staff side of desks) that its ghost shows hatched beside its true size sprite and that placement checks; queues start on the front side. Placed fixtures and props are selected to move, turn or remove them, a Remove card in the terminal menu takes the item under the cursor, and one undo history covers airfield and terminal edits alike. Travelator pairs of 8, 16 and 24 m from a Circulation tab carry people faster along their length. Terminal rooms get dirty as passengers use them, and cleaners based in janitor rooms walk to the dirty rooms from the nearest base and clean them, so terminal cleanliness counts in the rating. Security exits are staffed by an officer and run at half rate without one. Every airline turnaround needs an apron crew from the depot pool, drawn beside the nose, and waits at chocks with a ramp crew delay when none is free. Shops are tenant units: the player zones a rectangle of terminal floor for a convenience shop, quick food, cafe, bar, books and gifts or pharmacy, brands generated per seed apply for it, and the accepted tenant furnishes it and pays rent per m2 plus a share of the sales counted from real visits; advertising campaigns buy extra applications and the brand pool grows with yearly passengers. Vending machines are small shops that meet hunger, thirst or the shop want and give the airport a share of their sales, ad totems and LED walls earn per daily passenger, and flight boards and signs raise the wayfinding part of the rating. Every game day a seeded event director draws one event from a data deck (rain, fog, strong wind, fuel delivery delay, vehicle breakdown, VIP flight, diversion, staff shortage); an event card offers two choices with their cost, and the cheaper fallback applies after 2 game hours, so preparing for weather, paying for priority fuel, repairing a vehicle, hosting a VIP, accepting a diverted aircraft or paying overtime each trade money against service. Games start from a two step new game panel (site with a preview mini map, then airport name, codes and brand color) as a career or a sandbox with unlimited cash and the whole site owned, over a demo airport behind the main menu; the pause menu saves into the current slot or as a new named slot, and the load screen shows save cards with a map thumbnail that load, rename, duplicate and delete. Save format version 42.

| Area | Built |
| --- | --- |
| Foundation | Deterministic sim in a worker, fixed timestep, command log and replay, saves with migrations, autosave, export and import, crash panel, quality governor, CI with lint, tests, stress and Playwright in three engines |
| Site | Seeded terrain, parcels with purchase, wind, climate, city, two presets, minimap and camera |
| Airfield | Runways with works, taxiways with the revision 2 pavement generator, holding points, rapid exits, parallel taxiway prefab, aprons as merging polygons with remove and extend tools, single stands in four sizes that face and snap onto the nearest taxiway with R rotation, pass through stands that aircraft leave forward along a lead out to a taxiway ahead of the nose (or by push back without one), with the taxi through markings of the sheet, a lead in fork, a taxiway clearance check, their own paved slot, GA, commercial and cargo toggles and a taxiway connection line in the inspector, stand markings that follow the surfaces sheet (wing stop outline, double restraint line, stop ladder, push limit, emergency, no parking, GSE and GPU zones, zebra and STOP on the service road, GA marks per surface), red and amber connection badges on the map, GA blocks, turn pads (look frozen), obstacle surfaces, wingtip envelopes, construction grid with snapping, a marker and tooltip for every snap target in the runway, taxiway, apron and stand tools, taxiway segments drawn by press and drag, alignment guides that name what they follow and snap to the crossing of two guides, rectangles placed by click, move, click with a build confirmation, one Apron menu with build, extend and remove, aprons that join a taxiway with a paved shoulder and dashed edge, runway junction lead ins and fillets for any taxiway drawn onto a runway, a road stub ghost with the nearby road points, undo and redo |
| Aircraft and movement | 10 aircraft types with sprites in four tiers, taxiing along the painted bend and junction curves, taxi network with conflict sets, routing, reservations, junction priority, push back, deadlock handling, performance checks, wake separation |
| ATC | Free standing tower with five levels and a movement budget per runway |
| Terminal | Free size building on a 2 m grid, walls, doors, zones, room validation, check in, kiosk, bag drop, security, passport booth, gate desk, six shop fixtures, floor index in the data model. Furnishing props on a 0.5 m grid with wall and desk mounts, a walking block, washrooms as toilet nodes and comfort and ambience in the rating. Check in, kiosk, bag drop, security, passport, gate desk and every prop are drawn from the terminal asset kit with detail tiers and shadows, the four leveled families in the art of their level, and fixtures under works hatched. Fixtures and props are moved, turned and removed after placing, with sprite ghosts and use areas (T85). Baggage: screening machines in staff screening rooms, bays on the exterior wall and carousels placed with a baggage tool and drawn from the kit, linked automatically under the floor; departure bags flow from the desks through screening to the bay of the flight's stand, loading waits up to 15 minutes for late bags and lost bags lower satisfaction, arrival bags reach the carousel of the stand's bay; node and stand inspectors show bays, carousels, connections and warnings. Carousels come in three sizes and old belts become carousels on load. Bays need a road from a depot to the point beyond their staging lanes; tractor trains take arriving bags from the stand to a bay slot and departing bags from a slot to the aircraft, and a stand whose bay no train reaches loses its bags. The Baggage load overlay draws the under floor belts by load with flow chevrons and buffer rings. Clicking a placed fixture or prop opens a popup with Relocate, Rotate and Demolish (with a confirm), also in the inspector; a check in desk's bag chute sits behind it and shows in the ghost |
| Passengers | Departing cohorts by profile, walking graph, service nodes and queues, journey from curb to boarding, people atlas with 30 recipes, density, queue and walking distance overlays, arriving cohorts through immigration, baggage claim and customs to the curb |
| Staff | Airport staff as individuals with a role, shift and station: check in and gate agents, security officers and border officers work three shifts of 8 hours from the staff center, hired automatically within a cap per role, with breaks covered by a relief. A desk or lane with nobody on it serves no one, one officer on a two officer lane serves at half speed, and a screening machine needs an officer. Staff are drawn behind their desks and walking in uniform, wages follow the hired staff, a staffing coverage overlay shows each station by the percent short, and the Staff sheet in the staff category sets the cap per role. Security exits need one officer (half rate without), apron crews of two work from the depot for each airline turnaround, and cleaners from janitor rooms keep the terminal rooms clean (T81). Save format 38 |
| Flights | A destination network of 80 generated airports per seed, airlines that sign with flight series on fixed weekdays, a weekly planner with day tabs where one drop places a series on all its days, an auto planner, airline satisfaction with cancellations, renewals and new airlines approaching as stars grow, flights board, general aviation arriving on its own |
| Ground handling | A ground handling depot that stores the fleet (24 vehicles each, a starter set on build) and service roads the player draws, joined to the road strips of contact stands, with hold lines where they cross a taxiway. Vehicles leave the depot, drive the road keeping right and giving way at junctions and to aircraft at crossings, take stand paths that never cross the aircraft to door positions from data, and drive home. Tractors tow 1 to 4 carts by stand size. A commercial stand with no road from a depot turns around 25 percent slower and shows an amber badge. Supporting buildings: a fuel farm with tanker deliveries that sells fuel and holds flights it cannot fuel, a fire station whose vehicles set the fire category that airline types need after a 7 day grace, a catering unit that sends its own trucks, and a staff center, cleaning depot and maintenance workshop that wait for later tasks. Aircraft stop with the nose gear on their stop line. Airline turnarounds run a task list (chocks, power, stairs, deboarding, unloading, cleaning, catering, fuel, water and waste, loading, boarding, doors) whose vehicle tasks wait for a docked vehicle of the owned fleet, and the flights board shows each delay with its cause and whether the airport or the airline owns it. GA keeps a fixed turnaround time. Stand upgrades through works: a hydrant pit fuels by dispenser, fixed ground power replaces the GPU, a bus bay lets a stand far from its gate board by bus. The stand inspector assigns the gate desk |
| Business | Seven generated airline slots with rating gates, contracts and fees, stars from passenger and airline experience (cleanliness and ground handling included), daily ledger, one term loan, tenant units with generated brands, applications, campaigns, rent and sales share (T32), ratings, a seeded event director with a deck of eight events and two choices each (T50) |
| UI | Main menu over a demo airport, a two step new game panel, career and sandbox modes, named saves with thumbnail cards, settings, credits and a full pause menu (T35), build flyouts beside the left rail, an alert center with grouped alerts and a jump to the stand, an overlay list with every overlay and map layer (T36), top bar, tool rail, build menu, context bar, inspectors, sheets, toasts, guided start checklist |


## 4. MVP 1 phases

MVP 1 ends with the acceptance task T38.

| Phase | Theme | Tasks | Status |
| --- | --- | --- | --- |
| 0 | Repair | T57, T58, T69 | done |
| 1 | Stands and flight planning | T59, T47, T61, T62, T72, T70, T71 | done |
| 2 | Ground handling | T60, T64, T65, T63, T43, T66, T78 | done |
| 3 | People | T54, T67, T20, T68, T79, T80, T81 | done |
| 3b | Terminal kit | T73, T74, T75, T76, T77 | done |
| 4 | Tenants and events | T32, T82, T50 | done |
| 5 | Shell and release | T35, T36, T45, T37, T84, T85, T86, T87, T38 | doing |

Phase 3 depends only on finished work until T20, so T54 and T67 may run in a second session beside phase 1 or 2. Phase 3b depends only on finished work and may run beside phase 2 or 3. Every other phase waits for the one before it.

### Phase 0. Repair

Goal: the current game is visually clean before new mechanics land on it.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T58 | Design revision 4 and its decision batch |  |  | done |
| T57 | Visual repair: stand clearance against taxiways, continuous lead in paint, vehicles outside the aircraft footprint with shadows, apron remove and extend tools, stands that pave their own box |  |  | done fc6109e d7a327b eff1eda 09798a2 16e5468 c064f8c 7ec0edc cf7887c ccb2eb8 b55fc1a. Leftovers in `handoff/BACKLOG.md` |
| T69 | Housekeeping after T57: legacy plan files, finished specs and reports, unused functions and strings deleted |  | T57 | done |
| TIME1 | Game speed: motion at twice real time at speed 1, calendar 12 times faster than motion, turnarounds and waits rebalanced, save version 15 |  |  | done 9008a32 |

Exit, met on 2026-11-12: no parked aircraft breaks a taxiway, no vehicle is drawn through an aircraft, aprons can be cut and extended, and this file is the only plan in the repository.

### Phase 1. Stands and flight planning

Goal: stands become prefabs in four sizes, and flights are planned by the week from generated airlines and destinations.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T59 | Stand sizes small to extra large with nose in or pass through layout, GA, commercial and cargo toggles, single placement with rotation, lead in snapping to a centerline, live connection states, save migration (revision 4 section 2.1 to 2.4, user answers of 2026-11-17) |  | T57 | done 5bb09f6 0689ecf b7e005a. Pass through moved to T72, map icons to T47 |
| T47 | Stand markings per design revision 3, regenerated from class, access type and upgrades, with connection state icons on the stand and the box drawn on stands with no lead in (moved from T59) |  | T59 | done df63182. Taxi through markings moved to T72, MARS stays MVP 2 |
| T61 | Weekly planner and flight series with a seven day stand timeline, auto planner, rotations migrated to daily series (section 3.1, 3.2, 3.5) | T41 model, T31 | T59 | done 460015f. Built with T62 |
| T62 | Procedural destination network, generated airlines, series offers that grow with the rating, airline satisfaction (section 3.3, 3.4). Keep invented names and fleets limited to the MVP 1 types | T30, T31 | T61 | done 460015f. Cleanliness joins the rating in T63 |
| T72 | Pass through stands in all four sizes: layout picker in the stand tool, a lead out from the nose to a centerline ahead, departure forward with no push back, never a jet bridge, and the taxi through markings of `surfaces_stands.png` (lead in and out line with arrow, marshaller spot, fuel truck box, zebra walkway, bus only bay) (user, 2026-11-17, split from T59 and T47) |  | T59 | done a24faca fed30a7. Price assumed equal to remote |
| T70 | Snap markers and tooltips for every snap kind in the runway, taxiway, apron and stand tools; press and drag draws a taxiway segment (user, 2026-11-16) |  | T59 | done 3c7fd45 |
| T71 | Taxiway sections: a taxiway splits into separate records at every junction when one is built, with no seam in the pavement (user, 2026-11-16) |  | T59 | done 3875d8d |

Exit: a new seed offers its own airlines and destinations, a series dropped once appears on all its operating days, a stand shows why it cannot be booked, and old saves load with their flights intact.

### Phase 2. Ground handling

Goal: vehicles live in buildings, drive on roads the player draws, and service each aircraft through a task list.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T60 | Service roads and apron lanes as a graph with reservations, one connection point per stand, trailer kinematics with an off tracking test (section 4) | T24, T25 | T59 | done 0239289 da11972. The ground handling depot of T65 came with it (user). Vehicles join saves in T63 |
| T64 | Footprints, keep out zones, the collision test over every stand class and type, draw order. T57 delivers the hard footprint, this task finishes the port of `gse.py` | T26, T27 | T60 | done 1ca67d1 |
| T65 | Supporting buildings (the ground handling depot was built in T60): fuel farm with stock and road tankers, catering unit, fire station with categories, staff center, cleaning depot, maintenance workshop (section 5) | depot part of T24 | T60 | done 73174f8 315ea48. Fire grace, fuel liters per type and building upkeep from the 2026-11-18 answers |
| T63 | Turnaround task lists per type with dependencies, docking poses per service point, delays shown with their cause and whether the airport or the airline owns it (section 4) | T22, T23 | T64, T65 | done be7ab3f 3061721. No aircraft inspector yet, so the cause shows on the flights board only |
| T43 | Baggage network per `docs/BAGGAGE.md`: drop points, screening machines in a screening room, bays assigned to stands, carousels, automatic under floor links (rules A to F, reference `baggage_links.py`), ramp stubs, connections tab read only, kit sprites from `baggage_kit.png` |  | T63, T73 | done 52b5dc9 edce24e 3bf0641 0246863 e2c4b21 7c80403 70504ac 841ba11 ab77477. Road connection of bays, tractor trips from bay slots, the baggage overlay and the legacy belt migration moved to T78 |
| T66 | Stand upgrades through works (five jet bridge access types, stairs and bus bay, hydrant pit, fixed ground power) and stand assignments for gate, desk, chute and carousel (section 2.5, 2.6). The jet bridge painter was removed until bridges are built here; restore it from git history (`paintBridges` in `standPaint.ts`) | T48, T23 | T59, T43 | done fcde332 788b3f5 acc32f3 5880d8f. Jet bridges wait for T51 (owner, 2026-11-18) |
| T78 | Baggage follow up: bay truck edge connected to the service road graph with the Not connected state, tractor and cart trips between bay slots and stands, the baggage overlay and alerts of `docs/BAGGAGE.md` section 6, the legacy belt to carousel migration, a busy baggage stress scenario, ramp stub visual tests |  | T43 | done f185429 a6df777 6d0e46a 277e4d7 ea1e414 23a1b56 0fc6a69. Stress runs 20 stands, not 50 aircraft (backlog) |

Exit: a turnaround runs from depot to stand and back with no vehicle crossing an aircraft, a missing vehicle or empty fuel farm delays the flight with a visible cause, bags reach the aircraft and the carousel, and passengers board by bridge, stairs or bus.

### Phase 3. People

Goal: passengers and staff are individuals with needs, carried on the cohort substrate.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T54 | People walk and dwell along routes with spacing (needs a from node in the cohort store and a save migration) |  |  | done (a1cfacb, 447a52d, e99916b, 249af37, eae575b, 43ea83e, a70cf08, f04ae5f) |
| T67 | Individuals inside cohorts: traits, needs evaluated at decision points, sub cohorts, satisfaction per member rolled up to the airport rating, the stress scenario with 20 000 cohorts and 40 000 people under the 4 ms medium budget (section 6.1 to 6.3) | T17, T18 | T54 | done (481bbbf, 4e49b2e, cc9cf61, 91a82d5, b01dce2, 5044c11, 89a81fb, c3b2713, eea142f) |
| T20 | Arrival journey with immigration (passport control or automated gate in arrival mode), baggage claim and the customs channel (`docs/TERMINAL_ZONING.md` section 3) |  | T67, T43, T75 | done (1cecc8b, 3a25cf8, 738d95e, a137b13, 39fa3db, 3759a93, 8e10e55, c797be8, 868dcdb, 09034c2, 6477ba9, 8522eb1) |
| T79 | International departures through passport control in departure mode: departing international passengers queue at a passport booth or eGate set to departure mode after security, and international flights need the full international flow (owner, 2026-11-22) |  | T20 | done fb7d688 |
| T80 | Security exit throughput as a queue: security exits become service nodes with a rate, so arrivals and exiting passengers wait at a busy exit |  | T20 | done 6553d28 |
| T68 | Staff as individuals with role, shift, home building and breaks, staff sprites, automatic staffing with a coverage overlay (section 6.4) | T28, T33 | T67, T65 | done (4915887, caa76a0, 0e440f2, c4ff0cc, 3561b13, f07ecbe, 3da6df3, 4a5bb20, 5a93613, 02f16e1, 6c47c6b, d4cd9f4, 9a13ebf, e57015f, cd1cd44, d0d4df8, fcbef61) |
| T81 | Staff follow up, core three (owner, 2026-11-23): apron crews on turnarounds, cleaners based in janitor rooms with dirt per room (cleaning response grows with distance to the nearest one, T77), staffed security exits |  | T68 | done 79ea178 59f82b6 b960142 25e1037 0b0b37b. The rest moved to T83 |

Exit: a passenger who gets hungry leaves the group, visits a shop and rejoins at the gate, arriving passengers collect bags and leave, staff change shifts at the staff center, and the rating reacts to all of it.

### Phase 3b. Terminal kit

Goal: the terminal looks and plays like the kit sheets: every fixture and prop drawn from `src/data/fixtures/`, fixtures in three levels, zones with real transitions, furniture with effects. Design: `docs/DESIGN_REVISION_5.md`, `docs/TERMINAL_FIXTURES.md`, `docs/TERMINAL_ZONING.md`. Draft specs in `handoff/tasks/T73-fixture-baker.md` to `T77-circulation.md`.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T73 | Fixture sprite baker: port `fixture_ops.py` to `src/render/sprites/fixtureSprite.ts`, lazy loaded sprite packs, tiers, shadows per rotation, airline livery, chunk cache; today's check in, kiosk, bag drop, security, passport, gate desk, seating and toilet fixtures drawn from the kit |  |  | done 2a746e8 bece34b ad1a020. Security keeps its block until T74 gives it the kit footprint |
| T74 | Fixture levels 1 to 3 for check in, security, passport control and gate desk: level per fixture in the grid and saves, in place upgrade through works, inspector upgrade button, values from the catalog | T44 fixture part | T73 | done 07cd504 cb5c28d 028ab7d. Security lane now 2 by 8 cells; old one cell lanes removed with a refund on load. Remote screener waits for T81 |
| T75 | Zoning revision: international zone, transition fixtures with direction, security exit in three levels, automated passport gate, customs channel, staff door wall type, breach validation in the walking graph, zones overlay with badges |  | T73 | done (c3ae229, 6bc0b5a, 03c5680, 9cd5af5, 49c4c36, 2074618, 337023d, c351408, 4f27e99, 8fba5f3, ee3e0f1, 03c66ea, b4fac60) |
| T76 | Props on a 0.5 m sub grid: seating, lounge, washroom, decoration, vending, screens, service, office and back of house items from the catalog, with comfort, ambience, wayfinding, charging, washroom capacity and staff room effects |  | T73 | done (193402e, 7faea2f, af395ad). Seating and toilet fixtures are props now and convert on load; vending, ads, wayfinding, charging and office effects moved to T82 |
| T77 | Circulation and back of house: escalators, stairs, elevators and travelators placed and drawn, travelators speed walking on one floor, janitor room as the cleaners' base; vertical links wait for T51 |  | T76 | done (2290e2f, cfa8b9d, 8f2fda1). Travelators in 8, 16 and 24 m pairs; escalators, stairs and elevators stay hidden until T51; janitor rooms are validated and wait for the cleaners of T81 |

Exit: the dev build shows a terminal that matches `docs/art/terminal_scene_kit.png` at 14 px per meter, an upgrade turns a level 1 desk into level 3 in place, a passenger can leave the secure zone only through a security exit, and a breach is reported and blocks walking.

### Phase 4. Tenants and events

Goal: the commercial side and the daily surprises come from generators, not fixed lists.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T32 | Tenants: zoned units, generated brands that apply, furnishing from templates, advertising, sales counted from individual visits, existing shop fixtures migrated (section 7.1, 7.2) |  | T67 | done b512a12 dfd1516 |
| T82 | Prop effects left from T76 (owner, 2026-11-23): vending machines as small shops with a sales share, ad income from ad totems and the LED wall, wayfinding from flight boards. Office workplaces and pantry effects moved to T83, the charging want dropped |  | T76, T32, T81 | done 8a0d007 |
| T50 | Seeded event director with the first deck of eight events, two choices each and a fallback (section 7.3) |  | T65, T68, T61 | done 213c9ff |

Exit: two seeds show different brands, shop income follows real visits, and each event of the deck can be played through both choices.

### Phase 5. Shell and release

Goal: MVP 1 is complete and proven in a long session.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T35 | Main menu, new game wizard, load screen, settings and pause menu per `docs/UI_DESIGN.md` |  | phase 4 | done 55c076d 5c7b654 |
| T36 | Left rail flyouts, alert center, overlay list |  | phase 4 | done 03d9bcd |
| T45 | Asset sharpness at maximum zoom: diagnose, then fix |  |  | done caa064b |
| T37 | Playwright smoke and visual tests in three engines |  | T35, T36 | done 729bd39 |
| T84 | Build tool feedback (owner, 2026-11-24): taxilane snapping, alignment guides from real edges with crossing guides, apron and taxiway pavement merge with a dashed edge, runway junction lead ins and fillets for drawn taxiways, one Apron menu, click move click rectangles, a road stub ghost at the cursor, aircraft taxiing along the painted turn curves |  | T36 | done e00dfd2 45a3b14 d226ff9 b50b0c4 e35e5a1 |
| T38 | MVP 1 acceptance: every exit criterion above holds, a 3 hour session at 4x runs without errors or budget breaches |  | all | doing (automated part done: verify, soak 765bbd5, three engines; waits for the owner's 3 hour session, `handoff/work/T38.md`) |
| T85 | Terminal editing: shared undo across airfield and terminal, select, move, rotate and demolish placed fixtures and props, sprite ghosts with use areas, rotation for every fixture, readable walls, back to back bench facing |  |  | done 5a8ff4f 5a50b72 ca853f8 218c80a 1eb7d56 84c8da4 fa0dff6 |
| T86 | Fixture placement fixes (owner, 2026-11-24): the check in bag chute follows the desk rotation and sits behind it, the ghost shows the chute, the desk agent stands at the chair, clicking a desk selects it, a popup at a picked fixture or prop with Relocate, Rotate and Demolish (with a confirm), the legacy 1 cell reclaim belt leaves the build menu |  | T85 | done 136d946 f7ef682 |
| T87 | Transition fixtures and fixture selection (owner, 2026-11-24): clicking a fixture or prop selects only it (outline and inspector titled with its name), every transition fixture places 2 cells of its exit zone past its exit and 2 cells of its entry zone before its intake, the ghost shows the intake, the exit and those zone blocks, a reminder after placing, the zones overlay while the terminal tool is open and a pulsing exit badge until the zone past it is extended |  | T86 | doing |

Exit: T38 passes.

## 5. Out of MVP 1

Moved to MVP 2:

* Multi floor terminal designer (T51), baggage levels, transfers and bridges (T46), hangars (T52), cargo (T53).
* Architecture variants (T44). Fixture variants are covered by the levels of T74.
* Preconditioned air and docking guidance as stand upgrades, duty free as a tenant category, de-icing pad, car rental, bus station.
* The remaining 32 Phase 1 aircraft, MARS and cargo stands, international scope airlines.
* Loans beyond one term loan, credit rating, fuel forward contracts, full reports.
* Staff morale, fatigue, training and strikes, ATC options, the full event deck.
* T83, the rest of the staff follow up: staff screening queues on staff routes, morale, fatigue beyond the break, sick leave, training and the yearly wage index, plus the office workplaces and pantry effects on staff moved from T82 (owner, 2026-11-23).
* Full landside: road tools, curbside, parking, rail and bus stations, multiple terminals, progression stages.

Dropped until asked for again:

* Grading tool with cut and fill (T03), photo calibration overlays (T07), the runway marking remainder (T02). Design revision 3 replaces their look and proportion targets.
* Seasonal slot requests and the rotation model (old T31 and T41), replaced by flight series.
* Milestone review tasks (T04, T10, T19, T29, T34), replaced by the phase exit criteria.

Release 1.0 and content updates, unchanged in intent: full tutorial, third terrain preset, accessibility, offline play with a service worker, visual regression suite, large scenario under budget, then aircraft phases 2 to 5, night lighting, seasons and scenarios on fixed seeds.

## 6. Finished tasks

Kept as a short record. Details are in the commit history and in `docs/ARCHITECTURE.md` section 12.

| Ids | Content |
| --- | --- |
| M0, M1 | Scaffold, site, land and camera |
| T01, T39 | Turn pad tool, pads beyond the threshold |
| T42 | Construction grid and snapping |
| T05, T06 | Aircraft sprite port, liveries and tiers |
| T08, T09 | Network conflict sets, junction priority |
| T40 | ATC tower with levels and movement budget |
| T41 | Flight offers and the stand timeline (the timeline is reused by T61) |
| T49, T11 | Floor index, kiosk, bag drop, passport booth and gate desk |
| T12, T13, T14 | Walking graph, service nodes and queues, cohorts and the departure journey |
| T15, T16 | People atlas rendering, terminal overlays |
| T55 | General aviation traffic |
| T58 | Design revision 4 |
| T57 | Visual repair: stand clearance, apron tools, vehicle docking paths and shadows |
| T69 | Repository cleanup after the revamp |
