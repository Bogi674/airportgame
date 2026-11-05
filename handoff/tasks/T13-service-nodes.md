# T13. Service nodes and queues

Milestone M4. Roadmap line: "Service nodes and queues (a terminal load model replaces queues)".

## Goal

Every serving fixture (check in, kiosk, bag drop, security lane, passport booth, gate desk, toilets) is a service node with servers, a seeded service time distribution, a queue capacity and a queue area, ready for cohorts to join.

## Read first

* `docs/ARCHITECTURE.md` section 7 (service nodes) and section 8.
* `docs/GAME_DESIGN.md` section 8 (fixtures table) and section 10 (check in and baggage).
* `src/sim/business/business.ts`: the current load model (`depCapacity`, `arrCapacity`, `updateServiceLevel`).
* `src/sim/rng.ts` (forking streams), T12's walking graph.

## Design (decided)

* Typed arrays per building: `svcKind`, `svcServers`, `svcMeanS`, `svcQueueLen` (people waiting), `svcQueueCap`, `svcBusyUntil` per server slot, `svcNode` (walking graph node).
* Service times: lognormal with the table mean and a coefficient of variation from data (start with 0.4), drawn from a forked RNG stream `service`.
* Queues hold cohort ids in ring buffers (typed arrays) per node; a cohort occupies servers for `size * serviceTime / servers`.
* Queue capacity from the queue area: cells of the zone in front of the fixture times a density from data (people per m²). Overflow blocks upstream (cohorts wait at the previous node).
* The aggregated load model stays until T14 switches departures to cohorts; then remove it in T14, not here.

## Requirements

* R1. Service nodes are created from fixtures whenever terminal grids change (at command time).
* R2. An API used by T14: `join(node, cohort)`, `update(tick)` advancing service, `waitEstimate(node)` in seconds.
* R3. Data in `business.json` (coefficient of variation, queue density) with schema.
* R4. Tests with synthetic cohorts: throughput of a security lane matches about 300 people per hour (`docs/GAME_DESIGN.md` table) within 10 percent over a simulated hour; queue overflow stops joins; determinism.

## Out of scope

Cohort journeys (T14), queue rendering (T16).
