# T75. Zoning revision

Phase 3b. Spec refreshed 2026-11-18 from the draft, `docs/TERMINAL_ZONING.md` and the owner answers of 2026-11-18 (`handoff/QUESTIONS.md`, phase 3 run). Track branch `track/t75`, worktree `/home/user/wt-b`. Plan and slice briefs: `handoff/work/T75.md`.

## Goal

Zones work like the Airport CEO mechanic with this game's rules: people cross a zone edge only through a transition fixture in its allowed direction or, for staff, a staff door. Every other opening between two zones is a breach that the walking graph removes and that the terminal inspector and the zones overlay report. The overlay shows the security sides at a glance.

## Read first

`docs/TERMINAL_ZONING.md` (all, normative), `docs/DESIGN_REVISION_5.md`, `docs/TERMINAL_FIXTURES.md` sections 2, 5 and 5a, `docs/art/terminal_zones_kit.png`, `docs/reference/sprite-prototypes/fixtures_zoning.py`, `src/data/fixtures/catalog.json` (assets `securityExit.*`, `staffDoor`, `customs`, `eGate`, `passport.*`), `handoff/PITFALLS.md` (2, 6, 8, 10, 11, 13, 14, 15, 16, 25, 26), `handoff/RECIPES.md` (R2, R3, R6, R7, R9, R10, R11), and the code named in the work file.

## Decisions

Owner (2026-11-18):

1. Every value marked Confirm in `docs/TERMINAL_ZONING.md` is accepted as written, including the staff screening rule. Save migrations are approved.
2. The customs channel is placed, priced and drawn here. Its use in the arrival journey belongs to T20.
3. The automated passport gate and the passport mode (departure or arrival) are stored and validated here. Their journey use belongs to T20.
4. Security exit levels 1 to 3 are the staffed lane, the automated exit lane and the revolving exit door. Their footprints differ, so changing the level is a replace (erase and place), not an upgrade (`docs/TERMINAL_FIXTURES.md` 5a).
5. Staff are not individuals until T68. The walking graph keeps one layer per audience, passenger and staff, so T68 uses the staff layer as is.

Implementation (planner; each gets a dated line in `docs/ARCHITECTURE.md` section 12 at close):

6. **Indexes appended.** `ZONES` gains `international` (5), `WALL` gains `StaffDoor` (4), `FIXTURE_KEYS` gains `securityExit` (id 20), `eGate` (21), `customs` (22). `isShopFixture` and `isBaggageFixture` keep their ranges.
7. **Rectangular footprints.** `FIXTURE_FOOTPRINT[key]` lists `[along, across]` in cells per level (one entry for fixtures without levels). Along is the anchor to tail axis `ROT_STEP[rot]` (kit x at rot 0), across is `ROT_STEP[(rot + 1) % 4]` (kit y at rot 0). The anchor is the corner cell; footprint cells are `anchor + i * along + j * across`. Anchors hold `fixtureRot` 0 (one cell, no direction) or `1 + rot`; every other footprint cell holds `5 + rot`, so every "anchor is below 5" check keeps working. Footprints: staffed exit 2 x 2, automated exit lane 1 x 3, revolving door 2 x 2 (the 2.6 m drum is drawn centered, never scaled), customs 2 x 2, eGate 1 x 1, existing fixtures unchanged. T74 reuses this for the 8 x 2 security lane.
8. **New per cell layers** on `TerminalGrid`, saved: `fixtureOff` (offset of a footprint cell from its anchor, `i | (j << 4)`, 0 on the anchor), `fixtureLevel` (1 to 3 on every footprint cell, 0 on empty cells), `fixtureMode` (0 or 1 on every footprint cell). T74 must reuse `fixtureLevel`, not add its own.
9. **Directed one cell fixtures.** Transition fixtures (`security`, `securityExit`, `passport`, `eGate`) and every fixture larger than one cell store `1 + rot` on the anchor. Other one cell fixtures keep 0.
10. **Flow direction.** Kit sprites flow from their bottom edge to their top edge (`fixtures_zoning.py`). The flow step of a fixture with rotation `rot` is `ROT_STEP[(rot + 3) % 4]`; rotation 0 flows toward the lower row index.
11. **Modes.** `fixtureMode` means: `passport` and `eGate` 0 departure (Secure to International), 1 arrival (International to Public); `security` 0 passenger lane, 1 staff lane (staff screening); every other fixture 0.
12. **Transition rule.** A zone edge from cell A to its neighbour B in the flow direction of a transition fixture T is open one way, A to B, for T's audiences when A or B is a footprint cell of T, the effective zone of A is T's from zone and that of B is T's to zone. The same rule covers an edge inside the footprint, its back edge and its front edge, so a one cell desk works on either side of the zone line. Audiences: a staff lane staff only, every other transition passengers and staff.
13. **Effective zone.** Unzoned (0) counts as Public (1). A commercial region (commercial cells joined by open edges or plain doors) takes the single zone among Public, Secure and International that it touches through open edges or plain doors. If it touches none it stays Commercial; if it touches more than one, all its edges to other zones are breaches (open question 1).
14. **Edge access.** One shared table per grid gives each cell edge four bits: passenger and staff, each way. Wall and glass 0; staff door staff both ways; same effective zone all four; a transition edge per decision 12; anything else between two floored cells is a breach and 0. The walking graph, the service queues, room validation, the overlay and the tool ghost all read this one table (`src/shared/terminalZones.ts`).
15. **Walking graph layers.** Each directed edge carries an audience mask. Walking distance takes an audience and reads the row of its `from` node (the graph is no longer symmetric). Two caches, passenger and staff. Cells beside an edge that is open only to some audiences or only one way become walk nodes of the new kind `Gate` (4), joined by an explicit 2 m edge.
16. **Staff screening check.** Staff walk from every landside cell without crossing any transition edge. If they reach a Secure or International cell, the building shows `staffBypass` ("Staff route bypasses screening"). A staff lane is the screened way in, as the doc rule says.
17. **Wrong orientation.** A transition fixture with no transition edge (decision 12) shows `transitionOrientation` in the inspector, and its ghost shows the warning.
18. **Passengers cannot leave.** When a Secure or International floor cell cannot reach a Public cell in the passenger layer, the building shows `paxCannotLeave`.
19. **Zone tint moves to the overlay.** The baked chunk tint is removed. The zones overlay (`OverlayKind` `zones`) draws tints, inner edge lines and badges every frame, and turns on by itself while the zone tool or the door tool is active. Colors are CSS tokens `--zone-public`, `--zone-commercial`, `--zone-secure`, `--zone-international`, `--zone-staff`, `--zone-breach` in `src/ui/theme.css`, where the repo keeps its tokens (`src/ui/tokens` does not exist).
20. **Mode in the inspector.** The select tool picks a fixture inside a terminal; the terminal panel then shows a fixture block with the name, level and, for passport, eGate and security, a mode switch. The switch sends `terminalBuild` with the new edit op `mode` on that cell, free of charge. The fixture tool's context bar also offers the mode and the security exit level used at placement.
21. **Old saves (version 26 to 27).** Every painted zone, wall and door stays. Tails get `fixtureOff` 1, fixture cells get level 1 and mode 0. Each one cell security lane gets the first rotation, tried 0 to 3, whose flow crosses from Public or unzoned into Secure, with the anchor on either side of that edge; else rotation 0. Layouts that relied on open edges between zones (for example a gate desk or toilet cell painted Secure inside a Public hall) now show breaches; that is the new rule.
22. **Save version.** This task uses version 27. The T54 track also takes 27; the orchestrator renumbers at merge.

## Open questions (not settled by the docs; ask the owner before the named slice)

1. A commercial region touching both Secure and International but no landside: breach (proposed, conservative) or allowed? Interim in S5: breach.
2. Fixtures whose first allowed zone is Secure (seating, toilet, gate desk) placed on unzoned landside floor paint a Secure island, which is now a breach. Keep the doc rule (first allowed zone) or prefer Public when the fixture allows it? Interim: doc rule unchanged.
3. May seating and toilets stand in International? `docs/TERMINAL_ZONING.md` section 7 widens only passport, gate desk and shops. Interim: unchanged.
4. Build costs, which `docs/TERMINAL_FIXTURES.md` section 12 says are not invented. Proposed for the owner: staffed exit 30 000, automated exit lane 85 000, revolving exit door 60 000, automated passport gate 25 000, customs channel 40 000, staff door 2 500 per edge. Blocks S3.
5. Whether a staff door can be the curb. Interim: no, the curb is the first plain door node on Public floor.

## Requirements

1. `ZONES`, `ZONE`, `WALL`, `FIXTURE_KEYS`, `FIXTURE_ZONES` (`passport` `[3, 5, 1]`, `gateDesk` `[3, 5]`, shops `[2, 3, 5]`, `securityExit` `[3, 1]`, `eGate` `[3, 5, 1]`, `customs` `[1]`), `FIXTURE_SPAN` and the new `FIXTURE_FOOTPRINT` hold the appended entries; nothing is inserted in the middle.
2. Fixtures of any rectangular footprint place, erase and draw as one body; level and mode are stored per footprint cell and saved.
3. The zone tool paints all five zones in a rectangle mode and a brush mode; a fixture on an unzoned cell paints it with its first allowed zone.
4. The door tool places a plain door or a staff door (`WALL.StaffDoor`), priced from `business.json`.
5. The security exit is placed at level 1, 2 or 3 with its own footprint and kit sprite. The automated passport gate and the customs channel are placed and drawn from the kit. Passport control and the eGate carry a mode set at placement and in the inspector; security lanes carry a passenger or staff use.
6. `src/shared/terminalZones.ts` computes effective zones, the edge access table, the breach list, the badges and the zone issues (`zoneBreach`, `transitionOrientation`, `paxCannotLeave`, `staffBypass`).
7. The walking graph removes breach edges, keeps transition edges one way, keeps staff doors to the staff layer, and answers distances per audience. Service queues stay on the entry side of a transition fixture.
8. The terminal inspector and the readiness list show the zone issues; every new problem and issue key has a string in `en.json`.
9. The zones overlay draws the section 5 tints (staff hatched), a 0.24 m inner edge line along every zone boundary, a transition badge on the exit edge of every transition fixture and a breach badge on every breach edge, without overlaps.
10. Save version 27 with the migration of decision 21; restored saves hash like an uninterrupted run.
11. Determinism test (2 000 ticks twice from one seed with a zoned terminal, identical hashes) and a save mid run test.

## Acceptance criteria

1. Walking graph: no path crosses a breach. A passenger crosses Public to Secure only through a security lane and Secure to Public only through a security exit (`tests/zoningWalk.test.ts`).
2. Direction: a security exit placed backwards carries no one into Secure, and no one out of it.
3. Staff doors: staff pass, passengers never do.
4. Validation lists every breach of a test layout, and the badge list has one breach badge per breach and one transition badge per transition fixture.
5. Save migration from version 26 keeps every painted zone, wall and door, and infers lane directions.
6. A domestic arrival path: from a gate desk in Secure, the passenger layer reaches the curb only through a security exit (walk graph test; the arrival journey is T20).
7. Determinism and save mid run tests pass; full `npm run verify` and the e2e smoke pass; stress numbers reported.
8. Screenshots of `handoff/scenarios/T75-zoning.json` at about 2 and 14 px/m match the zoned terminal of `docs/art/terminal_zones_kit.png`: tints, edge lines, badges and the new fixtures.

## Orchestrator answers (2026-11-18, under the owner rule that missing numbers are proposed and reported)

1. A commercial area touching both Secure and International is a breach.
2. Placement on unzoned floor keeps the doc rule: the cell takes the first allowed zone.
3. Seating and toilets may stand in International: `FIXTURE_ZONES.seating` and `toilet` gain 5.
4. Build costs as proposed: security exit levels 1 to 3 at 30 000, 85 000 and 60 000, eGate 25 000, customs 40 000, staff door 2 500 per edge.
5. A staff door never serves as the curb.
