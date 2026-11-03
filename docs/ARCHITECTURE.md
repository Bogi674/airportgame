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

* 1 tick is 0.1 game seconds. At speed 1 the clock runs 1 game minute per real second.
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
