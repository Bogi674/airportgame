# T74. Fixture levels and in place upgrades

Phase 3b. Refreshed 2026-11-21 from the grill-me answers (`handoff/QUESTIONS.md` 2026-11-21 T74).

## Goal

Check in desk, security lane, passport control and boarding gate desk exist in levels 1 to 3, are placed at any level and upgrade in place through a works job. The security lane takes the 16 by 4 m kit footprint.

## Read first

`docs/TERMINAL_FIXTURES.md` section 4, `src/data/fixtures/catalog.json` (families `checkIn`, `security`, `passport`, `gateDesk`), `src/shared/business.ts`, `src/shared/terminalOps.ts`, `src/sim/terminal/serviceNodes.ts`, `src/sim/save/migrations.ts`.

## Decisions

1. Service values per level are the catalog stats accepted in R5: check in 120, 105, 95 s; security 12, 10, 8 s; passport 45, 38, 30 s; gate desk 5, 3.5, 3 s per passenger.
2. Staff on a node per level: security 2, 3, 3 (level 2 has one more officer, level 3 counts the remote screener as one more, no room needed); gate desk 1, 2, 2; check in and passport 1 at every level.
3. Level 2 costs 1.5 times level 1, level 3 costs 2 times. An upgrade costs the difference. Works take 0.5 game day. Fixtures at level 2 and 3 pay upkeep of 0.05 percent of their build cost per day; level 1 keeps today's numbers.
4. The fixture tool places any level. The inspector upgrades a built fixture one level at a time. No downgrade. Cancelling running works is the undo: it refunds the upgrade and keeps the old level.
5. During works the fixture serves nobody: it leaves the service table, so its queue is evicted and finds the nearest fixture of its kind. The sprite changes when the works finish.
6. Premium profile passengers lose 10 points at a level 1 check in, 5 at level 2, none at level 3. A level 3 gate desk boards premium passengers ahead of the queue.
7. Security lanes are 8 by 2 cells at every level ([2, 8] along by across, flow along the 8 cells), drawn from the kit sprites. Saves before version 33 lose their 1 cell lanes on load, with a full refund and a notice.

## Requirements

1. Level values in `src/data/business.json` (`fixtureLevels`) with schema, and a test that they equal the catalog stats.
2. `fixtureCost` and placement honour the level for the four families.
3. Security footprint [2, 8]; queues start at the lane entry; save version 33 removes old lanes, refunds them and raises a notice.
4. Service nodes read time and staff need from the level.
5. `upgradeFixture` and `cancelFixtureWorks` commands; works saved on the grid and in the hash; finishing works sets the level and rebuilds service nodes.
6. Premium penalty at check in and priority boarding at a level 3 gate desk.
7. Kit sprites for every level of the four families; a works hatch on fixtures under works.
8. Level picker in the fixture tool, level and Upgrade or Cancel works in the inspector, strings.

## Acceptance

Determinism test, save migration test, an upgraded desk serves faster in a test, the sprite changes to the next level in a screenshot, full verify and e2e smoke pass.
