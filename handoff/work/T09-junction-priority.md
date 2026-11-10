# T09: Junction priority

Status: coding
Branch: claude/elegant-einstein-3sp52j

## Requirements

* [ ] R1 Order: vacating a runway, arrivals, departures, push backs, then request tick, then aircraft index. Typed arrays, no allocation per tick.
* [ ] R2 Aircraft waiting for priority show in the traffic overlay like other waiting aircraft.
* [ ] R3 The deadlock detector treats priority waits as edges of the wait graph.
* [ ] R4 Tests: arrival before departure, vacating before taxiing arrival, equal classes by request tick.
* [ ] R5 Determinism test and stress before and after.

## Decisions

* Asked 2026-11-10: the save format goes from 8 to 9 for the request table (`reqNode`, `reqTick`, `reqClass`). Older saves load with an empty table.
* Class from state: 0 is `TaxiIn` on the first route edge (the exit off the runway), 1 is any other `TaxiIn`, 2 is `TaxiOut`, `Holding` and `LineUp`, 3 is `Pushback`.
* A request is recorded on the first `tryEnter` call for a node and cleared on the grant, on `releaseAll` and on a network rebuild.
* "Could enter now" is the same check the aircraft itself would pass: `tryEnter` is split into a side effect free `entryBlocker` and the grant. A better ranked requester only holds another back when its own `entryBlocker` is clear and it is not yielding.
* A priority wait sets `waitingFor`, so the overlay flag (R2) and the deadlock detector (R3) see it with no further change.
* Mutual conflict waits are broken by the same rank instead of the bare index, so priority also orders two aircraft already inside each other's conflict zone.

## Slices

1. Sim: request table, rank, gate, save version 9, tests (R1 to R5).
2. Docs and handoff.
