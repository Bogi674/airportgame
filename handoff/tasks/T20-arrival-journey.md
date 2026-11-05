# T20. Arrival journey

Milestone M5. Roadmap line: "Arrival journey with immigration, baggage claim and customs".

## Goal

Arriving passengers leave the aircraft as cohorts, walk to immigration when international, wait at baggage claim for their bags, pass customs when international, and exit landside. The aggregated arrival capacity model is replaced.

## Read first

* `docs/GAME_DESIGN.md` section 8 (arrival journey) and section 10 (baggage).
* T14's cohort code and its stage machine; T13 service nodes; T11 passport booth.
* `src/sim/ops/traffic.ts`: when a flight docks and when deboarding happens.
* How flights know domestic or international today (search `international` or the airline scope in `business.ts`). If nothing marks a flight international, ask the user how to decide it before coding.

## Requirements

* R1. Arrival cohorts generated at docking from the flight's passenger count and profile mix, with stages `deboard`, `toImmigration`, `immigration`, `toClaim`, `claim`, `toCustoms`, `customs`, `exit`, `gone`.
* R2. Deboarding takes time per door and passenger from data; contact stands walk through the bridge, remote stands use a bus delay until T23 adds buses.
* R3. Claim waits until the cohort's bags arrive (T21 provides bag arrival times; until then use a data driven fixed unload time and record it as interim).
* R4. Remove the aggregated arrival capacity (`arrCapacity`) once arrivals use cohorts.
* R5. Satisfaction (T17) counts arrival waits.
* R6. Tests: conservation of passengers, international cohorts visit immigration and customs and domestic ones do not, determinism, save and restore mid journey.
