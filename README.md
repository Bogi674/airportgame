# Airfield Tycoon

A browser based airport management game with real world scale, built in TypeScript with Canvas 2D.

This repository currently holds the design package for development with Claude Code:

* `CLAUDE.md`: rules and workflow for Claude Code. Start here.
* `docs/`: game design, architecture, performance, browser delivery, art and assets, UI design, aircraft database, airlines and the roadmap.
* `docs/art/`: visual reference sheets.
* `docs/reference/sprite-prototypes/`: Python reference code for sprites, markings and collision checks. Not shipped.
* `src/data/`: aircraft and ground vehicle data.

## Play

Build the single offline file and open it in a desktop browser. No server and no network are needed:

```bash
npm install
npm run build:offline
```

Then open `dist-offline/airfield-tycoon.html` (Chrome, Edge, Firefox or Safari). Saves stay in the browser. Use Menu, Export to file to keep a copy.

### First game, step by step

1. **New game**, pick a terrain preset and start. Parcels outlined in yellow are yours, press P to see land you can buy. Building on land you do not own offers a buy button.
2. **Runway:** left rail, runway tool. Drag along the long axis of your land. The Getting started panel ticks off each step.
3. **Taxiway:** use the parallel taxiway tool next to the runway. Holding positions, curves and markings appear on their own.
4. **Apron and stands:** draw an apron beside the taxiway, then place a stand row.
5. **Terminal:** terminal tool. Lay a foundation, flooring and walls. Paint zones: public for check in, secure for seating, staff only for the control room and belts. Build a wall between public and secure with one opening, put the security lanes in the opening, then add check in desks, a baggage belt and seats. The checklist names anything still missing.
6. **Control room:** paint 4 or more staff only cells and fill them with the control room fixture, within 3.5 km of the runway.
7. **Airlines:** top right, Airlines. Sign one for a few rotations a day. Slots lets you move each arrival time.
8. Press 2x, 4x or 8x and watch aircraft land, turn around and depart. Finance shows income. Save from the menu button, or let the autosave run.

Handy: the circle buttons on the left switch tools, click the active tool again to hide its options. The eye button shows waiting and deadlocked aircraft. Settings holds the light and dark theme and graphics quality.

## Develop

```bash
npm run dev       # dev server
npm run test      # unit tests (the 500 seed fairness test takes about 3.5 minutes)
npm run lint
npm run build
npm run stress    # headless benchmark
npm run e2e       # Playwright, set PW_CHROMIUM_PATH to use an installed Chromium
```

See `docs/ROADMAP.md` for what is done and what is still missing.
