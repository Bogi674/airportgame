# PERFORMANCE.md

Rules that keep the game light in the browser. Read before writing any sim loop, renderer code or UI that updates often. Measure, then optimize.

## 1. Budgets

| Metric | Small airport | Medium airport | Large airport |
| --- | --- | --- | --- |
| Active aircraft | 10 | 50 | 150 |
| Active vehicles (units) | 60 | 300 | 900 |
| Passenger cohorts | 2 000 | 20 000 | 100 000 |
| Sim time per tick (worker) | under 1 ms | under 4 ms | under 8 ms |
| Dynamic layer per frame (main) | under 3 ms | under 7 ms | under 12 ms |
| Tab memory | under 150 MB | under 220 MB | under 300 MB |

Other budgets:

* First load to main menu: under 3 s on a 50 Mbps connection, under 1 s when cached.
* Initial JavaScript under 350 KB gzip. Aircraft data and art generators load per release and per need.
* New game generation (site, parcels, wind) under 1.5 s.
* Saving a large airport under 500 ms, loading under 1.5 s.
* Building or editing anything gives visual feedback within one frame. Network rebuilds and re-bakes finish within 100 ms for a typical edit.

`npm run stress` builds the three scenarios from fixed seeds, runs 20 000 ticks headlessly and prints mean and 99th percentile ms per tick per subsystem. CI fails if any budget is exceeded or any subsystem regresses by more than 10 percent against `perf-baseline.json`.

## 2. Data and memory

* Hot entities (aircraft, vehicles, cohorts, service nodes, reservations) use struct of arrays in typed arrays with a fixed capacity and a free list. Ids are integer indexes.
* Keep an active index list per entity type. Loops run over active indexes only.
* No allocation in tick loops or the render loop: no object literals, no array literals, no closures, no `map`, `filter`, `forEach` or spread. Use plain `for` loops over indexes and preallocated scratch arrays.
* No `Map` or `Set` in hot loops. Use typed arrays indexed by id.
* Strings never appear in hot data. Use enum integers and look up names only for UI.
* Geometry that does not change during play (taxi samples, conflict sets, footprints, walking distances) is precomputed when built and stored in typed arrays.
* Mark hot functions with a `// hot` comment. ESLint rules forbid allocations in functions with that marker where possible, and reviews check the rest.

## 3. Simulation

* Event driven over polling: recompute only when something changed (an edit, a weather change, a schedule change).
* Cadences per subsystem as in `docs/ARCHITECTURE.md` section 3. Spread heavy work across ticks, for example one tenth of service nodes per tick.
* Flights outside the airport are timers, not moving objects. Only aircraft on approach, on the ground and departing are simulated geometrically.
* Routing is cached and done once per leg. Congestion costs update every 50 ticks.
* Collision checks run at docking, at reservation and when a stand changes, never as all pairs per tick.
* Walking distances are cached per region and rebuilt only for edited regions.
* Finance and the market run once per game day on aggregates.
* Time slicing: any job that may exceed 2 ms (network rebuild, large walking graph rebuild, save serialization) runs as a resumable job across ticks with progress reported.

## 4. Worker communication

* Snapshots at 20 Hz in transferable buffers from a pool of three. Never post large objects that are structured cloned.
* Static geometry goes to the renderer only when it changes, as compact typed arrays.
* Queries from the UI are throttled to at most 10 per second and answered with small objects.
* Commands are batched per frame.

## 5. Rendering

* Static layers bake into 512 m chunks per zoom band, in the bake worker when `OffscreenCanvas` is available. Re-bake only dirty chunks. Keep at most the visible chunks plus one ring in memory per band.
* Dynamic layer: cull by viewport with the static spatial index, choose the detail tier by zoom, then draw baked sprites with `setTransform` and `drawImage`. No path drawing, no text measurement and no `shadowBlur` per frame.
* Avoid `save` and `restore` per sprite. Set the transform directly.
* Group draws by sprite to keep the GPU path warm.
* People draw from one atlas per tier and are capped at 3 000 per frame, scaled to real density. Beyond that the density heat map carries the information.
* Overlays render to their own canvas and update only on toggle or data change.
* The construction grid overlay draws only while a placement tool offers a grid. It maps the four viewport corners into the grid frame, draws only the lines in that range as two stroked paths, and drops the minor lines below 2 px spacing and the whole grid below 3 px, so its cost is bounded by the viewport and not by the airfield.
* Device pixel ratio: back the canvas at `min(devicePixelRatio, 2)` by default. The quality setting may go to 1.
* Labels are cached as small bitmaps per text and size.

### Automatic quality governor

Measures the frame time over a rolling 2 s window.

1. Over 20 ms: lower the people cap to 1 500 and the overlay resolution by half.
2. Still over 20 ms: drop aircraft and vehicle detail one tier earlier.
3. Still over 20 ms: back the canvas at device pixel ratio 1.
4. Under 12 ms for 10 s: restore one step.

The player can lock a quality preset (Low, Medium, High) in settings, which disables the governor.

## 6. UI

* The UI reads sim data through selectors at 4 Hz and compares by value before re-rendering.
* Lists over 50 rows are virtualized. Charts use small canvases.
* No layout reads followed by writes in the same frame.
* DOM node budgets as in `docs/UI_DESIGN.md` section 10.

## 7. Loading

* Code splitting: menus, the new game wizard, the game shell and management sheets are separate chunks.
* Content data as compressed JSON, filtered by the `release` field so only released aircraft are parsed into the game, validated with zod once at load and then trusted. Later phases load on demand.
* Sprites and atlases bake lazily on first use, with a short warm up during the loading screen for the types in the current save.
* Fonts self hosted as WOFF2 with `font-display: swap`.

## 8. Profiling routine

1. Reproduce with a seed and a command log (`replay.ts`).
2. Profile the worker with the stress tool and the main thread with the browser performance panel.
3. Record findings and before and after numbers in `perf-log.md`.
4. Update `perf-baseline.json` only when a change is intended and reviewed.

## 9. Code standards that help performance

* TypeScript strict, no `any`, no implicit returns of union types in hot paths.
* Prefer numbers and typed arrays over objects for anything counted in thousands.
* Keep functions in hot paths small and monomorphic: always called with the same argument types and object shapes.
* No exceptions for control flow in hot paths.
* No dependency added for convenience in hot code.
