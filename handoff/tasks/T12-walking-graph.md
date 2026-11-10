# T12. Walking graph

Depends on T49 (user decision, 2026-11-10): the terminal data model gains a floor index first, and the graph is keyed by floor from the start. Only floor 0 exists for now.

Milestone M4. Roadmap line: "Walking graph with cached distances and regional rebuild".

## Goal

Inside every terminal, a graph over rooms and doors with a waypoint lattice gives walking distances between any two service points, cached and rebuilt only around an edit. Cohorts (T14) will walk on it.

## Read first

* `docs/ARCHITECTURE.md` section 7 and hard rule 7 in `AGENTS.md`.
* `docs/PERFORMANCE.md` sections 1 to 3 (budgets, memory, simulation).
* `src/shared/business.ts` (grid layout, walls as edge arrays `hWall` and `vWall`), `src/shared/terminalOps.ts` (cell indexing: `cellIndex`, `cellOf`, `hEdgeIndex`, `vEdgeIndex`), `src/shared/terminalRooms.ts` (how rooms are flood filled).
* `src/sim/business/business.ts`: where terminal edits are applied (`terminalBuild`).

## Design (decided)

* **Nodes**: one waypoint per 6 m lattice point (every third cell) on floor cells, plus one node per door cell and one per fixture service point. Typed arrays: `nodeX`, `nodeY` (cell coordinates), `nodeKind`, `nodeRoom`.
* **Edges**: between lattice neighbours (8 directions) when the straight line between them crosses no wall edge and only floor cells, and from fixture and door nodes to the nearest visible lattice nodes. Length in meters. Compressed adjacency arrays like `TaxiNetwork`.
* **Distances**: Dijkstra from a source node on demand, results cached per source in a `Float32Array` per cached source with an LRU of at most N sources (N in data). Hot paths read the cache only.
* **Regional rebuild**: an edit marks the lattice cells within 12 m of the edit dirty; only nodes and edges touching them are rebuilt, and caches whose shortest path tree touches a dirty node are dropped. If the region exceeds a quarter of the building, rebuild all.
* The graph lives in the sim (`src/sim/terminal/walkGraph.ts`), one per building, rebuilt at command time, never in a tick.

## Requirements

* R1. The graph and cache as above, deterministic (fixed node order, ties broken by node index).
* R2. `walkDistance(building, fromNode, toNode)` and `nearestNode(building, cell)`.
* R3. Regional rebuild gives the same distances as a full rebuild (property test over random edits).
* R4. Performance: building the graph for the 640 by 120 m stress terminal under 100 ms; a regional rebuild for a 2 by 2 cell wall edit under 10 ms; measured in a test that prints times and asserts generous limits.
* R5. Debug overlay toggle in the UI showing nodes and edges for the selected terminal.

## Tests

* Distance across an open room equals the straight line within 5 percent. A wall forces the path through the door. A closed room is unreachable (Infinity). Regional versus full rebuild equality over 100 random edits with a seeded `Rng`.

## Out of scope

Cohorts walking (T14), congestion factor from density (T14 or T16).
