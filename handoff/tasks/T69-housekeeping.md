# T69. Housekeeping after T57 lands

Phase 0. Starts only when the T57 branch is merged to `main`. Until then the files below stay untouched so that branch merges without conflicts.

## Goal

`ROADMAP.md` is the only plan, and the dead code found by the 2026-11-12 scan is gone.

## Requirements

* R1. Fold the result of T57 into `ROADMAP.md`: row status, commit hashes, and section 3 where the player can do something new. Move the decisions of `handoff/work/T57.md` that are not yet in `docs/ARCHITECTURE.md` section 12 there.
* R2. Delete `docs/ROADMAP.md`, `handoff/TASKS.md`, `handoff/STATE.md`, the T57 spec, work notes, before and after shots and scenarios. Remove section 7 of `ROADMAP.md` and the sentence about these files in `CLAUDE.md`.
* R3. Move section 8 of `ROADMAP.md` (known limits) into `docs/ARCHITECTURE.md` and remove it from the roadmap.
* R4. In `handoff/QUESTIONS.md`, record the answer of the 2026-11-12 T58 batch: all 33 values accepted as recommended. In `docs/DESIGN_REVISION_4.md`, change the status line and section 9 from pending to accepted. Mark the stale Slot manager and control room lines in `docs/ARCHITECTURE.md` as replaced by T40 and T41.
* R5. Delete the functions with no reference anywhere, after checking again with `grep -rnw`: `typeIndex` in `src/data/aircraft.ts`, `wingArea` in `src/render/sprites/geometry.ts`, `taxiwayLength` in `src/sim/airfield/geometry.ts`, `axisVector` in `src/sim/world/corridor.ts`, `dist` in `src/shared/geom.ts`.
* R6. Delete the string keys with no reference, after checking again: `app.title`, `site.title`, `hud.tick`, `hud.simMs`, `hud.backlog`, `hud.spawn`, `hud.clear`, `pause.confirmExit`, `rail.build`, `parcel.panel`, `opt.apronMode`, `save.row`, `inspector.entries`.
* R7. Replace the remaining `handoff/tasks/...` paths in code comments with the task id: `src/sim/ops/traffic.ts`, `src/sim/sim.ts`, `src/sim/airfield/airfield.ts`, `src/render/renderer.ts`.
* R8. Merge `.claude/agents/coder-sonnet.md` into the crew skill as the escalation coder, or delete it if the crew does not use it.
* R9. Delete the remote branches that are fully merged into `main`, after the user confirms the list.

## Kept on purpose

* The retired ATC room fixture keeps index 12 of `FIXTURE_KEYS`, because fixture indices are saved.
* The rotation code in `src/sim/business/business.ts` and `src/ui/Sheets.tsx` stays until T61 replaces it with flight series and migrates old saves.
* The Python references in `docs/reference/` stay until their ports are complete.

## Acceptance

* Full `npm run verify` is green and `npm run build` passes.
* `grep -rn "handoff/TASKS\|handoff/STATE\|docs/ROADMAP" .` finds nothing outside git history.
