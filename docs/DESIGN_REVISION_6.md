# DESIGN REVISION 6: Check in desk sizes, basic security lane, doors and windows

Status: asked for by the user on 2026-11-25. Values marked **Confirm** are proposals.
Authority: this document overrides `docs/DESIGN_REVISION_5.md` decision 2 (same footprint for every level) for the check in desk, and `docs/TERMINAL_FIXTURES.md` sections 4.1 and 4.2 (level 1 look) and 6 (adds openings). Everything else in Revision 5 stays.

Art lives in `docs/art/rev6/`. Sheet: `docs/art/rev6/sheet_rev6.png`. Generator: `docs/reference/sprite-prototypes/fixtures_rev6.py`. Draw ops: `ops_pack_rev6.json`. Catalog entries: `catalog_rev6.json`. Build task: `handoff/tasks/REV6-terminal-assets.md`.

## 1. Check in desk, three sizes

The desk grows with its level. The belt lane stays at x 0.6 to 1.4 m of the left cell for every level, so the out ramp cell is always the cell directly behind the left cell, as in `docs/BAGGAGE.md` 7.1 and 7.2. Growth goes to the right, so an upgrade keeps the ramp, the agent spot and the passenger spot where they were.

| Level | Footprint m | Cells | Look | Service time | Agents |
| --- | --- | --- | --- | --- | --- |
| 1 | 2 x 2 | 1 x 1 | Laminate counter, plain belt, scale plate, one monitor, livery fascia, bare ledge | 120 s | 1 |
| 2 | 3 x 2 | 1.5 x 1 | Stone counters, powered belt with rails, glass divider, livery back panel, customer display, tag printer and card reader on a longer ledge | 105 s. **Confirm** | 1 |
| 3 | 4 x 2 | 2 x 1 | Curved walnut and stone, chrome belt with status light, backlit livery panel, glass fins, premium host counter with a second display and a vase, burgundy floor mat | 95 s. **Confirm** | 1 |

* Level 3 is 2 x 1 cells as requested. Level 2 sits halfway at 1.5 cells.
* Agent position (0.3, 0.4) m and passenger position (1.0, 1.85) m are the same for all levels.
* Out ramp: cell (0, -1) relative to the footprint, direction out, all levels.
* Upgrade is no longer fully in place. Levels 2 and 3 take extra width to the right. The upgrade command needs a free strip (1 m for level 2, 2 m for level 3 counted from the level 1 footprint), otherwise it shows Needs room to the right. This is the same replace style as the security exit family in `docs/TERMINAL_FIXTURES.md` 5a.
* **Confirm** the 1.5 cell footprint of level 2. The terminal grid is one byte per 2 m cell, so a 3 m desk needs a half cell snap along its width. Fallback if that is too costly: level 2 occupies 2 x 1 cells with the 3 m art and a 1 m walkable strip with a queue post, which makes levels 2 and 3 share a grid footprint.

## 2. Security checkpoint, level 1 simplified

Same 16 x 4 m footprint and the same stats as before, so levels 2 and 3 and the in place upgrade are untouched. The look drops to what a small airport really has:

1. Wait line and two stanchion posts with tape
2. ID check podium
3. Tray table with trays
4. Single view x-ray on short feed and exit belts, with a standing operator desk
5. Walk through detector
6. Hand search mat
7. Reclaim table with gravity rollers
8. Re dress bench and bin

Removed from level 1: retractable belt funnel, glass guides, tray cart, powered parts, status lights beyond the detector. Level 2 keeps its documented parts (pass reader, glass guides, roller divest, dual view x-ray, two screen operator desk, reject and trace tables), so the two levels now read very differently.
**Confirm** whether level 1 should need 3 officers instead of 4, since it has fewer stations. Optional later step: shrink level 1 to 12 x 4 m.

## 3. Doors and windows

Walls stay on the 2 m edge grid, 0.6 m thick. Every opening sprite is 0.6 m deep and replaces the wall piece on its edge.

| Asset | Sprite m | Edges | Opening | Clear | Detail |
| --- | --- | --- | --- | --- | --- |
| `door.s` | 2 x 0.6 | 1 | 1.0 m | 0.9 m | Single leaf, 0.5 m wall stubs, hinge left, swing arc radius 0.9 m toward +y |
| `door.m` | 2 x 0.6 | 1 | 2.0 m | 1.88 m | Double leaf with glass, two swing arcs radius 0.91 m. This is today's 2 m door, so the old `Door` maps here |
| `door.l` | 4 x 0.6 | 2 | 4.0 m | 3.2 m | Automatic sliding, two tracks, fixed side lites, sensors. No swing arc |
| `window.s` | 2 x 0.6 | 1 | 1.0 m | none | One lite, 0.5 m wall stubs, outer ledge, inner stone sill |
| `window.m` | 2 x 0.6 | 1 | 2.0 m | none | Two lites, center mullion |
| `window.l` | 4 x 0.6 | 2 | 4.0 m | none | Four lites, three mullions |

* Swing arcs are floor clearance and may leave the footprint. Fixtures, ramp cells and props cannot stand on them. Door side and hinge side are mirrors set at placement.
* Doors are walkable edges, windows block walking and let light and sight through. Walking capacity of a door edge scales with its clear width. **Confirm** the flow rate.
* No gameplay effect for windows in this revision. **Confirm** later whether windows add daylight or ambience.
* Opening parts carry no `ht`, so they share the wall shadow pass. If the wall renderer has no baked shadow, keep it that way.
* The staff door (wall type `StaffDoor`, 2 m with card reader) keeps its own art and size.
* Prices, upkeep and build time: to be proposed, not invented here.

## 4. Palette

No new tokens. The art uses `fxOutline`, `counter`, `stone`, `walnut`, `oak`, `steel`, `machine`, `belt`, `screen`, `glow`, `glass`, `ok`, `porcelain`, `leaf`, plus the existing wall color `#2c3441`. Extra literals used once: wall edge `#1c222c`, dark steel `#9aa3ad`, tray blue `#3a6ea5`, premium mat burgundy `#7a2e3b` (same as the premium gate desk mat), markYellow for the wait line and search mat.
