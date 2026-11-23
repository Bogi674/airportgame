# T35. Menus, wizard, load, settings, pause

Phase 5. Refreshed on 2026-11-23 with the owner's answers (see `handoff/QUESTIONS.md`, 2026-11-23 T35).

## Goal

The screens outside the game follow `docs/UI_DESIGN.md` section 4 in the MVP 1 scope the owner set: a career and a sandbox mode, a two step new game panel, named saves with thumbnail cards, basic settings and a full pause menu.

## Read first

* `docs/UI_DESIGN.md` sections 3, 4 and 8, `docs/BROWSER.md` sections 6 and 7.
* `src/ui/Menu.tsx`, `src/ui/PauseMenu.tsx`, `src/ui/saves.ts`, `src/ui/App.tsx`, `src/worker/sim.ts`.

## Decisions (owner, 2026-11-23)

1. New game has two steps in one panel: Site (seed with shuffle, preset cards, a live mini map with the wind rose and the ideal runway heading) and Airport (name, generated IATA and ICAO style codes that can be edited, brand color). The Rules step waits for MVP 2.
2. Main menu: a dimmed demo airport with a slowly moving camera behind a narrow column with Continue, New career, Sandbox, Load, Settings and Credits; the version number at the bottom.
3. Sandbox: cash never limits a build and shows as Unlimited, the whole site is owned from the start, airlines ignore the rating gates, events still happen. A sandbox save stays sandbox.
4. Saves: the pause menu offers Save (overwrites the slot the game was loaded from or last saved to) and Save as (a new slot with a typed name). Load cards show a map thumbnail, airport name, game date, passengers per year and the real date saved, with Load, Rename, Duplicate and Delete. Autosaves keep their own rotating slots per career and are grouped under it.
5. Settings: Display (quality, theme), Gameplay (autosave), Accessibility (reduced motion, text size). No rebinding or language.

## Requirements

* R1. `GameOptions` gains `mode` (career or sandbox) and `airport` (name, iata, icao, color); old saves load as career with a name made from the seed.
* R2. Sandbox rules of decision 3 in the sim, with a test.
* R3. A `preview` worker message returns the site of a seed and preset for the wizard mini map without starting a game.
* R4. The screens of decisions 1, 2, 4 and 5, tokens only, keyboard reachable with visible focus.
* R5. `e2e/menus.spec.ts` covers the wizard, save as, load cards and settings.
* R6. Screenshots of each screen at 1280 by 720 and 1920 by 1080 with nothing overflowing or overlapping.

## Acceptance

A player starts a sandbox and a career from the wizard with a name, saves twice under different names, finds both as cards with thumbnails, renames and duplicates one, and loads it back.
