# TASKS.md

The work left, in the delivery order the user approved on 2026-11-10. Take the first `todo` row whose dependencies are `done`, reading the phases top to bottom. Keep this table up to date: status, and the commit hashes when done.

Status values: `todo`, `doing`, `done`, `blocked` (say why in `handoff/QUESTIONS.md`), `deferred` (the user parked it, do not start it unasked).

Size: S is one or two slices, M three or four, L five or more. Split an L task into commits that each keep verify green.

The Milestone column names the `docs/ROADMAP.md` milestone whose criteria the task ticks. The phase order below wins over the milestone order.

## Done

| Id | Milestone | Task | Size | Depends | Status | Commits |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | M2 | [Turn pad drawing and placement tool](tasks/T01-turn-pad-ui.md) | M |  | done | 3eda81e ecc78c5 a7d88fe 309d7a9 |
| T39 | M2 | [Turn pads sit beyond the runway threshold](tasks/T39-turn-pad-beyond.md) | S | T01 | done | b2a027f e53274e f781b57 1899039 |
| T40 | M7 | [Standalone ATC tower with stage levels](tasks/T40-atc-tower.md) | M |  | done | c38a2b5 4d4661b 4944ca9 7afca60 8e85e5f c12e137 58e3a9f |
| T42 | M2 | [Grid and snapping, Cities Skylines style](tasks/T42-grid-snapping.md) | M |  | done | 728ec44 88caf98 5aa44de 6df863a ba5767f |
| T05 | M3 | [Sprite port: features and layer order](tasks/T05-sprite-features.md) | L |  | done | 042c89a |
| T06 | M3 | [Sprite liveries and tiers 0 to 3](tasks/T06-sprite-tiers.md) | M | T05 | done | 0dff9ca |
| T08 | M3 | [Network conflict sets and property tests](tasks/T08-conflict-sets.md) | M |  | done | 08b181c |

## Phase 1. Repair

All done: the tower (T40), the grid task (T42) and the doc drift. The rows are in the Done table.

## Phase 2. Flight offers

| Id | Milestone | Task | Size | Depends | Status | Commits |
| --- | --- | --- | --- | --- | --- | --- |
| T41 | M6 | [Flight offers and stand management](tasks/T41-flight-schedule.md) | L | T40 | done | 0ebb4b9 a5d0552 c38f640 02d3e80 8bc3f6a |

## Phase 3. Passenger core

M4 no longer waits for the sprite and calibration tasks T05 to T07 (user decision, 2026-11-10).

| Id | Milestone | Task | Size | Depends | Status | Commits |
| --- | --- | --- | --- | --- | --- | --- |
| T49 | M4 | [Floor index in the terminal data model](tasks/T49-floor-index.md) | M | T41 | done | 72af04a 35842a9 |
| T11 | M4 | [Kiosk, bag drop, passport booth, gate desk](tasks/T11-fixtures.md) | M | T41 | done | 155ce2d 9b6a90e c9dd591 00f3ed4 |
| T12 | M4 | [Walking graph](tasks/T12-walking-graph.md) | L | T11 T49 | todo |  |
| T13 | M4 | [Service nodes and queues](tasks/T13-service-nodes.md) | M | T12 | todo |  |
| T14 | M4 | [Cohorts and the departure journey](tasks/T14-cohorts-departure.md) | L | T13 | todo |  |
| T15 | M4 | [People rendering from the atlas](tasks/T15-people-atlas.md) | L | T14 | todo |  |
| T16 | M4 | [Density, queue and walking distance overlays](tasks/T16-terminal-overlays.md) | M | T14 | todo |  |
| T17 | M4 | [Satisfaction and airport rating](tasks/T17-satisfaction.md) | M | T14 | todo |  |
| T18 | M4 | [Stress: 20 000 cohorts](tasks/T18-cohort-stress.md) | S | T14 | todo |  |
| T19 | M4 | [Milestone review M4](tasks/milestone-review.md) | S | T11 to T18 | todo |  |

## Phase 4. Ground handling and baggage

Includes boarding by jet bridge, stairs or bus.

| Id | Milestone | Task | Size | Depends | Status | Commits |
| --- | --- | --- | --- | --- | --- | --- |
| T20 | M5 | [Arrival journey](tasks/T20-arrival-journey.md) | M | T19 | todo |  |
| T21 | M5 | [Baggage network and carousels](tasks/T21-baggage.md) | M | T20 | todo |  |
| T22 | M5 | [Turnaround task lists](tasks/T22-turnaround-tasks.md) | M | T19 | todo |  |
| T23 | M5 | [Hydrant dispenser and apron bus](tasks/T23-gse-dispenser-bus.md) | S | T22 | todo |  |
| T24 | M5 | [Service points, docking poses, service roads](tasks/T24-service-roads.md) | L | T22 | todo |  |
| T25 | M5 | [Trailer kinematics](tasks/T25-trailers.md) | S | T24 | todo |  |
| T26 | M5 | [Footprints, overhead zones and the collision test](tasks/T26-collision.md) | M | T24 | todo |  |
| T27 | M5 | [Draw order rules](tasks/T27-draw-order.md) | S | T26 | todo |  |
| T28 | M5 | [Staff sprites](tasks/T28-staff-sprites.md) | M | T15 | todo |  |
| T43 | M5 | [Working baggage system, single level](tasks/T43-baggage-system.md) | L | T22 T24 | todo |  |
| T47 | M5 | [Stand markings per design revision 3](tasks/T47-stand-markings.md) | L | T19 | todo |  |
| T48 | M5 | [Stand access types, jet bridge upgrade and boarding modes](tasks/T48-stand-access.md) | L | T47 T23 T14 | blocked |  |
| T29 | M5 | [Milestone review M5](tasks/milestone-review.md) | S | T20 to T28 T43 T47 T48 | todo |  |

## Phase 5. Tenants, airlines, finance

| Id | Milestone | Task | Size | Depends | Status | Commits |
| --- | --- | --- | --- | --- | --- | --- |
| T32 | M6 | [Tenants: zoned units, applications, furnishing](tasks/T32-shops.md) | L | T17 T29 | blocked |  |
| T30 | M6 | [Airline generator](tasks/T30-airline-generator.md) | L | T29 | todo |  |
| T31 | M6 | [Route demand, seasonal slots, contracts](tasks/T31-demand-contracts.md) | L | T30 | todo |  |
| T33 | M6 | [Automatic staffing and coverage overlay](tasks/T33-staffing.md) | M | T29 | todo |  |
| T34 | M6 | [Milestone review M6](tasks/milestone-review.md) | S | T30 to T33 | todo |  |

## Phase 6. Event director

| Id | Milestone | Task | Size | Depends | Status | Commits |
| --- | --- | --- | --- | --- | --- | --- |
| T50 | M6 | [Seeded event director with a data driven deck](tasks/T50-event-director.md) | L | T34 | blocked |  |

## Phase 7. Multi floor terminal designer, hangars, cargo

| Id | Milestone | Task | Size | Depends | Status | Commits |
| --- | --- | --- | --- | --- | --- | --- |
| T51 | Later | [Multi floor terminal designer](tasks/T51-multi-floor.md) | L | T49 T50 | blocked |  |
| T46 | Later | [Baggage levels, transfers and bridges](tasks/T46-baggage-levels.md) | M | T43 T51 | todo |  |
| T52 | Later | [Hangars](tasks/T52-hangars.md) | L | T50 | blocked |  |
| T53 | Later | [Cargo](tasks/T53-cargo.md) | L | T50 | blocked |  |

## Not placed in the delivery order

The 2026-11-10 order does not name these. Ask the user where they go before starting one. T05, T06 and T08 were delivered on `main` in the meantime and sit in the Done table.

| Id | Milestone | Task | Size | Depends | Status | Commits |
| --- | --- | --- | --- | --- | --- | --- |
| T09 | M3 | [Junction priority](tasks/T09-junction-priority.md) | M | T08 | done | de3539d |
| T04 | M2 | [Milestone review M2](tasks/milestone-review.md) | S | T01 T42 | done | reviewed with deferred rows, see work file |
| T10 | M3 | [Milestone review M3](tasks/milestone-review.md) | S | T05 T06 T08 T09 | done | reviewed with deferred rows, see work file |
| T35 | M7 | [Menus, wizard, load, settings, pause](tasks/T35-menus.md) | M | T34 | todo |  |
| T36 | M7 | [Left rail flyouts, alert center, overlay list](tasks/T36-hud.md) | M | T34 | todo |  |
| T37 | M7 | [Browser tests in three engines](tasks/T37-e2e-engines.md) | S | T34 | todo |  |
| T38 | M7 | [MVP 1 acceptance](tasks/T38-acceptance.md) | M | T35 T36 T37 | todo |  |

## Deferred

Parked by the user on 2026-11-10. `docs/DESIGN_REVISION_3.md` replaces their look and proportion targets.

| Id | Milestone | Task | Size | Depends | Status | Commits |
| --- | --- | --- | --- | --- | --- | --- |
| T02 | M2 | [Runway marking details](tasks/T02-runway-markings.md), runway remainder only | L |  | deferred |  |
| T03 | M2 | [Grading tool with cut and fill](tasks/T03-grading.md) | L |  | deferred |  |
| T07 | M3 | [Calibration overlays saved](tasks/T07-calibration.md) | M | T06 | deferred |  |

## Adding a task

When a task is split or a gap is found, add a row with the next free id after T53 and a spec file from the same layout as the others. Ids T44 and T45 are taken by entries in `handoff/QUESTIONS.md` that have no row yet. Put the row where it belongs in the order, and note the reason in the commit message.
