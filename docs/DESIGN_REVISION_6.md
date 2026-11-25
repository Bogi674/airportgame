# DESIGN REVISION 6: Check in desk sizes, basic security lane, doors and windows

Status: asked for by the user on 2026-11-25. Values marked **Confirm** are proposals. The footprint of the check in desk was settled by the owner on 2026-11-25: whole cells only (section 1). Slice 1 (desk sizes, security level 1) is built, slice 2 (doors and windows, section 3) is open.
Authority: this document overrides `docs/DESIGN_REVISION_5.md` decision 2 (same footprint for every level) for the check in desk, and `docs/TERMINAL_FIXTURES.md` sections 4.1 and 4.2 (level 1 look) and 6 (adds openings). Everything else in Revision 5 stays.

Art lives in `docs/art/rev6/`. Sheet: `docs/art/rev6/sheet_rev6.png`. Generator: `docs/reference/sprite-prototypes/fixtures_rev6.py`. Draw ops: `ops_pack_rev6.json`. Catalog entries: `catalog_rev6.json`. Build task: `handoff/tasks/REV6-terminal-assets.md`.

## 1. Check in desk, three sizes

The desk grows with its level. The belt lane stays at x 0.6 to 1.4 m of the left cell for every level, so the out ramp cell is always the cell directly behind the left cell, as in `docs/BAGGAGE.md` 7.1 and 7.2. Growth goes to the right, so an upgrade keeps the ramp, the agent spot and the passenger spot where they were.

| Level | Art m | Grid cells | Look | Service time | Agents |
| --- | --- | --- | --- | --- | --- |
| 1 | 2 x 2 | 1 x 1 (2 x 2 m) | Laminate counter, plain belt, scale plate, one monitor, livery fascia, bare ledge | 120 s | 1 |
| 2 | 3 x 2 | 2 x 1 (4 x 2 m) | Stone counters, powered belt with rails, glass divider, livery back panel, customer display, tag printer and card reader on a longer ledge | 105 s. **Confirm** | 1 |
| 3 | 4 x 2 | 2 x 1 (4 x 2 m) | Curved walnut and stone, chrome belt with status light, backlit livery panel, glass fins, premium host counter with a second display and a vase, burgundy floor mat | 95 s. **Confirm** | 1 |

* **Whole cells only (owner, 2026-11-25).** The terminal grid is one byte per 2 m cell and there is no half cell snap. Level 3 is 2 x 1 cells as requested. Level 2 occupies the same 2 x 1 cells with 3 m of art, which starts at the anchor end and leaves a 1 m walkable strip at the tail end. This replaces the earlier proposal of a 1.5 cell footprint.
* The catalog `size` stays the art size in meters and a new `cells` field holds the game footprint as [along, across] cells. The game reads the footprint through `footprintOf('checkIn', level)` and the helper `checkInSpan(level)`.
* Agent position (0.3, 0.4) m and passenger position (1.0, 1.85) m are the same for all levels, stored in the catalog `service` field. The sim does not use hard coded desk offsets, so the points are data only for now.
* Out ramp: cell (0, -1) relative to the left (anchor) cell, direction out, all levels and all rotations. The tail cell of a larger desk has no chute.
* Upgrade is no longer fully in place. Level 1 to 2 takes one more cell to the right of the desk, rotated with it. Level 2 to 3 needs no new cell. The upgrade command refuses with Needs room to the right when that cell has no floor, holds a fixture, a floor prop or a solid wall edge, lies on the use area of another fixture, or when the larger use area is blocked. The inspector disables the button and the selected desk shows the blocked cells hatched red. The cell is taken when the works end; a cell taken meanwhile cancels the works with a full refund. Cancelling the works leaves the old level and footprint.
* Saves before version 45 hold level 2 and 3 desks as one cell. On load each desk keeps its anchor and grows into the cell beside it; a desk with no room drops to level 1 with an alert and is never deleted. The drop does not refund the price difference. **Confirm.**

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
**Confirm** whether level 1 should need 3 officers instead of 4, since it has fewer stations (open in `handoff/QUESTIONS.md`, 2026-11-25). Optional later step: shrink level 1 to 12 x 4 m. The art swap is done (asset id `security.l1`).

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
