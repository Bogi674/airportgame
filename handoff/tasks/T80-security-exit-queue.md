# T80 Security exit throughput as a queue

## Goal

Security exits stop being free walk through transitions. Each exit anchor becomes a service node with a rate by level, so domestic arrivals queue at a busy exit between the gate and the baggage claim.

## Read first

`docs/TERMINAL_ZONING.md` sections 3 and 6, `src/sim/terminal/serviceNodes.ts`, the customs stages in `src/sim/cohorts/cohorts.ts`, the version 30 to 31 migration in `src/sim/save/migrations.ts`.

## Decisions (owner, 2026-11-22)

1. Only domestic arrivals queue at a security exit. Missed departures keep leaving the terminal as today.
2. No officer is needed at any level in T80. Staffed exits move to T81.
3. Rates as accepted on 2026-11-18: staffed 1 200 per hour, automated lane 900 per hour, revolving door 1 500 per hour, one server each (3 s, 4 s and 2.4 s per person).
4. Save format 34 with a migration.

## Requirements

1. `securityExit` is appended to `SERVICE_KEYS`; its timing comes from `arrivals.json` by the fixture level.
2. Two appended stages, `ToSecExit` and `SecExit`. A domestic arrival leaves the aircraft, walks to the cheapest exit by walk time plus wait, queues, is served and stands on the first cell past the exit along its flow, then goes to the claim.
3. A grid with no exit the cohort can reach skips the step, as customs does.
4. Evictions, service table rebuilds, grid removal, the overlays and the people sample treat the new stages like customs.
5. The migration to 34 inserts an empty service row per exit anchor in cell order and remaps saved cohort node indices.

## Acceptance

* In the arrival hall every domestic cohort passes `SecExit` before the claim, international cohorts never do.
* A level 2 exit serves slower than a level 3 exit.
* A version 33 save with a cohort queued loads, keeps its queue and replays to the same hash as a fresh restore.
* Determinism: 2 000 ticks twice from one seed with exits give identical hashes.
