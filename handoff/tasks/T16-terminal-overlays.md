# T16. Density, queue and walking distance overlays

Milestone M4. Roadmap line: "Density, queue and walking distance overlays".

## Goal

Three terminal overlays, each one at a time with a legend chip, as `docs/UI_DESIGN.md` section 5 "Overlays" describes: passenger density per cell, queue length and wait per service node, and walking distance from landside entrances to each gate.

## Read first

* `docs/UI_DESIGN.md` sections 5 (overlays) and 10 (UI performance rules).
* `drawOverlay` in `src/render/renderer.ts` and `src/render/overlayRamp.ts`, the terminal overlay ramp, and how the UI toggles the traffic overlay.
* T12 (walking graph), T13 (service nodes), T14 (cohorts).

## Requirements

* R1. The sim publishes, at most once per game minute, compact typed arrays per building: people per cell (from cohort nodes), queue length and wait estimate per service node, walking distance per gate node from the nearest entrance.
* R2. The renderer draws each overlay as a color ramp over the terminal cells with a legend chip (scale and close button), colors from the design tokens, readable in light and dark themes.
* R3. Key O opens the overlay list; picking one closes the others.
* R4. Strings and `docs/UI_DESIGN.md` updates.

## Tests

The sim side arrays for a scripted terminal: density sums to the number of people inside; queue values match T13's `serviceWait`.

## Visual check

Each overlay on a busy terminal, legend chip fully visible and not over the minimap or panels.
