# T81 Staff follow up, core three

## Goal

Three staff mechanics on the T68 substrate: security exits staffed by an officer, cleaners based in janitor rooms keeping terminal rooms clean, and apron crews that every airline turnaround needs.

## Read first

`docs/DESIGN_REVISION_4.md` sections 4 and 6.4, `src/sim/staff/staff.ts`, `src/sim/ops/turnaround.ts`, `src/shared/props.ts` (`janitorRooms`), `handoff/QUESTIONS.md` 2026-11-23 T81.

## Decisions

See `handoff/QUESTIONS.md` 2026-11-23 T81. Values live in `src/data/staff.json`.

## Requirements

1. `securityExit` is a station of the security role with a need of 1 at every level. With nobody on it, it serves at `unstaffedFactor` 0.5 of its rate instead of stopping.
2. Role `cleaner` (appended). Each janitor room set on staff floor is a station of the cleaner role whose need is its catalog `cleanerBase`.
3. Each room of a terminal floor (`labelRooms`) holds dirt. Once per game minute every passenger inside a room adds dirt; a room is fully dirty at `dirtyPerM2` units per m2 of its area. Dirt is saved per room and remapped through the old room labels when the floor changes.
4. A room above the call share is cleaned by an on duty cleaner of the janitor room nearest by staff walking distance: the cleaner walks there, cleans for a time that grows with the room area, empties the dirt and walks back. Each room has at most one cleaner on it.
5. Terminal cleanliness, the area weighted mean of one minus the dirt share over the rooms passengers use, averages with the cabin cleaning score in the passenger cleanliness part of the rating.
6. Role `ramp` (appended). With a ground handling depot, one ramp station at the lowest id depot needs `crewSize` times the commercial stands with a road, commuting from the nearest staff center to the depot.
7. An airline turnaround claims a crew of `crewSize` from the on duty ramp staff before chocks starts and frees it at door close. With no free crew chocks waits and the cause is a ramp crew delay owned by the airport. Without a depot turnarounds need no crew.
8. Crew figures stand beside each aircraft whose turnaround holds a crew; cleaners walk between their room and their janitor room in the people sample.
9. The Staff sheet and the coverage overlay show the new roles and stations. Save version bump with a migration.

## Acceptance

* An unstaffed exit queues arrivals at half rate, a staffed one at full rate.
* A busy room gets dirty, a cleaner from the nearest janitor room walks there and cleans it, a farther janitor room answers later.
* Without a janitor room terminal cleanliness falls and the rating drops.
* With a ramp cap of 0 an airline turnaround waits at chocks with a ramp crew cause; with crews it runs.
* Determinism: 2 000 ticks twice from one seed give the same hash, and a save mid run restores identically.
