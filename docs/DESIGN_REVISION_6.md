# DESIGN_REVISION_6.md

UI visual redesign, code name **Blue Hangar**. A bright, clean, game styled interface: white game windows with blue title bars, chunky pressable buttons, a toy airport map look, an LED departure board, boarding pass and bag tag motifs.

## 0. Status and precedence

* Owner approved direction on 2026-11-25. This revision is about **look and layout** of every UI surface.
* It overrides `docs/UI_DESIGN.md` sections 3 (tokens), 4 (screens outside the game, visuals only) and 5 (in game layout) where they disagree. Principles in `docs/UI_DESIGN.md` section 1, controls (section 7), accessibility (section 8) and UI performance rules (section 10) still hold.
* It does not change any sim rule, command, save field or determinism rule. Where a screen needs data the sim does not produce yet, show the control disabled or hide the row; never invent numbers in the UI.
* Reference renders: `docs/art/ui_rev6/*.png` (2x, baseline viewport 1440 by 900). Reference markup with exact CSS values: `docs/reference/ui-rev6/*.html` (open in a browser). Tokens ready to paste: `docs/reference/ui-rev6/tokens.css`.
* Tags drawn in the renders as **NEW** (violet pill) and **TBD** (grey pill) are design annotations. Never ship them as UI. NEW marks a suggested addition the owner accepted for planning, TBD marks an undecided item.

## 1. Goals

1. Feel like a game, not a dashboard: depth on buttons, colored category groups, playful map, motifs from airports (LED board, boarding pass, bag tag, analog clock).
2. Stay calm and readable: one blue accent family, generous spacing, small but legible type.
3. Zero collisions: every HUD part owns a fixed zone. Panels never overlap each other or the minimap or task bar. Popovers are the only layer allowed on top of the map.
4. Light by default. Keep the existing dark theme switch working by mapping the same token names (section 3.6).

## 2. Reference files

| Render | Shows |
| --- | --- |
| `Main.png` | Main menu |
| `Wizard-1-Site.png`, `Wizard-2-Rules.png`, `Wizard-3-Airport.png` | New career wizard |
| `Gameplay-Select.png` | Select mode, runway inspector, aircraft dropdown open, minimap opaque |
| `Gameplay-Build.png` | Build mode, Airport Stations flyout with a variant tray, build properties, minimap semi transparent |
| `Gameplay-Bulldoze.png` | Area bulldoze with type filter, paused at night, minimap hidden |
| `HUD-Popovers.png` | Weather tooltip, aircraft, stands and alerts dropdowns |
| `Game-Menu.png` | Pause menu |
| `Build-Tools-Map.png` | Full build tool hierarchy with group colors |

Each render has a twin `.html` in `docs/reference/ui-rev6/`. When a value in this doc and the HTML disagree, this doc wins. When the doc is silent, copy the HTML value.

## 3. Design tokens

All tokens live in `src/ui/theme.css` as CSS variables. Copy `docs/reference/ui-rev6/tokens.css` as the new `:root[data-theme='light']` block and make light the default.

### 3.1 Color

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | #0F2240 | Main text, icons, dark surfaces |
| `--ink-2` | #4B5E7E | Secondary text, labels (6.4:1 on white) |
| `--ink-3` | #7B8CA6 | Placeholder glyphs only, never text under 14 px |
| `--surface` | #FFFFFF | Panels, cards |
| `--surface-2` | #F2F7FF | Wells, inputs, inner sections |
| `--surface-3` | #EAF2FF | Segmented track, chips, hover |
| `--line` | #D3E2F7 | Panel outline (1.5 px) |
| `--line-soft` | #DCE8FA | Inner dividers, card outline |
| `--depth` | #C2D5EF | Panel bottom edge (4 px "lip") |
| `--accent` | #2F7BFF | Primary, selection, focus |
| `--accent-deep` | #1C58C7 | Bottom lip of accent buttons, link text |
| `--accent-soft` | #E6F0FF | Pressed pill background |
| `--led-bg` | #0F2240 | LED board |
| `--led-dot` | #1B3766 | Unlit LED dots |
| `--led-lit` | #6FB1FF | Lit LED accent |
| `--good` / `--good-text` | #22A06B / #16834F | Success fill / success text |
| `--warn` / `--warn-text` / `--warn-soft` | #F59E0B / #9A5B00 / #FDF1DC | Warnings |
| `--bad` / `--bad-deep` / `--bad-text` | #E5484D / #B4232A / #C0262D | Danger, bulldoze, losses |
| `--gold` / `--gold-deep` | #FFC531 / #E0A100 | Coin and star glyphs only |
| `--annot` / `--annot-text` | #EDE9FE / #5B21B6 | Reserved for dev annotations, never in release UI |

Category group colors (left rail icons, flyout title bars, inspector title bars):

| Group | Base | Deep |
| --- | --- | --- |
| Airside | #2F7BFF | #1C58C7 |
| Terminal | #0EA5B7 | #0B7F8D |
| Operations | #5B5FE0 | #3F42B5 |
| Tools | #5A6B85 | #43526A |
| Danger (bulldoze active) | #E5484D | #B4232A |

Map palette (renderer, MVP 1 placeholder art; real sprites follow `docs/ART_AND_ASSETS.md`):

| Surface | Value |
| --- | --- |
| Grass | #B6DB9A, mown stripes white at 7% alpha |
| Tree | #7FBF6A with shade #6AAE55 |
| Sea | #7EC8F0, beach #F3E3B5 |
| Runway | #4A5568, markings white |
| Taxiway | #7A8699, centerline #FFD23F, edge lights #4FA3FF |
| Apron | #C5CFDB with 34 px slab joints #BCC7D4 |
| Stand lines | #F2C230 dashed |
| Terminal roof | #F4F8FF with a #2F7BFF roof band |
| Road | #8C96A5, lane dashes white |
| Terminal floor | #FBFCFE, public zone tint #E9F6E4, secure zone tint #E6EEFB, walls #22314D |

### 3.2 Typography

* UI font: **Rubik** 400, 500, 600, 700, 800, self hosted WOFF2 (`@fontsource/rubik`, OFL). Tabular numbers on for money, time and counts (`font-variant-numeric: tabular-nums`).
* LED font: **Doto** 900 (`@fontsource/doto`, OFL), only on LED boards.
* Scale at 100% UI scale. Keep exactly these steps:

| Step | Size / weight | Use |
| --- | --- | --- |
| `--fs-2xs` | 9 px / 600 | Pills inside cards, minimap toggles, NEW style tags |
| `--fs-xs` | 9 px / 400 to 500 | Labels, captions, secondary lines |
| `--fs-sm` | 10 px / 600 | Buttons, task bar, rail tooltips, list rows |
| `--fs-md` | 10.5 to 11 px / 600 to 700 | Top bar values, panel title bars, list titles |
| `--fs-lg` | 12 px / 700 | Stat values (`b` in a stat pair), card titles |
| `--fs-xl` | 13 to 16.5 px / 800 | Money in confirm boxes, wizard numbers |
| `--fs-2xl` | 27 to 33 px / 800 | Airport codes on passes and tags |
| `--fs-led` | 20 to 43 px / Doto 900 | LED text |

Minimum text size is 9 px at 100% UI scale. Uppercase caption style (`.cap`): 9 px, 600, letter spacing 0.06em.

### 3.3 Spacing, radius, depth

* 4 px grid: 2, 4, 6, 8, 10, 12, 14, 16, 24.
* Radii: 7 px small buttons, 9 to 10 px controls and tiles, 12 px wells and cards, 14 px HUD panels, 16 px windows, 22 px large decorative cards, 999 px pills.
* Depth is a solid lip, not a blur: panel `box-shadow: 0 0 0 1.5px var(--line), 0 4px 0 var(--depth), 0 14px 28px rgba(15,34,64,.16)`. Buttons: `0 3px 0` of their deep color. Pressed state removes the lip and moves the button down 2 px.
* Icons: 2 px stroke, round caps, 24 px grid drawn at 15 to 18 px. Keep `src/ui/icons.tsx` as the single source and add the missing glyphs listed in section 7.

### 3.4 Motion

* Buttons press in 80 ms, panels slide 160 ms ease out, popovers fade and rise 6 px in 120 ms.
* Reduced motion (existing setting) turns slides and rises into fades.

### 3.5 Components

| Component | Spec |
| --- | --- |
| **Window panel** `.pn` | White, radius 14 (HUD) or 16 (modal), depth as 3.3. Optional title bar |
| **Title bar** `.tbar` | 40 px, gradient from group base to deep, white 11 px 600 text, a 26 px icon chip (white 20% alpha) on the left, a 26 px close button on the right |
| **Button primary** `.bb` | Accent fill, white text, 34 px tall (40 in menus), lip accent deep |
| **Button secondary** `.bw` | White, 1.5 px inset outline `--line`, lip `--line` |
| **Button danger** `.br` | `--bad` fill, lip `--bad-deep` |
| **Segmented** `.seg` | Track `--surface-3`, 3 px padding, options 26 px; picked option is a mini primary button |
| **Switch** `.sw` | 36 by 20, off #C9D6E8, on accent |
| **Counter pill** `.pill` | 32 px, `--surface-2` with 1.5 px inset `--line-soft`, icon plus bold value; open state: `--accent-soft` with accent outline |
| **Stat pair** `.pv` | Label 9 px `--ink-2` above a 12 px 700 value with an optional 9 px unit |
| **Tile** (build card) | 112 px tall, white, outline plus lip, a thumbnail slot 40 px tall, two line name (11.5 px source, clamps at 2 lines), footer is either price with coin or a variant chip |
| **Variant chip** | Group tinted pill, e.g. "3 sizes", with a chevron right (closed) or down (open) |
| **Variant tray** | Spans the full flyout width under the row of the open tile, tinted in the group color, one radio card per variant (thumbnail 34 px, name, one fact, price) |
| **Thumbnail slot** | Shows the real sprite from `thumbs.tsx` or `PropThumb.tsx` when it exists. Until then render the standard placeholder: fill #E6ECF4, 1 px inset #D3DDEB, centered image glyph (frame, sun, mountain) in #9AABC2 |
| **LED board** | `--led-bg` with a 7 px dot grid in `--led-dot`, inset ring 2 px `--led-dot`, lip #091733. Text in Doto |
| **Boarding pass** | Panel with a title bar, two airport style codes joined by a dashed line and a plane glyph, a 2 by 4 field grid, a perforation row with half circle notches cut from both sides, a barcode strip |
| **Bag tag** | Accent gradient card, punched hole on the left, dashed fold line, big code, name, a strip with ICAO and flight |
| **Analog clock** | Blue bezel, white face, 12 ticks, navy hands, blue second hand. Driven by game time. Sizes 26 (top bar), 52 (pause), 64 (menu) |
| **Popover** | Panel radius 14, 12 px padding, opens 42 px below its trigger, aligned to the trigger edge that keeps it on screen |

### 3.6 Dark theme

Keep `data-theme='dark'`. Map the same names: surface #13233A, surface-2 #0F1D31, surface-3 #1B3150, line #26405F, depth #091526, ink #E6EEF9, ink-2 #9FB3CF. Accent, group, status and gold stay the same. Map colors do not change with theme.

## 4. Layout and scaling

### 4.1 Zones at the 1440 by 900 baseline

All HUD parts are absolutely positioned from the viewport edges. Margins are 10 px.

| Zone | Rect (x, y, w, h) | Anchor |
| --- | --- | --- |
| Top bar | 10, 10, viewport minus 20, 44 | Top, full width |
| Left rail | 10, 64, 48, auto (about 603) | Top left |
| Build flyout | 66, 64, 264, auto (max to 836) | Right of the rail |
| Right panel (inspector, build properties, bulldoze filter) | right 10, 64, 300, auto (max to minimap top minus 10) | Top right |
| Minimap | right 10, bottom 70, 220, 140 | Bottom right, above the task bar row |
| Task bar | centered in the band between x 66 and the minimap left edge, bottom 10, auto, 44 | Bottom center |
| Map show button (minimap hidden) | right 10, bottom 10, 100, 44 | Bottom right |
| Popovers | under their trigger | Top layer |

Update `src/ui/layout.ts`: `FLYOUT_RIGHT_PX = 330` (66 plus 264), `MINIMAP_PX = 230` (220 plus the 10 px margin), keep `GAP_PX = 16`. The context bar and overlay legend keep using `bottomCenter()` but sit above the task bar (bottom 64).

### 4.2 Rules that keep zones apart

1. A panel never grows past its zone. Long content scrolls inside the panel body (title bar stays fixed). Use `max-height: calc(100vh - <top> - <bottom reserve>)`.
2. Text never overflows: every single line label inside a fixed width gets `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0`. Tile names clamp at 2 lines.
3. The right panel and the minimap share the right column: right panel max height is `minimap top minus 10`. When the minimap is hidden the right panel may extend to `bottom 64`.
4. At most one dropdown is open at a time. Opening another closes the first. Hover tooltips close when a dropdown opens.
5. The camera keeps a safe area: when a tool focuses an object, center it in the free band (left 330 if the flyout is open else 66, right 330, top 64, bottom 64).
6. Add a Playwright layout test (section 9) that asserts the bounding boxes of the zones never intersect at 1280 by 720, 1440 by 900 and 1920 by 1080 with each panel open.

### 4.3 Scaling

* The existing UI scale setting (80 to 150 percent) multiplies one root variable `--ui` used by every size in this doc: `font-size: calc(10px * var(--ui))`, zone sizes likewise. Implement with `zoom` on the HUD root only if it passes the layout test in Chromium and Firefox; otherwise use the variable.
* Default UI scale: 100% at widths up to 1919 px, 115% at 1920 and above, 140% at 2560 and above, unless the player set a value.
* Below 1360 px wide: task bar shows icons only (labels in tooltips), the top bar hides the date line under the time and the rating value text.

## 5. Screens

### 5.1 Main menu (`Main.png`, `src/ui/Menu.tsx`)

* Background: the live demo airport camera (existing behavior) rendered in the toy palette, sea band at the top.
* Left column at x 56: LED title board 460 by 156 ("AIRFIELD" lit blue, "TYCOON" white), a tagline pill, then six menu buttons 340 by 52 with an icon chip, title and one line description: Continue (primary, shows the latest save name and game date), New Career, Sandbox, Load Game, Settings, Credits.
* Right column at x 1054, width 330: latest save boarding pass (FLD to the airport IATA code, founded year, game time and date, rating, cash, passengers per year, stands used of total, save thumbnail, Resume career button), then a clock card with local time and game time.
* Footer pills: version, What's new, offline note.
* If there is no save, hide the boarding pass and the Continue button; New Career becomes primary.

### 5.2 New career wizard (`Wizard-*.png`)

A 1200 by 800 modal window over the dimmed demo map. Title bar "New Career" with "Step n of 3", close button. A stepper strip (72 px) with three stops (Site, Rules, Airport): done stops are filled with a check, the current stop has a halo, a plane glyph flies just ahead of the filled progress line. Footer: Back, Start with defaults (steps 1 and 2), Next (primary) or Start career on step 3. Start is always enabled.

* **Step 1 Site**: seed input with Shuffle, share code with Copy; terrain preset cards (Flat Coastal, River Valley) with a picture strip and a check badge; site report with four stat wells (owned land, parcels for sale, prevailing wind, elevation); live site preview (existing `SitePreview.tsx` canvas) framed in the toy palette with an owned land outline in accent, parcels dashed white, best runway bar, a wind compass and a legend pill.
* **Step 2 Rules**: difficulty cards (Relaxed, Standard default, Demanding) with a 3 bar level meter, starting cash with coin, loan rate; mode segmented Career or Sandbox; optional rules as switch rows (Night curfew, Strict wind, Realistic construction time, Random events, Guided tutorial). Right side: Career Pass (boarding pass) that mirrors every choice live, plus a "first goals" list with rewards when the tutorial or objectives exist; hide that block until objectives exist.
* **Step 3 Airport**: name, IATA and ICAO inputs with regenerate; brand color swatches (7 plus custom) and logo mark picker; start season as four cards (Spring, Summer, Autumn, Winter) with a one line effect. Right side: bag tag preview in the brand color and an LED departure board preview using the airport code.

MVP 1 note: Rules step, start season and logo mark ship disabled until their systems exist (`docs/UI_DESIGN.md` section 4 says Rules waits for MVP 2).

### 5.3 Top bar (`src/ui/TopBar.tsx`)

Left to right, 8 px gaps, 44 px tall white panel:

1. Brand: 30 px bag tag square (brand color gradient, IATA code), airport name (ellipsis) and "ICAO / IATA".
2. Weather button: condition icon plus temperature. Hover opens the weather tooltip (5.8).
3. Day or night glyph (sun gold, moon indigo) from the sim day phase.
4. Clock: 26 px analog clock plus time and date (`formatClock`).
5. Flexible spacer.
6. Cash pill: coin, cash, and the running daily result in green or red (`+$84.2K/d`). Click opens Finance.
7. Rating pill: star plus rating to one decimal. Hover shows the rating breakdown (existing tooltip content).
8. Aircraft pill: plane, total aircraft at the airport, chevron. Click opens the aircraft dropdown (S, M, L, XL counts with bars, parked versus moving, link to Flights).
9. Stands pill: stand glyph, used / total, chevron. Click opens the stands dropdown (free, used, total per size, then contact, remote, tie down totals).
10. Speed segmented: pause, 1x, 2x, 4x, 8x, a divider, skip to next day. Picked speed is a primary mini button; pause picked turns the clock hands still.
11. Alerts bell with a red count badge; click opens the alert list (existing `AlertCenter`).
12. Game menu button (primary, 32 by 30) opens the pause menu.

### 5.4 Left rail (`src/ui/ToolRail.tsx`)

48 px wide panel, 36 by 32 buttons, 3 px gaps, a 28 px divider between groups. Icons take their group color; the active category is a filled group colored button with a white icon and its lip. Suggested categories that have no system yet carry a 7 px violet dot in the mockups only; in code they are `locked` (dimmed, tooltip "Coming later").

| Group | Categories (top to bottom) | Maps to current `CATEGORIES` |
| --- | --- | --- |
| Airside | Runway, Taxiway, Apron, Aircraft Stands, Navigation Aids | `runway`, `taxiway`, `apron`, `stand`, new `navaids` (locked) |
| Terminal | Terminal, Airport Stations, Amenities, Commercial | `terminal` (structure tab), split `terminal.processing` into new `stations`, `furnish` becomes Amenities, `terminal.shops` becomes Commercial |
| Operations | Flight Operation, Landside Infrastructure, Office | `flightops` plus `handling`, `infra` (renamed, items Curbside, Car Park, Bus Stop, Public Vehicle Road, Taxi Rank; Terminal Train and Subway Station locked), `staff` |
| Tools | Zoning, Bulldoze, Undo, Redo | `zoning`, demolish tool, undo, redo |

Select mode moves to the task bar (5.6). Keep keyboard shortcuts (`V` select, `X` demolish) and show them in rail tooltips.

### 5.5 Build flyout (`src/ui/BuildMenu.tsx`)

The category menu moves from the bottom of the screen to a 264 px flyout to the right of the rail (zone 4.1). Title bar in the group color with the category icon, name and close. Body: tabs (existing `Tab` model) as a segmented control under the title bar when a category has more than one tab, then a 2 column tile grid with 8 px gaps.

Two kinds of tiles, both on the same grid:

* **Single item**: footer shows the price with a coin. Clicking picks the tool immediately (current behavior).
* **Item with variants**: footer shows a variant chip ("3 sizes", "4 types"). Clicking opens a **variant tray** directly under that tile's row, spanning both columns; any other open tray closes. The tray lists one radio card per variant with its own thumbnail, name, a key fact (lanes, desks, capacity) and price. Picking a card arms the tool with that variant. The tile shows the group colored ring while its tray is open.

A two line legend at the bottom of the flyout explains both footers (shown until the player has picked 5 items, then hidden; store the flag in settings).

Data change: extend `Item` with `variants?: Variant[]` where `Variant = { id: string; thumb: string; asset?: string; price: number; fact: string }`, and add `variant` to the tool store so the placement tool and the build properties panel know which one is armed. Security Checkpoint (Small 1 lane, Medium 2 lanes, Large 4 lanes) is the first variant item; Check In (types), Baggage Drop (sizes), Passport Control (types) follow as their assets land. Stands keep S, M, L, XL as variants.

### 5.6 Right context panel (`src/ui/ObjectPanel.tsx` plus build properties)

300 px wide, title bar colored by the object's group. One component with three modes:

* **Select** (`Gameplay-Select.png`): hero row (LED chip with the designator for runways, a status pill, a one line subtitle), properties as a 3 column stat grid, alert rows with a progress bar (wear, queue), upgrades list (done with a green check, available with a price button), action buttons (Extend, Edit, Close, Bulldoze in danger style). Order follows the brief: name, description, data, actions, alerts, upgrades.
* **Build** (`Gameplay-Build.png`): preview thumbnail of the armed variant and a short description, Rotation segmented (0, 90, 180, 270 plus rotate), Size segmented when the item has variants (mirrors the tray), Material segmented when applicable, Layout tool (Freeform or Grid) and Snapping switch when applicable, 3 key stats, a confirm well (validation state, cost with coin, build time bar), Place (Enter) and Cancel.
* **Edit**: the build layout with the current values preselected, plus the cost difference in the confirm well and Apply or Revert buttons.
* **Area bulldoze** (`Gameplay-Bulldoze.png`): danger title bar, box size line, a type checklist with counts (Everything, Walls, Floors, Doors and windows, Furniture and seating, Stations, Amenities, Decoration, Passenger information, Zones, Airside pavement), "Skip items in use" switch, refund, demolition cost and time stats, Bulldoze n items and Cancel.

The old context bar keeps live readouts that must sit next to the cursor (length, heading, validation). Everything else moves into this panel.

### 5.7 Task bar and minimap

* Task bar: modes Select, Build, Land; divider; management Airlines, Flights, Finance, Staff, Tenants, Reports; divider; Overlays. Active item is a primary mini button. Opening a management item opens its side sheet (existing `Sheets.tsx`) from the left at x 66, covering at most half the screen, and hides the flyout.
* Minimap 220 by 140 with a header (title, Opaque, Semi, Hide). Semi sets panel and map to 55 to 60% opacity. Hide collapses it to the Map button in the bottom right; the right panel may then grow down (rule 4.2.3).

### 5.8 Popovers (`HUD-Popovers.png`)

Weather (hover), Aircraft, Stands, Alerts (click). Contents exactly as in the render. They are the only HUD layer allowed above other HUD parts and close on Escape, outside click, or opening another popover.

### 5.9 Pause menu (`Game-Menu.png`, `src/ui/PauseMenu.tsx`)

360 by 520 modal over the dimmed map. Title bar "Paused". A clock well (game time, date, airport). Buttons 40 px tall: Resume (primary, Esc), Save game (Ctrl S), Load game, Settings, Help and guide (F1), Controls, Exit to main menu (danger text). Footer: last autosave and version. Keep the existing Save as and Export actions as secondary rows under Save game.

## 6. Map look (renderer, placeholder art)

The toy palette in 3.1 applies to the 2D renderer's placeholder fills while real sprites are not in. Required details in the renders: runway edge lights, touchdown zone and threshold bars, taxiway centerline and blue edge lights, apron slab joints, dashed stand boxes with stand ids, jet bridges on contact stands, ground vehicles next to parked aircraft, drop shadows under aircraft, terminal roof band with skylights, landside curb canopy, cars on roads, trees with a shade side. People render as 7 px dots with a white ring in random brand colors (render sample only, hard rule 6), staff at desks in navy. These are renderer changes and must hold `docs/PERFORMANCE.md` budgets; batch them into the existing chunk layers.

Selection: accent outline 3 px with a 4 px 25% alpha halo, white round handles with an accent ring at editable ends, a dark measurement pill above the object. Ghost placement: dashed accent outline with 16% accent fill, a rotate handle above, and a fit chip near the cursor (check plus size plus price). Area bulldoze: dashed danger outline with 8% fill, items inside tinted danger, a chip with item count and refund.

## 7. Implementation plan

Work one task at a time per `CLAUDE.md`. Each task ends with `npm run verify` green and updated screenshot scenarios.

| ID | Task | Files | Done when |
| --- | --- | --- | --- |
| R6-01 | Tokens and fonts | `src/ui/theme.css`, `package.json` (`@fontsource/rubik`, `@fontsource/doto`), `src/ui/main.tsx` | Light theme is default, every color in UI code comes from a token, dark theme maps per 3.6, fonts load offline |
| R6-02 | Primitives | new `src/ui/kit/` (`Panel`, `TitleBar`, `Button`, `Segmented`, `Switch`, `Pill`, `Stat`, `Thumb` placeholder, `LedBoard`, `Clock`, `Popover`) | Storybook style test page `?kit` renders all states; unit tests for Clock angles |
| R6-03 | Layout zones | `src/ui/layout.ts`, `App.tsx` | Zone constants from 4.1, layout test of 4.2.6 passes |
| R6-04 | Top bar | `TopBar.tsx`, `AlertCenter.tsx` | Items 1 to 12 of 5.3, dropdowns of 5.8, one popover open at a time |
| R6-05 | Rail regroup | `ToolRail.tsx`, `BuildMenu.tsx` (`CATEGORIES`), `strings/en.json` | Groups and order of 5.4, locked categories dimmed, shortcuts kept |
| R6-06 | Flyout and variants | `BuildMenu.tsx`, `stores/toolStore.ts`, `thumbs.tsx` | Flyout zone, tabs, single and variant tiles, tray, legend; Security Checkpoint variants arm the tool |
| R6-07 | Right panel modes | `ObjectPanel.tsx`, `ContextBar.tsx`, new `BuildPanel.tsx` | Select, Build, Edit, Area bulldoze of 5.6; context bar reduced to cursor readouts |
| R6-08 | Task bar and minimap | new `TaskBar.tsx`, `Minimap.tsx`, `Sheets.tsx` | 5.7, minimap three states persisted in settings |
| R6-09 | Main menu | `Menu.tsx` | 5.1 with and without saves |
| R6-10 | Wizard | `Menu.tsx`, `SitePreview.tsx` | 5.2, MVP 1 disabled parts per its note |
| R6-11 | Pause menu | `PauseMenu.tsx` | 5.9 |
| R6-12 | Map placeholder palette | `src/render/*` | Section 6 details, budgets hold |
| R6-13 | Screenshot scenarios | `scripts/shot.mjs`, e2e | One scenario per render in section 2; owner compares side by side |

## 8. Strings and writing

All new text goes into `src/ui/strings/en.json`. Follow hard rule 15 (no em or en dashes, no spaced hyphen as a connector). Keep the copy in the renders as the default English strings.

## 9. Tests

* **Layout test** (`e2e/layout.spec.ts`): at 1280 by 720, 1440 by 900 and 1920 by 1080, open each of: flyout with a tray, right panel in each mode, each popover, minimap in each state, a side sheet. Collect bounding boxes of the zones in 4.1 and assert no two intersect (popovers excluded) and none leaves the viewport.
* **Overflow test**: for every element with the ellipsis class, assert `scrollWidth <= clientWidth + 1` or that it is truncated by design (has a title attribute with the full text).
* **Contrast test**: axe run on the HUD and menus, no AA failures.

## 10. Open points

* Brand color drives the bag tag and the top bar tag only; the UI accent stays blue.
* Season, logo mark, random events, tutorial goals, commercial, navigation aids and landside items wait for their systems. Ship their UI disabled or hidden.
* Analog clock second hand at speed 8x: tick once per game minute to avoid flicker.
