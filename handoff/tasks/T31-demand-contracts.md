# T31. Route demand, seasonal slots, contracts

Milestone M6. Roadmap line: "Route demand, seasonal slot requests, contracts with basic fees".

## Goal

Airlines choose routes by demand, request slots each season, and sign contracts with landing and passenger fees, replacing the rotations per day model.

## Read first

* `docs/AIRLINES.md` sections 6 and 9, `docs/GAME_DESIGN.md` sections 12 and 13.
* T30's airline module, `src/sim/business/business.ts` (contracts, `setSlot`, `setFee`, revenue), `src/ui/Sheets.tsx` (flights board, airline sheet).

## Requirements

* R1. Route demand from the city (`site.city`) and invented destinations in data, by scope and season.
* R2. Seasons from the game calendar (data: season start dates); slot requests at each season start; the player accepts, moves or refuses slots in the airline sheet.
* R3. Contracts per section 9 with basic fees (landing per tonne, passenger fee); revenue booked in the daily finance close.
* R4. Flights generated from accepted slots replace the rotations model; remove `rotations` once migrated (save format bump).
* R5. Tests: demand responds to rating; a refused slot produces no flights; fees appear in the ledger; determinism.
