---
description: Close the current task: docs, roadmap, report
---
Finish the task marked `doing`. Follow handoff/WORKFLOW.md steps 8 to 10.

!`grep -n "| doing |" handoff/TASKS.md`

!`git log --oneline origin/main..HEAD | head -20`

1. Run /review checks again if you have not since the last change.
2. Tick the roadmap lines in docs/ROADMAP.md that are fully met; add a note in parentheses for simplified ones.
3. Add every decision to docs/ARCHITECTURE.md section 12.
4. Update the player docs the spec names, handoff/STATE.md if the state changed, and the task row in handoff/TASKS.md (status done, commit hashes).
5. Fill the Report section of the work file from handoff/templates/REPORT.md.
6. Run `npm run verify`. Commit the docs. Then give me the report in a short message.
