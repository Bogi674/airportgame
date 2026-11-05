# T14. Cohorts and the departure journey

Milestone M4. Roadmap line: "Cohorts and the departure journey from curb to aircraft". This is the largest M4 task. Confirm the plan with the user before coding.

## Goal

Departing passengers exist as cohorts that arrive at the curb on a time distribution by profile, walk the walking graph, queue at service nodes, dwell airside, and board their aircraft. Departures that run out of time miss the flight. The aggregated departure capacity model is replaced.

## Read first

* `docs/ARCHITECTURE.md` section 8 and hard rules 5 and 6.
* `docs/GAME_DESIGN.md` section 8 (journey, dwell, profiles) and section 12.
* `docs/PERFORMANCE.md` (cohort budgets: 2 000, 20 000, 100 000).
* T12 and T13 code. `src/sim/ops/traffic.ts`: how a flight reaches `OnGround`, turnaround timing, and boarding (search `updateTurnaround`).
* `src/sim/business/business.ts`: passengers per flight, `depCapacity`, revenue per passenger.

## Design (decided)

* `src/sim/cohorts/cohorts.ts`: struct of arrays with capacity from data (200 000): `flightId`, `size`, `profile`, `stage`, `node`, `timer`, `bags`, `spendBudget`, `satisfaction`, `recipeSeed`, `flags`, plus `building`. A free list, no allocation per tick.
* Profiles in `src/data/profiles.json` (new, with schema): `business`, `leisure`, `family`, `budget`, `premium`, `crew`, each with arrival time before departure, walk speed, patience, spend budget, bags. Values from section 8 where given; ask the user for the rest.
* Generation: when a departing flight is scheduled, its passengers split into cohorts of 1 to 6 by profile mix, with curb arrival times drawn from the profile's distribution (seeded stream `cohorts`).
* Stages: `curb`, `toCheckIn`, `checkIn`, `toSecurity`, `security`, `airside` (dwell, later shops), `toGate`, `gate`, `boarded`, `missed`. Walking takes `distance / walkSpeed`; nodes from T13.
* Boarding: the aircraft cannot finish its turnaround until boarded cohorts reach its seat count or the boarding window closes; missed cohorts count against satisfaction (T17).
* Cohort update runs in its own subsystem slot in `Sim.runSubsystem`, after business, and only touches cohorts whose timer expired (a bucketed timer wheel keyed by tick).

## Requirements

* R1. Data, generation, stages and boarding as above.
* R2. Remove the aggregated departure capacity once cohorts work; keep arrivals aggregated until T20.
* R3. Revenue and passenger counts come from boarded cohorts.
* R4. Save and load cohorts (typed arrays packed like traffic); save format bump.
* R5. Snapshot: a sample of up to the render cap of cohort positions for T15 (position from node and stage).
* R6. Tests: a flight's cohorts all board when the terminal is adequate; with one check in desk and a full flight, some miss; cohort counts conserved (generated = boarded + missed + active); determinism; save and restore mid journey.
* R7. Stress: add cohorts to the medium scenario and stay under 4 ms (T18 adds the 20 000 cohort scenario).

## Out of scope

Shops spending (T32), arrivals (T20), transfers (MVP 2).
