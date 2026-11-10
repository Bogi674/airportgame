# Sprite port gap table

Task T05. Source: `docs/reference/sprite-prototypes/air2.py`. Target: `src/render/sprites/geometry.ts` (math in meters, no drawing) and `src/render/sprites/aircraftSprite.ts` (canvas baking).

Frame mapping: Python `(x, y)` is lateral and longitudinal with the nose at `y = 0`. TypeScript `Pt2 {u, v}` has `u = y` and `v = x`. The canvas draws the nose toward +x.

Verdict at the start of T05: `geometry.ts` is a loose reimplementation, not a port. The fuselage formula, wing planform (no rake, no kink round, no root_y), stabilizer planform, winglet shapes and engine shapes all differ from the Python. They are rewritten, not extended. All sprite data fields the Python reads already exist in `src/data/aircraft/aircraft.mvp.json` under `spriteBases` (`ws`, `doors`, `overwing`, `windows`, `door_len`, `win_r`, `rear_window`, `upper`, `sponsons`, `tail_p`, `tracks`, `nose_prop`). No schema field is missing.

| Python function | What it draws | TypeScript | Tier |
| --- | --- | --- | --- |
| `hw` | Fuselage half width: ogive nose, constant barrel, power law tail | `halfWidth`, different formula (sqrt form, tail exponent fixed 1.6, no `nose_m`, no `tail_p`). Rewrite | all |
| `fuselage_pts` | Fuselage outline with extra nose samples | `fuselage`, uniform steps. Rewrite | all |
| `wing_right` | Wing planform with rake, kink round, `root_y`, `te_in` | `planform`, straight polygon, no rake, no round. Rewrite | all |
| `le_y`, `te_y` | Leading and trailing edge station at a span position | missing | 2 and up |
| `shoelace`, `wing_area` | Wing area for checks | missing, needed by a test only | none |
| `mirror` | Mirror a point list | `mirror`, ported | all |
| `smooth_path` | Point list to a path | not needed, canvas paths are built inline | none |
| `winglet` | Sharklet, blended and canted winglets | partial, one triangle for every kind. Rewrite | all |
| `nacelle_fan` | Fan nacelle: separate or long duct flow, core cowl, plug, lip, chevrons, livery tint | missing, an ellipse stands in | 1 and up |
| `pylon` | Pylon from nacelle to wing leading edge | partial, a line at tier 3. Rewrite | 3 |
| `prop` | Propeller blades projected onto a lateral bar | missing, a translucent disc stands in | 1 and up |
| `nacelle_prop` | Turboprop nacelle and intake lights | missing | 1 and up |
| `spinner` | Prop spinner | missing | 1 and up |
| `windscreen` | Windscreen by style, panes, A350 mask, rear window | partial, one ellipse. Rewrite with `WS_STYLES` | 2 and up |
| `doors_windows` | Door outlines, overwing exits, window rows, upper deck windows | partial, door boxes and a window strip at tier 3. Rewrite | 2 and up |
| `tail_parts` (`hstab`) | Horizontal stabilizer, hinge line, T tail ellipse | partial, planform only. Rewrite | 1 and up |
| `tail_parts` (`fin`) | Fin lens with dorsal fillet, livery tint | partial, a rectangle. Rewrite | 1 and up |
| `wing_parts` | Wing, winglets, flap line, aileron line, slats, spoilers | partial, one line per wing. Rewrite | 2 and 3 |
| `flap_tracks` | Flap track fairings and aft engine fairings | missing | 2 and up |
| `engines_all` | Stage dispatch: under, over, rear, props | missing, one loop draws every engine | all |
| `upper_deck` | Hump outline for 747 and A380 types | missing | 2 and up |
| `lights` | Nav lights, beacons | missing | 3 |
| `silhouette` | One color union for shadow and far tiers | partial, shadow uses fuselage, wings and stabilizers only. Rewrite | 0 and 1 |
| `render` | Layer order for low and high wing types, T tail ordering | missing, order is fixed. Rewrite | all |
| `defs` | Fuselage and nacelle gradients, shadow blur | missing, `gFus` and `gNac` become canvas gradients | 2 and up |
| `extent` | Bounding box with props and winglets | `extent`, partial, ignores prop discs and engine overhang. Rewrite | none |
| `livery_layer` | Fin, nacelle and winglet tint | partial, T06 covers liveries. T05 keeps the hooks | T06 |
| `marker` | Tier 0 map marker | not needed, tier 0 is the silhouette | 0 |

## Out of scope for T05

Liveries and the tier table (T06). Calibration overlays (T07, deferred). The upper deck and sponsons are ported because the data has them.

## Tier mapping (T06)

Source of truth: the table in `docs/ART_AND_ASSETS.md` section 2 and `render(tier=...)` in `air2.py`. Thresholds, bake resolution, cache limit and liveries live in `src/data/sprites.json`.

| Sprite tier | Camera zoom | Python | What is drawn | Bake ppm |
| --- | --- | --- | --- | --- |
| 0 | below 1 px/m | `marker` | Heading arrow in the airline fin color, size `max(6, L / 2)` m | 2 |
| 1 | 1 to 4 | `render(tier=1)` | Flat silhouette with shadow | 4 |
| 2 | 4 to 16 | `render(tier=2)` | Reference style: gradients, windscreen, doors, windows, panel and flap lines, flap tracks, upper deck, livery tint | 8 |
| 3 | above 16 | `render(tier=3)` | Tier 2 plus slats, spoilers, pylons, nacelle seams, prop nacelle intakes, nav lights and antennas | 16 |

The quality governor drops one tier at level 2. Liveries (8 invented, plus a neutral default for any other index) color the fin, winglets, nacelle cowls (optional) and a fuselage crown band (optional) in the pass of each part. The cache is a least recently used map capped at `cache.maxEntries`.
