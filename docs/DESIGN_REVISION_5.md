# DESIGN REVISION 5: Terminal asset kit, fixture levels, zoning and the baggage network

> **Revision 6 note (2026-11-25):** `docs/DESIGN_REVISION_6.md` overrides the same footprint rule for the check in desk: its art is 2, 3 and 4 m wide on 1, 2 and 2 whole cells, and security lane level 1 has the simpler Revision 6 look. Everything else here stays.

Status: asked for by the user on 2026-11-17 and 2026-11-18 in the terminal kit sessions. The gameplay values marked **Confirm** in the documents below are proposals and go to the owner in one decision batch (`handoff/QUESTIONS.md`, 2026-11-18 R5).
Authority: this document and the three documents it names override `docs/GAME_DESIGN.md` section 8, `docs/ART_AND_ASSETS.md` section 11 and older lines about terminal fixtures, zones and baggage wherever they disagree. Revisions 2, 3 and 4 stay in force for everything else.

## 1. Documents

| Document | Covers |
| --- | --- |
| `docs/TERMINAL_FIXTURES.md` | Every terminal asset, its look, levels, footprint, placement layer, stats, detail tiers, and the exported data the game loads |
| `docs/TERMINAL_ZONING.md` | Zone types, transitions, painting and breach validation, the zones overlay, staff doors |
| `docs/BAGGAGE.md` | Baggage nodes, ramp stubs, automatic under floor links, routing, overlay |

## 2. Decisions

1. **Assets ship as data.** All terminal art is in `src/data/fixtures/catalog.json` and `src/data/fixtures/sprites/*.json`, generated from the Python reference by `docs/reference/sprite-prototypes/export_fixtures.py`. One generic baker draws every asset. Hard rule 12 holds: the sprites are vector geometry in meters, baked at the zoom band.
2. **Levels.** Check in desk, security lane, passport control and boarding gate desk have levels 1 to 3 with the same footprint, upgraded in place through a works job. Level 1 keeps today's values. Automated variants: self check in kiosk, self bag drop, automated passport gate.
3. **Fixtures and props.** Service fixtures stay on the 2 m grid. Furniture, washroom items, decoration, vending, screens, office and back of house items are props on a 0.5 m sub grid inside rooms.
4. **Zoning like Airport CEO, with this game's rules.** Public, commercial, secure and staff stay; international is appended. People cross a zone edge only through a transition fixture (security lane, security exit, passport control, automated passport gate) or a staff door. Any other opening between zones is a breach.
5. **Security exit.** The way out of the secure zone, in three levels: staffed lane, automated anti return lane, one way revolving door.
6. **Baggage.** The player places nodes, the game links them under the floor with the rules A to F of `docs/BAGGAGE.md`. Check in desks of every level carry their belt down the middle of the cell so it meets the ramp.
7. **Stand scenes** use the stand markings of `docs/art/surfaces_stands.png`, the jet bridge of revision 3 section 4.2 as drawn by `apron_stand.jet_bridge`, and the aircraft in the composite livery of `docs/art/aircraft_style.png`.
8. **Circulation.** Escalators, stairs, elevators and travelators are drawn now. Travelators work on one floor; the vertical links work when the multi floor designer (T51) lands.

## 3. Reference sheets

`docs/art/terminal_processing_kit.png`, `terminal_security_kit.png`, `terminal_furniture_kit.png`, `terminal_amenities_kit.png`, `terminal_office_infra_kit.png`, `terminal_zones_kit.png`, `baggage_kit.png`, `terminal_scene_kit.png`, `fixture_catalog.png`. They are the acceptance target, as the aircraft sheets are for revision 3.

## 4. Task impact

| Task | Change |
| --- | --- |
| T73 (new) | Fixture sprite baker and kit loading, existing terminal fixtures drawn from the kit |
| T74 (new) | Fixture levels and in place upgrades |
| T75 (new) | Zoning revision: international zone, transitions, security exits, staff door, breaches, zones overlay |
| T76 (new) | Props on the sub grid: furniture, washrooms, decoration, vending, screens, service, office, back of house, with their effects |
| T77 (new) | Circulation art and placement, travelator on one floor |
| T43 | Rewritten against `docs/BAGGAGE.md`, sprites from the kit. Depends on T73 |
| T20 | Immigration through passport control or the automated gate in arrival mode, then baggage claim and the customs channel |
| T44 (MVP 2) | Fixture variants are now covered by levels; T44 keeps architecture variants only |
