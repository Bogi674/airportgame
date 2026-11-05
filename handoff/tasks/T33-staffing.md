# T33. Automatic staffing and coverage overlay

Milestone M6. Roadmap line: "Automatic staffing with wages and a coverage overlay (wages follow a staff count, no coverage overlay)".

## Goal

Staff are assigned automatically to fixtures and handling tasks with wages, and an overlay shows where coverage is short.

## Read first

* `docs/GAME_DESIGN.md` section 10 "Staff", `docs/UI_DESIGN.md` section 5 overlays.
* `src/sim/business/business.ts` (`staffCount`, wages), T13 service nodes, T22 tasks, T28 staff sprites.

## Requirements

* R1. Required staff per service node and per handling task from data; hired automatically up to a player set budget or headcount cap.
* R2. Unstaffed servers do not serve (T13 reads it); unstaffed tasks delay (T22 reads it).
* R3. Wages per role in data, booked daily.
* R4. Coverage overlay: green fully staffed, amber partly, red unstaffed, per service node and stand.
* R5. Tests: a cap below need leaves servers idle and lengthens queues; wages match headcount times rate.
