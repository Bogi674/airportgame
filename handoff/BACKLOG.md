# BACKLOG.md

Bugs passed with notice or skipped as minor (see the bug triage rule in `CLAUDE.md`). One line each: task, bug, implication.

* T57: `handoff/scenarios/T57-stands.json` hardcodes stand ids 8, 9 and 10; the report prints their sizes but the shot tool cannot fail the run if they drift. Implication: a later build change could make the scene silently show no docked aircraft.
* T57: the stand scene e2e treats vehicles as docked when they stop moving for 1.5 s, because the snapshot carries no vehicle work state. Implication: a vehicle stalled mid path would pass as docked.
* T57 (pre-existing, older than T57): a pushback and a taxiing aircraft can wait on each other at adjacent taxilane nodes, caught by the deadlock detector. T57 cut such deadlocks from 288 to 77 over nine busy runs. Implication: rare stalls at busy stand rows until the detector resolves them; belongs to the T60 reservation work.
