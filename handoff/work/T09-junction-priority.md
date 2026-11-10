# T09: Junction priority

Status: done
Branch: claude/elegant-einstein-3sp52j

## Requirements

* [x] R1 Order: vacating a runway, arrivals, departures, push backs, then request tick, then aircraft index. Typed arrays, no allocation per tick.
* [x] R2 Aircraft waiting for priority show in the traffic overlay like other waiting aircraft.
* [x] R3 The deadlock detector treats priority waits as edges of the wait graph.
* [x] R4 Tests: arrival before departure, vacating before taxiing arrival, equal classes by request tick.
* [x] R5 Determinism test and stress before and after.

## Decisions

* Asked 2026-11-10: the save format goes from 8 to 9 for the request table (`reqNode`, `reqTick`, `reqClass`). Older saves load with an empty table.
* Class from state: 0 is `TaxiIn` on the first route edge (the exit off the runway), 1 is any other `TaxiIn`, 2 is `TaxiOut`, `Holding` and `LineUp`, 3 is `Pushback`.
* A request is recorded on the first `tryEnter` call for a node and cleared on the grant, on `releaseAll` and on a network rebuild.
* "Could enter now" is the same check the aircraft itself would pass: `tryEnter` is split into a side effect free `entryBlocker` and the grant. A better ranked requester only holds another back when its own `entryBlocker` is clear and it is not yielding.
* A priority wait sets `waitingFor`, so the overlay flag (R2) and the deadlock detector (R3) see it with no further change.
* Mutual conflict waits keep the lower index tie break. Ordering them by rank cut arrivals in the tower budget test from over 20 to 14.

## Slices

1. Sim: request table, rank, gate, save version 9, tests (R1 to R5).
2. Docs and handoff.

## Report

* Commit de3539d.
* 327 tests in 34 files pass. Lint, types and rules clean. e2e 9 of 9 in Chromium.
* Stress, total mean ms per tick (p99), before then after: small 0.008 (0.053) then 0.009 (0.057), medium 0.008 then 0.009 (0.079), large 0.008 then 0.007 (0.066), busy50 0.026 (0.82) then 0.028 (0.93), budget 4 ms, terminal640 0.007 (0.071) then 0.005 (0.048).
* Deadlocks unchanged, in scenario order small, medium, large, busy50, terminal640: 0, 1, 1, 1, 0.
* Reviewer note: `priorityHolder` is quadratic in queued aircraft. Watch busy50.
