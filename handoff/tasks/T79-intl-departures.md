# T79 International departures through passport control

## Goal

Departing passengers of an international flight queue at a passport booth or eGate set to departure mode after security, then dwell and board in the International zone. International flights exist only once the airport has the full international flow.

## Read first

`docs/TERMINAL_ZONING.md` sections 3 and 6, `src/sim/cohorts/cohorts.ts` (immigration as the model), `src/sim/market/market.ts`, `Business.arrivalEntry`.

## Decisions (owner, 2026-11-22)

1. No international flights until the international flow is built. Built means, in one terminal with a curb: a gate desk in an International zone, a passport booth or eGate in departure mode, one in arrival mode and a customs channel, each reachable on foot along the journey.
2. Enforcement: airlines offer no international series while the flow is missing. Signed international series are cancelled on every day the flow is missing at the daily close, with a notice, and each cancelled flight costs the airline happiness (`cancelledFlight` in `market.json`).
3. Service times are the arrival values, stored as their own departure entries in `src/data/departures.json`: passport desk 45 s, eGate 20 s with 8 percent referred to an officer, families use desks.
4. Placement keeps the zoning rule: a departure booth has its entry on Secure and its exit on International. An international departure walks from security straight to the cheapest departure booth, then dwells in the International zone.

## Requirements

1. Departing cohorts of an international flight carry the international flag.
2. After security an international cohort walks to the cheapest passport booth or eGate in departure mode (walk time plus wait), queues, is served, and becomes airside. An eGate may refer it to a desk.
3. With no departure booth (the flow was removed during the day) the cohort skips passport control.
4. Rebuilds and evictions keep the new stages consistent, as for immigration. New stages are appended to `Stage`.
5. `Business.internationalReady()` answers requirement 1 of the decisions, cached per walk and service version.
6. The market filters international destinations from new offers while not ready, cancels international flights at the daily close and in same day placement while not ready, and emits `intlFlowMissing`.
7. Strings for the new notice.

## Acceptance

* An international departure queues at a departure booth after security and never before; a domestic one never queues there.
* With an eGate, about 8 percent of cohorts are referred to a desk; families use desks.
* Without the full flow no offer goes to an international destination and signed international flights do not spawn.
* Determinism test: 2 000 ticks twice from one seed with the international layout, identical hashes.
