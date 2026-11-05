# T28. Staff sprites

Milestone M5. Roadmap line: "Staff sprites for check in, security, ground handler, marshaller, cleaner".

## Goal

The five MVP 1 staff roles appear at their posts, drawn from the people atlas (T15) with the uniforms of `docs/ART_AND_ASSETS.md` section 6.3.

## Read first

* `docs/ART_AND_ASSETS.md` section 6.3, `docs/art/people_sheet.png`, `docs/reference/sprite-prototypes/people2.py` (staff recipes).
* T15's atlas and `src/data/people.json`.
* Where staff counts live today (`staffCount` in `business.ts`).

## Requirements

* R1. Recipes for security officer (two variants), check in agent, ground handler, marshaller, cleaner in `people.json`, baked into the atlas.
* R2. Posts: one check in agent per staffed desk, security officers per lane, ground handlers at docked aircraft (from T22 tasks), a marshaller at a contact stand while an aircraft docks, cleaners walking airside floors. Positions are render side samples derived from sim state, never sim state themselves.
* R3. Visual check against the people sheet.
