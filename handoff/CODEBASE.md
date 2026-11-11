# CODEBASE.md

How the code fits together, so you change the right file. Line counts are approximate.

## Data flow in one picture

```
 UI (Preact, main thread)                       Sim worker (src/worker/sim.ts)
 ─────────────────────────                      ──────────────────────────────
 MapView pointer events                          Sim.enqueue(cmd)
   └─ ToolController (src/ui/tools/controller.ts)  └─ next tick, subsystem 0: Sim.apply(cmd)
        preview: Ghost shapes to the renderer           ├─ business, loans, airlines: Business.*
        commit: client.send(Command) ───────────────►   └─ build commands: Airfield.execute(cmd, ctx, cash, env)
                                                               returns { cashDelta } or Problem { code, args }
 gameStore (Zustand) ◄──── staticData messages ◄───── worker posts: airfield payload when its version
   airfield, business, terminals, site, owner          or obstaclesVersion changed, business payload,
                                                        terminal grids, ownership, events
 Renderer (Canvas 2D) ◄─── snapshot buffers ◄───────── Traffic.writeSnapshot (aircraft), Gse (vehicles)
   chunks baked in src/render/bake (worker)
```

Problems and events travel as strings `code|key=value|...`. Build problems show as the string `notice.<code>`, flight events through `src/ui/alerts.ts`.

## Tick order (`Sim.runSubsystem`, src/sim/sim.ts)

| # | Subsystem | What runs |
| --- | --- | --- |
| 0 | commands | queued commands applied in order |
| 1 | clock | game seconds advance |
| 2 | network | `airfield.update` (works finishing), `updateObstacles`, network rebuild when the airfield version changed |
| 3 | business | daily close, airline decisions, terminal capacity |
| 4 | flights | every 10 ticks: schedule, spawn arrivals, plan departures |
| 5 | aircraft | `traffic.update`: movement, reservations, deadlocks |
| 6 | vehicles | GSE |

`stateHash()` folds tick, RNG, airfield, traffic and business. Tests compare it.

## Where things live

### `src/data` (JSON plus zod schemas)

| File | Holds |
| --- | --- |
| `aircraft/aircraft.mvp.json`, `aircraft.ts` | 42 aircraft, 10 marked `mvp1`, with sprite geometry and stand geometry. `AIRCRAFT` is the mvp1 list |
| `airfield_codes.json` | per code widths, radii, separations; holding distances; strip widths; obstacle surfaces; turn pads; runway works |
| `surfaces.json` | five surfaces: allowed codes, costs, PCR tiers, works rates, paint |
| `stand_sizes.json` | four stand sizes and stand marking dimensions |
| `paint.json` | marking colors and taxiway paint dimensions |
| `business.json` | terminal modules, shops, airlines, fees, loans |
| `gse.json` | ground vehicles at true size |
| `people.json` | recipe weights per passenger profile, integers 0 to 1000 |
| `wake.json` | wake separation and runway occupancy |
| `schemas/*.ts`, `index.ts` | strict zod schemas; `index.ts` exports parsed constants (`AIRFIELD`, `SURFACE_SPEC`, `STAND_SIZES`, `PAINT`, `BUSINESS`, `GSE`) |

### `src/shared` (used by sim and render; follows sim rules)

| File | Holds |
| --- | --- |
| `airfield.ts` | types: `Runway`, `Taxiway`, `Apron`, `Stand`, `HoldingPoint`, `AirfieldPayload`, `runwaySide` |
| `business.ts` | terminal grid types, `FIXTURE_KEYS`, zones, `TICKS_PER_DAY` |
| `pavement/` | taxiway pavement generator (fillets, junctions, shoulders, lines), `snap.ts` for the taxiway tool |
| `standFork.ts`, `standSizes.ts` | stand lead in fork geometry and size rules |
| `apronGeom.ts`, `clip.ts` | apron merge and cut through polygon-clipping |
| `obstacles.ts` | approach and transitional surfaces |
| `clearance.ts` | wingtip envelope clash check |
| `turnPad.ts` | turn pad polygon and curve |
| `surfaceRules.ts` | surface costs, works days, runway works days |
| `terminalOps.ts`, `terminalRooms.ts` | terminal grid edits and room validation |
| `validate.ts` | land checks, grading cost estimate, parcel lookups |
| `trig.ts` | deterministic `sinLut`, `cosLut`, `atan2Det` |
| `ghost.ts` | preview shapes the controller hands the renderer |
| `site.ts`, `snapshot.ts`, `protocol.ts` | site payload, snapshot layout, worker messages |

### `src/sim`

| File | Holds |
| --- | --- |
| `sim.ts` | the `Sim` class: tick order, command dispatch, saves, hash |
| `commands.ts` | the `Command` union: every player action |
| `airfield/airfield.ts` | `Airfield`: build commands, undo and redo (`Op` with `items`, `swaps`, `replaced`), works, save |
| `airfield/geometry.ts` | runway names, taxi names, holding points and entries (`deriveNetwork`) |
| `airfield/network.ts` | `TaxiNetwork`: nodes, edges, samples, blocks, routing (A*), stand forks |
| `ops/traffic.ts` | `Traffic`: flights and aircraft as typed arrays, runway reservations, states (`AcState`), push back, backtrack |
| `ops/performance.ts` | takeoff and landing distance, payload and range checks |
| `business/business.ts` | `Business`: terminals, airlines, contracts, ledger, rating, weather |
| `vehicles/gse.ts` | ground vehicles placed around a docked aircraft |
| `world/*` | site generation: terrain, corridor, parcels, wind, climate |
| `save/migrations.ts`, `save/pack.ts` | save versions and typed array packing |

### `src/render`

| File | Holds |
| --- | --- |
| `renderer.ts` | frame loop: chunks, overlays, highlights, ghost, people, vehicles, aircraft |
| `chunks.ts`, `bake/*`, `terrain.ts` | baked static chunks (terrain and airfield paint) |
| `markings/taxiPlan.ts` | builds the marking plan from the airfield payload |
| `markings/airfieldPaint.ts` | paints runways, taxiways, aprons, terminals from the plan |
| `markings/standLayout.ts`, `standPaint.ts` | stand markings from data |
| `sprites/*` | aircraft and vehicle sprites from geometry |
| `people.ts` | the render sample of people, drawn from the atlas |
| `peopleSelect.ts` | nearest to camera first selection of sample groups under the cap |
| `peoplePack.ts` | footprint packing of group members inside a 2 m cell |
| `sprites/peopleRecipes.ts` | the 30 people recipes and the weighted pick per profile |
| `sprites/peopleShapes.ts` | pure shape ops for people: body, head, hair, items, walk frames |
| `sprites/peopleAtlas.ts` | the people atlas: rasterized tiers baked lazily and cached |

### `src/ui`

| File | Holds |
| --- | --- |
| `App.tsx` | screens, worker client, test globals `window.__store`, `__send`, `__renderer` |
| `MapView.tsx` | canvas, pointer and keyboard input, hands events to the controller |
| `tools/controller.ts` | every build tool: previews (ghosts), snapping, commits (commands) |
| `stores/toolStore.ts`, `gameStore.ts` | UI state: current tool and options; game payloads |
| `BuildMenu.tsx`, `ContextBar.tsx`, `ToolRail.tsx` | build menu cards, tool options, left rail |
| `ObjectPanel.tsx` | inspectors for runway, taxiway, apron, stand, terminal |
| `Sheets.tsx` | flights, airlines, finance sheets |
| `strings/en.json` | every UI string |

### Tests and tools

* `tests/*.test.ts`: Vitest. `helpers.ts` has `ownedSim`, `run`, `buildTestAirport`, terminal builders.
* `e2e/*.spec.ts`: Playwright against the offline build.
* `scripts/stress.ts`: the stress scenarios and the regression check against `perf-baseline.json`.
* `scripts/verify.sh`, `scripts/rules-check.mjs`, `scripts/shot.mjs`: the handoff tools.

## Patterns to copy

| You need | Copy from |
| --- | --- |
| a build command with land check, cost and undo | `buildApron` or `buildStands` in `airfield.ts` |
| an edit with exact undo of changed taxiways | `moveHolding` (swaps) in `airfield.ts` |
| works that close something for days | `startWorks` and `closeForWorks` in `airfield.ts` |
| derived data without a network rebuild | `updateObstacles` in `sim.ts` |
| a new aircraft state | `AcState.Backtrack` and `updateBacktrack` in `traffic.ts` |
| a tool with preview and commit | the rapid exit tool: `previewRapidExit` and `commitRapidExit` in `controller.ts` |
| a drag in the select tool | `grab`, `previewHold`, `commitHold` in `controller.ts` |
| an inspector block | `RunwayUpgrade` in `ObjectPanel.tsx` |
| a pure geometry module with tests | `src/shared/turnPad.ts` and `tests/turnPad.test.ts` |
