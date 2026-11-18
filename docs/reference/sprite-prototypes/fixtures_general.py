"""General terminal fixtures: seating, lounge furniture, toilets, decoration, vending, screens and other airport items.

Same frame as fixtures_processing: meters, top left at (0, 0), front (the side people use) at the bottom edge.
Wall mounted items have their back on the top edge. Overhead items (ceiling screens, hoods, overhead signs) are drawn
in the overhead pass: translucent with a dashed edge, so people and fixtures under them stay readable.
"""
import math
from lib import fmt
from fixture_core import (D, C, FX_OUT, soft, lit, dome, screen_grad, glow_grad, water_grad, shade, mix, monitor,
                          office_chair, keyboard, stool, suitcase, status_light, rollers, floor_mark_feet)


# ----------------------------------------------------------------------------------------------------------------
# Shared parts
# ----------------------------------------------------------------------------------------------------------------

def leaves(d, cx, cy, r, n=9, col=None, ht=1.0, rot0=0, w=0.38):
    """A top down plant canopy: rotated leaf ellipses in two greens with a soft dome under them."""
    col = col or C["leaf"]
    d.C(cx, cy, r * 0.8, dome(shade(col, -0.1)), ht, st=None)
    for k in range(n):
        a = rot0 + 360 * k / n
        ra = math.radians(a)
        lx, ly = cx + r * 0.52 * math.cos(ra), cy + r * 0.52 * math.sin(ra)
        d.E(lx, ly, r * 0.5, r * w * 0.5 + 0.02, soft(C["leafLt"] if k % 2 else col, "v"), st=None, rot=a)
        d.L(lx - r * 0.42 * math.cos(ra), ly - r * 0.42 * math.sin(ra), lx + r * 0.42 * math.cos(ra),
            ly + r * 0.42 * math.sin(ra), shade(col, -0.25), 0.5)
    d.C(cx, cy, r * 0.22, dome(C["leafLt"]), st=None)


def frond(d, cx, cy, ang, L, col):
    ra = math.radians(ang)
    ex, ey = cx + L * math.cos(ra), cy + L * math.sin(ra)
    nx, ny = -math.sin(ra), math.cos(ra)
    pts = []
    for k in range(9):
        t = k / 8
        wd = 0.16 * math.sin(math.pi * min(1, t * 1.15)) + 0.01
        pts.append((cx + (ex - cx) * t + nx * wd, cy + (ey - cy) * t + ny * wd))
    for k in range(8, -1, -1):
        t = k / 8
        wd = 0.16 * math.sin(math.pi * min(1, t * 1.15)) + 0.01
        pts.append((cx + (ex - cx) * t - nx * wd, cy + (ey - cy) * t - ny * wd))
    d.P(pts, col, st=shade(col, -0.25), sw=d.dw)
    for k in range(1, 8):
        t = k / 8
        px_, py_ = cx + (ex - cx) * t, cy + (ey - cy) * t
        wd = 0.15 * math.sin(math.pi * min(1, t * 1.15))
        d.L(px_ - nx * wd, py_ - ny * wd, px_ + nx * wd, py_ + ny * wd, shade(col, -0.2), 0.5)
    d.L(cx, cy, ex, ey, shade(col, -0.3), 0.7)


def cushion(d, x, y, w, h, col, ht, rx=0.07, axis="h"):
    d.R(x, y, w, h, soft(col, axis), ht, rx=rx)
    d.R(x, y, w, h, "url(#pWeave)", st=None, rx=rx)


def wall_strip(d, w, t=0.2):
    """Context wall for wall mounted items (not part of the sprite)."""
    d.R(0, -t, w, t, C["wall"], st=None)


# ================================================================================================================
# Seating
# ================================================================================================================

def bench_beam(d, seats=3, col="#9aa6b4", y0=0.0, flip=False):
    """Perforated steel beam seating, 0.63 m pitch, 0.68 m deep. Back at the top unless flip."""
    w = seats * 0.63 + 0.04
    yb, yp0, yp1 = (y0 + 0.56, y0 + 0.06, y0 + 0.54) if flip else (y0 + 0.04, y0 + 0.14, y0 + 0.62)
    d.R(0.0, y0 + (0.6 if flip else 0.0), w, 0.08, lit(C["steelDk"]), 0.5, rx=0.02)       # beam
    for i in range(seats):
        x = 0.04 + i * 0.63
        d.R(x, yp0, 0.55, yp1 - yp0, soft(col, "h"), 0.8, rx=0.08)
        d.R(x, yp0, 0.55, yp1 - yp0, "url(#pPerf)", st=None, rx=0.08)
        by = y0 + (0.5 if flip else 0.02)
        d.R(x + 0.02, by, 0.51, 0.14, soft(shade(col, -0.12), "h"), 0.95, rx=0.06)
    for i in range(seats + 1):
        x = i * 0.63 - 0.005
        d.R(x, yp0 + 0.08, 0.05, 0.36, "#4b5565", 0.7, st=None, rx=0.02)


def bench_b2b(d, seats=3, col="#9aa6b4"):
    bench_beam(d, seats, col, 0.0, False)
    bench_beam(d, seats, col, 0.68, True)


def bench_charge(d, col="#9aa6b4"):
    bench_beam(d, 4, col)
    x = 2.62
    d.R(x, 0.08, 0.52, 0.56, lit("#e9edf1"), 0.7, rx=0.05)
    d.R(x + 0.05, 0.13, 0.42, 0.46, lit(C["walnut"]), st=None, rx=0.03)
    for k in range(4):
        cx, cy = x + 0.15 + (k % 2) * 0.22, 0.24 + (k // 2) * 0.22
        d.R(cx - 0.05, cy - 0.03, 0.1, 0.06, "#1d2430", st=None, rx=0.01)
        d.C(cx + 0.07, cy, 0.012, C["ok"], st=None)


def bench_padded(d, seats=3, col=None):
    col = col or C["teal"]
    w = seats * 0.65 + 0.16
    d.R(0, 0, w, 0.72, lit("#c8ced5"), 0.4, rx=0.06)
    cushion(d, 0.06, 0.02, w - 0.12, 0.18, shade(col, -0.1), 1.0, 0.07)
    for i in range(seats):
        cushion(d, 0.08 + i * 0.65, 0.2, 0.62, 0.48, col, 0.48, 0.08)
    for i in range(seats + 1):
        d.R(0.02 + i * 0.65 - 0.0, 0.22, 0.06, 0.44, C["chrome"], 0.68, rx=0.03, sw=d.dw)


def bench_wood(d, L=1.9):
    for x in (0.08, L - 0.2):
        d.R(x, -0.0, 0.12, 0.48, lit("#59616d"), 0.44, rx=0.02, st=None)
    for k in range(5):
        y = 0.02 + k * 0.092
        d.R(0.0, y, L, 0.078, soft(C["oak"], "v"), 0.45, rx=0.02, sw=d.dw)


# ================================================================================================================
# Lounge furniture
# ================================================================================================================

def sofa(d, seats=3, col=None):
    col = col or C["navy"]
    w = seats * 0.6 + 0.4
    d.R(0, 0, w, 0.92, shade(col, -0.18), 0.4, rx=0.08)
    cushion(d, 0.04, 0.02, w - 0.08, 0.26, shade(col, -0.06), 0.85, 0.1)
    for sx in (0.02, w - 0.22):
        cushion(d, sx, 0.08, 0.2, 0.82, shade(col, -0.04), 0.65, 0.08, "v")
    for i in range(seats):
        cushion(d, 0.22 + i * 0.6, 0.28, 0.58, 0.6, col, 0.45, 0.08, "v")
    d.R(0.3, 0.2, 0.3, 0.22, soft(C["mustard"], "h"), 0.7, rx=0.06)
    d.R(w - 0.62, 0.2, 0.3, 0.22, soft(C["cream"], "h"), 0.7, rx=0.06)


def armchair(d, col=None):
    col = col or C["terracotta"]
    d.R(0, 0, 0.9, 0.9, shade(col, -0.18), 0.4, rx=0.12)
    cushion(d, 0.04, 0.02, 0.82, 0.24, shade(col, -0.06), 0.85, 0.1)
    for sx in (0.02, 0.7):
        cushion(d, sx, 0.08, 0.18, 0.78, shade(col, -0.04), 0.65, 0.08, "v")
    cushion(d, 0.2, 0.26, 0.5, 0.58, col, 0.45, 0.08, "v")


def coffee_table(d, w=1.2, h=0.6):
    d.R(0, 0, w, h, soft(C["walnut"], "h"), 0.42, rx=0.05)
    d.R(0.04, 0.04, w - 0.08, h - 0.08, lit(shade(C["walnut"], 0.12)), st=None, rx=0.03)
    d.R(0.18, 0.14, 0.34, 0.24, "#e9edf1", 0.44, rx=0.01, sw=d.dw)
    d.R(0.22, 0.17, 0.26, 0.06, C["red"], st=None)
    d.C(w - 0.3, h / 2, 0.06, "#f4f6f8", 0.5, sw=d.dw)
    d.C(w - 0.3, h / 2, 0.04, "#6e4a33", st=None)


def end_table_lamp(d):
    d.C(0.25, 0.25, 0.25, dome(C["walnut"]), 0.55)
    d.C(0.25, 0.25, 0.22, "#ffe9a8", st=None, op=0.35)
    d.C(0.25, 0.25, 0.16, dome("#f5ecd8"), 1.1, sw=d.dw)
    d.C(0.25, 0.25, 0.05, "#fff6d0", st=None)


def dining_set(d):
    for cx, cy, rot in ((0.62, 0.22, 0), (1.38, 0.22, 0), (0.62, 1.78, 180), (1.38, 1.78, 180)):
        d.R(cx - 0.22, cy - 0.2, 0.44, 0.4, soft("#59616d", "h"), 0.45, rx=0.08)
        by = cy - 0.2 if rot == 0 else cy + 0.13
        d.R(cx - 0.22, by, 0.44, 0.07, "#3a414b", 0.85, st=None, rx=0.03)
    d.R(0.4, 0.5, 1.2, 1.0, soft(C["oak"], "h"), 0.75, rx=0.06)
    d.R(0.46, 0.56, 1.08, 0.88, "none", st=shade(C["oak"], -0.15), sw=d.dw, rx=0.04)
    for cx, cy in ((0.72, 0.72), (1.28, 0.72), (0.72, 1.28), (1.28, 1.28)):
        d.C(cx, cy, 0.11, "#f6f7f9", 0.78, sw=d.dw)
        d.C(cx, cy, 0.06, "#e3e7eb", st=None)
    d.C(1.0, 1.0, 0.06, dome("#9fd3f2"), 0.9, sw=d.dw)


def bar_counter(d, stools=4):
    w = 3.0
    d.R(0, 0, w, 0.24, lit("#59616d"), 1.6, rx=0.03)                                # back shelf
    for k in range(10):
        d.C(0.2 + k * 0.29, 0.12, 0.05, ["#2f7f86", "#c8102e", "#d4a23a", "#7a4f7f"][k % 4], 1.9, sw=d.dw)
    d.R(0, 0.5, w, 0.62, soft(C["walnut"], "v"), 1.05, rx=0.05)
    d.R(0.04, 0.54, w - 0.08, 0.5, lit(C["stone"]), st=None, rx=0.03)
    for k in range(stools):
        stool(d, 0.45 + k * (w - 0.9) / (stools - 1), 1.32, "#3a414b", 0.18)


def tv_credenza(d):
    d.R(0, 0.1, 2.0, 0.45, soft(C["walnut"], "v"), 0.6, rx=0.03)
    for k in range(1, 4):
        d.L(k * 0.5, 0.14, k * 0.5, 0.51, shade(C["walnut"], -0.25), 0.6)
    d.R(0.7, 0.24, 0.6, 0.08, "#3a414b", 0.65, rx=0.02, sw=d.dw)                     # stand foot
    d.R(0.2, 0.3, 1.6, 0.06, "#141c26", 1.6, rx=0.01, sw=d.dw)                       # 70 inch TV
    d.L(0.22, 0.36, 1.78, 0.36, C["glow"], 1.6)
    d.C(1.86, 0.32, 0.07, dome("#ece3d0"), 0.9, sw=d.dw)


def cupboard(d, w=1.6):
    d.R(0, 0, w, 0.55, soft("#e9e4da", "v"), 2.0, rx=0.03)
    n = int(round(w / 0.4))
    for k in range(1, n):
        d.L(k * w / n, 0.03, k * w / n, 0.52, "#b9b1a2", 0.7)
    for k in range(n):
        x = (k + 0.5) * w / n + (0.12 if k % 2 == 0 else -0.12)
        d.R(x - 0.015, 0.44, 0.03, 0.08, "#8c96a2", st=None)
    d.L(0.02, 0.53, w - 0.02, 0.53, "#c9c1b2", 1.2)


def bookshelf(d, w=1.2):
    d.R(0, 0, w, 0.35, lit(C["oak"]), 1.8, rx=0.02)
    x = 0.05
    cols = ["#c8102e", "#2f4a6e", "#d4a23a", "#2f7f86", "#7a4f7f", "#ece3d0", "#59616d"]
    k = 0
    while x < w - 0.08:
        bw = 0.04 + (k * 37 % 5) * 0.012
        d.R(x, 0.05, bw, 0.24 - (k % 3) * 0.03, cols[k % len(cols)], st=None)
        x += bw + 0.008
        k += 1


def rug(d, w=2.4, h=1.7, col=None):
    col = col or "#b75a3c"
    d.R(0, 0, w, h, col, st=None, rx=0.03)
    d.R(0.1, 0.1, w - 0.2, h - 0.2, "none", st=C["cream"], sw=0.04)
    d.R(0.22, 0.22, w - 0.44, h - 0.44, shade(col, -0.12), st=None)
    cx, cy = w / 2, h / 2
    d.P([(cx, cy - 0.45), (cx + 0.6, cy), (cx, cy + 0.45), (cx - 0.6, cy)], C["cream"], st=None, op=0.85)
    d.P([(cx, cy - 0.25), (cx + 0.32, cy), (cx, cy + 0.25), (cx - 0.32, cy)], C["navy"], st=None)
    for k in range(int(w / 0.12)):
        d.L(0.06 + k * 0.12, 0.0, 0.06 + k * 0.12, -0.06, C["cream"], 0.6)
        d.L(0.06 + k * 0.12, h, 0.06 + k * 0.12, h + 0.06, C["cream"], 0.6)


def floor_lamp(d):
    d.C(0.22, 0.6, 0.14, dome("#3a414b"), 0.1, sw=d.dw)
    d.A("M0.22,0.6 Q0.22,0.1 0.62,0.2", "none", "#8c96a2", 2.0)
    d.C(0.62, 0.22, 0.3, "#ffe9a8", st=None, op=0.3)
    d.C(0.62, 0.22, 0.18, dome("#f5ecd8"), 1.9, sw=d.dw)
    d.C(0.62, 0.22, 0.05, "#fff6d0", st=None)


def work_desk(d):
    d.R(0, 0, 1.4, 0.62, soft("#f2f2ef", "v"), 0.75, rx=0.03)
    d.R(0.0, 0.0, 1.4, 0.06, "#c9ced4", st=None)
    d.P([(0.42, 0.18), (0.86, 0.18), (0.9, 0.46), (0.38, 0.46)], "#c9ced4", 0.78, sw=d.dw)    # laptop
    d.R(0.46, 0.08, 0.36, 0.1, screen_grad(), 0.95, sw=d.dw)
    d.C(1.18, 0.2, 0.07, dome("#3a414b"), 1.2, sw=d.dw)                                     # task lamp
    d.L(1.18, 0.2, 1.06, 0.38, "#3a414b", 1.2)
    d.C(1.06, 0.38, 0.05, "#fff6d0", st=None)
    d.R(0.12, 0.38, 0.2, 0.14, "#e9edf1", 0.77, rx=0.01, sw=d.dw)
    office_chair(d, 0.66, 0.92, "#2f4a6e", 180)


def recliner(d, col=None):
    col = col or C["charcoal"]
    d.R(0, 0, 0.8, 1.86, shade(col, -0.2), 0.35, rx=0.12)
    cushion(d, 0.06, 0.06, 0.68, 0.5, shade(col, -0.05), 0.95, 0.12, "h")
    cushion(d, 0.06, 0.6, 0.68, 0.6, col, 0.5, 0.08, "h")
    cushion(d, 0.06, 1.24, 0.68, 0.56, shade(col, 0.05), 0.4, 0.1, "h")
    d.R(0.24, 0.06, 0.32, 0.14, soft(C["cream"], "h"), 1.0, rx=0.06)


def buffet(d):
    d.R(0, 0, 2.4, 0.8, soft("#e9e4da", "v"), 0.9, rx=0.04)
    d.R(0.04, 0.04, 2.32, 0.72, lit(C["stone"]), st=None, rx=0.03)
    foods = ["#e3b04b", "#7fae5a", "#c9603e", "#f3e3b8", "#b5452f", "#e9d27a"]
    for k in range(6):
        x = 0.12 + (k % 3) * 0.75
        y = 0.12 + (k // 3) * 0.3
        d.R(x, y, 0.66, 0.26, lit(C["steel"]), 0.95, rx=0.02, sw=d.dw)
        d.R(x + 0.04, y + 0.04, 0.58, 0.18, foods[k], st=None, rx=0.03)
    d.R(0.06, 0.7, 2.28, 0.05, C["glass"], 1.3, st=C["glassEdge"], sw=d.dw)            # sneeze guard


def coffee_station(d):
    d.R(0, 0, 1.6, 0.6, soft("#e9e4da", "v"), 0.9, rx=0.03)
    d.R(0.08, 0.06, 0.56, 0.4, soft("#2a313b", "h"), 1.45, rx=0.05)
    d.R(0.14, 0.1, 0.44, 0.08, "#c0c7cf", st=None, rx=0.02)
    for k in range(2):
        d.C(0.24 + k * 0.24, 0.32, 0.04, "#141c26", st=None)
    for k in range(5):
        d.C(0.86 + (k % 3) * 0.16, 0.18 + (k // 3) * 0.18, 0.06, dome("#f6f7f9"), 1.0, sw=d.dw)
        d.C(0.86 + (k % 3) * 0.16, 0.18 + (k // 3) * 0.18, 0.035, "#6e4a33", st=None)
    d.R(1.34, 0.12, 0.18, 0.36, lit(C["steel"]), 1.05, rx=0.02, sw=d.dw)


# ================================================================================================================
# Toilet room
# ================================================================================================================

def wc_pan(d, cx, y, rot=0):
    """Wall hung toilet, cistern panel at y (the wall), bowl toward +y."""
    d.R(cx - 0.22, y, 0.44, 0.16, lit("#f2f4f6"), 1.1, rx=0.03)
    d.R(cx - 0.08, y + 0.03, 0.16, 0.08, C["chrome"], st=None, rx=0.02)                 # flush plate
    d.E(cx, y + 0.42, 0.19, 0.27, dome(C["porcelain"]), 0.42)
    d.E(cx, y + 0.44, 0.13, 0.19, "#dfe9ef", st="#c3d1db", sw=d.dw)
    d.E(cx, y + 0.44, 0.17, 0.24, "none", st="#b8c4ce", sw=0.02)


def wc_stall(d, door_open=False):
    d.R(0, 0, 0.04, 1.6, lit("#c9d3dc", "h"), 2.0, st=None)
    d.R(0.96, 0, 0.04, 1.6, lit("#c9d3dc", "h"), 2.0, st=None)
    wc_pan(d, 0.5, 0.0)
    d.R(0.82, 0.48, 0.12, 0.1, C["chrome"], 0.9, rx=0.02, sw=d.dw)                     # paper holder
    d.C(0.88, 0.53, 0.04, "#ffffff", st=None)
    d.R(0.06, 0.36, 0.14, 0.12, "#e9edf1", 0.5, rx=0.02, sw=d.dw)                        # sanitary bin
    if door_open:
        d.R(0.04, 1.56, 0.06, 0.66, lit("#c9d3dc", "h"), 2.0, st=None)
    else:
        d.R(0.04, 1.54, 0.92, 0.06, lit("#c9d3dc", "v"), 2.0, st=None)
        d.C(0.84, 1.57, 0.02, C["ok"], st=None)
    if not door_open:
        d.A("M0.9,1.57 A0.86,0.86 0 0 0 0.04,0.71", "none", "#8f99a5", 0.7, extra='stroke-dasharray="0.05 0.04"')


def wc_accessible(d):
    d.R(0.0, 0.0, 2.2, 0.08, C["wall"], st=None)
    d.C(1.1, 1.2, 0.75, "none", st="#5fa8d3", sw=0.02)                                   # turning circle
    d.R(0.0, 0.0, 2.2, 2.2, "none", st="#9aa3ad", sw=0.015)
    wc_pan(d, 0.5, 0.08)
    d.R(0.06, 0.24, 0.05, 0.7, C["chrome"], 0.8, st=None, rx=0.02)                        # wall grab bar
    d.R(0.82, 0.3, 0.05, 0.62, C["chrome"], 0.8, st=None, rx=0.02)                        # fold down bar
    d.R(1.52, 0.08, 0.56, 0.44, lit("#f2f4f6"), 0.8, rx=0.06)
    d.E(1.8, 0.3, 0.18, 0.13, "#dfe9ef", st="#b8c4ce", sw=d.dw)
    d.R(1.77, 0.1, 0.06, 0.1, C["chrome"], st=None)
    d.R(1.5, 0.08, 0.6, 0.03, C["glass"], st=None)
    d.R(0.08, 1.05, 0.16, 0.12, C["red"], 0.9, rx=0.02, sw=d.dw)                          # alarm pull
    d.L(0.16, 1.17, 0.16, 1.5, C["red"], 0.8)


def urinals(d, n=3):
    w = n * 0.8
    for i in range(n):
        cx = 0.4 + i * 0.8
        d.R(cx - 0.18, 0.0, 0.36, 0.1, lit("#f2f4f6"), 1.2, rx=0.02, sw=d.dw)
        d.E(cx, 0.2, 0.17, 0.2, dome(C["porcelain"]), 0.65)
        d.E(cx, 0.22, 0.1, 0.12, "#dfe9ef", st="#c3d1db", sw=d.dw)
        d.C(cx, 0.05, 0.025, "#1d2430", st=None)                                          # sensor
    for i in range(1, n):
        d.R(i * 0.8 - 0.02, 0.0, 0.04, 0.5, lit("#c9d3dc", "h"), 1.6, st=None)


def vanity(d, n=3):
    w = n * 0.8
    d.R(0, 0, w, 0.04, C["glass"], st=None)
    d.R(0, 0.04, w, 0.56, soft(C["stone"], "v"), 0.9, rx=0.04)
    for i in range(n):
        cx = 0.4 + i * 0.8
        d.E(cx, 0.34, 0.22, 0.15, lit("#e9eef2"), st="#b8c4ce", sw=d.dw)
        d.C(cx, 0.38, 0.025, "#9aa3ad", st=None)
        d.R(cx - 0.025, 0.1, 0.05, 0.12, C["chrome"], 1.05, st=None, rx=0.02)
        d.R(cx + 0.24, 0.1, 0.07, 0.07, "#f6f7f9", 1.0, rx=0.02, sw=d.dw)


def sink_single(d):
    d.R(0, 0, 0.6, 0.48, dome(C["porcelain"]), 0.85, rx=0.1)
    d.E(0.3, 0.27, 0.2, 0.14, lit("#e9eef2"), st="#b8c4ce", sw=d.dw)
    d.C(0.3, 0.3, 0.022, "#9aa3ad", st=None)
    d.R(0.275, 0.04, 0.05, 0.11, C["chrome"], 1.0, st=None, rx=0.02)


def hand_dryer(d):
    d.R(0.0, 0.0, 0.32, 0.22, soft("#d9dee4", "h"), 1.3, rx=0.06)
    d.R(0.04, 0.14, 0.24, 0.05, "#1d2430", st=None, rx=0.02)
    d.C(0.16, 0.07, 0.02, C["glow"], st=None)


def towel_dispenser(d):
    d.R(0.0, 0.0, 0.34, 0.14, soft(C["chrome"], "h"), 1.3, rx=0.02)
    d.L(0.06, 0.13, 0.28, 0.13, "#ffffff", 1.6)
    d.C(0.17, 0.42, 0.2, dome("#9aa3ad"), 0.75, sw=d.dw)
    d.C(0.17, 0.42, 0.13, "#2a313b", st=None)


def trash_round(d, col="#9aa3ad"):
    d.C(0.21, 0.21, 0.21, dome(col), 0.8)
    d.C(0.21, 0.21, 0.14, "#2a313b", st=None)
    d.C(0.21, 0.21, 0.14, "none", st=shade(col, -0.25), sw=0.015)


def trash_recycle(d):
    d.R(0, 0, 1.2, 0.44, lit("#d9dee4"), 0.95, rx=0.04)
    for k, col in enumerate(("#2f6fd1", "#3ea35a", "#59616d")):
        x = 0.06 + k * 0.38
        d.R(x, 0.06, 0.32, 0.32, col, st=None, rx=0.04)
        d.C(x + 0.16, 0.22, 0.08, "#1d2430", st=None)
        d.R(x + 0.04, 0.33, 0.24, 0.03, "#ffffff", st=None, op=0.7)


def baby_change(d):
    d.R(0, 0, 0.9, 0.56, soft("#f2f4f6", "h"), 0.9, rx=0.05)
    d.R(0.08, 0.08, 0.74, 0.4, soft("#9fd3f2", "h"), st="#5fa8d3", sw=d.dw, rx=0.08)
    d.L(0.1, 0.5, 0.8, 0.5, "#c3cad2", 1.2)


def janitor_cart(d):
    d.R(0, 0, 0.95, 0.55, lit("#59616d"), 0.9, rx=0.05)
    d.C(0.26, 0.28, 0.2, dome(C["hazard"]), 0.6, sw=d.dw)
    d.C(0.26, 0.28, 0.14, "#7cc3e0", st=None)
    d.R(0.52, 0.08, 0.36, 0.4, "#3a414b", 0.95, rx=0.03, sw=d.dw)
    d.L(0.26, 0.28, 0.12, 0.02, "#b98a5a", 2.0)
    d.C(0.12, 0.02, 0.05, "#e9edf1", st=None)


# ================================================================================================================
# Decoration
# ================================================================================================================

def pot(d, cx, cy, r, col=None, ht=0.6):
    col = col or C["pot"]
    d.C(cx, cy, r, dome(col), ht)
    d.C(cx, cy, r - 0.05, C["soil"], st=None)


def planter_small(d):
    pot(d, 0.35, 0.35, 0.3, "#d9d4c8", 0.5)
    leaves(d, 0.35, 0.35, 0.32, 8, ht=1.0)


def planter_large(d):
    pot(d, 0.8, 0.8, 0.62, "#c9c2b3", 0.55)
    leaves(d, 0.8, 0.8, 0.66, 12, ht=1.4)
    leaves(d, 0.8, 0.8, 0.4, 7, C["leafDk"], 1.6, rot0=20)


def planter_trough(d, w=2.0):
    d.R(0, 0, w, 0.6, soft("#bfb8a8", "v"), 0.55, rx=0.05)
    d.R(0.06, 0.06, w - 0.12, 0.48, C["soil"], st=None, rx=0.03)
    k = 0
    x = 0.25
    while x < w - 0.2:
        leaves(d, x, 0.3, 0.2 + 0.04 * (k % 2), 7, C["leaf"] if k % 2 else C["leafDk"], 0.9, rot0=k * 17)
        x += 0.38
        k += 1


def palm(d):
    pot(d, 1.0, 1.0, 0.36, "#d9d4c8", 0.6)
    for k in range(9):
        a = k * 40 + 10
        frond(d, 1.0, 1.0, a, 0.9 + 0.08 * (k % 2), C["leaf"] if k % 2 else C["leafLt"])
    d.C(1.0, 1.0, 0.1, dome("#8a6a48"), 2.4, st=None)


def tree_bench(d):
    r = 1.8
    cx = cy = 1.8
    d.C(cx, cy, r, soft(C["oak"], "h"), 0.45)
    for k in range(24):
        a = math.radians(k * 15)
        d.L(cx + 1.15 * math.cos(a), cy + 1.15 * math.sin(a), cx + 1.78 * math.cos(a), cy + 1.78 * math.sin(a),
            shade(C["oak"], -0.2), 0.6)
    d.C(cx, cy, 1.12, dome("#bfb8a8"), 0.55)
    d.C(cx, cy, 1.04, C["soil"], st=None)
    leaves(d, cx, cy, 1.0, 14, C["leafDk"], 3.0)
    leaves(d, cx, cy, 0.62, 9, C["leaf"], 3.2, rot0=15)


def bamboo(d, w=2.4):
    d.R(0, 0, w, 0.5, soft("#bfb8a8", "v"), 0.5, rx=0.04)
    d.R(0.05, 0.05, w - 0.1, 0.4, "#d8d0bf", st=None)
    k = 0
    x = 0.18
    while x < w - 0.12:
        y = 0.15 + 0.2 * (k % 2)
        d.C(x, y, 0.045, dome("#9db86a"), 2.6, sw=d.dw)
        for j in range(3):
            a = k * 53 + j * 120
            ra = math.radians(a)
            d.E(x + 0.13 * math.cos(ra), y + 0.13 * math.sin(ra), 0.13, 0.03, C["leafLt"], st=None, rot=a)
        x += 0.2
        k += 1


def sculpture(d):
    d.R(0, 0, 1.6, 1.6, soft("#d9d4c8", "h"), 0.4, rx=0.04)
    d.R(0.08, 0.08, 1.44, 1.44, lit("#e6e2d8"), st=None, rx=0.02)
    for k, (rx, ry, rot) in enumerate(((0.5, 0.22, 30), (0.5, 0.22, 90), (0.5, 0.22, 150))):
        d.E(0.8, 0.8, rx, ry, "none", ht=1.8 + k * 0.2, st="#7c8794", sw=0.07, rot=rot)
        d.E(0.8, 0.8, rx, ry, "none", st="#d2d8de", sw=0.03, rot=rot)
    d.C(0.8, 0.8, 0.12, dome(C["mustard"]), 2.4, sw=d.dw)


def fountain(d):
    d.C(1.2, 1.2, 1.2, soft("#d9d4c8", "h"), 0.45)
    d.C(1.2, 1.2, 1.06, water_grad(), st="#8fb7c9", sw=d.dw)
    for r in (0.3, 0.55, 0.8):
        d.C(1.2, 1.2, r, "none", st="#ffffff", sw=0.015, op=0.5)
    d.C(1.2, 1.2, 0.18, dome("#d9d4c8"), 0.7, sw=d.dw)
    d.C(1.2, 1.2, 0.08, "#ffffff", st=None, op=0.9)


def medallion(d):
    r = 1.5
    d.C(r, r, r, "#d9d0bb", st=None)
    d.C(r, r, r - 0.06, "none", st=C["mustard"], sw=0.05)
    d.C(r, r, r - 0.3, "#2f4a6e", st=None)
    for k in range(16):
        a = math.radians(k * 22.5 - 90)
        L = 1.12 if k % 4 == 0 else (0.82 if k % 2 == 0 else 0.6)
        b1, b2 = math.radians(k * 22.5 - 90 - 8), math.radians(k * 22.5 - 90 + 8)
        pts = [(r + 0.16 * math.cos(b1), r + 0.16 * math.sin(b1)), (r + L * math.cos(a), r + L * math.sin(a)),
               (r + 0.16 * math.cos(b2), r + 0.16 * math.sin(b2))]
        d.P(pts, C["mustard"] if k % 4 == 0 else C["cream"], st=None)
    d.C(r, r, 0.16, C["mustard"], st=None)


def model_case(d, air_svg=""):
    d.R(0, 0, 2.0, 1.3, soft("#d9dee4", "h"), 0.9, rx=0.04)
    d.R(0.05, 0.05, 1.9, 1.2, "#eef3f7", st=None)
    d.aircraft("a320neo", 1.0, 0.65, 1 / 32, 90, air_svg)
    d.R(0.05, 0.05, 1.9, 1.2, C["glass"], st=C["glassEdge"], sw=d.dw, op=0.15)
    d.L(0.1, 0.12, 0.6, 0.12, "#ffffff", 1.4, op=0.8)


# ================================================================================================================
# Vending and service machines
# ================================================================================================================

def vending(d, body, accent, kind="snack"):
    w, h = 1.0, 0.86
    d.R(0, 0, w, h, soft(body, "h"), 1.9, rx=0.04)
    d.R(0.04, 0.04, w - 0.08, 0.52, lit(shade(body, 0.08)), st=None, rx=0.03)
    for k in range(4):
        d.L(0.12, 0.1 + k * 0.05, 0.42, 0.1 + k * 0.05, shade(body, -0.25), 0.6)
    d.R(0.0, 0.6, w, 0.26, shade(body, -0.22), st=None, rx=0.03)
    d.R(0.04, 0.64, 0.7, 0.18, "#cfe8f6", st="#7fb4d3", sw=d.dw)                         # glass front
    prod = {"snack": ["#d4a23a", "#c8102e", "#2f7f86", "#e86a8f", "#7a4f7f", "#f08a24"],
            "drink": ["#2f6fd1", "#3ea35a", "#f08a24", "#c8102e", "#9fd3f2", "#e9d27a"],
            "coffee": ["#6e4a33", "#c9a27a", "#ece3d0", "#6e4a33", "#c9a27a", "#ece3d0"],
            "fresh": ["#7fae5a", "#e3b04b", "#c9603e", "#7fae5a", "#f3e3b8", "#b5452f"],
            "travel": ["#2f4a6e", "#9aa3ad", "#2f7f86", "#e9edf1", "#d4a23a", "#59616d"]}[kind]
    for k in range(12):
        d.R(0.07 + (k % 6) * 0.11, 0.67 + (k // 6) * 0.075, 0.08, 0.055, prod[(k + k // 6) % 6], st=None, rx=0.01)
    d.R(0.78, 0.64, 0.18, 0.18, "#1d2430", st=None, rx=0.02)                              # keypad and pay
    d.R(0.81, 0.67, 0.12, 0.05, C["glow"], st=None)
    for k in range(3):
        d.C(0.82 + k * 0.05, 0.77, 0.012, "#c3cad2", st=None)
    d.P([(0.56, 0.04), (0.96, 0.04), (0.96, 0.3)], accent, st=None, op=0.95)
    if kind == "coffee":
        d.C(0.26, 0.38, 0.11, "#f6f1e8", st=None)
        d.C(0.26, 0.38, 0.07, "#6e4a33", st=None)
    status_light(d, 0.9, 0.5, C["ok"], 0.02)


def water_filler(d):
    d.R(0, 0, 0.5, 0.34, soft(C["chrome"], "h"), 1.2, rx=0.05)
    d.R(0.06, 0.08, 0.38, 0.2, "#9aa3ad", st=None, rx=0.03)
    for k in range(5):
        d.L(0.1 + k * 0.075, 0.1, 0.1 + k * 0.075, 0.26, "#6b737d", 0.6)
    d.R(0.0, 0.0, 0.5, 0.06, "#2f6fd1", st=None, rx=0.02)
    d.C(0.25, 0.14, 0.03, "#2f6fd1", st=None)


def charge_tower(d):
    d.R(0, 0, 0.62, 0.62, soft("#e9edf1", "h"), 1.3, rx=0.1)
    d.C(0.31, 0.31, 0.18, "#1d2430", st=None)
    d.C(0.31, 0.31, 0.12, C["glow"], st=None, op=0.8)
    for k in range(4):
        a = math.radians(45 + k * 90)
        x, y = 0.31 + 0.24 * math.cos(a), 0.31 + 0.24 * math.sin(a)
        d.R(x - 0.04, y - 0.04, 0.08, 0.08, "#2a313b", st=None, rx=0.015)


def atm_pair(d):
    d.R(0, 0, 1.9, 0.82, soft("#59616d", "v"), 2.2, rx=0.04)
    for x in (0.12, 1.0):
        d.R(x, 0.1, 0.78, 0.72, soft("#d9dee4", "h"), 1.5, rx=0.04)
        d.R(x + 0.1, 0.18, 0.58, 0.26, screen_grad(), st="#11161d", sw=d.dw)
        d.L(x + 0.12, 0.44, x + 0.66, 0.44, C["glow"], 1.2)
        d.R(x + 0.12, 0.5, 0.3, 0.2, "#2a313b", st=None, rx=0.02)
        for k in range(9):
            d.C(x + 0.17 + (k % 3) * 0.1, 0.54 + (k // 3) * 0.06, 0.015, "#c3cad2", st=None)
        d.R(x + 0.5, 0.52, 0.16, 0.04, "#141c26", st=None)
        d.R(x + 0.5, 0.62, 0.16, 0.04, "#141c26", st=None)
    d.R(0.0, 0.0, 1.9, 0.08, "#2f6fd1", st=None, rx=0.02)


# ================================================================================================================
# Screens and signs
# ================================================================================================================

def _glow_fan(d, x, y, w, depth):
    d.glow([(x, y), (x + w, y), (x + w + depth * 0.3, y + depth), (x - depth * 0.3, y + depth)])


def fids_bank(d, n=3):
    w = n * 0.8 + 0.2
    _glow_fan(d, 0.1, 0.32, w - 0.2, 0.8)
    for x in (0.25, w - 0.35):
        d.R(x, 0.0, 0.1, 0.3, "#59616d", 0.8, st=None)
        d.C(x + 0.05, 0.08, 0.12, dome("#3a414b"), 0.08, st=None)
    d.R(0.05, 0.18, w - 0.1, 0.06, lit("#3a414b"), 2.4, st=None)
    for k in range(n):
        x = 0.1 + k * 0.8
        d.R(x + 0.02, 0.24, 0.76, 0.08, "#141c26", 2.4, rx=0.01, sw=d.dw)
        d.L(x + 0.05, 0.32, x + 0.75, 0.32, C["glow"], 1.6)


def info_totem(d):
    _glow_fan(d, 0.05, 0.36, 0.5, 0.6)
    d.R(0, 0.0, 0.6, 0.36, soft("#e9edf1", "h"), 2.1, rx=0.06)
    d.R(0.05, 0.3, 0.5, 0.06, "#141c26", st=None)
    d.R(0.05, 0.0, 0.5, 0.06, "#141c26", st=None)
    d.L(0.07, 0.36, 0.53, 0.36, C["glow"], 1.6)
    d.C(0.3, 0.18, 0.07, "#2f6fd1", st=None)
    d.R(0.285, 0.15, 0.03, 0.08, "#ffffff", st=None)


def wall_tv(d):
    _glow_fan(d, 0.05, 0.12, 1.3, 0.6)
    d.R(0, 0, 1.4, 0.1, "#141c26", 1.8, rx=0.01)
    d.L(0.03, 0.1, 1.37, 0.1, C["glow"], 1.6)


def ceiling_fids(d):
    d.overhead(0, 0.0, 3.0, 0.3, "#3a414b")
    d.overhead_path("M0.4,0.15 L0.41,0.15 M2.6,0.15 L2.61,0.15", st="#141c26", spx=4.0)
    d.overhead_path("M0.05,0.3 L2.95,0.3", st=C["glow"], spx=1.6, op=0.9)


def led_wall(d, w=6.0):
    _glow_fan(d, 0.1, 0.4, w - 0.2, 1.2)
    d.R(0, 0, w, 0.4, lit("#3a414b"), 0.3, rx=0.03)
    d.R(0.05, 0.22, w - 0.1, 0.14, "#141c26", 3.2, sw=d.dw)
    cols = ["#2f6fd1", "#5fa8d3", "#d4a23a", "#c8102e", "#3ec46d"]
    for k in range(10):
        d.R(0.1 + k * (w - 0.2) / 10, 0.33, (w - 0.2) / 10 - 0.04, 0.03, cols[k % 5], st=None, op=0.9)


def gate_display(d):
    _glow_fan(d, 0.1, 0.32, 1.0, 0.6)
    d.C(0.6, 0.12, 0.12, dome("#3a414b"), 0.1, st=None)
    d.R(0.55, 0.0, 0.1, 0.24, "#59616d", 2.0, st=None)
    for x in (0.08, 0.62):
        d.R(x, 0.24, 0.5, 0.08, "#141c26", 2.4, rx=0.01, sw=d.dw)
        d.L(x + 0.03, 0.32, x + 0.47, 0.32, C["glow"], 1.6)


def overhead_sign(d, w=3.0):
    d.overhead(0, 0, w, 0.32, "#141c26")
    y = 0.16
    d.overhead_path(f"M0.25,{y} L0.65,{y} M0.48,{y - 0.1} L0.65,{y} L0.48,{y + 0.1}", st="#f2c230", spx=2.4)
    for x0, ww, col in ((0.9, 0.5, "#f2c230"), (1.55, 0.7, "#f2c230"), (2.4, 0.36, "#ffffff")):
        d.overhead_path(f"M{x0},{y - 0.08} L{x0 + ww},{y - 0.08} L{x0 + ww},{y + 0.08} L{x0},{y + 0.08} Z", fill=col)


def ad_totem(d):
    _glow_fan(d, 0.05, 0.42, 0.7, 0.7)
    d.R(0, 0, 0.8, 0.42, soft("#1d2430", "h"), 2.0, rx=0.04)
    d.R(0.05, 0.34, 0.7, 0.08, "#c8102e", st=None)
    d.R(0.05, 0.0, 0.7, 0.08, "#d4a23a", st=None)
    d.L(0.07, 0.42, 0.73, 0.42, "#ffb3c0", 1.6)


# ================================================================================================================
# Other airport items
# ================================================================================================================

def trolley(d, x=0.0, y=0.0, col="#9aa3ad"):
    """Luggage trolley 1.1 by 0.6 m, handle at the left."""
    d.R(x + 0.06, y + 0.02, 0.06, 0.56, "#2a313b", 1.0, st=None, rx=0.03)
    d.R(x + 0.12, y + 0.08, 0.86, 0.44, "none", st=col, sw=0.035, rx=0.03)
    for k in range(5):
        d.L(x + 0.2 + k * 0.17, y + 0.1, x + 0.2 + k * 0.17, y + 0.5, col, 0.8)
    d.R(x + 0.92, y + 0.1, 0.14, 0.4, lit(col), 0.5, rx=0.02, sw=d.dw)
    d._shadow([(x + 0.06, y), (x + 1.06, y), (x + 1.06, y + 0.6), (x + 0.06, y + 0.6)], 0.6)


def trolley_bay(d):
    d.R(0.0, 0.0, 3.4, 0.08, lit("#59616d"), 1.0, st=None)
    d.R(0.0, 0.92, 3.4, 0.08, lit("#59616d"), 1.0, st=None)
    d.R(0.0, 0.0, 0.08, 1.0, "#3a414b", 1.2, st=None)
    for k in range(5):
        trolley(d, 0.12 + k * 0.42, 0.2)
    d.R(3.2, 0.12, 0.16, 0.76, "#2f6fd1", 1.4, rx=0.03, sw=d.dw)                            # coin release


def info_desk(d):
    for x in (0.95, 2.05):
        office_chair(d, x, 0.32, "#3a414b")
    pts = [(0.2, 0.6), (2.8, 0.6), (2.8, 1.3), (1.5, 1.9), (0.2, 1.3)]
    d.A("M0.2,0.6 L2.8,0.6 L2.8,1.25 Q1.5,2.25 0.2,1.25 Z", soft(C["navy"], "h"), FX_OUT, shadow_pts=pts, ht=1.05)
    d.A("M0.28,0.67 L2.72,0.67 L2.72,1.2 Q1.5,2.1 0.28,1.2 Z", lit(C["stone"]), None)
    for x in (0.95, 2.05):
        monitor(d, x, 0.96, 0.34, "up", 1.4)
        keyboard(d, x - 0.17, 0.72, 0.34, 0.1)
    d.C(1.5, 1.42, 0.17, "#2f6fd1", 1.15, sw=d.dw)
    d.R(1.47, 1.4, 0.06, 0.14, "#ffffff", st=None)
    d.C(1.5, 1.34, 0.03, "#ffffff", st=None)


def queue_kit(d, cols=4, rows=3, pitch=1.2, row_gap=1.1, col="#2f4a6e"):
    """Retractable belt posts as a serpentine: outer rows closed, inner rows open at alternating ends."""
    xs = [0.15 + c * pitch for c in range(cols)]
    for r in range(rows):
        y = 0.15 + r * row_gap
        a, b = 0, cols - 1
        if 0 < r < rows - 1:
            if r % 2:
                b -= 1
            else:
                a += 1
        d.L(xs[a], y, xs[b], y, col, 2.0, cap="butt")
    for r in range(rows):
        for x in xs:
            y = 0.15 + r * row_gap
            d.C(x, y, 0.15, "#2a313b", 0.06, st=None, op=0.6)
            d.C(x, y, 0.06, dome("#c3cad2"), 1.0, sw=d.dw)


def rope_posts(d, n=3, pitch=1.4):
    for k in range(n - 1):
        x1, x2 = 0.15 + k * pitch, 0.15 + (k + 1) * pitch
        d.A(f"M{fmt(x1)},0.2 Q{fmt((x1 + x2) / 2)},0.32 {fmt(x2)},0.2", "none", "#a3242b", 3.0)
    for k in range(n):
        x = 0.15 + k * pitch
        d.C(x, 0.2, 0.15, dome("#b8913a"), 0.05, st=None)
        d.C(x, 0.2, 0.06, dome("#e3c069"), 1.0, sw=d.dw)


def wrap_station(d):
    d.C(0.9, 1.1, 0.72, soft("#59616d", "h"), 0.35)
    d.C(0.9, 1.1, 0.62, lit("#c3cad2"), st=None)
    suitcase(d, 0.9, 1.1, "#7a4f7f", 0.5, 0.74, 0.95)
    d.E(0.9, 1.1, 0.5, 0.56, "none", st="#9fd3f2", sw=0.04, op=0.7)
    d.R(1.72, 0.3, 0.2, 1.6, lit("#3a414b", "h"), 1.8, rx=0.04)                             # film mast
    d.C(1.82, 1.1, 0.12, dome("#e9edf1"), 1.2, sw=d.dw)
    d.R(0.1, 0.0, 1.5, 0.3, lit(C["laminate"]), 1.0, rx=0.04)
    monitor(d, 0.5, 0.15, 0.3, "down", 1.3)
    d.R(0.95, 0.06, 0.4, 0.18, "#2a313b", 1.05, rx=0.02, sw=d.dw)


def prayer_mats(d, n=4):
    cols = ["#8c2f39", "#2f6b4f", "#2f4a6e", "#8a5a2b", "#5c3d6e"]
    d.R(0, 0, n * 0.85 + 0.1, 0.42, soft(C["oak"], "v"), 0.9, rx=0.03)                      # shoe rack
    for k in range(n * 2):
        d.R(0.1 + k * 0.42, 0.06, 0.3, 0.12, "#3a414b", st=None, rx=0.03)
        d.R(0.1 + k * 0.42, 0.24, 0.3, 0.12, "#59616d", st=None, rx=0.03)
    for k in range(n):
        x = 0.1 + k * 0.85
        col = cols[k % len(cols)]
        d.R(x, 0.75, 0.7, 1.2, col, st=None, rx=0.02)
        d.R(x + 0.05, 0.8, 0.6, 1.1, "none", st=C["mustard"], sw=0.02)
        d.A(f"M{fmt(x + 0.15)},1.08 Q{fmt(x + 0.35)},0.86 {fmt(x + 0.55)},1.08 L{fmt(x + 0.55)},1.8 "
            f"L{fmt(x + 0.15)},1.8 Z", shade(col, 0.15), None)
        for j in range(5):
            d.L(x + 0.08 + j * 0.135, 1.95, x + 0.08 + j * 0.135, 2.0, C["cream"], 0.6)


def ashtray_stand(d):
    d.overhead(0.0, 0.0, 1.6, 1.6, "#9aa3ad", rx=0.8, op=0.3)
    d.C(0.8, 0.8, 0.24, dome("#9aa3ad"), 1.0)
    d.C(0.8, 0.8, 0.16, "#2a313b", st=None)
    for k in range(6):
        a = math.radians(k * 60)
        d.C(0.8 + 0.11 * math.cos(a), 0.8 + 0.11 * math.sin(a), 0.02, "#c3cad2", st=None)


def safety_wall(d):
    d.R(0.0, 0.0, 0.7, 0.26, soft(C["red"], "h"), 1.6, rx=0.03)
    d.R(0.06, 0.05, 0.58, 0.16, "#f2c6c4", st=None, rx=0.02)
    d.C(0.35, 0.13, 0.06, C["red"], st=None)
    d.R(1.0, 0.0, 0.42, 0.22, soft("#2f9d5a", "h"), 1.6, rx=0.03)
    d.P([(1.21, 0.06), (1.27, 0.12), (1.21, 0.18), (1.15, 0.12)], "#ffffff", st=None)


def wheelchair_park(d):
    for k in range(3):
        x = 0.1 + k * 0.6
        d.R(x, 0.1, 0.46, 0.76, "#3d4652", 0.9, rx=0.05)
        d.R(x - 0.04, 0.2, 0.06, 0.56, "#20252c", 0.6, st=None, rx=0.03)
        d.R(x + 0.44, 0.2, 0.06, 0.56, "#20252c", 0.6, st=None, rx=0.03)
        d.R(x + 0.08, 0.18, 0.3, 0.44, "#2f6fd1", st=None, rx=0.04)
    d.R(0.0, 0.0, 1.9, 0.06, C["chrome"], 0.9, st=None)


def kids_play(d):
    d.R(0, 0, 3.0, 3.0, "#8fc3a5", st=None, rx=0.2)
    d.R(0.08, 0.08, 2.84, 2.84, "none", st="#ffffff", sw=0.04, rx=0.16)
    for (x, y, r, col) in ((0.7, 0.7, 0.35, "#f2c230"), (2.2, 0.8, 0.28, "#e86a8f"), (0.8, 2.2, 0.3, "#5fa8d3")):
        d.C(x, y, r, dome(col), 0.4)
    d.R(1.6, 1.5, 1.0, 0.5, soft("#f08a24", "v"), 0.8, rx=0.06)                         # slide deck
    d.R(1.75, 2.0, 0.7, 0.8, soft("#5fa8d3", "h"), 0.5, rx=0.1)                         # slide chute
    d.L(1.82, 2.1, 1.82, 2.75, "#ffffff", 1.0)
    d.L(2.38, 2.1, 2.38, 2.75, "#ffffff", 1.0)
    d.R(0.4, 1.4, 0.4, 0.4, soft("#7a4f7f", "h"), 0.4, rx=0.05)


def help_point(d):
    d.C(0.2, 0.2, 0.2, dome("#e9edf1"), 1.5)
    d.C(0.2, 0.14, 0.05, C["stop"], st=None)
    d.C(0.2, 0.27, 0.05, C["ok"], st=None)


def column_round(d, r=0.45, ad=False):
    d.C(r, r, r, soft("#cfd5dc" if not ad else "#1d2430", "h"), 3.0)
    if ad:
        d.C(r, r, r - 0.04, "none", st="#d4a23a", sw=0.05)
        d.C(r, r, r - 0.1, soft("#2f4a6e", "h"), st=None)
    else:
        d.C(r, r, r - 0.06, "none", st="#b8c0c9", sw=0.015)
