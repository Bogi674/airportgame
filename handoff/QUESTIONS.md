# QUESTIONS.md

Design questions for the user. Add a question here, then ask the user and wait. Never guess a gameplay rule.

Format:

```
## <date> <task id>: <short question>

Context: what the spec and docs say, and where they are silent or disagree.
Options: A ..., B ..., with the consequence of each.
Recommendation: the option you would pick and why.
Answer: (the user's answer, filled in when given)
```

## 2026-11-05 T39: turn pad work stopped

Context: The user saw the T39 revision 2 turn pad screenshots and rejected the look (curve crowding the taper, pavement detail missing). Three preview concepts were drawn, none accepted.
Options: A keep the turn pad work and continue iterating, B freeze the code and file a rework task, C revert the T01 and T39 commits.
Recommendation: B, because a revert touches save data and the sim for no player gain right now.
Answer: B (2026-11-05): freeze it, no more work. No new task file was added; the pad stays as it is on glm/mvp1.

## 2026-11-05 T40: airport class system and the ATC tower

Context: The user asked for "ATC is a dedicated building you can build as a standalone building, anywhere within airport perimeter, upgradeable along with airport class system". The docs define five progression stages in GAME_DESIGN.md section 15 (Regional strip, Domestic airport, Regional international, Major international, Hub) and ATC in GAME_DESIGN.md ATC section (tower capacity from controllers on shift and movements per hour each, plus options that are MVP 2). No "airport class" exists anywhere in the docs or code. Today ATC is a 4 cell control room fixture inside a terminal, within 3.5 km of every runway midpoint, or no airline schedules flights (ARCHITECTURE.md 2026-11-04).
Options: A use the five stages as the upgrade ladder, B invent tower levels separate from stages.
Recommendation: A, because it reuses documented progression and needs no invented second track.
Answer: A (2026-11-05): standalone tower plus the five existing stages.

## 2026-11-05 T40: what an ATC upgrade changes

Context: GAME_DESIGN.md ATC section has tower capacity (controllers per shift times movements per hour), sequencing options, radar and low visibility procedures. Most of that is MVP 2 in ROADMAP.md line 155.
Options: A upgrade changes capacity plus unlocks scheduling tools and operating hours, B capacity only.
Recommendation: B, because options and staffing are MVP 2 and capacity is the smallest honest MVP 1 effect.
Answer: B (2026-11-05): capacity only.

## 2026-11-05 T41: flight schedule control

Context: ROADMAP.md line 119 asks for route demand, seasonal slot requests and contracts, currently simplified to per rotation arrival slots edited in a Slot manager (ARCHITECTURE.md 2026-11-04). The user asked for Airport CEO style flight management: which aircraft lands where, at what time, plus an automate function.
Options: A exact times per flight with stand and runway choice, B time windows auto assigned, C stand choice only with automatic times.
Recommendation: A with automation as the default fallback, since the user asked for exact times and automation.
Answer: A plus automation (2026-11-05): exact times per flight, plus an automate function.
Superseded (2026-11-06): the user withdrew exact time editing. The T41 line in the 2026-11-06 T40 entry below and `handoff/tasks/T41-flight-schedule.md` govern: fixed schedules, fixed turnarounds, drag a flight onto a stand where the block fits.

## 2026-11-05 T40: stages, the control room, movement counting, runway caps

Context: Follow ups to the T40 tower design.
Options and answers:
* Stage gating: A use the five GAME_DESIGN section 15 stages, B buy levels with cash only. Answer: B (2026-11-05), level up with cash only. No stage state is added to the sim; a new task is filed later if stages are wanted.
* Old control room: A keep it granting coverage, B tower only. Answer: B (2026-11-05), tower only. `FIXTURE_KEYS[12]` stays in the list because indexes are saved, but the fixture no longer grants ATC coverage and is removed from the buildable fixture list. Saves that had a control room and no tower lose ATC until a tower is built, with a warning on load.
* Movement counting: A every event counts (turnaround costs 4), B only landing and takeoff count (turnaround costs 2), C taxi in plus taxi out is one movement (turnaround costs 3). Answer: B (2026-11-05), only landing and takeoff count. Taxiing is free. This matches the usual airport movements per hour definition.
* Runways above the tower cap: A refuse the build with a problem code naming the level needed, B warn and queue anyway. Answer: A (2026-11-05), refuse the runway build.

## 2026-11-05 T42: grid and snapping numbers

Context: T42 needs grid spacing, draw length and snap radius. The first proposal was 10 m spacing along, 2 000 m drawn, 40 m snap radius, spacing across half the pavement width plus one shoulder, with Alt held for free placement.
Answer (2026-11-05): the user confirmed the following, which supersedes the first proposal above. The grid has 2 m minor cells and 10 m major lines. It is anchored to the runway or taxiway the player explicitly selects. Grid and free placement is a persistent toggle, and holding Alt is a temporary override. Guides are drawn only inside the viewport.
Still open: the 40 m snap radius is a proposal and has not been approved. The 2 000 m drawn length is superseded by viewport only guides, so no draw length is needed. Confirmed later (2026-11-06): the runway and taxiway tools snap to the active grid as well and keep their own node snapping, and the grid mode is a persistent toggle per tool with Alt as a temporary override.

## 2026-11-05 T40: tower footprint and looks

Context: Follow ups to the T40 tower design.
Answer (2026-11-05): the level 1 footprint is 15 m by 15 m, not 16 m. Five distinct looks, one per level. Level 1 is a simple tower with a window. Level 5 is a large and tall tower with a 360 degree window view. Looks are created as vector geometry in meters, per docs/ART_AND_ASSETS.md. The footprint size per level still needs a value, because the user only fixed level 1.
Update (2026-11-06): the footprint is 15 m by 15 m for every level. Looks differ, footprint does not. See the T40 entry dated 2026-11-06 below.

## 2026-11-05 T43: baggage handling system, scope given by the user

Context: The user asked for a working baggage system, not a belt fixture that only adds capacity.
Departures: passengers drop bags at a staffed check in counter or a self service bag drop, each drop has a conveyor connection port, directed conveyors route bags through walls using dedicated baggage openings, junctions and splitters sort them, screening equipment screens them, screened bags reach an airside handling station assigned to the stands, tractors and carts collect them, a belt loader loads the aircraft.
Arrivals: the loader unloads the aircraft into carts, the tractor delivers them to an airside conveyor input, conveyors route them to the assigned reclaim carousel, passengers collect their bags in the arrival hall.
Requirements the user named: junction and splitter options, over and under pass baggage bridges, floor selector for multi story conveyor systems, baggage scanner and separation tools, baggage drop on the airside, carousel on the landside, and a stand to handling station and stand to carousel assignment.
Answer: Pending on three points. The floor scope (baggage floors only, or passenger floors too), the routing control (automatic with splitter filters, or manual), and the failure rule (flight waits for bags, or departs at a cutoff and records mishandled bags) are not yet answered.

## 2026-11-05 T44: fixture and architecture variants, scope given by the user

Context: The user asked for graded variants.
Answer (2026-11-05): check in gets several levels, from a single small counter, to a large counter with multiple staff, to automated check in machines. Passenger security gets levels too, from a manual gate, to a larger gate with a better scanner, to a 360 degree automatic gate as used in major airports. Doors get basic, sliding, glazed sliding and large variants. Windows get multiple variants. The data values for cost, capacity and security effect are not yet given and must not be invented.

## 2026-11-05 T45: asset sharpness at maximum zoom

Context: The user reports that all assets look blurry at the closest zoom and says it breaks the fun. The request is for crisp geometry and legible detail, not a resolution increase everywhere.
Answer: Pending on the diagnosis. The fix must be chosen after the sprite bake resolution, zoom tiers, canvas scaling and chunk resolution are inspected, because a blind texture increase wastes memory and may not fix the cause.

## 2026-11-06 T40: tower numbers, footprint, looks and grid, current state

Context: This entry collects the latest decisions in one place. The numbers table is also in `handoff/tasks/T40-atc-tower.md`. Each line below records a decision from 2026-11-05 or 2026-11-06.
Answers (2026-11-06):
* Movement budget per runway per rolling hour, counting landings and takeoffs only: 20 at level 1, 40 at level 2, 60 at level 3, 80 at level 4 and 100 at level 5. This ladder is confirmed and replaces the earlier 10, 20, 30, 45, 50 ladder, which is superseded. Only landings and takeoffs count. Taxiing is free.
* Runway cap per level: 1, 1, 2, 2, unlimited.
* Movements over the budget wait in a first in first out queue.
* Queue tail: an arriving aircraft that cannot get a movement waits 30 game minutes, then diverts. The window is confirmed.
* No tower: GA and private aircraft only. There is no default budget for commercial traffic.
* The tower is the only source of ATC coverage. There is no control room fallback, and the old 3.5 km control room range does not apply. Tower range is the whole airport.
* Upgrades are bought with cash only. There is no stage gate.
* Tower costs, recorded 2026-11-06: level 1 costs 100 000 and each upgrade costs 50 000. The starting budget is about 120 000 000, so these are cheap by design.
* Tower footprint: 15 m by 15 m for every level. Looks differ, footprint does not.
* Tower looks: five distinct vector looks in meters, from a basic tower with a window at level 1 up to a tall tower with 360 degree glazing at level 5.
* Grid coverage: the runway and taxiway tools snap to the active grid as well, and keep their own node snapping, as in Cities Skylines.
* Grid mode: a persistent toggle per tool, with Alt as a temporary override. Confirmed.
* T41: replace the exact per flight time model with Airport CEO style stand management. Every signed airline offers a set of flights with a fixed schedule and turnaround, and the player drags a flight onto a stand as long as the block fits. No exact time editing.
Superseded proposals, do not treat them as approved: tower build cost 40 000 with upgrades 15 000, 25 000, 40 000 and 60 000, and the earlier movement ladder of 10, 20, 30, 45 and 50 per hour per runway. The 2 000 m grid draw length and the 40 m snap radius are also still unapproved.

## 2026-11-06 T40: movement budget and divert window confirmed

Context: Follow up to the T40 final decisions. Level 1 was too tight, and the queue tail needed a window.
Answers (2026-11-06): movements per hour per runway are 20 at level 1, 40 at level 2, 60 at level 3, 80 at level 4 and 100 at level 5, with runway caps 1, 1, 2, 2 and unlimited. An arriving aircraft that cannot get a movement waits 30 game minutes, then diverts. Only landings and takeoffs count. Taxiing is free.

## 2026-11-06 T40: plan questions

Context: Open points from the T40 plan (handoff/work/T40-atc-tower.md).
Answers (2026-11-06, user): the runway cap applies only when a tower exists, so the first runway can be built before the tower. More than one tower may be built; the highest level counts. Tower art proportions are chosen by the implementer at true scale per docs/ART_AND_ASSETS.md, and the user reviews the screenshots.
Answers (2026-11-06, orchestrator, implementation only): queued movements retry on the existing RETRY_TICKS cadence of 30 game seconds. The 30 minute ATC wait has its own timer and does not change MAX_DELAY_TICKS, which stays the 20 minute limit for flights without a stand. The stress scenarios build a level 5 tower so they keep measuring traffic, not ATC starvation; the baseline is not updated.

## 2026-11-10 T42: how the grid is chosen

Context: T42 as built let the player pick one grid and lock it. The user asked for the Cities Skylines mechanism.
Answer (2026-11-10): the grid is offered by proximity while the ghost hovers near a runway or taxiway, with free placement away from every grid. There is no picker. The reach is the pavement edge plus a screen scaled margin. The runway and taxiway tools also snap to the grid, as the lowest priority step. No hotkey for the Grid and Free toggle. This supersedes the 2026-11-05 line about an explicitly selected grid.

## 2026-11-10 plan: delivery order, deferrals and new tasks

Context: The user reviewed the plan with `docs/DESIGN_REVISION_3.md` and approved the decisions below. `handoff/TASKS.md` is reordered to match.
Answers (2026-11-10):
* Delivery order: 1 repair (finish the T40 tower tool and drawing, close T42, fix doc drift). 2 T41 flight offers. 3 passenger core, T11 to T18. 4 ground handling and baggage, T20 to T28 and T43, with boarding by jet bridge, stairs or bus. 5 tenants, airlines, finance. 6 procedural event director. 7 multi floor terminal designer, hangars, cargo.
* Deferred: T03 grading, T07 photo calibration, and the runway marking remainder of T02. `docs/DESIGN_REVISION_3.md` replaces their look and proportion targets. M4 no longer depends on T05 to T07.
* Floor index: the terminal data model gains a floor index before T12, with only floor 0 buildable for now. Filed as T49.
* Tenants: T32 is redesigned. The player zones a unit and gives it a category, generated brands apply, the player accepts, and the tenant furnishes the unit from templates. Ads raise applications. Tenant variety is unlimited and grows with the airport.
* Events: a seeded event director that draws from a data driven deck with player choices, so no two playthroughs match. Filed as T50.
* New tasks from revision 3: stand markings per section 3 (T47), and stand access types with the jet bridge upgrade per section 4 (T48).
* T41 depends on T40.
Still open, ask before the task starts:
* T48: the values in `docs/DESIGN_REVISION_3.md` section 4.4. Cost and works days per access type change, fixed link reach, the walking limit for stairs boarding, and whether types 3 and 4 fit every stand size.
* T32: categories, unit sizes, application and advertising numbers, the rent and sales model, and the growth measure. See the spec.
* T50: the first deck, its weights, windows, choices and costs. See the spec.
* T51, T52, T53: no design has been given yet.
* Placement in the order of T09, the M2 and M3 milestone reviews, and the M7 tasks T35 to T38. The approved order does not name them. T05, T06, T08 and T42 were delivered on `main` by another session on 2026-11-10.

## 2026-11-10 T41: decisions D1 to D7

Context: Open points in the T41 plan (handoff/work/T41-flight-offers.md).
Answers (2026-11-10, user):
* D1: fixed type per rotation.
* D2: stand choice remembered across days, save bump accepted.
* D3: unassign and cancel stay, no penalty yet.
* D4: the 5 minute buffer is the visible gap.
* D5: a block that stops fitting is flagged red and the player fixes it, with waiting and diverting as the fallback.
* D6: moot, T40 is done and the tower budget is used.
* D7: no preview of tomorrow.
Also (2026-11-10, user): when a task is fully green the orchestrator merges the work branch into main and pushes before reporting ready.

## 2026-11-12 T58: Design Revision 4 decision batch

Context: `docs/DESIGN_REVISION_4.md` needs these values, plus the open questions of T32, T48 and T50. Each value goes into `src/data` with a zod schema once answered. Money is in the game currency, at the scale of `src/data/business.json` (tower 100 000, shops 40 000 to 150 000, vehicles 12 000 to 260 000).

| Id | Item | Recommended value | Reason | Mirrors |
| --- | --- | --- | --- | --- |
| D1 | Stand classes | GA code A, small code B, medium code C, large code E, extra large code F; GA reuses the small markings without number box | Five classes cover the roster; code D types use large | Stand sizes small to large |
| D2 | Stand without service road | Bookable only for GA; others refused with the reason | Vehicles cannot reach it, so the turnaround would never finish | Stand not reachable warning |
| D3 | Lead in snap reach | 60 m from the stand box edge to a centerline | About one stand depth, avoids long hidden lead ins | Stand must touch a taxiway |
| D4 | Rotation steps | 15 degrees, Shift for free | Matches the grid tools | Rotate while placing |
| D5 | Stand upgrades kept for MVP 1 | Jet bridge (access types 1 to 5), stairs and bus bay, hydrant pit, fixed ground power; cut preconditioned air and docking guidance to MVP 2 | Each kept upgrade changes a turnaround task | Bridges and stand equipment |
| D6 | Upgrade costs and works days | Bridge type 1 or 2: 250 000, 4 days; type 3: 420 000, 6 days; type 4: 300 000, 5 days; type 5 bus bay: 20 000, 1 day; hydrant pit: 45 000, 2 days; fixed ground power: 30 000, 1 day | Scaled to tower and vehicle prices | Bridge purchase |
| D7 | Fixed link reach and stairs walk limit (T48) | Reach 40 m from terminal face or pier to the rotunda; stairs boarding within 150 m walk of a gate door | A real fixed link spans one service road plus apron edge | Bridge must touch the terminal |
| D8 | Types 3 and 4 by size (T48) | Type 3 on medium, large, extra large; type 4 on large and extra large | Small types have no usable aft door | Bridge per stand size |
| D9 | Series operating days | Decided by the user: the contract fixes the weekdays (for example Monday, Wednesday, Friday); the player picks time and stand, and the slot must be free on every operating day. Patterns generated: daily, weekdays, alternate days, twice weekly, weekend, with weights per airline model | Real timetables | Multi day placement |
| D10 | Series contract length | 26 game weeks, renewal offered 2 weeks before expiry | Long enough to plan, short enough to churn | Contract duration |
| D11 | Series on signing | 3 to 6 by airline scope (regional 3, national 5, international 6) | User example of five | Initial flight offers |
| D12 | Preferred window, curfew, lead time | Window 4 h, outside allowed with a satisfaction penalty of 1 point per placed flight. Decided by the user: no curfew, no lead time; a slot placed after today's time starts on the next operating day | Freedom with a cost | Requested times |
| D13 | On time | Departure within 15 min of the slot | Industry D15 measure | Delay tracking |
| D14 | Airline satisfaction | 0 to 100, start 60; unplaced flight minus 2, delayed flight minus 1, on time flight plus 0.5, weekly drift to 60 by 2; below 30 for 4 weeks cancels the worst series; below 15 for 8 weeks ends the contract | Simple, readable levers | Airline happiness |
| D15 | Growth with rating | Each airport star adds 2 offered series per airline; 3 stars unlocks code D and E types; a new airline approaches every 30 days with chance 0.2 times stars | Visible reward per star | Offers grow with rating |
| D16 | Destination network | 80 airports per seed, 150 to 4 000 km (MVP 1 scope), sizes 1 to 5, six regions, names from syllable tables | Enough variety, fits regional and national scope | Destination list |
| D17 | Service road and lanes | Road 7 m two lane (T24), apron lane 4 m one way; speeds road 25 km/h, apron 15 km/h, last 15 m 5 km/h | Real apron practice | Vehicle roads |
| D18 | Depot | 60 by 40 m, cost 180 000, holds 24 vehicles; extra depots stack capacity | One depot serves a small airport | Ground handling depot |
| D19 | Fuel farm | 50 by 50 m, cost 400 000, 4 tanks of 500 m3 each; road tanker 36 m3; buy price 0.8 per liter, sell 1.0; stock out grounds flights after 60 min delay | Real tanker and tank sizes | Fuel depot |
| D20 | Catering unit | 40 by 30 m, cost 220 000, 6 trucks | One unit per terminal area | Catering |
| D21 | Fire station | 40 by 30 m, cost 300 000, category from the section 10 table by vehicles bought (fire vehicle 350 000); response target 180 s to each runway end at 60 km/h | ICAO three minute response | Fire department |
| D22 | Staff center, cleaning depot, maintenance workshop | Staff center 30 by 20 m 90 000; cleaning depot 25 by 20 m 60 000; workshop 40 by 30 m 150 000 | Small buildings, low cost | Staff and service buildings |
| D23 | Further buildings | Keep for MVP 1: none. Move to MVP 2: de-icing pad, car rental, bus station, cargo and hangars | Keeps MVP 1 lean | Other service buildings |
| D24 | Group sizes | Business 1 (90 %) or 2; leisure 1 (20 %), 2 (45 %), 3 (15 %), 4 (20 %); family 3 to 5; budget 1 or 2; premium 1 or 2 | User: most leisure are families or pairs, business alone | Passenger groups |
| D25 | Need growth | Hunger threshold after 3 h, thirst 2 h, toilet 2.5 h, rest after 40 min standing or walking; each member gets a seeded factor 0.7 to 1.3 | Typical airport dwell is 1.5 to 3 h, so most people feel one need | Passenger needs |
| D26 | Budget and wants | Spend per profile from `profiles.json` times a seeded factor 0.5 to 1.5; shopping desire 0 to 1; two favourite categories | Real spread of spend | Shopping |
| D27 | Satisfaction rollup | Member satisfaction per GAME_DESIGN section 8, cohort mean, airport rating over 30 days, stars at 20, 40, 60, 80 | Existing formula, star cuts are even | Airport rating |
| D28 | Staff shifts | 3 shifts of 8 h, one 30 min break per shift at the staff center, skill 0 to 1 speeds service by up to 20 % | Real shift pattern | Staff shifts |
| D29 | Tenant categories and unit sizes (T32) | Convenience 12 to 60 m2, food 40 to 300 m2, cafe 20 to 120 m2, bar 40 to 200 m2, books and gifts 20 to 80 m2, pharmacy 20 to 80 m2; duty free to MVP 2 | Existing six kinds minus duty free, plus bar | Franchise categories |
| D30 | Applications and advertising (T32) | One application per category per 10 days, plus one per 20 000 spent on advertising per month; brand pool grows by one per 100 000 yearly passengers | Variety grows with the airport | Franchise offers |
| D31 | Rent and sales (T32) | Base rent per m2 per day 1.2 plus 12 % of sales; existing shop fixtures become zoned units with a generated tenant on load | Both levers matter | Shop income |
| D32 | First event deck (T50) | Rain, fog, strong wind, fuel delivery delay, vehicle breakdown, VIP flight, diversion, staff shortage; one draw per day, weight 1 each, weather weighted by climate; each with two choices; fallback is the cheaper choice after 2 game hours | Small deck, every event playable | Incidents with choices |
| D33 | Event choice costs (T50) | Fuel delay: pay 15 000 for priority or accept 90 min delays; breakdown: repair 8 000 now or lose the vehicle 2 days; VIP: 10 000 for a dedicated stand for plus 3 airline satisfaction or decline; diversion: accept (plus 5 000 fees, uses a stand 3 h) or refuse; staff shortage: pay 1.5 wages for the day or run 25 % short | Each choice is money against service | Event choices |

Recommendation: accept all.

Answer (owner, 2026-11-12): all 33 values accepted as recommended. D9 and D12 were set by the user directly. Each value moves into `src/data` with a zod schema in the task that first uses it.

## 2026-11-16 TIME1 and the handover of the stands, roads and speed session

| Question | Answer (owner, 2026-11-16) |
| --- | --- |
| Which item does this session finish | Game speed (TIME1) |
| Time scale: motion at twice real time at speed 1, calendar 12 times faster than motion, one game day in 60 real minutes, turnarounds 45 to 180 game minutes, old saves load with a jumped day number | Confirmed as proposed |
| Service roads and D2 (a stand without a road is bookable only for GA) | Soft penalty: commercial flights still use a stand without a road, turnarounds are slower and an alert asks for a road. Existing saves keep working. This replaces the hard rule of D2 |
| Snapping at the last point: which tool | All drawing tools: a marker and tooltip for every snap kind in the runway, taxiway, apron and stand tools, and press and drag draws a taxiway segment |

## 2026-11-17 T59 stand classes and placement

| Question | Answer (owner, 2026-11-17) |
| --- | --- |
| Stand classes under D1 (GA code A as a fifth class) | Replaced by the user: four sizes only, small, medium, large and extra large, plus a pass through layout. GA, commercial and cargo are a property of the stand, set with toggles, any mix. This replaces D1 |
| Jet bridges | An upgrade on any size except pass through; it needs a second terminal floor. Built in T66 |
| Stand choice | Manual assignment may put a smaller aircraft on a larger stand. Automatic choice takes the aircraft's own size first, then the next larger, never a smaller one |
| Pass through sizes | All four sizes, chosen as a layout beside the size |
| Rows of stands | Single stands only: one stand per click, each with its own snap and rotation |
| Scope of T59 | Classes, pass through, accepts toggles, placement with rotation and lead in snapping, ghost fix, migration. Snap markers for all tools and taxiway sections become two new roadmap rows |
| Interim turnaround crews from T57 (under 20 m no belt loader set, GA refueller only) | Confirmed as is until T63 |

## 2026-11-17 T47 stand markings

| Question | Answer (owner, 2026-11-17) |
| --- | --- |
| Which items of `surfaces_stands.png` T47 paints | Everything on the sheet for nose in stands, including the wing stop outline (the red funnel). The current funnel angle is too steep: follow the sheet exactly |
| Taxi through and MARS stand markings | Painted when the stand kind exists: taxi through with T72, MARS with the MVP 2 MARS task. No marking code waits unused |
| Bridge side before the access types of T66 | Contact stands are drawn as access type 1 (bridge zone front left, staging and GSE front right). Remote stands keep the bus bay |
| Connection state icons on the map | The states the game can compute today: no taxiway (red) and breaks taxiway clearance (amber), shown at every zoom. A stand with no lead in draws its box outline. Further states join when their systems exist |
| Marking dimensions missing from the docs and data | Measured from the sheet at 7.5 px per meter and stored in `stand_sizes.json`. The user may change any of them later |

## 2026-11-17 T72 pass through stands

| Question | Answer (owner, 2026-11-17) |
| --- | --- |
| Connection of a pass through stand | Lead out optional: the stand is green with its lead in alone. With a lead out the aircraft enters from the tail side and leaves forward from the nose, one way. Without one it pushes back like any stand |
| Data shape | A third stand type `through` beside contact and remote. Old saves keep their shape, no migration. Never a jet bridge |
| Lead in and lead out shape | The two arc fork at both ends |
| Markings and price | The sheet's taxi through markings plus the nose in extras (emergency triangle and GSE box). Price and box size as the remote stand of the same size (assumed, the price was not answered separately) |

## 2026-11-17 T70 snap markers

| Question | Answer (owner, 2026-11-17) |
| --- | --- |
| Which snap kinds show a marker and a tooltip | All of them: vertex, runway edge, centerline, alignment guide, angle step, stand lead in and the taxiway node, end and segment. Grid nodes get a small marker but no tooltip |
| Snap radius | Taxiway snap 20 m, the other tools 16 screen px with an 8 m floor |
| Press and drag in the taxiway tool | A drag longer than 8 screen px places a point at the press and one at the release, so one drag draws a segment. The polyline stays open, a click still adds one point |

## 2026-11-17 T71 taxiway sections, T61 and T62 flight series

| Question | Answer (owner, 2026-11-17) |
| --- | --- |
| Name of each section after a split | Sections keep the parent name, like a real taxiway that runs through junctions |
| Split taxiways in existing saves | First answered new builds only, then replaced by the user the same day: follow Airport CEO, every intersection (crossings included) is a junction, older saves split on load |
| Look of the weekly planner (T61) | Mon to Sun day tabs over the daily stand timeline plus a week strip per stand; one drop places the series on all its operating days |
| Where series come from before T62 | Build T61 and T62 together, so series point to generated destinations from the start |
| Day pattern weights (D9) | Equal weights for every pattern and airline |
| Preferred arrival windows (D12, 4 h wide) | Window start uniform over the day |
| How stars are counted (D15) | From two experiences: passengers (toilets, shops and food, queues, cleanliness, on time) and airlines (ground handling support, airside infrastructure and facilities, timeliness, cleanliness) |
| Airline pool at the start of a seed | Keep the seven slots and their rating gates, with generated names, hubs and fleets |

## 2026-11-18 R5: decision batch for the terminal kit

Context: The user asked for the terminal fixture kit (three levels of check in, security, passport control and gate desk, automated variants, every prop), a security exit, zoning like Airport CEO and the baggage network with automatic links (`docs/DESIGN_REVISION_5.md`). The art and the structure are decided. The gameplay values below are proposals written into `src/data/fixtures/catalog.json` (field `confirm`) and the three documents. Ask them in one batch when the first task of phase 3b or T43 starts.

| Value | Proposed | Where |
| --- | --- | --- |
| Check in service time, levels 2 and 3 | 105 s, 95 s | `docs/TERMINAL_FIXTURES.md` 4.1 |
| Security lane throughput and officers, levels 2 and 3 | 360 per hour with 5, 450 per hour with 4 plus a remote screener | 4.2 |
| Passport control, levels 2 and 3 | 38 s, 30 s | 4.3 |
| Gate desk time per passenger, levels 2 and 3 | 3.5 s, 3 s | 4.4 |
| Self bag drop roaming agent | 1 per 4 units | section 5 |
| Automated passport gate | 20 s, 1 officer per 5 gates, 8 percent referred, children under 12 referred | section 5 |
| Security exits | Staffed 1 200 per hour with 1 officer, automated 900 per hour, revolving 1 500 per hour | `docs/TERMINAL_ZONING.md` 6 |
| Customs channel | 8 s green, 5 percent red for 120 s, 2 officers | `docs/TERMINAL_ZONING.md` 6 |
| Staff screening rule | A staff route from Public into Secure must pass a security lane set to staff use | `docs/TERMINAL_ZONING.md` 3 |
| Washroom service times | Accessible toilet 150 s, urinal 45 s | catalog |
| Decoration ambience, vending sales share, ATM fee | 1 or 2 by size, 15 percent, 2 per use | catalog |
| Escalator, stairs, elevator, travelator | 3 000 per hour, 2 000 per hour, 13 people and 60 s round trip, 0.65 m/s | `docs/TERMINAL_FIXTURES.md` 6.9 |
| Janitor room | Base for 2 cleaners | 6.9 |
| Baggage values marked Confirm | As listed | `docs/BAGGAGE.md` 11 |
| Legacy `belt` fixture | Each saved belt becomes a carousel anchor on load | `docs/BAGGAGE.md` 9 |
| Build cost, upkeep and works time of every asset and level | To be proposed in the task | `src/data/business.json` |

Options: A accept the proposals as a batch, B answer row by row.
Recommendation: A, then tune with play tests.
Answer (owner, 2026-11-18): A, accept the proposals as a batch. Build costs are proposed in each task and reported.

## 2026-11-17 user reports after phase 1: stand row, service road, aircraft tiers

| Question | Answer (owner, 2026-11-17) |
| --- | --- |
| How a stand snaps beside a built stand | Abut edge to edge with the stand tops lined up, so the service roads join into one straight road; mixed sizes align on the road edge |
| Service road scope now | Visual join now; T60 next makes the joined strips real service road graph edges |
| Aircraft turning into arrows while zooming | The quality governor never drops a silhouette to the arrow; the arrow follows zoom alone |
| Selecting a stand on an apron | Clicking anywhere on the stand box selects the stand |
| Jet bridges | Not drawn before they are built as an upgrade |
| Blurry map at apron zoom and missing liveries | Map chunks must stay sharp at every working zoom; liveries show at apron working zoom |
| Rapid exit direction | The player can flip a rapid exit to serve the other landing direction |

## 2026-11-18 T60 service roads, depot and vehicles

| Question | Answer (owner, 2026-11-18) |
| --- | --- |
| How service roads are built | Stand road strips become graph edges automatically (two one way apron lanes) and join where stands abut. A road tool draws 7 m two lane service roads, press and drag like taxiways, snapping to strip ends and other roads |
| Where vehicles start | The ground handling depot of T65 is built inside T60, so vehicles drive depot to stand on roads from the start. With no depot or no road path, vehicles appear beside the stand as before and the soft penalty applies |
| Soft penalty for a commercial stand with no road path to a depot | Turnaround 25 percent slower, with an alert asking for a road |
| May a service road cross a taxiway | Yes, with a hold line; vehicles wait while an aircraft is on or has reserved the crossed taxiway section. Runways are never crossed |
| Vehicles in saves and the hash | Approved: vehicles, roads and depot fleets are saved with a migration. Old saves load with no roads and an empty fleet |
| Baggage carts per tractor | By aircraft size: small 1, medium 2, large 3, extra large 4 |
| How the fleet is bought | Per kind in the depot inspector at the catalog price, up to the depot capacity of 24. A new depot comes with 2 tugs, 2 tractors, 4 carts, 2 belt loaders, 2 GPUs, 1 refueller, 1 stairs and 1 catering truck |

## 2026-11-18 T65 supporting buildings

| Question | Answer (owner, 2026-11-18) |
| --- | --- |
| Fire category rule (D21) | Commercial flights a type's category needs are refused, GA exempt, after 7 game days of grace with a warning; a new game and an old save each start with the grace. A station covers a runway when both ends lie within 180 s at 60 km/h |
| Fuel taken per turnaround | A fixed number of liters per aircraft type, in data |
| Road tankers and refuellers | Automatic orders below 25 percent stock, a 36 m3 tanker arriving 2 game hours later; refuellers draw from stock at the aircraft. A stock out delays the flight, which is grounded after 60 minutes (D19) |
| Staff center, cleaning depot, maintenance workshop, catering unit | Placeable now with D20 and D22 prices and an upkeep of 0.05 percent of cost per day; the catering unit sends its own trucks by road; other effects come with T63, T68 and T50 |

## 2026-11-18 T63 turnaround task lists

| Question | Answer (owner, 2026-11-18) |
| --- | --- |
| How long the tasks take | Shares of today's role turnaround, with the longest chain summing to it, so plans stay valid. A vehicle task counts down only while its vehicle is docked |
| A task whose vehicle kind has no free unit | Always wait for an owned vehicle, also without a depot or road |
| Old saves and games with no depot | Accept stuck airline flights until the player builds a depot and buys vehicles. GA needs no vehicles |
| Delay owners | The airline owns the boarding hold for passengers late to the gate, in full; the airport owns vehicles, crew, fuel and ATC |
| Cleaning, water and waste | Timed tasks with no vehicle. Cleaning counts only with a cleaning depot, and cleanliness joins the rating. Staff does not gate tasks until T68 |

## 2026-11-18 phase 2 run: T73, T43, T66

| Question | Answer (owner, 2026-11-18) |
| --- | --- |
| How to run the rest of phase 2 | Two parallel tracks: T73 fixture baker and the T43 sim slices, each in its own worktree. T43 drawing and T66 follow once both land |
| Where fixture sprites are baked | Main thread, lazily, cached per asset, tier, rotation and livery |
| Kit asset for fixtures without a level | Level 1 of the family; `seating` draws `bench.beam3`, `toilet` draws `washroom.wcStall` |
| Late bags | The departure waits up to 15 minutes past its slot for its bags, owned by the airport, then leaves. Each missed bag is logged as mishandled and lowers passenger satisfaction with weight 0.5 per bag |

## 2026-11-18 T66 stand upgrades and assignments

| Question | Answer (owner, 2026-11-18) |
| --- | --- |
| Jet bridges while only floor 0 can be built | Bridges wait for T51. T66 ships stairs and bus bay, hydrant pit and fixed ground power now; jet bridge access types 1 to 4 stay unbuildable until multi floor terminals exist |
| What the stand inspector assigns | The gate desk only. Check in stays airline wide. A stand with no gate desk falls back to the nearest one and shows a warning. The baggage bay comes from T43 and the carousel follows the bay |
| Bus bay (access type 5) | A stand within 150 m of its gate desk boards by stairs. A farther stand needs a bus bay, and boarding then waits for a depot bus. Without a bus bay a far stand boards 25 percent slower and an alert asks for a bus bay |

## 2026-11-18 phase 3 run: T54, T75, T67, T20, T68

| Question | Answer (owner, 2026-11-18) |
| --- | --- |
| How to run phase 3 | Two parallel tracks first: T54 then T67 on the cohort store, and T75 zoning beside it. Once both land, T20 and T68 run in parallel. T78 stays parked |
| How a flight is domestic or international | Per destination: each generated destination carries a seeded flag, the international share lives in data (35 percent proposed). A flight is international when its destination is |
| Values marked Confirm and missing numbers | Every Confirm value of `docs/TERMINAL_ZONING.md` is accepted as written. Numbers for T67 needs and T68 shifts that no doc gives are proposed by the orchestrator in data files, listed here per task and reported for review |
| Saves and stress | Save version bumps with a migration are approved for every task that needs one. A stress regression or a broken 4 ms medium budget stops the run for the owner; no baseline update without asking |

### T67 proposed values (orchestrator, for the user's review)

| Subject | Proposed value |
| --- | --- |
| Group size | family 3, 4 or 5 at 34, 33 and 33 percent; budget and premium 1 or 2 at 60 and 40 percent; crew 1 |
| Need threshold | a member acts on a need above 0.5 |
| Visits | food 20 min with spend share 0.4, drink 10 min with 0.15, shop 15 min with 0.6, rest 20 min with 0 |
| Gate lead | members head to the gate 15 to 40 min before departure |
| Reduced mobility | 3 percent of members, walking at 0.7 speed |
| Satisfaction | queue costs 1 point per game minute over patience; walking costs 0.02 per m beyond 300 m; an unmet need costs 10 per hour; a missed flight costs 40 |
| Scope | needs act only airside (retail window, GAME_DESIGN section 8); flight delay and facility bonuses stay in their own rating parts; travel class and price sensitivity move to T32 |

### T20 proposed values (orchestrator, for the user's review)

| Subject | Proposed value |
| --- | --- |
| International share | 0.35 of destinations, seeded per destination (owner answer) |
| Immigration | passport desk 45 s; eGate 20 s, 1 server, 8 percent referred to an officer, families with children under 12 use desks |
| Customs | 8 s with 2 servers; 5 percent sent to the red channel for 120 s |
| Deboarding | doors open 180 s after docking; 2.5 s per passenger per door; remote stand bus delay 480 s until bus trips exist; far stands without a bus bay reuse the 0.25 boarding slowdown |
| Baggage claim | checked every 30 s; passengers give up after 45 min; missing bags cost 20 points per member |
| Stranded | after 60 min, costing 40 points per member |
| Scope | security exits stay walk through with no queue; international departures through passport control and security exit throughput become new roadmap rows |
| Default for Q1 | an international flight at an airport with no international gate desk uses the domestic route, skips immigration and customs, and the player gets a notice; the alternative (passengers lost) is one branch in arrivalEntry |

### T68 proposed values (orchestrator, for the user's review)

| Subject | Proposed value |
| --- | --- |
| Shifts | start 06:00, 14:00 and 22:00, 8 h each; clock in and out 10 min; an unrelieved worker stays at most 60 min past shift end |
| Breaks | one per shift, due 240 min after shift start plus 0 to 60 min, 30 min long; waits up to 30 min for relief; skill 0.8 without a break |
| Staff | skill 0.9 to 1.1; relief pool 0.2 of the on duty need; per station: check in 1, bag drop 1, gate desk 1, security 2, passport 1, customs 1, screening machine 1; wage 130 per role per day (existing fee); walk 1.5 m/s (existing crew speed) |
| Sim | store capacity 4 096, state step 1 min, staffing pass every 60 min |
| Render | 300 staff figures in the snapshot, passenger sample cap 3 000 to 2 700; staff stand 0.7 m behind the desk, 0.8 m apart |
| Default for Q1 | with no staff center, staff clock in and out at the curb door, skip their break and work at 0.8 skill; the alternative (no staffed desk opens without a staff center) would break existing saves |
| Scope | apron crews, cleaners, staffed security exits, morale and training move to a new roadmap row at close |
| Default for Q2 | when the player cap or the stations shrink, members already on site keep working until their shift ends and are then freed; the alternative (send them home at once) would empty a desk in the middle of a shift |

## 2026-11-22 T78: baggage follow up

| Question | Answer |
| --- | --- |
| Scope | All six parts in this task: bay road connection, tractor trips, Baggage load overlay with alerts, legacy belt migration, busy baggage stress scenario, ramp stub visual tests |
| Bay with no road | Strict: no truck serves it, so departure and arrival bags of its stands count as missing. The same holds whenever a train cannot make the trip (no depot route to the bay, or no route between bay and stand) |
| Train load | One train per flight per direction carries every bag, no cart capacity |
| Legacy belts | Carousels come in sizes S, M and L (owner: implementer picks the size steps). Each belt becomes the largest carousel that fits at it, else stays a legacy belt with a warning |
| Save format | Bump with a migration |
| Chaining | Separate trips: arrival train depot, stand, bay, depot; departure train depot, bay, stand, depot |

Implementer choices, stated for the owner: carousel S is a 10 m loop (6 by 2 cells, 30 bags), M is today's 20 m loop (11 by 2 cells, 60 bags), L is a 30 m loop (16 by 2 cells, 90 bags). A bay's road connection point sits on its center line, beyond the staging lanes by two turn radii; the train turns along the bay face and reverses into its slot so the last cart is on the truck edge, then leaves forward. Link load in the overlay is bags per hour over the last 10 minutes against `linkCapacityBagsPerHour`.
| Claim give up | Raised from 45 to 75 game minutes (`arrivals.json` claim.giveUpMin), because the train trip to the bay adds 15 to 25 minutes after the unload task (owner, 2026-11-22) |

## 2026-11-22 T79: international departures

| Question | Answer |
| --- | --- |
| International flight with no departure passport control | No international flight at all until the international passenger flow is built |
| What counts as built | Full flow in one terminal with a curb: a gate desk in an International zone, passport booth or eGate in departure mode, one in arrival mode, and a customs channel |
| Enforcement and signed series | No international offers or new series until built. Signed international flights are cancelled on any day the flow is missing, with a notice, costing airline happiness |
| Departure service times | Same as arrival (desk 45 s, eGate 20 s, 8 percent referred, families use desks), stored as their own departure entries |
| Order and placement | Passport control is entered from the Secure zone, so it comes after security by layout. Departure booths keep the Secure to International rule |

Implementer choice, stated for the owner: a cancelled international flight costs the airline 2 happiness points, the same as an unplaced flight (`cancelledFlight` in `market.json`).

## 2026-11-22 T80: security exit throughput

| Question | Answer (owner, 2026-11-22) |
| --- | --- |
| Who queues at a security exit | Domestic arrivals only. Missed departures keep leaving the terminal as today |
| Officer at a staffed exit | Not in T80. All three levels serve at their rate with no staff; staffed exits move to T81 |
| Rates and save format | The rates accepted on 2026-11-18 (1 200, 900 and 1 500 people per hour, one server each); save format 34 with a migration; merge to main when verify is green |


## 2026-11-22 T74: fixture levels

| Question | Answer (owner, 2026-11-22) |
| --- | --- |
| Security lane footprint | Build as the roadmap says: the kit footprint of 8 by 2 cells (16 by 4 m) at every level. Old saves are disregarded: the migration removes saved 1 cell lanes and refunds their build cost |
| Cost per level | L2 costs 1.6 times L1, L3 2.5 times L1 (check in 9 000, 14 400, 22 500; security 70 000, 112 000, 175 000; passport 18 000, 28 800, 45 000; gate desk 12 000, 19 200, 30 000). An upgrade costs the difference. Upkeep follows the build cost as today. Works take 1 game day, security 2 |
| Undo and placement | While works run, Cancel restores the old level with a full refund. The fixture tool gets a level picker, so L2 and L3 can be placed new |
| Premium and staff | Premium profile passengers checked in below level 3 lose 5 satisfaction points. At a level 3 gate desk premium cohorts go to the front of the queue. Gate desk needs 2 agents at L2 and L3; security needs 2, 3 and 2 officers; the remote screener waits for T81 |

## 2026-11-22 T76: props

| Question | Answer (owner, 2026-11-22) |
| --- | --- |
| Scope | Placement and removal of every sub grid prop of the nine prop categories, saves, walking block, drawing from the kit and build menu cards. Effects now: comfort from seats and ambience from decoration feed the passenger rating, plus washroom capacity (below). Vending sales, ad income, wayfinding, charging and office staff effects move to a new roadmap row |
| Old seating and toilet fixtures | Convert on load: each seating fixture becomes beam seat props, each toilet block becomes stall props, and both leave the build menu |
| Washrooms | In T76: the stall, accessible toilet and urinal props of one room form one toilet node whose servers are their capacity, with the catalog service times (stall 90 s, urinal 45 s, accessible 150 s) |
| Walking block | A 2 m cell is unwalkable when floor props cover at least half of its area. Floor layer and overhead props never block. Placement is refused when it would block a cell beside a door or a transition fixture |
| Prices | Seat 300 per seat, lounge item 1 200, washroom item 800 (stall 2 500), decoration 600 per ambience point, vending 3 000, screen 2 000 (LED wall 12 000), service item 1 500, office item 1 000, back of house 600. Upkeep 2 percent of cost per month |
| Rating | New passenger term Amenities = (comfort + ambience) / 2. Comfort = min(1, sum of seats times (1 + 0.25 times comfort) / (30 per gate desk)). Ambience = min(1, ambience points / (1 per 50 m2 of passenger floor)). The catalog ambience values are accepted |

Implementer choices, stated for the owner: a converted seating cell holds two beam seats of 3 (6 seats), a converted toilet block two stalls side by side (2 servers instead of 6), so the toilet rating term now reads washroom servers over 8 (four converted blocks give the full score, as four blocks did before). Converted props skip the wall rule. Removing a prop refunds its full price, which stands in for undo, since terminal edits have no undo stack. With no gate desk, comfort counts against 30 seats. Overhead props are baked into the floor chunk under people (logged in the backlog).

## 2026-11-23 T77: circulation and back of house

| Question | Answer (owner, 2026-11-23) |
| --- | --- |
| Travelator lengths | The three kit pairs, 8, 16 and 24 m long and 3.6 m wide, one belt each way. Both directions get the 0.65 m/s boost |
| Escalators, stairs and elevators before T51 | Hidden until T51: not in the build menu and not in the fixture keys yet |
| Janitor room | Room type now: a room holding the janitor room set is a janitor room, validated, with no gameplay effect until cleaners arrive in T81 |
| Prices | Travelator pair 60 000 (8 m), 110 000 (16 m), 160 000 (24 m), with no upkeep cost |

Implementer choices, stated for the owner: a travelator is one fixture key with the length as its level, picked in the context bar like the security exit type, never upgraded. Its cells are unwalkable from the side (balustrades); people step on at one end and off at the other. Its walk graph edges carry the time of the ride as meters at a reference walking speed of 1.3 m/s, so a 24 m belt counts as 24 x 1.3 / (1.3 + 0.65) = 16 m. A janitor room is valid when every cell under the janitor room set is staff zone; otherwise the terminal shows a readiness issue.
