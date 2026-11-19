# T20. Arrival journey

Phase 3, roadmap row T20: "Arrival journey with immigration (passport control or automated gate in arrival mode), baggage claim and the customs channel (`docs/TERMINAL_ZONING.md` section 3)". Depends on T67, T43 and T75, all done. Branch `track/t54`. Save version 30 to 31.

## Goal

Arriving passengers leave the aircraft as cohorts with seeded members, enter the terminal at the gate desk of their stand, pass immigration (passport control or an automated passport gate set to arrival mode) when the flight is international, wait at the carousel of their stand's bay until their flight's bags arrive, pass the customs channel when international, and leave through the curb door. Members are rated with the T67 rules plus claim wait and missing bags, and their satisfaction rolls into the same 30 day ring. The aggregated arrival capacity cap at docking is removed.

## Read first

* `docs/TERMINAL_ZONING.md` sections 2, 3 (transitions; customs is a node inside Public between claim and the landside hall), 4 (passengers walk transition edges only in their direction) and 6 (customs channel values).
* `docs/BAGGAGE.md` sections 4.4 (arrival bag routing), 4.5 (carousel), 4.6 (claim wait from doors open to the first bag on the carousel; missing bags lower satisfaction) and 11.
* `docs/DESIGN_REVISION_4.md` sections 4 (deboarding is a turnaround task) and 6.1 to 6.3 (cohort substrate, member traits, satisfaction per member).
* `docs/GAME_DESIGN.md` section 8 "Passenger journey" (arrival order: aircraft, gate, immigration if international, baggage claim, customs if international, landside exit).
* `docs/ARCHITECTURE.md` section 8 and the T54, T75 and T67 lines of section 12.
* `src/data/fixtures/catalog.json` stats of `eGate`, `customs` and `passport.l1` (read only, generated file).
* `handoff/QUESTIONS.md` "2026-11-18 phase 3 run" (international per destination, 35 percent, Confirm values accepted, proposals reported).
* `handoff/BACKLOG.md` T75 customs entry. `handoff/PITFALLS.md` 2, 5, 6, 8, 10, 11, 23, 25, 26, 27.
* Code: `src/sim/cohorts/cohorts.ts`, `src/sim/cohorts/traits.ts`, `src/sim/terminal/serviceNodes.ts`, `src/shared/terminalZones.ts`, `src/sim/ops/baggage/baggage.ts`, `src/sim/business/business.ts` (onDocked, arrCapacity, gateFor, curbNode), `src/sim/market/destinations.ts`, `src/sim/market/market.ts`, `src/sim/sim.ts` (traffic hooks, boardingMode), `src/sim/save/migrations.ts`, `scripts/stress.ts`.

## Decisions

* D1. A flight is international when the destination of its flight series is (QUESTIONS 2026-11-18). Each generated destination carries `international`, drawn on its own fork `destinationsIntl` in id order with the share `market.json destinations.internationalShare` = 0.35, so names, distances and the series stream do not move. Flights without a series (test flights, GA) are domestic. Destinations stay unsaved and are rebuilt from the seed (DR4 3.4).
* D2. Departures are unchanged in T20. International departures through passport control in departure mode get a new roadmap row; they are not in the T20 row.
* D3. Arrival cohorts are generated when the aircraft docks, from the passengers the business counts at docking, with the departure profile mix and group sizes (DR4 6.1) on a separate rng fork `arrivals`, so the departure cohort stream keeps its draws. Members are seeded with `initMembers` (T67). Needs do not grow or act on arrivals (T67 scope: needs act only airside before departure).
* D4. Deboarding (DR4 section 4): doors open `doorOpenS` after docking. Cohort k leaves at doors open plus the passengers ahead of it times `deboardSecondsPerPax`, divided by the door count of the type (`standGeometry(AIRCRAFT[type]).doorStationsM.length`, at least 1). A stand that boards by bus adds `remoteBusS` (interim until bus trips exist); a far stand without a bus bay stretches deboarding by `STAND_ACCESS.farBoardingSlowdown`, the rule boarding uses (T66).
* D5. Entry point: the gate desk that boards the stand (`Business.gateFor`) when its effective zone is International for an international flight or Secure for a domestic one; otherwise the gate desk in the right zone of the lowest grid index, lowest node index. A flight with no such desk in a grid with a curb loses its passengers (`lostToday`) and emits `arrivalNoGate`. International flights at an airport with no International gate desk: see Q1; the default coded is the domestic route with an `intlNoImmigration` alert.
* D6. Immigration: passport control or an automated passport gate with `fixtureMode` 1 (arrival), picked like other service nodes by walk time plus wait. The walking graph already forces the International to Public crossing through them (T75). Families never use automated gates (catalog `childrenUnder` 12). A cohort sent from an automated gate to an officer (catalog `referralShare` 0.08, a pure draw from its recipe seed, no rng) then queues at a passport booth in arrival mode.
* D7. Customs is a service node inside Public (TERMINAL_ZONING section 3), the `customs` fixture as T75 places it (2 by 2 cells, Public only). Green channel 8 s with 2 servers (catalog staff 2); a cohort whose recipe seed draw is below `redShare` 0.05 then stands `redServiceSeconds` 120 at the node. International cohorts in a grid with no customs node skip it. This closes the T75 BACKLOG entry.
* D8. Security exits stay walk transitions with no queue in T20: domestic arrivals cross them on their walk. Exit throughput is left to a later row.
* D9. Baggage claim (BAGGAGE 4.4, 4.6): the claim point is the carousel the stand's bay feeds, in the cohort's grid. The baggage subsystem records per flight serial the tick its first batch reached a carousel (a ring of 64 rows like the missing bag rows, saved and hashed). Cohorts with bags wait at the carousel until that tick exists, waking every `claim.pollS`; cohorts without bags walk past the claim. After `claim.giveUpMin` from doors open a waiting cohort leaves without bags and each member loses `missingBagPoints`. No carousel for the stand in the grid: the cohort skips the claim and takes the missing bag points at once. Claim wait over patience costs points by the T67 queue rule.
* D10. Exit and outcomes: a cohort that reaches the curb node is rated (`rollUp` with missed false) and counted `arrExited`. A cohort whose next node is missing or unreachable retries; once `strandedMin` passed since doors open it takes `strandedPoints`, is rated, counted `arrStranded` and freed. Demolishing its grid strands it at once. Departure counters (`generated`, `boarded`, `missed`, `active`) are untouched; arrivals keep `arrGenerated = arrExited + arrStranded + arrActive`.
* D11. New stages are appended after Rejoin 14 (saved order): Deboard 15, ToImmigration 16, Immigration 17 (queued), ToClaim 18, Claim 19, ToCustoms 20, Customs 21 (queued), CustomsRed 22, ToExit 23. Free means gone. Flag bits appended: `FLAG_INTL` 8, `FLAG_REFERRED` 16. New slot arrays `serial` (Int32, flight serial, since flight indexes are reused) and `born` (Int32, doors open tick).
* D12. `SERVICE_KEYS` appends `eGate` and `customs`; their timing comes from `arrivals.json service`. Saves made before 31 with those fixtures placed get empty node rows inserted in cell order by the migration, so `serviceLoad` keeps every queue.
* D13. The docking cap `arrCapacity` and its payload field go (draft R4). Carousel and belt counts still drive the `noBelt` readiness check. Tests that asserted `arrCapacity` are rewritten to assert the new rule; none is deleted.
* D14. The people sample draws arrival walkers and claim and red channel dwellers. Arrival stages skip the zone check of the sample because one walk crosses from airside to Public.
* D15. Every T20 number lives in `src/data/arrivals.json` (new, strict schema) or `market.json`. Values no doc gives are orchestrator proposals reported to the owner (QUESTIONS 2026-11-18 rule): `doorOpenS` 180, `deboardSecondsPerPax` 2.5, `remoteBusS` 480, `strandedMin` 60, `claim.pollS` 30, `claim.giveUpMin` 45, `missingBagPoints` 20 (the `missingBagWeight` BAGGAGE section 11 leaves to be proposed), `strandedPoints` 40 (equal to a missed flight). From the catalog or docs: eGate 20 s, 1 server, referral 0.08, families excluded; customs 8 s, 2 servers, red 0.05 for 120 s; international share 0.35; passport 45 s from `business.json`.

## Open question

* Q1. An international flight at an airport with no gate desk in an International zone: the default coded in slice 4 lands its passengers at the domestic gate; they walk the domestic route with no immigration or customs and the flight emits `intlNoImmigration` once per docking. The alternative loses those passengers like a flight with no terminal. Owner to confirm; the switch is one branch in `Business.arrivalEntry`.

## Requirements

* R1. `arrivals.json` with a strict zod schema exported as `ARRIVALS`; `market.json destinations.internationalShare`; data tests for both.
* R2. Destinations carry `international` (D1); `Market.isInternational(f)` answers from the flight's series without allocation.
* R3. `eGate` and `customs` are service nodes with data timing (D12).
* R4. Save version 31 with a migration that inserts empty service rows for eGate and customs anchors and documents the optional cohort and baggage fields; older saves load with every queue kept.
* R5. `Business.arrivalEntry(f)` implements D5 with Q1's default; `onDocked` serves `paxFor(f)` when an entry exists, else loses them with `arrivalNoGate`; `arrCapacity` is removed (D13).
* R6. Cohorts generate arrivals at docking (D3, D4), walk Deboard to ToExit, rate and count exits and strands (D10), stay out of pushback and boarding counts, and save, load and hash every new field.
* R7. International cohorts pass immigration per D6, with eviction, node renumbering and queue penalties like departures.
* R8. Claim per D9, with the baggage delivery rows saved and hashed.
* R9. Customs per D7, then the exit.
* R10. The people sample shows arrival walkers, queues at immigration and customs, and dwellers at the carousel and the red channel (D14).
* R11. Stress: medium and people20k stay under 4 ms with arrivals running; the report prints the arrival peak.
* R12. UI: the finance sheet shows yesterday's arrivals (exited, stranded, mean claim wait, passengers without bags); the flights board marks international flights; the terminal panel line that showed arrival capacity shows the arrivals of yesterday; `arrivalNoGate` and `intlNoImmigration` have strings.

## Acceptance criteria

* An international flight in the arrival test terminal produces cohorts that queue at an arrival mode passport booth or eGate, wait at the carousel until the flight's bags arrive, pass customs and exit at the curb; a domestic flight's cohorts visit neither immigration nor customs.
* Families never queue at an eGate; a referred cohort queues at a passport booth after the eGate.
* Conservation every 50 ticks over 8 000 ticks: `arrGenerated === arrExited + arrStranded + arrActive`, and the departure identity still holds.
* Determinism: 2 000 ticks twice from one seed with an international and a domestic arrival give identical state hashes; a save in the middle of the journey (one cohort queued at immigration, one waiting at claim) restores to the same hash after 2 000 more ticks.
* A version 30 save with an eGate and a customs fixture and a queued departure cohort migrates to 31 and keeps that queue.
* Claim wait and missing bags change member satisfaction by hand computed amounts; a stand with no carousel gives the missing bag points.
* The arrival cap is gone: passengers served at docking equal `paxFor` when an entry exists.
* `npm run verify` passes, stress medium and people20k under 4 ms with no subsystem regression over 10 percent, baseline untouched.
* Screenshot of the arrival scenario shows walkers in the International hall, queues at immigration and customs and dwellers at the carousel.
