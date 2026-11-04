# ROADMAP.md

Releases, milestones and acceptance criteria. Work on one milestone at a time, in order. Check off criteria as they are met. Do not start a milestone before the previous one is complete unless the user says so.

Every milestone also needs passing tests and lint, a determinism test for any sim code, and the budgets in `docs/PERFORMANCE.md` holding for the scenarios that exist so far.

## Release overview

| Release | Goal | Content limits |
| --- | --- | --- |
| **MVP 1, playable core** | Every core system works end to end in a small but complete game | 10 aircraft, 2 terrain presets, 1 terminal with 1 floor, 4 stand types, 6 shop categories, 7 GSE types, weather events only, Career and Sandbox |
| **MVP 2, depth** | Full operational and business depth | All 42 Phase 1 aircraft, all stand types, full tenants, staff shifts, ATC options, emergency, full events, loans and fuel contracts, full landside, multiple terminals and floors |
| **Release 1.0** | Polish and reach | Full tutorial, third terrain preset, accessibility complete, offline play, performance at the large scenario, visual regression suite |
| **Content updates** | More variety | Aircraft Phases 2 to 5, night lighting, seasons and snow, scenarios, more presets |

### MVP 1 aircraft (10)

Cessna 172S, Cessna 208B Grand Caravan EX, King Air 360, ATR 72-600, Dash 8-400, CRJ900, Airbus A320neo, Boeing 737-800, Boeing 787-9, Boeing 777-300ER. They cover codes A to E, light to heavy wake, piston, turboprop and jet, high and low wings, nose, underwing, overwing and rear engines. Each sprite base already exists in the reference prototypes.

### MVP 1 scope summary

* Site: seeded terrain, parcels with purchase, wind rose and bands, climate, city. Presets Flat Coastal and River Valley.
* Airfield: runway, taxiway, rapid exit, holding points, entries, apron, stands (contact, remote push back, remote taxi through, GA tie down), all five surfaces, pavement condition, runway, taxiway and stand markings, prefab pieces, alignment frames, align view to runway.
* Aircraft: 10 types with real data, sprites with all tiers, calibrated.
* Movement: taxi network, routing, reservations, preferred flows, one way and closed segments, push back, deadlock handling.
* Terminal: one building, one floor, walls, rooms, core fixtures, departures and arrivals, simple baggage.
* Ground handling: tug, baggage tractor and carts, belt loader, refueller, hydrant dispenser, GPU, apron bus, with collision rules.
* People: 30 passenger recipes, staff shown for check in, security, ground handler, marshaller, cleaner.
* Market: generated airlines (regional and national scope), contracts with basic fees, route demand, seasonal slot requests.
* Shops: 6 categories (convenience, quick food, cafe, duty free, books and gifts, pharmacy) with a simple tenant fill based on rating.
* Finance: ledger, landing and passenger fees, rent, wages, upkeep, land, construction, one term loan.
* Staff: automatic staffing with wage cost and a coverage overlay.
* Events: rain, fog, strong wind.
* UI: main menu, new game wizard, HUD, build tools, inspector, Airlines, Finance and Flights sheets, alerts, settings, saves.

## MVP 1 status

A playable slice of MVP 1 exists and runs as one offline file (`npm run build:offline`, output `dist-offline/airfield-tycoon.html`). You can buy land, build runways, taxiways, aprons, stands and a terminal, sign airlines, watch aircraft land, turn around and take off, earn fees and run a ledger, save, load and export. The checklists below record what is done and what is simplified or missing. Terminal rooms and room checks, passengers on screen, ground vehicles and the full aircraft sprite port are not built, so MVP 1 is playable but not complete.

## MVP 1 milestones

### M0. Scaffold

* [x] Vite, TypeScript strict, Preact, Zustand, zod, Vitest, Playwright, ESLint configured per `docs/BROWSER.md`
* [x] Repo layout from `CLAUDE.md` with path aliases
* [x] Sim worker and bake worker entries with the message protocol skeleton and a ticking loop
* [x] Seeded RNG with fork, state hash, command log and `replay.ts`, with tests
* [x] Snapshot buffer pool with transfer and return
* [x] Canvas renderer with camera (pan, zoom 0.05 to 40 px/m, rotation), chunk cache skeleton
* [x] `npm run stress` skeleton printing ms per tick per subsystem, `perf-baseline.json`
* [ ] CI running test, lint, build and stress (workflow written in `.github/workflows/ci.yml`, tick after its first green run on GitHub)

### M1. Site, land and camera

* [x] `SiteSpec` generator: terrain, parcels with types and prices, wind rose, climate, city
* [x] Fairness guarantee: an affordable 3.5 km corridor in the Acceptable band, tested over 500 seeds
* [x] Presets Flat Coastal and River Valley, golden seed hash test
* [x] Terrain, water and vegetation rendering baked per chunk
* [x] Parcel overlay with buy flow and fence along owned land
* [x] Minimap, compass, align view to runway, zoom to fit (until a runway exists, align uses the ideal heading, switch to the built runway in M2)

### M2. Airfield builder

* [x] Runway tool with profile (code, approach type, surface, strength), widths by code, length and heading readouts, wind band readout (shown as text, no ring yet)
* [x] Taxiway tool with code widths, fillets, segment properties (one way, closed, max code, speed), automatic names (fillets, junctions and bends from `docs/DESIGN_REVISION_2.md` section 2, with node, end and segment snapping)
* [ ] Ghost envelopes: runway strip, wingtip envelope, separations with automatic max code downgrade, obstacle surfaces (done except obstacle surfaces, and the wingtip envelope is a static ring)
* [ ] Automatic holding points at correct distances, entries with takeoff distance available (done, the player cannot drag holding points out yet)
* [x] Rapid exit tool with 30, 45 and 90 degree presets and suggested distance
* [x] Apron, stand and stand row tools for contact, remote push back, remote taxi through and GA tie down (aprons merge and cut, free polygon and rectangle modes; stands come in four sizes with a lead in fork)
* [ ] Surfaces with PCR tiers, condition and resurfacing (done for taxiways with works that close the edges for their duration and allowed codes per surface; the runway does not yet close during works and aprons resurface at once)
* [x] Alignment frames and snapping rules (`GAME_DESIGN.md` section 6)
* [ ] Prefab pieces: runway end with turn pad, rapid exit, parallel taxiway with connectors, stand row, GA apron block (all but the turn pad)
* [ ] Runway, taxiway and stand markings per `docs/ART_AND_ASSETS.md` sections 8 and 9, with surface rules and generated restraint envelopes (simplified set: thresholds, designators, centerline, edges, aiming point, touchdown zone, hold marks, stand lines and boxes)
* [ ] Grading tool with cut and fill cost (only an automatic grading cost is charged, terrain is not modified)
* [x] Undo and redo for all build actions, validation messages with explanations

### M3. Aircraft and movement

* [x] Aircraft data loader with zod schema for the 10 MVP 1 types, derived code, wake and approach category tests
* [ ] Sprite baker in TypeScript ported from the prototypes: all features, layer order, livery, tiers 0 to 3 (geometry based top down sprites with tiers 0 to 3: silhouette, engines and livery, panel lines, then seams, window strips and flap tracks, not a full port of the prototype renderer)
* [ ] Calibration overlays saved for all 10 types within tolerance (a test checks length and span of all 10 types against the data (2 and 4 percent), overlays against photos are not saved)
* [ ] Taxi network builder with samples, blocks and conflict sets, property tests (built with 2 m samples and per taxiway blocks, conflict sets and property tests are missing)
* [x] Routing with direction, closures, max code, congestion cost and preferred flows (direction, closures, max code, strength, congestion cost and a per taxiway preferred flow that costs three times as much against it)
* [ ] Reservations, following gaps, junction priority, holding points, runway exclusivity with wake separation (node and block reservations, following gaps, holding points, runway exclusivity and wake separation work, junction priority is first come)
* [x] Push back with direction per stand (along the lead in and one fork arc: left, right or away from the departure route, switching side when blocked)
* [x] Deadlock detection and resolution with debug overlay (wait cycles are found and broken by a yield, and a traffic overlay ringing waiting aircraft in amber and deadlocked ones in red)
* [x] Runway length, payload and range, ACR and PCR checks with the limiting factor shown (stage lengths per rotation, takeoff weight from empty weight, passengers and fuel, payload cut at MTOW, runway need grows with weight, refusals name the limiting factor)
* [x] Test flight generator for arrivals and departures
* [x] Stress: 50 aircraft under the medium budget (scenario busy50 reaches 60 aircraft with 60 stands under the 4 ms budget, see `npm run stress`)

### M4. Terminal and departures

* [x] Building shell placement with local grid and rotation (the player lays foundation cells on a local 2 m grid, rotated in steps with R, a new building starts with the first foundation; the grid grows in 64 m chunks with no size cap, revision 2 section 5)
* [x] Walls, doors, floors, rooms with types, room validation (foundations, flooring, walls, glass, doors, painted zones and room validation: passengers must be able to walk from check in through a security lane into secure floor with seats, a gap in the wall is a security bypass and stops departures)
* [ ] Core fixtures: check in desk, kiosk, bag drop, security lane, passport booth, gate desk, bench, toilet block (check in desk, security lane, baggage belt, seating, toilets and six shop types are placed cell by cell, kiosks, bag drop, passport booth and gate desks are missing)
* [ ] Walking graph with cached distances and regional rebuild (not built)
* [ ] Service nodes and queues (a terminal load model replaces queues)
* [ ] Cohorts and the departure journey from curb to aircraft (passengers are aggregated per flight and limited by terminal capacity, no cohorts)
* [ ] People rendering from the atlas: 30 recipes, walk cycle, tiers, sample cap (a render sample of up to 3 000 dots, 1 500 under the governor, walks between the fixtures laid, no atlas, recipes or walk cycle)
* [ ] Density, queue and walking distance overlays (not built)
* [ ] Satisfaction and airport rating (rating from on time share, satisfaction, facilities and infrastructure)
* [ ] Stress: 20 000 cohorts under the medium budget (not applicable, no cohorts)

### M5. Arrivals, baggage and ground handling

* [ ] Arrival journey with immigration, baggage claim and customs (not built)
* [ ] Simple baggage network (belts with capacity and transit time) and carousels (belts add arrival capacity only)
* [x] GSE data and sprites for tug, tractor and carts, belt loader, refueller, hydrant dispenser, GPU, apron bus (tug, tractor, cart, belt loader, refueller, GPU, catering and stairs run each turnaround from true size catalog sprites, hydrant dispenser and apron bus are not spawned yet)
* [ ] Turnaround task lists for the 10 types with dependencies (a fixed turnaround time per role)
* [ ] Service points per type, docking poses, service roads and apron lanes with reservations (not built)
* [ ] Trailer kinematics and free rotation (not built)
* [ ] Hard footprints and overhead zones, collision test over all stand templates and types (not built)
* [ ] Draw order rules (vehicles under wings, never over aircraft) (not built)
* [ ] Staff sprites for check in, security, ground handler, marshaller, cleaner (not built)

### M6. Airlines, shops, finance

* [ ] Airline generator for regional and national scopes per `docs/AIRLINES.md`, limited to released aircraft (simplified: 7 invented airlines with 1 to 2 aircraft types each, rating gates, not the full AIRLINES.md model)
* [ ] Route demand, seasonal slot requests, contracts with basic fees (contracts set rotations per day and a fee level, there are no routes or seasons)
* [x] Flights board sheet and airline sheet
* [ ] Shop units with 6 categories, simple tenant fill by rating, sales and rent (rent only, sales are not tracked)
* [x] Ledger with daily close, revenues and costs for MVP 1 scope, one term loan, Finance sheet
* [ ] Automatic staffing with wages and a coverage overlay (wages follow a staff count, no coverage overlay)
* [x] Wind band effects, weather events (rain, fog and strong wind)

### M7. UI shell, saves and MVP 1 release

* [ ] Main menu, new game wizard, load screen, settings, pause menu per `docs/UI_DESIGN.md` (simplified compared to UI_DESIGN.md)
* [ ] HUD: top bar, left rail with flyouts, context bar, inspector, alert center, toasts, overlays (top bar, tool rail, context bar, inspectors, toasts and sheets exist, the left rail has no flyouts and there is no alert center)
* [x] Saves to IndexedDB with autosave, export and import, migrations scaffold (gzip, three autosave slots, file export and import, version and migration scaffold, replay safe determinism test)
* [x] Page lifecycle, crash recovery and copy report per `docs/BROWSER.md` (pause and autosave on a hidden tab, crash panel with back to menu, restart and copy report with version, browser, seed and the last 500 commands)
* [x] Short guided start (build a strip, a stand, a terminal, sign the first airline) (a checklist that ticks itself)
* [x] Quality governor and quality presets (automatic governor with 3 steps and restore, plus Low, Medium and High presets in settings)
* [ ] Playwright smoke tests in three engines (configured for three engines, run in Chromium only so far)
* [ ] All MVP 1 criteria above checked, a 3 hour play session at 4x without errors or budget breaches (not all criteria are met, see the notes above)

## MVP 2 milestones

### M8. Full Phase 1 fleet and stands

* [ ] Remaining 32 Phase 1 aircraft with data, sprites, calibration and service points
* [ ] MARS and cargo stands, catering truck, passenger stairs, container loader, water and lavatory trucks
* [ ] International scope airlines and widebody operations

### M9. Business depth

* [ ] Full shop categories, customization, tenant lifecycle and lease negotiation
* [ ] Loans (term, construction, bonds), credit rating, covenants
* [ ] Fuel spot price, forward contracts, fuel farm and stock outs
* [ ] Full reports and KPI board

### M10. Operations depth

* [ ] Staff shifts, morale, fatigue, training, strikes
* [ ] ATC staffing and options (departure metering, intersection departures, crossing rules)
* [ ] Fire categories, fire stations, response times, ARFF and paramedic sprites
* [ ] Full event deck with player responses
* [ ] Baggage sorting halls and detailed networks

### M11. Landside and growth

* [ ] Full road tools, curbside, parking types, rail and bus stations, mode share
* [ ] Multiple terminals and floors, piers, escalators and elevators
* [ ] Progression stages and unlocks
* [ ] Large scenario under budget

## Release 1.0 milestones

### M12. Polish and reach

* [ ] Full tutorial and contextual hints
* [ ] Hilly Inland preset
* [ ] Accessibility complete (color blind mode, UI scale, reduced motion, keyboard reach)
* [ ] Offline play with a service worker and update prompt
* [ ] Visual regression suite for reference scenes
* [ ] Performance: large scenario under all budgets on the reference laptop

## Content updates

* [ ] Aircraft Phase 2, mainline expansion (30 models)
* [ ] Aircraft Phase 3, regional, GA and business depth (27 models)
* [ ] Aircraft Phase 4, classics and heavy cargo (18 models)
* [ ] Aircraft Phase 5, sandbox historic (Concorde)
* [ ] Night layer with airfield lighting
* [ ] Seasons, snow and de-icing
* [ ] Scenarios on fixed seeds

Each aircraft phase ships only when every model meets the definition of ready in `docs/AIRCRAFT_DATABASE.md`.

## Standing backlog

Ideas not scheduled: helipads, cargo village, maintenance hangars with heavy checks, airline lounges as a business, weather radar overlay.
