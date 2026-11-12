# CLAUDE.md

Read this file fully at the start of every session. Then read `ROADMAP.md` and the docs that match your current task. This file is the only rule set and `ROADMAP.md` is the only plan.

## Project

Working title: **Airfield Tycoon**. A browser based airport management game that benchmarks the mechanics of Airport CEO and adds real world scale, real aircraft data, much more layout freedom and procedural airlines, destinations, tenants and events. Only mechanics are mirrored: no art, text or screenshot of that game enters this repository. The player builds runways, taxiways, stands, terminals, shops, baggage, ground handling and landside access on a procedurally generated site, signs airlines and runs the business. The same seed plus the same commands always gives the same result.

Scope: **2D top down only**, desktop browsers. The simulation never depends on the renderer.

## Docs

| Doc | Read when |
| --- | --- |
| `ROADMAP.md` (repo root) | Always. What is built, the MVP 1 phases, task status and exit criteria. Work on one task at a time |
| `docs/DESIGN_REVISION_4.md` | First, for any stand, flight planning, airline, ground handling, supporting building, passenger, staff, tenant or event work. It overrides the revisions and docs below where they disagree |
| `docs/DESIGN_REVISION_3.md` | First, for any aircraft sprite, calibration, stand marking or jet bridge work. It overrides revision 2 and the older docs where they disagree |
| `docs/DESIGN_REVISION_2.md` | First, for any taxiway, stand, apron or terminal work. It overrides the older docs where they disagree. Its reference images are `docs/art/rev2_*.png` and its normative geometry is `docs/reference/geometry/` |
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

Working files live in `handoff/`:

| Path | Read when |
| --- | --- |
| `handoff/tasks/<id>.md` | The spec of the task you work on. Written when the task starts, deleted when it closes. `handoff/tasks/mvp2/` holds parked specs |
| `handoff/work/<id>.md` | Your plan and notes for the running task. Deleted when it closes |
| `handoff/PITFALLS.md` | Before writing code |
| `handoff/RECIPES.md` | When adding a command, data, a save field, a tool, a string, a test or a screenshot scenario |
| `handoff/CODEBASE.md` | For the code map, tick order and data flow |
| `handoff/QUESTIONS.md` | The log of design questions and the user's answers |
| `handoff/reference/` | Benchmark notes on the mirrored mechanics |

`AGENTS.md` only points here. `docs/ROADMAP.md`, `handoff/TASKS.md` and `handoff/STATE.md` are the old plan, frozen until task T57 lands and then deleted (`ROADMAP.md` section 7). Do not plan from them.

Data delivered with the docs: `src/data/aircraft/aircraft.mvp.json` (42 Phase 1 aircraft with specs and sprite geometry, 10 marked `mvp1`) and `src/data/gse.json` (ground vehicle catalog).

## Crew and terse mode

When the user asks to run the crew, load the `crew` skill (`.claude/skills/crew/SKILL.md`): the session model orchestrates, the `coder` agent on Haiku implements, the `reviewer` agent on Sonnet checks. Never start it unasked. With or without the crew, the session model plans and decides, and smaller models do inventories, bulk coding and tests.

Terse mode is always on for code work: no narration between tool calls, no recap of files read, no restating the request, and reports in a few lines. It covers talk only. Code, comments, commit messages, docs and UI strings keep full quality.

## Precedence

When sources disagree: the user's latest message wins, then `docs/DESIGN_REVISION_4.md`, then `docs/DESIGN_REVISION_3.md`, then `docs/DESIGN_REVISION_2.md`, then the older docs. Hard rules below still need the user's explicit approval to relax.

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
15. **Writing style.** Never use em dashes or en dashes in code comments, UI text, docs or commit messages. Do not use a spaced hyphen as a sentence connector.

## Stack

* TypeScript strict, Vite.
* Canvas 2D for rendering. Static layers baked into chunks, optionally in a bake worker with `OffscreenCanvas`.
* Preact for UI components, Zustand for UI state only, zod for data validation.
* Vitest for logic, Playwright for browser smoke and visual tests.
* Allowed runtime dependencies: `preact`, `zustand`, `zod`, `polygon-clipping` (imported only through `src/shared/clip.ts`). Ask before adding any other, dev dependencies included.

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
    business/       airlines, contracts, ledger, loan (today)
    market/         airlines, demand, flight series, tenants (planned)
    finance/        ledger, loans, fuel (planned)
    events/         event deck (planned)
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
handoff/            task specs, work notes, pitfalls, recipes, code map, scenarios
scripts/            verify, rules check, stress, screenshots, offline build
```

## Commands

```
npm run dev        dev server at http://localhost:5173
npm run verify     rules check, type check, lint, all tests, stress
npm run verify -- quick   the same without stress
npm run rules      only the hard rule checker
npm run test       vitest once. One file: npx vitest run tests/<name>.test.ts
npm run lint       eslint
npm run stress     headless benchmark, see docs/PERFORMANCE.md
npm run shot -- <scenario.json> [outDir]   screenshots from a scenario, needs npm run dev
npm run build      type check and production build
npm run e2e        playwright smoke and visual tests
```

## Workflow for each task

One task per session, then a fresh session.

0. For every code request, run the `grill-me` skill (`.claude/skills/grill-me/SKILL.md`) first. Settle the open decisions with the user in one batch before editing any file, and log the answers in `handoff/QUESTIONS.md`. Never guess a gameplay rule.
1. Take the task from `ROADMAP.md`: the first `todo` row of the current phase whose dependencies are `done`, unless the user names one. Set it to `doing`.
2. Read the design docs for the area, `handoff/PITFALLS.md`, and the spec in `handoff/tasks/<id>.md`. If the spec does not exist, write it from the design revision and the grill-me answers: goal, read first, decisions, numbered requirements, acceptance criteria.
3. Write a short plan in `handoff/work/<id>.md` before changing more than three files. Cut the work into slices of at most about 150 changed lines: sim first, then render, then UI. Never leave a half wired feature visible to the player.
4. Write tests first for sim and shared logic, including a determinism test (2 000 ticks twice from one seed, identical hashes).
5. Implement one slice. `npm run verify -- quick` must pass before every commit. Never commit red, never delete or skip a test to get green.
6. Before the last commit of the task, run the full `npm run verify` and report the stress numbers. Never run `npm run stress -- --update-baseline` without the user's approval.
7. For visual work, take screenshots with `npm run shot`, compare against the matching sheet in `docs/art/` and run the collision check for apron scenes.
8. Close the task: record decisions in `docs/ARCHITECTURE.md` section 12 (one dated line each, with the reason), set the row in `ROADMAP.md` to `done` with the commit hashes, update section 3 of `ROADMAP.md` if the player can do something new, and delete the spec and the work notes.
9. Small commits named by feature, for example `taxi network: block reservations`. The body explains why, in full sentences. Work on the branch the user names, never force push.

If the same check fails three times after three different fixes, stop and ask the user.

Bug triage (user, 2026-11-12): a **blocker** (breaks play, a hard rule, saves or determinism) is always fixed before commit. A **major** bug (a wrong number shown to the player or a visible defect) gets at most two fix rounds; if it stays and the task meets about 98% of its intent with no blocker, tell the user the details and the implication, and the user decides between pass with notice and more fixing. A **minor** bug (no effect on play) is skipped. Passed and skipped bugs are logged in `handoff/BACKLOG.md` with the task id and the implication. If a task turns out bigger than its spec, finish the smallest slice that meets one criterion, commit it, and add a new row to `ROADMAP.md` for the rest.

## Never

* Never reformat a whole JSON or source file. Edit only the lines you change. Strings in `src/ui/strings/en.json` are added near related keys, never re sorted.
* Never change a value in `src/data/*.json` that the task does not mention.
* Never insert an entry in the middle of `FIXTURE_KEYS` or any list whose index is saved. Append at the end.
* Never remove a hard rule check, eslint rule, test or CI step.
* Never copy code from `docs/reference/` into `src` as a literal translation. Port it to typed TypeScript and keep the math exact.

## Definition of done

* The task's acceptance criteria are met and its `ROADMAP.md` row is `done`.
* Full `npm run verify` and the e2e smoke pass. Performance budgets hold.
* Sim changes have a determinism test.
* Visual assets match the reference sheets, pass calibration and collision checks.
* No `any`, no TODO without a roadmap entry, no dead code, no commented out code, no `console.log` left in `src`.
* Every number from the spec is in a data file, not hard coded.
* The user can see the feature working in the dev build.

## Out of scope for now

3D rendering, multiplayer, audio, mobile and touch, mod support, accounts and cloud saves, analytics. Do not build hooks for them.

## When unsure

Ask the user one focused question about design intent. For implementation details not covered by the docs, pick the simplest approach that respects the hard rules and record it under Decisions.
