"""docs/art/fixture_catalog.png: every asset of the terminal kit, by category, drawn only from the exported JSON
(src/data/fixtures/catalog.json and sprites/*.json) through fixture_ops.bake. If an asset looks right here, the data
the game loads is complete."""
import os
from lib import fmt, rect, text, g, svg_doc, floor_defs
import fixture_core as fc
import fixture_ops as FO
import air2
import specs2
import surfaces
from terminal_sheets import section, header, wrap, MUTED, WHITE, BG, OUT
import subprocess

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "src", "data", "fixtures")


def air_render(o):
    s = specs2.SPECS[o["type"]]
    k = o["scale"]
    return g(air2.render(s, 2, 60 * k, True, (0.9, 1.3)),
             f"translate({fmt(o['x'])} {fmt(o['y'])}) scale({fmt(k)}) rotate({o.get('rot', 0)}) "
             f"translate(0 {fmt(-s['L'] / 2)})")


def main():
    cat = FO.load(os.path.join(DATA, "catalog.json"))
    packs = {c["id"]: FO.load(os.path.join(DATA, "sprites", f"{c['id']}.json")) for c in cat["categories"]}
    W = 1880
    CW, AH = 170, 130
    body = [header("Terminal asset catalog",
                   f"{len(cat['assets'])} assets in {len(cat['categories'])} categories, drawn only from "
                   "src/data/fixtures. Each tile fits the asset at up to 60 px per meter, tier 3, rotation 0.")]
    y = 110
    for c in cat["categories"]:
        assets = [a for a in cat["assets"] if a["category"] == c["id"]]
        per_row = (W - 80 + 14) // (CW + 14)
        rows = (len(assets) + per_row - 1) // per_row
        sec_h = 60 + rows * (AH + 54)
        body.append(section(20, y, W - 40, sec_h, c["name"], c["note"]))
        for i, a in enumerate(assets):
            col, row = i % per_row, i // per_row
            x = 40 + col * (CW + 14)
            yy = y + 52 + row * (AH + 54)
            w, h = a["size"]
            ppm = min(60.0, (CW - 24) / w, (AH - 24) / h)
            svg = FO.bake(packs[c["id"]]["assets"][a["id"]]["ops"], ppm, 3, 0, True, air_render)
            body.append(rect(x, yy, CW, AH, "#d9dee4", rx=6))
            body.append(g(svg, f"translate({fmt(x + (CW - w * ppm) / 2)} {fmt(yy + (AH - h * ppm) / 2)}) "
                               f"scale({fmt(ppm)})"))
            name = a["name"]
            while len(name) * 12 * 0.64 > CW - 4:
                name = name[:-2].rstrip(" ,") + "."
            body.append(text(x + 2, yy + AH + 17, name, 12, WHITE, "bold"))
            body.append(text(x + 2, yy + AH + 33, a["id"], 11, MUTED))
        y += sec_h + 24
    defs = floor_defs() + fc.defs() + FO.defs() + air2.defs() + surfaces.surface_defs()
    doc = svg_doc(W, int(y + 10), rect(0, 0, W, int(y + 10), BG) + "".join(body), defs)
    open("/tmp/fixture_catalog.svg", "w").write(doc)
    subprocess.run(["rsvg-convert", "/tmp/fixture_catalog.svg", "-o", os.path.join(OUT, "fixture_catalog.png")],
                   check=True)
    print("wrote fixture_catalog.png")


if __name__ == "__main__":
    main()
