# T78 Baggage follow up

## Goal

Bags travel between the terminal and the aircraft on tractor trains that load and unload at bay slots, bays join the service road graph, old belts become carousels, and the player sees the baggage network load in an overlay.

## Read first

`docs/BAGGAGE.md` sections 3.4, 4.5 to 4.7, 6, 7, 10 and 11. `handoff/QUESTIONS.md`, entry 2026-11-22 T78. `src/sim/vehicles/gse.ts`, `src/sim/vehicles/roads.ts`, `src/shared/roadGraph.ts`, `src/sim/ops/baggage/baggage.ts`.

## Decisions

See the 2026-11-22 T78 entry in `handoff/QUESTIONS.md`.

## Requirements

1. Carousels come in sizes S, M and L with footprint, capacity and sprite from data. The bay `widthCells` field carries the carousel width in cells. Saved carousels load as M.
2. Each bay has a road connection point in world space. The road tool snaps to it, the road graph puts a node there, and a bay is connected when a depot reaches that node.
3. The bay inspector and the stand inspector show Not connected to a service road when the bay is not connected.
4. A trip is possible for a stand when its bay is connected, a depot reaches the bay and the bay reaches the stand by road. Without a trip the stand's departure and arrival bags count as missing.
5. Arrival train: the crew tractor and its carts leave the stand when the unload task ends, drive the road to the bay, turn and reverse into a free slot, unload at `loadSecondsPerBag`, and the bags enter the bay. Then it drives home to the depot.
6. Departure train: once unload is done and the flight's bags are ready, a train leaves the depot, loads its bags at a bay slot at `loadSecondsPerBag`, drives to the stand and docks; the load task runs, and the train leaves with the crew.
7. A slot holds one train. A train with no free slot waits at the connection point.
8. Vehicles on trips, the trip state and carousel sizes are saved. Save version bump with a migration.
9. Legacy belts convert on load to the largest carousel that fits at the belt's anchor; a belt that cannot convert stays and shows a warning.
10. Baggage load overlay: link bands colored by load, solid chevrons for departures and hollow for arrivals, still and grey when idle, buffer rings on nodes, back pressure markers, a legend.
11. Alerts of `docs/BAGGAGE.md` section 6.2 that have a place today: inspector chips and toasts. The alert center arrives with T36.
12. `npm run stress` gets a busy baggage scenario with 50 aircraft.
13. Playwright visual tests for the ramp stub at tiers 1 to 3.

## Acceptance

* A determinism test runs a full baggage chain with trains for 2 000 ticks twice with the same hash.
* A save in the middle of a trip loads with the same hash.
* A bay with no road reports Not connected and its flights report missing bags.
* An old save with a belt loads a carousel where it fits.
* The overlay shows the chain load in the dev build.
