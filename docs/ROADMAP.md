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
* [ ] Taxiway tool with code widths, fillets, segment properties (one way, closed, max code, speed), automatic names (done, except real fillets: corners use round joins)
* [ ] Ghost envelopes: runway strip, wingtip envelope, separations with automatic max code downgrade, obstacle surfaces (done except obstacle surfaces, and the wingtip envelope is a static ring)
* [ ] Automatic holding points at correct distances, entries with takeoff distance available (done, the player cannot drag holding points out yet)
* [x] Rapid exit tool with 30, 45 and 90 degree presets and suggested distance
* [x] Apron, stand and stand row tools for contact, remote push back, remote taxi through and GA tie down
* [ ] Surfaces with PCR tiers, condition and resurfacing (done, the runway does not yet close during works)
* [x] Alignment frames and snapping rules (`GAME_DESIGN.md` section 6)
* [ ] Prefab pieces: runway end with turn pad, rapid exit, parallel taxiway with connectors, stand row, GA apron block (all but the turn pad)
* [ ] Runway, taxiway and stand markings per `docs/ART_AND_ASSETS.md` sections 8 and 9, with surface rules and generated restraint envelopes (simplified set: thresholds, designators, centerline, edges, aiming point, touchdown zone, hold marks, stand lines and boxes)
* [ ] Grading tool with cut and fill cost (only an automatic grading cost is charged, terrain is not modified)
* [x] Undo and redo for all build actions, validation messages with explanations

### M3. Aircraft and movement

* [ ] Aircraft data loader with zod schema for the 10 MVP 1 types, derived code, wake and approach category tests
* [ ] Sprite baker in TypeScript ported from the prototypes: all features, layer order, livery, tiers 0 to 3
* [ ] Calibration overlays saved for all 10 types within tolerance
* [ ] Taxi network builder with samples, blocks and conflict sets, property tests
* [ ] Routing with direction, closures, max code, congestion cost and preferred flows
* [ ] Reservations, following gaps, junction priority, holding points, runway exclusivity with wake separation
* [ ] Push back with direction per stand
* [ ] Deadlock detection and resolution with debug overlay
* [ ] Runway length, payload and range, ACR and PCR checks with the limiting factor shown
* [ ] Test flight generator for arrivals and departures
* [ ] Stress: 50 aircraft under the medium budget

### M4. Terminal and departures

* [ ] Building shell placement with local grid and rotation
* [ ] Walls, doors, floors, rooms with types, room validation
* [ ] Core fixtures: check in desk, kiosk, bag drop, security lane, passport booth, gate desk, bench, toilet block
* [ ] Walking graph with cached distances and regional rebuild
* [ ] Service nodes and queues
* [ ] Cohorts and the departure journey from curb to aircraft
* [ ] People rendering from the atlas: 30 recipes, walk cycle, tiers, sample cap
* [ ] Density, queue and walking distance overlays
* [ ] Satisfaction and airport rating
* [ ] Stress: 20 000 cohorts under the medium budget

### M5. Arrivals, baggage and ground handling

* [ ] Arrival journey with immigration, baggage claim and customs
* [ ] Simple baggage network (belts with capacity and transit time) and carousels
* [ ] GSE data and sprites for tug, tractor and carts, belt loader, refueller, hydrant dispenser, GPU, apron bus
* [ ] Turnaround task lists for the 10 types with dependencies
* [ ] Service points per type, docking poses, service roads and apron lanes with reservations
* [ ] Trailer kinematics and free rotation
* [ ] Hard footprints and overhead zones, collision test over all stand templates and types
* [ ] Draw order rules (vehicles under wings, never over aircraft)
* [ ] Staff sprites for check in, security, ground handler, marshaller, cleaner

### M6. Airlines, shops, finance

* [ ] Airline generator for regional and national scopes per `docs/AIRLINES.md`, limited to released aircraft
* [ ] Route demand, seasonal slot requests, contracts with basic fees
* [ ] Flights board sheet and airline sheet
* [ ] Shop units with 6 categories, simple tenant fill by rating, sales and rent
* [ ] Ledger with daily close, revenues and costs for MVP 1 scope, one term loan, Finance sheet
* [ ] Automatic staffing with wages and a coverage overlay
* [ ] Wind band effects, weather events (rain, fog, strong wind)

### M7. UI shell, saves and MVP 1 release

* [ ] Main menu, new game wizard, load screen, settings, pause menu per `docs/UI_DESIGN.md`
* [ ] HUD: top bar, left rail with flyouts, context bar, inspector, alert center, toasts, overlays
* [ ] Saves to IndexedDB with autosave, export and import, migrations scaffold
* [ ] Page lifecycle, crash recovery and copy report per `docs/BROWSER.md`
* [ ] Short guided start (build a strip, a stand, a terminal, sign the first airline)
* [ ] Quality governor and quality presets
* [ ] Playwright smoke tests in three engines
* [ ] All MVP 1 criteria above checked, a 3 hour play session at 4x without errors or budget breaches

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
