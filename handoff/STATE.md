# STATE.md

Where the project stands (2026-11-11). Update this file when a task changes what is true here.

## Health

* 377 tests in 35 files pass. Lint, type check and the rules checker are clean.
* CI (`.github/workflows/ci.yml`) runs lint, tests, the offline build, stress and Playwright in Chromium, Firefox and WebKit. It is green.
* Stress, mean and p99 ms per tick (budgets: small 1 ms, medium 4, large 8, busy50 4, terminal640 4):

| Scenario | Mean | p99 |
| --- | --- | --- |
| small | 0.009 | 0.057 |
| medium | 0.009 | 0.079 |
| large | 0.007 | 0.066 |
| busy50 | 0.028 | 0.93 |
| terminal640 | 0.005 | 0.048 |

* Save format version 12 (`src/sim/save/migrations.ts`).

## What works (player view)

A player can start a seeded game with 120 000 000 in cash, buy land, and build an airport that airlines fly to:

* **Runways** with code, approach type, surface and strength. Lengthen, shorten, reclass and resurface them; each edit closes the runway for works days shown before confirming. Obstacle surfaces (approach and transitional) show for a selected runway; penetrations by terrain, uncleared trees, villages or terminals lower the usable approach per direction, and fog needs an instrument approach.
* **Taxiways** with the revision 2 pavement generator: fillets, junctions, bends, shoulders, double edge lines, centerlines, shoulder stripes, signs, slab joints. Snapping to nodes, open ends and segments with J labels and tooltips. A wingtip envelope shows the largest type of the code at the cursor, with red bands where clearances to stands, buildings or parallel taxiways are broken. Surface changes run as works that close the taxiway.
* **Holding points** placed automatically; the select tool drags them further out, never closer.
* **Aprons** as free polygons or rectangles (A toggles), merging when they touch, Ctrl cuts holes.
* **Stands** in four sizes (small, medium, large, extra large), contact or remote, each with a lead in fork of two arcs to the taxilane, push back along an arc (left, right or away from the route), and markings generated from stand and aircraft data. Stands refuse types that do not fit their span or surface.
* **Rapid exits** (30, 45, 90 degrees), the **parallel taxiway** prefab, **GA blocks**.
* **Turn pads** with a placement tool, drawing and removal from the runway inspector. A pad sits beyond the runway threshold, and departures that need the full length backtrack to it. The look was rejected by the user and the work is frozen (`handoff/QUESTIONS.md`, 2026-11-05 T39).
* **ATC tower**: a free standing tower with five levels replaced the ATC room. The player builds it from Flight operations, Air traffic control, picks the level in the context bar, and upgrades or demolishes it from the object panel. It is the only ATC source and meters landings and takeoffs on a rolling hour budget per runway. Movements over the budget queue, the panel shows the queue and an alert fires when queueing starts. Five looks by level are drawn in the chunk bake.
* **Construction grid**: a 2 m grid along the nearest runway or taxiway is offered by proximity. Aprons, stands, GA blocks, terminal foundations and towers snap to it, and the runway and taxiway tools use it as their lowest priority snap after their own node, end and segment snaps. Each tool has a grid or free toggle, with Alt as the override.
* **Terminals** of any size on a 2 m grid that grows in 64 m chunks: foundations, floors, walls, glass, doors, zones, check in, security, baggage belt, seating, toilets and six shop types. The ATC room fixture is retired: it keeps its saved index, grants no coverage and cannot be built. Room validation stops departures when security can be bypassed.
* **Flight offers and stand management**: each signed airline offers its rotations for the day in a read only sheet, with a fixed aircraft type and turnaround per rotation and a movements per hour bar against the tower budget. A flight goes onto a stand by dragging its block onto a stand row, which shows green or red and refuses a drop the stand cannot take, or by picking a stand in the sheet. A stand chosen for a rotation is remembered and applied each morning, and an automation toggle assigns the flights the player has not placed.
* **Traffic**: arrivals pick a runway end by wind and performance, land, exit, taxi with node and block reservations, dock, turn around with GSE (tug, tractor, carts, belt loader, refueller, GPU, catering, stairs), push back, taxi out, hold, line up, take off. Wake separation, runway reservations, deadlock detection with an overlay.
* **Business**: seven invented airlines with contracts, fees, a daily ledger, a term loan, a flights board, ratings, weather events (rain, fog, strong wind).
* **UI**: main menu, new game, HUD top bar, tool rail, build menu, context bar, inspectors, sheets, toasts, guided start checklist, saves to IndexedDB with autosave, export and import, crash panel.

## What does not exist yet

Next task: T14 cohorts and the departure journey (depends on T13, done).

`handoff/TASKS.md` holds the work in the delivery order the user approved on 2026-11-10. In short:

* Phase 1, repair: done (T40, T42).
* Phase 3, floor index: done (T49), save format 11.
* Phase 3, fixtures: kiosk, bag drop, passport booth and gate desk: done (T11), save format 12.
* Phase 3, passenger core: walking graph (T12, done), service nodes and queues (T13, done), cohorts and the departure journey, people atlas rendering, overlays, satisfaction as specified, the 20 000 cohort stress scenario (T12 to T18).
* Phase 4, ground handling and baggage: arrival journey, turnaround task lists, hydrant dispenser and apron bus, service points and service roads, trailers, collision footprints and test, draw order, staff sprites, the working baggage system (T20 to T28, T43), stand markings per revision 3 (T47), stand access types with boarding by jet bridge, stairs or bus (T48).
* Phase 5: tenants (T32, redesigned), generated airlines, route demand and seasonal slots, staffing coverage overlay.
* Phase 6: the seeded event director (T50).
* Phase 7: multi floor terminal designer, hangars, cargo (T51 to T53).
* Deferred by the user: grading (T03), photo calibration (T07) and the runway marking remainder of T02.
* Not placed in the order yet: the M7 UI shell and acceptance tasks (T35 to T38). The sprite port (T05, T06), the network conflict sets (T08) and junction priority (T09) are done, and the M2 and M3 reviews are recorded with deferred rows (`handoff/work/T04-review-m2.md`, `handoff/work/T10-review-m3.md`).

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
* Work goes on the branch the user names. A finished task is merged to `main` and pushed by the orchestrator once it is fully green (user, 2026-11-10).
