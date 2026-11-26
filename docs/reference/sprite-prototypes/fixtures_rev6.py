#!/usr/bin/env python3
"""Revision 6 terminal assets: check in desk L1 to L3, security checkpoint L1,
doors S/M/L, windows S/M/L.

Geometry is in meters, local frame top left (0, 0), +y is the passenger side
(bottom edge). Ops follow the draw op kinds of docs/TERMINAL_FIXTURES.md 11.3:
r rect, c circle, e ellipse, p polygon, a path, l line. Field names for the
geometry (x, y, w, h, r, rx, ry, pts, d, x1..y2) are this script's choice, map
them to fixtureOpSchema when exporting.

Run: python3 fixtures_rev6.py docs/art/rev6. Outputs: ops/<id>.json, svg/<id>.svg, catalog_rev6.json, sheet_rev6.svg
"""
import json, math, os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/art/rev6"
SC_ASSET = 100  # px per meter for standalone svg
PX_M = 1 / 24.0  # a "px" stroke is drawn as px/24 m in previews

# palette (docs/TERMINAL_FIXTURES.md 1.1 plus wall and paint tokens)
OUTLINE = "#5d6672"; COUNTER = "#f4f2ec"; STONE = "#efece5"; WALNUT = "#6e4a33"
OAK = "#b88a5c"; STEEL = "#c3cad2"; MACHINE = "#dfe3e8"; BELT = "#4a5058"
SCREEN = "#1d2a38"; GLOW = "#5fa8d3"; GLASS = "#bfe3f5"; OK = "#3ec46d"
WALL = "#2c3441"; WALL_EDGE = "#1c222c"; DARK = "#14181d"; STEEL_D = "#9aa3ad"
YELLOW = "#f2c230"; RED = "#d9312b"; BURGUNDY = "#7a2e3b"; LEAF = "#4f8a4a"
PORCELAIN = "#fbfcfd"; TRAY = "#3a6ea5"; LIVERY = "#c8102e"; DEP = "#3b82c4"


def shade(hexc, f):
    h = hexc.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    if f < 0:
        r, g, b = (round(v * (1 + f)) for v in (r, g, b))
    else:
        r, g, b = (round(v + (255 - v) * f) for v in (r, g, b))
    return "#%02x%02x%02x" % (r, g, b)


def lit(c): return {"g": "lit", "c": c}
def soft(c): return {"g": "soft", "c": c}
def dome(c): return {"g": "dome", "c": c}


def _op(k, geo, f=None, s=None, sw=None, o=None, ht=None, dash=None, ov=False,
        fl=False, fLiv=None, sLiv=None, swing=False, tag=None):
    d = {"k": k}
    d.update(geo)
    if f is not None: d["f"] = f
    if s is not None: d["s"] = s
    if sw is not None: d["sw"] = sw
    if o is not None: d["o"] = o
    if ht is not None: d["ht"] = ht
    if dash is not None: d["dash"] = dash
    if ov: d["ov"] = True
    if fl: d["fl"] = True            # floor layer, drawn under everything
    if fLiv is not None: d["fLiv"] = fLiv
    if sLiv is not None: d["sLiv"] = sLiv
    if swing: d["swing"] = True      # floor clearance, may leave the footprint
    if tag: d["tag"] = tag
    return d


def R(x, y, w, h, rx=None, **kw):
    g = {"x": x, "y": y, "w": w, "h": h}
    if rx: g["rx"] = rx
    return _op("r", g, **kw)

def C(x, y, r, **kw): return _op("c", {"x": x, "y": y, "r": r}, **kw)
def E(x, y, rx, ry, rot=0, **kw): return _op("e", {"x": x, "y": y, "rx": rx, "ry": ry, "rot": rot}, **kw)
def P(pts, **kw): return _op("p", {"pts": pts}, **kw)
def A(d, **kw): return _op("a", {"d": d}, **kw)
def L(x1, y1, x2, y2, **kw): return _op("l", {"x1": x1, "y1": y1, "x2": x2, "y2": y2}, **kw)

PX9 = {"px": 0.9}; PX6 = {"px": 0.6}; PX5 = {"px": 0.5}


def solid(x, y, w, h, fill, ht, rx=None, **kw):
    """A solid outlined part with a height."""
    return R(x, y, w, h, rx=rx, f=fill, s=OUTLINE, sw=PX9, ht=ht, **kw)


def chevrons(x, ys, color=DEP):
    out = []
    for y in ys:
        out.append(A("M %.3f %.3f L %.3f %.3f L %.3f %.3f" % (x - 0.07, y + 0.06, x, y, x + 0.07, y + 0.06),
                     s=color, sw=PX6, o=0.9))
    return out


def belt_lane(x0, y0, y1, powered=False, chrome=False):
    """Belt lane 0.8 m wide, x0 to x0 + 0.8, from the back edge y0 to the front y1."""
    ops = []
    frame = "#e4eaf0" if chrome else STEEL
    ops.append(solid(x0, y0, 0.8, y1 - y0, frame, 0.8))
    rail = 0.07 if powered or chrome else 0.04
    ops.append(R(x0 + rail, y0, 0.8 - 2 * rail, y1 - y0, f=lit(BELT), ht=0.8))
    step = 0.14 if not powered else 0.18
    y = y0 + 0.2
    while y < y1 - 0.45:
        ops.append(L(x0 + rail, y, x0 + 0.8 - rail, y, s=OUTLINE, sw=PX5, o=0.45))
        y += step
    ops += chevrons(x0 + 0.4, [y0 + 0.3, y0 + 0.6])
    return ops


def scale_plate(x0, y1, chrome=False):
    ops = [R(x0 + 0.1, y1 - 0.5, 0.6, 0.46, rx=0.03, f=lit("#e4eaf0" if chrome else STEEL),
             s=OUTLINE, sw=PX9, ht=0.82)]
    ops.append(R(x0 + 0.3, y1 - 0.12, 0.2, 0.05, f=SCREEN, ht=0.9))
    ops.append(L(x0 + 0.32, y1 - 0.08, x0 + 0.48, y1 - 0.08, s=GLOW, sw=PX6))
    return ops


def agent_counter(top, fill, ht=1.0, rx=None, back=None):
    ops = []
    ops.append(solid(0.0, 0.7, 0.6, 1.2, lit(fill), ht, rx=rx))
    ops.append(R(0.0, 0.7, 0.6, 0.08, f=lit(LIVERY), fLiv=0.0, ht=ht))    # livery fascia on the back edge
    ops.append(R(0.14, 0.82, 0.3, 0.06, f=SCREEN, s=OUTLINE, sw=PX5, ht=1.5))    # monitor
    ops.append(L(0.16, 0.89, 0.42, 0.89, s=GLOW, sw=PX6))
    ops.append(R(0.14, 1.0, 0.3, 0.1, f=MACHINE, s=OUTLINE, sw=PX5, ht=1.03))    # keyboard
    ops.append(R(0.12, 1.35, 0.34, 0.28, rx=0.02, f=lit(STEEL), s=OUTLINE, sw=PX5, ht=1.12))  # printer
    return ops


def agent_chair(color):
    return [C(0.3, 0.4, 0.27, f=dome(color), s=OUTLINE, sw=PX9, ht=0.9, tag="agent chair seat"),
            E(0.3, 0.2, 0.22, 0.08, f=shade(color, -0.25), s=OUTLINE, sw=PX5, ht=1.1, tag="chair back"),
            C(0.3, 0.42, 0.14, f=shade(color, 0.08), o=0.55, ht=0.9)]


def pass_reader(x, y):
    """Passport and boarding pass reader with a green status screen."""
    return [R(x, y, 0.38, 0.5, rx=0.03, f=lit("#ffffff"), s=OUTLINE, sw=PX9, ht=1.0),
            R(x + 0.06, y + 0.07, 0.26, 0.14, rx=0.02, f="#2e8b57", s=OUTLINE, sw=PX5, ht=1.02),
            L(x + 0.09, y + 0.12, x + 0.29, y + 0.12, s="#8ff0b5", sw=PX6),
            R(x + 0.08, y + 0.3, 0.22, 0.12, rx=0.02, f=SCREEN, s=OUTLINE, sw=PX5, ht=1.02),
            L(x + 0.1, y + 0.36, x + 0.28, y + 0.36, s=GLOW, sw=PX6)]


# ---------------------------------------------------------------- check in
def checkin(level):
    W = {1: 2.0, 2: 3.0, 3: 4.0}[level]
    ops = []
    if level == 3:
        ops.append(R(0.7, 1.5, 3.2, 0.5, rx=0.08, f=BURGUNDY, o=0.95, fl=True, tag="premium floor mat"))
    # back panel (levels 2 and 3), the belt passes through the gap x 0.6 to 1.4
    if level >= 2:
        ph = 2.2 if level == 2 else 2.4
        ops.append(R(0.0, 0.0, 0.6, 0.1, f=lit(LIVERY), s=OUTLINE, sw=PX9, ht=ph, fLiv=-0.1 if level == 2 else 0.1))
        ops.append(R(1.4, 0.0, W - 1.4, 0.1, f=lit(LIVERY), s=OUTLINE, sw=PX9, ht=ph, fLiv=-0.1 if level == 2 else 0.1))
        if level == 3:
            ops.append(L(0.02, 0.12, 0.58, 0.12, s=GLOW, sw=PX6))
            ops.append(L(1.42, 0.12, W - 0.02, 0.12, s=GLOW, sw=PX6))
            ops.append(P([[1.4, 0.12], [W, 0.12], [W, 0.5], [1.4, 0.5]], f=GLOW, o=0.10, fl=True, tag="glow"))
    # agent counter
    if level == 1:
        ops += agent_counter(0.7, COUNTER)
    elif level == 2:
        ops += agent_counter(0.7, STONE)
        ops.append(R(0.5, 0.72, 0.04, 1.1, f=GLASS, s=OUTLINE, sw=PX5, o=0.7, ht=1.5))   # glass divider
    else:
        ops.append(R(0.0, 0.7, 0.6, 1.2, rx=0.2, f=lit(WALNUT), s=OUTLINE, sw=PX9, ht=1.0))
        ops.append(R(0.04, 0.74, 0.52, 1.12, rx=0.16, f=lit(STONE), ht=1.0))
        ops.append(R(0.52, 0.74, 0.04, 1.12, f=lit(LIVERY), fLiv=0.0, ht=1.0))
        ops.append(R(0.12, 0.82, 0.3, 0.06, f=SCREEN, s=OUTLINE, sw=PX5, ht=1.5))
        ops.append(L(0.14, 0.89, 0.40, 0.89, s=GLOW, sw=PX6))
        ops.append(R(0.12, 1.0, 0.3, 0.1, f=MACHINE, s=OUTLINE, sw=PX5, ht=1.03))
        ops.append(R(0.12, 1.35, 0.34, 0.28, rx=0.02, f=lit("#e4eaf0"), s=OUTLINE, sw=PX5, ht=1.12))
        ops.append(R(0.5, 0.72, 0.04, 1.1, f=GLASS, s=OUTLINE, sw=PX5, o=0.7, ht=1.5))
    ops += agent_chair(WALNUT if level == 3 else '#2b2f36')
    # belt lane
    ops += belt_lane(0.6, 0.0, 1.55, powered=level >= 2, chrome=level == 3)
    ops += scale_plate(0.6, 1.55, chrome=level == 3)
    if level == 3:
        ops.append(C(1.365, 0.25, 0.028, f=OK, s=OUTLINE, sw=PX5, ht=0.9))        # status light on the rail
        ops.append(C(1.365, 0.25, 0.05, s=OK, sw=PX5, o=0.5))
    # passenger ledge and extension
    if level == 1:
        ops.append(solid(1.4, 0.95, 0.6, 0.9, lit(COUNTER), 0.95))
        ops += pass_reader(1.5, 1.05)
        ops.append(R(1.6, 1.62, 0.3, 0.1, f=MACHINE, s=OUTLINE, sw=PX5, ht=1.0))
    elif level == 2:
        ops.append(solid(1.4, 0.95, 1.6, 0.9, lit(STONE), 0.95))
        ops.append(R(1.4, 1.77, 1.6, 0.08, f=lit(LIVERY), fLiv=0.0, ht=0.95))
        ops += pass_reader(1.5, 1.05)
        ops.append(C(2.15, 1.13, 0.05, f=dome(STEEL), s=OUTLINE, sw=PX5, ht=1.3))  # display pole
        ops.append(R(2.0, 1.07, 0.3, 0.05, f=SCREEN, s=OUTLINE, sw=PX5, ht=1.35))
        ops.append(L(2.02, 1.14, 2.28, 1.14, s=GLOW, sw=PX6))
        ops.append(R(2.4, 1.1, 0.36, 0.3, rx=0.02, f=lit(STEEL), s=OUTLINE, sw=PX5, ht=1.05))   # tag printer
        ops.append(R(2.8, 1.15, 0.14, 0.12, f=SCREEN, s=OUTLINE, sw=PX5, ht=1.0))               # card reader
    else:
        ops.append(R(1.4, 0.95, 2.5, 0.9, rx=0.3, f=lit(WALNUT), s=OUTLINE, sw=PX9, ht=0.95))
        ops.append(R(1.46, 1.0, 2.38, 0.8, rx=0.26, f=lit(STONE), ht=0.95))
        ops.append(R(1.6, 1.72, 2.1, 0.05, rx=0.02, f=lit(LIVERY), fLiv=0.1, ht=0.95))
        ops += pass_reader(1.5, 1.05)
        ops.append(C(2.15, 1.13, 0.05, f=dome(STEEL), s=OUTLINE, sw=PX5, ht=1.3))
        ops.append(R(2.0, 1.07, 0.3, 0.05, f=SCREEN, s=OUTLINE, sw=PX5, ht=1.35))
        ops.append(L(2.02, 1.14, 2.28, 1.14, s=GLOW, sw=PX6))
        ops.append(R(2.4, 1.1, 0.36, 0.3, rx=0.02, f=lit("#e4eaf0"), s=OUTLINE, sw=PX5, ht=1.05))
        ops.append(C(3.15, 1.3, 0.05, f=dome(STEEL), s=OUTLINE, sw=PX5, ht=1.3))
        ops.append(R(3.0, 1.24, 0.3, 0.05, f=SCREEN, s=OUTLINE, sw=PX5, ht=1.35))
        ops.append(L(3.02, 1.31, 3.28, 1.31, s=GLOW, sw=PX6))
        ops.append(C(3.62, 1.35, 0.09, f=dome(PORCELAIN), s=OUTLINE, sw=PX5, ht=1.0))   # vase
        ops.append(C(3.62, 1.35, 0.14, f=dome(LEAF), s=OUTLINE, sw=PX5, ht=1.2, o=0.9))
        for x in (0.0, 3.97):                                                             # glass fins on both sides
            ops.append(R(x, 0.7, 0.03, 1.2, f=GLASS, s=OUTLINE, sw=PX5, o=0.7, ht=1.6))
    return {"size": [W, 2.0], "ops": ops}


# ---------------------------------------------------------------- security L1
def security_l1():
    ops = []
    # 1 wait line and two stanchion posts
    ops.append(R(1.15, 2.3, 0.1, 1.2, f=YELLOW, o=0.9, fl=True, tag="wait line"))
    ops.append(L(0.6, 2.1, 0.6, 3.7, s=RED, sw={"m": 0.03}, o=0.8, tag="tape"))
    ops.append(C(0.6, 2.1, 0.09, f=dome(STEEL), s=OUTLINE, sw=PX6, ht=1.0))
    ops.append(C(0.6, 3.7, 0.09, f=dome(STEEL), s=OUTLINE, sw=PX6, ht=1.0))
    # 2 ID check podium
    ops.append(solid(2.4, 1.75, 0.9, 0.45, lit(COUNTER), 1.1))
    ops.append(R(2.62, 1.82, 0.3, 0.05, f=SCREEN, s=OUTLINE, sw=PX5, ht=1.4))
    ops.append(L(2.64, 1.89, 2.9, 1.89, s=GLOW, sw=PX6))
    ops.append(R(3.02, 1.84, 0.18, 0.12, f=MACHINE, s=OUTLINE, sw=PX5, ht=1.15))
    # 3 tray table with trays
    ops.append(solid(4.6, 0.4, 2.6, 0.8, lit(STEEL), 0.85))
    for x in (4.8, 5.45):
        ops.append(R(x, 0.55, 0.55, 0.5, rx=0.03, f=lit(TRAY), s=OUTLINE, sw=PX5, ht=0.95))
        ops.append(R(x + 0.06, 0.61, 0.43, 0.38, rx=0.02, f=shade(TRAY, -0.18), o=0.8, ht=0.95))
    ops.append(R(6.3, 0.58, 0.55, 0.44, rx=0.03, f=lit(TRAY), s=OUTLINE, sw=PX5, ht=0.88))
    # 4 single view x-ray, feed and exit belts, operator stand
    ops.append(solid(7.2, 0.4, 0.6, 0.8, lit(STEEL), 0.8))
    ops.append(R(7.24, 0.44, 0.52, 0.72, f=lit(BELT), ht=0.8))
    ops.append(solid(10.4, 0.4, 1.0, 0.8, lit(STEEL), 0.8))
    ops.append(R(10.44, 0.44, 0.92, 0.72, f=lit(BELT), ht=0.8))
    ops.append(R(7.8, 0.2, 2.6, 1.2, rx=0.12, f=lit(MACHINE), s=OUTLINE, sw=PX9, ht=1.4))
    for x in (7.8, 10.3):
        ops.append(R(x, 0.4, 0.1, 0.8, f=DARK, ht=1.4))
    for x in (7.95, 8.03, 10.17, 10.25):
        ops.append(R(x, 0.45, 0.04, 0.7, f="#2b2f36", ht=1.2))
    ops.append(R(9.0, 1.12, 0.8, 0.18, rx=0.03, f=lit(STEEL), s=OUTLINE, sw=PX5, ht=1.4))
    ops.append(C(9.2, 1.21, 0.04, f=OK, s=OUTLINE, sw=PX5, ht=1.45))
    ops.append(solid(8.6, 1.6, 1.2, 0.45, lit(COUNTER), 1.0))
    ops.append(R(9.0, 1.67, 0.4, 0.06, f=SCREEN, s=OUTLINE, sw=PX5, ht=1.4))
    ops.append(L(9.02, 1.74, 9.38, 1.74, s=GLOW, sw=PX6))
    # 5 walk through detector, posts solid, crossbar overhead
    ops.append(R(7.9, 2.0, 0.4, 0.3, f=lit(MACHINE), s=OUTLINE, sw=PX9, ht=2.1))
    ops.append(R(7.9, 3.5, 0.4, 0.3, f=lit(MACHINE), s=OUTLINE, sw=PX9, ht=2.1))
    ops.append(C(8.1, 2.15, 0.05, f=OK, s=OUTLINE, sw=PX5, ht=2.15))
    ops.append(R(7.9, 2.3, 0.4, 1.2, f=MACHINE, s=OUTLINE, sw=PX6, o=0.4, dash=[0.08, 0.06], ov=True, tag="crossbar"))
    # 6 hand search mat
    ops.append(R(9.4, 2.3, 1.4, 1.2, rx=0.05, f=YELLOW, o=0.85, fl=True, tag="search mat"))
    ops.append(E(9.95, 2.9, 0.1, 0.2, rot=0, f=DARK, o=0.45, fl=True))
    ops.append(E(10.25, 2.9, 0.1, 0.2, rot=0, f=DARK, o=0.45, fl=True))
    # 7 reclaim table with gravity rollers
    ops.append(solid(11.4, 0.4, 2.0, 0.8, lit(STEEL), 0.85))
    x = 11.65
    while x < 13.3:
        ops.append(L(x, 0.45, x, 1.15, s=OUTLINE, sw=PX5, o=0.6))
        x += 0.25
    # 8 re dress bench and bin
    ops.append(solid(13.6, 2.9, 2.0, 0.5, lit(OAK), 0.45))
    for x in (14.1, 14.6, 15.1):
        ops.append(L(x, 2.93, x, 3.37, s=shade(OAK, -0.3), sw=PX5, o=0.6))
    ops.append(C(15.8, 3.15, 0.17, f=dome(STEEL_D), s=OUTLINE, sw=PX9, ht=0.7))
    ops.append(C(15.8, 3.15, 0.11, f=DARK, o=0.6, ht=0.7))
    return {"size": [16.0, 4.0], "ops": ops}


# ---------------------------------------------------------------- doors and windows
def stubs(x_left, x_right_start, w_right):
    return [R(0, 0, x_left, 0.6, f=WALL, s=WALL_EDGE, sw=PX9, tag="wall stub"),
            R(x_right_start, 0, w_right, 0.6, f=WALL, s=WALL_EDGE, sw=PX9, tag="wall stub")]


def jamb(x, w, color=STEEL_D):
    return R(x, 0.0, w, 0.6, f=color, s=OUTLINE, sw=PX6)


def door_s():
    ops = []
    # swing clearance first (floor level paint), hinge on the left, opens toward +y
    ops.append(A("M 0.55 0.3 L 1.45 0.3 A 0.9 0.9 0 0 1 0.55 1.2 Z", f="#ffffff", o=0.12, swing=True))
    ops.append(A("M 1.45 0.3 A 0.9 0.9 0 0 1 0.55 1.2", s=STEEL_D, sw=PX6, o=0.8, dash=[0.05, 0.05], swing=True))
    ops.append(L(0.55, 0.3, 0.55, 1.2, s=OUTLINE, sw=PX6, o=0.4, dash=[0.05, 0.05], swing=True))
    ops += stubs(0.5, 1.5, 0.5)
    ops += [jamb(0.5, 0.05), jamb(1.45, 0.05)]
    ops.append(R(0.55, 0.26, 0.9, 0.08, f=STEEL_D, o=0.8, fl=True, tag="threshold"))
    ops.append(R(0.55, 0.27, 0.9, 0.06, f=lit("#e9ecef"), s=OUTLINE, sw=PX9, tag="leaf"))
    ops.append(C(0.575, 0.3, 0.03, f=STEEL_D, s=OUTLINE, sw=PX5))
    ops.append(R(1.28, 0.21, 0.12, 0.03, f=STEEL, s=OUTLINE, sw=PX5))
    ops.append(R(1.28, 0.36, 0.12, 0.03, f=STEEL, s=OUTLINE, sw=PX5))
    return {"size": [2.0, 0.6], "ops": ops}


def door_m():
    ops = []
    ops.append(A("M 0.09 0.3 L 1.0 0.3 A 0.91 0.91 0 0 1 0.09 1.21 Z", f="#ffffff", o=0.12, swing=True))
    ops.append(A("M 1.91 0.3 L 1.0 0.3 A 0.91 0.91 0 0 0 1.91 1.21 Z", f="#ffffff", o=0.12, swing=True))
    ops.append(A("M 1.0 0.3 A 0.91 0.91 0 0 1 0.09 1.21", s=STEEL_D, sw=PX6, o=0.8, dash=[0.05, 0.05], swing=True))
    ops.append(A("M 1.0 0.3 A 0.91 0.91 0 0 0 1.91 1.21", s=STEEL_D, sw=PX6, o=0.8, dash=[0.05, 0.05], swing=True))
    ops += [jamb(0.0, 0.06), jamb(1.94, 0.06)]
    ops.append(R(0.06, 0.26, 1.88, 0.08, f=STEEL_D, o=0.8, fl=True, tag="threshold"))
    for x0 in (0.06, 1.0):
        ops.append(R(x0, 0.265, 0.94, 0.07, f=lit(STEEL), s=OUTLINE, sw=PX9, tag="leaf frame"))
        ops.append(R(x0 + 0.06, 0.28, 0.82, 0.04, f=GLASS, o=0.9, tag="leaf glass"))
    ops.append(R(0.92, 0.22, 0.03, 0.16, f=STEEL_D, s=OUTLINE, sw=PX5))
    ops.append(R(1.05, 0.22, 0.03, 0.16, f=STEEL_D, s=OUTLINE, sw=PX5))
    ops.append(C(0.09, 0.3, 0.03, f=STEEL_D, s=OUTLINE, sw=PX5))
    ops.append(C(1.91, 0.3, 0.03, f=STEEL_D, s=OUTLINE, sw=PX5))
    return {"size": [2.0, 0.6], "ops": ops}


def door_l():
    ops = []
    ops += [jamb(0.0, 0.1), jamb(3.9, 0.1)]
    for x0 in (0.1, 3.6):
        ops.append(R(x0, 0.25, 0.3, 0.1, f=lit(STEEL), s=OUTLINE, sw=PX9, tag="fixed lite frame"))
        ops.append(R(x0 + 0.04, 0.28, 0.22, 0.04, f=GLASS, o=0.9, tag="fixed lite glass"))
    ops.append(R(0.4, 0.2, 3.2, 0.2, f=STEEL_D, o=0.25, fl=True, tag="threshold"))
    ops.append(L(0.4, 0.2, 3.6, 0.2, s=STEEL_D, sw=PX6, o=0.8, tag="track"))
    ops.append(L(0.4, 0.4, 3.6, 0.4, s=STEEL_D, sw=PX6, o=0.8, tag="track"))
    ops.append(R(0.4, 0.22, 1.65, 0.07, f=lit(STEEL), s=OUTLINE, sw=PX9, tag="sliding leaf"))
    ops.append(R(0.46, 0.235, 1.53, 0.04, f=GLASS, o=0.9))
    ops.append(R(1.95, 0.31, 1.65, 0.07, f=lit(STEEL), s=OUTLINE, sw=PX9, tag="sliding leaf"))
    ops.append(R(2.01, 0.325, 1.53, 0.04, f=GLASS, o=0.9))
    for y in (0.02, 0.5):
        ops.append(R(1.9, y, 0.2, 0.08, rx=0.02, f=SCREEN, s=OUTLINE, sw=PX5, tag="sensor"))
        ops.append(L(1.93, y + (0.06 if y < 0.3 else 0.02), 2.07, y + (0.06 if y < 0.3 else 0.02), s=GLOW, sw=PX6))
    return {"size": [4.0, 0.6], "ops": ops}


def window_parts(W, x_a, x_b, mullions, jamb_w):
    """Window in a 0.6 m wall. Opening from x_a to x_b."""
    ops = []
    if x_a > 0:
        ops += stubs(x_a, x_b, W - x_b)
    else:
        ops += [jamb(0.0, jamb_w), jamb(W - jamb_w, jamb_w)]
    xa, xb = x_a + (0 if x_a > 0 else jamb_w), x_b - (0 if x_a > 0 else jamb_w)
    ops.append(R(xa, 0.0, xb - xa, 0.08, f=STEEL_D, s=OUTLINE, sw=PX6, tag="outer ledge"))
    ops.append(R(xa, 0.18, xb - xa, 0.24, f=lit(STEEL), s=OUTLINE, sw=PX9, tag="frame"))
    edges = [xa + 0.06] + [m for pair in [(mm - 0.04, mm + 0.04) for mm in mullions] for m in pair] + [xb - 0.06]
    for i in range(0, len(edges), 2):
        ops.append(R(edges[i], 0.27, edges[i + 1] - edges[i], 0.06, f=GLASS, s="#7fb6d6", sw=PX6, o=0.9, tag="glass"))
    for m in mullions:
        ops.append(R(m - 0.04, 0.18, 0.08, 0.24, f=STEEL_D, s=OUTLINE, sw=PX6, tag="mullion"))
    ops.append(R(xa, 0.42, xb - xa, 0.18, f=lit(STONE), s=OUTLINE, sw=PX9, tag="inner sill"))
    first = edges[0]
    ops.append(L(first + 0.08, 0.3, first + 0.28, 0.3, s="#ffffff", sw=PX6, o=0.8))
    return ops


def window_s(): return {"size": [2.0, 0.6], "ops": window_parts(2.0, 0.5, 1.5, [], 0.0)}
def window_m(): return {"size": [2.0, 0.6], "ops": window_parts(2.0, 0.0, 2.0, [1.0], 0.06)}
def window_l(): return {"size": [4.0, 0.6], "ops": window_parts(4.0, 0.0, 4.0, [1.05, 2.0, 2.95], 0.1)}


ASSETS = [
    ("checkIn.l1", "Check in desk, level 1", checkin(1)),
    ("checkIn.l2", "Check in desk, level 2", checkin(2)),
    ("checkIn.l3", "Check in desk, level 3", checkin(3)),
    ("securityLane.l1", "Security checkpoint, level 1", security_l1()),
    ("door.s", "Door, small", door_s()),
    ("door.m", "Door, medium", door_m()),
    ("door.l", "Door, large", door_l()),
    ("window.s", "Window, small", window_s()),
    ("window.m", "Window, medium", window_m()),
    ("window.l", "Window, large", window_l()),
]

# ---------------------------------------------------------------- svg writer
class Defs:
    def __init__(self):
        self.items = {}

    def grad(self, spec):
        c = spec["c"]; g = spec["g"]
        gid = "g_%s_%s" % (g, c.lstrip("#"))
        if gid in self.items:
            return gid
        if g == "lit":
            s = ('<linearGradient id="%s" x1="0" y1="0" x2="0" y2="1">'
                 '<stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient>'
                 % (gid, shade(c, 0.10), shade(c, -0.07)))
        elif g == "soft":
            s = ('<linearGradient id="%s" x1="0" y1="0" x2="1" y2="0">'
                 '<stop offset="0" stop-color="%s"/><stop offset="0.5" stop-color="%s"/>'
                 '<stop offset="1" stop-color="%s"/></linearGradient>'
                 % (gid, shade(c, -0.12), shade(c, 0.14), shade(c, -0.12)))
        else:
            s = ('<radialGradient id="%s" cx="0.4" cy="0.35" r="0.75">'
                 '<stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></radialGradient>'
                 % (gid, shade(c, 0.2), shade(c, -0.1)))
        self.items[gid] = s
        return gid

    def svg(self):
        blur = ('<filter id="blur" x="-0.3" y="-0.3" width="1.6" height="1.6">'
                '<feGaussianBlur stdDeviation="0.035"/></filter>')
        return "<defs>%s%s</defs>" % (blur, "".join(self.items.values()))


def fmt(v): return ("%.3f" % v).rstrip("0").rstrip(".")


def fill_attr(op, defs):
    f = op.get("f")
    if f is None:
        return 'fill="none"'
    if isinstance(f, dict):
        spec = dict(f)
        if "fLiv" in op:
            spec["c"] = shade(LIVERY, op["fLiv"])
        return 'fill="url(#%s)"' % defs.grad(spec)
    if "fLiv" in op:
        f = shade(LIVERY, op["fLiv"])
    return 'fill="%s"' % f


def stroke_attrs(op):
    s = op.get("s")
    if s is None:
        return 'stroke="none"'
    sw = op.get("sw", PX9)
    w = sw["px"] * PX_M if "px" in sw else sw["m"]
    a = 'stroke="%s" stroke-width="%s" stroke-linejoin="round" stroke-linecap="round"' % (s, fmt(w))
    if "dash" in op:
        a += ' stroke-dasharray="%s"' % " ".join(fmt(d) for d in op["dash"])
    return a


def shape_points(op):
    k = op["k"]
    if k == "r":
        x, y, w, h = op["x"], op["y"], op["w"], op["h"]
        return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
    if k == "c":
        return [(op["x"] + op["r"] * math.cos(t * math.pi / 8), op["y"] + op["r"] * math.sin(t * math.pi / 8)) for t in range(16)]
    if k == "e":
        return [(op["x"] + op["rx"] * math.cos(t * math.pi / 8), op["y"] + op["ry"] * math.sin(t * math.pi / 8)) for t in range(16)]
    if k == "p":
        return [tuple(p) for p in op["pts"]]
    return []


def hull(points):
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo = []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def shape_el(op, defs, body=True, extra=""):
    k = op["k"]
    fa = fill_attr(op, defs) if body else 'fill="#000"'
    sa = stroke_attrs(op) if body else 'stroke="none"'
    o = ' opacity="%s"' % fmt(op["o"]) if (body and "o" in op) else ""
    if k == "r":
        rx = ' rx="%s"' % fmt(op["rx"]) if "rx" in op else ""
        return '<rect x="%s" y="%s" width="%s" height="%s"%s %s %s%s%s/>' % (
            fmt(op["x"]), fmt(op["y"]), fmt(op["w"]), fmt(op["h"]), rx, fa, sa, o, extra)
    if k == "c":
        return '<circle cx="%s" cy="%s" r="%s" %s %s%s%s/>' % (fmt(op["x"]), fmt(op["y"]), fmt(op["r"]), fa, sa, o, extra)
    if k == "e":
        return '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" transform="rotate(%s %s %s)" %s %s%s%s/>' % (
            fmt(op["x"]), fmt(op["y"]), fmt(op["rx"]), fmt(op["ry"]), fmt(op.get("rot", 0)), fmt(op["x"]), fmt(op["y"]), fa, sa, o, extra)
    if k == "p":
        return '<polygon points="%s" %s %s%s%s/>' % (" ".join("%s,%s" % (fmt(a), fmt(b)) for a, b in op["pts"]), fa, sa, o, extra)
    if k == "a":
        return '<path d="%s" %s %s%s%s/>' % (op["d"], fa, sa, o, extra)
    if k == "l":
        return '<line x1="%s" y1="%s" x2="%s" y2="%s" %s%s%s/>' % (fmt(op["x1"]), fmt(op["y1"]), fmt(op["x2"]), fmt(op["y2"]), sa, o, extra)
    raise ValueError(k)


def asset_group(asset, defs):
    ops = asset["ops"]
    floor = [o for o in ops if o.get("fl") or o.get("swing")]
    over = [o for o in ops if o.get("ov")]
    body = [o for o in ops if o not in floor and o not in over]
    out = []
    # floor layer and swing clearance first
    out += [shape_el(o, defs) for o in floor]
    # one shadow group, blurred once, drawn once at 28 percent
    sh = []
    for o in body:
        if "ht" in o:
            ht = min(o["ht"], 2.6)
            pts = shape_points(o)
            if pts:
                moved = [(x + 0.13 * ht, y + 0.18 * ht) for x, y in pts]
                hp = hull(pts + moved)
                sh.append('<polygon points="%s" fill="#000"/>' % " ".join("%s,%s" % (fmt(a), fmt(b)) for a, b in hp))
    if sh:
        out.append('<g opacity="0.28" filter="url(#blur)">%s</g>' % "".join(sh))
    out += [shape_el(o, defs) for o in body]
    out += [shape_el(o, defs) for o in over]
    return "".join(out)


def standalone_svg(aid, name, asset):
    defs = Defs()
    g = asset_group(asset, defs)
    W, D = asset["size"]
    pad = 0.6
    x0, y0 = -pad, -pad
    vw, vh = W + 2 * pad, D + 2 * pad + (0.8 if aid.startswith("door") else 0)
    if aid.startswith("checkIn"):
        y0 = -0.6; vh = D + 1.2
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s %s %s %s" width="%d" height="%d">'
            '<title>%s</title>%s<g>%s</g></svg>' % (fmt(x0), fmt(y0), fmt(vw), fmt(vh),
                                                   round(vw * SC_ASSET), round(vh * SC_ASSET), name, defs.svg(), g))


# ---------------------------------------------------------------- sheet
INK = "#1f2630"; MUTE = "#5d6672"; PANEL = "#e9e6df"; GRID = "#d4d0c7"; PAGE = "#fbfaf7"


def txt(x, y, s, size=0.4, weight="normal", fill=INK, anchor="start"):
    return ('<text x="%s" y="%s" font-family="DejaVu Sans, Arial, sans-serif" font-size="%s" font-weight="%s" '
            'fill="%s" text-anchor="%s">%s</text>' % (fmt(x), fmt(y), fmt(size), weight, fill, anchor, s))


def panel(x, y, w, h, grid_x0=0.0):
    out = ['<rect x="%s" y="%s" width="%s" height="%s" rx="0.15" fill="%s" stroke="#cfcac0" stroke-width="0.03"/>' % (fmt(x), fmt(y), fmt(w), fmt(h), PANEL)]
    gx = math.ceil((x - grid_x0) / 2) * 2 + grid_x0
    while gx < x + w:
        out.append('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-width="0.02"/>' % (fmt(gx), fmt(y), fmt(gx), fmt(y + h), GRID))
        gx += 2
    gy = math.ceil(y / 2) * 2
    while gy < y + h:
        out.append('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-width="0.02"/>' % (fmt(x), fmt(gy), fmt(x + w), fmt(gy), GRID))
        gy += 2
    return "".join(out)


def place(aid, asset, defs, x, y):
    return '<g transform="translate(%s %s)">%s</g>' % (fmt(x), fmt(y), asset_group(asset, defs))


def footprint(x, y, w, h):
    return ('<rect x="%s" y="%s" width="%s" height="%s" fill="none" stroke="#2f6fd1" stroke-width="0.03" '
            'stroke-dasharray="0.12 0.08"/>' % (fmt(x), fmt(y), fmt(w), fmt(h)))


def wall_ctx(x, y, w):
    return '<rect x="%s" y="%s" width="%s" height="0.6" fill="%s" stroke="%s" stroke-width="0.0375"/>' % (fmt(x), fmt(y), fmt(w), WALL, WALL_EDGE)


def build_sheet(assets):
    A_ = {a[0]: a[2] for a in assets}
    defs = Defs()
    W_SHEET = 20.0
    parts = []
    parts.append('<rect x="0" y="0" width="%s" height="40" fill="%s"/>' % (fmt(W_SHEET), PAGE))
    parts.append(txt(0.8, 1.2, "Revision 6 terminal assets", 0.7, "bold"))
    parts.append(txt(0.8, 2.0, "Top down, true scale. Grid lines are the 2 m terminal grid. Blue dashed boxes are footprints.", 0.36, fill=MUTE))

    # section 1 check in
    parts.append(txt(0.8, 3.4, "1  Check in desk, three levels", 0.5, "bold"))
    parts.append(panel(0.8, 3.8, 18.4, 6.4))
    desks = [("checkIn.l1", 2.0, "Level 1", "2 x 2 m, 1 cell"),
             ("checkIn.l2", 6.0, "Level 2", "3 x 2 m, 1.5 cells"),
             ("checkIn.l3", 12.0, "Level 3", "4 x 2 m, 2 x 1 cells")]
    ytop = 6.2
    for aid, x0, l1, l2 in desks:
        parts.append('<rect x="%s" y="%s" width="2" height="2" fill="none" stroke="#8f99a5" stroke-width="0.03" stroke-dasharray="0.1 0.08"/>' % (fmt(x0), fmt(ytop - 2)))
        parts.append(txt(x0 + 1.0, ytop - 0.85, "ramp cell", 0.3, fill=MUTE, anchor="middle"))
        parts.append(footprint(x0, ytop, A_[aid]["size"][0], 2.0))
        parts.append(place(aid, A_[aid], defs, x0, ytop))
        parts.append(txt(x0, ytop + 3.0, l1, 0.4, "bold"))
        parts.append(txt(x0, ytop + 3.55, l2, 0.34, fill=MUTE))

    # section 2 security L1
    parts.append(txt(0.8, 11.0, "2  Security checkpoint, level 1, basic lane for a small airport", 0.5, "bold"))
    parts.append(panel(0.8, 11.4, 18.4, 10.2))
    lx, ly = 2.0, 12.6
    parts.append(txt(lx, ly - 0.35, "16 x 4 m, 8 x 2 cells, flow runs left to right", 0.34, fill=MUTE))
    parts.append(footprint(lx, ly, 16, 4))
    parts.append(place("securityLane.l1", A_["securityLane.l1"], defs, lx, ly))
    callouts = [(1, 1.2, 3.5), (2, 2.85, 2.2), (3, 5.9, 1.2), (4, 9.1, 2.05), (5, 8.1, 3.8),
                (6, 10.1, 3.5), (7, 12.4, 1.2), (8, 14.6, 3.4)]
    cy = ly + 4.9
    for n, cx, top in callouts:
        parts.append('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="#8f99a5" stroke-width="0.025"/>' % (fmt(lx + cx), fmt(cy - 0.28), fmt(lx + cx), fmt(ly + top)))
        parts.append('<circle cx="%s" cy="%s" r="0.28" fill="#ffffff" stroke="#2f6fd1" stroke-width="0.04"/>' % (fmt(lx + cx), fmt(cy)))
        parts.append(txt(lx + cx, cy + 0.12, str(n), 0.34, "bold", anchor="middle"))
    legend = ["1  Wait line and two stanchion posts", "2  ID check podium", "3  Tray table with trays", "4  Single view x ray, operator stand",
              "5  Walk through detector", "6  Hand search mat", "7  Reclaim table, gravity rollers", "8  Re dress bench and bin"]
    for i, s in enumerate(legend):
        col, row = divmod(i, 4)
        parts.append(txt(2.0 + col * 8.2, cy + 1.45 + row * 0.7, s, 0.36))

    # section 3 doors
    parts.append(txt(0.8, 23.2, "3  Doors, small medium large", 0.5, "bold"))
    parts.append(panel(0.8, 23.6, 18.4, 7.0))
    wy = 25.0
    for aid, x0, w, l1, l2 in [("door.s", 2.0, 2.0, "Small", "1.0 m, single leaf"),
                               ("door.m", 8.0, 2.0, "Medium", "2.0 m, double leaf"),
                               ("door.l", 14.0, 4.0, "Large", "4.0 m, sliding, 2 cells")]:
        parts.append(wall_ctx(x0 - 1.0, wy, 1.0))
        parts.append(wall_ctx(x0 + w, wy, 1.0))
        parts.append(footprint(x0, wy, w, 0.6))
        parts.append(place(aid, A_[aid], defs, x0, wy))
        parts.append(txt(x0, wy + 3.0, l1, 0.4, "bold"))
        parts.append(txt(x0, wy + 3.55, l2, 0.34, fill=MUTE))
    parts.append(txt(2.0, wy + 4.95, "Swing arcs are floor clearance. They are drawn outside the footprint on purpose.", 0.32, fill=MUTE))

    # section 4 windows
    parts.append(txt(0.8, 32.3, "4  Windows, small medium large", 0.5, "bold"))
    parts.append(panel(0.8, 32.7, 18.4, 5.4))
    wy = 33.9
    for aid, x0, w, l1, l2 in [("window.s", 2.0, 2.0, "Small", "1.0 m glazing"),
                               ("window.m", 8.0, 2.0, "Medium", "2.0 m, two lites"),
                               ("window.l", 14.0, 4.0, "Large", "4.0 m, four lites")]:
        parts.append(wall_ctx(x0 - 1.0, wy, 1.0))
        parts.append(wall_ctx(x0 + w, wy, 1.0))
        parts.append(footprint(x0, wy, w, 0.6))
        parts.append(place(aid, A_[aid], defs, x0, wy))
        parts.append(txt(x0, wy + 1.6, l1, 0.4, "bold"))
        parts.append(txt(x0, wy + 2.15, l2, 0.34, fill=MUTE))
    H = 38.6
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" width="%d" height="%d">%s%s</svg>'
           % (fmt(W_SHEET), fmt(H), round(W_SHEET * 56), round(H * 56), defs.svg(), "".join(parts)))
    return svg


# ---------------------------------------------------------------- catalog
def catalog():
    base = {"category": "processing", "grid": "cell", "mount": "floor", "zones": [1], "generator": "gen_rev6_assets.py"}
    ci = lambda lvl, name, size, cells, t, conf: dict(base, id="checkIn.l%d" % lvl, name=name, family="checkIn", level=lvl,
        size=size, cells=cells, ramps=[{"cell": [0, -1], "dir": "out"}],
        service={"agent": [0.3, 0.4], "passenger": [1.0, 1.85]},
        stats={"serviceSeconds": t, "agents": 1}, confirm=conf, gameKey="checkIn")
    cat = [
        ci(1, "Check in desk, level 1", [2, 2], [1, 1], 120, []),
        ci(2, "Check in desk, level 2", [3, 2], [1.5, 1], 105, ["serviceSeconds", "footprint snap"]),
        ci(3, "Check in desk, level 3", [4, 2], [2, 1], 95, ["serviceSeconds", "premium class rule"]),
        dict(base, id="securityLane.l1", name="Security checkpoint, level 1", family="securityLane", level=1,
             size=[16, 4], cells=[8, 2], ramps=[], zones=[1, 3], stats={"secondsPerPassenger": 12, "officers": 4},
             confirm=["officers"], gameKey="securityLane", note="Simplified, same footprint as levels 2 and 3"),
    ]
    op = lambda i, n, size, span, nominal, clear, swing, kind: {
        "id": i, "name": n, "category": "openings", "family": kind, "level": None, "size": size, "grid": "edge", "mount": "edge",
        "edgeSpan": span, "nominalOpeningM": nominal, "clearM": clear, "swingRadiusM": swing,
        "walkable": kind == "door", "zones": "any", "generator": "gen_rev6_assets.py"}
    cat += [
        op("door.s", "Door, small", [2, 0.6], 1, 1.0, 0.9, 0.9, "door"),
        op("door.m", "Door, medium", [2, 0.6], 1, 2.0, 1.88, 0.91, "door"),
        op("door.l", "Door, large", [4, 0.6], 2, 4.0, 3.2, 0, "door"),
        op("window.s", "Window, small", [2, 0.6], 1, 1.0, 0, 0, "window"),
        op("window.m", "Window, medium", [2, 0.6], 1, 2.0, 0, 0, "window"),
        op("window.l", "Window, large", [4, 0.6], 2, 4.0, 0, 0, "window"),
    ]
    return cat


def main():
    for d in ("ops", "svg"):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    for aid, name, asset in ASSETS:
        fn = aid.replace(".", "_").lower()
        with open(os.path.join(OUT, "ops", fn + ".json"), "w") as f:
            json.dump({"id": aid, "name": name, "size": asset["size"], "ops": asset["ops"]}, f, indent=1)
        with open(os.path.join(OUT, "svg", fn + ".svg"), "w") as f:
            f.write(standalone_svg(aid, name, asset))
    with open(os.path.join(OUT, "catalog_rev6.json"), "w") as f:
        json.dump(catalog(), f, indent=1)
    with open(os.path.join(OUT, "sheet_rev6.svg"), "w") as f:
        f.write(build_sheet(ASSETS))
    print("ok", len(ASSETS))


if __name__ == "__main__":
    main()
