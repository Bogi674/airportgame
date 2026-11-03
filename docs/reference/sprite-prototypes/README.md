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

Requirements to run: Python 3.10+, `shapely`, and `rsvg-convert` to rasterize SVG. Known simplification to fix in the port: the restraint area in `stands2.py` uses a fixed taper. The game must generate it from the union of assigned type outlines as specified in `docs/ART_AND_ASSETS.md` section 9.1.
