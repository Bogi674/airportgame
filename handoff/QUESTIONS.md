# QUESTIONS.md

Design questions for the user. Add a question here, then ask the user and wait. Never guess a gameplay rule.

Format:

```
## <date> <task id>: <short question>

Context: what the spec and docs say, and where they are silent or disagree.
Options: A ..., B ..., with the consequence of each.
Recommendation: the option you would pick and why.
Answer: (the user's answer, filled in when given)

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

## 2026-11-05 T40: stages, the control room, movement counting, runway caps

Context: Follow ups to the T40 tower design.
Options and answers:
* Stage gating: A use the five GAME_DESIGN section 15 stages, B buy levels with cash only. Answer: B (2026-11-05), level up with cash only. No stage state is added to the sim; a new task is filed later if stages are wanted.
* Old control room: A keep it granting coverage, B tower only. Answer: B (2026-11-05), tower only. `FIXTURE_KEYS[12]` stays in the list because indexes are saved, but the fixture no longer grants ATC coverage and is removed from the buildable fixture list. Saves that had a control room and no tower lose ATC until a tower is built, with a warning on load.
* Movement counting: A every event counts (turnaround costs 4), B only landing and takeoff count (turnaround costs 2), C taxi in plus taxi out is one movement (turnaround costs 3). Answer: B (2026-11-05), only landing and takeoff count. Taxiing is free. This matches the usual airport movements per hour definition.
* Runways above the tower cap: A refuse the build with a problem code naming the level needed, B warn and queue anyway. Answer: A (2026-11-05), refuse the runway build.

## 2026-11-05 T42: grid and snapping numbers

Context: T42 needs grid spacing, draw length and snap radius. Proposed values are 10 m spacing along, 2 000 m drawn, 40 m snap radius, spacing across half the pavement width plus one shoulder. Proposed interaction: hover a runway or taxiway to pick its grid, hold Alt for free placement, show the active mode and grid in the context bar.
Answer: Pending. These proposals have not been approved by the user.

## 2026-11-05 T40: tower footprint and looks

Context: Follow ups to the T40 tower design.
Answer (2026-11-05): the level 1 footprint is 15 m by 15 m, not 16 m. Five distinct looks, one per level. Level 1 is a simple tower with a window. Level 5 is a large and tall tower with a 360 degree window view. Looks are created as vector geometry in meters, per docs/ART_AND_ASSETS.md. The footprint size per level still needs a value, because the user only fixed level 1.

```
