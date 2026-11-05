# T35. Menus, wizard, load, settings, pause

Milestone M7. Roadmap line: "Main menu, new game wizard, load screen, settings, pause menu per `docs/UI_DESIGN.md` (simplified compared to UI_DESIGN.md)".

## Goal

The screens outside the game match `docs/UI_DESIGN.md` section 4 and the design tokens of section 3.

## Read first

* `docs/UI_DESIGN.md` sections 1 to 4 and 8 (accessibility), `docs/BROWSER.md` sections 6 and 7.
* `src/ui/Menu.tsx`, `src/ui/PauseMenu.tsx`, `src/ui/saves.ts`, `src/ui/theme.ts`, `src/ui/theme.css`.
* `e2e/menus.spec.ts`.

## Step 1. Gap table

In the work file, list every element section 4 describes and whether it exists. Implement only the missing ones.

## Requirements

* R1. Each missing element from the gap table, using tokens only (no raw colors in components).
* R2. The new game wizard has the three steps in one panel as section 4 describes.
* R3. Keyboard reach for every control; focus visible.
* R4. `e2e/menus.spec.ts` covers the wizard, load, settings and pause.
* R5. Screenshots of each screen at 1280 by 720 and 1920 by 1080; nothing overflows or overlaps.
