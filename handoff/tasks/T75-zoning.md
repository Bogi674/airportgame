# T75. Zoning revision (draft)

Phase 3b. Draft written 2026-11-18. Run `grill-me` first.

## Goal

Zones work like the Airport CEO mechanic with this game's rules: people cross a zone edge only through a transition fixture or a staff door, and the zones overlay shows the security sides at a glance.

## Read first

`docs/TERMINAL_ZONING.md` (all), `docs/art/terminal_zones_kit.png`, `docs/reference/sprite-prototypes/fixtures_zoning.py`, `src/shared/business.ts` (`ZONES`, `ZONE`, `WALL`, `FIXTURE_ZONES`), `src/shared/terminalRooms.ts`, `src/sim/terminal/walkGraph.ts`, `src/sim/terminal/serviceNodes.ts`.

## Settled

* Append `international` (5) to the zones and `StaffDoor` (4) to the wall types. Append `securityExit`, `eGate`, `customs` to `FIXTURE_KEYS`.
* Transition table and breach rule of `docs/TERMINAL_ZONING.md` sections 3 and 4.
* Passport control and the automated gate carry a departure or arrival mode.
* Overlay colors, badges and tokens of section 5.

## Open for the interview

Staff screening rule (section 3, Confirm), security exit throughput and staff, automated gate referral share and staffing, customs values.

## Requirements

1. Walking graph edges between different zones exist only inside transition fixtures, in their allowed direction, and at staff doors for staff.
2. Room validation lists breaches; the overlay draws a badge per breach and per transition.
3. Tools: zone brush and rectangle, staff door as a door variant, the new fixtures from the catalog.
4. Save migration keeps every painted zone and door.

## Acceptance

Tests of `docs/TERMINAL_ZONING.md` section 8, a scenario where a domestic arrival leaves through a security exit, the overlay matches `terminal_zones_kit.png`.
