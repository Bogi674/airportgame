# T04: Milestone review M2

Date: 2026-11-10

User decision 2026-11-10: review with deferred rows; unmet lines stay unticked and keep their task ids.

Roadmap lines are shortened to their first clause.

| Roadmap line | Status | Evidence |
| --- | --- | --- |
| Runway tool with profile, widths by code, length and heading readouts | met | tests/airfield.test.ts, tests/runwayWorks.test.ts |
| Taxiway tool with code widths, fillets, segment properties, automatic names | met | tests/pavement.test.ts, tests/snapping.test.ts, tests/network.test.ts |
| Ghost envelopes: runway strip, wingtip envelope, separations, obstacle surfaces | met | tests/clearance.test.ts, tests/obstacles.test.ts |
| Automatic holding points, entries with takeoff distance available | met | tests/holding.test.ts |
| Rapid exit tool with 30, 45 and 90 degree presets | met | tests/airfield.test.ts, tests/edit.test.ts |
| Apron, stand and stand row tools for contact, remote push back, remote taxi through and GA tie down | met | tests/aprons.test.ts, tests/stands.test.ts |
| Surfaces with PCR tiers, condition and resurfacing | met | tests/surfaces.test.ts |
| Alignment frames and snapping rules | met | tests/snapping.test.ts |
| Construction grid along every runway and taxiway segment (task T42) | met | tests/constructionGrid.test.ts, commits 728ec44 88caf98 5aa44de 6df863a ba5767f |
| Undo and redo for all build actions, validation messages with explanations | met | tests/edit.test.ts, tests/helpers.ts |
| Prefab pieces: runway end with turn pad, rapid exit, parallel taxiway with connectors, stand row, GA apron block | not met | Turn pad frozen by the user 2026-11-05. T01 (3eda81e ecc78c5 a7d88fe 309d7a9) and T39 (b2a027f e53274e f781b57 1899039) are done, tests/turnPad.test.ts. Other prefabs exist but the line stays open. |
| Runway, taxiway and stand markings with surface rules and restraint envelopes | not met | T02 deferred. |
| Grading tool with cut and fill cost | not met | T03 deferred. |
