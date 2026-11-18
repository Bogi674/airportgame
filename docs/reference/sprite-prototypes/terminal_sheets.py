"""Reference sheets for the terminal fixture kit. Writes SVG and PNG into docs/art/.

Run from this folder:  python3 terminal_sheets.py  (needs rsvg-convert on the path)
"""
import math
import os
import subprocess
import sys

from lib import fmt, rect, circle, line, text, g, path, svg_doc, floor_defs, esc
import fixture_core as fc
from fixture_core import D, C
import fixtures_processing as fp
import fixtures_general as fg
import fixtures_building as fb
import people2 as pp
import air2
import specs2
import surfaces

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "art")
BG, PANEL, CARD, MUTED, WHITE = "#1e232b", "#262d37", "#2e3642", "#aab3bf", "#ffffff"
FONT_W = 0.56          # average glyph width of DejaVu Sans as a fraction of the font size
_clip = [0]


# ----------------------------------------------------------------------------------------------------------------
# Text helpers (pixel space)
# ----------------------------------------------------------------------------------------------------------------

def tw(s, size):
    return len(s) * size * FONT_W


def wrap(s, width, size):
    words, lines, cur = s.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if tw(t, size) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def chip(x, y, s, fill, fg=WHITE, size=11):
    w = tw(s, size) + 16
    h = size + 9
    return rect(x, y, w, h, fill, rx=h / 2) + text(x + w / 2, y + h / 2 + size * 0.36, s, size, fg, "bold", "middle"), w


LEVEL_CHIP = {1: ("Level 1 Basic", "#5d6672"), 2: ("Level 2 Standard", "#2f6fd1"),
              3: ("Level 3 Premium", "#b8862b"), "auto": ("Automated", "#1f8a7a"), "gen": ("", "#5d6672")}


# ----------------------------------------------------------------------------------------------------------------
# People
# ----------------------------------------------------------------------------------------------------------------

PAX = [
    dict(skin=pp.SKIN[1], hair="short", hair_col=pp.HAIR["dark"], shirt="#2b3442", overlay="suit",
         items=["suitcase"], case="#20252c"),
    dict(skin=pp.SKIN[3], hair="hijab", hair_col="#7a3b5a", shirt="#d0659a", items=["suitcase"], case="#7a3fb5"),
    dict(skin=pp.SKIN[5], hair="cap", hair_col="#2f6fd1", shirt="#f2f2f2", items=["backpack"]),
    dict(skin=pp.SKIN[0], hair="ponytail", hair_col=pp.HAIR["blonde"], shirt="#2f9d8f", items=["suitcase"],
         case="#e0a030"),
    dict(skin=pp.SKIN[4], hair="peci", hair_col="#1d1714", shirt="#8a5a2b", items=["suitcase"], case="#2f4a6e"),
    dict(skin=pp.SKIN[2], hair="bun", hair_col=pp.HAIR["black"], shirt="#e3b04b", items=["handbag"]),
    dict(skin=pp.SKIN[6], hair="afro", hair_col=pp.HAIR["black"], shirt="#c8102e", items=["shoulder_bag"]),
    dict(skin=pp.SKIN[2], hair="side_part", hair_col=pp.HAIR["grey"], shirt="#4b6c8f", items=["phone"]),
]
STAFF = dict(
    agent=dict(skin=pp.SKIN[2], hair="bun", hair_col=pp.HAIR["black"], shirt="#1f3864", overlay="blazer"),
    agent2=dict(skin=pp.SKIN[4], hair="hijab", hair_col="#1f3864", shirt="#1f3864", overlay="blazer"),
    security=dict(skin=pp.SKIN[3], hair="short", hair_col=pp.HAIR["black"], shirt="#1f2f4a", items=["radio"]),
    security2=dict(skin=pp.SKIN[2], hair="hijab", hair_col="#1f2f4a", shirt="#1f2f4a"),
    customs=dict(skin=pp.SKIN[4], hair="beret", hair_col="#3a4a2a", shirt="#b5a27a"),
    cleaner=dict(skin=pp.SKIN[5], hair="short", hair_col=pp.HAIR["black"], shirt="#7d8794", items=["cart"]),
)


def nobag(r):
    """Passengers inside security carry nothing: their bags ride the x-ray."""
    r = dict(r)
    r["items"] = [i for i in r.get("items", []) if i not in ("suitcase", "backpack", "shoulder_bag", "handbag")]
    return r


def person(x, y, rot, recipe, frame=1):
    return g(pp.person(recipe, frame, 2), f"translate({fmt(x)} {fmt(y)}) rotate({fmt(rot)})")


# ----------------------------------------------------------------------------------------------------------------
# Cards
# ----------------------------------------------------------------------------------------------------------------

def card(x, y, cw, area_h, px, floor, content, fw, fh, ox, oy, title, chip_key, lines, grid=True, foot=True):
    """content is SVG in meters with the fixture origin at (0, 0). ox, oy place that origin inside the card area
    in meters. Returns (svg, card height)."""
    _clip[0] += 1
    cid = f"cc{_clip[0]}"
    o = [rect(x, y, cw, area_h, "#d9dee4", rx=8)]
    aw, ah = cw / px, area_h / px
    inner = [rect(-ox, -oy, aw, ah, f"url(#{floor})")]
    if grid:
        gx = -2.0 * math.floor(ox / 2.0)
        while gx < aw - ox:
            inner.append(line(gx, -oy, gx, ah - oy, "#00000014", 1.0 / px))
            gx += 2.0
        gy = -2.0 * math.floor(oy / 2.0)
        while gy < ah - oy:
            inner.append(line(-ox, gy, aw - ox, gy, "#00000014", 1.0 / px))
            gy += 2.0
    if foot:
        inner.append(rect(0, 0, fw, fh, "none", "#5b6573", 1.0 / px, extra=f'stroke-dasharray="{fmt(5 / px)} '
                                                                          f'{fmt(4 / px)}" opacity="0.55"'))
    inner.append(content)
    o.append(f'<clipPath id="{cid}"><rect x="{fmt(x)}" y="{fmt(y)}" width="{fmt(cw)}" height="{fmt(area_h)}" '
             f'rx="8"/></clipPath>')
    o.append(g(g(inner, f"translate({fmt(x + ox * px)} {fmt(y + oy * px)}) scale({fmt(px)})"), None,
               f'clip-path="url(#{cid})"'))
    ty = y + area_h + 22
    o.append(text(x + 2, ty, title, 15, WHITE, "bold"))
    if chip_key is not None and LEVEL_CHIP[chip_key][0]:
        c, w = chip(0, 0, *LEVEL_CHIP[chip_key])
        o.append(g(c, f"translate({fmt(x + cw - w)} {fmt(ty - 15)})"))
    yy = ty + 20
    for i, ln in enumerate(lines):
        size = 12
        for part in wrap(ln, cw - 4, size):
            o.append(text(x + 2, yy, part, size, MUTED if i else "#d5dbe3", "normal"))
            yy += 16
    return "".join(o), yy - y


def bake(fn, px, tier=3, **kw):
    d = D(px, tier)
    r = fn(d, **kw)
    return d.svg(), r


def section(x, y, w, h, title, sub=""):
    o = rect(x, y, w, h, PANEL, rx=12) + text(x + 22, y + 34, title, 20, WHITE, "bold")
    if sub:
        o += text(x + 22 + len(title) * 20 * 0.64 + 16, y + 34, sub, 13, MUTED)
    return o


def header(title, sub):
    return text(40, 52, title, 30, WHITE, "bold") + text(40, 82, sub, 15, MUTED)


def write(name, W, H, body):
    import fixtures_zoning
    defs = floor_defs() + fc.defs() + air2.defs() + surfaces.surface_defs() + fixtures_zoning.zone_defs()
    doc = svg_doc(W, H, rect(0, 0, W, H, BG) + body, defs)
    svgp = os.path.join("/tmp", name + ".svg")
    open(svgp, "w").write(doc)
    pngp = os.path.join(OUT, name + ".png")
    subprocess.run(["rsvg-convert", svgp, "-o", pngp], check=True)
    print("wrote", pngp)


def flow(x0, y0, width, cards, gap=20, row_gap=26):
    """Lays cards (list of callables taking x, y and returning (svg, h, w)) in rows. Returns svg and end y."""
    out, x, y, rowh = [], x0, y0, 0
    for c in cards:
        w = c["w"]
        if x + w > x0 + width + 1:
            x = x0
            y += rowh + row_gap
            rowh = 0
        s, h = c["draw"](x, y)
        out.append(s)
        rowh = max(rowh, h)
        x += w + gap
    return "".join(out), y + rowh


# ================================================================================================================
# Sheet 1: processing fixtures
# ================================================================================================================

def sheet_processing():
    px = 80
    CW = 340
    body = [header("Terminal processing fixtures: three levels and the automated variants",
                   "Check in, passport control and boarding gate. Real size in meters on the 2 m grid, tier 3 at "
                   "80 px per meter, baked shadow from the upper left. Dashed box is the placement footprint.")]

    def proc_card(fn, kw, fw, fh, title, ck, lines, people, ramp=False, floor="f_terrazzo", mat=None,
                  ox=None, oy=None, ah=None, extra_back=""):
        def draw(x, y):
            s, _ = bake(fn, px, **kw)
            pre = ""
            if mat:
                pre = bake(mat, px)[0]
            back = extra_back
            if ramp:
                back += bake(lambda d: fc.ramp_stub(d, 0, -2.0, True), px)[0]
            ppl = "".join(person(*p) for p in people)
            _ox = ox if ox is not None else (CW / px - fw) / 2
            _oy = oy if oy is not None else (2.3 if ramp else 0.6)
            _ah = ah if ah is not None else 400
            return card(x, y, CW, _ah, px, floor, back + pre + s + ppl, fw, fh, _ox, _oy, title, ck, lines)
        return dict(w=CW, draw=draw)

    y0 = 110
    # --- check in ---
    lv = [
        ("Check in desk", 1, ["2 x 2 m, 1 agent, 120 s per party",
                              "Laminate counter, flat scale plate, plain transfer belt, one monitor."]),
        ("Check in desk", 2, ["2 x 2 m, 1 agent, 105 s per party",
                              "Stone counters, powered weigh belt with rails, customer display, airline back panel, "
                              "glass divider."]),
        ("Check in desk", 3, ["2 x 2 m, 1 agent, 95 s per party",
                              "Curved walnut and stone counters, chrome belt, backlit airline panel, glass fins, "
                              "premium mat. Needed for business class."]),
    ]
    cards = []
    for name, l, lines in lv:
        cards.append(proc_card(fp.checkin, dict(level=l, livery=fc.LIVERY[0], bag=True), 2, 2, name, l, lines,
                               [(0.3, 0.44, 180, STAFF["agent"]), (1.25, 1.86, 0, PAX[l - 1])], ramp=True,
                               mat=fp.checkin_mat if l == 3 else None))
    cards.append(proc_card(fp.kiosk_checkin, dict(livery=fc.LIVERY[1]), 2, 2, "Self check in kiosk", "auto",
                           ["2 x 2 m, no staff, 75 s",
                            "Touch screen in a branded crown, passport scanner, card reader, print slot, privacy "
                            "wings. Older travelers rate it lower."],
                           [(1.0, 1.42, 0, PAX[2])], oy=2.3))
    cards.append(proc_card(fp.bagdrop_self, dict(livery=fc.LIVERY[1], bag=True), 4, 2, "Self bag drop", "auto",
                           ["4 x 2 m, 40 s, 1 roaming agent per 4 units",
                            "Weigh and scan lane with light curtain and rear shutter, screen tower. The lane meets "
                            "the out ramp of the left cell."],
                           [(2.41, 1.62, 0, PAX[3])], ramp=True, ox=0.125))
    s, yend = flow(40, y0 + 52, 1780, cards)
    body.insert(1, section(20, y0, 1840, yend - y0 + 24, "Check in", "with the baggage out ramp cell behind each "
                                                                      "bag node (docs/BAGGAGE.md 7.1)"))
    body.append(s)

    # --- passport ---
    y1 = yend + 50
    lv = [
        (1, ["2 x 2 m, 1 officer, 45 s", "Open podium desk with monitor, document reader and stamp. Lane post "
                                         "and belt at the exit."]),
        (2, ["2 x 2 m, 1 officer, 38 s", "Enclosed booth with glass window, fingerprint ledge on the lane side, "
                                         "glass exit flap."]),
        (3, ["2 x 2 m, 1 officer, 30 s", "Rounded biometric booth with LED trim, face camera pillar, fingerprint "
                                         "pad, double glass exit doors."]),
    ]
    cards = []
    for l, lines in lv:
        cards.append(proc_card(fp.passport, dict(level=l), 2, 2, "Passport control", l, lines,
                               [(0.32 + (0.06 if l > 1 else 0), 1.0, 90, STAFF["customs"]),
                                (1.56, 1.0, -90, PAX[3 + l])], floor="f_stone", ah=270, oy=0.69))
    cards.append(proc_card(fp.egate, dict(), 2, 2, "Automated passport gate", "auto",
                           ["2 x 2 m, 20 s, 1 officer per 5 gates",
                            "Mantrap lane with entry and exit glass flaps, passport reader, camera mast. 8 percent "
                            "referred to a booth."],
                           [(1.0, 1.05, 0, PAX[0])], floor="f_stone", ah=270, oy=0.69))
    s, yend = flow(40, y1 + 52, 1780, cards)
    body.append(section(20, y1, 1840, yend - y1 + 24, "Passport control", "departures and arrivals, officer on "
                                                                          "the left, passengers walk up the lane"))
    body.append(s)

    # --- gate desk ---
    y2 = yend + 50
    CW2 = 400
    lv = [
        (1, ["4 x 2 m, 1 agent, 5 s per passenger", "Podium desk, boarding pass reader, gate sign on a pole."],
         [(1.5, 0.42, 180, STAFF["agent"]), (1.5, 1.86, 0, PAX[6])]),
        (2, ["4 x 2 m, 2 agents, 3.5 s per passenger", "Twin stone desk, two readers, gate display on a stand, "
                                                      "queue belt."],
         [(0.95, 0.48, 180, STAFF["agent"]), (2.25, 0.48, 180, STAFF["agent2"]), (0.95, 1.86, 0, PAX[7]),
          (2.25, 1.86, 0, PAX[1])]),
        (3, ["4 x 2 m, 2 agents, 3 s per passenger", "Curved walnut desk, LED wall, priority lane with its own "
                                                    "scanner and flap. Lifts premium satisfaction."],
         [(0.95, 0.5, 180, STAFF["agent"]), (2.25, 0.5, 180, STAFF["agent2"]), (3.5, 1.5, 0, PAX[0]),
          (1.6, 1.86, 0, PAX[5])]),
    ]
    cards = []
    for l, lines, ppl in lv:
        def mk(l=l, lines=lines, ppl=ppl):
            def draw(x, y):
                s, _ = bake(fp.gatedesk, px, level=l, livery=fc.LIVERY[0])
                p = "".join(person(*q) for q in ppl)
                return card(x, y, CW2, 270, px, "f_carpet", s + p, 4, 2, (CW2 / px - 4) / 2, 0.69,
                            "Boarding gate desk", l, lines)
            return dict(w=CW2, draw=draw)
        cards.append(mk())

    # tier strip card
    def tiers(x, y):
        o = []
        cw = 540
        o.append(rect(x, y, cw, 270, "#d9dee4", rx=8))
        labels = [("Tier 3, above 24 px/m", 3, 40), ("Tier 2, 12 to 24", 2, 20), ("Tier 1, 6 to 12", 1, 10)]
        cx = x + 14
        for lab, t, tpx in labels:
            s, _ = bake(fp.checkin, tpx, tier=t, level=2, livery=fc.LIVERY[0])
            w = 2.0 * tpx
            boxw = 162
            o.append(rect(cx, y + 14, boxw, 200, "#e4e8ed", rx=6))
            o.append(g(s,
                       f"translate({fmt(cx + (boxw - w) / 2)} {fmt(y + 14 + (200 - w) / 2)}) scale({tpx})"))
            o.append(text(cx + boxw / 2, y + 236, lab, 12, "#2b333e", "bold", "middle"))
            cx += boxw + 10
        o.append(text(x + 2, y + 270 + 22, "Detail tiers", 15, WHITE, "bold"))
        yy = y + 270 + 42
        for ln in wrap("Same geometry at every zoom. Tier 2 drops parts under 0.012 m2 and fine lines. Tier 1 keeps "
                       "parts over 0.1 m2 as flat fills. Below 6 px/m the roof covers the interior.", cw - 4, 12):
            o.append(text(x + 2, yy, ln, 12, MUTED))
            yy += 16
        return "".join(o), yy - y

    cards.append(dict(w=540, draw=tiers))
    s, yend = flow(40, y2 + 52, 1800, cards)
    body.append(section(20, y2, 1840, yend - y2 + 24, "Boarding gate desk", "agents at the top, passengers board "
                                                                            "past the bottom edge"))
    body.append(s)
    H = yend + 50
    write("terminal_processing_kit", 1880, int(H), "".join(body))


# ================================================================================================================
# Sheet 2: security lanes
# ================================================================================================================

def sheet_security():
    px = 70
    W = 1880
    body = [header("Security checkpoint lanes, three levels",
                   "One lane is 16 m by 4 m on the 2 m grid, passenger flow left to right. Bags ride the top "
                   "conveyor, people walk below it. 70 px per meter, tier 3.")]
    info = {
        1: ("Level 1 Basic lane", ["About 300 passengers per hour (12 s)", "4 officers: pass check, divest, "
                                   "x-ray operator, search", "Static divest table, single view x-ray, walk "
                                   "through metal detector, gravity reclaim, tray cart"]),
        2: ("Level 2 Standard lane", ["About 360 passengers per hour (10 s)", "5 officers, adds a bag search "
                                      "officer at the reject table", "Two divest positions, dual view x-ray, "
                                      "glass guides, trace detection table, powered reclaim"]),
        3: ("Level 3 Smart lane", ["About 450 passengers per hour (8 s)", "4 officers on the lane plus one remote "
                                   "screener seat in the screening room", "Four parallel divest stations, "
                                   "automatic tray return, CT scanner, body scanner, automatic reject lane, "
                                   "resolution table"]),
    }
    people = {
        1: [(1.6, 2.8, 90, nobag(PAX[2])), (1.8, 1.58, 0, nobag(PAX[0])), (4.92, 2.46, 90, nobag(PAX[3])),
            (5.9, 3.3, -90, STAFF["security"]), (6.74, 2.06, 0, STAFF["security2"]),
            (8.5, 2.55, -90, STAFF["security"]), (9.1, 2.55, 90, nobag(PAX[4])), (7.9, 1.58, 0, nobag(PAX[5]))],
        2: [(0.55, 2.7, 0, STAFF["security2"]), (1.5, 1.62, 0, nobag(PAX[1])), (3.3, 1.62, 0, nobag(PAX[6])),
            (2.6, 2.46, 90, nobag(PAX[2])), (5.62, 2.46, 90, nobag(PAX[0])), (6.8, 2.52, -90, STAFF["security"]),
            (7.96, 2.4, 0, STAFF["security"]), (11.4, 2.3, 0, STAFF["security2"]), (9.0, 1.62, 0, nobag(PAX[3]))],
        3: [(1.5, 2.78, 90, nobag(PAX[1])), (0.94, 1.92, 0, nobag(PAX[0])), (3.24, 1.92, 0, nobag(PAX[5])),
            (6.6, 2.62, 90, nobag(PAX[3])), (7.7, 3.6, -90, STAFF["security"]),
            (12.75, 3.15, 0, STAFF["security2"]), (10.4, 2.5, 0, nobag(PAX[6])), (14.2, 2.8, 180, PAX[4])],
    }
    y = 110
    lane_x = 60
    LW = 16 * px
    for lvl in (1, 2, 3):
        d = D(px, 3)
        parts = fp.security(d, lvl)
        ppl = "".join(person(*p) for p in people[lvl])
        sec_h = 4 * px + 120
        body.append(section(20, y, W - 40, sec_h, info[lvl][0], ""))
        c, w = chip(0, 0, *LEVEL_CHIP[lvl])
        body.append(g(c, f"translate({fmt(20 + 22 + tw(info[lvl][0], 20) * 1.08 + 14)} {fmt(y + 19)})"))
        ly = y + 56
        body.append(rect(lane_x - 10, ly - 10, LW + 20, 4 * px + 20, "#d9dee4", rx=8))
        inner = rect(-10 / px, -10 / px, 16 + 20 / px, 4 + 20 / px, "url(#f_secure)") + d.svg() + ppl
        inner += rect(0, 0, 16, 4, "none", "#5b6573", 1 / px, extra=f'stroke-dasharray="{fmt(5 / px)} '
                                                                     f'{fmt(4 / px)}" opacity="0.55"')
        body.append(g(inner, f"translate({lane_x} {ly}) scale({px})"))
        # numbered callouts below the lane, spread so they never touch
        xs = sorted([(lane_x + px * xc, name) for name, xc in parts])
        placed = []
        for xv, name in xs:
            xp = max(xv, (placed[-1][0] + 30) if placed else xv)
            placed.append((xp, xv, name))
        by = ly + 4 * px + 26
        for i, (xp, xv, name) in enumerate(placed):
            body.append(line(xv, ly + 4 * px + 8, xp, by - 11, "#7d8794", 1))
            body.append(circle(xp, by, 11, "#3b4656", "#aab3bf", 1))
            body.append(text(xp, by + 4, str(i + 1), 11, WHITE, "bold", "middle"))
        # legend and stats on the right
        rx_ = lane_x + LW + 40
        yy = ly + 6
        for ln in info[lvl][1]:
            for part in wrap(ln, W - 60 - rx_, 13):
                body.append(text(rx_, yy, part, 13, "#d5dbe3" if ln == info[lvl][1][0] else MUTED,
                                 "bold" if ln == info[lvl][1][0] else "normal"))
                yy += 18
            yy += 4
        yy += 8
        colw = (W - 60 - rx_) / 2
        for i, (xp, xv, name) in enumerate(placed):
            cx_ = rx_ + (i % 2) * colw
            cy_ = yy + (i // 2) * 22
            body.append(circle(cx_ + 9, cy_ - 4, 9, "#3b4656", "#aab3bf", 1))
            body.append(text(cx_ + 9, cy_, str(i + 1), 10, WHITE, "bold", "middle"))
            body.append(text(cx_ + 24, cy_, name, 12, "#d5dbe3"))
        y += sec_h + 24
    write("terminal_security_kit", W, int(y + 20), "".join(body))


# ================================================================================================================
# Sheets 3 and 4: general fixtures
# ================================================================================================================

def gen_card(fn, fw, fh, title, dims, note="", px=52, cw=None, floor="f_terrazzo", wall=False, kw=None,
             people=(), pre=None, ah=None, pad=0.5, rot=0):
    """rot=90 lays a long item (escalator, stairs, walkway) on its side; fw and fh are the rotated size."""
    kw = kw or {}

    def draw(x, y):
        if rot:
            d = D(px, 3)
            d.place(fn, fw, 0, rot, **kw)
            s = d.svg()
        else:
            s, _ = bake(fn, px, **kw)
        if wall:
            s = rect(-20, -0.22, fw + 40, 0.22, C["wall"]) + s
        if pre:
            s = pre + s
        s += "".join(person(*p) for p in people)
        w_ = cw or max(214, int((fw + 2 * pad) * px))
        a_h = ah or int((fh + 2 * pad) * px + (0.22 * px if wall else 0))
        ox = (w_ / px - fw) / 2
        oy = (a_h / px - fh) / 2 + (0.11 if wall else 0)
        lines = [dims] + ([note] if note else [])
        return card(x, y, w_, a_h, px, floor, s, fw, fh, ox, oy, title, None, lines, grid=False)

    w = cw or max(214, int((fw + 2 * pad) * px))
    return dict(w=w, draw=draw)


def sheet_furniture():
    W = 1880
    px = 66
    body = [header("Terminal furniture: seating, lounge and washrooms",
                   "Real size in meters, 66 px per meter, tier 3. Front (the side people use) faces down. Seat "
                   "pitch 0.63 m, sofa seat 0.6 m, washroom fixtures to accessible standards.")]
    y = 110
    groups = [
        ("Waiting seating", "f_carpet", [
            (fg.bench_beam, 1.93, 0.68, "Beam seat, 3", "1.9 x 0.7 m, 3 seats", "Perforated steel, armrests", {}),
            (fg.bench_beam, 3.19, 0.68, "Beam seat, 5", "3.2 x 0.7 m, 5 seats", "Gate lounge standard", dict(seats=5)),
            (fg.bench_b2b, 1.93, 1.36, "Back to back, 6", "1.9 x 1.4 m, 6 seats", "Island rows in big lounges", {}),
            (fg.bench_charge, 3.14, 0.68, "Beam seat with charging", "3.2 x 0.7 m, 4 seats",
             "Side table with four outlets", {}),
            (fg.bench_padded, 2.11, 0.72, "Padded row, 3", "2.1 x 0.7 m, 3 seats", "Upholstered, chrome arms", {}),
            (fg.bench_wood, 1.9, 0.48, "Slat bench", "1.9 x 0.5 m, 3 seats", "Landside, no back", {}),
            (fg.recliner, 0.8, 1.86, "Recliner", "0.8 x 1.9 m, 1 seat", "Quiet zone and lounge", {}),
        ]),
        ("Lounge furniture", "f_wood", [
            (fg.sofa, 2.2, 0.92, "Sofa, 3 seat", "2.2 x 0.9 m", "", {}),
            (fg.sofa, 1.6, 0.92, "Sofa, 2 seat", "1.6 x 0.9 m", "", dict(seats=2, col=C["teal"])),
            (fg.armchair, 0.9, 0.9, "Armchair", "0.9 x 0.9 m", "", {}),
            (fg.coffee_table, 1.2, 0.6, "Coffee table", "1.2 x 0.6 m", "", {}),
            (fg.end_table_lamp, 0.5, 0.5, "End table and lamp", "0.5 m round", "", {}),
            (fg.floor_lamp, 0.84, 0.75, "Floor lamp", "0.8 x 0.8 m", "", {}),
            (fg.dining_set, 2.0, 2.0, "Dining set, 4", "2 x 2 m", "", {}),
            (fg.bar_counter, 3.0, 1.52, "Bar with stools", "3 x 1.5 m, 4 stools", "", {}),
            (fg.tv_credenza, 2.0, 0.55, "TV on credenza", "2 x 0.55 m", "", {}),
            (fg.cupboard, 1.6, 0.55, "Cupboard", "1.6 x 0.55 m, 2 m tall", "", {}),
            (fg.bookshelf, 1.2, 0.35, "Magazine shelf", "1.2 x 0.35 m", "", {}),
            (fg.work_desk, 1.4, 1.2, "Work desk", "1.4 x 1.2 m with chair", "", {}),
            (fg.buffet, 2.4, 0.8, "Buffet counter", "2.4 x 0.8 m", "", {}),
            (fg.coffee_station, 1.6, 0.6, "Coffee station", "1.6 x 0.6 m", "", {}),
            (fg.rug, 2.4, 1.7, "Rug", "2.4 x 1.7 m, floor layer", "", {}),
        ]),
        ("Washrooms", "f_tile_wc", [
            (fg.wc_stall, 1.0, 1.6, "Toilet stall", "1 x 1.6 m", "Wall hung pan, door swing", {}),
            (fg.wc_accessible, 2.2, 2.2, "Accessible toilet", "2.2 x 2.2 m", "1.5 m turning circle", {}),
            (fg.urinals, 2.4, 0.5, "Urinals, 3", "2.4 x 0.5 m", "Privacy dividers", {}),
            (fg.vanity, 2.4, 0.6, "Vanity, 3 basins", "2.4 x 0.6 m", "Mirror line on the wall", {}),
            (fg.sink_single, 0.6, 0.48, "Sink", "0.6 x 0.5 m", "", {}),
            (fg.hand_dryer, 0.32, 0.22, "Hand dryer", "0.3 x 0.2 m, wall", "", {}),
            (fg.towel_dispenser, 0.38, 0.62, "Towels and bin", "0.4 x 0.6 m, wall", "", {}),
            (fg.trash_round, 0.42, 0.42, "Trash can", "0.42 m round", "", {}),
            (fg.trash_recycle, 1.2, 0.44, "Recycling bins", "1.2 x 0.45 m", "", {}),
            (fg.baby_change, 0.9, 0.56, "Baby changing", "0.9 x 0.55 m, wall", "", {}),
            (fg.janitor_cart, 0.95, 0.55, "Janitor cart", "0.95 x 0.55 m", "", {}),
        ]),
    ]
    wall_items = {"Hand dryer", "Towels and bin", "Baby changing", "Vanity, 3 basins", "Urinals, 3", "Toilet stall",
                  "Sink", "TV on credenza", "Cupboard", "Magazine shelf"}
    for gname, floor, items in groups:
        cards = []
        ah = max(int((fh + 0.9 + (0.22 if t in wall_items else 0)) * px) for _, fw, fh, t, *_ in items)
        ah = max(ah, 150)
        for fn, fw, fh, title, dims, note, kw in items:
            cards.append(gen_card(fn, fw, fh, title, dims, note, px, floor=floor, wall=title in wall_items, kw=kw,
                                  ah=ah))
        s, yend = flow(40, y + 52, W - 80, cards)
        body.append(section(20, y, W - 40, yend - y + 24, gname))
        body.append(s)
        y = yend + 50
    write("terminal_furniture_kit", W, int(y), "".join(body))


def model_plane_svg(px):
    s = specs2.SPECS["a320neo"]
    k = 1 / 32.0
    L = s["L"]
    art = air2.render(s, 2, px * k, True, (0.9, 1.3), None)
    return g(art, f"translate(1.0 0.65) scale({fmt(k)}) rotate(90) translate(0 {fmt(-L / 2)})")


def sheet_amenities():
    W = 1880
    px = 60
    body = [header("Terminal amenities: decoration, vending, screens and airport items",
                   "Real size in meters, 60 px per meter, tier 3. Overhead items (ceiling screens, signs, hoods) "
                   "are drawn translucent with a dashed edge so the floor below stays readable.")]
    y = 110
    groups = [
        ("Decoration", "f_terrazzo", [
            (fg.planter_small, 0.7, 0.7, "Planter, small", "0.7 m round", "", {}),
            (fg.planter_large, 1.6, 1.6, "Planter, large", "1.6 m round", "", {}),
            (fg.planter_trough, 2.0, 0.6, "Planter trough", "2 x 0.6 m", "", {}),
            (fg.bamboo, 2.4, 0.5, "Bamboo trough", "2.4 x 0.5 m", "", {}),
            (fg.palm, 2.0, 2.0, "Potted palm", "2 x 2 m canopy", "", {}),
            (fg.tree_bench, 3.6, 3.6, "Tree with ring bench", "3.6 m round, 16 seats", "", {}),
            (fg.fountain, 2.4, 2.4, "Fountain", "2.4 m round", "", {}),
            (fg.sculpture, 1.6, 1.6, "Sculpture on plinth", "1.6 x 1.6 m", "", {}),
            (fg.medallion, 3.0, 3.0, "Floor medallion", "3 m round, floor layer", "", {}),
            (fg.model_case, 2.0, 1.3, "Aircraft model case", "2 x 1.3 m", "A320neo at 1:32 from the aircraft "
                                                                        "generator", dict(air_svg=model_plane_svg(px))),
        ]),
        ("Vending and service machines", "f_stone", [
            (fg.vending, 1.0, 0.86, "Snack vending", "1 x 0.85 m", "", dict(body="#3a414b", accent="#d4a23a")),
            (fg.vending, 1.0, 0.86, "Drink vending", "1 x 0.85 m", "", dict(body="#b3262e", accent="#f4f6f8",
                                                                           kind="drink")),
            (fg.vending, 1.0, 0.86, "Coffee vending", "1 x 0.85 m", "", dict(body="#4a3326", accent="#c9a27a",
                                                                            kind="coffee")),
            (fg.vending, 1.0, 0.86, "Fresh food vending", "1 x 0.85 m", "", dict(body="#2f6b4f", accent="#e9d27a",
                                                                                kind="fresh")),
            (fg.vending, 1.0, 0.86, "Travel essentials", "1 x 0.85 m", "", dict(body="#2f4a6e", accent="#5fa8d3",
                                                                               kind="travel")),
            (fg.water_filler, 0.5, 0.34, "Water bottle filler", "0.5 x 0.35 m, wall", "", {}),
            (fg.charge_tower, 0.62, 0.62, "Charging tower", "0.6 x 0.6 m", "", {}),
            (fg.atm_pair, 1.9, 0.82, "ATM pair", "1.9 x 0.8 m", "", {}),
        ]),
        ("Screens and signs", "f_stone", [
            (fg.fids_bank, 2.6, 0.32, "Flight board, 3 screens", "2.6 x 0.35 m on a stand", "", {}),
            (fg.fids_bank, 4.2, 0.32, "Flight board, 5 screens", "4.2 x 0.35 m on a stand", "", dict(n=5)),
            (fg.info_totem, 0.6, 0.36, "Info totem", "0.6 x 0.35 m", "", {}),
            (fg.wall_tv, 1.4, 0.1, "Wall TV", "1.4 m, wall", "", {}),
            (fg.gate_display, 1.2, 0.32, "Gate display", "1.2 x 0.3 m on a pole", "", {}),
            (fg.ad_totem, 0.8, 0.42, "Digital ad totem", "0.8 x 0.4 m", "", {}),
            (fg.led_wall, 6.0, 0.4, "LED video wall", "6 x 0.4 m", "", {}),
            (fg.ceiling_fids, 3.0, 0.3, "Ceiling flight board", "3 x 0.3 m, overhead", "", {}),
            (fg.overhead_sign, 3.0, 0.32, "Overhead wayfinding", "3 x 0.3 m, overhead", "", {}),
        ]),
        ("Other airport items", "f_terrazzo", [
            (lambda d: fg.trolley(d), 1.1, 0.6, "Luggage trolley", "1.1 x 0.6 m", "", {}),
            (fg.trolley_bay, 3.4, 1.0, "Trolley bay", "3.4 x 1 m, 5 trolleys", "", {}),
            (fg.info_desk, 3.0, 2.0, "Information desk", "3 x 2 m, 2 agents", "", {}),
            (fg.queue_kit, 3.9, 2.4, "Queue belts", "4 x 2.4 m serpentine", "", {}),
            (fg.rope_posts, 3.1, 0.4, "Rope posts", "3 x 0.4 m, premium", "", {}),
            (fg.wrap_station, 2.0, 2.0, "Bag wrap station", "2 x 2 m", "", {}),
            (fg.prayer_mats, 3.5, 2.0, "Prayer room set", "3.5 x 2 m", "Shoe rack and four mats", {}),
            (fg.wheelchair_park, 1.9, 0.9, "Wheelchair station", "1.9 x 0.9 m", "", {}),
            (fg.kids_play, 3.0, 3.0, "Kids play area", "3 x 3 m", "", {}),
            (fg.ashtray_stand, 1.6, 1.6, "Smoking point", "1.6 m hood overhead", "", {}),
            (fg.safety_wall, 1.42, 0.26, "Fire cabinet and AED", "1.4 x 0.3 m, wall", "", {}),
            (fg.help_point, 0.4, 0.4, "Help point", "0.4 m round", "", {}),
            (fg.column_round, 0.9, 0.9, "Round column", "0.9 m round", "", {}),
            (fg.column_round, 0.9, 0.9, "Ad column", "0.9 m round", "", dict(ad=True)),
        ]),
    ]
    wall_items = {"Water bottle filler", "Wall TV", "Fire cabinet and AED"}
    for gname, floor, items in groups:
        cards = []
        ah = max(int((fh + 0.9 + (0.22 if t in wall_items else 0)) * px) for _, fw, fh, t, *_ in items)
        ah = max(ah, 150)
        for fn, fw, fh, title, dims, note, kw in items:
            cards.append(gen_card(fn, fw, fh, title, dims, note, px, floor=floor, wall=title in wall_items, kw=kw,
                                  ah=ah))
        s, yend = flow(40, y + 52, W - 80, cards)
        body.append(section(20, y, W - 40, yend - y + 24, gname))
        body.append(s)
        y = yend + 50
    write("terminal_amenities_kit", W, int(y), "".join(body))


def sheet_building():
    W = 1880
    body = [header("Airline offices and building infrastructure",
                   "Real size in meters, tier 3. Office furniture at 60 px per meter, circulation at 44 px per "
                   "meter. Long circulation items are shown on their side, the upper floor or the flow end on the "
                   "right.")]
    y = 110
    office = [
        (fb.computer, 1.2, 0.5, "Computer, dual screen", "1.2 x 0.5 m, desk top", "", {}),
        (fb.computer, 1.2, 0.5, "Computer, single", "1.2 x 0.5 m, desk top", "", dict(dual=False)),
        (fb.work_desk_pc, 1.6, 1.4, "Work desk and chair", "1.6 x 1.4 m", "Desk, computer, task chair", {}),
        (fb.l_desk, 1.8, 1.6, "L desk", "1.8 x 1.6 m", "Corner computer, printer", {}),
        (fb.desk_pod, 3.2, 2.8, "Desk pod for 4", "3.2 x 2.8 m", "Back to back with an acoustic screen", {}),
        (fb.reception_desk, 3.0, 1.9, "Reception desk", "3 x 1.9 m, 2 staff", "Airline livery band", {}),
        (fg.sofa, 1.6, 0.92, "Office sofa", "1.6 x 0.9 m", "", dict(seats=2, col="#59616d")),
        (fb.office_sofa_l, 2.4, 2.4, "Corner sofa", "2.4 x 2.4 m", "Reception or crew room", {}),
        (fb.meeting_table, 2.8, 2.4, "Meeting table for 6", "2.8 x 2.4 m", "Conference phone, laptops", {}),
        (fb.round_table4, 2.0, 2.0, "Round table for 4", "2 x 2 m", "", {}),
        (fb.copier, 1.2, 0.7, "Copier", "1.2 x 0.7 m", "", {}),
        (fb.filing, 1.46, 0.62, "Filing cabinets", "1.5 x 0.6 m", "", {}),
        (fb.whiteboard, 1.8, 0.12, "Whiteboard", "1.8 m, wall", "", {}),
        (fb.pantry_counter, 2.4, 0.65, "Pantry counter", "2.4 x 0.65 m, wall", "Sink, coffee, microwave", {}),
        (fb.fridge, 0.72, 0.7, "Fridge", "0.7 x 0.7 m, 1.9 m tall", "", {}),
        (fb.water_cooler, 0.36, 0.36, "Water cooler", "0.36 m", "", {}),
        (fb.high_table, 1.6, 1.5, "Pantry high table", "1.6 x 1.5 m, 4 stools", "", {}),
        (fb.exec_desk, 2.0, 2.44, "Executive desk", "2 x 2.4 m", "Leather chair, 2 visitor chairs", {}),
        (fb.credenza, 2.0, 0.5, "Executive credenza", "2 x 0.5 m, wall", "Books, globe, plant", {}),
        (fb.model_stand, 0.6, 0.5, "Desk model aircraft", "0.6 x 0.5 m, desk top", "", {}),
    ]
    wall_items = {"Whiteboard", "Pantry counter", "Fridge", "Executive credenza"}
    px = 60
    cards = []
    ah = max(int((fh + 0.9 + (0.22 if t in wall_items else 0)) * px) for _, fw, fh, t, *_ in office)
    for fn, fw, fh, title, dims, note, kw in office:
        cards.append(gen_card(fn, fw, fh, title, dims, note, px, floor="f_office", wall=title in wall_items, kw=kw,
                              ah=ah))
    s, yend = flow(40, y + 52, W - 80, cards)
    body.append(section(20, y, W - 40, yend - y + 24, "Airline office furniture"))
    body.append(s)
    y = yend + 50

    px = 44
    jan_walls = (rect(-0.3, -0.3, 4.6, 0.3, C["wall"]) + rect(-0.3, 0, 0.3, 3.0, C["wall"])
                 + rect(4.0, 0, 0.3, 3.0, C["wall"]) + rect(-0.3, 3.0, 0.7, 0.3, C["wall"])
                 + rect(1.3, 3.0, 3.0, 0.3, C["wall"])
                 + path("M1.3,3.15 A0.9,0.9 0 0 1 0.4,4.05", "none", "#8f99a5", 0.04,
                        extra='stroke-dasharray="0.12 0.1"') + line(0.4, 3.15, 0.4, 4.05, C["wall"], 0.06))
    infra = [
        (fb.escalator, 13.2, 1.65, "Escalator", "13.2 x 1.65 m, rise 5 m", "Up shown, 1 m steps, comb plates",
         {}, 90, None),
        (fb.escalator_pair, 13.2, 3.6, "Escalator pair", "13.2 x 3.6 m", "Up and down with a center deck", {},
         90, None),
        (fb.stairs_straight, 10.4, 1.8, "Stairs, straight", "10.4 x 1.8 m, 30 risers", "Upper half dashed",
         {}, 90, None),
        (fb.travelator_pair, 16.0, 3.6, "Travelator pair", "16 m shown, any length", "Two directions", {}, 90,
         None),
        (fb.stairs_switchback, 3.9, 6.4, "Stairs, switchback", "3.9 x 6.4 m", "Half landing at the top", {}, 0,
         None),
        (fb.elevator, 2.6, 2.94, "Elevator", "2.6 x 2.8 m shaft", "13 people, doors at the bottom", {}, 0, None),
        (fb.elevator, 2.6, 2.94, "Glass elevator", "2.6 x 2.8 m shaft", "Panoramic shaft", dict(glass=True), 0,
         None),
        (fb.elevator_bank, 5.4, 2.94, "Elevator bank", "5.4 x 2.8 m, 2 cars", "", {}, 0, None),
        (fb.janitor_room, 4.0, 3.0, "Janitor room", "4 x 3 m inside", "Mop sink, shelves, scrubber, cart",
         {}, 0, jan_walls),
        (fb.supply_shelf, 1.2, 0.45, "Supply shelf", "1.2 x 0.45 m", "", {}, 0, None),
        (fb.floor_scrubber, 1.14, 0.82, "Floor scrubber", "1.1 x 0.8 m", "", {}, 0, None),
        (fb.mop_sink, 0.7, 0.7, "Mop sink", "0.7 x 0.7 m", "", {}, 0, None),
    ]
    cards = []
    for fn, fw, fh, title, dims, note, kw, rot, pre in infra:
        a_h = int((fh + 1.2 + (1.0 if pre else 0)) * px)
        cards.append(gen_card(fn, fw, fh, title, dims, note, px, floor="f_terrazzo", kw=kw, ah=max(a_h, 150),
                              rot=rot, pre=pre))
    s, yend = flow(40, y + 52, W - 80, cards)
    body.append(section(20, y, W - 40, yend - y + 24, "Building infrastructure"))
    body.append(s)
    y = yend + 50
    write("terminal_office_infra_kit", W, int(y), "".join(body))


if __name__ == "__main__":
    which = sys.argv[1:] or ["processing", "security", "furniture", "amenities", "building", "scene"]
    if "processing" in which:
        sheet_processing()
    if "security" in which:
        sheet_security()
    if "furniture" in which:
        sheet_furniture()
    if "amenities" in which:
        sheet_amenities()
    if "building" in which:
        sheet_building()
    if "scene" in which:
        import terminal_scene
        terminal_scene.build(write)
