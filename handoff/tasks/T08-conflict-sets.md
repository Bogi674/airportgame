# T08. Network conflict sets and property tests

Milestone M3. Roadmap line: "Taxi network builder with samples, blocks and conflict sets, property tests".

## Goal

Aircraft never pass each other at a junction with overlapping wingtips, because the network knows which segments conflict near junctions and a reservation covers them. Property tests prove the network invariants on random layouts.

## Read first

* `docs/ARCHITECTURE.md` sections 5.1, 5.4 and 5.5.
* `src/sim/airfield/network.ts` (all), especially how blocks are formed and keyed (`blockTotal`, fork blocks keyed `1_000_000 + e`).
* `src/sim/ops/traffic.ts`: `tryEnter`, `blockHolder`, `releaseBehind`, `nodeOwner`.
* `src/shared/clearance.ts` (wingtip distances by code) and `AIRFIELD.codes[*].taxiSepM`.
* `tests/network.test.ts`, `tests/sim.test.ts`.

## Design

* For each junction node, two edges conflict when, within the junction area, the swept wingtip envelopes of their largest allowed codes overlap. Approximate the envelope by the edge samples within `taxiSepM` of the node, buffered by half the span of the edge's max code plus the code's object clearance. Two sample sets conflict if any pair of samples is closer than the sum of their half envelopes.
* Store conflicts as a compressed list: `conflictStart[e]`, `conflictEdge[...]` typed arrays. Built once per network build, never in a tick.
* In `tryEnter`, an aircraft may enter edge `e` only if no other aircraft holds an edge in `e`'s conflict set inside the junction zone. Use the existing ownership arrays; add an `edgeOwner` count if needed.

## Requirements

* R1. Conflict sets are built in `TaxiNetwork.build` with typed arrays.
* R2. Traffic respects them as described. The deadlock detector still finds and breaks cycles caused by conflicts.
* R3. Property tests in `tests/networkProperties.test.ts`, using a seeded `Rng` to generate 200 random layouts of 3 to 12 taxiways (with junctions, bends and stands): every edge has samples every 2 m or less; block ids partition two way edges between junctions; every stand is reachable from every runway entry when the layout is connected; conflict sets are symmetric; an edge never conflicts with itself.
* R4. A traffic test where two aircraft approach one junction on crossing taxiways at the same time: they never have a wingtip distance below the code clearance during the run. Measure it every tick.
* R5. `npm run stress`: busy50 stays under budget. Report before and after.

## Out of scope

Junction priority order (T09).
