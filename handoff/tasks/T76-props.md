# T76. Props on the sub grid (draft)

Phase 3b. Draft written 2026-11-18. Run `grill-me` first.

## Goal

Players furnish rooms with the kit: seating, lounge, washroom, decoration, vending, screens, service, office and back of house items, placed on a 0.5 m grid, each with a small effect.

## Read first

`docs/TERMINAL_FIXTURES.md` sections 2, 6 and 8, the catalog categories other than processing, zoning, baggage and circulation, `src/sim/terminal/walkGraph.ts`.

## Settled

* Props are a list per floor `{ asset, x, y, rot }` in meters on a 0.5 m grid; their footprint blocks walking; floor layer props (rugs, medallion, kids play mat) do not.
* Mounts: wall props need a wall at their back edge, desktop props need a desk under them, overhead props have no footprint.
* Zones from the catalog field `zones`.

## Open for the interview

Effect values (comfort per seat, ambience, wayfinding, charging, vending sales share, washroom capacity and service times), prices, and whether the existing `seating` and `toilet` fixtures convert to props on load.

## Requirements

1. `placeProp` and `removeProp` commands with undo, saved with a migration.
2. Build menu cards per category from the catalog, with the sprite as the icon.
3. Effects feed the needs of T67 when it lands; until then comfort and ambience count toward the terminal rating.

## Acceptance

A lounge furnished from the kit matches `terminal_furniture_kit.png`, props block walking, determinism and save tests pass.
