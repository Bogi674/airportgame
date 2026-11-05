# T27. Draw order rules

Milestone M5. Roadmap line: "Draw order rules (vehicles under wings, never over aircraft)".

## Goal

Vehicles under a wing or tail are drawn beneath the aircraft; no vehicle is ever drawn over an aircraft body; the map layer order follows `docs/ART_AND_ASSETS.md` section 3.

## Read first

* `docs/ART_AND_ASSETS.md` section 3 (map layer order) and section 12.
* `src/render/renderer.ts`: `drawVehicles`, `drawAircraft`, the frame order in `render`.
* T26 overhead zones.

## Requirements

* R1. Render order per frame: ground markings, vehicles that are not under any aircraft, aircraft, then nothing vehicle related above aircraft. Vehicles under an overhead zone are drawn before the aircraft that covers them; with several aircraft, sort by the covering aircraft.
* R2. The covering test uses the cached overhead zones from T26 in the aircraft's frame; no allocation per frame.
* R3. A Playwright visual test or a screenshot scenario of a docked A320 with refueller under the wing and a belt loader at the door: the refueller is hidden under the wing, the belt loader is visible.
