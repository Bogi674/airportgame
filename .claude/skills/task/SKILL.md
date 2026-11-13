---
name: task
description: The workflow for a roadmap task, from picking the row in ROADMAP.md to closing it. Use whenever you start, continue or close a task from ROADMAP.md, and for bug triage and the definition of done.
---

# Task workflow

One task per session, then a fresh session.

0. For every code request, run the `grill-me` skill first. Settle the open decisions with the user in one batch before editing any file, and log the answers in `handoff/QUESTIONS.md`. Never guess a gameplay rule.
1. Take the task from `ROADMAP.md`: the first `todo` row of the current phase whose dependencies are `done`, unless the user names one. Set it to `doing`.
2. Read the design docs for the area, `handoff/PITFALLS.md`, and the spec in `handoff/tasks/<id>.md`. If the spec does not exist, write it from the design revision and the grill-me answers: goal, read first, decisions, numbered requirements, acceptance criteria. `handoff/tasks/mvp2/` holds parked specs.
3. Write a short plan in `handoff/work/<id>.md` before changing more than three files. Cut the work into slices of at most about 150 changed lines: sim first, then render, then UI. Never leave a half wired feature visible to the player.
4. Write tests first for sim and shared logic, including a determinism test (2 000 ticks twice from one seed, identical hashes).
5. Implement one slice. `npm run verify -- quick` must pass before every commit. Never commit red, never delete or skip a test to get green.
6. Before the last commit of the task, run the full `npm run verify` and report the stress numbers. Never run `npm run stress -- --update-baseline` without the user's approval.
7. For visual work, take screenshots with `npm run shot`, compare against the matching sheet in `docs/art/` and run the collision check for apron scenes.
8. Close the task: record decisions in `docs/ARCHITECTURE.md` section 12 (one dated line each, with the reason), set the row in `ROADMAP.md` to `done` with the commit hashes, update section 3 of `ROADMAP.md` if the player can do something new, and delete the spec and the work notes.
9. Small commits named by feature, for example `taxi network: block reservations`. The body explains why, in full sentences. Work on the branch the user names, never force push.

If the same check fails three times after three different fixes, stop and ask the user.

For implementation details not covered by the docs, pick the simplest approach that respects the hard rules and record it under Decisions. For design intent, ask the user one focused question.

## Models

The session model plans and decides. Smaller models do inventories, bulk coding and tests. The `crew` skill runs only when the user asks for it.

## Bug triage

Set by the user on 2026-11-12.

* A **blocker** breaks play, a hard rule, saves or determinism. It is always fixed before commit.
* A **major** bug is a wrong number shown to the player or a visible defect. It gets at most two fix rounds. If it stays and the task meets about 98% of its intent with no blocker, tell the user the details and the implication, and the user decides between pass with notice and more fixing.
* A **minor** bug has no effect on play. It is skipped.

Passed and skipped bugs are logged in `handoff/BACKLOG.md` with the task id and the implication. If a task turns out bigger than its spec, finish the smallest slice that meets one criterion, commit it, and add a new row to `ROADMAP.md` for the rest.

## Definition of done

* The task's acceptance criteria are met and its `ROADMAP.md` row is `done`.
* Full `npm run verify` and the e2e smoke pass. Performance budgets hold.
* Sim changes have a determinism test.
* Visual assets match the reference sheets, pass calibration and collision checks.
* No `any`, no TODO without a roadmap entry, no dead code, no commented out code, no `console.log` left in `src`.
* Every number from the spec is in a data file, not hard coded.
* The user can see the feature working in the dev build.
