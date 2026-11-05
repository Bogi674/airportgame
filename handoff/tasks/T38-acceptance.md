# T38. MVP 1 acceptance

Milestone M7. Roadmap line: "All MVP 1 criteria above checked, a 3 hour play session at 4x without errors or budget breaches".

## Goal

Show that MVP 1 is complete: every roadmap line of M0 to M7 is ticked, and a long session runs clean.

## Steps

1. Run the milestone review (`handoff/tasks/milestone-review.md`) for M7.
2. Write `scripts/soak.ts`: a headless sim that builds a medium airport through commands, signs airlines, and runs the equivalent of 3 real hours at 4x (3 h times 3600 s times 4 times 10 ticks per second, 432 000 ticks), saving and restoring every game day, asserting no thrown errors, no deadlock that is not resolved within its timeout, cash not NaN, and every tick under the medium budget at p99. Print the stress style table at the end.
3. Run the dev build at 4x for at least 30 minutes of real play with the browser profiler open; record frame times and memory against `docs/PERFORMANCE.md` section 1. The user does the full 3 hour session; write a checklist for them in `handoff/work/T38.md`.
4. Update `docs/ROADMAP.md` "MVP 1 status" to say MVP 1 is complete, and `handoff/STATE.md`.
5. Ask the user to review and merge.
