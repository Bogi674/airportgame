# T05 work notes

Geometry in `src/render/sprites/geometry.ts` is a direct port of `air2.py` (hw, fuselage, wing with rake and kink round, le/te edges, winglets, stabilizer, fin, windscreen styles, upper deck, bounds). The baker in `src/render/sprites/aircraftSprite.ts` draws the layer order of section 4.2: low wing types draw flap tracks, underwing engines, wing, stabilizer, fuselage, then upper deck, doors, windows and windscreen; high wing types draw stabilizer, fuselage, sponsons, details, then the wing over them; rear engines, fin, T tail stabilizer, props last.

Visual check: `handoff/work/T05-sprite-sheet-tier3.png` shows all 10 MVP 1 types at tier 3 against `docs/art/aircraft_mvp_lineup.png`, which the user named as the proportion reference. Silhouettes, nacelle placement, wing sweep and T tails match.

Data change: `crj9` hstab x 33.2 to 32.5 so the T tail ends within 2 percent of the published length (it ended at 36.97 m against 36.19 m).

Left to T06: livery tint on nacelles, tier table.
