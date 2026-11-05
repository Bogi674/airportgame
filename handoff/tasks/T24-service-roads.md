# T24. Service points, docking poses, service roads and apron lanes

Milestone M5. Roadmap line: "Service points per type, docking poses, service roads and apron lanes with reservations". Confirm the plan with the user before coding: it adds a build tool.

## Goal

Vehicles drive from a GSE depot along service roads and per stand apron lanes to fixed docking poses at each type's service points, with reservations like taxiing, instead of appearing beside the aircraft.

## Read first

* `docs/ARCHITECTURE.md` section 6 (all), `docs/GAME_DESIGN.md` section 10 "Ground handling" and section 6 tools list (service road, GSE depot).
* `docs/ART_AND_ASSETS.md` sections 4.8 (service points) and 9.2 (contact stands: the service road at the head of stand).
* `src/sim/airfield/network.ts` (copy the graph, sample and reservation structure at a smaller scale), `src/sim/vehicles/gse.ts`.
* `src/render/markings/standPaint.ts` (where the head of stand road is painted today).

## Design (decided)

* Service points per MVP 1 type in the aircraft JSON (`servicePoints`: id, local x and y in meters, side), from the type's door and cargo stations; the data note names the source.
* Docking poses per vehicle kind and service point in `gse.json`: offset and heading relative to the point.
* A service road graph in the sim, separate from the taxi network: head of stand roads generated from stands (they are painted already), player built service roads (new tool, a polyline like taxiways, 7 m wide, no fillets needed), and a GSE depot building (new placeable, a rectangle) where vehicles start and park.
* Apron lanes per stand: short generated paths from the head of stand road to each docking pose.
* Vehicles route with A* on the road graph when a task starts (never per tick) and reserve road segments like aircraft blocks, at lower speeds from `gse.json`. Crossing a taxiway reserves the crossing and yields to aircraft.

## Requirements

* R1. Service points and docking poses in data with schemas, for every MVP 1 type and GSE kind in use.
* R2. Service road tool and GSE depot placement, with costs in data, undo, saves.
* R3. The road graph with reservations; vehicles drive depot to stand to depot.
* R4. Taxiway crossings yield to aircraft.
* R5. Tests: a vehicle reaches its pose and its heading matches; two vehicles never share a road segment in opposite directions; an aircraft crossing blocks vehicles; determinism.
* R6. Stress: vehicle subsystem stays within budget for the large scenario (900 units budget; report counts).

## Out of scope

Trailers (T25), collision checks (T26).
