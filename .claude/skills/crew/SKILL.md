---
name: crew
description: Run a task with the three role crew. The session model orchestrates, a Haiku coder implements, a Sonnet reviewer checks. Run only when the user explicitly asks, for example "run crew T40" or /crew T40.
disable-model-invocation: true
---

# Crew

Three roles, one working tree, one slice at a time.

| Role | Model | Does | Never does |
| --- | --- | --- | --- |
| Orchestrator | the session model, Fable or Opus | talks to the user, plans, writes briefs, runs verify, commits, updates `ROADMAP.md` and the work notes | bulk coding |
| Coder | Haiku, agent `coder` | edits files for one slice | design decisions, commits |
| Reviewer | Sonnet, agent `reviewer` | reads the slice diff, lists blocking problems | edits |

Argument: a task id from `ROADMAP.md`. No argument: the first `todo` or `doing` row of the current phase whose dependencies are done.

## Loop

1. **Plan, orchestrator.** Follow the workflow in `CLAUDE.md` up to the plan: settle open decisions with the user, make sure the spec `handoff/tasks/<task>.md` exists, write `handoff/work/<task>.md`, cut the task into slices of at most about 150 changed lines and 5 files. Each slice ends green.
2. **Brief.** Send the coder one brief per slice, in the format below. Spend your tokens here: the brief carries every decision, exact signatures, names, data keys and values, so the coder decides nothing.
3. **Code.** Call the Agent tool with `subagent_type: coder`, `run_in_background: false`. One coder at a time.
4. **Check.** Read the five line reply. On `ok`: run `git diff --stat HEAD`, then `npm run verify -- quick 2>&1 | tail -12`. On `blocked`: answer from the docs, or ask the user, then resend only the answer with SendMessage to the same coder.
5. **Review.** Call `subagent_type: reviewer` with the brief's DO and DONT lines. Skip the reviewer when the slice touches no file under `src/sim`, `src/shared` or `src/data` and changes under 40 lines.
6. **Fix.** On `fix`: SendMessage the findings to the same coder, word for word, nothing added. At most two fix rounds. After that, fix it yourself or stop and tell the user.
7. **Commit.** On `pass` and green verify: tick the criteria in the work file and commit the slice, message per `CLAUDE.md`.
8. **Close.** After the last slice: full `npm run verify`, close the task per step 8 of the `CLAUDE.md` workflow, report to the user in under 10 lines.

## Brief format

```
TASK <id> SLICE <n>
GOAL <one line>
FILES <path:lines>, <path:lines>      read and edit only these
PITFALLS <numbers from handoff/PITFALLS.md, or none>
DO
1. <exact edit: file, function, signature, behaviour, values>
2. ...
TESTS <test file and the cases to add, or none>
CHECK <command, for example: npx vitest run tests/tower.test.ts && npx tsc --noEmit -p . && npm run rules>
DONT <limits, for example: no save change, no new string keys>
```

Target under 250 words. No background, no history, no reasons unless a reason changes the code.

## Token rules

* Messages between roles use the fixed formats only. No greeting, no recap, no thanks.
* Never paste file contents or diffs into a message. Pass paths and line ranges. Each role reads from disk.
* Continue an agent with SendMessage instead of starting a new one, so it keeps what it already read.
* Pipe long command output through `tail` or `grep`. The coder runs the narrow CHECK. Only the orchestrator runs verify, once per slice.
* The orchestrator does not reread files a subagent already handled, apart from the diff stat and anything a reviewer finding points at.
* Caveman mode covers talk between roles and progress notes. It never covers code, comments, commit messages, docs or UI strings, which keep full quality and the hard rule 15 writing style.

## Stops

Stop the loop and ask the user when: a design question has no answer in the docs, a slice needs a new dependency, a save shape change or a hard rule relaxed, verify is still red after two fix rounds, or stress regresses.
