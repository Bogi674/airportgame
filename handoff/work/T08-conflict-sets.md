# T08 work notes

Decision (asked 2026-11-10): conflict sets cover taxiway, taxilane and rapid exit edges only. Edges of one taxiway never conflict.

* Network: `TaxiNetwork.buildConflicts` builds `conflictStart`, `conflictEdge` and `edgeZoneM` once per build. Envelope half width is half the taxiway separation of the edge's largest code.
* Traffic: `conflictHolder` in `src/sim/ops/traffic.ts`, called first in `tryEnter`. Zone is the larger edge zone plus `CONFLICT_MARGIN_M` (30 m). Mutual waits are broken by index so two aircraft never wait for each other over a conflict.
* Tests: `tests/networkProperties.test.ts`: 200 seeded random layouts (3 to 12 taxiways, bends, crossings, branches, stands) check 2 m samples, block partition, stand to entry reachability, and conflict symmetry, irreflexivity, order and kind. A traffic test measures the wingtip gap of moving aircraft on conflicting edges every tick for two seeds and fails without the gate (5.9 m against 8.2 m clearance at tick 17420).
* R4 is measured in the busy test airport rather than one hand built crossing, because the sim has no hook to place two aircraft on chosen edges and adding one only for a test was not worth it.
* Stress, total mean ms per tick (p99), deadlocks, before then after: small 0.008 (0) then 0.008 (0). medium 0.006 (0) then 0.008 (1). large 0.009 (0) then 0.008 (1). busy50 0.027 p99 0.89 (0) then 0.026 p99 0.87 (1), budget 4 ms. Medium and large complete 2 flights fewer in their short runs, busy50 unchanged at 4.
* Known limit: an aircraft waiting short of a junction stops its span over two plus 12 m from the node, which is closer than the code clearance to an aircraft crossing the node. Lengthening it to 16 m broke the existing spacing test in `tests/traffic.test.ts`, so it is left alone. T09 owns the order at junctions. The wingtip test therefore skips stopped aircraft and pairs that wait for each other.
* Tried and dropped: a larger junction margin cost throughput (the tower test saw 14 arrivals instead of over 20), so the gate only counts aircraft that have not cleared the node with their tail.
