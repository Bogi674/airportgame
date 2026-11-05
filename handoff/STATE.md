# STATE.md

Where the project stands at handoff (2026-11-05). Update this file when a task changes what is true here.

## Health

* 226 tests in 30 files pass. Lint, type check and the rules checker are clean.
* CI (`.github/workflows/ci.yml`) runs lint, tests, the offline build, stress and Playwright in Chromium, Firefox and WebKit. It is green.
* Stress, mean and p99 ms per tick (budgets: small 1 ms, medium 4, large 8, busy50 4, terminal640 4):

| Scenario | Mean | p99 |
| --- | --- | --- |
| small | 0.008 | 0.053 |
| medium | 0.006 | 0.056 |
| large | 0.009 | 0.088 |
| busy50 | 0.028 | 0.881 |
| terminal640 | 0.006 | 0.064 |

* Save format version 7 (`src/sim/save/migrations.ts`).

## What works (player view)

A player can start a seeded game, buy land, and build an airport that airlines fly to:

* **Runways** with code, approach type, surface and strength. Lengthen, shorten, reclass and resurface them; each edit closes the runway for works days shown before confirming. Obstacle surfaces (approach and transitional) show for a selected runway; penetrations by terrain, uncleared trees, villages or terminals lower the usable approach per direction, and fog needs an instrument approach.
* **Taxiways** with the revision 2 pavement generator: fillets, junctions, bends, shoulders, double edge lines, centerlines, shoulder stripes, signs, slab joints. Snapping to nodes, open ends and segments with J labels and tooltips. A wingtip envelope shows the largest type of the code at the cursor, with red bands where clearances to stands, buildings or parallel taxiways are broken. Surface changes run as works that close the taxiway.
* **Holding points** placed automatically; the select tool drags them further out, never closer.
* **Aprons** as free polygons or rectangles (A toggles), merging when they touch, Ctrl cuts holes.
* **Stands** in four sizes (small, medium, large, extra large), contact or remote, each with a lead in fork of two arcs to the taxilane, push back along an arc (left, right or away from the route), and markings generated from stand and aircraft data. Stands refuse types that do not fit their span or surface.
* **Rapid exits** (30, 45, 90 degrees), the **parallel taxiway** prefab, **GA blocks**.
* **Turn pads** in the sim only: the `turnPad` command builds a pad, departures that need the full length backtrack to it. The pad is not drawn yet and has no tool (task T01).
* **Terminals** of any size on a 2 m grid that grows in 64 m chunks: foundations, floors, walls, glass, doors, zones, check in, security, baggage belt, seating, toilets, six shop types and the ATC room. Room validation stops departures when security can be bypassed.
* **Traffic**: arrivals pick a runway end by wind and performance, land, exit, taxi with node and block reservations, dock, turn around with GSE (tug, tractor, carts, belt loader, refueller, GPU, catering, stairs), push back, taxi out, hold, line up, take off. Wake separation, runway reservations, deadlock detection with an overlay.
* **Business**: seven invented airlines with contracts, fees, a daily ledger, a term loan, a flights board, ratings, weather events (rain, fog, strong wind).
* **UI**: main menu, new game, HUD top bar, tool rail, build menu, context bar, inspectors, sheets, toasts, guided start checklist, saves to IndexedDB with autosave, export and import, crash panel.

## What does not exist yet (the remaining MVP 1 work)

Every unchecked line in `docs/ROADMAP.md` milestones M2 to M7. `handoff/TASKS.md` turns each into a task. In short:

* M2: turn pad drawing and tool, the remaining runway marking details, the grading tool.
* M3: the full sprite port (features, liveries, tiers), saved calibration overlays, network conflict sets, junction priority.
* M4: kiosk, bag drop, passport booth, gate desk; walking graph; service nodes and queues; cohorts and the departure journey; people atlas rendering; overlays; satisfaction as specified; the 20 000 cohort stress scenario.
* M5: arrival journey, baggage network, hydrant dispenser and apron bus, turnaround task lists, service points and service roads, trailers, collision footprints and test, draw order, staff sprites.
* M6: airline generator per `docs/AIRLINES.md`, route demand and seasonal slots, shop sales and tenant fill, staffing coverage overlay.
* M7: menus and settings per `docs/UI_DESIGN.md`, left rail flyouts and alert center, the 3 hour acceptance session.

## Deviations from the docs already accepted

Recorded in `docs/ARCHITECTURE.md` section 12. The ones a new agent trips over:

* Pavement geometry lives in `src/shared/pavement`, not `src/sim`, because sim and renderer both need it.
* Taxiway signs are true scale, so they are tiny when zoomed out. That is intended (hard rule 12).
* Surface costs and works days are tunable data and not balanced yet.
* No code F type is in the roster, so the extra large stand has no user yet.
* Aprons change surface instantly; only taxiways and runways go through works.
* The terminal grid grows as one bounding box, not per chunk.
* Arrivals never backtrack; only departures use turn pads.
* polygon-clipping is an approved runtime dependency. Import it only through `src/shared/clip.ts`.

## Branches

* `main`: everything above.
* Work for MVP 1 goes on `glm/mvp1` (create it from `origin/main`), unless the user names another branch. The user merges to `main`.
