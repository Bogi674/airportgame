# ROADMAP.md

The single plan for Airfield Tycoon: what is built, what is left for MVP 1, and in which order. Scope and status live here and nowhere else. Design lives in `docs/`, starting with `docs/DESIGN_REVISION_4.md`.

Last restructured on 2026-11-12, after the revamp brief.

## Next session: start here

1. Read `CLAUDE.md`, then this file.
2. Phase 1 is done (2026-11-17). T60, T64, T65, T63, T73, T43 and T66 are done (2026-11-18). Phase 2 closes with **T78** (baggage follow up). Run the `grill-me` skill and write the spec first.
3. Build on what T59 and T47 left: `src/shared/standSnap.ts` (single stand snapping), `Stand.accepts`, the marking layout in `src/render/markings/standLayout.ts` (`sheetFunnel`, `frontZones`) with its painter in `standPaint.ts`, and the map badges in `src/render/standStates.ts`.
4. Findings for T71 from the 2026-11-16 session are in `handoff/work/SESSION-2026-11-16.md`.
5. A second session may take **T54** (people walk and dwell along routes) at the same time. It touches the cohort store and the people renderer only.
5a. Phase 3b, the terminal kit (T73 to T77, `docs/DESIGN_REVISION_5.md`), depends only on finished work and may also run in a second session. Its assets are already in `src/data/fixtures/` with reference sheets in `docs/art/`. Start with T73.
6. Known leftovers are in `handoff/BACKLOG.md`, known limits in `docs/ARCHITECTURE.md` section 13.
7. Browser tests in the cloud session run with `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --project=chromium --trace off`.

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

## 3. What is built (2026-11-18)

A player can start a seeded game, buy land, build an airport, sign airlines and watch flights operate. Aircraft move at twice real time at speed 1 and a game day takes 60 real minutes. People walk along their routes in lanes with spacing and stand spread out where they wait. Save format version 27.

| Area | Built |
| --- | --- |
| Foundation | Deterministic sim in a worker, fixed timestep, command log and replay, saves with migrations, autosave, export and import, crash panel, quality governor, CI with lint, tests, stress and Playwright in three engines |
| Site | Seeded terrain, parcels with purchase, wind, climate, city, two presets, minimap and camera |
| Airfield | Runways with works, taxiways with the revision 2 pavement generator, holding points, rapid exits, parallel taxiway prefab, aprons as merging polygons with remove and extend tools, single stands in four sizes that face and snap onto the nearest taxiway with R rotation, pass through stands that aircraft leave forward along a lead out to a taxiway ahead of the nose (or by push back without one), with the taxi through markings of the sheet, a lead in fork, a taxiway clearance check, their own paved slot, GA, commercial and cargo toggles and a taxiway connection line in the inspector, stand markings that follow the surfaces sheet (wing stop outline, double restraint line, stop ladder, push limit, emergency, no parking, GSE and GPU zones, zebra and STOP on the service road, GA marks per surface), red and amber connection badges on the map, GA blocks, turn pads (look frozen), obstacle surfaces, wingtip envelopes, construction grid with snapping, a marker and tooltip for every snap target in the runway, taxiway, apron and stand tools, taxiway segments drawn by press and drag, undo and redo |
| Aircraft and movement | 10 aircraft types with sprites in four tiers, taxi network with conflict sets, routing, reservations, junction priority, push back, deadlock handling, performance checks, wake separation |
| ATC | Free standing tower with five levels and a movement budget per runway |
| Terminal | Free size building on a 2 m grid, walls, doors, zones, room validation, check in, kiosk, bag drop, security, passport booth, gate desk, seating, toilets, six shop fixtures, floor index in the data model. Check in, kiosk, bag drop, passport, gate desk, seating and toilets are drawn from the terminal asset kit with detail tiers and shadows. Baggage: screening machines in staff screening rooms, bays on the exterior wall and carousels placed with a baggage tool and drawn from the kit, linked automatically under the floor; departure bags flow from the desks through screening to the bay of the flight's stand, loading waits up to 15 minutes for late bags and lost bags lower satisfaction, arrival bags reach the carousel of the stand's bay; node and stand inspectors show bays, carousels, connections and warnings |
| Passengers | Departing cohorts by profile, walking graph, service nodes and queues, journey from curb to boarding, people atlas with 30 recipes, density, queue and walking distance overlays |
| Flights | A destination network of 80 generated airports per seed, airlines that sign with flight series on fixed weekdays, a weekly planner with day tabs where one drop places a series on all its days, an auto planner, airline satisfaction with cancellations, renewals and new airlines approaching as stars grow, flights board, general aviation arriving on its own |
| Ground handling | A ground handling depot that stores the fleet (24 vehicles each, a starter set on build) and service roads the player draws, joined to the road strips of contact stands, with hold lines where they cross a taxiway. Vehicles leave the depot, drive the road keeping right and giving way at junctions and to aircraft at crossings, take stand paths that never cross the aircraft to door positions from data, and drive home. Tractors tow 1 to 4 carts by stand size. A commercial stand with no road from a depot turns around 25 percent slower and shows an amber badge. Supporting buildings: a fuel farm with tanker deliveries that sells fuel and holds flights it cannot fuel, a fire station whose vehicles set the fire category that airline types need after a 7 day grace, a catering unit that sends its own trucks, and a staff center, cleaning depot and maintenance workshop that wait for later tasks. Aircraft stop with the nose gear on their stop line. Airline turnarounds run a task list (chocks, power, stairs, deboarding, unloading, cleaning, catering, fuel, water and waste, loading, boarding, doors) whose vehicle tasks wait for a docked vehicle of the owned fleet, and the flights board shows each delay with its cause and whether the airport or the airline owns it. GA keeps a fixed turnaround time. Stand upgrades through works: a hydrant pit fuels by dispenser, fixed ground power replaces the GPU, a bus bay lets a stand far from its gate board by bus. The stand inspector assigns the gate desk |
| Business | Seven generated airline slots with rating gates, contracts and fees, stars from passenger and airline experience (cleanliness and ground handling included), daily ledger, one term loan, shop rent, ratings, weather events (rain, fog, strong wind) |
| UI | Main menu, new game, top bar, tool rail, build menu, context bar, inspectors, sheets, toasts, guided start checklist |

Simplified today and replaced by the phases below: rent only shops, staff as a number, arrivals as an aggregate, weather as the only event.

## 4. MVP 1 phases

MVP 1 ends with the acceptance task T38.

| Phase | Theme | Tasks | Status |
| --- | --- | --- | --- |
| 0 | Repair | T57, T58, T69 | done |
| 1 | Stands and flight planning | T59, T47, T61, T62, T72, T70, T71 | done |
| 2 | Ground handling | T60, T64, T65, T63, T43, T66, T78 | doing |
| 3 | People | T54, T67, T20, T68 | todo |
| 3b | Terminal kit | T73, T74, T75, T76, T77 | todo |
| 4 | Tenants and events | T32, T50 | todo |
| 5 | Shell and release | T35, T36, T45, T37, T38 | todo |

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
| T78 | Baggage follow up: bay truck edge connected to the service road graph with the Not connected state, tractor and cart trips between bay slots and stands, the baggage overlay and alerts of `docs/BAGGAGE.md` section 6, the legacy belt to carousel migration, a busy baggage stress scenario, ramp stub visual tests |  | T43 | todo |

Exit: a turnaround runs from depot to stand and back with no vehicle crossing an aircraft, a missing vehicle or empty fuel farm delays the flight with a visible cause, bags reach the aircraft and the carousel, and passengers board by bridge, stairs or bus.

### Phase 3. People

Goal: passengers and staff are individuals with needs, carried on the cohort substrate.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T54 | People walk and dwell along routes with spacing (needs a from node in the cohort store and a save migration) |  |  | done (a1cfacb, 447a52d, e99916b, 249af37, eae575b, 43ea83e, a70cf08, f04ae5f) |
| T67 | Individuals inside cohorts: traits, needs evaluated at decision points, sub cohorts, satisfaction per member rolled up to the airport rating, the stress scenario with 20 000 cohorts and 40 000 people under the 4 ms medium budget (section 6.1 to 6.3) | T17, T18 | T54 | doing |
| T20 | Arrival journey with immigration (passport control or automated gate in arrival mode), baggage claim and the customs channel (`docs/TERMINAL_ZONING.md` section 3) |  | T67, T43, T75 | todo |
| T68 | Staff as individuals with role, shift, home building and breaks, staff sprites, automatic staffing with a coverage overlay (section 6.4) | T28, T33 | T67, T65 | todo |

Exit: a passenger who gets hungry leaves the group, visits a shop and rejoins at the gate, arriving passengers collect bags and leave, staff change shifts at the staff center, and the rating reacts to all of it.

### Phase 3b. Terminal kit

Goal: the terminal looks and plays like the kit sheets: every fixture and prop drawn from `src/data/fixtures/`, fixtures in three levels, zones with real transitions, furniture with effects. Design: `docs/DESIGN_REVISION_5.md`, `docs/TERMINAL_FIXTURES.md`, `docs/TERMINAL_ZONING.md`. Draft specs in `handoff/tasks/T73-fixture-baker.md` to `T77-circulation.md`.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T73 | Fixture sprite baker: port `fixture_ops.py` to `src/render/sprites/fixtureSprite.ts`, lazy loaded sprite packs, tiers, shadows per rotation, airline livery, chunk cache; today's check in, kiosk, bag drop, security, passport, gate desk, seating and toilet fixtures drawn from the kit |  |  | done 2a746e8 bece34b ad1a020. Security keeps its block until T74 gives it the kit footprint |
| T74 | Fixture levels 1 to 3 for check in, security, passport control and gate desk: level per fixture in the grid and saves, in place upgrade through works, inspector upgrade button, values from the catalog | T44 fixture part | T73 | todo |
| T75 | Zoning revision: international zone, transition fixtures with direction, security exit in three levels, automated passport gate, customs channel, staff door wall type, breach validation in the walking graph, zones overlay with badges |  | T73 | doing |
| T76 | Props on a 0.5 m sub grid: seating, lounge, washroom, decoration, vending, screens, service, office and back of house items from the catalog, with comfort, ambience, wayfinding, charging, washroom capacity and staff room effects |  | T73 | todo |
| T77 | Circulation and back of house: escalators, stairs, elevators and travelators placed and drawn, travelators speed walking on one floor, janitor room as the cleaners' base; vertical links wait for T51 |  | T76 | todo |

Exit: the dev build shows a terminal that matches `docs/art/terminal_scene_kit.png` at 14 px per meter, an upgrade turns a level 1 desk into level 3 in place, a passenger can leave the secure zone only through a security exit, and a breach is reported and blocks walking.

### Phase 4. Tenants and events

Goal: the commercial side and the daily surprises come from generators, not fixed lists.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T32 | Tenants: zoned units, generated brands that apply, furnishing from templates, advertising, sales counted from individual visits, existing shop fixtures migrated (section 7.1, 7.2) |  | T67 | todo |
| T50 | Seeded event director with the first deck of eight events, two choices each and a fallback (section 7.3) |  | T65, T68, T61 | todo |

Exit: two seeds show different brands, shop income follows real visits, and each event of the deck can be played through both choices.

### Phase 5. Shell and release

Goal: MVP 1 is complete and proven in a long session.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T35 | Main menu, new game wizard, load screen, settings and pause menu per `docs/UI_DESIGN.md` |  | phase 4 | todo |
| T36 | Left rail flyouts, alert center, overlay list |  | phase 4 | todo |
| T45 | Asset sharpness at maximum zoom: diagnose, then fix |  |  | todo |
| T37 | Playwright smoke and visual tests in three engines |  | T35, T36 | todo |
| T38 | MVP 1 acceptance: every exit criterion above holds, a 3 hour session at 4x runs without errors or budget breaches |  | all | todo |

Exit: T38 passes.

## 5. Out of MVP 1

Moved to MVP 2:

* Multi floor terminal designer (T51), baggage levels, transfers and bridges (T46), hangars (T52), cargo (T53).
* Architecture variants (T44). Fixture variants are covered by the levels of T74.
* Preconditioned air and docking guidance as stand upgrades, duty free as a tenant category, de-icing pad, car rental, bus station.
* The remaining 32 Phase 1 aircraft, MARS and cargo stands, international scope airlines.
* Loans beyond one term loan, credit rating, fuel forward contracts, full reports.
* Staff morale, fatigue, training and strikes, ATC options, the full event deck.
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
