# T36. Left rail flyouts, alert center, overlay list

Milestone M7. Roadmap line: "HUD: top bar, left rail with flyouts, context bar, inspector, alert center, toasts, overlays". Top bar, tool rail, context bar, inspectors, toasts and sheets exist.

## Goal

The left rail opens flyouts, alerts collect in an alert center, and the overlay list (key O) lists every overlay built so far, as `docs/UI_DESIGN.md` section 5 describes.

## Read first

* `docs/UI_DESIGN.md` sections 5 and 7, `src/ui/ToolRail.tsx`, `src/ui/Toasts.tsx`, `src/ui/alerts.ts`, `src/ui/App.tsx`.

## Requirements

* R1. Left rail flyouts per section 5 "Left rail", replacing or complementing the bottom build menu as the section says; ask the user if the two conflict.
* R2. Alert center: a list of alerts with time, tone and a jump to the object when it has a position; unread count on its button; alerts also still toast.
* R3. Overlay list on key O with every overlay that exists (traffic, obstacle surfaces, density, queues, walking distance, staffing coverage, baggage load, parcels), one at a time, legend chip.
* R4. Controls table in section 7 updated; e2e test opens each flyout, the alert center and the overlay list.
