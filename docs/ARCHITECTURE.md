# ARCHITECTURE.md

Technical design for simulation, rendering and tooling. Hard rules in `CLAUDE.md` take precedence. Performance rules are in `docs/PERFORMANCE.md`, browser delivery in `docs/BROWSER.md`.

## 1. Threads and modules

Three execution contexts.

| Context | Owns | Never does |
| --- | --- | --- |
| Main thread | Input, camera, DOM UI (Preact), dynamic layer rendering, compositing | Sim logic |
| Sim worker | All game state, the tick loop, commands, queries, saves | DOM, canvas, timers other than its loop |
| Bake worker (optional) | Baking static chunks, sprites and atlases with `OffscreenCanvas` | Game state |

If `OffscreenCanvas` is not available, baking runs on the main thread in idle slices (`docs/BROWSER.md`).

Module boundaries under `src/`:

```
sim/       pure TypeScript, no DOM imports, runs in the sim worker
render/    canvas renderer, camera, layers, sprites, markings, bake worker entry
ui/        Preact components, Zustand stores, tokens, icons
data/      JSON content and zod schemas, shared by sim and render
worker/    worker entry points and the message protocol
shared/    types and pure math used by both sides (no state)
```

`sim` may import only `shared` and `data`. `render` and `ui` may import `shared`, `data` and the protocol types, never `sim` internals.

### Message protocol

Main to sim worker:

* `init { seed, options, saveData? }`
* `command { cmd }`, a serializable command from `src/sim/commands.ts`
* `setSpeed { multiplier }` with 0, 1, 2, 4 or 8
* `query { id, kind, args }` for panel data such as a stand's turnaround or a ledger range
* `returnBuffer { buffer }` to give a snapshot buffer back

Sim worker to main:

* `snapshot { tick, buffer }` at a steady 20 Hz regardless of sim speed
* `staticDirty { chunks, kinds }` when built geometry changed
* `staticData { kind, payload }` for geometry the renderer bakes (pavement, markings inputs, buildings), sent on change only
* `queryResult { id, data }`
* `events { list }` for alerts and toasts
* `perf { simMsPerTick, tickBacklog, entityCounts }`

### Snapshot buffers

Transferable `ArrayBuffer`s with a pool of three. The worker fills one, transfers it, and the main thread returns it after rendering. Layout lives only in `src/shared/snapshot.ts` with versioned offsets.

Snapshot contents: aircraft (id, type index, x, y, heading, state, livery index), vehicles (id, kind, x, y, heading, parent index), a sample of people (x, y, heading, recipe, frame phase) capped at 3 000, terminal density grid (`Uint16Array`), queue counts per service node, runway states.

The renderer interpolates positions and headings between the last two snapshots.

## 2. Determinism

* `rng.ts`: `mulberry32` with `fork(label)` deriving child seeds by hashing the parent seed with a label. Each subsystem has its own stream.
* `stateHash()` folds key arrays into a 32 bit hash for tests.
* State affecting math uses `+ - * /`, `Math.sqrt`, `Math.hypot`, `Math.abs`, `Math.min`, `Math.max`, `Math.floor`. Trigonometry that affects state uses lookup tables in `shared/trig.ts`. Rendering may use anything.
* Iterate by array index or sorted id.
* Replay: `{ version, seed, options, commands: [{ tick, cmd }] }` runs headlessly through `replay.ts`, used by tests and the stress tool.

## 3. Time

* 1 tick is 0.1 game seconds. At speed 1 one game hour takes 20 real seconds (3 game minutes per real second, 1800 ticks per second).
* Cadences: aircraft and vehicles every tick, people cohorts every 5 ticks, queues and service nodes every 10, baggage and turnaround tasks every 10, ATC sequencing every 20, congestion costs every 50, market, tenants and finance once per game day, events every game hour.
* If the worker falls behind it drops snapshots, never ticks, and reports `tickBacklog`. Over 50 ticks of backlog, speed caps automatically and the UI says so.

## 4. Spatial model

* **Site space**: an 8 by 8 km world in meters. Terrain heightmap at 10 m. Land parcels as polygons with type, price and owner.
* **Alignment frames**: each runway defines a frame (origin and angle). Snapping uses the nearest frame. Frames are data, not a grid.
* **Building space**: each gridded building has an origin, a rotation and a local 2 m grid. All interior data is axis aligned in that grid.
* **Static spatial index**: a uniform grid of 64 m cells over site space for picking and validation. A finer 8 m grid for vehicle broad phase on aprons.
* Camera zoom from 0.05 to 40 px/m. View rotation is a camera property ("align view to runway").

## 5. Airfield model

### 5.1 Taxi network

Built from player polylines when they change, never during ticks.

* **Nodes**: junctions, holding points, runway entries and exits, stand entries, push back points, de-icing pads.
* **Segments**: centerline curve (lines and arcs with fillets from the code turn radius), length, max code, direction (`both`, `forward`, `reverse`), `closed` flag, speed limit, kind (`taxiway`, `taxilane`, `rapidExit`, `apron`, `runway`).
* **Blocks**: maximal runs of two way segments between junctions. A two way block is reserved as a whole so aircraft never meet head on.
* **Precomputed per segment**: polyline samples every 2 m (position and heading) for movement and rendering, and conflict sets (segments whose wingtip envelopes overlap at junctions).
* **Validation** on every edit: stand to runway connectivity, code clearances (section 6 of `GAME_DESIGN.md`), slope.

### 5.2 Aircraft movement

* State machine: `approach`, `landing`, `rollout`, `exiting`, `taxiIn`, `docking`, `turnaround`, `pushback`, `taxiOut`, `holding`, `lineup`, `takeoff`, `departed`.
* Position is `(segmentIndex, distance)` plus speed. Each tick: `distance += speed * dt` with acceleration and braking limits. Position and heading come from the precomputed samples. No physics.
* On the runway: deceleration profile by type to the chosen exit, takeoff roll by type.

### 5.3 Routing

* A* on the network once per leg, from a node to a node, respecting direction, closures and max code.
* Cost: `length / speedLimit + turnPenalty + congestionCost + preferredFlowDiscount`.
* `congestionCost` per segment is updated every 50 ticks from reservations and queue lengths.
* Preferred flows are player defined routes. A matching open preferred route gets a strong discount.
* Results are cached per (from, to, code) and invalidated when the network changes. Congestion only affects new requests and periodic re-plans (every 60 game seconds for aircraft still more than two segments from the conflict).

### 5.4 Reservations and conflicts (signal style)

* Before entering a segment an aircraft reserves it and a lookahead distance of `max(60 m, speed * 8 s)` ahead, including conflict sets at junctions.
* Two way blocks are reserved whole.
* Following: speed is capped so the gap to the aircraft ahead stays above `20 m + 0.5 * wingspan` and grows with speed.
* Junction priority: aircraft vacating a runway first, then arrivals, then departures, then by request time.
* Holding points: an aircraft stops and requests a runway clearance from ATC.
* Push back: reserves the push path on the taxilane before starting.

### 5.5 Deadlocks

* Maintain a wait graph (who waits for whom) updated on block events.
* On a cycle, the lowest priority aircraft releases its lookahead and either holds or re-plans. Count deadlocks and show them in the debug overlay with the cycle drawn.

### 5.6 Runway operations

* Runway is an exclusive resource with occupancy timers. ATC grants entry with wake separation from `src/data/wake.json`.
* Intersection departures check takeoff distance available from the entry against the required length (`GAME_DESIGN.md` section 5).
* The wind band of each runway end is computed once per weather change.

### 5.7 Stands

* A stand stores type, surface, polygon, entry node, push back path and direction, assigned types, stop positions per type and service lane graph.
* Contact stands link to a gate, remote stands to a bus gate.
* MARS stands hold modes: one large, or left and right.
* Restraint envelopes and markings are generated on the render side from stand data.

## 6. Ground vehicles

* Struct of arrays: position, heading, speed, kind, task, `parentIndex` (minus one for powered units), height, footprint size.
* Trailers update after their parent in index order: `axle = hitch - axleOffset * normalize(hitch - axle)`, heading from axle to hitch.
* Vehicles route on a service road graph (head of stand roads, perimeter roads, depot links) plus per stand apron lane graphs. Same reservation rules as taxiing at lower speeds. Road crossings over taxiways reserve the crossing and yield to aircraft.
* Docking poses per vehicle kind and service point come from `src/data/gse.json` and the type's service points.
* Collision: hard footprints and overhead zones per aircraft type are built once and cached. Checks run at docking, at reservation and when a stand configuration changes, not every tick for every pair.
* A test builds every stand template with every assigned type and the full turnaround vehicle set and fails on any overlap.

## 7. Terminal model

* Grid layers: floors, walls, doors, rooms with types, fixtures, shop units.
* Walking graph built from rooms and doors, with a 6 m waypoint lattice in large rooms. Distances computed lazily and cached. Edits rebuild only the affected region.
* Walk time is `distance / walkSpeed` with a congestion factor from local density.
* Service nodes: servers, seeded service time distribution, queue capacity and queue area. Queue geometry is cosmetic.

## 8. Passenger cohorts

Struct of arrays with capacity 200 000: `flightId`, `size`, `profile`, `stage`, `node`, `timer`, `bags`, `spendBudget`, `satisfaction`, `recipeSeed`, `flags`.

Journey stages advance by timers and node transitions. Cohorts split for shops and merge at the next common node. Flights generate cohorts from arrival time distributions by profile and access mode.

## 9. Rendering pipeline

* Layer order and detail tiers per `docs/ART_AND_ASSETS.md` sections 2 and 3.
* **Static layers** (terrain, pavement, paint, building floors and roofs) bake into 512 m chunks per zoom band, in the bake worker when available. A chunk re-bakes only when marked dirty.
* **Dynamic layer**: vehicles, bridges, aircraft, people. Each frame: cull by viewport, pick the tier, draw baked sprites with `setTransform` and `drawImage`. No path building per frame.
* **Sprites** come from LRU caches keyed by asset, livery, tier and pixel ratio.
* **People** draw from one atlas per tier, capped at 3 000 per frame.
* **Overlays** render to their own canvas only when toggled or when their data changes.
* Target 60 fps at 1080p on a mid range laptop with automatic quality reduction (`docs/PERFORMANCE.md`).

## 10. Save and load

* Format: a JSON header (version, seed, options, game date, thumbnail) plus binary blobs for arrays, compressed with `CompressionStream` gzip.
* Contents: build data, entity arrays, ledger, contracts, tenants, event deck position, RNG states, released content phases.
* Autosave every game day to IndexedDB in 3 rotating slots per career. Manual saves unlimited within quota. Export and import as a file.
* Migrations by version number in `src/sim/save/migrations.ts`.
* Test: 5 000 ticks, save, load, 5 000 more equals 10 000 uninterrupted.

## 11. Testing

* Unit tests: RNG, geometry, network building, routing, reservations, deadlock detection, trailer kinematics, collision checks, queue math, ledger math, migrations.
* Determinism test per subsystem.
* Property tests: any valid layout gives a connected network and no overlapping reservations.
* Golden seed `GOLDEN-0001` site hash.
* Stand collision test over all templates and types.
* Visual regression: Playwright screenshots of reference scenes compared with a tolerance.
* Performance: `npm run stress` budgets in `docs/PERFORMANCE.md`.

## 12. Decisions

Record every architectural choice with a date and one line of reason.

* 2026-11-03: Sprites are baked from vector geometry per zoom band and rotated at draw time, so detail scales with zoom and memory stays bounded.
* 2026-11-03: Building interiors snap to a local 2 m grid with 90 degree rotation, while airfield geometry and free standing buildings use free angles with alignment frame snapping, because grid snapping only saves cost where a grid exists.
* 2026-11-03: Trailers are separate rigid units following their hitch, so any turn looks right without turning frames.
* 2026-11-03: Taxiing uses segment positions with signal style reservations and congestion aware routing, not free movement physics, to keep 150 aircraft cheap.
* 2026-11-03: Content ships in releases. MVP 1 has 10 aircraft, Release 1.0 all 42 Phase 1 aircraft.
* 2026-11-03: UI uses Preact for components because it is about 4 KB and fast. Added to the allowed dependency list.
* 2026-11-03: No noise complaint system.
* 2026-11-03: Trig lookup table is built with a Taylor series using only `+ - * /`, so it is bit identical on every engine, unlike tables filled with `Math.sin`.
* 2026-11-03: `Rng.fork(label)` derives from the original seed, not the current state, so a subsystem stream does not depend on fork order or parent use.
* 2026-11-03: Commands travel as one `commands { list }` message per animation frame instead of one `command` message each, to match the batching rule in `docs/PERFORMANCE.md` section 4.
* 2026-11-03: While paused the worker calls `flushCommands()`, which applies queued commands at the current tick without advancing time. Replay applies them at the start of that same tick, so the result is identical.
* 2026-11-03: M0 sim content is test aircraft flying straight lines, only to exercise the loop, snapshots, replay and stress tool. They are removed when real aircraft arrive in M3.
* 2026-11-03: Zoom bands for chunk baking are below 0.4, 0.4 to 3.2 and above 3.2 px/m, at raster scales of 0.25, 1 and 4 px/m, so a 512 m chunk is at most 2048 px.
* 2026-11-03: `worker/scope.ts` types the worker global by hand so the DOM lib and worker code share one tsconfig.
* 2026-11-03: Parcels are an id raster at 10 m plus a table (type, area, price, centroid), not polygons. Picking is one array read, the fence and parcel boundaries are traced from the raster, and the tint is one texture. Parcels come from a warped Voronoi, split by water and by road segments, so a parcel can span both banks of a river.
* 2026-11-03: Terrain and parcels are generated with value noise on a 40 m coarse grid and interpolated, so a site generates in about 150 ms.
* 2026-11-03: The fairness guarantee is built in, not hoped for. The corridor is chosen on terrain first, carved flat and dry if no natural candidate exists, and parcels under it are forced to buyable types. `tests/site.test.ts` re-checks it independently over 500 seeds (about 3.5 minutes, so it is the slowest test).
* 2026-11-03: Starting cash is a 30 million placeholder and the affordable land budget for the fairness check is 8 million, until the finance milestone defines difficulty.
* 2026-11-03: The sim sends the site once as transferred typed arrays (`staticData` kind `site`) and ownership on change (kind `ownership`). The bake worker receives its own copy of heights, classes and parcel ids.
* 2026-11-03: Chunk raster scale is 0.25, 1 and 4 px/m. Terrain colour is a bilinear blend of class colours with hillshade, and trees, field stripes and buildings are drawn procedurally from hashes only at 1 px/m and above.
* 2026-11-03: Airfield objects (runways, taxiways, aprons, stands) are plain objects in `Airfield`, with typed arrays reserved for hot entities. Holding points, entries and effective max codes are derived after every change by `deriveNetwork`.
* 2026-11-03: Build validation lives in `shared/validate.ts` and is used by both the sim (authoritative) and the UI previews, so a preview turns red exactly when the sim would refuse. Problems are `code|key=value` events that the UI turns into explained messages.
* 2026-11-03: Airfield edits send the whole airfield to the baker and mark every cached chunk dirty. Dirty chunks keep drawing their old image until the new bake arrives, so edits never flash.
* 2026-11-03: Holding distance is measured from the runway centerline (75 m visual, 90 m instrument), per the design doc.
* 2026-11-03: Undo and redo are sim commands with a history of add and remove operations including the cash change, so they replay deterministically. Property changes (one way, closed, max code, speed) are not part of undo.
* 2026-11-03: Workers are built inline (`?worker&inline`, classic format), so the whole game is one HTML file that runs from `file://`. Module workers from a `blob:null` origin did not start in Chromium, classic ones do.
* 2026-11-03: Two way taxiways share one reservation block per taxiway, so opposing aircraft never meet head on. Stand lead ins and one way edges need no block. Block counts are recounted from what aircraft hold every 20 ticks, so a missed release cannot lock a taxiway for good.
* 2026-11-03: Runway use is a list of reservation windows per runway with wake separation from `src/data/wake.json`. A departure that waited more than 2 game minutes holds back new landings, which keeps departures from starving.
* 2026-11-03: Each runway entry takes at most two queued departures, and arrivals avoid an exit connector with a departure queue. This keeps hold queues from spilling onto the parallel taxiway and gridlocking it.
* 2026-11-03: Passengers are aggregated, not cohorts. A flight carries seats times a load factor from demand and rating, terminal capacity limits how many are processed, and fees follow. The terminal is a rectangle with counted modules (check in, security, belts, seating, toilets) and shop units instead of a gridded interior.
* 2026-11-03: Every cash change goes through `Sim.book(category, amount)`, which keeps the daily ledger. The daily close runs at midnight and the game starts at 06:00.
* 2026-11-03: Saves are the full dynamic state as JSON with base64 typed arrays, gzip in the browser. The site is regenerated from the seed. Determinism test: 5 000 ticks, save, load, 5 000 more equals 10 000 uninterrupted.
* 2026-11-03: Test traffic commands (`setTestTraffic`, `testArrival`) stay as scaffolding for tests and the stress tool, real flights come from airline contracts.
* 2026-11-04: Terminals are player built, not prefabs. Each building has a 160 by 160 cell grid (2 m cells) with an origin and a heading, and layers for floor, fixtures, horizontal and vertical wall edges and shop leases. `shared/terminalOps.ts` holds the edit rules and prices, and both the sim and the UI previews call it, so a preview is red exactly when the sim would refuse. Capacity comes from the fixtures laid: check in and security set departures, belts set arrivals.
* 2026-11-04: At speed 1 one game hour takes 20 real seconds (1800 ticks per second). Starting cash is 120 million.
* 2026-11-04: Taxiway markings are one continuous centerline cut only where it would enter a runway, and mitred edge lines that stop where another pavement opens (junctions, runways, aprons), found by sampling along the line.

* 2026-11-04: Markings come from a planner, `render/markings/taxiPlan.ts`, and are applied automatically when the layout meets a condition. A taxiway ending on another taxiway or a runway gets fillets (tangent length R / tan(half angle)), lead-on centerline arcs concentric with the fillet (radius R plus half width), and an opening cut in the through feature's edge line. A taxiway meeting a runway gets a four line holding position (two solid on the aircraft side, two dashed on the runway side), 75 m from the runway centerline (90 m on instrument runways) with enhanced centerline dashes before it on instrument runways, plus a red runway sign and a yellow on black taxiway sign. Stand lead-ins curve onto the lane the same way. Checked against FAA AIM 2-3, ICAO Annex 14 and UK CAP 637 style guidance: confirmed the double yellow edge lines, 0.15 m holding lines, pattern A, red centerline use, threshold stripe counts by width, 30 m by 1.8 m stripes, 30 m stripe and 20 m gap runway centerline, aiming point by runway length and touchdown zone pairs by length. faa.gov and skybrary.aero were not reachable from the build environment, so these were checked through search results and secondary sources only.
* 2026-11-04: Buildings and pavement look grounded through baked paint only: a cleared pad under terminals, stacked translucent soil strokes around aprons, taxiways and runways, thin lit and dark curbs and a small shadow offset to the south east. It lives in the chunk bake, so it costs nothing per frame and has no coupling to terrain data.
* 2026-11-04: UI theme is CSS variables in `ui/theme.css` (blue dark, and light), chosen from localStorage or `prefers-color-scheme`, toggled in the top bar. Icons are an outline SVG set in `ui/icons.tsx`. Sheets share a tab bar.
* 2026-11-04: Junction paint follows the FAA lead-on style: small pavement fillets (half the code radius) and a wider lead-on centerline arc (up to 2.2 times the code radius, limited by pavement and the available length). The HUD has no bar: information chips at the top left (time with day or night icon, weather, prevailing wind, cash, net cash today, rating, passengers today, aircraft, free stands) and control clusters at the top right. The bottom options panel is toggled from the left rail, and the minimap is faded until hovered or pressed. Wind is the site's prevailing wind (the sim has no live wind yet) and passengers are the day's count (cohorts are not modeled yet).
* 2026-11-04: Terminal zones are a per cell layer (public, commercial, secure, staff only) painted with the Zones tool. Each fixture lists the zones it may sit in (`FIXTURE_ZONES`); placing one on unzoned floor paints its default zone, placing it in a conflicting zone is refused, and painting a zone over a fixture that does not fit is refused. Seating in a secure zone is required for full departure capacity (half without it). The control room (ATC) is a terminal fixture in a staff only zone: at least 4 cells and within 3.5 km of every runway midpoint, otherwise no airline schedules flights. Airlines hold per rotation arrival slots (default spread without randomness) that the player edits in the Slot manager, applied to the next scheduled flights. Save format is 2, older saves default the new layers.
* 2026-11-05: Ground vehicles live in `sim/vehicles/gse.ts` as a presentation of the turnaround. They drive from 40 m beside the stand to a service point given in the aircraft frame, wait, and drive off, and a tug stays attached during push back. They never change aircraft timing, so they are not saved or hashed, and the sim needs no path search for them. Snapshot layout is version 3 with vehicles and aircraft flags.
* 2026-11-05: Passengers on screen are a render sample (`render/people.ts`). Dots spawn from the passengers handled and walk in straight lines between the fixtures the player laid. Terminal rooms are validated by flood fill over floor with walls blocking and doors open (`shared/terminalRooms.ts`), a building with a security bypass or no reachable secure seating processes no departures.
* 2026-11-05: Flights carry a stage length. Takeoff weight is empty weight, passengers at 100 kg and the fuel the stage needs, capped at MTOW with payload cut. A stage is at most 85 percent of the type's range. Taxiways have a preferred flow that triples edge cost against it. The quality governor follows docs/PERFORMANCE.md section 5 and presets lock it.
* 2026-11-04: Revision 2 data lives in `src/data/surfaces.json` (rules, costs, colors and works rates per surface), `src/data/stand_sizes.json` (the four stand sizes) and the taxiway turn radius and shoulder columns of `airfield_codes.json`, all checked by zod schemas in `src/data/schemas`. `polygon-clipping` is an approved runtime dependency (it brings `robust-predicates` and `splaytree`).
* 2026-11-04: Taxiway pavement geometry lives in `src/shared/pavement`, not `src/sim/airfield/pavement` as DESIGN_REVISION_2.md section 0 says, because the renderer and UI may not import sim internals and both need it. It uses the trig lookup tables, so the sim can use the same curves. Nodes come from the taxiway polylines for now (`fromAirfield.ts`); the step 4 tool will store them directly.
* 2026-11-04: Pavement is built per cluster: nodes whose shapes reach each other along a short edge are merged with one polygon union, and the edges between clusters are plain strips that overlap the cluster fill by 0.5 m (no antialiasing seam) while their lines meet the cluster exactly at its cap. A cluster is cached by its content, so an edit only rebuilds the clusters it touches. Edge lines and shoulders are the same pieces built at half width minus 0.25 and 0.95 m, and plus the shoulder, which equals an exact offset of the merged shape. The clipper input is snapped to a 0.1 mm grid; a failed union is retried on shifted and coarser grids, then piece by piece, and rings under 0.5 m2 are dropped as clipper leftovers. A random property test builds 400 junctions with mixed codes and tight angles.
* 2026-11-04: A junction turn uses the smaller code of its two arms (only aircraft that fit both use it); a bend uses the larger code and width, so a width change at a bend reads as a step and never a notch. Turns that do not fit their edges shrink, and a turn tighter than its half width plus 0.5 m is dropped: a bend then becomes a round corner. Runway entries keep their fillets, lead-on curves and holds from `taxiPlan.ts` and pass edge line trims to the generator.
* 2026-11-04: Taxiway paint follows `junction2` in fig6.py: shoulder stripes every 7 m along the fillet edges only (not beside straight arms, within 2.2 turn radii of the junction), concrete lines with a dark outline, unpaved surfaces with edge markers every 15 m and no paint, 5 m slab joints on concrete strips. Palette and paint dimensions live in `src/data/paint.json`. Signs are drawn at true scale (2.4 m panels, hard rule 12), 40 m before each junction on the left of the approaching aircraft, with direction boxes for the other taxiways left and right of the location box.
* 2026-11-04: Taxiway surface changes go through works (`Taxiway.works`, save format 3): the cash change is booked at once, the taxiway is closed to routing until `doneTick`, then the new surface applies and the markings regenerate. Duration is `worksDaysPerKm2` of the target surface times the area with paved shoulders, at least `minWorksDays`. An upgrade pays the new pavement, a downgrade refunds `refundShare` of the old value minus the new surface. A downgrade is refused when a type that the signed airlines fly and whose code fits the taxiway does not list the new surface. A class change applies at once. Rules live in `shared/surfaceRules.ts` so the inspector shows the exact price and days.
* 2026-11-04: The taxiway tool snaps through `shared/pavement/snap.ts`, used by both the preview and the sim: node (two or more arms, labelled J1, J2 by graph order), open end, segment middle, then angle guides every 15 degrees with a 3 degree pull. Snap radius and minimum node gap are 15 m (`taxiwayTool` in airfield_codes.json). The sim keeps taxiways as polylines: a segment hit inserts a vertex into that taxiway, an open end hit with the same class, kind, surface and strength extends that taxiway, and a free point closer than 15 m to a node is refused. Undo records copies of every taxiway it changed, so undo and redo restore the arm set exactly.
* 2026-11-04: Stands have one of four sizes (`small`, `medium`, `large`, `xl` from stand_sizes.json) and are `contact` or `remote`; small stands are always remote. A type fits a stand when its wingspan is within the size and the stand surface is on its list (`shared/standSizes.ts`), so smaller types may use larger stands. Remote taxi through and GA tie down stands are gone; a GA block builds small stands. Save format 4 maps the old types: the size from the stored code, contact stays contact, the rest become remote, push back becomes `auto`. The extra large double stand for the An 225 stays a data value (`mergeable`), since no released type needs it yet.
* 2026-11-04: The stand fork (`shared/standFork.ts`) is one function for the sim network and the painter: the stand centerline from the stop point to the fork point at the fork radius D, and two arcs of radius D (fillet() with the trig tables) that meet the taxilane tangentially. Facing arc ends of neighbouring stands within 8 m share their midpoint, trimming each arc by a few centimeters. In the network the arcs are `StandFork` edges with their own reservation blocks; their inner points never merge with other lines, and crossing splits and end snapping skip pairs of stand lines. A fork is entered only on the way to its own stand and left only from it, and only by the aircraft that owns the stand.
* 2026-11-04: Push back runs along the lead in and one fork arc: the stand's set side, or by default the side away from the departure route, switching to the other side when the chosen one is blocked while the aircraft is still on the stand. Before leaving the stand it needs the arc's taxilane node free, no other push back heading for that node, the 28 m of taxilane beyond it clear in the push direction, and the taxiway past it not held the other way. The stand is freed when push back reaches the taxilane. Block waits name a holder that is itself waiting, so the deadlock check sees the cycles. The busy airport test completes more flights than before with fewer than ten deadlock resolutions.
* 2026-11-04: Stand markings are drawn from stand data and aircraft data (`render/markings/standLayout.ts`, `standPaint.ts`, after fig4_stand_data.py and fig5.py). Aircraft gained `stand` geometry (nose gear, door stations, fuel coupling) for the ten released types. The funnel search uses the sprite planforms and a polygon distance test instead of buffering. A stand is drawn for the types whose own size it is, else the largest types that fit; with no code F type released, extra large stands show the large types. Remote stands show a dashed bus bay where the jet bridge zone would be. Fixed a trig table bug: an angle a hair below zero returned NaN.
* 2026-11-04: Aprons are polygons with holes (`shared/apronGeom.ts` on polygon-clipping, inputs snapped to 5 cm). A new piece of the same surface that overlaps or touches existing aprons merges with them into one apron, keeping the oldest id and name; a cut takes a piece out and may split an apron or remove it, dropping parts under 50 m². Both record the aprons they replace in the undo op (`replaced`) so undo restores them exactly.
* 2026-11-04: The apron rectangle mode builds in an alignment frame (`apronFrame`): the frame of the nearest taxiway or apron edge, else north up, so a rectangle drawn next to a skewed taxilane lines up with it.
* 2026-11-04: Terminal grids are growable (revision 2 section 5): logical cell coordinates with a bounding box `x0, y0, w, h` that grows in 32 cell (64 m) chunks when a foundation is laid outside it, copying the cells. A bounding box rather than a chunk map keeps cell lookups a single index; the old 4 000 cell clamp is gone. Saves store the bounds (version 6), older saves load as a 160 cell grid at the origin.
* 2026-11-04: Obstacle surfaces live in `shared/obstacles.ts`, one function for the sim and the runway tool preview. Terrain is sampled every cell in the runway's own frame, about 7 ms per approach type. The sim works them out again only when runway geometry, terminal outlines or owned land change, and hands the usable approach per direction straight to the traffic, so they never rebuild the taxi network (a rebuild resets reservations and would make a restored save drift from an uninterrupted run). Results are derived, not saved.
* 2026-11-04: The taxiway tool's wingtip envelope (`shared/clearance.ts`) samples the new arm every 4 m. Stands count as discs of half their width, terminals as their floor bounds. Another taxiway clashes only when it runs within 25 degrees of parallel, so connectors that cross or join it do not, and the first and last taxiway separation of the arm are exempt.
* 2026-11-04: A moved holding point is stored on its taxiway (`Taxiway.holds`, per runway and side of the centerline) and the holding points are still derived from the geometry. Keeping it on the taxiway lets undo, redo and saves reuse the taxiway swaps; save format 7 only adds the optional field. A distance the taxiway does not reach is refused, so a runway crossing always keeps a holding point.
* 2026-11-04: Runway edits apply at once and set `Runway.works` (closed until a tick), rather than holding the new geometry back like taxiway surface works: a runway's length and class feed entries, holds and separations, and a half built state would need its own geometry. Traffic refuses runway slots while it is closed, so movements already under way finish and new ones wait or divert.
* 2026-11-05: Turn pads are a runway property (`Runway.pads`, per end and side) with geometry worked out in `shared/turnPad.ts`, so a pad follows its end when the runway is resized. Routing still never uses runway edges: a departure whose entry leaves too little length backtracks as its own state (`AcState.Backtrack`) inside one runway reservation that covers the backtrack, the turn and the roll. Arrivals do not backtrack.
* 2026-11-05: The pad cost is one shared function (`padValue` in `shared/turnPad.ts` from `runwayUnitCost` in `shared/surfaceRules.ts`), so the sim and the tool preview price a pad identically and the sim keeps no private copy of the formula.
* 2026-11-05: Pad paint goes through the marking plan: the plan gains `padCurves` and an edge line break per pad side, and the chunk painter fills the pad polygon right after the runway fill and strokes the curve before any white paint. Baked from the plan, the pad needs no extra version counter beyond the existing airfield version bump.
* 2026-11-05: A turn pad is pavement beyond the runway end rather than beside its last meters (user revision): a sharp rectangle from one meter inside the end to the code's pad length outward, flush with the runway's far edge with the code's extra width on the picked side. Because the pad lies outside the runway, the plan drops its edge line break and the painter reads culling bounds from the pad polygon. The threshold, the declared distances and the backtrack pivot at the end are unchanged, so the sim needed no change.
* 2026-11-05: The turn pad marking was redrawn to the user's reference diagram as a tangent loop: the curved branch leaves the threshold along the runway centerline, the loop is a circle of a third of the paved width in radius centred a little over half the pad length out on the pad's lateral centre, and the return branch is a straight diagonal to the threshold. The loop keeps a tenth of the paved width clear of the pad edges, which the old 3 m teardrop did not.
* 2026-11-06: The construction grid lives in `src/shared/constructionGrid.ts`, derived from the airfield payload and cached per payload and version, so it needs no sim change, no version bump and no save change. Spacing (2 m, 10 m) is data in `airfield_codes.json`. Heading uses `atan2Det` so shared state math has no native trig.
* 2026-11-10: The grid is offered by proximity, not picked (user decision, Cities Skylines model). The tool controller sets `gridId` in the tool store to the nearest grid within the pavement edge plus a screen scaled margin and keeps the current one while it stays in reach. It is UI state only and is never persisted.
* 2026-11-10: The grid is the lowest priority snap of the runway and taxiway tools, applied in `snap` after vertex, runway edge, centerline and alignment guide and before angle stepping. Aprons, stands, GA blocks and terminals let it win over every other snap.
* 2026-11-10: On a rotated grid the nodes are not on 0.5 m coordinates, and the sim rounds stands, aprons and runway ends to 0.5 m, so a placed object can be saved up to 0.25 m from the node the preview showed. Known and accepted. A later task can decide whether the sim should round to the grid.
* 2026-11-10: Network conflict sets (T08) cover taxiway, taxilane and rapid exit edges only. Runway edges keep their runway reservations and stand lead in and fork edges keep stand ownership (user decision). Two edges of different taxiways conflict when, near a junction, two samples are closer than half the sum of their codes' taxiway separations, so two parallel taxiways at the standard separation just clear. The zone around a junction is the largest taxiway separation of its edges. Sets are stored as `conflictStart` and `conflictEdge` typed arrays and built once in `TaxiNetwork.build`, so no save change.
* 2026-11-10: `Traffic.tryEnter` refuses an edge while another taxiing aircraft is on a conflicting edge within the zone plus 30 m (`CONFLICT_MARGIN_M`) of the junction node, and records that aircraft in `waitingFor`, so the deadlock detector sees the cycle. The aircraft's current edge is checked as well as the next one, because it sweeps the end of its own edge. An aircraft that has left the node and cleared it with its tail no longer holds it. When two aircraft wait for each other the lower index goes first. Junction priority order stays with T09. The wingtip check in `tests/networkProperties.test.ts` skips stopped aircraft and pairs that wait for each other, because a waiting aircraft stops its span over two plus 12 m short of the node, which the node owner check governs and which is closer than the code clearance by design.
* 2026-11-10: Junction priority (T09) keeps a saved request table `reqNode`, `reqTick`, `reqClass` per aircraft. Class 0 is `TaxiIn` on the first route edge, 1 is any other `TaxiIn`, 2 is departures, 3 is push back. Ties go to the earlier request tick, then the lower index. Why: the ARCHITECTURE 5.4 order, deterministic.
* 2026-11-10: `tryEnter` is split into a side effect free `entryBlocker` and the grant. A better ranked requester only holds another back when its own `entryBlocker` is clear, so priority never blocks a junction nobody can use. A priority wait sets `waitingFor`, which feeds the overlay and the deadlock detector unchanged.
* 2026-11-10: Mutual conflict waits keep the lower index tie break. Ordering them by rank cut arrivals in the tower budget test from over 20 to 14. Save format 9 adds the request table, and older saves load with it empty.
