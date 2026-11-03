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
