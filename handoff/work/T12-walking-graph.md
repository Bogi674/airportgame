# T12: Walking graph

Status: done
Branch: claude/ecstatic-rubin-7yq9uc

## Requirements

* [x] R1 Graph and cache, deterministic (fixed node order, ties broken by node index)
* [x] R2 `walkDistance` and `nearestNode`
* [x] R3 Regional rebuild equals full rebuild (property test over random edits)
* [x] R4 Stress terminal build under 100 ms, 2 by 2 wall edit regional rebuild under 10 ms
* [x] R5 Debug overlay toggle showing nodes and edges of the selected terminal

## Design

* One graph per grid (one floor of one building, T49). Derived data, never saved. Save version stays 12.
* Data: `business.json` `terminal.walk = { latticeCells: 3, dirtyMarginCells: 8, cacheSources: 64 }`.
* Blocks: 3 by 3 logical cells, aligned to the logical origin so growth never shifts them.
* Nodes are cells. Per block, floor cells are flood filled inside the block. Each group gets one lattice
  node: the block centre cell when it is in the group, else the first cell of the group. This keeps
  corridors narrower than 6 m on the graph. Extra nodes: both cells beside a door edge, and every
  fixture anchor except seating. Node ids are compact, in cell index order.
* Edges: node pairs in the same block, the 8 neighbour blocks and the 8 knight move blocks, when a
  supercover line of sight is clear. Length is the straight line in meters. Knight moves keep the open
  room error under 5 percent (user decision). Fallback edges, with a 4 direction cell path length, join
  step adjacent groups and extra nodes that have no line of sight edge, so the graph is connected
  exactly where cells are.
* Edges are stored sorted by (from, to) in compressed adjacency arrays, so a regional rebuild and a
  full rebuild give identical arrays.
* Distances: Dijkstra with a binary heap ordered by (distance, node index). One `Float32Array` row per
  source, LRU of `cacheSources` rows, rows pooled.
* Regional rebuild: blocks within `dirtyMarginCells` of the edit are recomputed, other nodes and edges
  are kept. More than a quarter of the blocks, or a grown grid, rebuilds all. Every cached row of the
  grid is dropped on any rebuild: a shortest path tree spans every reachable node, so the spec rule
  "drop rows whose tree touches a dirty node" drops them all in practice.
* Build is synchronous at command time (user decision), an exception to PERFORMANCE section 3.
* Overlay: dev toggle, graph sent in a one off worker message while the toggle is on (user decision).

## Slices

1. Shared helpers and data: export `canStep`, `labelRooms`, `terminal.walk` values.
2. `walkGraph.ts` full build: nodes, rooms, edges, compressed adjacency.
3. Dijkstra, LRU cache, `walkDistance`, `nearestNode`.
4. Regional rebuild, property test, performance test.
5. Sim integration: graphs per grid, rebuild on edit, demolish and restore, determinism, stress.
6. Debug overlay.
7. Docs, roadmap, handoff close.

## Open questions

Build mode, LRU size, lattice accuracy, overlay delivery: answered by the user on 2026-11-11.

## Verify

Filled by the orchestrator.

## Report

Filled by the orchestrator.
