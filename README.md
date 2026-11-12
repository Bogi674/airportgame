# Airfield Tycoon

A browser based airport management game with real world scale, built in TypeScript with Canvas 2D.

It benchmarks the mechanics of Airport CEO and adds real scale, free placement and procedural airlines, destinations, tenants and events.

* `ROADMAP.md`: what is built and what is left. Start here for scope.
* `CLAUDE.md`: rules and workflow for development.
* `docs/`: game design, design revisions, architecture, performance, browser delivery, art and assets, UI design, aircraft database and airlines.
* `handoff/`: specs of open tasks, pitfalls, recipes and the code map.

## Play

Build the single offline file and open it in a desktop browser. No server and no network are needed:

```bash
npm install
npm run build:offline
```

Or play online at https://bogi674.github.io/airportgame/ once the pages workflow has run. To build it yourself, open `dist-offline/airfield-tycoon.html` (Chrome, Edge, Firefox or Safari). Saves stay in the browser. Use Menu, Export to file to keep a copy.

### First game, step by step

1. **New game**, pick a terrain preset and start. Parcels outlined in yellow are yours, press P to see land you can buy. Building on land you do not own offers a buy button.
2. **Runway:** left rail, runway tool. Drag along the long axis of your land. The Getting started panel ticks off each step.
3. **Taxiway:** use the parallel taxiway tool next to the runway. Holding positions, curves and markings appear on their own.
4. **Apron and stands:** draw an apron beside the taxiway, then place a stand row.
5. **Terminal:** terminal tool. Lay a foundation, flooring and walls. Paint zones: public for check in, secure for seating, staff only for the control room and belts. Build a wall between public and secure with one opening, put the security lanes in the opening, then add check in desks, a baggage belt and seats. The checklist names anything still missing.
6. **Tower:** build menu, Flight operations, Air traffic control. Place the tower and pick its level.
7. **Airlines:** top right, Airlines. Sign one, then drag its flights onto a stand row in the stand timeline, or switch on automation.
8. Press 2x, 4x or 8x and watch aircraft land, turn around and depart. Finance shows income. Save from the menu button, or let the autosave run.

Handy: the circle buttons on the left switch tools, click the active tool again to hide its options. The eye button shows waiting and deadlocked aircraft. Settings holds the light and dark theme and graphics quality.

## Develop

Commands, rules and workflow are in `CLAUDE.md`. The plan is in `ROADMAP.md`.
