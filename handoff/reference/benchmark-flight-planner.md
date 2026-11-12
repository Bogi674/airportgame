# Benchmark notes: the Airport CEO flight planner

Our own summary of the planner mechanics, from the community wiki text and a screenshot the user supplied on 2026-11-12. Mechanics only. The screenshot is not stored in this repository. Revision 4 section 3 and the T61 spec use these notes.

## Layout

* One row per stand, a 24 hour timeline with hour columns, and tabs for today and the next six days.
* A side panel lists signed airlines. Each airline shows its placed and total flights (for example 41 of 50) and how many still wait to be placed. Clicking an airline lists its unplaced flights.
* Filters by stand size. Stand rows show their name, international flag and a settings button.
* Header shows flight capacity used against the limit, the auto planner switch, its mode (for example prompt before placing) and a turnaround buffer slider (for example 20 minutes).
* A red line marks the current time; the past is not editable.

## Placing

* Drag a flight onto a stand row at a time. A confirmation locks it in place unless the contract breaks.
* Each flight block shows its number, the airline brand, the fee and a number of consecutive days. The flight is placed at the same time on that many consecutive days starting from the drop day, and only fits if every one of those days is free. After placing, each day can be moved or cancelled on its own.
* A single flight cannot be placed more than six days ahead.
* Lead time: at least 1 hour from now on small stands, 3 hours on large stands; the wiki also says flights must be planned 3 hours ahead.
* Curfew: no landing before 05:00 and no departure after 22:00 without the night flights research.
* A tower is required to schedule flights and to accept GA.
* Remote stands add 45 minutes to the block for travel time.

## Auto planner

* Places flights automatically once unlocked (by hiring board members in that game). Can ask before placing.

## Differences to weigh for revision 4

* Frequency there is a count of consecutive days from the drop day; revision 4 drafted a weekly frequency on chosen days. Decision batch item D9 must pick one.
* Curfew, lead time and a buffer slider are missing from the draft and join the decision batch.
