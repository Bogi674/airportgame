# BACKLOG.md

Bugs passed with notice or skipped as minor (see `handoff/WORKFLOW.md`, bug triage). One line each: task, bug, implication.

* T57: `handoff/scenarios/T57-stands.json` hardcodes stand ids 8, 9 and 10; the report prints their sizes but the shot tool cannot fail the run if they drift. Implication: a later build change could make the scene silently show no docked aircraft.
* T57: the stand scene e2e treats vehicles as docked when they stop moving for 1.5 s, because the snapshot carries no vehicle work state. Implication: a vehicle stalled mid path would pass as docked.
