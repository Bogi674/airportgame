# PX1 Visible passenger flow

Goal: the people sample reads as an airport: no wall crossing, no flicker, visible processing, single file queues.

Read first: `src/sim/cohorts/cohorts.ts` (writeSample), `src/sim/cohorts/walkSample.ts`, `src/sim/terminal/serviceNodes.ts`, `src/render/peopleMotion.ts`.

Decisions: render sample only, no sim rule, save or hash change (owner, 2026-11-26).

Requirements
1. A walker on a walk graph edge without a straight line of sight follows the floor cells of that edge, so no figure crosses a wall.
2. A walker keeps one lane for its whole walk, picked from its cohort id, and is drawn on the centre line when its lane is not clear. No walker is dropped from the sample.
3. Dwellers are placed before walkers, so a passing walker never moves a dweller.
4. The group being served stands at the desk front, and at a transition fixture (security lane, passport, customs, exits) it moves from the entry to the exit along the fixture as its service runs.
5. Queued groups stand single file: rank 0 at the desk front, the line runs straight back from the fixture and folds sideways where blocked, inside the cells the queue may use.

Acceptance: the two owner clips' layouts show lines at check in and security, a group inside each busy security lane, no figure beyond a wall, and no figure jumping more than one cell between frames while it walks.
