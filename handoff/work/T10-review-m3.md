# T10: Milestone review M3

Date: 2026-11-10

User decision 2026-11-10: review with deferred rows; unmet lines stay unticked and keep their task ids.

Roadmap lines are shortened to their first clause.

| Roadmap line | Status | Evidence |
| --- | --- | --- |
| Aircraft data loader with zod schema for the 10 MVP 1 types | met | tests/aircraft.test.ts, tests/data.test.ts |
| Sprite baker in TypeScript ported from the prototypes | not met | T05 (042c89a) and T06 (0dff9ca) are done, not ticked: user review of the sheet pending. |
| Calibration overlays saved for all 10 types within tolerance | not met | T07 deferred. |
| Taxi network builder with samples, blocks and conflict sets, property tests | met | tests/network.test.ts, tests/networkProperties.test.ts, commits 08b181c (T08) |
| Routing with direction, closures, max code, congestion cost and preferred flows | met | tests/network.test.ts |
| Reservations, following gaps, junction priority, holding points, runway exclusivity with wake separation | met | tests/traffic.test.ts, tests/holding.test.ts, tests/junctionPriority.test.ts, commit de3539d (T09) |
| Push back with direction per stand | met | tests/traffic.test.ts, tests/stands.test.ts |
| Deadlock detection and resolution with debug overlay | met | tests/traffic.test.ts |
| Runway length, payload and range, ACR and PCR checks with the limiting factor shown | met | tests/payload.test.ts, tests/performance.test.ts |
| Test flight generator for arrivals and departures | met | tests/traffic.test.ts |
| Stress: 50 aircraft under the medium budget (busy50) | met | tests/traffic.test.ts, npm run stress |

## Checks

* 327 tests in 34 files pass. Lint, types and rules clean.
* e2e 9 of 9 in Chromium.
* Stress, total mean ms per tick (p99), after T09: small 0.009 (0.057), medium 0.009 (0.079), large 0.007 (0.066), busy50 0.028 (0.93) against budget 4 ms, terminal640 0.005 (0.048). Deadlocks 0, 1, 1, 1, 0 in scenario order.
* Slowdown since the last recorded stress table (STATE, 2026-11-05): medium went from 0.006 to 0.009, more than 30 percent. T08 measured 0.008 and T09 0.009. The rise comes from the two junction gates added since then, the conflict set check of T08 and the priority check of T09, which both loop over active aircraft for each waiting aircraft. It is 0.003 ms against a 4 ms budget. Small rose from 0.008 to 0.009, under 30 percent. Large and terminal640 fell.
