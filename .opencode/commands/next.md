---
description: Start the next task from handoff/TASKS.md with the spec driven workflow
---
Start a new task. Follow handoff/WORKFLOW.md steps 0 to 3 exactly, then stop and show me the plan.

Working tree:
!`git status --short`

Current branch:
!`git branch --show-current`

Open tasks:
!`grep -n "| todo |\|| doing |" handoff/TASKS.md | head -5`

If I named a task here, use it: $ARGUMENTS

Do this now:
1. Pick the task (the first `todo` whose dependencies are `done`, or the one I named). Set it to `doing` in handoff/TASKS.md.
2. Read the task spec in handoff/tasks/ and every file under "Read first", in full.
3. Copy handoff/templates/PLAN.md to handoff/work/<task id>.md and fill every section.
4. Show me the requirements, the slices and the open questions. Do not edit source files yet.
