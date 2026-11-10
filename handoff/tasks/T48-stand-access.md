# T48. Stand access types, jet bridge upgrade and boarding modes

Milestone M5. Source: `docs/DESIGN_REVISION_3.md` section 4, approved by the user on 2026-11-10. Status `blocked` until the user gives the open values in section 4.4.

## Goal

A stand has a passenger access type that the player can change after building, through the works system. The markings follow the access type, and passengers board by jet bridge, by stairs or by apron bus.

## Read first

* `docs/DESIGN_REVISION_3.md` sections 4 and 6.
* `handoff/tasks/T47-stand-markings.md`, which this task builds on.
* `src/data/stand_sizes.json`, `src/data/aircraft/aircraft.mvp.json` (`doorStations`), `src/data/gse.json` (stairs, apron bus).
* The works system for taxiways and runways in `src/sim/airfield/airfield.ts`.
* `handoff/RECIPES.md` for commands, data and save fields.

## Requirements

* R1. Five access types as in section 4.1: 1 Regular, 2 Mirrored, 3 Upgraded with two accesses, 4 Side load, 5 Bus connection. The marking difference per type follows the table.
* R2. The look of a stand with a jet bridge follows section 4.2: fixed link from a gate door over the service road, rotunda inside the red hatched bridge zone, tunnel and cab at the aircraft door.
* R3. A stand is built with type 5 unless a terminal face or pier lies within reach of the fixed link. Reach is a data value.
* R4. Changing the access type is a works job on the stand. The stand is closed for the works duration, the markings regenerate when the works finish, and undo restores the previous type.
* R5. Boarding follows the access type: through the bridge for types 1 to 4, by stairs when the stand has no bridge and lies within walking distance of a gate door, and by apron bus otherwise.
* R6. Door stations for each bridge come from the aircraft data. A type with no usable aft door refuses the second bridge of type 3 and uses the forward bridge only.
* R7. A Medium stand can be upgraded to type 3.
* R8. The access type is saved, with a save version bump and a migration.
* R9. Values live in `src/data/stand_sizes.json` or a new `src/data/stand_access.json` with a zod schema.

## Tests

* Revision 3 section 6 items 2 and 3 for every size and access type.
* Boarding mode chosen per access type and distance.
* Determinism: 2 000 ticks twice from one seed, identical `stateHash`, including an access type change.

## Open questions, all block the task

From section 4.4. Ask the user, never invent:

1. Cost and works days for each access type change.
2. Fixed link reach in meters, and the walking distance limit for stairs boarding.
3. Whether type 3 and type 4 are available on every stand size.
