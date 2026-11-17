# T74. Fixture levels and in place upgrades (draft)

Phase 3b. Draft written 2026-11-18. Run `grill-me` first.

## Goal

Check in desk, security lane, passport control and boarding gate desk exist in levels 1 to 3 and upgrade in place.

## Read first

`docs/TERMINAL_FIXTURES.md` section 4, `src/data/fixtures/catalog.json` (families `checkIn`, `security`, `passport`, `gateDesk`), `src/shared/business.ts` (`FIXTURE_KEYS`, `FIXTURE_SPAN`), `src/sim/terminal/serviceNodes.ts`, `src/sim/save/migrations.ts`.

## Settled

* Same footprint for every level of a family. Level 1 keeps today's service values.
* Upgrade is a works job: the fixture closes for the works time, its queue moves to the nearest fixture of its kind, undo restores the level.
* Level 3 check in desks give full satisfaction to premium classes.

## Open for the interview

Every value marked Confirm for levels 2 and 3 (`handoff/QUESTIONS.md` 2026-11-18 R5), build cost, upkeep and works time per level.

## Requirements

1. A level byte per fixture cell, saved with a migration (old saves get level 1).
2. `upgradeFixture` command, serializable and undoable.
3. Service nodes read time and staff from the catalog stats of the fixture's level.
4. Inspector shows the level and an Upgrade button with cost and works time.

## Acceptance

Determinism test, save migration test, an upgraded desk serves faster in a scenario, the sprite changes to the next level.
