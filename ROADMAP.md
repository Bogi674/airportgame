# ROADMAP.md

The single plan for Airfield Tycoon: what is built, what is left for MVP 1, and in which order. Scope and status live here and nowhere else. Design lives in `docs/`, starting with `docs/DESIGN_REVISION_4.md`.

Last restructured on 2026-11-12, after the revamp brief.

## Next session: start here

1. Read `CLAUDE.md`, then this file.
2. The next task is **T59** (stand classes, placement, lead in snapping, connection states), the first task of phase 1. Its design is `docs/DESIGN_REVISION_4.md` section 2, with the values D1 to D4 in `handoff/QUESTIONS.md` (2026-11-12 T58) and the benchmark notes in `handoff/reference/benchmark-stands.md`.
3. T59 has no spec yet. Run the `grill-me` skill, then write `handoff/tasks/T59.md` (goal, read first, decisions, numbered requirements, acceptance criteria) and the plan in `handoff/work/T59.md`, as steps 0 to 3 of the workflow in `CLAUDE.md` describe.
4. Build on what T57 left: the stand slot math in `src/shared/standGeom.ts`, the clearance rule `standTaxiwayClash` in `src/shared/clearance.ts`, and stands that pave their own slot. T59 needs a save migration from the four sizes to the five classes.
5. Ask the user first about the one open point from T57: the interim turnaround crews (aircraft under 20 m get no belt loader set, GA turnarounds get a refueller only) wait for the user's confirmation, see `docs/ARCHITECTURE.md` section 12.
6. A second session may take **T54** (people walk and dwell along routes) at the same time. It touches the cohort store and the people renderer only, so it does not collide with T59.
7. Known leftovers are in `handoff/BACKLOG.md`, known limits in `docs/ARCHITECTURE.md` section 13.

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

## 3. What is built (2026-11-12)

A player can start a seeded game, buy land, build an airport, sign airlines and watch flights operate. Save format version 14.

| Area | Built |
| --- | --- |
| Foundation | Deterministic sim in a worker, fixed timestep, command log and replay, saves with migrations, autosave, export and import, crash panel, quality governor, CI with lint, tests, stress and Playwright in three engines |
| Site | Seeded terrain, parcels with purchase, wind, climate, city, two presets, minimap and camera |
| Airfield | Runways with works, taxiways with the revision 2 pavement generator, holding points, rapid exits, parallel taxiway prefab, aprons as merging polygons with remove and extend tools, stands in four sizes with a lead in fork, a taxiway clearance check and their own paved slot, GA blocks, turn pads (look frozen), obstacle surfaces, wingtip envelopes, construction grid with snapping, undo and redo |
| Aircraft and movement | 10 aircraft types with sprites in four tiers, taxi network with conflict sets, routing, reservations, junction priority, push back, deadlock handling, performance checks, wake separation |
| ATC | Free standing tower with five levels and a movement budget per runway |
| Terminal | Free size building on a 2 m grid, walls, doors, zones, room validation, check in, kiosk, bag drop, security, passport booth, gate desk, seating, toilets, six shop fixtures, floor index in the data model |
| Passengers | Departing cohorts by profile, walking graph, service nodes and queues, journey from curb to boarding, people atlas with 30 recipes, density, queue and walking distance overlays |
| Flights | Daily rotations offered per airline and dragged onto a stand timeline, automation toggle, flights board, general aviation arriving on its own |
| Ground handling | Eight vehicle types that spawn near the stand, approach on paths that never cross the aircraft and dock at door positions from data, with ground shadows. Aircraft stop with the nose gear on their stop line. A fixed turnaround time per role |
| Business | Seven fixed airlines with contracts and fees, daily ledger, one term loan, shop rent, ratings, weather events (rain, fog, strong wind) |
| UI | Main menu, new game, top bar, tool rail, build menu, context bar, inspectors, sheets, toasts, guided start checklist |

Simplified today and replaced by the phases below: vehicles without roads or depots, rotation based flights, fixed airlines, rent only shops, staff as a number, arrivals as an aggregate, weather as the only event.

## 4. MVP 1 phases

MVP 1 ends with the acceptance task T38.

| Phase | Theme | Tasks | Status |
| --- | --- | --- | --- |
| 0 | Repair | T57, T58, T69 | done |
| 1 | Stands and flight planning | T59, T47, T61, T62 | todo |
| 2 | Ground handling | T60, T64, T65, T63, T43, T66 | todo |
| 3 | People | T54, T67, T20, T68 | todo |
| 4 | Tenants and events | T32, T50 | todo |
| 5 | Shell and release | T35, T36, T45, T37, T38 | todo |

Phase 3 depends only on finished work until T20, so T54 and T67 may run in a second session beside phase 1 or 2. Every other phase waits for the one before it.

### Phase 0. Repair

Goal: the current game is visually clean before new mechanics land on it.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T58 | Design revision 4 and its decision batch |  |  | done |
| T57 | Visual repair: stand clearance against taxiways, continuous lead in paint, vehicles outside the aircraft footprint with shadows, apron remove and extend tools, stands that pave their own box |  |  | done fc6109e d7a327b eff1eda 09798a2 16e5468 c064f8c 7ec0edc cf7887c ccb2eb8 b55fc1a. Leftovers in `handoff/BACKLOG.md` |
| T69 | Housekeeping after T57: legacy plan files, finished specs and reports, unused functions and strings deleted |  | T57 | done |

Exit, met on 2026-11-12: no parked aircraft breaks a taxiway, no vehicle is drawn through an aircraft, aprons can be cut and extended, and this file is the only plan in the repository.

### Phase 1. Stands and flight planning

Goal: stands become prefabs in five classes, and flights are planned by the week from generated airlines and destinations.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T59 | Stand classes GA to extra large, free or grid placement with rotation, lead in snapping to a centerline, live connection states, save migration (revision 4 section 2.1 to 2.4) |  | T57 | todo |
| T47 | Stand markings per design revision 3, regenerated from class, access type and upgrades |  | T59 | todo |
| T61 | Weekly planner and flight series with a seven day stand timeline, auto planner, rotations migrated to daily series (section 3.1, 3.2, 3.5) | T41 model, T31 | T59 | todo |
| T62 | Procedural destination network, generated airlines, series offers that grow with the rating, airline satisfaction (section 3.3, 3.4). Keep invented names and fleets limited to the MVP 1 types | T30, T31 | T61 | todo |

Exit: a new seed offers its own airlines and destinations, a series dropped once appears on all its operating days, a stand shows why it cannot be booked, and old saves load with their flights intact.

### Phase 2. Ground handling

Goal: vehicles live in buildings, drive on roads the player draws, and service each aircraft through a task list.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T60 | Service roads and apron lanes as a graph with reservations, one connection point per stand, trailer kinematics with an off tracking test (section 4) | T24, T25 | T59 | todo |
| T64 | Footprints, keep out zones, the collision test over every stand class and type, draw order. T57 delivers the hard footprint, this task finishes the port of `gse.py` | T26, T27 | T60 | todo |
| T65 | Supporting buildings: ground handling depot, fuel farm with stock and road tankers, catering unit, fire station with categories, staff center, cleaning depot, maintenance workshop (section 5) | depot part of T24 | T60 | todo |
| T63 | Turnaround task lists per type with dependencies, docking poses per service point, delays shown with their cause and whether the airport or the airline owns it (section 4) | T22, T23 | T64, T65 | todo |
| T43 | Working baggage system on one level: belts, makeup chutes and carousels |  | T63 | todo |
| T66 | Stand upgrades through works (five jet bridge access types, stairs and bus bay, hydrant pit, fixed ground power) and stand assignments for gate, desk, chute and carousel (section 2.5, 2.6) | T48, T23 | T59, T43 | todo |

Exit: a turnaround runs from depot to stand and back with no vehicle crossing an aircraft, a missing vehicle or empty fuel farm delays the flight with a visible cause, bags reach the aircraft and the carousel, and passengers board by bridge, stairs or bus.

### Phase 3. People

Goal: passengers and staff are individuals with needs, carried on the cohort substrate.

| Id | Task | Replaces | Depends | Status |
| --- | --- | --- | --- | --- |
| T54 | People walk and dwell along routes with spacing (needs a from node in the cohort store and a save migration) |  |  | todo |
| T67 | Individuals inside cohorts: traits, needs evaluated at decision points, sub cohorts, satisfaction per member rolled up to the airport rating, the stress scenario with 20 000 cohorts and 40 000 people under the 4 ms medium budget (section 6.1 to 6.3) | T17, T18 | T54 | todo |
| T20 | Arrival journey with immigration, baggage claim and customs |  | T67, T43 | todo |
| T68 | Staff as individuals with role, shift, home building and breaks, staff sprites, automatic staffing with a coverage overlay (section 6.4) | T28, T33 | T67, T65 | todo |

Exit: a passenger who gets hungry leaves the group, visits a shop and rejoins at the gate, arriving passengers collect bags and leave, staff change shifts at the staff center, and the rating reacts to all of it.

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
* Fixture and architecture variants (T44).
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
