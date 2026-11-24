# TERMINAL_ZONING.md

How terminal zones work: what each zone means, how people cross between zones, and what the player sees. The mechanic mirrors the zone painting of Airport CEO with this game's own rules and art. Reference sheet: `docs/art/terminal_zones_kit.png`. Fixture art: `docs/reference/sprite-prototypes/fixtures_zoning.py`. This document wins over older lines about zones in other docs.

## 1. What exists today

`src/shared/business.ts` already has `ZONES = ['none', 'public', 'commercial', 'secure', 'staff']`, a zone byte per cell in `TerminalGrid.zone`, `FIXTURE_ZONES` per fixture, and `WALL = { None, Wall, Glass, Door }`. Room validation and the service node search already read the zone. This revision extends that model. Saved lists are only appended to, never reordered.

## 2. Zone types

| Index | Key | Name | Meaning |
| --- | --- | --- | --- |
| 0 | none | Unzoned | Behaves as Public. The room tool asks the player to zone it |
| 1 | public | Public, landside | Open to everyone: check in, bag drop, kiosks, arrivals hall, baggage claim, customs, landside shops |
| 2 | commercial | Commercial | Shop units. A commercial area takes the security side of the zones it touches. One that touches both landside and airside cells is a breach |
| 3 | secure | Secure, airside domestic | After security. Domestic gates and airside shops. Left only through a security exit |
| 4 | staff | Staff only | Back of house: offices, baggage screening room, janitor room, control rooms. Entered only through a staff door |
| 5 | international | International, airside | Appended. After passport control on departure, and the arrival side before immigration. International gates and their shops |

The apron outside the building is airside for vehicles and staff. It is not painted.

Landside means zone 1 and landside commercial. Airside means zones 3 and 5 and airside commercial.

## 3. Transitions

People cross the edge between two different zones only through one of these. Every other opening between two zones is a breach.

| From | To | Through | Who | Direction |
| --- | --- | --- | --- | --- |
| Public | Secure | Security lane, levels 1 to 3 | Departing passengers, crew | One way |
| Secure | Public | Security exit: staffed lane, automated exit lane or revolving exit door | Domestic arrivals, passengers who leave | One way |
| Secure | International | Passport control or automated passport gate, departure mode | International departures | One way |
| International | Public | Passport control or automated passport gate, arrival mode | International arrivals | One way |
| Any | Staff | Staff door with card reader | Staff only | Both ways |
| Staff | Secure | Staff door | Staff who passed staff screening | Both ways |

Passport control and the automated gate carry a mode, departure or arrival, set in the inspector. The mode fixes which side is the entry. A desk in the wrong orientation shows a warning.

Customs is not a zone edge. The customs channel is a node of the international arrival journey inside Public, between baggage claim and the landside hall (T20).

Staff screening: a staff route from Public into Secure through a Staff room must pass a security lane set to staff use, or the room shows Staff route bypasses screening. **Confirm.**

## 4. Painting and validation

* The zone tool paints cells like the floor tool, with a brush and a rectangle mode. Fixtures with a zone list in the catalog (`src/data/fixtures/catalog.json`, field `zones`) may only stand on those zones. Placing a fixture on an unzoned cell paints that cell with the first allowed zone, as today.
* A transition fixture straddles the edge: its entry cells belong to the from zone and its exit cells to the to zone. The ghost shows both zone colors.
* A transition fixture carries its zone blocks (T87): placing or moving one paints the cells before its intake with its from zone and the cells past its exit with its to zone, as wide as the fixture and `terminal.transitionPadCells` deep (`src/data/business.json`, 2). The exit block paints over unzoned cells and the from zone, the intake block over unzoned cells only, and neither paints a cell whose fixture refuses the zone. A fixture whose intake already lies in its to zone counts as backwards and its exit block paints unzoned cells only. The ghost tints both blocks and labels the intake and the exit. Each placement shows a reminder, and the exit badge pulses until the region of the to zone joined to the exit block is larger than the block.
* A breach is any walkable edge between two cells of different zones that is not inside a transition fixture and not a staff door. The room tool lists every breach with a red badge, and the walking graph removes the edge so no one walks through.
* Walls and glass never breach. A plain door or a gap between two zones always does.
* The walking graph keeps one layer per audience: passengers walk only through transition edges in their allowed direction, staff also through staff doors.
* A secure or international area with no way out (no security exit, no immigration) warns Passengers cannot leave.

## 5. Overlay

The zones overlay tints each zone and outlines its edge, so a glance shows the security sides.

It also shows by itself while the terminal tool is open (T87). A breach badge that would touch a transition badge, a pending exit ring or another breach badge is left out, so badges never overlap.

| Zone | Color | Fill |
| --- | --- | --- |
| Public | #3ea35a | 28 percent tint |
| Commercial | #2f9d8f | 28 percent tint |
| Secure | #2f6fd1 | 28 percent tint |
| International | #7a4fd0 | 28 percent tint |
| Staff | #d9463e | 45 degree hatch, 16 percent tint |

* Every zone rectangle gets a 0.24 m inner edge line in its color.
* A transition badge (white circle with an arrow in the color of the zone it leads into) sits on the exit edge of every transition fixture.
* A breach badge (red circle with an exclamation mark) sits on every breach edge.
* Tokens to add to `src/ui/tokens`: `zonePublic`, `zoneCommercial`, `zoneSecure`, `zoneInternational`, `zoneStaff`, `zoneBreach`.

## 6. Transition fixtures

All drawn in `fixtures_zoning.py` and listed in the catalog under category `zoning`, except the security lane, passport control and the automated passport gate, which are processing fixtures.

| Fixture | Footprint | Proposed values | Notes |
| --- | --- | --- | --- |
| Security exit, staffed | 4 x 4 m | 1 200 people per hour, 1 officer. **Confirm** | Lane between glass, officer podium, drop arm, no entry sign on the exit side |
| Automated exit lane | 2 x 6 m | 900 people per hour, no staff. **Confirm** | Anti return corridor with two pairs of sliding doors, sensors, ceiling camera |
| Revolving exit door | 2.6 m drum | 1 500 people per hour, no staff. **Confirm** | One way drum, three wings |
| Staff door | 2 m door on a wall edge | Card reader | Appended wall type `StaffDoor` (index 4). Placed by the wall tool as a door variant |
| Customs channel | 4 x 4 m | 8 s on the green channel, 5 percent sent to the red channel for 120 s, 2 officers. **Confirm** | Green and red channels, inspection bench, small x-ray |

The three security exits are one family (`securityExit`) with levels 1 to 3 that keep the same transition rule.

## 7. Data and code changes

* Append `international` to `ZONES` and `International: 5` to `ZONE`.
* Append `StaffDoor: 4` to `WALL`.
* Append fixture keys `securityExit`, `eGate`, `customs` at the end of `FIXTURE_KEYS`, with their `FIXTURE_ZONES` and `FIXTURE_SPAN` entries. Never insert in the middle.
* Store passport and automated gate mode per fixture (departure or arrival) and the security exit level, with a save migration.
* `FIXTURE_ZONES.passport` becomes `[3, 5, 1]`, `gateDesk` becomes `[3, 5]`, shops may stand on `[2, 3, 5]`.

## 8. Tests

* Walking graph: no path crosses a breach. A passenger crosses Public to Secure only through a security lane and Secure to Public only through a security exit.
* Direction: a security exit placed backwards carries no one into Secure.
* Staff doors: staff pass, passengers never do.
* Validation lists every breach of a test layout and the overlay draws one badge per breach.
* Save migration from the previous version keeps every painted zone.
