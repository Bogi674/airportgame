# Milestone review (T04, T10, T19, T29, T34)

Run this after the last feature task of a milestone. The milestone is the one in the task row: M2 for T04, M3 for T10, M4 for T19, M5 for T29, M6 for T34.

## Goal

Prove the milestone is complete before the next one starts, the way `docs/ROADMAP.md` requires: "Work on one milestone at a time, in order".

## Steps

1. Read the milestone section of `docs/ROADMAP.md`. For every line write one row in `handoff/work/<task-id>.md`:

   | Roadmap line | Status | Evidence |
   | --- | --- | --- |
   | the line | met, or not met and why | test names, screenshot paths, commit hashes |

2. For every "not met" row, add a task to `handoff/TASKS.md` before this review and stop the review there. Do not tick a line that is not fully met.
3. Run `npm run verify` and `npm run e2e`. Both must pass. Record the stress numbers and compare them with the previous review in `handoff/STATE.md`. A subsystem that got more than 30 percent slower since the last review needs a note explaining why.
4. Play the dev build for ten minutes at 4x with the features of this milestone. Use `npm run shot` scenarios for evidence. Record every bug as a new task or fix it now if it takes under an hour.
5. Read `docs/ARCHITECTURE.md` section 12. Every decision made in this milestone is there.
6. Update `handoff/STATE.md`: health numbers, the "What works" list, the "What does not exist yet" list.
7. Tick the milestone's lines in `docs/ROADMAP.md`. Commit: `docs: milestone M<n> review`.

## Done when

Every roadmap line of the milestone is ticked with evidence, verify and e2e pass, and `handoff/STATE.md` is current.
