"""docs/art/terminal_zones_kit.png: zone types, zone transition fixtures and the terminal scene with the zone overlay.
Rules are in docs/TERMINAL_ZONING.md.
"""
from lib import fmt, rect, circle, line, text, g, label_chip
import fixture_core as fc
from fixture_core import D, C
import fixtures_processing as fp
import fixtures_zoning as fz
import terminal_scene as TS
from terminal_sheets import card, flow, section, header, write, chip, tw, wrap, gen_card, MUTED, WHITE

ZONE_RECTS = [
    ("public", 0, 0, 36, 56), ("public", 36, 10, 17, 17.6), ("public", 36, 30, 17, 2),
    ("public", 36, 35.6, 10, 20.4), ("public", 40.6, 32, 5.4, 3.6), ("public", 36, 27.6, 1, 2.4),
    ("secure", 53, 10, 6, 17.6), ("secure", 37, 27.6, 22, 2.4), ("secure", 53, 30, 6.6, 2),
    ("international", 59, 10, 3, 22), ("international", 46, 32, 16, 24), ("international", 62, 0, 50, 56),
    ("staff", 36, 0, 26, 10), ("staff", 36.3, 32.3, 4.3, 3.3),
]
BADGES = [(53.0, 15.0, "secure"), (53.0, 19.4, "secure"), (53.0, 23.8, "secure"), (37.0, 28.8, "public"),
          (59.0, 14.0, "international"), (59.0, 20.0, "international"), (59.0, 26.0, "international"),
          (41.0, 10.0, "staff"), (38.3, 35.6, "staff")]

RULES = {
    "public": "Landside. Open to everyone. Check in, bag drop, arrivals hall, baggage claim.",
    "commercial": "Shop units. Takes the security side of the zone it touches, never two sides at once.",
    "secure": "Airside after security. Domestic gates. Leave only through a security exit.",
    "international": "Airside after passport control. International gates and their shops.",
    "staff": "Back of house. Staff only, entered through staff doors with a card reader.",
}


def sheet_zones():
    W = 1880
    body = [header("Terminal zoning",
                   "Zones are painted per 2 m cell like the floor. People cross a zone edge only through a "
                   "transition fixture or a staff door. Rules in docs/TERMINAL_ZONING.md.")]
    y = 110
    # ---------------- zone types ------------------------------------------------------------------------------
    tiles = []
    for k, (label, col, hatch) in fz.ZONE_STYLE.items():
        def draw(x, yy, k=k, label=label, col=col):
            o = [rect(x, yy, 340, 150, "#2e3642", rx=10)]
            sw = g(fz.zone_rect(k, 0, 0, 4, 4), f"translate({x + 16} {yy + 16}) scale(20)")
            o.append(rect(x + 16, yy + 16, 80, 80, "#e4e8ed", rx=4) + sw)
            o.append(text(x + 112, yy + 38, label, 14, WHITE, "bold"))
            o.append(text(x + 112, yy + 58, col, 12, MUTED))
            yy2 = yy + 116
            for ln in wrap(RULES[k], 310, 12):
                o.append(text(x + 16, yy2, ln, 12, "#d5dbe3"))
                yy2 += 16
            return "".join(o), 150
        tiles.append(dict(w=340, draw=draw))
    s, yend = flow(40, y + 52, W - 80, tiles, gap=24)
    body.append(section(20, y, W - 40, yend - y + 24, "Zone types"))
    body.append(s)
    y = yend + 50

    # ---------------- transition fixtures --------------------------------------------------------------------
    px = 50
    wall_ctx = rect(-20, 0, 60, 0.3, C["wall"])
    cards = [
        gen_card(fp.security, 16, 4, "Security lane", "16 x 4 m, three levels", "Public to Secure, one way", 22,
                 kw=dict(level=2), floor="f_secure", ah=200),
        gen_card(fz.security_exit_staffed, 4, 4, "Security exit, staffed", "4 x 4 m, 1 officer",
                 "Secure to Public, one way, drop arm", px, ah=300),
        gen_card(fz.security_exit_auto, 6, 2, "Automated exit lane", "2 x 6 m, no staff",
                 "Secure to Public, anti return doors", px, ah=300, rot=90),
        gen_card(fz.exit_revolving, 2.6, 2.6, "Revolving exit", "2.6 m drum, no staff", "Secure to Public, one way",
                 px, ah=300),
        gen_card(fp.passport, 2, 2, "Passport control", "2 x 2 m, levels 1 to 3",
                 "Secure to International, or International to Public on arrival", px, kw=dict(level=3), ah=300,
                 floor="f_stone"),
        gen_card(fp.egate, 2, 2, "Automated passport gate", "2 x 2 m", "Same direction rules as passport control",
                 px, ah=300, floor="f_stone"),
        gen_card(fz.staff_door, 2, 1.2, "Staff door", "2 m door on a wall edge", "Any zone to Staff, card reader",
                 px, ah=300),
        gen_card(fz.customs_channel, 4, 4, "Customs channel", "4 x 4 m, 1 to 2 officers",
                 "Arrivals node inside Public, green and red", px, ah=300),
    ]
    s, yend = flow(40, y + 52, W - 80, cards)
    body.append(section(20, y, W - 40, yend - y + 24, "Transition fixtures", "the only way across a zone edge"))
    body.append(s)
    y = yend + 50

    # ---------------- zoned terminal -------------------------------------------------------------------------
    parts = TS.build(None, emit=False)
    PX = TS.PX
    Wm, Hm = 112.0, TS.H_M
    Z = [fz.zone_rect(k, x, yy, w, h) for k, x, yy, w, h in ZONE_RECTS]
    B = [fz.gate_badge(x, yy, k, 0.85) for x, yy, k in BADGES]
    scene = g("".join(parts["L"]) + "".join(Z) + "".join(parts["Wl"]) + "".join(parts["F"]) + "".join(B),
              f"translate(40 {y + 60}) scale({fmt(PX)})")
    clip = (f'<clipPath id="zclip"><rect x="40" y="{y + 60}" width="{Wm * PX}" height="{Hm * PX}"/></clipPath>')
    sec_h = Hm * PX + 120
    body.append(section(20, y, W - 40, sec_h, "Zoned terminal", "the scene from terminal_scene_kit.png with the "
                                                                  "zone overlay on"))
    body.append(clip + g(scene, None, 'clip-path="url(#zclip)"'))
    body.append(rect(40, y + 60, Wm * PX, Hm * PX, "none", "#3b4656", 1))
    lx = 40 + Wm * PX + 24
    yy = y + 80
    body.append(text(lx, yy, "Overlay key", 14, WHITE, "bold"))
    yy += 22
    for k, (label, col, hatch) in fz.ZONE_STYLE.items():
        if k == "commercial":
            continue
        body.append(rect(lx, yy, 18, 18, col, rx=3, op=0.85))
        body.append(text(lx + 28, yy + 14, label.split(",")[0], 12, "#d5dbe3"))
        yy += 26
    yy += 8
    body.append(g(fz.gate_badge(0, 0, "secure", 0.85), f"translate({lx + 10} {yy + 6}) scale(12)"))
    for ln in wrap("Transition: arrow in the color of the zone it leads into", 230, 12):
        body.append(text(lx + 28, yy + 10, ln, 12, "#d5dbe3"))
        yy += 16
    yy += 14
    body.append(g(fz.breach_badge(0, 0, 0.85), f"translate({lx + 10} {yy + 6}) scale(12)"))
    for ln in wrap("Breach: a plain door or gap between two zones. Walking is blocked there and the room tool "
                   "warns", 230, 12):
        body.append(text(lx + 28, yy + 10, ln, 12, "#d5dbe3"))
        yy += 16
    y += sec_h + 30
    write("terminal_zones_kit", W, int(y), "".join(body))


if __name__ == "__main__":
    sheet_zones()
