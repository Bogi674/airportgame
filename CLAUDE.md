# Airfield Tycoon

Browser based airport management game, 2D top down, desktop browsers. It mirrors the mechanics of Airport CEO only: no art, text or screenshot of that game enters this repository. The same seed plus the same commands always gives the same result.

This file is the only rule set and `ROADMAP.md` is the only plan. Do not build hooks for 3D, multiplayer, audio, touch, mods, accounts or analytics.

## Commands

```
npm run dev                                dev server at http://localhost:5173
npm run verify -- quick                    rules, types, lint, tests. Must pass before every commit
npm run verify                             the same plus stress. Run before the last commit of a task
npx vitest run tests/<name>.test.ts        one test file
npm run shot -- <scenario.json> [outDir]   screenshots, needs npm run dev
npm run e2e                                playwright smoke and visual tests
```

## Hard rules

Relaxing any of these needs the user's explicit approval. `npm run rules` checks 1, 2 and 15.

1. **Sim and render are separate.** `src/sim` imports only `src/shared` and `src/data`. No DOM, no canvas. The sim runs in a Web Worker.
2. **Determinism.** In `src/sim` never use `Math.random`, `Date.now`, `performance.now` or unordered iteration where order matters. Use the seeded RNG with a forked stream per subsystem, and lookup tables for trigonometry that affects state.
3. **Fixed timestep.** 0.1 game seconds per tick. Rendering interpolates between snapshots.
4. **Commands.** Every player action is a serializable command applied at a tick boundary. Seed plus command log is a full replay.
5. **Typed arrays for hot data.** Aircraft, vehicles, cohorts, nodes and reservations use struct of arrays. No allocations in tick or render loops.
6. **Cohorts, not individual passengers.** People on screen are a render sample.
7. **Graphs, not free pathfinding.** Taxi network with reservations, service road and apron lane graphs, cached walking graph. No per agent search in hot loops.
8. **Aggregated finance.** The finance tick runs once per game day.
9. **SI units.** Meters, seconds, kilograms. Terminal grid cells are 2 m. Never store pixels in sim state.
10. **Versioned saves** with a migration for every shape change.
11. **Data driven content.** Content lives in JSON under `src/data`, validated by zod. Every number from a spec goes in a data file, not in code.
12. **True scale assets generated from data.** Never scale an asset for readability. Every aircraft sprite passes calibration and every apron scene passes the collision check in `docs/ART_AND_ASSETS.md` section 12.
13. **Performance budgets** in `docs/PERFORMANCE.md` must hold. CI enforces them.
14. **No noise complaint system** and no rival airports.
15. **Writing style.** No em dashes or en dashes in comments, UI text, docs or commit messages, and no spaced hyphen as a sentence connector.

## Working rules

* Run the `grill-me` skill before any code change and log the answers in `handoff/QUESTIONS.md`. Never guess a gameplay rule.
* For a roadmap task follow the `task` skill. One task per session.
* Read `handoff/PITFALLS.md` before writing code. Use `handoff/RECIPES.md` when adding a command, data, a save field, a tool, a string, a test or a screenshot scenario.
* Write tests first for sim and shared logic. Every sim change gets a determinism test: 2 000 ticks twice from one seed, identical hashes.
* Never commit red, and never delete or skip a test, rule check, eslint rule or CI step to get green. If one check fails three times after three different fixes, stop and ask.
* Commits are small and named by feature, such as `taxi network: block reservations`. The body explains why. Never force push.
* Never run `npm run stress -- --update-baseline` without the user's approval.
* Ask before adding any dependency, dev dependencies included. Import `polygon-clipping` only through `src/shared/clip.ts`, because a direct import crashes the stress run.
* Edit only the lines you change. Never reformat a JSON or source file, never re sort `src/ui/strings/en.json`, and never change a `src/data/*.json` value the task does not mention.
* Append to `FIXTURE_KEYS` and to any list whose index is saved. Never insert in the middle.
* Port the math in `docs/reference/` exactly into typed TypeScript. Never ship or transliterate it.
* Keep talk terse during code work: no narration, no recap, short reports. Code, comments, commits, docs and UI strings keep full quality.
* Run the `crew` skill only when the user asks for it.

## Docs

When sources disagree: the user's latest message wins, then `docs/DESIGN_REVISION_4.md`, then revision 3, then revision 2, then the older docs.

| Read | When |
| --- | --- |
| `docs/DESIGN_REVISION_4.md` | Stands, flight planning, airlines, ground handling, buildings, passengers, staff, tenants, events |
| `docs/DESIGN_REVISION_3.md` | Aircraft sprites, calibration, stand markings, jet bridges |
| `docs/DESIGN_REVISION_2.md` | Taxiways, stands, aprons, terminals. Normative geometry is in `docs/reference/geometry/` |
| `docs/GAME_DESIGN.md`, `docs/AIRLINES.md`, `docs/AIRCRAFT_DATABASE.md` | Gameplay rules and formulas, airline generation, aircraft roster and schema |
| `docs/ARCHITECTURE.md`, `docs/PERFORMANCE.md`, `docs/BROWSER.md` | Threads, determinism, saves, sim and render loops, build and browser tests |
| `docs/ART_AND_ASSETS.md`, `docs/UI_DESIGN.md`, `docs/art/` | Any visual asset, menus, HUD and panels. Match the reference sheets |
| `handoff/CODEBASE.md` | Code map, tick order and data flow |
| `handoff/BACKLOG.md` | When you touch the area of a logged bug |
| `handoff/tasks/<id>.md`, `handoff/work/<id>.md` | Spec and notes of the running task |
