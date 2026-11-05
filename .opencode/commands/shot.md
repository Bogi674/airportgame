---
description: Visual check of the current task with npm run shot
---
Do the visual check of WORKFLOW.md step 7 for the current task.

!`grep -n "| doing |" handoff/TASKS.md`

1. Make sure `npm run dev` is running (http://localhost:5173 must answer). If not, tell me to start it.
2. Write or update handoff/scenarios/<task id>.json from handoff/scenarios/example-airport.json and the task spec's "Visual check" section.
3. Run `npm run shot -- handoff/scenarios/<task id>.json shots/<task id>`.
4. Open every PNG and describe what you see. Compare with the reference sheet the spec names. Check for overlaps, overflow, cropping and wrong scale.
5. Write the comparison in the work file. Fix problems and shoot again.
Extra notes from me: $ARGUMENTS
