# DESIGN REVISION 4: stands, flight series, ground handling and people

Status: written on 2026-11-12 from the user's revamp brief. The values in section 9 are pending in the decision batch of `handoff/QUESTIONS.md` (2026-11-12 T58) until the user answers it.

Authority: this document overrides `docs/GAME_DESIGN.md` sections 6 (stands), 8 (passenger journey and satisfaction), 9 (shops and tenants), 10 (ground handling and staff), 12 (contracts and offers) and 14 (events), `docs/AIRLINES.md` section 9 (contracts), `docs/DESIGN_REVISION_2.md` section 3.4 (stand placement) and the rotation model of task T41 wherever they disagree. Revision 3 markings and access types stay in force.

North star: benchmark the mechanics of Airport CEO, then give them this game's flavor: real scale geometry, free or grid placement, deeper airline, passenger and aircraft dynamics, and procedural airlines, destinations, tenants and operations so no two seeds play alike. Only the mechanics and the player experience are mirrored. No art, text or screenshot of that game enters this repository.

## 0. MVP 1 boundary (user, 2026-11-12)

* MVP 1 ends with acceptance T38.
* Multi floor terminals (T51), baggage levels (T46), hangars (T52) and cargo (T53) move to MVP 2.
* The deferred roadmap lines of T02, T03 and T07 leave MVP 1. Revision 3 targets replace them.
* Procedural uniqueness is part of MVP 1: generated destinations and airlines, procedural tenants and a first event deck.

## 1. Benchmark

| Mechanic | Airport CEO | This game today | Revision 4 |
| --- | --- | --- | --- |
| Stands | Prefab stands in a few sizes, placed on apron, must touch a taxiway | Four sizes on a row tool, lead in fork to the taxilane, no clearance check against other taxiways | Five classes (GA to extra large) placed freely or on the grid, lead in snaps to a centerline, full clearance check (section 2) |
| Taxiway connection | Stand flagged when not connected | Fork raycast at build time | Live connection state on the ghost and in the inspector |
| Jet bridges | Bridge attached to a stand at a terminal edge | Revision 3 access types specified, not built | Five access types as stand upgrades through works (section 2.5) |
| Gate and desk assignment | Stand linked to a gate and a check in desk area | Contact reach only | Stand inspector assigns gate, desk, makeup chute and carousel (section 2.6) |
| Baggage assignment | Belts and chutes linked to stands | Not built (T43 planned) | Stand assignments drive the T43 system |
| Service roads | Drawn roads, vehicles follow them | Not built, vehicles drive straight lines | Service road and apron lane graph, one connection point per stand (section 4) |
| Ground vehicles | Vehicles drive from depot, park at fixed points | Spawn 40 m away and drive straight to offsets | Depot to stand along roads, stand local approach paths, docking poses per service point |
| Vehicle depots | Required building that stores vehicles | Fleet is a number | Ground handling depot with bought capacity (section 5) |
| Fuel | Fuel depot with stock, deliveries, contracts | Free fuel | Fuel farm with stock, road tankers, refuellers or hydrant (section 5) |
| Catering | Not modeled in depth | Catering truck spawns | Catering unit plus trucks (section 5) |
| Cleaning | Cleaning service at stands | None | Cleaning task in the turnaround, crews from the cleaning depot |
| Maintenance | Maintenance of fixtures and vehicles | None | Maintenance workshop repairs vehicles and fixtures |
| Staff | Hired individuals with roles and shifts | Staff count and wage only | Individuals on the cohort substrate (section 6.4) |
| Flight planning | Weekly planner, airline series placed on stands by day | Daily rotations dragged on a stand timeline | Weekly planner of flight series (section 3) |
| Airline contracts | Airlines sign, offer flights, judge service | Seven fixed airlines with rotations | Generated airlines offering series that grow with the rating (section 3) |
| Offers growing with rating | More and larger flights as the star rating rises | Fixed | Rating gates on series count, aircraft size and new airlines |
| Shops and franchises | Franchise brands apply for zoned shop space | Six fixed shop fixtures | Procedural tenants per redesigned T32 (section 7) |
| Events | Random incidents with choices | Weather only | Event deck on its own RNG stream (section 7.3) |

## 2. Stands

### 2.1 Classes

Each class is a prefab built from data in `src/data/stand_sizes.json`:

| Class | Largest aircraft | Allows a jet bridge |
| --- | --- | --- |
| GA | Code A | No |
| Small | Code B | No |
| Medium | Code C | Yes |
| Large | Code E | Yes |
| Extra large | Code F | Yes |

Each prefab has: a parking box sized from the largest span and length it takes plus the class wingtip clearance, a lead in, one stop line per aircraft type, staging areas for equipment, one service road connection point at the box edge away from the taxilane, and a bridge mount on classes that allow a jet bridge.

### 2.2 Placement

* Free or snapped to the T42 grid, with rotation (R rotates in 15 degree steps, Shift for free rotation).
* While the ghost moves, the lead in snaps to the nearest taxiway or taxilane centerline in front of the stand, within the snap reach of section 9. A stand must touch a centerline to be green.
* Green needs all of: the lead in connects; the parked box stays `taxiObjectM` of each taxiway's code from every centerline it does not lead into and off the pavement of the one it does (T57 rule); no overlap with buildings, runway strips or other stand boxes; the service road point lies on apron or open ground where a road can reach it later.
* The red reason shows in the context bar, one line, naming the first failed check.

### 2.3 Connection states

Shown as icons on the stand and as lines in the inspector, refreshed when the airfield or terminal changes:

* Not connected to a taxiway: the stand cannot be booked.
* Not connected to a service road: handled per decision D2 of section 9.
* No gate assigned, no baggage assigned, no fuel source: warnings; the matching turnaround tasks wait.
* Breaks taxiway clearance: warning on stands kept from older saves (T57).

### 2.4 Parked look

The aircraft stops with its nose gear on its type's stop line and its nose on the stand heading. Chocks and cones appear, served doors open, the bridge cab docks at the door. Revision 3 markings stay and regenerate from class, access type and upgrades.

### 2.5 Upgrades

Works jobs from the stand inspector, closing the stand for their works days: jet bridge in the five revision 3 access types, apron bus and stairs for remote stands, hydrant pit, fixed ground power, and the further upgrades the user keeps in section 9.

### 2.6 Assignments

The inspector assigns the boarding gate and desk inside the terminal, the T43 baggage makeup chute and the arrival carousel. A booked flight uses the stand's assignments. Missing assignments fall back to the nearest valid one and raise the matching warning.

## 3. Flight management

The rotation system is dropped.

### 3.1 Flight series

A signed airline offers flight series. A series has a destination airport, an aircraft type, a weekly frequency, a preferred time window, a contract length and fees. Example: an airline first offers five series to five destinations, one of them three times a week; the player places that series exactly three times in the week, in any free slot.

### 3.2 Weekly planner

* A seven day timeline per stand, reusing the T41 stand timeline and its drag and drop.
* A placed slot occupies the stand for the turnaround time plus the block buffer and repeats every week until the series is cancelled or expires.
* Placement checks stand class, required access type, runway performance for the stage length, and the tower movement budget, and refuses with the reason.
* Unplaced frequency is not flown, and the airline notices it in its satisfaction.
* The automation toggle stays as an auto planner that places unplaced frequency in the first valid slot inside the preferred window.

### 3.3 Airline judgment and growth

* Each airline keeps a satisfaction score fed by on time share, unplaced frequency, passenger satisfaction and fees. Low satisfaction cancels series, very low ends the contract (thresholds in section 9).
* When the airport rating rises, airlines offer more series, larger types and new destinations, and new airlines approach the airport (gates in section 9).

### 3.4 Destinations

A procedural network per seed on its own RNG stream: named airports at real great circle distances from the site, each with a size, a region and a demand weight. Stage length checks use `src/sim/ops/performance.ts`. Names are invented from syllable tables in data.

### 3.5 Save migration

Each old rotation becomes a daily series (frequency 7) to a generated destination at its old stage length, with its remembered stand placed at its old daily slot.

## 4. Ground handling

* Vehicles live in a depot, drive the service road graph to the stand's connection point, then follow stand local approach paths to fixed docking poses per service point per aircraft type, and leave the same way.
* They never cross the hard footprint or a keep out zone (`docs/ART_AND_ASSETS.md` section 12), and never drive through another vehicle: apron lane and stand path reservations work like taxi reservations.
* Each turnaround runs a task list per aircraft type with dependencies: chocks and cones, bridge or stairs, deboarding, unloading, cleaning, catering, fuel, water and waste, loading, boarding, door close, pushback. Missing equipment or staff delays the task and the delay shows on the flight with its cause.
* Ground staff walk from their vehicle to the aircraft and back.
* Draw order: ground, markings, shadows, vehicles, aircraft, vehicles marked under wing by design are drawn before the aircraft, bridges above aircraft. Every object has a ground shadow so nothing floats.

## 5. Supporting buildings

Real scale buildings placed freely or on the grid, drawn in the existing art style. Each is a service source.

* Ground handling depot: stores and spawns tugs, tractors, carts, belt loaders, GPUs, stairs and buses. The player buys vehicles up to the depot capacity.
* Fuel farm: tanks with stock and capacity, refilled by road tankers on the access road, feeding refuellers or a hydrant network to stand pits. Stock outs delay flights and then ground them. Fuel contracts in finance set the buy price.
* Catering unit with catering trucks.
* Fire station with the fire category table of `docs/GAME_DESIGN.md` section 10 and a response time to each runway end. An airport below the category of a type cannot accept that type.
* Staff center for breaks and shift changes, cleaning and waste depot, maintenance workshop.
* Further buildings from the benchmark are listed in section 9 for the user to keep or cut.

## 6. Passengers and staff as individuals on a cohort substrate

### 6.1 Substrate

The cohort stays the unit of movement and storage. People inside it are individuals. Group size follows each profile; solo travellers are cohorts of one.

### 6.2 Traits

Each member has traits generated from the cohort seed and the member index: needs that grow over time (hunger, thirst, toilet, rest), wants (shopping desire, budget), preferences (favourite shop categories, price sensitivity, how early they like to reach the gate), travel class and mobility. Traits are regenerated from seeds on load; only state is saved.

### 6.3 Needs and decisions

Needs are linear in time and evaluated only at decision points of the walking graph, never every tick. A member whose need passes its threshold splits into a sub cohort, visits a service node, and rejoins the group or meets it at the gate. Satisfaction is per member and rolls up to the cohort and the airport rating (T17).

Budget: the medium stress scenario holds 20 000 cohorts and at least 40 000 people inside the existing tick budget.

### 6.4 Staff

Staff use the same substrate: individuals with a role, a shift, a home building, a station, needs such as breaks, and a skill. Automatic staffing assigns them.

## 7. Procedural tenants and operations

### 7.1 Tenants

The player zones a unit and sets its category, generated brands apply, the player accepts one, the tenant furnishes the unit from templates, advertising raises applications, and variety grows with the airport. Brands, products and prices are generated per seed.

### 7.2 Sales

Shop visits come from the individual wants of section 6, so sales are counted from visits, not estimated.

### 7.3 Event deck

A first deck on its own RNG stream: weather plus operational events (fuel delay, vehicle breakdown, VIP flight, diversion, staff shortage), each with choices and a fallback when the player does not choose.

## 8. Tasks

| Task | Content |
| --- | --- |
| T57 | Visual repair |
| T58 | This document and the decision batch |
| T59 | Stand classes, placement, taxiway snapping, connection states, save migration |
| T60 | Service roads, apron lanes, reservations, trailer kinematics |
| T61 | Weekly planner and flight series, save migration |
| T62 | Procedural destinations, airline offers that grow with rating |
| T63 | Turnaround task lists and servicing |
| T64 | Footprints, keep out zones, collision test, draw order |
| T65 | Supporting buildings |
| T66 | Stand upgrades and assignments |
| T67 | Individuals on the cohort substrate |
| T68 | Staff as individuals, sprites, shifts, automatic staffing |

## 9. Values

All values are in the 2026-11-12 T58 decision batch of `handoff/QUESTIONS.md`, with the recommended value, the reason and the mirrored behavior. The answer is recorded there, and each value lives in `src/data` with a zod schema. Do not invent a value that is not in the batch.

Everything not mentioned here stays as it was.
