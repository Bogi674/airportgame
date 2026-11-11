# T11: Kiosk, bag drop, passport booth, gate desk

Status: doing
Branch: claude/eager-davinci-9lp0hn

## Requirements

See `handoff/tasks/T11-fixtures.md` R1 to R7.

## Decisions (user, 2026-11-11)

* D1. Footprint storage: new per cell layer `fixtureRot: Uint8Array` on `TerminalGrid`. Save version 11 to 12, migration fills zeros.
* D2. Capacity: plain sum. Check in capacity per hour = desks * 30 + kiosks * 48 + bag drops * 90.
* D3. Costs, balanced set: kiosk 6000 staff 0, bagDrop 24000 staff 0.5, passport 18000 staff 1, gateDesk 12000 staff 1.

## Design

### Ids and zones

`FIXTURE_KEYS` appends `kiosk` 13, `bagDrop` 14, `passport` 15, `gateDesk` 16. `isShopFixture` stays ids 6 to 11.

`FIXTURE_ZONES`: kiosk `[Public]`, bagDrop `[Public]`, passport `[Secure]`, gateDesk `[Secure]`. Zones do not model international, so the passport booth is airside (task R4).

`FIXTURE_SPAN: Record<FixtureKey, 1 | 2>` in `src/shared/business.ts`: 2 for bagDrop and gateDesk, 1 for all others.

### Module data

`business.json` `modules`, schema gains optional `servers` and `serviceSeconds` (positive numbers). `capacityPerHour` stays required and must equal `servers * 3600 / serviceSeconds` when both are present (a test asserts it).

| key | cost | capacityPerHour | staff | servers | serviceSeconds |
| --- | --- | --- | --- | --- | --- |
| kiosk | 6000 | 48 | 0 | 1 | 75 |
| bagDrop | 24000 | 90 | 0.5 | 1 | 40 |
| passport | 18000 | 80 | 1 | 1 | 45 |
| gateDesk | 12000 | 720 | 1 | 1 | 5 |

### Footprint layer

`fixtureRot[cell]`: 0 for an empty cell or a one cell fixture. For a two cell fixture: anchor cell holds `1 + rot`, tail cell holds `5 + rot`, where `rot` 0..3 is the direction from anchor to tail: 0 = +column, 1 = +row, 2 = -column, 3 = -row. Both cells hold the fixture id in `fixture`. Partner of an anchor is `cell + dir(rot)`, partner of a tail is `cell - dir(rot)`.

The layer follows every place the `leased` layer is created, grown, copied, hashed, saved and loaded.

`TerminalEdit` fixture placement gains `rot?: 0 | 1 | 2 | 3`, default 0, ignored for span 1. `planEdit` place: both cells must be inside the grid, floor, free and zone legal, otherwise the existing reject codes apply. Unzoned cells take `allowed[0]`. Erase, or any edit that clears a fixture cell (fixture erase, floor erase, overwrite path if one exists): clear the partner cell's `fixture`, `fixtureRot` and `leased` too. Refund and cost are charged once per fixture, not per cell.

`summarize` counts a two cell fixture once (skip cells whose `fixtureRot >= 5`).

### Capacity and rules (interim until T14, record under Decisions in ARCHITECTURE.md)

* `depCapacity`: check in term = `checkIn * cap(checkIn) + kiosk * cap(kiosk) + bagDrop * cap(bagDrop)`, caps from module data. Rest unchanged.
* `readiness`: `noCheckIn` only when `checkIn + kiosk` is 0.
* Room rules: check in sources for the landside BFS are checkIn and kiosk cells; rules run when a source and a security lane exist.
* New room issue `noGateDeskLink`: the grid holds at least one gateDesk and the airside BFS from security lanes over Secure floor reaches none. Being a room issue, it zeroes `depCapacity` like the others.
* New readiness issue `noGateDesk`: any terminal has a gate desk, and this terminal has secure seating and security but no gate desk.
* `intlCapacity(totals)` = `passport * cap(passport)`, exported beside `arrCapacity` and published wherever `depCapacity` and `arrCapacity` are published. Later tasks consume it.

### Render and UI

* `FIXTURE_COLOR` and `FIXTURE_LETTER` get entries for ids 12 to 16 (atc is missing today, fix it). Two cell fixtures draw one body across both cells from the anchor; tail cells are skipped. Style per `docs/art/terminal_kit.png`.
* Build menu: four `fx` cards with thumbs. R rotates the pending two cell fixture in 90 degree steps, following the existing rotate shortcut if the UI has one. Ghost preview covers both cells.
* Strings: fixture names, `ready.noGateDesk`, `ready.noGateDeskLink`.

## Slices

- [x] S1 keys, zones, span table, module data, schema, id test
- [x] S2 footprint layer, planEdit, summarize, save v12
- [ ] S3 capacity, readiness, room rules, determinism
- [ ] S4 render, build menu, rotate, strings, visual check
- [ ] S5 docs: roadmap tick, ARCHITECTURE decisions, TASKS, STATE
