# T77. Circulation and back of house

Phase 3b. Spec refreshed 2026-11-23 from the grill-me answers in `handoff/QUESTIONS.md`.

## Goal

Travelators are placed and drawn from the kit and speed up walking on one floor. A room holding the janitor room set is a janitor room, validated now, the cleaners' base once T81 hires cleaners. Escalators, stairs and elevators stay hidden until T51.

## Read first

`docs/TERMINAL_FIXTURES.md` section 6.9, `docs/art/terminal_office_infra_kit.png`, catalog categories `circulation` and `backOfHouse`.

## Decisions

1. One fixture key `travelator`, appended to `FIXTURE_KEYS`. Level 1, 2, 3 is the 8, 16, 24 m pair (`circulation.travelator8`, `16`, `24`), picked at placement, never upgraded.
2. Footprint along by across: 4 by 2, 8 by 2, 12 by 2 cells. Zones: every zone of the catalog entry.
3. Prices 60 000, 110 000, 160 000 in `business.json` `fixtureCosts`. No upkeep: travelator cost is left out of the building upkeep base.
4. Travelator cells are closed to walking from every side. Each of the two lanes joins the cell before its first cell and the cell after its last cell along its axis with a walk edge both ways, of length `length x ref / (ref + speed)`, ref 1.3 m/s from `business.json`, speed from the catalog.
5. Janitor room: a room (labelRooms) holding a `boh.janitorRoom` prop. Issue `janitorNotStaff` when any cell under that prop is not staff zone. The terminal inspector counts janitor rooms and the cleaner base (catalog `cleanerBase`).

## Requirements

1. Placement on the 2 m grid with the footprints above, rotation as other multi cell fixtures.
2. Walk graph edges along travelators carry the faster time.
3. Room type janitor with validation and an inspector line.
4. Kit drawing of the three travelators; build menu card under a new Circulation tab with a length picker.

## Acceptance

A travelator shortens a measured walk in a test; the art matches the sheet in a screenshot; determinism test passes.
