# AGENTS.md

You are continuing **Airfield Tycoon**, a browser airport management game in TypeScript. A previous agent built most of milestones M0 to M3. Your job is to finish MVP 1 by working through `handoff/TASKS.md`, one task at a time, at the same quality.

This file is loaded into every session. Read it fully. Then follow `handoff/WORKFLOW.md` exactly. Do not improvise a different process.

Before you write a plan for any code request, run the `grill-me` skill (`.claude/skills/grill-me/SKILL.md`). Interview the user about the open decisions, one question at a time with your recommendation, and settle them before you edit any file.

Terse mode is always on for code work: no narration between tool calls, no recap of files read, no restating the request, and reports in a few lines. It covers talk only. Code, comments, commit messages, docs and UI strings keep full quality. In Claude Code the user can also ask for the crew (`.claude/skills/crew/SKILL.md`), which splits the work across an orchestrator, a Haiku coder and a Sonnet reviewer.

## The five rules you must never break

1. **One task per session.** Pick the first task marked `todo` in `handoff/TASKS.md`, unless the user names one. Never work on two tasks at once.
2. **Write the plan before code.** Copy `handoff/templates/PLAN.md` to `handoff/work/<task-id>.md` and fill it in before you edit any source file.
3. **Tests first for sim logic.** Every change under `src/sim` or `src/shared` gets a failing test before the code that makes it pass.
4. **Verify before every commit.** `npm run verify -- quick` must pass before every slice commit, and the full `npm run verify` (with stress) before the last commit of each task (user decision, 2026-11-06). If it fails, fix it. Never commit red. Never delete or skip a test to make it pass.
5. **Never guess the design.** If the spec and the docs do not answer a design question, write it in `handoff/QUESTIONS.md` and ask the user. Do not invent gameplay rules.

## Reading order for a new session

1. This file.
2. `handoff/STATE.md`: what exists and what does not.
3. `handoff/TASKS.md`: the task board.
4. The task spec in `handoff/tasks/` for your task.
5. The docs and source files that the task spec lists under "Read first". Read them; do not skim.
6. `handoff/PITFALLS.md` before you write code.
7. `handoff/RECIPES.md` when you add a command, data, a save field, a tool, a string or a test.

## Project facts

* Working title Airfield Tycoon. 2D top down, desktop browsers. The sim never depends on the renderer.
* Stack: TypeScript strict, Vite, Canvas 2D, Preact, Zustand (UI state only), zod, Vitest, Playwright.
* Allowed runtime dependencies: `preact`, `zustand`, `zod`, `polygon-clipping`. Never add another without the user's written approval. Dev dependencies also need approval.
* Docs live in `docs/`. When sources disagree: the user's latest message wins, then `docs/DESIGN_REVISION_3.md`, then `docs/DESIGN_REVISION_2.md`, then the other docs.

## Hard rules (from CLAUDE.md, never relaxed without the user's explicit approval)

1. **Sim and render are separate.** `src/sim` imports only `src/shared` and `src/data`. No DOM, no canvas. The sim runs in a Web Worker. Code both sides need goes in `src/shared` and must follow the sim rules.
2. **Determinism.** In `src/sim` (and shared code the sim calls) never use `Math.random`, `Date.now`, `performance.now`, `new Date()`, or iteration whose order is not fixed where order matters. Use the seeded RNG (`src/sim/rng.ts`) with a forked stream per subsystem. State affecting trigonometry uses the lookup tables in `src/shared/trig.ts` (`sinLut`, `cosLut`, `atan2Det`).
3. **Fixed timestep.** 0.1 game seconds per tick. `TICKS_PER_DAY` is in `src/shared/business.ts`.
4. **Commands.** Every player action is a serializable command (`src/sim/commands.ts`) applied at a tick boundary. Seed plus command log is a full replay.
5. **Typed arrays for hot data.** Aircraft, vehicles, cohorts, nodes and reservations use struct of arrays. No allocations in tick or render loops.
6. **Cohorts, not individual passengers.** People on screen are a render sample.
7. **Graphs, not free pathfinding.** Taxiing uses the taxi network with reservations, vehicles use service road and apron lane graphs, walking uses the cached walking graph. No per agent search in hot loops.
8. **Aggregated finance.** The finance tick runs once per game day.
9. **SI units.** Meters, seconds, kilograms. Terminal grid cells are 2 m. Never store pixels in sim state.
10. **Versioned saves** with a migration for every shape change (`src/sim/save/migrations.ts`).
11. **Data driven content.** Aircraft, sprite geometry, vehicles, buildings, shops, tenants, airlines, turnarounds and events live in JSON under `src/data`, validated by zod (`src/data/schemas`).
12. **True scale assets generated from data.** Sprites are baked from vector geometry in meters. Never scale an asset for readability. Every aircraft sprite passes calibration, every apron scene passes the collision check in `docs/ART_AND_ASSETS.md` section 12.
13. **Performance budgets** in `docs/PERFORMANCE.md` must hold. CI enforces them with `npm run stress`.
14. **No noise complaint system** and no rival airports.
15. **Writing style.** Never use em dashes or en dashes anywhere: code comments, UI text, docs, commit messages. Never use a spaced hyphen ` - ` to join two parts of a sentence. Write two sentences, or use a comma or a colon. Do not wrap extra information in a sentence with dashes or parentheses when a second sentence works. `npm run rules` checks this.

## Commands

```
npm run dev        dev server at http://localhost:5173 (needed for screenshots)
npm run verify     rules check, type check, lint, all tests, stress. Run before the last commit of each task.
npm run verify -- quick   the same without stress, for fast loops while coding
npm run rules      only the hard rule checker (dashes, any, TODO, sim determinism and imports)
npm run test       vitest once; one file: npx vitest run tests/<name>.test.ts
npm run lint       eslint
npm run stress     headless benchmark; prints ms per tick per subsystem and fails on a budget breach or a regression over 10 percent
npm run shot -- <scenario.json> [outDir]   in game screenshots from a JSON scenario (needs npm run dev)
npm run build      type check and production build
npm run e2e        Playwright browser tests
```

## Definition of done for every task

* Every acceptance criterion in the task spec is met and ticked in `handoff/work/<task-id>.md`.
* `npm run verify` passes. You pasted its summary into the work file.
* Sim changes have a determinism test (2 000 ticks twice from one seed, identical `stateHash`).
* Visual changes have screenshots from `npm run shot`, compared with the reference sheet the task names.
* No `any`, no `TODO` without a roadmap entry, no dead code, no commented out code, no `console.log` left in `src`.
* `docs/ROADMAP.md` criteria ticked when fully met, with a short note in parentheses when simplified.
* Every new decision recorded in `docs/ARCHITECTURE.md` under "12. Decisions", one line with the date and the reason.
* `handoff/TASKS.md` updated (status `done`, commit hash) and `handoff/STATE.md` updated if the state changed.
* Small commits named by feature, for example `taxi network: block reservations`. Commit message body explains why, in full sentences.

## Things you must never do

* Never push to `main` or force push. Work on the branch the user gives you, or `glm/mvp1` if none.
* Never run `npm run stress -- --update-baseline` unless the task spec says so or the user approves. A regression means your code got slower: fix it first.
* Never reformat a whole JSON or source file. Edit only the lines you change. Strings in `src/ui/strings/en.json` are appended near related keys, never re sorted.
* Never change a value in `src/data/*.json` that the task does not mention.
* Never insert an entry in the middle of `FIXTURE_KEYS` or any list whose index is saved. Append at the end.
* Never remove a hard rule check, eslint rule, test or CI step.
* Never copy code from `docs/reference/` into `src` as Python or as a literal translation without types. Port it to typed TypeScript and keep the math exact.

## When you are stuck

* If the same check fails three times after three different fixes, stop. Write what you tried in `handoff/QUESTIONS.md` and ask the user.
* If a task turns out bigger than its spec says, finish the smallest slice that meets one acceptance criterion, commit it, and split the rest into a new task in `handoff/TASKS.md`.
