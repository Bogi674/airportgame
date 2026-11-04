# UI_DESIGN.md

Menus, HUD, panels and interaction. Goal: modern, calm and uncluttered, but every function within two clicks. The map is the main screen. The interface appears when needed and gets out of the way.

## 1. Principles

1. **Map first.** At most three persistent UI zones: top bar, left rail, minimap. Everything else is contextual.
2. **Progressive disclosure.** Summary first, detail on demand. Panels open with key numbers and expand into charts and settings.
3. **One place for each thing.** Build tools live in the left rail, object details in the right inspector, management in side sheets, messages in the alert center.
4. **Explain, do not just block.** Every validation message says what is wrong, why and how to fix it, next to the cursor.
5. **Keyboard friendly.** Every action has a shortcut. Escape always closes or cancels the top layer.
6. **Quiet by default.** Few colors, generous spacing, no permanent pop ups, no blinking. Color is reserved for meaning.

## 2. Technology

* DOM UI over the canvas, built with Preact and plain CSS modules with CSS variables. No CSS framework.
* UI state in Zustand. UI reads sim data only through snapshot selectors, refreshed at 4 Hz, never per frame.
* Icons: one inline SVG sprite in `src/ui/icons.svg`, 20 px grid, 1.5 px stroke, rounded caps. Draw them in house or copy from an ISC or MIT licensed set and keep the license file.
* Font: Inter, self hosted WOFF2, with tabular numbers for money, time and counts.
* Desktop only. Minimum 1280 by 720. UI scale from 80 to 150 percent for 4K screens.

## 3. Design tokens

Defined once in `src/ui/tokens.css`. Dark theme is the default. A light theme uses the same names.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg-app` | #12161c | #eef1f5 | Behind panels |
| `--surface-1` | #1b2129 | #ffffff | Panels, bars |
| `--surface-2` | #232b35 | #f4f6f9 | Cards, inputs |
| `--surface-3` | #2c3642 | #e9edf2 | Hover, selected |
| `--border` | #2f3a47 | #d7dde5 | Hairlines |
| `--text-1` | #e9eef4 | #16202b | Main text |
| `--text-2` | #a9b4c1 | #4a5868 | Secondary text |
| `--text-3` | #7a8796 | #7a8796 | Hints, disabled |
| `--accent` | #3d8bfd | #1f6fe0 | Primary actions, selection |
| `--success` | #3fbf7f | #1f9a5c | Good states |
| `--warning` | #f2b233 | #c98600 | Warnings |
| `--danger` | #ef5a5a | #d23b3b | Errors, losses |
| `--info` | #4fc3d9 | #1690a8 | Neutral info |

* Panels use `--surface-1` at 92 percent opacity with a 12 px backdrop blur, so the map stays visible behind them.
* Typography: 12, 13, 14, 16, 20, 28 px. Weights 400, 500, 600. Line height 1.4.
* Spacing on a 4 px grid: 4, 8, 12, 16, 24, 32.
* Radii: 6 px for controls, 10 px for panels, 999 px for pills.
* Shadow: one soft shadow for floating panels only.
* Motion: 120 ms for hovers, 180 ms for panel slides, ease out. Reduced motion setting turns slides into fades.
* A color blind safe mode swaps success, warning and danger for blue, orange and magenta and adds icons to every state.

## 4. Screens outside the game

### Boot and loading

A centered logo, a thin progress bar and one line of status ("Loading aircraft data", "Generating site"). The generated site fades in behind it when ready.

### Main menu

A slowly moving camera over a demo airport in the background, dimmed. On the left a narrow column:

* Continue (latest save, with its thumbnail and date)
* New career
* Sandbox
* Load
* Settings
* Credits

Version number and a small "What's new" link at the bottom. Nothing else on screen.

### New game, three steps in one panel

1. **Site**: seed field with a shuffle button, terrain preset cards, and a live mini map showing terrain, owned land, the wind rose and the ideal runway heading. Share code such as `TIDE-4471`.
2. **Rules**: difficulty cards (Relaxed, Standard, Demanding) and optional rules as toggles (night curfew, strict wind, realistic construction time).
3. **Airport**: airport name, generated IATA and ICAO style codes (editable), brand color.

A Back and a Start button at the bottom. Start is always enabled with sensible defaults.

### Load game

A grid of save cards: thumbnail, airport name, game date, passengers per year, real date saved. Hover shows Load, Duplicate, Delete. Autosaves are grouped under each career.

### Settings

Tabs: Display (quality preset, UI scale, theme, frame limit), Gameplay (autosave interval, edge scrolling, units metric or imperial), Controls (rebindable shortcuts), Accessibility (color blind mode, reduced motion, text size), Language. Changes apply immediately with a Reset to defaults link.

### Pause menu

Esc in game opens a centered small panel: Resume, Save, Load, Settings, Exit to menu. The sim pauses behind it.

## 5. In game layout

```
+--------------------------------------------------------------------------------+
| [Airport name  ****]        [pause 1x 2x 4x 8x]  12 Mar Y3  14:20   [$ 12.4M ^] [bell] [menu] |
+--+-----------------------------------------------------------------+-----------+
|  |                                                                 |           |
|R |                                                                 | Inspector |
|a |                         MAP                                     | (when an  |
|i |                                                                 |  object   |
|l |                                                                 |  is       |
|  |                                                                 |  selected)|
|  |                                                                 |           |
|  |  [overlay legend chip]                            [minimap]     |           |
+--+-----------[ context bar, only while a tool is active ]---------+-----------+
```

### Top bar (44 px)

* Left: airport name, star rating (0.5 steps) with a tooltip showing the rating breakdown.
* Center: speed controls (pause, 1x, 2x, 4x, 8x), game date and time.
* Right: cash with a small trend arrow (click opens Finance), alert bell with a count, menu button.

### Left rail (56 px)

Icon buttons with labels on hover:

1. Airfield (runway, taxiway, rapid exit, holding point, apron, stand, stand row, prefabs)
2. Terminal (shell, walls, doors, rooms, fixtures, shop units)
3. Landside (roads, curbside, parking, stations)
4. Buildings (tower, fire station, fuel farm, hangar, GSE depot)
5. Overlays
6. Operations (flights board, ground handling, ATC options, taxi flows)
7. Airlines
8. Finance
9. Staff
10. Tenants

Build categories open a flyout palette next to the rail: a grid of tool cards with an icon, name and cost. Management categories open a side sheet.

### Context bar

Appears at the bottom center only while a build tool is active:

* Tool options as segmented controls and steppers, for example runway code letter, approach type, surface, strength tier, width.
* Live readouts: length, heading, wind band chip (Optimal, Acceptable, Poor), cost, build time.
* Validation summary: green check or a count of issues. Clicking it lists them.
* Confirm (Enter) and Cancel (Esc).

### Inspector drawer (right, 380 px)

Opens when an object is selected and slides closed with Esc.

* Header: name, type icon, status chip, close button.
* Tabs, at most four: Overview, Settings, Stats, History, depending on object.
* Overview shows three to five key numbers with sparklines and the main action buttons.
* Examples: a stand shows assigned types, current aircraft, turnaround progress and surface condition. A shop shows tenant, sales per m2, health and lease. An aircraft shows flight, airline, state, route on the map and delay reason.

### Side sheets

Airlines, Finance, Staff, Tenants and the Flights board open as sheets from the left covering about half the screen, so the map stays visible. They have their own tabs and tables. Tables are virtualized, sortable and filterable, and rows can be pinned to the map.

### Minimap

Bottom right, 200 by 200 px, collapsible. Shows owned land, pavement, buildings and the camera frame. Click to move. Buttons beside it: compass (click to face north), align view to runway, zoom to fit.

### Overlays

Key O opens a compact list. One overlay at a time plus optional labels. Active overlay shows a legend chip at the bottom left with a scale and a close button. Overlays: passenger density, queues, walking distance to gates, wind coverage, runway strip and obstacle surfaces, wingtip envelopes, taxi routes and flows, congestion, vehicle activity, pavement condition, land parcels and prices, rent per m2, tenant sales, staffing coverage, baggage load, fire response time.

### Alerts and toasts

* Toasts at the top right for events, 4 seconds, at most 3 visible, stacked. Each has a jump to location button.
* The alert center (bell) groups alerts by severity: Critical, Warning, Info. Similar alerts merge with a count. Each alert has a jump button and a mute rule ("mute this type for 7 days").
* Critical alerts (a closed runway, a fire category shortfall) also pin a slim banner under the top bar until resolved.

## 6. Building interactions

* **Runway**: click start, move, click end. The wind ring and runway numbers follow the cursor. Context bar shows length, heading, band and cost.
* **Taxiway** (`docs/DESIGN_REVISION_2.md` section 2.2): click to add nodes, double click or Enter to finish. While the tool is open every node shows as a small white circle, junctions with their label. The snap target shows in snapping cyan: a ring with a dot on a node, a square on an open end, a diamond on a segment, with a tooltip ("Snap to J1", "Continue taxiway", "Split segment") in a dark box with a cyan border. The new arm previews in cyan at 30 percent. The length readout moves clear of the snap ring.
* **Taxiway inspector**: a surface bar (Grass, Dirt, Gravel, Asphalt, Concrete) with the current and selected surface, the upgrade cost or downgrade refund and the works days, and Apply. Codes above C disable the unpaved surfaces. A taxiway under works shows the days left.
* **Rapid exit**: hover the runway, the tool shows the suggested position with a marker. Click to place, scroll to change the angle preset.
* **Stand and stand row**: click to place a row. The context bar sets contact or remote, the size (small, medium, large, extra large) and the count; spacing is the size's width. The preview shows the real fork and markings. The stand inspector shows the size, the types the stand refuses with the reason, and the push back side (left, right or away from the route).
* **Apron** (`docs/DESIGN_REVISION_2.md` section 4): two modes, free polygon and rectangle, switched with A or the two buttons in the context bar. Edge lengths and the area show live as small tags; Ctrl cuts instead of building. The apron inspector shows its name and area.
* **Terminal interior**: drag rectangles for walls and rooms on the grid. Fixtures follow the cursor. R rotates 90 degrees.
* **Validation**: errors show as a red outline on the offending object plus a short label by the cursor ("Too close to runway 09/27, max code C here"). Hovering the label shows the full rule.
* **Costs** show before confirming, with build time and monthly upkeep.
* **Undo and redo** for every build action.

## 7. Controls

| Input | Action |
| --- | --- |
| Left click | Select, place |
| Right click or Esc | Cancel tool, close top panel |
| Middle drag or right drag | Pan |
| Wheel | Zoom to cursor |
| WASD or arrows | Pan |
| Q and E | Rotate placement or view |
| R | Rotate 90 degrees |
| Shift (hold) | Snap to 15 degree steps |
| Alt (hold) | Free placement, no snapping |
| A | Apron tool: switch free polygon and rectangle |
| Ctrl (hold) | Apron tool: cut a piece out |
| Space | Pause and resume |
| 1 to 4 | Game speed |
| O | Overlays |
| B | Last build category |
| F | Find object or flight |
| N | Align view to runway, press again for north up |
| Ctrl Z, Ctrl Y | Undo, redo |
| Ctrl S | Quick save |
| Delete | Demolish selected (with confirm) |

All shortcuts are rebindable.

## 8. Accessibility

* Text contrast at least 4.5 to 1. Focus rings on every control.
* Color blind mode and icons on all state chips.
* UI scale and text size settings.
* Reduced motion.
* Every panel reachable by keyboard. Tooltips appear on focus as well as hover.

## 9. Tutorial and hints

* First career offers a guided tutorial with coach marks on real UI elements, one tool at a time. Skippable at any step.
* Empty states teach: an empty Airlines sheet says what airlines need to sign and links to the tool that fixes it.
* Contextual hints appear once per topic and can be turned off.

## 10. UI performance rules

* UI never re-renders on every frame. Selectors read the latest snapshot at 4 Hz and compare by value.
* Lists over 50 rows are virtualized.
* Charts are drawn on small canvases, not SVG with thousands of nodes.
* The map canvas owns pointer events. DOM panels stop propagation only inside their bounds.
* DOM node budget: under 1 500 nodes with all panels closed, under 4 000 with a side sheet open.
