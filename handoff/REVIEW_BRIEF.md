# REVIEW_BRIEF.md

Handoff brief for Opus or Fable. Read this first. It replaces the older status notes in `handoff/STATE.md` and `handoff/TASKS.md` where they disagree.

## 1. Where to assess

* Assess **`origin/main` at commit `7afca60`** as the product baseline.
* The branch `claude/upbeat-hamilton-wgas5n` adds one commit on top of it: `5e3330e`, which adds the grill-me skill. That commit changes no game code.
* Commit `10168ac`, which earlier notes referenced, is already contained in `main`. Do not review it separately.

## 2. Health

* `npm run verify -- quick` passes on `main` at `7afca60`: 301 tests in 32 files, plus rules, types and lint.
* `npm run stress` was last run on the older snapshot (`10168ac`) and passed all five budgets with zero deadlocks. It has not been rerun on `main`.
* Playwright e2e was not run in this review.
* `handoff/STATE.md` still says 226 tests. That number is stale.

## 3. Status

**Done (verified in code or task board):**
* Site: two presets, parcels, wind, climate, fairness test.
* Airfield: runways, taxiways with the revision 2 pavement, junction snapping, holding points, rapid exits, aprons, four stand sizes with forks and markings, surfaces with works, undo and redo.
* Traffic: 10 MVP 1 aircraft, arrival to takeoff, taxi reservations, turnaround with GSE, deadlock detection, payload and range.
* Terminal: walls, rooms, room validation, six shop types, check in, security, belt, seating, toilets.
* Business: seven generated airlines, contracts, ledger, one term loan, rating, weather events.
* UI and saves: menus, HUD, tool rail, build menu, inspectors, sheets, guided start, IndexedDB saves, export and import.
* Turn pad: T01 is marked done, but T39 froze the turn pad after the user rejected its look. Treat it as frozen.

**In progress:**
* T40, standalone ATC tower with levels. Status `doing`.

**Not started or unclear:**
* T42 (grid and snapping): marked `todo`, but commits for it exist on `main`. Confirm its state.
* T41 (flight offers and stand management): revised on 2026-11-06 to fixed schedules dragged onto stands, with no exact time editing. The 2026-11-05 answer is superseded.
* T02, T03 (runway markings, grading), T04 review, T05 to T38 (M3 to M7), T43 and T46 (baggage).

## 4. Decisions

Answered decisions are in `handoff/QUESTIONS.md` on `main`. The main ones:
* ATC: a standalone tower, levels bought with cash only, capacity-only upgrades, 20 to 100 movements per hour per runway by level, a 30 minute divert window, only landings and takeoffs counted.
* Grid: 2 m minor and 10 m major lines, anchored to the selected runway or taxiway, with a persistent toggle and an Alt override.
* Flights: fixed schedules, dragged onto stands (2026-11-06).

**Still unanswered, and needed before the milestone that uses them:**
1. Passenger profiles: walk speed, patience, spend budget, bags (M4).
2. Satisfaction weights (M4, T17).
3. Walking speed and congestion factor (M4).
4. Turnaround task lists: `src/data/turnarounds.json` does not exist (M5).
5. Costs and staff for kiosk, bag drop, passport booth and gate desk (M4, T11).
6. Domestic or international flag (M5, T20).
7. Licensed calibration photos for the 10 types (M3, T07).
8. Left rail or bottom build menu (M7, T36). Never asked.
9. Airline weights, demand terms, shop and staffing parameters (M6).

## 5. Known issues to verify

* **Low stress throughput, unverified.** busy50 completed 4 flights in 60 000 ticks at a nominal 720 per hour, with a peak of 62 aircraft. Medium completed 8 in 20 000 ticks at 120 per hour. Stress checks timing only. Find out whether this is a bug, a scenario artifact, or queueing (`scripts/stress.ts`, `completedFlights` in `src/sim/ops/traffic.ts`).
* **Hidden terminal cap.** `src/shared/terminalOps.ts` rejects walls once a span exceeds 2 000 cells (about 4 km). Revision 2 section 5 says no such limit should exist.
* **Placeholder starting cash** of 30 million in `src/shared/site.ts`.
* **T40 spec drift.** `handoff/tasks/T40-atc-tower.md` still says the footprint grows with level and lists levels 2 to 5 as open. The 2026-11-06 answer says 15 m by 15 m for every level.
* **Doc drift.** `ROADMAP.md` and `TASKS.md` cite `01-turn-pad-ui.md`; the real file is `T01-turn-pad-ui.md`. `STATE.md` names branch `glm/mvp1`. The `ROADMAP.md` MVP 1 status paragraph says rooms, passengers and ground vehicles are unbuilt, while M4 and M5 tick them. `CLAUDE.md` lists three runtime dependencies, but `package.json` also has `polygon-clipping`, recorded as approved in `STATE.md`.
* **MVP 1 GSE scope** says 7 types. `src/data/gse.json` has 10 kinds, including catering and stairs.

## 6. Review asks

1. Confirm `main` test status and the state of T42.
2. Reconcile T40 and T41 specs with the 2026-11-06 answers.
3. Propose a corrected `ROADMAP.md` status paragraph and fix the drift above.
4. Draft the decision batch in section 4 as `QUESTIONS.md` entries, each with a recommended default.
5. Review the remaining M2 to M3 ticks against the code. Several were ticked with simplifications noted in parentheses.

## 7. Grill-me instruction (required before any design decision)

Before you make, draft or record any design decision in this repo, run the grill-me procedure:

* Use the skill in `.claude/skills/grill-me/SKILL.md`. In opencode, use the command `.opencode/commands/grill-me.md`. Both contain the same procedure.
* Read the repo first (`AGENTS.md`, `CLAUDE.md`, the task spec, `handoff/QUESTIONS.md`). Answer from the repo whenever it settles a point.
* Ask the user one question at a time. Give one recommended answer and a one-sentence reason. Wait for each answer.
* Never invent gameplay numbers or rules. If a value is missing, ask for it.
* Record answers in `handoff/QUESTIONS.md` only when the user asks you to save them.

Items 1 to 9 in section 4 must go through grill-me before implementation. Do not implement them from this brief.

## 8. Standing rules (short form)

* `src/sim` imports only `src/shared` and `src/data`. No DOM, canvas, `Math.random`, `Date.now` or `performance.now`.
* Fixed 0.1 s tick. Player actions are serializable commands.
* Typed arrays in hot paths. No allocation in loops.
* Versioned saves (version 7), with a migration for every shape change. Fixture ids are append only.
* Data lives in `src/data`, validated by zod. Never reformat JSON.
* One task per session. Tests first for sim logic. `npm run verify` green before each commit.
* No em dashes, en dashes or spaced hyphens in code, UI text, docs or commits.
* Revision 2 overrides older docs. Python in `docs/reference/` is normative math: port it, do not ship it.
* Commit only when asked. Never push to `main`.
