# Handoff: finishing MVP 1 with GLM 5.3 Flash in opencode

This folder lets a smaller model continue the project at the quality of the previous work. It works because every decision a smaller model tends to get wrong is written down: what to build (task specs), how to build it (workflow and recipes), what to avoid (pitfalls), and how to prove it works (tests, the rules checker, stress and screenshots).

## For the person running the sessions

### Setup, once

1. Install opencode and connect the provider that serves GLM 5.3 Flash. Pick the model in opencode with `/models`, or set it in your global config `~/.config/opencode/opencode.json` as `"model": "<provider>/<model id>"` using the id your provider lists.
2. In the repo: `npm install`, then `npx playwright install chromium` (for screenshots and e2e).
3. Check out the branch the user names. Create it from `origin/main` the first time.
4. Start opencode in the repo root. It loads `AGENTS.md` automatically, plus `handoff/WORKFLOW.md` and `handoff/PITFALLS.md` through `opencode.json`.

The project `opencode.json` blocks pushes to `main` and force pushes, and asks before installing packages, pushing, rewriting the stress baseline or editing CI and the instruction files.

### The session pattern

One task per session keeps the model's context small and its work reviewable.

| Step | You type | The model does |
| --- | --- | --- |
| 1 | `/next` | picks the task, reads, writes the plan in `handoff/work/<id>.md`, shows it |
| 2 | read the plan; answer open questions; say "go" | |
| 3 | `/slice` (repeat per slice) | test first, code, verify, commit one slice |
| 4 | `/shot` with `npm run dev` running in another terminal | screenshots and a written comparison |
| 5 | `/review` | checks its own diff against the definition of done and fixes |
| 6 | `/finish` | docs, roadmap, report |
| 7 | review the commits and screenshots yourself, then start a new session | |

`/verify` runs every check and fixes failures one at a time when something breaks in between.

### What to check when you review a task

* `npm run verify` ends with `verify: all checks passed.` on your machine too.
* The work file has every requirement ticked with evidence (test names, screenshots).
* The screenshots look right to you. A smaller model is weakest at judging visuals: look at them.
* No change to files the task did not need (`git diff --stat origin/main...HEAD`).
* New numbers in data files cite a source.
* The task row in `handoff/TASKS.md` is `done` with commit hashes.

When the model is stuck or a task is too big for it, ask it to split the task (AGENTS.md "When you are stuck"), or bring the task back to a larger model.

## Files

| File | Purpose |
| --- | --- |
| `../AGENTS.md` | always loaded rules: the five unbreakable rules, hard rules, commands, definition of done |
| `WORKFLOW.md` | the ten step loop for every task |
| `STATE.md` | what exists today and the accepted deviations |
| `TASKS.md` | the ordered task board to MVP 1 |
| `tasks/*.md` | one spec per task: goal, files to read, requirements, tests, visual check |
| `CODEBASE.md` | map of the code and the patterns to copy |
| `RECIPES.md` | step by step patterns for commands, data, saves, tools, strings, tests |
| `PITFALLS.md` | mistakes that already cost time |
| `QUESTIONS.md` | design questions for you, with the model's recommendation |
| `templates/` | the plan and report templates |
| `scenarios/` | screenshot scenarios for `npm run shot` |
| `work/` | one plan and report per task, written by the model |
| `../.opencode/commands/` | the slash commands `/next`, `/slice`, `/shot`, `/review`, `/finish`, `/verify` |

## Tools added for the handoff

* `npm run verify`: rules, types, lint, tests and stress in one command with a pass or fail summary (`-- quick` skips stress).
* `npm run rules`: catches em and en dashes, spaced hyphens between words in comments, docs and UI strings, `any`, bare TODOs, and nondeterministic or render imports in `src/sim`.
* `npm run shot -- <scenario.json> [outDir]`: builds a scene from a JSON list of commands, moves the camera, plays clicks and keys, and saves screenshots, waiting for the terrain chunks to finish baking. Set `PW_CHROMIUM_PATH` if Playwright's own browser is not installed.
