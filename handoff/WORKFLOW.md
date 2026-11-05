# WORKFLOW.md

The spec driven loop for every task. Follow the steps in order. Each step names its output. Do not move on until the output exists.

## Step 0. Sync

```
git status                 must be clean; if not, ask the user what to do with the changes
git fetch origin
git checkout glm/mvp1      or the branch the user named; create it from origin/main the first time
npm install                only if package.json changed since the last session
```

Output: a clean working tree on the right branch.

## Step 1. Pick the task

Open `handoff/TASKS.md`. Take the first row with status `todo` whose dependencies are all `done`. Change its status to `doing`.

Output: the task id, for example `T01`.

## Step 2. Read

Open `handoff/tasks/<task file>`. Read every file it lists under "Read first", in full. Then read `handoff/PITFALLS.md`.

While reading, write down in your plan (step 3):

* the exact functions and types you will change, with file and line;
* the existing code you will copy patterns from;
* any statement in the spec you do not understand.

Output: notes in the plan.

## Step 3. Plan

Copy `handoff/templates/PLAN.md` to `handoff/work/<task-id>.md`. Fill in every section:

* **Requirements** copied from the spec, numbered R1, R2 and so on.
* **Design**: the data you add, the functions you add or change, and why. Follow an existing pattern from `handoff/RECIPES.md` whenever one fits. Name it.
* **Slices**: the order of small commits. Each slice meets at least one requirement and keeps `npm run verify` green. Three to six slices is normal.
* **Tests**: one line per test case, with the expected numbers.
* **Visual check**: the scenario file you will write and what each screenshot must show.
* **Open questions**: if any is about game design, stop and ask the user now.

Output: the filled plan. Show it to the user in one short message if the task spec says "confirm plan"; otherwise continue.

## Step 4. Tests first

For each slice that touches `src/sim` or `src/shared`:

1. Write the test in `tests/<area>.test.ts`. Use `ownedSim()` and `run()` from `tests/helpers.ts` for sim tests.
2. Run only that file: `npx vitest run tests/<area>.test.ts`. It must fail for the right reason (the missing feature), not because of a typo.

Output: a failing test.

## Step 5. Implement the slice

Make the smallest change that turns the test green. Keep functions short and typed. Add a doc comment to every exported function and to every non obvious block, in full sentences, naming the spec section it implements, for example `(docs/GAME_DESIGN.md section 8)`.

Run `npm run verify -- quick` while you work.

Output: green tests for the slice.

## Step 6. Verify

```
npm run verify
```

All five checks must pass: rules, types, lint, tests, stress. Paste the summary block into the work file.

If stress fails with a regression, find what made the tick slower (a loop, an allocation, a lookup in a hot path) and fix it. Read `docs/PERFORMANCE.md` sections 3 and 9.

Output: `verify: all checks passed.`

## Step 7. Visual check (any task that changes what the player sees)

1. Start the dev server in a second terminal: `npm run dev`.
2. Write a scenario in `handoff/scenarios/<task-id>.json`. Start from `handoff/scenarios/example-airport.json`.
3. Run `npm run shot -- handoff/scenarios/<task-id>.json shots/<task-id>`.
4. Open every PNG. Check, and write in the work file:
   * Does it match the reference sheet the task names (`docs/art/*.png`)? List each difference.
   * Does any text, line or shape overlap another, overflow its box or get cut by the frame? Fix it if so.
   * Are sizes true scale? Measure one known size (a runway width, a stand width) in pixels against the zoom.
5. The tool prints `page errors: none`. Any page error is a bug to fix.

Output: screenshots and a written comparison.

## Step 8. Docs

* Tick the roadmap criteria the task completes in `docs/ROADMAP.md`.
* Add decisions to `docs/ARCHITECTURE.md` section 12, one line each: `* 2026-11-05: what you decided. Why.`
* Update the player facing docs the spec names (`docs/GAME_DESIGN.md`, `docs/UI_DESIGN.md`, `docs/ART_AND_ASSETS.md`).
* Run `npm run rules` again; docs are checked too.

Output: updated docs.

## Step 9. Commit

One commit per slice. Message format:

```
<area>: <what, lower case, no period>

<Why, in one to four full sentences. No dashes as connectors.>
```

Examples of areas from the history: `taxi network`, `stands`, `clearances`, `holding points`, `runway works`, `turn pads`, `docs`, `stress`.

Output: commits on your branch. Push the branch if the user asked you to.

## Step 10. Report

Update `handoff/TASKS.md` (status `done`, commit hashes) and the "Report" section of the work file using `handoff/templates/REPORT.md`. Then tell the user in a short message:

* what now works, in player terms;
* the verify summary and the stress numbers;
* the screenshots' paths;
* anything simplified or left out, and the new task you created for it.

## Slicing rules

* A slice is at most about 300 changed lines. If it grows past that, split it.
* Sim first, then render, then UI. A sim slice with tests is valuable on its own.
* Never leave a half wired feature visible to the player. Hide a tool behind its finished state, or finish it in the same slice.

## Quality bar

The previous agent's commits are the standard. Before you commit, read your diff as a reviewer would:

* Would a new reader understand every name without the spec open?
* Is every number from the spec in a data file, not hard coded?
* Is the same logic written twice anywhere? Move it to `src/shared`.
* Does anything allocate per tick or per frame?
* Did you handle the empty case (no runways, no stands, no terminal)?
