"""Top down people in the flat 'walking figure' style. Meters, facing up (negative y).

A figure is assembled from layers so the game can tint and recombine them into an atlas:
shadow, shoes, carried items behind, torso, torso overlay (vest, apron), back items, arms, head, hair or headwear,
items in hand. Every layer is a small shape, so the whole figure bakes into a 32 to 96 px sprite.
"""
import math
from lib import fmt, rect, circle, ellipse, line, poly, path, g

SKIN = ["#f6d7c3", "#eec1a1", "#e0ac84", "#c68a5e", "#a86d43", "#8a5433", "#6b3f25", "#4e2c1a"]
HAIR = {"black": "#1d1714", "dark": "#3b2618", "brown": "#6a4227", "auburn": "#8c3b1d", "blonde": "#d9b65a",
        "grey": "#9b9b9b", "white": "#e4e4e4", "red": "#b5532a"}
OUT = "#00000026"


def darker(hexc, f=0.78):
    h = hexc.lstrip("#")
    r, g_, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return "#%02x%02x%02x" % (int(r * f), int(g_ * f), int(b * f))


def capsule(x1, y1, x2, y2, w, fill):
    return line(x1, y1, x2, y2, fill, w, cap="round")


def hair_shape(style, col, skin, acc=None):
    o = []
    dk = darker(col)
    if style == "short":
        o.append(circle(0, 0.012, 0.098, col))
        o.append(ellipse(0, -0.05, 0.07, 0.035, col))
    elif style == "side_part":
        o.append(circle(0, 0.01, 0.1, col))
        o.append(line(-0.03, -0.09, -0.02, 0.08, dk, 0.012))
    elif style == "spiky":
        pts = []
        for i in range(18):
            a = i / 18 * 2 * math.pi
            r = 0.115 if i % 2 == 0 else 0.085
            pts.append((r * math.cos(a), r * math.sin(a) + 0.01))
        o.append(poly(pts, col))
    elif style == "long":
        o.append(ellipse(0, 0.07, 0.11, 0.155, col))
        o.append(circle(0, 0.0, 0.104, col))
        o.append(line(0, -0.09, 0, 0.05, dk, 0.012))
    elif style == "ponytail":
        o.append(circle(0, 0.008, 0.1, col))
        o.append(ellipse(0, 0.15, 0.04, 0.075, col))
        o.append(circle(0, 0.09, 0.018, dk))
    elif style == "bun":
        o.append(circle(0, 0.008, 0.1, col))
        o.append(circle(0, 0.085, 0.045, dk))
    elif style == "curly":
        for i in range(12):
            a = i / 12 * 2 * math.pi
            o.append(circle(0.085 * math.cos(a), 0.085 * math.sin(a) + 0.01, 0.042, col))
        o.append(circle(0, 0.01, 0.09, col))
    elif style == "afro":
        for i in range(14):
            a = i / 14 * 2 * math.pi
            o.append(circle(0.11 * math.cos(a), 0.11 * math.sin(a) + 0.01, 0.045, col))
        o.append(circle(0, 0.01, 0.12, col))
    elif style == "buzz":
        o.append(circle(0, 0.01, 0.098, col, op=0.75))
    elif style == "balding":
        o.append(path("M-0.098,0.0 A0.1,0.1 0 0 0 0.098,0.0 L0.07,0.02 A0.07,0.07 0 0 1 -0.07,0.02Z", col))
        o.append(circle(-0.02, -0.03, 0.025, "#ffffff", op=0.25))
    elif style == "bald":
        o.append(circle(-0.025, -0.03, 0.03, "#ffffff", op=0.3))
    elif style == "braids":
        o.append(circle(0, 0.01, 0.1, col))
        for i in range(-2, 3):
            o.append(line(i * 0.035, -0.07, i * 0.035, 0.09, dk, 0.012))
        o.append(capsule(-0.03, 0.09, -0.04, 0.2, 0.03, col))
        o.append(capsule(0.03, 0.09, 0.04, 0.2, 0.03, col))
    elif style == "hijab":
        o.append(ellipse(0, 0.05, 0.155, 0.135, col))
        o.append(circle(0, 0.0, 0.122, col))
        o.append(path("M-0.09,-0.08 Q0,-0.135 0.09,-0.08", "none", dk, 0.014))
        o.append(line(0, -0.1, 0, 0.11, dk, 0.01, op=0.5))
    elif style == "cap":
        o.append(circle(0, 0.01, 0.104, col))
        o.append(ellipse(0, -0.105, 0.078, 0.05, dk))
        o.append(circle(0, 0.0, 0.014, dk))
    elif style == "sunhat":
        o.append(circle(0, 0.0, 0.18, col))
        o.append(circle(0, 0.0, 0.18, "none", dk, 0.01))
        o.append(circle(0, 0.0, 0.088, dk))
    elif style == "beanie":
        o.append(circle(0, 0.008, 0.105, col))
        for k in range(1, 4):
            o.append(circle(0, 0.008, 0.105 * k / 4, "none", dk, 0.008))
        o.append(circle(0, 0.008, 0.03, "#ffffff"))
    elif style == "turban":
        o.append(circle(0, 0.005, 0.12, col))
        o.append(path("M-0.11,0.02 Q0,-0.08 0.11,0.02", "none", dk, 0.015))
        o.append(path("M-0.1,0.06 Q0,-0.02 0.1,0.06", "none", dk, 0.015))
    elif style == "peci":
        o.append(circle(0, 0.012, 0.098, HAIR["black"]))
        o.append(ellipse(0, 0.005, 0.092, 0.085, "#1b1b1b"))
        o.append(ellipse(-0.02, -0.02, 0.03, 0.02, "#ffffff", op=0.12))
    # staff headwear
    elif style == "helmet":
        o.append(circle(0, 0.0, 0.125, col))
        o.append(line(0, -0.12, 0, 0.12, dk, 0.025))
        o.append(ellipse(0, -0.12, 0.09, 0.03, dk))
    elif style == "fire_helmet":
        o.append(ellipse(0, 0.03, 0.15, 0.17, dk))
        o.append(circle(0, 0.0, 0.12, col))
        o.append(line(0, -0.11, 0, 0.11, darker(col, 0.6), 0.03))
    elif style == "police_cap":
        o.append(circle(0, 0.0, 0.128, col))
        o.append(circle(0, 0.0, 0.128, "none", "#e9eef4", 0.016))
        o.append(ellipse(0, -0.115, 0.08, 0.04, "#111111"))
        o.append(circle(0, -0.07, 0.022, "#e3b341"))
    elif style == "pilot_cap":
        o.append(circle(0, 0.0, 0.125, col))
        o.append(circle(0, 0.0, 0.125, "none", "#e3b341", 0.014))
        o.append(ellipse(0, -0.115, 0.08, 0.04, "#111111"))
        o.append(circle(0, -0.075, 0.02, "#e3b341"))
    elif style == "beret":
        o.append(circle(0, 0.012, 0.098, HAIR["black"]))
        o.append(ellipse(-0.02, -0.005, 0.11, 0.1, col))
        o.append(circle(0.05, -0.06, 0.018, "#e3b341"))
    if acc == "ear_defenders":
        o.append(ellipse(-0.12, 0.0, 0.03, 0.05, "#222222"))
        o.append(ellipse(0.12, 0.0, 0.03, 0.05, "#222222"))
        o.append(path("M-0.12,0 Q0,-0.02 0.12,0", "none", "#222222", 0.02))
    if acc == "headset":
        o.append(ellipse(-0.11, 0.0, 0.025, 0.04, "#222222"))
        o.append(path("M-0.11,0.0 Q-0.09,-0.09 -0.03,-0.11", "none", "#222222", 0.012))
    return "".join(o)


def person(p, frame=0, tier=2):
    """p: dict(skin, hair, hair_col, shirt, sleeve, pants, shoes, overlay, items, scale)"""
    sc = p.get("scale", 1.0)
    skin = p.get("skin", SKIN[2])
    shirt = p.get("shirt", "#3a6fd8")
    sleeve = p.get("sleeve", shirt)
    shoes = p.get("shoes", "#1f1f1f")
    items = p.get("items", [])
    seated = "wheelchair" in items
    o = []
    flip = -1 if frame == 2 else 1
    swing = {0: 1.0, 1: 0.25, 2: 1.0, 3: 0.25}[frame]
    # shadow
    o.append(ellipse(0.03, 0.04, 0.3, 0.2, OUT))
    if tier == 0:
        return g(circle(0, 0, 0.22, shirt, "#ffffff", 0.04), f"scale({sc})")
    if tier == 1:
        return g(ellipse(0, 0, 0.24, 0.14, shirt) + circle(0, 0, 0.1, p.get("hair_col", skin)), f"scale({sc})")
    # wheelchair frame under the body
    if seated:
        o.append(rect(-0.25, -0.2, 0.5, 0.48, "#3d4652", None, rx=0.06))
        o.append(rect(-0.34, -0.12, 0.07, 0.4, "#20252c", None, rx=0.03))
        o.append(rect(0.27, -0.12, 0.07, 0.4, "#20252c", None, rx=0.03))
        o.append(line(-0.17, 0.28, -0.17, 0.38, "#20252c", 0.04, cap="round"))
        o.append(line(0.17, 0.28, 0.17, 0.38, "#20252c", 0.04, cap="round"))
        o.append(ellipse(-0.1, -0.26, 0.05, 0.04, shoes))
        o.append(ellipse(0.1, -0.26, 0.05, 0.04, shoes))
    else:
        # feet: right foot forward, left back (gait)
        fs = swing
        o.append(ellipse(flip * 0.085, -0.135 * fs - 0.02, 0.05, 0.08, shoes))
        o.append(ellipse(-flip * 0.085, 0.135 * fs + 0.02, 0.05, 0.08, shoes))
    # trailing items
    for it in items:
        if it == "suitcase":
            o.append(line(flip * 0.25, 0.15 * swing, flip * 0.34, 0.24, "#555b63", 0.02))
            o.append(rect(flip * 0.34 - 0.11, 0.24, 0.22, 0.34, "#2f5aa8" if p.get("case") is None else p["case"], None, rx=0.04))
            o.append(rect(flip * 0.34 - 0.11, 0.24, 0.22, 0.34, "none", "#00000040", 0.015, rx=0.04))
            o.append(line(flip * 0.34 - 0.06, 0.28, flip * 0.34 - 0.06, 0.54, "#00000030", 0.012))
            o.append(line(flip * 0.34 + 0.06, 0.28, flip * 0.34 + 0.06, 0.54, "#00000030", 0.012))
        if it == "trolley":
            o.append(rect(-0.2, -0.62, 0.4, 0.34, "#9aa3ad", "#59616d", 0.02, rx=0.03))
            o.append(rect(-0.16, -0.6, 0.32, 0.18, "#7a4f3a", None, rx=0.03))
            o.append(rect(-0.13, -0.42, 0.26, 0.12, "#2f5aa8", None, rx=0.03))
            o.append(line(-0.2, -0.28, 0.2, -0.28, "#59616d", 0.03))
        if it == "stroller":
            o.append(rect(-0.17, -0.62, 0.34, 0.4, "#5b6b7a", None, rx=0.08))
            o.append(ellipse(0, -0.5, 0.13, 0.1, "#cfd8e0"))
            o.append(line(-0.17, -0.24, 0.17, -0.24, "#2b3036", 0.03))
        if it == "cart":
            o.append(rect(-0.22, -0.66, 0.44, 0.38, "#7b8796", "#4e5866", 0.02, rx=0.04))
            o.append(circle(-0.08, -0.52, 0.07, "#2f6fdd"))
            o.append(circle(0.09, -0.52, 0.06, "#e3b341"))
            o.append(line(0.1, -0.4, 0.16, -0.28, "#a07a4a", 0.025))
    # torso
    o.append(ellipse(0, 0.0, 0.245, 0.135, shirt))
    o.append(ellipse(0, 0.035, 0.2, 0.08, darker(shirt, 0.9)))
    ov = p.get("overlay")
    if ov == "vest_orange" or ov == "vest_yellow" or ov == "vest_police":
        vc = {"vest_orange": "#f26b1d", "vest_yellow": "#e8e22a", "vest_police": "#d9e021"}[ov]
        o.append(ellipse(0, 0.0, 0.2, 0.125, vc))
        o.append(line(-0.19, -0.03, 0.19, -0.03, "#dfe6ec", 0.022))
        o.append(line(-0.19, 0.04, 0.19, 0.04, "#dfe6ec", 0.022))
        if ov == "vest_police":
            for k in range(-3, 4):
                o.append(rect(k * 0.05 - 0.025, 0.07, 0.025, 0.03, "#1d3fa8", None))
    if ov == "turnout":
        o.append(ellipse(0, 0.0, 0.25, 0.14, "#c9a24a"))
        o.append(line(-0.23, -0.02, 0.23, -0.02, "#dfe6ec", 0.028))
        o.append(line(-0.21, 0.06, 0.21, 0.06, "#e8e22a", 0.022))
    if ov == "paramedic":
        o.append(line(-0.23, 0.0, 0.23, 0.0, "#dfe6ec", 0.03))
        o.append(rect(-0.03, 0.03, 0.06, 0.06, "#ffffff", None))
        o.append(rect(-0.01, 0.035, 0.02, 0.05, "#d9463e", None))
        o.append(rect(-0.025, 0.05, 0.05, 0.02, "#d9463e", None))
    if ov == "apron":
        o.append(ellipse(0, 0.01, 0.16, 0.1, p.get("apron", "#2a9d8f")))
    if ov == "blazer":
        o.append(path("M-0.06,-0.13 L0,-0.02 L0.06,-0.13", "none", "#ffffff", 0.025))
        o.append(path("M-0.04,-0.13 L0,-0.05 L0.04,-0.13Z", p.get("scarf", "#c8102e")))
    if ov == "suit":
        o.append(path("M-0.07,-0.13 L0,-0.03 L0.07,-0.13Z", "#f4f4f4"))
        o.append(path("M-0.015,-0.12 L0,-0.05 L0.015,-0.12Z", p.get("tie", "#8a2f2f")))
    if ov == "overalls":
        o.append(line(-0.09, -0.12, -0.09, 0.12, darker(shirt, 0.7), 0.03))
        o.append(line(0.09, -0.12, 0.09, 0.12, darker(shirt, 0.7), 0.03))
    if p.get("epaulettes"):
        n = p["epaulettes"]
        for sg in (-1, 1):
            o.append(rect(sg * 0.18 - 0.04, -0.03, 0.08, 0.06, "#1b2a44", None, rx=0.01))
            for k in range(n):
                o.append(rect(sg * 0.18 - 0.035, -0.022 + k * 0.014, 0.07, 0.007, "#e3b341", None))
    if p.get("radio"):
        o.append(rect(0.12, -0.11, 0.05, 0.07, "#1b1b1b", None, rx=0.01))
        o.append(line(0.145, -0.11, 0.145, -0.16, "#1b1b1b", 0.01))
    # items on the back
    for it in items:
        if it == "backpack":
            o.append(rect(-0.15, 0.04, 0.3, 0.16, p.get("pack", "#3b4a5a"), None, rx=0.05))
            o.append(rect(-0.1, 0.08, 0.2, 0.06, darker(p.get("pack", "#3b4a5a"), 0.8), None, rx=0.03))
        if it == "big_backpack":
            o.append(rect(-0.17, 0.02, 0.34, 0.26, p.get("pack", "#a33b2a"), None, rx=0.07))
            o.append(rect(-0.13, 0.2, 0.26, 0.09, "#4b6b3a", None, rx=0.04))
        if it == "baby_carrier":
            o.append(ellipse(0, -0.17, 0.12, 0.08, "#8fb3d9"))
            o.append(circle(0, -0.2, 0.06, HAIR["dark"]))
        if it == "shoulder_bag":
            o.append(line(-0.2, -0.05, 0.15, 0.1, "#5a3b2a", 0.02))
            o.append(rect(-0.32, -0.08, 0.12, 0.18, "#7a4f3a", None, rx=0.03))
    # arms
    hand = skin if not p.get("gloves") else p["gloves"]
    ax = 0.215
    if seated:
        o.append(capsule(-ax, 0.0, -0.3, 0.02, 0.085, sleeve))
        o.append(capsule(ax, 0.0, 0.3, 0.02, 0.085, sleeve))
        o.append(circle(-0.31, 0.03, 0.045, hand))
        o.append(circle(0.31, 0.03, 0.045, hand))
    elif "wands" in items:
        for sg in (-1, 1):
            o.append(capsule(sg * ax, -0.02, sg * 0.36, -0.06, 0.085, sleeve))
            o.append(circle(sg * 0.37, -0.06, 0.045, hand))
            o.append(capsule(sg * 0.37, -0.06, sg * 0.5, -0.1, 0.05, "#ff6a13"))
    else:
        fx, fy = -flip * 0.275, -0.22 * swing - 0.03
        bx, by = flip * 0.255, 0.16 * swing + 0.02
        if "phone" in items or "coffee" in items or "clipboard" in items:
            fx, fy = -flip * 0.2, -0.2
        o.append(capsule(-flip * ax, -0.02, fx, fy, 0.088, sleeve))
        o.append(capsule(flip * ax, 0.0, bx, by, 0.088, sleeve))
        o.append(circle(fx, fy, 0.046, hand))
        o.append(circle(bx, by, 0.046, hand))
        for it in items:
            if it == "phone":
                o.append(rect(fx - 0.03, fy - 0.06, 0.06, 0.09, "#1b1b1b", None, rx=0.01))
            if it == "coffee":
                o.append(circle(fx, fy - 0.035, 0.035, "#f4f1ea", "#6b4f3a", 0.01))
            if it == "clipboard":
                o.append(rect(fx - 0.06, fy - 0.15, 0.12, 0.16, "#c9a77a", None, rx=0.01))
                o.append(rect(fx - 0.045, fy - 0.13, 0.09, 0.11, "#ffffff", None))
            if it == "handbag":
                o.append(rect(bx - 0.06, by - 0.02, 0.12, 0.1, "#9c3b52", None, rx=0.02))
            if it == "toolbox":
                o.append(rect(bx - 0.08, by - 0.02, 0.16, 0.08, "#c8102e", None, rx=0.015))
            if it == "medbag":
                o.append(rect(bx - 0.09, by - 0.02, 0.18, 0.1, "#2f8f4e", None, rx=0.02))
                o.append(rect(bx - 0.01, by - 0.005, 0.02, 0.07, "#ffffff", None))
                o.append(rect(bx - 0.035, by + 0.02, 0.07, 0.02, "#ffffff", None))
            if it == "cane":
                o.append(line(fx, fy, fx - 0.04 * flip, fy - 0.12, "#5a3b2a", 0.022, cap="round"))
            if it == "extinguisher":
                o.append(rect(bx - 0.045, by - 0.02, 0.09, 0.16, "#d9463e", None, rx=0.04))
            if it == "child_hand":
                pass
    # head
    o.append(circle(0, -0.005, 0.105, skin))
    o.append(hair_shape(p.get("hair", "short"), p.get("hair_col", HAIR["black"]), skin, p.get("head_acc")))
    return g("".join(o), f"scale({sc})")


def vbounds(p):
    items = p.get("items", [])
    sc = p.get("scale", 1.0)
    lo = -0.68 if any(i in items for i in ("trolley", "stroller", "cart")) else -0.3
    hi = 0.6 if "suitcase" in items else (0.4 if "wheelchair" in items else 0.3)
    return lo * sc, hi * sc
