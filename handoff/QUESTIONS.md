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
