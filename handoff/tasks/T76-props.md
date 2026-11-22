# T76. Props on the sub grid

Phase 3b. Refreshed 2026-11-22 from the grill-me answers in `handoff/QUESTIONS.md` (2026-11-22 T76).

## Goal

Players furnish rooms with the kit: seating, lounge, washroom, decoration, vending, screens, service, office and back of house items, placed on a 0.5 m grid. Seats and decoration raise the passenger rating, washroom props are the toilets.

## Read first

`docs/TERMINAL_FIXTURES.md` sections 2, 6, 8 and 11, `src/sim/terminal/walkGraph.ts`, `src/sim/terminal/serviceNodes.ts`, `src/sim/terminal/visitPoints.ts`.

## Decisions

See `handoff/QUESTIONS.md`, 2026-11-22 T76.

## Requirements

1. Props are a list per floor `{ asset, x, y, rot }` with x and y in grid meters on a 0.5 m grid. The footprint is the catalog size rounded up to 0.5 m and turned by rot quarter turns.
2. `placeProp` and `removeProp` commands. Placement checks: a prop asset, floor under every part, an allowed zone, no fixture, no wall crossing, no overlap on the same layer, wall props on a wall with their back edge, desktop props on a desk, and no new block beside a door or a transition fixture. Removal refunds the full price.
3. Saved with a migration that converts every seating fixture to two beam seats and every toilet block to two stalls. The fixture tool refuses seating and toilet.
4. A 2 m cell where floor and wall props cover half its area or more is not walkable.
5. Washroom props of one room form one toilet service node with their summed capacity and capacity weighted service time.
6. Seat props are visit points and count as secure seating for the readiness checklist and the room checks.
7. Rating: Amenities term from comfort and ambience, the toilet term from washroom servers over 8. Upkeep 2 percent of prop cost per month.
8. Props are drawn from the kit sprites in the terminal chunks.
9. Build menu cards per category from the catalog with the sprite as the icon, a prop tool with ghost, rotation with R and removal.

## Acceptance

A lounge furnished from the kit matches `terminal_furniture_kit.png`, props block walking, determinism and save tests pass.
