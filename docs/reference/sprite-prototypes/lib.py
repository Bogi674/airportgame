"""Shared SVG helpers, aircraft shapes and fixture shapes for the sample render sheets.

All shape helpers work in meters. Callers wrap them in a group with a scale transform.
"""
import math
import random

FONT = "DejaVu Sans, Verdana, sans-serif"


def fmt(v):
    s = f"{v:.3f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def P(pts):
    return " ".join(f"{fmt(x)},{fmt(y)}" for x, y in pts)


def _a(fill=None, stroke=None, sw=None, op=None, extra=""):
    a = ""
    if fill is not None:
        a += f' fill="{fill}"'
    if stroke:
        a += f' stroke="{stroke}"'
        if sw is not None:
            a += f' stroke-width="{fmt(sw)}"'
    if op is not None:
        a += f' opacity="{op}"'
    if extra:
        a += " " + extra
    return a


def rect(x, y, w, h, fill="none", stroke=None, sw=0.1, rx=0, op=None, extra=""):
    r = f' rx="{fmt(rx)}"' if rx else ""
    return (f'<rect x="{fmt(x)}" y="{fmt(y)}" width="{fmt(w)}" height="{fmt(h)}"{r}'
            + _a(fill, stroke, sw, op, extra) + "/>")


def circle(cx, cy, r, fill="none", stroke=None, sw=0.1, op=None, extra=""):
    return (f'<circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(r)}"'
            + _a(fill, stroke, sw, op, extra) + "/>")


def ellipse(cx, cy, rx, ry, fill="none", stroke=None, sw=0.1, op=None, extra=""):
    return (f'<ellipse cx="{fmt(cx)}" cy="{fmt(cy)}" rx="{fmt(rx)}" ry="{fmt(ry)}"'
            + _a(fill, stroke, sw, op, extra) + "/>")


def line(x1, y1, x2, y2, stroke, sw=0.1, dash=None, cap=None, op=None):
    e = ""
    if dash:
        e += f'stroke-dasharray="{dash}"'
    if cap:
        e += f' stroke-linecap="{cap}"'
    return (f'<line x1="{fmt(x1)}" y1="{fmt(y1)}" x2="{fmt(x2)}" y2="{fmt(y2)}"'
            + _a(None, stroke, sw, op, e) + "/>")


def poly(pts, fill="none", stroke=None, sw=0.1, op=None, extra=""):
    return f'<polygon points="{P(pts)}"' + _a(fill, stroke, sw, op, extra) + "/>"


def path(d, fill="none", stroke=None, sw=0.1, op=None, extra=""):
    return f'<path d="{d}"' + _a(fill, stroke, sw, op, extra) + "/>"


def text(x, y, s, size, fill="#fff", weight="normal", anchor="start", extra=""):
    return (f'<text x="{fmt(x)}" y="{fmt(y)}" font-family="{FONT}" font-size="{fmt(size)}" '
            f'font-weight="{weight}" text-anchor="{anchor}" fill="{fill}" {extra}>{esc(s)}</text>')


def g(content, transform=None, extra=""):
    t = f' transform="{transform}"' if transform else ""
    body = "".join(content) if isinstance(content, (list, tuple)) else content
    return f"<g{t} {extra}>{body}</g>"


def svg_doc(w, h, body, defs=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f"<defs>{defs}</defs>{body}</svg>")


def label_chip(x, y, s, size=11, fill="#1d2b45", fg="#ffffff", padx=8, h=None, weight="bold"):
    """Pixel space chip with the text drawn inside its own rounded rectangle."""
    w = len(s) * size * 0.62 + padx * 2
    hh = h or size + 10
    return (rect(x, y, w, hh, fill, rx=hh / 2)
            + text(x + w / 2, y + hh / 2 + size * 0.35, s, size, fg, weight, "middle")), w


# ----------------------------------------------------------------------------
# Aircraft
# ----------------------------------------------------------------------------

AIRCRAFT = {
    "c208": dict(
        name="Cessna 208B Grand Caravan", code="B", L=12.7, span=15.9, w=1.6, nose=2.2, tail=5.0,
        wing=(-1.8, 1.7, 1.2, 0.2), stab=(4.4, 1.3, 0.9, 2.7, 0.3), engines=[], eng_size=(0, 0),
        nose_prop=1.25, fin=3.0,
        pal=dict(body="#f7f9fb", wing="#e3e8ee", engine="#bcc5d1", accent="#2f6fdd")),
    "atr72": dict(
        name="ATR 72-600", code="C", L=27.2, span=27.05, w=2.8, nose=3.0, tail=9.0,
        wing=(-1.2, 2.7, 1.7, 0.7), stab=(8.2, 2.3, 1.3, 3.7, 1.0), engines=[4.9], eng_size=(5.8, 1.25),
        prop=1.95, fin=5.0,
        pal=dict(body="#f7f9fb", wing="#e3e8ee", engine="#bcc5d1", accent="#1f9d9a")),
    "a320neo": dict(
        name="Airbus A320neo", code="C", L=37.6, span=35.8, w=4.0, nose=5.0, tail=14.0,
        wing=(-3.6, 7.0, 1.7, 8.6), stab=(9.6, 4.3, 1.4, 6.2, 4.0), engines=[5.8], eng_size=(4.7, 2.45),
        fin=7.0,
        pal=dict(body="#f7f9fb", wing="#dde3ea", engine="#bcc5d1", accent="#f08a24")),
    "b787": dict(
        name="Boeing 787-9", code="E", L=62.8, span=60.1, w=5.9, nose=7.0, tail=19.0,
        wing=(-3.5, 11.5, 2.4, 17.5), stab=(18.6, 6.6, 1.8, 10.2, 6.5), engines=[10.6], eng_size=(6.8, 3.6),
        fin=9.0,
        pal=dict(body="#f7f9fb", wing="#dde3ea", engine="#bcc5d1", accent="#7a4fd0")),
    "b777": dict(
        name="Boeing 777-300ER", code="E", L=73.9, span=64.8, w=6.2, nose=7.5, tail=21.0,
        wing=(-6.0, 14.0, 3.0, 20.0), stab=(22.6, 7.6, 2.0, 10.8, 7.0), engines=[11.4], eng_size=(7.6, 4.2),
        fin=10.0,
        pal=dict(body="#f7f9fb", wing="#dde3ea", engine="#bcc5d1", accent="#d9463e")),
    "a380": dict(
        name="Airbus A380-800", code="F", L=72.7, span=79.8, w=7.4, nose=8.0, tail=22.0,
        wing=(-4.5, 17.0, 3.4, 22.5), stab=(23.0, 8.5, 2.5, 15.2, 8.0), engines=[12.5, 26.5], eng_size=(8.0, 4.0),
        fin=10.0,
        pal=dict(body="#f7f9fb", wing="#dde3ea", engine="#bcc5d1", accent="#3fa34d")),
}


def _fuselage_path(L, w, nose, tail):
    h = w / 2
    tw = w * 0.1
    return (f"M0,{fmt(-L/2)} "
            f"C{fmt(h*0.55)},{fmt(-L/2)} {fmt(h)},{fmt(-L/2+nose*0.45)} {fmt(h)},{fmt(-L/2+nose)} "
            f"L{fmt(h)},{fmt(L/2-tail)} "
            f"Q{fmt(h*0.9)},{fmt(L/2-tail*0.35)} {fmt(tw)},{fmt(L/2)} "
            f"L{fmt(-tw)},{fmt(L/2)} "
            f"Q{fmt(-h*0.9)},{fmt(L/2-tail*0.35)} {fmt(-h)},{fmt(L/2-tail)} "
            f"L{fmt(-h)},{fmt(-L/2+nose)} "
            f"C{fmt(-h)},{fmt(-L/2+nose*0.45)} {fmt(-h*0.55)},{fmt(-L/2)} 0,{fmt(-L/2)} Z")


def aircraft(spec, mode="detail", sw=0.22):
    """Return SVG elements in meters, centered on the fuselage midpoint, nose pointing up.

    mode: detail, medium, far or shadow.
    """
    L, S, w = spec["L"], spec["span"], spec["w"]
    h = w / 2
    s = S / 2
    shadow = mode == "shadow"
    far = mode == "far"
    pal = spec["pal"]

    def col(k):
        if shadow:
            return "#000000"
        if far:
            return "#eef2f6"
        return pal[k]

    stroke = None if (shadow or far) else "#7b8798"
    out = []
    ex = 'stroke-linejoin="round"'

    wy, cr, ct, d = spec["wing"]
    for sg in (-1, 1):
        out.append(poly([(sg * h * 0.8, wy), (sg * s, wy + d), (sg * s, wy + d + ct), (sg * h * 0.8, wy + cr)],
                        col("wing"), stroke, sw, extra=ex))
    sy, scr, sct, ss, ssw = spec["stab"]
    for sg in (-1, 1):
        out.append(poly([(sg * h * 0.5, sy), (sg * ss, sy + ssw), (sg * ss, sy + ssw + sct), (sg * h * 0.5, sy + scr)],
                        col("wing"), stroke, sw, extra=ex))

    el, ew = spec["eng_size"]
    for exx in spec["engines"]:
        yle = wy + d * (exx - h * 0.8) / (s - h * 0.8)
        for sg in (-1, 1):
            x = sg * exx
            top = yle - el * 0.55
            out.append(rect(x - ew / 2, top, ew, el, col("engine"), stroke, sw, rx=ew * 0.42, extra=ex))
            if mode == "detail":
                if spec.get("prop"):
                    pr = spec["prop"]
                    out.append(ellipse(x, top - 0.1, pr, 0.24, "#1d2430", None, op=0.35))
                    out.append(line(x - pr, top - 0.1, x + pr, top - 0.1, "#1d2430", 0.12, op=0.6))
                else:
                    out.append(ellipse(x, top + ew * 0.12, ew * 0.36, ew * 0.14, "#59616d"))
                    out.append(rect(x - ew * 0.42, top + el * 0.35, ew * 0.84, ew * 0.16, pal["accent"], None, op=0.9))

    out.append(path(_fuselage_path(L, w, spec["nose"], spec["tail"]), col("body"), stroke, sw, extra=ex))

    if mode == "detail":
        n = spec["nose"]
        y0 = -L / 2 + n * 0.62
        out.append(poly([(-h * 0.55, y0), (h * 0.55, y0), (h * 0.4, y0 + n * 0.22), (-h * 0.4, y0 + n * 0.22)],
                        "#2b3442"))
        fl = spec["fin"]
        out.append(rect(-0.22, L / 2 - fl - 0.8, 0.44, fl, pal["accent"], None))
        if spec.get("nose_prop"):
            pr = spec["nose_prop"]
            out.append(ellipse(0, -L / 2 - 0.15, pr, 0.2, "#1d2430", None, op=0.35))
            out.append(line(-pr, -L / 2 - 0.15, pr, -L / 2 - 0.15, "#1d2430", 0.1, op=0.6))
        # window band hint along the fuselage
        if w > 2.5:
            for sg in (-1, 1):
                out.append(line(sg * h * 0.72, -L / 2 + n * 1.2, sg * h * 0.72, L / 2 - spec["tail"] * 1.05,
                                "#9fb1c6", max(0.12, w * 0.025), dash="0.5 0.45", op=0.9))
    return "".join(out)


def aircraft_with_shadow(spec, mode="detail", sw=0.22, shadow_off=(1.8, 2.4)):
    sh = g(aircraft(spec, "shadow", sw), f"translate({fmt(shadow_off[0])} {fmt(shadow_off[1])})", 'opacity="0.2"')
    return sh + aircraft(spec, mode, sw)


# ----------------------------------------------------------------------------
# People
# ----------------------------------------------------------------------------

PROFILE_COLORS = {
    "business": "#2f6fdd",
    "leisure": "#f08a24",
    "family": "#3fa34d",
    "budget": "#8a5fd6",
    "premium": "#d9a21b",
}


def person(x, y, color, bag=False, r=0.38):
    out = [circle(x + 0.08, y + 0.1, r, "#000", None, op=0.22),
           circle(x, y, r, color, "#ffffff", 0.07)]
    if bag:
        out.append(rect(x + r * 0.9, y - 0.12, 0.34, 0.55, "#3a3f4b", None, rx=0.06))
    return "".join(out)


def crowd(points, rng, weights=None):
    names = list(PROFILE_COLORS.keys())
    weights = weights or [3, 4, 2, 2, 1]
    out = []
    for (x, y) in points:
        c = PROFILE_COLORS[rng.choices(names, weights)[0]]
        out.append(person(x, y, c, bag=rng.random() < 0.45))
    return "".join(out)


# ----------------------------------------------------------------------------
# Fixtures. Each returns SVG in meters with the top left corner at (x, y).
# ----------------------------------------------------------------------------

def checkin_desk(x, y):
    """Counter 1.0 deep by 1.5 wide, with monitor, agent chair and a belt behind. Faces west."""
    return "".join([
        rect(x, y, 1.0, 1.5, "#f4f1ea", "#9a9486", 0.07, rx=0.1),
        rect(x + 0.15, y + 0.45, 0.35, 0.6, "#2b3442", None, rx=0.05),
        rect(x + 0.2, y + 0.5, 0.25, 0.5, "#5fa8d3", None, rx=0.04),
        circle(x + 1.45, y + 0.75, 0.3, "#2c4a7c", "#ffffff", 0.06),
        rect(x + 1.75, y + 0.05, 0.85, 1.4, "#3c4451", "#2b3340", 0.06, rx=0.08),
        line(x + 1.95, y + 0.3, x + 1.95, y + 1.2, "#8e9aab", 0.07),
        line(x + 2.2, y + 0.3, x + 2.2, y + 1.2, "#8e9aab", 0.07),
        line(x + 2.45, y + 0.3, x + 2.45, y + 1.2, "#8e9aab", 0.07),
    ])


def kiosk(x, y):
    return "".join([
        rect(x, y, 0.9, 0.9, "#2b3442", "#1d2430", 0.06, rx=0.12),
        rect(x + 0.08, y + 0.12, 0.28, 0.66, "#5fa8d3", None, rx=0.05),
        rect(x + 0.45, y + 0.15, 0.3, 0.2, "#e9eef4", None, rx=0.03),
        rect(x + 0.45, y + 0.5, 0.3, 0.2, "#f2c14e", None, rx=0.03),
    ])


def bag_drop(x, y):
    return "".join([
        rect(x, y, 3.0, 1.5, "#e9edf2", "#9aa4b2", 0.07, rx=0.12),
        rect(x + 0.3, y + 0.2, 1.7, 1.1, "#3c4451", "#2b3340", 0.05, rx=0.08),
        line(x + 0.6, y + 0.35, x + 0.6, y + 1.15, "#8e9aab", 0.07),
        line(x + 0.95, y + 0.35, x + 0.95, y + 1.15, "#8e9aab", 0.07),
        line(x + 1.3, y + 0.35, x + 1.3, y + 1.15, "#8e9aab", 0.07),
        line(x + 1.65, y + 0.35, x + 1.65, y + 1.15, "#8e9aab", 0.07),
        rect(x + 2.2, y + 0.25, 0.6, 0.45, "#2b3442", None, rx=0.05),
        rect(x + 2.28, y + 0.31, 0.44, 0.3, "#5fa8d3", None, rx=0.04),
    ])


def passport_booth(x, y):
    return "".join([
        rect(x, y, 1.5, 1.5, "#dfe5ec", "#8e99a8", 0.07, rx=0.12),
        rect(x + 0.15, y + 0.15, 1.2, 0.5, "#2b3442", None, rx=0.06),
        rect(x + 0.25, y + 0.22, 0.45, 0.36, "#5fa8d3", None, rx=0.04),
        circle(x + 0.75, y + 1.05, 0.28, "#1f6f7a", "#ffffff", 0.06),
    ])


def gate_desk(x, y, w=3.0, d=1.2):
    return "".join([
        rect(x, y, w, d, "#f4f1ea", "#9a9486", 0.07, rx=0.12),
        rect(x + 0.2, y + 0.2, 0.5, 0.5, "#2b3442", None, rx=0.06),
        rect(x + 0.27, y + 0.27, 0.36, 0.36, "#5fa8d3", None, rx=0.04),
        rect(x + w - 0.8, y + 0.2, 0.55, 0.5, "#2b3442", None, rx=0.06),
        rect(x + w - 0.72, y + 0.27, 0.4, 0.2, "#6fd17f", None, rx=0.04),
    ])


def bench(x, y, seats=3, vertical=False):
    sw_ = 0.62
    out = []
    n = seats
    if vertical:
        out.append(rect(x, y, 0.6, n * sw_, "#4b5565", "#2b3340", 0.05, rx=0.1))
        for i in range(n):
            out.append(rect(x + 0.08, y + i * sw_ + 0.06, 0.44, sw_ - 0.12, "#6f7f95", None, rx=0.08))
    else:
        out.append(rect(x, y, n * sw_, 0.6, "#4b5565", "#2b3340", 0.05, rx=0.1))
        for i in range(n):
            out.append(rect(x + i * sw_ + 0.06, y + 0.08, sw_ - 0.12, 0.44, "#6f7f95", None, rx=0.08))
    return "".join(out)


def round_table(x, y, r=0.7, chairs=4, top="#d9c3a3", chair="#6b4f3a"):
    """Table centered on (x, y)."""
    out = []
    for i in range(chairs):
        a = i * 2 * math.pi / chairs + math.pi / 4
        cx, cy = x + math.cos(a) * (r + 0.42), y + math.sin(a) * (r + 0.42)
        out.append(circle(cx, cy, 0.26, chair, "#3d2b1e", 0.05))
    out.append(circle(x + 0.06, y + 0.08, r, "#000", None, op=0.18))
    out.append(circle(x, y, r, top, "#8a6c4a", 0.07))
    return "".join(out)


def plant(x, y, r=0.8):
    """Planter centered on (x, y)."""
    out = [circle(x, y, r, "#6e6a62", "#4f4b45", 0.06)]
    leaves = [(0, -0.45, 0.42), (0.42, 0.18, 0.4), (-0.4, 0.2, 0.4), (0.05, 0.0, 0.34)]
    greens = ["#4e9a52", "#5fb062", "#3f8a47", "#6ec06f"]
    for (dx, dy, lr), c in zip(leaves, greens):
        out.append(circle(x + dx * r / 0.8, y + dy * r / 0.8, lr * r / 0.8, c, None))
    return "".join(out)


def trash_bin(x, y):
    return circle(x, y, 0.32, "#59616d", "#2b3340", 0.06) + circle(x, y, 0.18, "#2b3340")


def column(x, y, s=1.2):
    return rect(x - s / 2 + 0.08, y - s / 2 + 0.1, s, s, "#000", None, op=0.18) + \
        rect(x - s / 2, y - s / 2, s, s, "#c3cad3", "#8e99a8", 0.08)


def trolley(x, y):
    return "".join([
        rect(x, y, 1.1, 0.6, "#c9d0d9", "#7f8a99", 0.05, rx=0.06),
        line(x + 0.1, y + 0.15, x + 1.0, y + 0.15, "#7f8a99", 0.04),
        line(x + 0.1, y + 0.3, x + 1.0, y + 0.3, "#7f8a99", 0.04),
        line(x + 0.1, y + 0.45, x + 1.0, y + 0.45, "#7f8a99", 0.04),
        line(x - 0.2, y + 0.05, x, y + 0.05, "#7f8a99", 0.06),
        line(x - 0.2, y + 0.55, x, y + 0.55, "#7f8a99", 0.06),
    ])


def stanchion_line(x1, y1, x2, y2, post_gap=1.4, ribbon="#c24545"):
    n = max(1, int(math.hypot(x2 - x1, y2 - y1) / post_gap))
    out = [line(x1, y1, x2, y2, ribbon, 0.07, op=0.9)]
    for i in range(n + 1):
        t = i / n
        out.append(circle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 0.13, "#2b3340", "#e9eef4", 0.04))
    return "".join(out)


def shelf(x, y, w, h, rng, vertical=False, base="#c9d0d9"):
    out = [rect(x, y, w, h, base, "#8e99a8", 0.05, rx=0.04)]
    colors = ["#e0605a", "#f2c14e", "#5fb0d9", "#7bc47f", "#b07ad6", "#f08a24"]
    if vertical:
        n = max(1, int(h / 0.55))
        for i in range(n):
            out.append(rect(x + 0.1, y + 0.08 + i * (h - 0.1) / n, w - 0.2, (h - 0.1) / n - 0.1,
                            rng.choice(colors), None, op=0.85, rx=0.03))
    else:
        n = max(1, int(w / 0.55))
        for i in range(n):
            out.append(rect(x + 0.08 + i * (w - 0.1) / n, y + 0.1, (w - 0.1) / n - 0.1, h - 0.2,
                            rng.choice(colors), None, op=0.85, rx=0.03))
    return "".join(out)


def clothing_rack(x, y, w=2.2):
    out = [rect(x, y, w, 0.5, "#9aa4b2", "#5d6776", 0.04, rx=0.1)]
    cols = ["#d9463e", "#2f6fdd", "#f2c14e", "#3fa34d", "#7a4fd0", "#e8edf3"]
    n = int(w / 0.28)
    for i in range(n):
        out.append(rect(x + 0.08 + i * (w - 0.16) / n, y + 0.08, (w - 0.16) / n - 0.05, 0.34, cols[i % len(cols)], None, rx=0.04))
    return "".join(out)


def counter(x, y, w, d, fill="#f4f1ea"):
    return "".join([
        rect(x, y, w, d, fill, "#9a9486", 0.06, rx=0.1),
        rect(x + w * 0.15, y + d * 0.2, 0.45, 0.35, "#2b3442", None, rx=0.04),
        rect(x + w * 0.15 + 0.06, y + d * 0.2 + 0.05, 0.33, 0.22, "#5fa8d3", None, rx=0.03),
    ])


def toilet_stall(x, y, w=1.0, d=1.6):
    return "".join([
        rect(x, y, w, d, "#eef3f7", "#8e99a8", 0.05),
        rect(x + w * 0.25, y + 0.12, w * 0.5, 0.45, "#ffffff", "#8e99a8", 0.05, rx=0.15),
        ellipse(x + w / 2, y + 0.95, 0.24, 0.32, "#ffffff", "#8e99a8", 0.05),
        line(x, y + d, x + w * 0.78, y + d, "#2c3441", 0.06),
    ])


def sink(x, y):
    return rect(x, y, 0.6, 0.45, "#ffffff", "#8e99a8", 0.05, rx=0.15) + circle(x + 0.3, y + 0.22, 0.1, "#9fb1c6")


def escalator(x, y, w=1.2, h=8.0, up=True):
    out = [rect(x, y, w, h, "#59616d", "#2b3340", 0.06, rx=0.08)]
    n = int(h / 0.5)
    for i in range(n):
        yy = y + 0.25 + i * (h - 0.4) / n
        out.append(line(x + 0.1, yy, x + w - 0.1, yy, "#8e9aab", 0.05))
    ay = y + h / 2
    d = -1 if up else 1
    out.append(poly([(x + w / 2, ay + d * 0.9), (x + w / 2 - 0.35, ay), (x + w / 2 + 0.35, ay)], "#f2c14e"))
    return "".join(out)


def elevator(x, y):
    return "".join([
        rect(x, y, 2.0, 2.0, "#dfe5ec", "#59616d", 0.08),
        rect(x + 0.15, y + 0.15, 1.7, 1.7, "#b9c3cf", None),
        line(x + 1.0, y + 0.15, x + 1.0, y + 1.85, "#59616d", 0.06),
        poly([(x + 1.0, y + 0.55), (x + 0.75, y + 0.9), (x + 1.25, y + 0.9)], "#2b3442"),
    ])


def info_screen(x, y, w=2.4):
    return rect(x, y, w, 0.35, "#1d2430", "#59616d", 0.05, rx=0.06) + \
        line(x + 0.2, y + 0.12, x + w - 0.2, y + 0.12, "#6fd17f", 0.06) + \
        line(x + 0.2, y + 0.24, x + w - 0.6, y + 0.24, "#f2c14e", 0.06)


def carousel_segment(x, y, w=6.0, d=2.0):
    """Straight section of a baggage reclaim belt."""
    out = [rect(x, y, w, d, "#4a525e", "#2b3340", 0.08, rx=d / 2),
           rect(x + 0.3, y + 0.3, w - 0.6, d - 0.6, "#323a45", None, rx=(d - 0.6) / 2)]
    for i in range(int(w / 0.6)):
        out.append(line(x + 0.5 + i * 0.6, y + 0.4, x + 0.5 + i * 0.6, y + d - 0.4, "#6b7788", 0.06, op=0.7))
    out.append(rect(x + 1.2, y + 0.55, 0.9, 0.9, "#2f6fdd", "#ffffff", 0.05, rx=0.1))
    out.append(rect(x + 3.6, y + 0.65, 0.8, 0.7, "#d9463e", "#ffffff", 0.05, rx=0.1))
    return "".join(out)


def moving_walkway(x, y, w, d=1.6, dir_=1):
    out = [rect(x, y, w, d, "#4a525e", None),
           line(x, y, x + w, y, "#f2c14e", 0.12), line(x, y + d, x + w, y + d, "#f2c14e", 0.12)]
    n = int(w / 2.0)
    for i in range(n):
        cx = x + 1.0 + i * 2.0
        if dir_ > 0:
            out.append(path(f"M{fmt(cx-0.35)},{fmt(y+0.3)} L{fmt(cx+0.2)},{fmt(y+d/2)} L{fmt(cx-0.35)},{fmt(y+d-0.3)}",
                            "none", "#9aa5b5", 0.16, extra='stroke-linecap="round" stroke-linejoin="round"'))
        else:
            out.append(path(f"M{fmt(cx+0.35)},{fmt(y+0.3)} L{fmt(cx-0.2)},{fmt(y+d/2)} L{fmt(cx+0.35)},{fmt(y+d-0.3)}",
                            "none", "#9aa5b5", 0.16, extra='stroke-linecap="round" stroke-linejoin="round"'))
    return "".join(out)


# ----------------------------------------------------------------------------
# Floor patterns (SVG defs). Pattern units are meters, so they scale with the scene group.
# ----------------------------------------------------------------------------

def floor_defs():
    return "".join([
        '<pattern id="f_terrazzo" width="4" height="4" patternUnits="userSpaceOnUse">'
        '<rect width="4" height="4" fill="#e4e8ed"/><rect width="2" height="2" fill="#dde2e8"/>'
        '<rect x="2" y="2" width="2" height="2" fill="#dde2e8"/>'
        '<path d="M0,0H4M0,2H4M0,4H4M0,0V4M2,0V4M4,0V4" stroke="#cdd3db" stroke-width="0.06" fill="none"/></pattern>',

        '<pattern id="f_stone" width="4" height="4" patternUnits="userSpaceOnUse">'
        '<rect width="4" height="4" fill="#d6dbe1"/><rect x="0.06" y="0.06" width="1.88" height="1.88" fill="#dbe0e6"/>'
        '<rect x="2.06" y="2.06" width="1.88" height="1.88" fill="#dbe0e6"/>'
        '<path d="M0,0H4M0,2H4M0,4H4M0,0V4M2,0V4M4,0V4" stroke="#c4cbd4" stroke-width="0.06" fill="none"/></pattern>',

        '<pattern id="f_secure" width="2" height="2" patternUnits="userSpaceOnUse">'
        '<rect width="2" height="2" fill="#b9c0ca"/><path d="M0,0H2M0,0V2" stroke="#a6aeb9" stroke-width="0.05"/>'
        '<circle cx="1" cy="1" r="0.07" fill="#a6aeb9"/></pattern>',

        '<pattern id="f_carpet" width="1.2" height="1.2" patternUnits="userSpaceOnUse">'
        '<rect width="1.2" height="1.2" fill="#35557f"/>'
        '<path d="M0.6,0.15 L1.05,0.6 L0.6,1.05 L0.15,0.6 Z" fill="#41669a"/></pattern>',

        '<pattern id="f_wood" width="3" height="0.9" patternUnits="userSpaceOnUse">'
        '<rect width="3" height="0.9" fill="#c7a074"/><path d="M0,0.45H3" stroke="#b78c5f" stroke-width="0.04"/>'
        '<path d="M1.5,0V0.45M0.6,0.45V0.9" stroke="#b78c5f" stroke-width="0.04"/>'
        '<path d="M0,0H3" stroke="#a97f53" stroke-width="0.05"/></pattern>',

        '<pattern id="f_marble" width="3" height="3" patternUnits="userSpaceOnUse">'
        '<rect width="3" height="3" fill="#ece6d6"/><path d="M0,0H3M0,0V3" stroke="#d3cab4" stroke-width="0.05"/>'
        '<path d="M0.3,2.4 C1,1.6 1.6,2.0 2.6,0.8" stroke="#d9d0bb" stroke-width="0.06" fill="none"/></pattern>',

        '<pattern id="f_dark" width="2" height="2" patternUnits="userSpaceOnUse">'
        '<rect width="2" height="2" fill="#343b48"/><path d="M0,0H2M0,0V2" stroke="#2a303b" stroke-width="0.05"/></pattern>',

        '<pattern id="f_clinic" width="1.5" height="1.5" patternUnits="userSpaceOnUse">'
        '<rect width="1.5" height="1.5" fill="#e6f0ee"/><path d="M0,0H1.5M0,0V1.5" stroke="#cddedb" stroke-width="0.05"/></pattern>',

        '<pattern id="f_tile_wc" width="1" height="1" patternUnits="userSpaceOnUse">'
        '<rect width="1" height="1" fill="#dcebf2"/><path d="M0,0H1M0,0V1" stroke="#c3d8e3" stroke-width="0.04"/></pattern>',

        '<pattern id="f_office" width="1" height="1" patternUnits="userSpaceOnUse">'
        '<rect width="1" height="1" fill="#c9cdd3"/><path d="M0,0H1M0,0V1" stroke="#bbc0c7" stroke-width="0.04"/></pattern>',

        '<pattern id="f_apron" width="20" height="20" patternUnits="userSpaceOnUse">'
        '<rect width="20" height="20" fill="#959ea9"/><path d="M0,0H20M0,0V20" stroke="#868f9b" stroke-width="0.3"/></pattern>',

        '<pattern id="f_asphalt" width="6" height="6" patternUnits="userSpaceOnUse">'
        '<rect width="6" height="6" fill="#4b525d"/><circle cx="1.5" cy="2" r="0.18" fill="#555d69"/>'
        '<circle cx="4.5" cy="4.2" r="0.18" fill="#434a54"/><circle cx="3.4" cy="0.8" r="0.14" fill="#555d69"/></pattern>',

        '<pattern id="f_grass" width="8" height="8" patternUnits="userSpaceOnUse">'
        '<rect width="8" height="8" fill="#6f9c5e"/><path d="M1,2 l0.4,-0.8 l0.4,0.8 M5,6 l0.4,-0.8 l0.4,0.8 M6,1.5 l0.4,-0.8 l0.4,0.8" '
        'stroke="#5f8c50" stroke-width="0.12" fill="none"/></pattern>',
    ])


WALL = "#2c3441"
GLASS = "#bfe3f5"
GLASS_EDGE = "#5fa8d3"


def wall_rect(x, y, w, h):
    return rect(x, y, w, h, WALL, None)


def vwall(x, y0, y1, gaps=(), t=0.6):
    """Vertical wall centered on x between y0 and y1, skipping gaps."""
    out = []
    cur = y0
    for (a, b) in sorted(gaps):
        if a > cur:
            out.append(wall_rect(x - t / 2, cur, t, a - cur))
        cur = max(cur, b)
    if cur < y1:
        out.append(wall_rect(x - t / 2, cur, t, y1 - cur))
    return "".join(out)


def hwall(y, x0, x1, gaps=(), t=0.6):
    out = []
    cur = x0
    for (a, b) in sorted(gaps):
        if a > cur:
            out.append(wall_rect(cur, y - t / 2, a - cur, t))
        cur = max(cur, b)
    if cur < x1:
        out.append(wall_rect(cur, y - t / 2, x1 - cur, t))
    return "".join(out)


def glass_h(y, x0, x1, t=0.4):
    return rect(x0, y - t / 2, x1 - x0, t, GLASS, GLASS_EDGE, 0.05) + \
        line(x0, y, x1, y, "#ffffff", 0.05, op=0.8)


def glass_v(x, y0, y1, t=0.4):
    return rect(x - t / 2, y0, t, y1 - y0, GLASS, GLASS_EDGE, 0.05) + \
        line(x, y0, x, y1, "#ffffff", 0.05, op=0.8)


def door_swing(hx, hy, r, quadrant):
    """Hinged door symbol. Hinge at (hx, hy). quadrant: 'se','sw','ne','nw' gives the swing direction."""
    sx = 1 if quadrant[1] == "e" else -1
    sy = 1 if quadrant[0] == "s" else -1
    leaf = line(hx, hy, hx + sx * r, hy, "#2c3441", 0.1)
    arc = path(f"M{fmt(hx+sx*r)},{fmt(hy)} A{fmt(r)},{fmt(r)} 0 0 {1 if sx*sy>0 else 0} {fmt(hx)},{fmt(hy+sy*r)}",
               "none", "#8e99a8", 0.06, extra='stroke-dasharray="0.25 0.2"')
    return leaf + arc


def door_swing_v(hx, hy, r, quadrant):
    """Hinged door that opens from a vertical wall. Leaf starts along the wall direction."""
    sx = 1 if quadrant[1] == "e" else -1
    sy = 1 if quadrant[0] == "s" else -1
    leaf = line(hx, hy, hx, hy + sy * r, "#2c3441", 0.1)
    arc = path(f"M{fmt(hx)},{fmt(hy+sy*r)} A{fmt(r)},{fmt(r)} 0 0 {1 if sx*sy<0 else 0} {fmt(hx+sx*r)},{fmt(hy)}",
               "none", "#8e99a8", 0.06, extra='stroke-dasharray="0.25 0.2"')
    return leaf + arc


def seeded(seed):
    return random.Random(seed)
