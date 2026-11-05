# T21. Baggage network and carousels

Milestone M5. Roadmap line: "Simple baggage network (belts with capacity and transit time) and carousels".

## Goal

Bags move through an abstract network: departure bags from check in and bag drop through belts and sorting to the aircraft; arrival bags from the aircraft to a carousel. Saturation queues bags and can miss the cut off.

## Read first

* `docs/GAME_DESIGN.md` section 10 "Check in and baggage", and the carousel row of the fixtures table in section 8.
* The current `belt` fixture in `src/shared/business.ts` and how it adds arrival capacity in `business.ts`.
* T14 and T20 cohorts (they carry `bags`), T22 turnaround tasks (loading and unloading need bags ready).

## Design (decided)

* A baggage graph per terminal built from belt fixtures: segments with capacity (bags per minute) and transit time, joined where belt cells touch; check in and bag drop feed in; a sorting node with a processing rate; makeup positions feed aircraft; carousels hold up to 60 bags.
* Bags are counted per flight and segment (aggregated counts in typed arrays), not individual objects.
* Bag cut off: bags not at makeup by departure minus a cut off from data miss the flight and count as mishandled.

## Requirements

* R1. The graph, counts, rates and cut off as above, data in `business.json` with schema.
* R2. Departure loading in the turnaround waits for the flight's bags at makeup (or the cut off).
* R3. Arrival unloading feeds the assigned carousel at an unload rate per bag; claim cohorts (T20) leave when their flight's bags are on the carousel.
* R4. A baggage load overlay or inspector numbers: bags queued per segment.
* R5. Tests: throughput limited by the slowest segment; saturation causes missed bags; conservation of bags.
