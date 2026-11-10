# TASKS.md

The work left for MVP 1, in order. Every unchecked line of `docs/ROADMAP.md` milestones M2 to M7 maps to a task here. Take the first `todo` row whose dependencies are `done`. Keep this table up to date: status, and the commit hashes when done.

Status values: `todo`, `doing`, `done`, `blocked` (say why in `handoff/QUESTIONS.md`), `deferred` (skipped on the user's say so, 2026-11-10; the unmet roadmap lines carry to a later review).

Size: S is one or two slices, M three or four, L five or more. Split an L task into commits that each keep verify green.

| Id | Milestone | Task | Size | Depends | Status | Commits |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | M2 | [Turn pad drawing and placement tool](tasks/T01-turn-pad-ui.md) | M | | done | 3eda81e ecc78c5 a7d88fe 309d7a9 |
| T39 | M2 | [Turn pads sit beyond the runway threshold](tasks/T39-turn-pad-beyond.md) | S | T01 | done | b2a027f e53274e f781b57 1899039 |
| T02 | M2 | [Runway marking details](tasks/T02-runway-markings.md) | L | | deferred | |
| T03 | M2 | [Grading tool with cut and fill](tasks/T03-grading.md) | L | | deferred | |
| T42 | M2 | [Grid and snapping, Cities Skylines style](tasks/T42-grid-snapping.md) | M | | done | 728ec44 88caf98 5aa44de 6df863a ba5767f |
| T40 | M7 | [Standalone ATC tower with stage levels](tasks/T40-atc-tower.md) | M | | done | c38a2b5 4d4661b 4944ca9 7afca60 |
| T04 | M2 | [Milestone review M2](tasks/milestone-review.md) | S | T01 | todo | |
| T05 | M3 | [Sprite port: features and layer order](tasks/T05-sprite-features.md) | L | T04 | done | 042c89a |
| T06 | M3 | [Sprite liveries and tiers 0 to 3](tasks/T06-sprite-tiers.md) | M | T05 | done | HASH |
| T07 | M3 | [Calibration overlays saved](tasks/T07-calibration.md) | M | T06 | deferred | |
| T08 | M3 | [Network conflict sets and property tests](tasks/T08-conflict-sets.md) | M | T04 | todo | |
| T09 | M3 | [Junction priority](tasks/T09-junction-priority.md) | M | T08 | todo | |
| T10 | M3 | [Milestone review M3](tasks/milestone-review.md) | S | T05 to T09 | todo | |
| T11 | M4 | [Kiosk, bag drop, passport booth, gate desk](tasks/T11-fixtures.md) | M | T10 | todo | |
| T12 | M4 | [Walking graph](tasks/T12-walking-graph.md) | L | T11 | todo | |
| T13 | M4 | [Service nodes and queues](tasks/T13-service-nodes.md) | M | T12 | todo | |
| T14 | M4 | [Cohorts and the departure journey](tasks/T14-cohorts-departure.md) | L | T13 | todo | |
| T15 | M4 | [People rendering from the atlas](tasks/T15-people-atlas.md) | L | T14 | todo | |
| T16 | M4 | [Density, queue and walking distance overlays](tasks/T16-terminal-overlays.md) | M | T14 | todo | |
| T17 | M4 | [Satisfaction and airport rating](tasks/T17-satisfaction.md) | M | T14 | todo | |
| T18 | M4 | [Stress: 20 000 cohorts](tasks/T18-cohort-stress.md) | S | T14 | todo | |
| T19 | M4 | [Milestone review M4](tasks/milestone-review.md) | S | T11 to T18 | todo | |
| T20 | M5 | [Arrival journey](tasks/T20-arrival-journey.md) | M | T19 | todo | |
| T21 | M5 | [Baggage network and carousels](tasks/T21-baggage.md) | M | T20 | todo | |
| T22 | M5 | [Turnaround task lists](tasks/T22-turnaround-tasks.md) | M | T19 | todo | |
| T23 | M5 | [Hydrant dispenser and apron bus](tasks/T23-gse-dispenser-bus.md) | S | T22 | todo | |
| T24 | M5 | [Service points, docking poses, service roads](tasks/T24-service-roads.md) | L | T22 | todo | |
| T25 | M5 | [Trailer kinematics](tasks/T25-trailers.md) | S | T24 | todo | |
| T26 | M5 | [Footprints, overhead zones and the collision test](tasks/T26-collision.md) | M | T24 | todo | |
| T27 | M5 | [Draw order rules](tasks/T27-draw-order.md) | S | T26 | todo | |
| T28 | M5 | [Staff sprites](tasks/T28-staff-sprites.md) | M | T15 | todo | |
| T43 | M5 | [Working baggage system, single level](tasks/T43-baggage-system.md) | L | T22 T24 | todo | |
| T46 | Later | [Baggage levels, transfers and bridges](tasks/T46-baggage-levels.md) | M | T43 | todo | |
| T29 | M5 | [Milestone review M5](tasks/milestone-review.md) | S | T20 to T28 | todo | |
| T30 | M6 | [Airline generator](tasks/T30-airline-generator.md) | L | T29 | todo | |
| T31 | M6 | [Route demand, seasonal slots, contracts](tasks/T31-demand-contracts.md) | L | T30 | todo | |
| T32 | M6 | [Shop sales and tenant fill](tasks/T32-shops.md) | M | T17 | todo | |
| T33 | M6 | [Automatic staffing and coverage overlay](tasks/T33-staffing.md) | M | T29 | todo | |
| T34 | M6 | [Milestone review M6](tasks/milestone-review.md) | S | T30 to T33 | todo | |
| T41 | M6 | [Flight offers and stand management](tasks/T41-flight-schedule.md) | L | | todo | |
| T35 | M7 | [Menus, wizard, load, settings, pause](tasks/T35-menus.md) | M | T34 | todo | |
| T36 | M7 | [Left rail flyouts, alert center, overlay list](tasks/T36-hud.md) | M | T34 | todo | |
| T37 | M7 | [Browser tests in three engines](tasks/T37-e2e-engines.md) | S | T34 | todo | |
| T38 | M7 | [MVP 1 acceptance](tasks/T38-acceptance.md) | M | T35 T36 T37 | todo | |

## Adding a task

When a task is split or a gap is found, add a row with the next free id after T38 and a spec file from the same layout as the others. Put it where it belongs in the order, and note the reason in the commit message.
