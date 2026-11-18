# T77. Circulation and back of house (draft)

Phase 3b. Draft written 2026-11-18. Run `grill-me` first.

## Goal

Escalators, stairs, elevators and travelators are placed and drawn from the kit, travelators speed up walking on one floor, and the janitor room is the base of the cleaners.

## Read first

`docs/TERMINAL_FIXTURES.md` section 6.9, `docs/art/terminal_office_infra_kit.png`, catalog category `circulation` and `backOfHouse`, `ROADMAP.md` section 5 (T51 multi floor stays MVP 2).

## Settled

* Escalators and stairs have a lower end at the bottom edge and an upper end at the top edge. Until T51 they are placed and drawn, with a notice that they link floors once upper floors exist.
* Travelators come in 8, 16 and 24 m pairs; speed 0.65 m/s is added to walking speed along them (Confirm).
* The janitor room is a staff room type with the janitor room set; cleaning response time grows with distance to it.

## Open for the interview

Capacities marked Confirm, prices, whether travelators may be any length in 2 m steps (the generator supports it).

## Requirements

1. Placement on the 2 m grid with the catalog footprints.
2. Walking graph edges along travelators carry a speed factor.
3. Room type `janitor` with validation.

## Acceptance

A travelator shortens a measured walk in a scenario; the art matches the sheet.
