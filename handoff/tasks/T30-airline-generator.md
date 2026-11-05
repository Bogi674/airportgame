# T30. Airline generator

Milestone M6. Roadmap line: "Airline generator for regional and national scopes per `docs/AIRLINES.md`, limited to released aircraft".

## Goal

Airlines are generated from the seed per `docs/AIRLINES.md` for the regional and national scopes, with fleets drawn from MVP 1 aircraft, fleet ratings, and the decision rules that make them sign, grow or leave. The seven hard coded airlines go away.

## Read first

* `docs/AIRLINES.md`, all ten sections. Section 10 gives the JSON shape.
* `docs/GAME_DESIGN.md` section 12.
* `src/sim/business/business.ts`: the current airlines (`airlines`, `mk`, `signAirline`, `assignedTypes`) and `src/data/business.json` `airlines`.
* `src/ui/Sheets.tsx`: the airlines sheet.

## Requirements

* R1. A world airline pool in `src/data/airlines.json` with schema, in the shape of section 10, holding invented names only, like the current airlines. No real airline names, logos or liveries.
* R2. `src/sim/market/airlines.ts`: generation per section 5 from a forked RNG stream, scopes per section 2 limited to regional and national, fleets from aircraft with `release: mvp1`, ratings per section 3, compatibility tests per section 5.
* R3. Judging the airport per section 7 and requirements per section 8: an airline offers a contract only when the airport meets its scope and rating requirements; the airlines sheet shows what is missing.
* R4. Save format bump; migration turns the old seven airlines into generated equivalents or keeps their contracts.
* R5. Tests: same seed gives the same airlines; every fleet type is MVP 1; requirements block and unblock offers; determinism.
