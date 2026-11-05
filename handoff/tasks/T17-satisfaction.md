# T17. Satisfaction and airport rating

Milestone M4. Roadmap line: "Satisfaction and airport rating (rating from on time share, satisfaction, facilities and infrastructure)".

## Goal

Each cohort's satisfaction follows the formula in `docs/GAME_DESIGN.md` section 8, and the airport rating uses the trailing 30 day average of it.

## Read first

* `docs/GAME_DESIGN.md` section 8 "Dwell, spend and satisfaction" (the formula), section 12 and section 13.
* `src/sim/business/business.ts`: how the rating is computed today (search `rating`).
* T14 cohorts and profiles.

## Requirements

* R1. Satisfaction per cohort, updated at stage changes: queue wait times the profile's patience weight, walking distance over a comfort distance times the walk weight, delay minutes times the delay weight, missed flight minus 40, plus bonuses (comfort from seating near the gate, cleanliness from staffing, shop variety, wayfinding). Clamp to 0 to 100.
* R2. All weights in `src/data/profiles.json` or a `satisfaction` block, with a source note. Values the docs do not give go to `handoff/QUESTIONS.md` first.
* R3. The airport rating keeps its existing parts and replaces its satisfaction input with the trailing 30 day average of boarded and arrived cohorts' satisfaction, weighted by cohort size.
* R4. The finance sheet or a rating panel shows satisfaction and its main penalties ("Queues at security cost 12 points").

## Tests

Hand computed satisfaction for a cohort with known waits and walks. The 30 day window drops old days. Rating rises when queues vanish in a scripted run.
