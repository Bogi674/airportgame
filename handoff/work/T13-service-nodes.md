# T13: Service nodes and queues

Status: done
Branch: claude/ecstatic-rubin-7yq9uc

## Requirements

* [x] R1 Service nodes are created from fixtures whenever terminal grids change (at command time)
* [x] R2 API for T14: join, update, waitEstimate in seconds
* [x] R3 Data in `business.json` (coefficient of variation, queue density) with schema
* [x] R4 Tests: security lane about 300 people per hour within 10 percent, overflow stops joins, determinism

## Design

* One node table per grid, parallel to `grids` and `walkGraphs`. Derived from fixtures, rebuilt at command time.
* Serving kinds: checkIn, kiosk, bagDrop, security, passport, gateDesk, toilet. One node per fixture anchor cell.
* Data: `terminal.service = { cv: 0.4, queueDensityPerM2: 1, queueReachCells: 4, queueSlots: 32 }`.
  Modules gain `servers` and `serviceSeconds` for checkIn (1, 120), security (1, 12), toilet (6, 90),
  from the GAME_DESIGN section 8 table. Security `capacityPerHour` goes from 150 to 300 (user decision),
  so the aggregated load model agrees with the table.
* Queue area: free floor cells reached by a breadth first walk of at most `queueReachCells` steps from the
  anchor, walls respected. A security lane does not count secure zone cells. Capacity is cells times 4 m2
  times density, rounded down. Neighbouring fixtures may count the same cell.
* Whole node, one timer (user decision): the head cohort holds every server for
  `size * serviceTime / servers`. One lognormal draw per cohort.
* Lognormal without `Math.exp`, `Math.log` or trigonometry: the normal deviate is the sum of 12 uniforms
  minus 6, and exp and ln are fixed length series of plain arithmetic, so results are bit identical everywhere.
* Queues: ring buffers of cohort id and size per node, `queueSlots` entries. A join fails when the people
  waiting plus the cohort exceed the capacity, or the ring is full. An empty queue accepts any cohort when
  the capacity is above zero, so a small queue area never makes a node unusable.
* Update runs every 10 ticks (ARCHITECTURE section 4). A node that finishes starts the next cohort at the
  finish tick, not the update tick, so throughput has no cadence bias. Finished cohorts are listed in a
  done buffer for T14.
* Rebuild keeps the queue, serving cohort and timer of every node that still has the same kind at the same
  logical cell. Cohorts of removed nodes go to an evicted list for T14.
* Save version stays 12 (user decision). Queues are always empty in T13 because nothing joins. Service
  state is folded into the hash. T14 must save it together with the cohort table.

## Slices

1. Data, schema, security capacity 300.
2. `serviceNodes.ts` build: nodes, queue capacity, walk node, series math.
3. Join, update, waitEstimate, R4 tests.
4. Sim integration: tables per grid, rebuild with carry over, cadence, hash, determinism.
5. Docs, roadmap, handoff close.

## Open questions

Security rate, save format, server model, queue density: answered by the user on 2026-11-11.

## Verify

```
PASS  rules
PASS  types
PASS  lint
PASS  tests (44 files, 508 tests)
PASS  stress
verify: all checks passed.
build: passed
e2e: 13 passed
```

## Report

All four requirements met. Reviewer found no logic bugs. Test gaps from the reviews of slices 1, 2 and 4 are closed, and the hash now covers queue and evicted contents. No save change, no new dependency, no visual change. T14 must save service state and the service rng together with the cohort table (PITFALLS 27).
