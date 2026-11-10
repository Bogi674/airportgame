# STATE.md

Where the project stands (2026-11-10). Update this file when a task changes what is true here.

## Health

* 301 tests in 32 files pass. Lint, type check and the rules checker are clean.
* CI (`.github/workflows/ci.yml`) runs lint, tests, the offline build, stress and Playwright in Chromium, Firefox and WebKit. It is green.
* Stress, mean and p99 ms per tick (budgets: small 1 ms, medium 4, large 8, busy50 4, terminal640 4):

| Scenario | Mean | p99 |
| --- | --- | --- |
| small | 0.008 | 0.053 |
| medium | 0.006 | 0.056 |
| large | 0.009 | 0.088 |
| busy50 | 0.028 | 0.881 |
| terminal640 | 0.006 | 0.064 |

* Save format version 8 (`src/sim/save/migrations.ts`).

## What works (player view)

A player can start a seeded game with 120 000 000 in cash, buy land, and build an airport that airlines fly to:

* **Runways** with code, approach type, surface and strength. Lengthen, shorten, reclass and resurface them; each edit closes the runway for works days shown before confirming. Obstacle surfaces (approach and transitional) show for a selected runway; penetrations by terrain, uncleared trees, villages or terminals lower the usable approach per direction, and fog needs an instrument approach.
* **Taxiways** with the revision 2 pavement generator: fillets, junctions, bends, shoulders, double edge lines, centerlines, shoulder stripes, signs, slab joints. Snapping to nodes, open ends and segments with J labels and tooltips. A wingtip envelope shows the largest type of the code at the cursor, with red bands where clearances to stands, buildings or parallel taxiways are broken. Surface changes run as works that close the taxiway.
* **Holding points** placed automatically; the select tool drags them further out, never closer.
* **Aprons** as free polygons or rectangles (A toggles), merging when they touch, Ctrl cuts holes.
* **Stands** in four sizes (small, medium, large, extra large), contact or remote, each with a lead in fork of two arcs to the taxilane, push back along an arc (left, right or away from the route), and markings generated from stand and aircraft data. Stands refuse types that do not fit their span or surface.
* **Rapid exits** (30, 45, 90 degrees), the **parallel taxiway** prefab, **GA blocks**.
* **Turn pads** with a placement tool, drawing and removal from the runway inspector. A pad sits beyond the runway threshold, and departures that need the full length backtrack to it. The look was rejected by the user and the work is frozen (`handoff/QUESTIONS.md`, 2026-11-05 T39).
* **ATC tower** in the sim only: a free standing tower with five levels replaced the ATC room. `buildTower`, `upgradeTower` and `demolishTower` exist as commands, the tower is the only ATC source, and it meters landings and takeoffs on a rolling hour budget per runway. It has no build tool and is not drawn yet (task T40), so a player cannot start commercial flights from the UI.
* **Construction grid**: aprons, stands, GA blocks and terminal foundations snap to a 2 m grid along a picked runway or taxiway, with a free mode and Alt as the override. The runway and taxiway tools do not snap to it yet (task T42).
* **Terminals** of any size on a 2 m grid that grows in 64 m chunks: foundations, floors, walls, glass, doors, zones, check in, security, baggage belt, seating, toilets and six shop types. The ATC room fixture is retired: it keeps its saved index, grants no coverage and cannot be built. Room validation stops departures when security can be bypassed.
* **Traffic**: arrivals pick a runway end by wind and performance, land, exit, taxi with node and block reservations, dock, turn around with GSE (tug, tractor, carts, belt loader, refueller, GPU, catering, stairs), push back, taxi out, hold, line up, take off. Wake separation, runway reservations, deadlock detection with an overlay.
* **Business**: seven invented airlines with contracts, fees, a daily ledger, a term loan, a flights board, ratings, weather events (rain, fog, strong wind).
* **UI**: main menu, new game, HUD top bar, tool rail, build menu, context bar, inspectors, sheets, toasts, guided start checklist, saves to IndexedDB with autosave, export and import, crash panel.

## What does not exist yet

`handoff/TASKS.md` holds the work in the delivery order the user approved on 2026-11-10. In short:

* Phase 1, repair: the tower build tool, its five vector looks and strings (T40), and grid snapping for the runway and taxiway tools (T42).
* Phase 2: flight offers and drag to stand (T41).
* Phase 3, passenger core: floor index (T49), kiosk, bag drop, passport booth, gate desk, walking graph, service nodes and queues, cohorts and the departure journey, people atlas rendering, overlays, satisfaction as specified, the 20 000 cohort stress scenario (T11 to T18).
* Phase 4, ground handling and baggage: arrival journey, turnaround task lists, hydrant dispenser and apron bus, service points and service roads, trailers, collision footprints and test, draw order, staff sprites, the working baggage system (T20 to T28, T43), stand markings per revision 3 (T47), stand access types with boarding by jet bridge, stairs or bus (T48).
* Phase 5: tenants (T32, redesigned), generated airlines, route demand and seasonal slots, staffing coverage overlay.
* Phase 6: the seeded event director (T50).
* Phase 7: multi floor terminal designer, hangars, cargo (T51 to T53).
* Deferred by the user: grading (T03), photo calibration (T07) and the runway marking remainder of T02.
* Not placed in the order yet: the sprite port (T05, T06), conflict sets and junction priority (T08, T09), the milestone reviews for M2 and M3, and the M7 UI shell and acceptance tasks (T35 to T38).

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
* Work goes on the branch the user names. The user merges to `main`.
