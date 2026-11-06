# T43. Baggage handling system (umbrella)

Milestone M5. Supersedes and extends T21. Roadmap lines: "Simple baggage network (belts with capacity and transit time) and carousels" (M5, line 107) and "Baggage sorting halls and detailed networks" (M10, line 158). This umbrella pulls the vertical, baggage only construction into MVP 1. No passenger floors are part of this task.

The user confirmed the scope below on 2026-11-06. The three open points from the 2026-11-05 T43 entry in `handoff/QUESTIONS.md` are now answered: baggage floors only, automatic routing, and the failure direction. Read that entry again when this task starts, and record the answers there if they are not yet written down.

## Goal

Bags are tracked as grouped batches per flight through a real baggage handling system the player builds. A departure bag leaves a staffed check in counter or a self service bag drop, travels through directed conveyors, junctions and splitters, passes a security scanner with reject separation, reaches the airside chute assigned to the flight's stand, is carried by a baggage tractor and carts to the aircraft, and is loaded by a belt loader into the correct aircraft. The arrival flow is the reverse. A bag always belongs to one flight and one stand window, never to whatever aircraft happens to stand there.

## Read first

* `handoff/tasks/T21-baggage.md` (this spec supersedes it), `handoff/tasks/T14-cohorts-departure.md`, `handoff/tasks/T20-arrival-journey.md`, `handoff/tasks/T22-turnaround-tasks.md`, `handoff/tasks/T24-service-roads.md`, `handoff/tasks/T25-trailers.md`, `handoff/tasks/T26-collision.md`, `handoff/tasks/T11-fixtures.md`, `handoff/tasks/T13-service-nodes.md`
* `handoff/QUESTIONS.md`, the 2026-11-05 T43 entry and the 2026-11-06 T40 entry that redefines flight scheduling
* `handoff/PITFALLS.md` items 1, 2, 4, 5, 6, 7, 8, 11, 13, 15, 16
* `handoff/RECIPES.md` R1, R2, R3, R4, R5, R6, R7, R8, R9, R11
* `docs/GAME_DESIGN.md` section 8 (fixtures table, journeys), section 10 (check in and baggage, ground handling, vehicle rules), section 6 (tools)
* `docs/ARCHITECTURE.md` sections 3, 5, 6, 7, 8, 12
* `docs/PERFORMANCE.md` sections 1, 2, 3
* `docs/ART_AND_ASSETS.md` sections 4.8, 5, 7, 11, 12, 13
* `docs/UI_DESIGN.md` section 6 (overlay list includes baggage load)
* `docs/ROADMAP.md` lines 95, 96, 97, 98, 104 to 115, 158

## Source and model inventory (verified 2026-11-06)

What exists, so no slice plans against something that is not there:

* `src/data/` holds `aircraft/aircraft.mvp.json`, `airfield_codes.json`, `business.json`, `gse.json`, `paint.json`, `stand_sizes.json`, `surfaces.json`, `wake.json`. There is no `turnarounds.json`, no `profiles.json`, no baggage file of any kind.
* `src/data/business.json` `modules` has six modules only: `checkIn`, `security`, `belt`, `seating`, `toilet`, `atc`. `belt` is cost 55000, capacity 260 per hour, staff 2. `business.json` `gse` prices ten vehicles including `tractor` 45000, `cart` 12000, `beltloader` 120000.
* `src/data/gse.json` lists ten vehicles with length, width, height, `docks`, `articulated`, `towedBy`. There are no hitch or axle offsets, no docking poses, no service points.
* `src/shared/business.ts`: `FIXTURE_KEYS` has 12 entries, `checkIn`, `security`, `belt`, `seating`, `toilet`, the six shops `convenience`, `quickFood`, `cafe`, `dutyFree`, `booksGifts`, `pharmacy`, and `atc`. There is no kiosk, bag drop, passport booth, gate desk, carousel or any baggage device. `isShopFixture` uses the id range 6 to 11. `WALL` is `None`, `Wall`, `Glass`, `Door`. `TerminalGrid` has `floor`, `zone`, `fixture`, `hWall`, `vWall`, `leased` and `cost`. There is no level or floor index layer anywhere.
* `src/sim/cohorts/` and `src/sim/terminal/` hold only `.gitkeep`. `src/sim/vehicles/` holds `gse.ts` and `.gitkeep`.
* `src/sim/ops/traffic.ts` (1642 lines): `MAX_FLIGHTS` 1024, per flight arrays `fState`, `fType`, `fLivery`, `fEta`, `fTurn`, `fAc`, `fDelay`, `fRetryAt`, `fAirline`, `fLate`, `fStage`, `fStand`, `autoStands`. Flights are identified by array index and a slot is reused as soon as its state is `Free` or `Done` (`scheduleArrival`, line 388). There is no flight serial. Stand choice is `standFits`, `standAllows`, `pickStand` (line 520), `autoAssign` (line 549). Turnaround timing is `updateTurnaround` (line 1318) and `planDeparture` (line 1328), driven by `ROLE_TURNAROUND_MIN` (line 35). `arrays()` is line 1647, `hash` is line 1720.
* `src/sim/business/business.ts`: `depCapacity` (line 327), `arrCapacity` (line 334, belt count times 260 per hour), `readiness` raises `noBelt` (line 283), `onDocked` (383), `onPushback` (412), `onDeparted` (439), `scheduleToday` (470), `setSlot` (184), `fitSlots` (803). `flightPax` and `flightDockedAt` are `Int32Array(1024)` indexed by flight index.
* `src/sim/vehicles/gse.ts`: vehicles are a presentation of the turnaround, they drive from 40 m beside the stand to a point in the aircraft frame, wait, and leave. They are not saved and not hashed, and they never change aircraft timing.
* `src/sim/sim.ts`: `SUBSYSTEMS` is `commands`, `clock`, `network`, `business`, `flights`, `aircraft`, `vehicles`. `docs/ARCHITECTURE.md` section 3 already assigns baggage and turnaround tasks a 10 tick cadence.
* `src/sim/save/migrations.ts`: `SAVE_VERSION` is 7. `src/sim/save/pack.ts` packs typed arrays.
* `src/render/people.ts` uses the `belt` fixture id as an arrival anchor. `src/render/markings/` holds `taxiPlan.ts`, `airfieldPaint.ts`, `standPaint.ts`, `standLayout.ts`.
* `tests/` has 30 files. `handoff/STATE.md` (2026-11-05) reports 226 tests passing, lint and rules clean, stress mean 0.006 to 0.028 ms per tick.
* UI: `src/ui/BuildMenu.tsx` line 152 already has a `baggage` GSE category (tractor, cart, belt loader) and line 176 a terminal facilities card with the `belt` fixture. `src/ui/strings/en.json` has `menu.handling.baggage.*`, `menu.terminal.facilities.belt`, `fixture.3`, `notice.wrongZone`, `ready.noBelt`. `docs/UI_DESIGN.md` line 157 lists a baggage load overlay.

## Decisions confirmed by the user (2026-11-06)

* Single baggage level for MVP 1 (user, 2026-11-06: "multi level can be trimmed for later. but working baggage system is a must"). The level layer, level transfers and bridges over and under move to task T46. Passenger floors, escalators and elevators for people are not in scope.
* Routing is automatic. The player assigns destinations, not individual bags.
* The player assigns each airside departure chute to stands, and each airside arrival input and each landside carousel to stands.
* The flight's stand time reservation and the flight identifier identify the intended bags. The sim never delivers bags to whatever aircraft happens to stand there.
* Failure direction: the flight waits for its bags, then departs, and the bags that did not make it are recorded as mishandled. The exact wait and the penalty are not approved, so they stay pending and must not be invented.
* Flight scheduling is now simple airline offers with fixed times and duration, dragged onto stand blocks, plus an automate toggle (see the 2026-11-06 T40 entry in `handoff/QUESTIONS.md`). This replaces the exact per flight time editing described in `handoff/tasks/T41-flight-schedule.md`. That spec file needs reconciling before T41 starts, and this task depends on the stand window reservation that model produces.

## Design (decided)

### Flight identity and stand windows

* A monotonic `fSerial` per flight is assigned in `Traffic.scheduleArrival` and never reused. It is added to `Traffic.arrays()`, saved and hashed. Every bag batch carries the serial, never the flight index, and never a stand id.
* A stand reservation window per flight (arrival tick minus the existing buffer to departure tick plus the buffer) is the only thing that binds a flight to a stand. Reassigning a stand moves the window; the bags follow the flight serial and the system resolves the destination again from the new window.
* Bags whose flight window has ended, or whose flight no longer exists, are never loaded. They are rerouted by the normal rules, or recorded as mishandled under the pending rule above.

### Bag batches, not individual bags

* Bags are aggregated into batches keyed by flight serial, following hard rule 6. A batch has a size, a stage, a current node and a timer. Cohorts (T14, T20) carry a bag count per profile from data; the batch is created from the cohort generation, so no individual passenger sim is added.
* Batches use struct of arrays with a free list, no allocation per tick. Cadence is 10 ticks, as `docs/ARCHITECTURE.md` section 3 already states.

### The baggage graph

* One derived routing graph per baggage level per terminal building, built at command time from the devices the player laid. Nodes are devices and conveyor cells; edges are conveyor segments with a direction, a capacity in bags per minute and a transit time.
* The graph is cached and versioned. A graph edit bumps its own version, following the `obstaclesVersion` pattern in `src/sim/airfield/airfield.ts` and `updateObstacles` in `src/sim/sim.ts`, so an edit never rebuilds the taxi network (PITFALLS item 1).
* Path selection is deterministic and precomputed. A batch does not search per bag and does not search per tick. Splitter settings are part of the graph, so a split to two destinations is resolved by the graph, not by a search in a hot loop.
* Cycles and dead ends are structural properties of the graph. The build validator refuses a layout that traps bags, with a problem code the player can read.

### Devices and where they live

* Terminal side devices are fixtures on the building grid and are appended to `FIXTURE_KEYS` (PITFALLS item 6): check in connection port, bag drop connection port, security scanner, reject separation table, conveyor segment, level transfer, carousel segment.
* Airside equipment (departure chute, arrival input station) is an airfield object in the airfield payload, placed on owned land like the GSE depot, following the `buildGaBlock` command pattern.
* A dedicated baggage wall opening is a new `WALL` value appended after `Door`. A conveyor crossing a wall without one is refused.
* A baggage floor selector adds a level layer to `TerminalGrid`. Saves store it, so the save version bumps (recipe R3).
* Level transfers are the only edge between two levels. A conveyor on level 1 and a conveyor on level 2 that overlap in the grid never connect.
* Bridges over and under carry conveyors across other conveyor runs and across service roads. Overhead height is data, so T26 collision checks apply.

### Ground transport

* Baggage tractors and carts already exist in `gse.json` and in the build menu. They gain real routing on the T24 service roads and apron lanes, and cart trains follow T25 trailer kinematics. Belt loaders already exist and dock at the cargo door service point.
* Loading and unloading are turnaround tasks in `src/data/turnarounds.json` (T22), with dependencies. Loading waits for the flight's batches at the chute or the makeup point, or for the cut off.

### Player assignment

* Each airside departure chute holds a list of stand ids. Each airside arrival input holds a list of stand ids. Each landside carousel holds a list of stand ids. Assignment is a command, saved, and shown in the assignment UI.
* A flight's destination is resolved from its current stand window. If the assigned stand has no chute or carousel, the bags wait and the player gets a readable problem code.

## Requirements

* R1. Flight identity: `fSerial` in traffic, in `arrays()`, saved, hashed, never reused. Bags and cohorts reference it.
* R2. Stand window reservation per flight, robust to stand reassignment, delays and old bags. A stand is never handed to two overlapping windows.
* R3. Bag batch model: struct of arrays, free list, keyed by flight serial, created from cohort bag counts, no allocation per tick.
* R4. Baggage graph per level per building, derived at command time, cached, versioned by its own counter, deterministic path selection, no per bag and no per tick search.
* R5. Data driven devices in `src/data/baggage.json` with a zod schema in `src/data/schemas`: conveyor (capacity bags per minute, transit time, direction), junction, splitter (settings), security scanner (throughput, reject rate), reject separation table, level transfer (time, capacity), departure chute, arrival input, carousel (capacity, the 60 bag hold from the fixtures table). Every number cites its source.
* R6. Full departure chain: staffed check in and self service bag drop connection ports feed the graph, directed conveyors, junctions and splitters sort, the scanner screens with reject separation, the airside chute assigned to the flight's stand receives the batches, tractor and carts carry them, the belt loader loads the correct aircraft.
* R7. Full arrival chain: the loader unloads into carts, the tractor delivers to the airside input assigned to the flight's stand, conveyors route to the assigned carousel, and the arrival cohorts (T20) collect automatically once their flight's bags are on the carousel.
* R8. Dedicated baggage wall openings: a conveyor crossing a wall without one is refused. The floor selector, level transfers and bridges over and under are deferred to T46.
* R9. Wrong flight prevention: a batch is only ever delivered to the aircraft of its own flight serial, and only while that flight's stand window is open. A test proves it.
* R10. Load and unload dependencies: turnaround tasks wait for the flight's own batches, with the delay cause attributed to the airport or the airline (T22 R3).
* R11. Failure: the flight waits, then departs, and the missed bags are recorded as mishandled. The wait length and the penalty are PENDING and must not be invented.
* R12. Assignment commands for chute to stands, input to stands and carousel to stands, with undo, saves and problem codes.
* R13. Overlay or inspector showing bags queued per device and per flight, matching the baggage load overlay in `docs/UI_DESIGN.md` line 157.
* R14. Build tools for every new device, hidden until the slice that finishes them lands (WORKFLOW slicing rules).
* R15. Save version bump with a migration for every new saved shape, and a determinism test per slice: 2 000 ticks twice from one seed, identical `stateHash`, plus save and restore mid run.
* R16. Stress: the baggage subsystem stays inside the budgets in `docs/PERFORMANCE.md` section 1 for the large scenario, with entity counts reported. No regression over 10 percent against `perf-baseline.json`.
* R17. True scale assets for every new device, per the asset section below.

## Proposed slice breakdown

Each slice is one small sequential task, at most about 300 changed lines, each keeps `npm run verify` green, each becomes a row in `handoff/TASKS.md` with the next free id after the current maximum. Order matters: identity before routing, routing before devices, devices before the player tools.

1. **Flight identity and stand windows.** `fSerial`, the per flight stand window reservation, and the bag batch container with its free list. Sim only, tests only, nothing visible. Meets R1, R2, R3.
2. **Baggage graph and deterministic routing.** `src/data/baggage.json` with the schema, the derived per level graph, its own version counter, deterministic path selection, and the structural refusal of cycles and dead ends. Meets R4, R5.
3. **Departure entry at the terminal.** Check in and bag drop connection port fixtures appended to `FIXTURE_KEYS`, feeding batches into the graph from the T13 service nodes and T14 cohort bag counts. Meets R6 first half.
4. **Screening and reject separation.** Security scanner and reject separation table as fixtures, reject loops back to the check in side, scanner throughput limiting the chain. Meets R6 second half.
5. **Airside departure delivery.** Departure chute as an airfield object, assignment to stands, tractor and cart transport on the T24 roads with T25 kinematics, belt loader loading the correct aircraft, load and unload turnaround tasks in `turnarounds.json`. Meets R6, R9, R10.
6. **Arrival flow.** Airside arrival input assigned to stands, arrival unload into carts, conveyors to the assigned landside carousel, and automatic collection by the correct arrival cohorts. Meets R7, R9.
7. **Baggage wall openings.** The dedicated baggage wall opening appended to `WALL`, and the refusal of a conveyor that crosses a plain wall. Meets R8. The level layer, level transfers and bridges are task T46.
8. **Tools, assignment UI, overlay and assets.** Build tools for every device, the assignment sheet, the baggage load overlay, and the true scale sprites and vector geometry. Meets R12, R13, R14, R17.

## Tests

Each slice writes its failing test first, per WORKFLOW step 4.

* Wrong flight prevention: two flights on adjacent stands, one with a chute, batches of both present. Only the flight serial with the assigned stand receives bags. A stand reassignment mid turnaround moves the destination and never delivers to the previous aircraft.
* Graph edits: adding or removing a conveyor, a junction or a splitter changes the selected path deterministically, and a restored save picks the same paths.
* Splitters, cycles and dead ends: a splitter with two destinations routes both streams; a cycle is refused with a problem code; a dead end is refused or holds bags without losing them.
* Throughput and queues: end to end throughput equals the slowest device; a saturated scanner queues upstream and can miss the cut off; bag count is conserved across the whole chain.
* Wall openings: a conveyor through a plain wall is refused; through a baggage opening it connects.
* Load and unload dependencies: loading does not start before the flight's batches arrive, unloading does not start before the aircraft is on blocks, and a missing belt loader delays the task with `delayCause: airport`.
* Save and determinism: 2 000 ticks twice from one seed give identical `stateHash`; save and restore mid run give identical hashes; a save from before the level layer loads with the new defaults.
* Stress: the large scenario stays inside budget with the entity counts printed.

## Asset requirements

Every new device is vector geometry in meters, baked from data, true scale, never scaled for readability (hard rule 12). Each needs a footprint, a working height where it can be crossed, and a data entry, and each passes the collision check in `docs/ART_AND_ASSETS.md` section 12 wherever it sits on an apron or under a bridge.

* Conveyor segment: straight and curved, belt width in meters from data, side rails, drive units, direction arrow.
* Junction: two or more arms meeting, mitered belt joins, guide vanes.
* Splitter: a fixed or moving blade sort head with two outlets.
* Security scanner: tunnel with x ray gantry, infeed and outfeed belts, control panel.
* Reject separation table: a short cross belt with a reject chute and a clear return path.
* Level transfer: a vertical or inclined conveyor between two baggage levels, with the transfer time visible.
* Departure chute: an airside steel chute with a discharge lip at cart height, wall opening and canopy.
* Arrival input station: an airside infeed with a roller bed and a cart docking pose.
* Carousel: oval carousel segments, sloping claim bed, drive housing, matching the carousel segment already listed in the terminal kit.
* Check in and bag drop connection port: a powered infeed table at the counter, with the port position on the fixture.
* Baggage wall opening: a lintel and a shielded gap in the wall line.
* Baggage bridge: a truss or enclosed bridge over a run or a service road, with clearance height data.
* Reference sheet: a new `docs/art/baggage_kit.png`, in the style of `docs/art/terminal_kit.png` and `docs/art/gse_sheet.png`, and a row in `docs/ART_AND_ASSETS.md` section 14.

## Numbers that must not be invented

Conveyor belt speed, capacity per minute, transit time, scanner throughput and reject rate, level transfer time, carousel hold (the 60 bag figure in `docs/GAME_DESIGN.md` section 8 is the only approved number so far), cut off before departure, the bag wait length and the mishandled penalty. Every one of these either comes from a doc, from the user, or goes into `handoff/QUESTIONS.md`.

## Open questions

These are new and are not answered by any doc. They go into `handoff/QUESTIONS.md` and the user must answer them before the slice that needs them starts.

1. Cut off: how many minutes before departure does check in close and the last bag have to be at the chute. `docs/GAME_DESIGN.md` section 10 says check in closes 45 minutes before departure. Is that also the bag cut off, or is a separate bag cut off wanted?
2. The bag wait length before the flight departs without its bags, and the penalty for a mishandled bag. Both pending, both must not be invented.
3. Bags per passenger per profile, and whether crew and staff carry bags. Needed for batch sizes. `docs/GAME_DESIGN.md` section 8 gives no bag counts.
4. How many bags one cart and one tractor carry, so the transport step has a capacity.
5. Whether a carousel or a chute may serve stands in more than one terminal building, and how the player is told when a flight has no assigned device.
6. Whether the security scanner is one shared device for the whole building or one per check in bank, since that decides the graph shape.

## Relationship to T21 and T41

T21 is superseded. Its aggregated belt capacity and its abstract network are replaced by this system. `src/sim/business/business.ts` `arrCapacity` and the `belt` fixture keep working until the arrival slice lands, then the arrival capacity comes from the carousel assignment. `handoff/tasks/T41-flight-schedule.md` must be reconciled with the 2026-11-06 scheduling answer before either task starts, because this task needs the stand window reservation and the flight serial that model produces.
