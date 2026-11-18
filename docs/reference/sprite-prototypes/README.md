# Sprite prototypes

Python reference implementation used to make the sheets in `docs/art/`. It writes SVG in meters. Port the geometry and rules to TypeScript under `src/render/sprites/` and `src/render/markings/`. Do not ship Python.

| File | Contents |
| --- | --- |
| `lib.py` | Small SVG helpers (rect, circle, line, path, text) |
| `specs2.py` | Sprite base geometry for the 14 Phase 1 family representatives, including gear and underside heights |
| `air2.py` | Aircraft renderer: fuselage ogive, wing planform with kink rounding and raked tips, winglets, nacelle flow types, props, windscreen styles, doors and windows, layer order, livery tint, detail tiers |
| `gse.py` | GSE sprites at real size, placement by front point and direction, aircraft hard footprints and overhead zones, the collision checker |
| `people2.py` | People figure layers, hair and headwear, staff overlays, walk cycle frames, tiers |
| `stands2.py` | Stand marking generator: lead in, stop ladder, restraint area, hatched zones, fuel pits, roads, GSE parking |
| `stands3.py` | Occupied stand scenes with vehicle placement at service points, checked by `gse.check` |
| `surfaces.py` | Surface texture patterns |
| `gen_data.py` | Source table for `aircraft.mvp.json` |
| `fixture_core.py` | Terminal kit drawing context: height based shadows baked toward the world sun, gradients, detail tiers, op recording, sub placement |
| `fixtures_processing.py` | Check in, security, passport control and gate desk in three levels, kiosk, self bag drop, automated passport gate |
| `fixtures_general.py` | Seating, lounge, washrooms, decoration, vending, screens and airport service items |
| `fixtures_building.py` | Airline office furniture, escalators, stairs, elevators, travelators, janitor room |
| `fixtures_zoning.py` | Security exits, staff door, customs channel and the zones overlay |
| `fixtures_baggage.py` | Ramp stubs, screening machine, baggage bay, staging lane, carousel, link band and buffer ring |
| `baggage_links.py` | Automatic baggage links (rules A to F), L path search and routing lookups of `docs/BAGGAGE.md`, with self checks |
| `apron_stand.py` | Contact stand for scenes from the `stands2.py` primitives with the revision 3 jet bridge |
| `export_fixtures.py` | Writes the asset kit to `src/data/fixtures/` (catalog and sprite packs) |
| `fixture_ops.py` | Reference baker for the exported draw ops, the behaviour of the TypeScript baker |
| `terminal_sheets.py`, `terminal_scene.py`, `baggage_sheet.py`, `zoning_sheet.py`, `catalog_sheet.py` | The terminal kit reference sheets in `docs/art/` |

Requirements to run: Python 3.10+, `shapely`, and `rsvg-convert` to rasterize SVG. Terminal kit: `python3 export_fixtures.py` regenerates `src/data/fixtures/`, `python3 terminal_sheets.py`, `baggage_sheet.py`, `zoning_sheet.py` and `catalog_sheet.py` regenerate the sheets. Known simplification to fix in the port: the restraint area in `stands2.py` uses a fixed taper. The game must generate it from the union of assigned type outlines as specified in `docs/ART_AND_ASSETS.md` section 9.1.
