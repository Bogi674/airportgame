---
description: Implement the next slice of the current task, tests first
---
Continue the task marked `doing` in handoff/TASKS.md. Its plan is in handoff/work/.

!`grep -n "| doing |" handoff/TASKS.md`

Follow handoff/WORKFLOW.md steps 4 to 6 for the next unfinished slice in the plan only:
1. Write the failing test first and run only that test file. Show me that it fails for the right reason.
2. Implement the smallest change that makes it pass. Follow the recipe named in the plan.
3. Run `npm run verify -- quick`, then `npm run verify`. Fix every failure. Never skip or delete a test.
4. Commit the slice with a message in the format of WORKFLOW.md step 9.
5. Tick the requirements the slice met in the plan and tell me what is left.
