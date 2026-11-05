# T09. Junction priority

Milestone M3. Roadmap line: "Reservations, following gaps, junction priority, holding points, runway exclusivity with wake separation". Everything but junction priority works; today it is first come, first served.

## Goal

When several aircraft want the same junction, the order is: aircraft vacating a runway, then arrivals, then departures, then by request time (`docs/ARCHITECTURE.md` section 5.4).

## Read first

* `docs/ARCHITECTURE.md` sections 5.4 and 5.5.
* `src/sim/ops/traffic.ts`: `tryEnter`, `nodeOwner`, `waitingFor`, `detectDeadlocks`, the states in `AcState`.
* T08's conflict sets.

## Design

* A request table per junction node: when an aircraft is within its lookahead of a junction and cannot yet enter, it records `(priority class, request tick)` in typed arrays `reqClass[i]`, `reqTick[i]`, `reqNode[i]`.
* Before granting node `n` to aircraft `i`, check that no other aircraft with a better `(class, tick)` is requesting `n` and could enter now. If one is, `i` waits.
* Priority class from state: vacating a runway (exiting, first edge after the runway) 0, arrivals taxiing in 1, departures 2, push backs 3.
* Ties broken by request tick, then aircraft index, so the order is deterministic.

## Requirements

* R1. The order above, with typed arrays and no allocation per tick.
* R2. Aircraft waiting for priority show in the traffic overlay like other waiting aircraft.
* R3. The deadlock detector treats priority waits as edges of the wait graph.
* R4. Tests: an arriving and a departing aircraft reach one junction together, the arrival goes first; an aircraft vacating the runway beats a taxiing arrival; equal classes go by request tick.
* R5. Determinism test (recipe R9) and stress before and after.

## Out of scope

ATC options like departure metering (MVP 2).
