# CLAUDE.md

Read this file fully at the start of every session. Then read the docs that match your current task.

## Project

Working title: **Airfield Tycoon**. A browser based airport management game in the spirit of Airport CEO, with real world scale, real aircraft data and much more layout freedom. The player builds runways, taxiways, stands, terminals, shops, baggage, ground handling and landside access on a procedurally generated site, signs airlines and runs the business. The same seed plus the same commands always gives the same result.

Scope: **2D top down only**, desktop browsers. The simulation never depends on the renderer.

## Docs

| Doc | Read when |
| --- | --- |
| `docs/DESIGN_REVISION_3.md` | First, for any aircraft sprite, calibration, stand marking or jet bridge work. It overrides revision 2 and the older docs where they disagree |
| `docs/DESIGN_REVISION_2.md` | First, for any taxiway, stand, apron or terminal work. It overrides the older docs where they disagree. Its reference images are `docs/art/rev2_*.png` and its normative geometry is `docs/reference/geometry/` |
| `docs/ROADMAP.md` | Always. Releases, milestones, acceptance criteria. Work on one milestone at a time |
| `docs/GAME_DESIGN.md` | Any gameplay system, rule or formula |
| `docs/ARCHITECTURE.md` | Threads, data layout, determinism, taxi network, vehicles, rendering pipeline, saves |
| `docs/PERFORMANCE.md` | Any sim loop, render code or frequently updating UI |
| `docs/BROWSER.md` | Build, hosting, storage, lifecycle, input, errors, browser tests |
| `docs/ART_AND_ASSETS.md` | Any visual asset: aircraft, vehicles, people, buildings, surfaces, markings |
| `docs/UI_DESIGN.md` | Menus, HUD, panels, interactions, tokens, shortcuts |
| `docs/AIRCRAFT_DATABASE.md` | Aircraft roster, schema, releases, sprite geometry, definition of ready |
| `docs/AIRLINES.md` | Airline generation, scope, rating, fleets, decisions |
| `docs/art/` | Reference sheets. Match their style and proportions |
| `docs/reference/sprite-prototypes/` | Python reference code for sprites, markings and collision. Port it, do not ship it |
| `docs/reference/geometry/` | Python reference code for fillets, junctions, stand forks, funnels and apron shapes. Port the math exactly, do not ship it |

Other agents (opencode and similar) read `AGENTS.md` and `handoff/`, which repeat these rules with a step by step workflow. When a rule here changes, change it there too.

Data delivered with the docs: `src/data/aircraft/aircraft.mvp.json` (42 Phase 1 aircraft with specs and sprite geometry, 10 marked `mvp1`) and `src/data/gse.json` (ground vehicle catalog).

## Crew and terse mode

When the user asks to run the crew, load the `crew` skill (`.claude/skills/crew/SKILL.md`): the session model orchestrates, the `coder` agent on Haiku implements, the `reviewer` agent on Sonnet checks. Never start it unasked.

Terse mode is always on for code work: no narration between tool calls, no recap of files read, no restating the request, and reports in a few lines. It covers talk only. Code, comments, commit messages, docs and UI strings keep full quality.

## Precedence

When sources disagree: the user's latest message wins, then `docs/DESIGN_REVISION_3.md`, then `docs/DESIGN_REVISION_2.md`, then the older docs. Hard rules below still need the user's explicit approval to relax.

## Hard rules

Never relaxed without the user's explicit approval.

1. **Sim and render are separate.** `src/sim` imports only `src/shared` and `src/data`. No DOM, no canvas. The sim runs in a Web Worker.
2. **Determinism.** In `src/sim` never use `Math.random`, `Date.now`, `performance.now`, or unordered iteration where order matters. Use the seeded RNG with a forked stream per subsystem. State affecting trigonometry uses lookup tables.
3. **Fixed timestep.** 0.1 game seconds per tick. Rendering interpolates between snapshots.
4. **Commands.** Every player action is a serializable command applied at a tick boundary. Seed plus command log is a full replay.
5. **Typed arrays for hot data.** Aircraft, vehicles, cohorts, nodes and reservations use struct of arrays. No allocations in tick or render loops.
6. **Cohorts, not individual passengers.** People on screen are a render sample.
7. **Graphs, not free pathfinding.** Taxiing uses the taxi network with reservations, vehicles use service road and apron lane graphs, walking uses the cached walking graph. No per agent search in hot loops.
8. **Aggregated finance.** The finance tick runs once per game day.
9. **SI units.** Meters, seconds, kilograms. Terminal grid cells are 2 m. Never store pixels in sim state.
10. **Versioned saves** with a migration for every shape change.
11. **Data driven content.** Aircraft, sprite geometry, vehicles, buildings, shops, tenants, airlines, turnarounds and events live in JSON under `src/data`, validated by zod.
12. **True scale assets generated from data.** Sprites are baked from vector geometry in meters. Never scale an asset for readability. Every aircraft sprite passes calibration, and every apron scene passes the collision check in `docs/ART_AND_ASSETS.md` section 12.
13. **Performance budgets** in `docs/PERFORMANCE.md` must hold. CI enforces them.
14. **No noise complaint system** and no rival airports.
15. **Writing style.** Never use em dashes in code comments, UI text, docs or commit messages. Do not use a spaced hyphen as a sentence connector.

## Stack

* TypeScript strict, Vite.
* Canvas 2D for rendering. Static layers baked into chunks, optionally in a bake worker with `OffscreenCanvas`.
* Preact for UI components, Zustand for UI state only, zod for data validation.
* Vitest for logic, Playwright for browser smoke and visual tests.
* Allowed runtime dependencies: `preact`, `zustand`, `zod`. Ask before adding any other.

## Repo layout

```
src/
  sim/              pure simulation, runs in the sim worker
    rng.ts
    world/          site, terrain, parcels, wind, climate, city
    airfield/       runways, taxi network, routing, reservations, stands, pavement
    vehicles/       GSE fleet, trailers, service roads, docking, collision
    terminal/       grid, rooms, walking graph, service nodes
    cohorts/        passenger cohorts and journeys
    ops/            turnarounds, baggage, ATC, staff, emergency
    market/         airlines, demand, slots, tenants
    finance/        ledger, loans, fuel
    events/         event deck
    save/           serialization and migrations
    commands.ts
  shared/           protocol types, snapshot layout, math, trig tables
  render/           renderer, camera, chunks, layers
    sprites/        aircraft, vehicle and people bakers
    markings/       runway, taxiway and stand markings, restraint envelopes
    bake/           bake worker entry
  ui/               Preact components, stores, tokens, icons, strings
  data/             JSON content and zod schemas
  worker/           worker entries
tests/              vitest suites
e2e/                playwright tests
docs/               docs, art reference sheets, sprite prototypes
```

## Commands

```
npm run dev        dev server
npm run build      type check and production build
npm run test       vitest once
npm run e2e        playwright smoke and visual tests
npm run lint       eslint
npm run stress     headless benchmark, see docs/PERFORMANCE.md
```

## Workflow for each task

0. For every code request, run the `grill-me` skill (`.claude/skills/grill-me/SKILL.md`) first. Settle the open decisions with the user before editing any file.
1. Read the current milestone in `docs/ROADMAP.md` and the open criteria.
2. Read the docs listed above for the area you touch.
3. Make a short plan in the chat before changing more than three files.
4. Write tests first for sim logic, including a determinism test (2 000 ticks twice from one seed, identical hashes).
5. Implement the smallest slice that meets one criterion. Run test and lint.
6. Run `npm run stress` after changes to sim loops or rendering. Report the numbers.
7. For visual work, compare against the matching sheet in `docs/art/` and run the collision check for apron scenes.
8. Check off roadmap criteria and record decisions in `docs/ARCHITECTURE.md` under Decisions.
9. Small commits named by feature, for example `taxi network: block reservations`.

## Definition of done

* Roadmap criteria met and checked off.
* Tests, lint, determinism and e2e smoke pass.
* Performance budgets hold.
* Visual assets match the reference sheets, pass calibration and collision checks.
* No `any`, no TODO without a roadmap entry, no dead code.
* The user can see the feature working in the dev build.

## Out of scope for now

3D rendering, multiplayer, audio, mobile and touch, mod support, accounts and cloud saves, analytics. Do not build hooks for them.

## When unsure

Ask the user one focused question about design intent. For implementation details not covered by the docs, pick the simplest approach that respects the hard rules and record it under Decisions.
