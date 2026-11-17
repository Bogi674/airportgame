"""Airline office furniture and building infrastructure.

Same frame as the other fixture modules: meters, top left at (0, 0), the side people use at the bottom edge.
Circulation items (escalator, stairs, travelator) run along y; for escalators and stairs the lower floor end is the
bottom edge, the upper floor end is the top edge.
"""
import math
from lib import fmt
from fixture_core import (D, C, FX_OUT, soft, lit, dome, screen_grad, shade, monitor, office_chair, keyboard, printer,
                          status_light)
import fixtures_general as fg


# ================================================================================================================
# Office parts
# ================================================================================================================

def computer(d, x=0.0, y=0.0, dual=True):
    """Desktop computer seen from above, 1.2 by 0.5 m: monitors at the back facing the user at the bottom."""
    if dual:
        for cx in (x + 0.32, x + 0.88):
            monitor(d, cx, y + 0.1, 0.52, "down", 1.25)
    else:
        monitor(d, x + 0.6, y + 0.1, 0.6, "down", 1.25)
    keyboard(d, x + 0.38, y + 0.3, 0.44, 0.13)
    d.E(x + 0.95, y + 0.37, 0.035, 0.05, "#2a313b", 0.76, st=None)
    d.R(x + 0.02, y + 0.26, 0.2, 0.17, "#3a414b", 0.8, rx=0.03, sw=d.dw)                   # desk phone
    d.R(x + 0.05, y + 0.29, 0.08, 0.11, "#1d2430", st=None, rx=0.02)


def desk_top(d, x, y, w, h, col="#f2f2ef", ht=0.75):
    d.R(x, y, w, h, soft(col, "v"), ht, rx=0.03)
    d.R(x, y, w, 0.05, shade(col, -0.12), st=None)


def work_desk_pc(d, chair="#2f4a6e"):
    """Straight desk 1.6 by 0.8 m with computer and task chair, footprint 1.6 by 1.4 m."""
    office_chair(d, 0.8, 1.08, chair, 180)
    desk_top(d, 0, 0, 1.6, 0.8)
    computer(d, 0.2, 0.08)
    d.C(1.42, 0.2, 0.07, dome("#3a414b"), 1.2, sw=d.dw)
    d.L(1.42, 0.2, 1.3, 0.4, "#3a414b", 1.2)
    d.R(1.28, 0.48, 0.24, 0.3, "#f6f7f9", 0.77, sw=d.dw)                                    # papers
    d.R(1.3, 0.5, 0.24, 0.3, "#ffffff", 0.78, sw=d.dw)
    d.C(0.1, 0.66, 0.07, dome(C["leaf"]), 0.95, sw=d.dw)


def l_desk(d, chair="#2f4a6e"):
    """L shaped desk 1.8 by 1.6 m with return on the left, computer in the corner."""
    office_chair(d, 1.15, 1.08, chair, 180)
    d.A("M0,0 L1.8,0 L1.8,0.7 L0.65,0.7 L0.65,1.6 L0,1.6 Z", soft("#f2f2ef", "v"), FX_OUT,
        shadow_pts=[(0, 0), (1.8, 0), (1.8, 0.7), (0.65, 0.7), (0.65, 1.6), (0, 1.6)], ht=0.75)
    computer(d, 0.6, 0.06)
    d.R(0.08, 0.9, 0.45, 0.32, "#e9edf1", 0.78, rx=0.02, sw=d.dw)
    d.R(0.12, 0.94, 0.3, 0.06, C["red"], st=None)
    printer(d, 0.12, 1.3, 0.36, 0.24)


def desk_pod(d, chair="#2f4a6e"):
    """Bench desking for 4: two desks back to back with an acoustic screen, 3.2 by 2.8 m including chairs."""
    for k in range(2):
        office_chair(d, 0.8 + k * 1.6, 0.3, chair, 0)
        office_chair(d, 0.8 + k * 1.6, 2.5, chair, 180)
    desk_top(d, 0, 0.6, 3.2, 0.8)
    desk_top(d, 0, 1.4, 3.2, 0.8)
    d.R(0.05, 1.37, 3.1, 0.06, soft(C["teal"], "h"), 1.25, rx=0.02, sw=d.dw)               # acoustic screen
    for k in range(2):
        computer(d, 0.2 + k * 1.6, 1.52)
        d.place(computer, 1.4 + k * 1.6, 1.38, 180)


def office_sofa_l(d, col="#59616d"):
    """Corner sofa 2.4 by 2.4 m for a reception or a crew room."""
    d.R(0, 0, 2.4, 0.9, shade(col, -0.18), 0.4, rx=0.08)
    d.R(0, 0, 0.9, 2.4, shade(col, -0.18), 0.4, rx=0.08)
    fg.cushion(d, 0.04, 0.02, 2.32, 0.24, shade(col, -0.06), 0.85, 0.1)
    fg.cushion(d, 0.02, 0.04, 0.24, 2.32, shade(col, -0.06), 0.85, 0.1, "v")
    fg.cushion(d, 2.18, 0.1, 0.2, 0.78, shade(col, -0.04), 0.65, 0.08, "v")
    fg.cushion(d, 0.1, 2.18, 0.78, 0.2, shade(col, -0.04), 0.65, 0.08, "h")
    for k in range(3):
        fg.cushion(d, 0.28 + k * 0.62, 0.28, 0.6, 0.58, col, 0.45, 0.08, "v")
    for k in range(2):
        fg.cushion(d, 0.28, 0.9 + k * 0.62, 0.58, 0.6, col, 0.45, 0.08, "h")
    d.R(0.34, 0.34, 0.3, 0.3, soft(C["mustard"], "h"), 0.7, rx=0.06)


def meeting_table(d, seats_side=3, col=C["oak"]):
    """Meeting table for 6, table 2.4 by 1.1 m, footprint 2.8 by 2.4 m with chairs."""
    w = 2.8
    for k in range(seats_side):
        x = 0.62 + k * 0.78
        office_chair(d, x, 0.32, "#3a414b", 0)
        office_chair(d, x, 2.08, "#3a414b", 180)
    d.A("M0.75,0.65 L2.05,0.65 Q2.6,0.65 2.6,1.2 Q2.6,1.75 2.05,1.75 L0.75,1.75 Q0.2,1.75 0.2,1.2 "
        "Q0.2,0.65 0.75,0.65 Z", soft(col, "v"), FX_OUT,
        shadow_pts=[(0.2, 0.65), (2.6, 0.65), (2.6, 1.75), (0.2, 1.75)], ht=0.75)
    d.C(1.4, 1.2, 0.13, "#2a313b", 0.8, sw=d.dw)                                           # conference phone
    d.C(1.4, 1.2, 0.04, C["glow"], st=None)
    d.P([(0.55, 0.75), (0.9, 0.75), (0.92, 0.98), (0.53, 0.98)], "#c9ced4", 0.78, sw=d.dw)
    d.P([(1.9, 1.65), (2.25, 1.65), (2.27, 1.42), (1.88, 1.42)], "#c9ced4", 0.78, sw=d.dw)
    for x, y in ((1.05, 0.88), (1.75, 1.52)):
        d.C(x, y, 0.045, "#f6f7f9", 0.8, sw=d.dw)


def round_table4(d):
    for a in (45, 135, 225, 315):
        r = math.radians(a)
        office_chair(d, 1.0 + 0.72 * math.cos(r), 1.0 + 0.72 * math.sin(r), "#3a414b", a + 90)
    d.C(1.0, 1.0, 0.55, dome("#f2f2ef"), 0.75)
    d.C(1.0, 1.0, 0.07, "#ffffff", 0.8, sw=d.dw)


def copier(d):
    d.R(0, 0, 1.2, 0.7, soft("#e3e7eb", "h"), 1.2, rx=0.05)
    d.R(0.08, 0.06, 0.7, 0.42, lit("#cfd5dc"), st=None, rx=0.03)
    d.R(0.2, 0.12, 0.46, 0.3, "#9fd3f2", st="#5fa8d3", sw=d.dw, op=0.6)
    d.R(0.86, 0.12, 0.26, 0.2, "#2a313b", st=None, rx=0.02)
    d.R(0.89, 0.15, 0.2, 0.1, C["glow"], st=None)
    d.R(0.0, 0.58, 1.2, 0.08, "#9aa3ad", st=None)
    d.R(0.1, 0.5, 0.5, 0.06, "#ffffff", st=None)


def filing(d, n=3):
    for k in range(n):
        x = k * 0.5
        d.R(x, 0, 0.48, 0.62, soft("#9aa3ad", "h"), 1.3, rx=0.02)
        d.R(x + 0.14, 0.54, 0.2, 0.04, "#59616d", st=None, rx=0.01)


def whiteboard(d):
    d.R(0, 0, 1.8, 0.06, "#f6f7f9", 1.6, st="#9aa3ad", sw=d.dw)
    d.R(0.1, 0.06, 1.6, 0.06, lit("#c9ced4"), 1.0, st=None)
    for k, col in enumerate(("#c8102e", "#1f6fd1", "#141414")):
        d.R(0.3 + k * 0.14, 0.07, 0.1, 0.035, col, st=None, rx=0.01)


def reception_desk(d, livery="#c8102e"):
    office_chair(d, 1.0, 0.35, "#3a414b")
    office_chair(d, 2.0, 0.35, "#3a414b")
    pts = [(0.0, 0.7), (3.0, 0.7), (3.0, 1.25), (1.5, 1.6), (0.0, 1.25)]
    d.A("M0,0.7 L3,0.7 L3,1.2 Q1.5,1.9 0,1.2 Z", soft("#f2f2ef", "h"), FX_OUT, shadow_pts=pts, ht=1.1)
    d.A("M0.06,1.24 Q1.5,1.96 2.94,1.24", "none", livery, 3.0)
    monitor(d, 1.0, 0.95, 0.4, "up", 1.4)
    monitor(d, 2.0, 0.95, 0.4, "up", 1.4)
    d.C(2.65, 0.95, 0.09, "#f4f6f8", 1.2, sw=d.dw)
    d.C(2.65, 0.95, 0.05, C["leafLt"], st=None)


# ---------------- pantry ----------------------------------------------------------------------------------------

def pantry_counter(d):
    """Pantry run 2.4 by 0.65 m against a wall: sink, coffee machine, microwave, kettle, dish rack."""
    d.R(0, 0, 2.4, 0.65, soft("#e9e4da", "v"), 0.9, rx=0.03)
    d.R(0.03, 0.03, 2.34, 0.58, lit(C["stone"]), st=None, rx=0.02)
    d.R(0.12, 0.12, 0.52, 0.4, lit(C["steel"]), st=FX_OUT, sw=d.dw, rx=0.04)               # sink
    d.R(0.16, 0.16, 0.44, 0.32, lit("#aeb6c0", "v"), st=None, rx=0.03)
    d.C(0.38, 0.32, 0.03, "#6b737d", st=None)
    d.R(0.35, 0.05, 0.06, 0.12, C["chrome"], 1.0, st=None, rx=0.02)
    d.R(0.72, 0.1, 0.36, 0.3, "#c9ced4", 0.95, rx=0.02, sw=d.dw)                            # dish rack
    for k in range(4):
        d.L(0.76 + k * 0.08, 0.13, 0.76 + k * 0.08, 0.37, "#8c96a2", 0.6)
    d.R(1.16, 0.06, 0.42, 0.36, soft("#2a313b", "h"), 1.35, rx=0.04)                        # coffee machine
    d.R(1.22, 0.1, 0.3, 0.06, "#c0c7cf", st=None, rx=0.02)
    d.C(1.37, 0.3, 0.05, "#141c26", st=None)
    d.R(1.66, 0.04, 0.6, 0.4, soft("#e3e7eb", "h"), 1.25, rx=0.03)                          # microwave
    d.R(1.7, 0.08, 0.38, 0.28, "#2a313b", st=None, rx=0.02)
    d.R(2.12, 0.1, 0.1, 0.24, "#59616d", st=None, rx=0.01)
    d.C(1.32, 0.52, 0.06, dome("#f6f7f9"), 0.98, sw=d.dw)
    d.C(1.5, 0.52, 0.06, dome("#f6f7f9"), 0.98, sw=d.dw)
    d.C(0.9, 0.53, 0.08, dome("#d9dee4"), 1.15, sw=d.dw)                                    # kettle


def fridge(d):
    d.R(0, 0, 0.72, 0.7, soft("#dfe5ea", "h"), 1.9, rx=0.04)
    d.R(0.04, 0.04, 0.64, 0.58, lit("#eef1f4"), st=None, rx=0.03)
    d.R(0.58, 0.6, 0.06, 0.08, "#8c96a2", st=None)
    status_light(d, 0.12, 0.12, C["glow"], 0.02)


def water_cooler(d):
    d.R(0, 0, 0.36, 0.36, soft("#e3e7eb", "h"), 1.0, rx=0.04)
    d.C(0.18, 0.18, 0.14, dome("#9fd3f2"), 1.45, st="#5fa8d3", sw=d.dw)
    d.C(0.18, 0.18, 0.05, "#5fa8d3", st=None)


def high_table(d):
    for k in range(2):
        for sy, y in ((-1, 0.18), (1, 1.32)):
            fg.stool(d, 0.5 + k * 0.6, y, "#3a414b", 0.16)
    d.R(0.1, 0.4, 1.4, 0.7, soft(C["oak"], "v"), 1.05, rx=0.05)
    d.C(0.5, 0.75, 0.05, "#f6f7f9", 1.1, sw=d.dw)
    d.C(1.1, 0.75, 0.05, "#f6f7f9", 1.1, sw=d.dw)


# ---------------- executive office ------------------------------------------------------------------------------

def exec_desk(d):
    """Executive desk 2.0 by 0.9 m, leather chair behind (top), two visitor chairs in front. 2.0 by 2.5 m."""
    d.R(0.65, 0.0, 0.7, 0.62, dome("#3b2a20"), 0.6, rx=0.16)                                # leather chair
    d.R(0.68, 0.0, 0.64, 0.18, soft("#2e2019", "h"), 1.2, rx=0.08)
    d.R(0.0, 0.66, 2.0, 0.9, soft(C["walnut"], "v"), 0.76, rx=0.04)
    d.R(0.5, 0.74, 1.0, 0.6, "#2e3a2e", st=None, rx=0.02, op=0.85)                          # leather inlay
    monitor(d, 0.6, 0.86, 0.5, "up", 1.25)
    keyboard(d, 0.42, 0.98, 0.36, 0.11)
    d.C(1.72, 0.84, 0.09, dome("#3a414b"), 1.2, sw=d.dw)                                    # lamp
    d.C(1.72, 0.84, 0.05, "#fff6d0", st=None)
    d.R(1.15, 1.32, 0.4, 0.08, "#c9a24a", 0.82, st=None, rx=0.01)                           # nameplate
    d.R(1.25, 0.95, 0.3, 0.22, "#f6f7f9", 0.78, sw=d.dw)
    d.C(0.16, 1.4, 0.05, "#2a313b", 0.85, sw=d.dw)
    for x in (0.55, 1.45):
        fg.cushion(d, x - 0.28, 1.84, 0.56, 0.56, "#6e4a33", 0.45, 0.1, "v")
        fg.cushion(d, x - 0.28, 2.3, 0.56, 0.14, "#5a3b28", 0.85, 0.06)


def credenza(d):
    d.R(0, 0, 2.0, 0.5, soft(C["walnut"], "v"), 0.8, rx=0.03)
    x = 0.1
    cols = ["#c8102e", "#2f4a6e", "#d4a23a", "#2f7f86", "#ece3d0"]
    for k in range(9):
        d.R(x, 0.08, 0.05, 0.24, cols[k % 5], 0.95, st=None)
        x += 0.065
    d.C(1.05, 0.25, 0.12, dome("#3a6a9a"), 1.0, sw=d.dw)                                     # globe
    d.L(1.05, 0.13, 1.05, 0.37, "#c9a24a", 0.8)
    fg.pot(d, 1.72, 0.25, 0.18, "#e9e4da", 0.95)
    fg.leaves(d, 1.72, 0.25, 0.2, 7, ht=1.3)


def model_stand(d):
    """Desk top model aircraft on a stand, 0.6 by 0.5 m."""
    d.C(0.3, 0.38, 0.08, dome("#3a414b"), 0.85, sw=d.dw)
    d.P([(0.3, 0.02), (0.34, 0.12), (0.58, 0.24), (0.58, 0.28), (0.34, 0.22), (0.33, 0.38), (0.4, 0.44),
         (0.2, 0.44), (0.27, 0.38), (0.26, 0.22), (0.02, 0.28), (0.02, 0.24), (0.26, 0.12)], "#f4f6f8", 1.1,
        sw=d.dw)


# ================================================================================================================
# Building infrastructure
# ================================================================================================================

def _rails(d, w, L, y0=0.0, y1=None, glass=True):
    y1 = L if y1 is None else y1
    for x in (0.0, w - 0.18):
        d.R(x, y0, 0.18, y1 - y0, soft("#c3cad2", "h"), 1.0, rx=0.05)
        if glass:
            d.R(x + 0.06, y0 + 0.05, 0.06, y1 - y0 - 0.1, C["glass"], st=None, op=0.8)
        d.R(x + 0.03, y0, 0.12, y1 - y0, "#1d2430", 1.05, st=None, rx=0.06, op=0.9)       # handrail


def escalator(d, up=True, w=1.65, L=13.2):
    """One escalator, step width 1.0 m, rise 5 m at 30 degrees: 8.7 m incline plus 2.25 m landings."""
    land = 2.25
    sx0, sw_ = 0.33, w - 0.66
    d.R(0.18, 0, w - 0.36, L, "#59616d", 0.1, st=None)
    gid = "gEscUp" if up else "gEscDn"
    from fixture_core import _GRADS, SPEC, BASE
    SPEC["url(#gEscUp)"] = {"g": "escalator"}
    BASE["url(#gEscUp)"] = "#b9c0c8"
    if gid not in _GRADS:
        _GRADS[gid] = ('<linearGradient id="gEscUp" x1="0" y1="0" x2="0" y2="1">'
                       '<stop offset="0" stop-color="#d9dee4"/><stop offset="1" stop-color="#8c96a2"/>'
                       '</linearGradient><linearGradient id="gEscDn" x1="0" y1="1" x2="0" y2="0">'
                       '<stop offset="0" stop-color="#d9dee4"/><stop offset="1" stop-color="#8c96a2"/>'
                       '</linearGradient>')
    d.R(sx0, land, sw_, L - 2 * land, "url(#gEscUp)", st=None)
    k = land + 0.4
    while k < L - land:
        d.L(sx0, k, sx0 + sw_, k, "#6b737d", 0.6, cap="butt")
        k += 0.4
    d.L(sx0 + 0.02, land, sx0 + 0.02, L - land, C["hazard"], 1.4, cap="butt")
    d.L(sx0 + sw_ - 0.02, land, sx0 + sw_ - 0.02, L - land, C["hazard"], 1.4, cap="butt")
    for y0 in (0.0, L - land):
        d.R(sx0, y0, sw_, land, lit(C["steel"]), st=None)
        for j in range(1, 9):
            d.L(sx0 + j * sw_ / 9, y0 + 0.15, sx0 + j * sw_ / 9, y0 + land - 0.15, "#aab3bd", 0.5)
        cy = y0 + (land - 0.06 if y0 == 0 else 0.06)
        d.L(sx0, cy, sx0 + sw_, cy, C["hazard"], 1.6, cap="butt")
    _rails(d, w, L, 0.4, L - 0.4)
    cx = w / 2
    for k in range(3):
        y = land + 2.2 + k * 1.6
        dy = -0.2 if up else 0.2
        d.A(f"M{fmt(cx - 0.22)},{fmt(y - dy)} L{fmt(cx)},{fmt(y + dy)} L{fmt(cx + 0.22)},{fmt(y - dy)}", "none",
            "#ffffff", 2.0)
    status_light(d, 0.09, L - 0.25 if up else 0.25, C["ok"], 0.03)


def escalator_pair(d):
    """Up and down escalators side by side with a 0.3 m center deck, 3.6 by 13.2 m."""
    d.place(escalator, 0, 0, 0, True)
    d.place(escalator, 1.95, 0, 0, False)
    d.R(1.65, 0.6, 0.3, 12.0, "#3a414b", st=None)


def stairs_straight(d, w=1.8, L=10.4):
    """Straight flight to the next floor: 30 risers of 0.167 m, going 0.28 m, landings 1.0 m."""
    d.R(0, 0, w, L, lit("#d9dee4", "v"), 0.1, st=FX_OUT)
    for k in range(31):
        y = 1.0 + k * 0.28
        d.L(0.15, y, w - 0.15, y, "#8c96a2" if k < 15 else "#aab3bd", 0.8, cap="butt",
            dash=None if k < 15 else f"{fmt(4 / d.px)} {fmt(3 / d.px)}")
    d.L(0.15, 1.0, 0.15, L - 1.0, "#6b737d", 0.6)
    d.L(w - 0.15, 1.0, w - 0.15, L - 1.0, "#6b737d", 0.6)
    for x in (0.06, w - 0.12):
        d.R(x, 0.6, 0.06, L - 1.2, "#1d2430", 1.0, st=None, rx=0.03)
    d.A(f"M{fmt(0.2)},{fmt(L / 2 + 0.6)} L{fmt(w - 0.2)},{fmt(L / 2 - 0.2)}", "none", "#5d6672", 1.4)
    d.A(f"M{fmt(w / 2)},{fmt(L - 0.5)} L{fmt(w / 2)},{fmt(1.5)} M{fmt(w / 2 - 0.2)},1.8 L{fmt(w / 2)},1.5 "
        f"L{fmt(w / 2 + 0.2)},1.8", "none", "#2f4a6e", 1.6)
    d.C(w / 2, L - 0.5, 0.07, "#2f4a6e", st=None)
    d.L(0.0, L - 0.04, w, L - 0.04, C["hazard"], 1.6, cap="butt")
    d.L(0.0, 0.04, w, 0.04, C["hazard"], 1.6, cap="butt")


def stairs_switchback(d):
    """Dog leg stair 3.9 by 6.4 m: up the right flight, half landing at the top, down the left flight."""
    w, L = 3.9, 6.4
    d.R(0, 0, w, L, lit("#d9dee4", "v"), 0.1, st=FX_OUT)
    d.R(0, 0, w, 1.8, lit("#e3e7eb", "v"), st=None)                                       # half landing
    d.R(1.8, 1.8, 0.3, L - 1.8, "#3a414b", 1.0, st=None)                                  # well wall
    for k in range(16):
        y = 1.8 + k * 0.28
        d.L(2.1, y, w - 0.1, y, "#8c96a2", 0.8, cap="butt")
        d.L(0.1, y, 1.8, y, "#aab3bd", 0.8, cap="butt", dash=f"{fmt(4 / d.px)} {fmt(3 / d.px)}")
    d.R(w - 0.12, 1.0, 0.06, L - 1.4, "#1d2430", 1.0, st=None, rx=0.03)
    d.R(0.06, 1.0, 0.06, L - 1.4, "#1d2430", 1.0, st=None, rx=0.03)
    d.A(f"M{fmt(3.0)},{fmt(L - 0.4)} L3.0,1.0 Q3.0,0.6 2.6,0.6 L1.3,0.6 Q0.9,0.6 0.9,1.0 L0.9,{fmt(L - 1.2)} "
        f"M0.7,{fmt(L - 1.5)} L0.9,{fmt(L - 1.2)} L1.1,{fmt(L - 1.5)}", "none", "#2f4a6e", 1.6)
    d.C(3.0, L - 0.4, 0.07, "#2f4a6e", st=None)
    d.L(2.1, L - 0.04, w, L - 0.04, C["hazard"], 1.6, cap="butt")


def elevator(d, glass=False):
    """Passenger lift for 13 people: shaft 2.6 by 2.8 m, car 2.1 by 1.7 m, doors on the bottom edge."""
    w, h = 2.6, 2.8
    if glass:
        d.R(0, 0, w, h, C["glass"], 3.0, st=C["glassEdge"], rx=0.3, op=0.75)
        d.R(0.12, 0.12, w - 0.24, h - 0.5, "none", st="#8c96a2", sw=0.04, rx=0.22)
    else:
        d.R(0, 0, w, h, "#3d4652", 3.0, st=None)
    d.R(0.25, 0.25, 2.1, 1.75, lit("#cfd5dc"), st=FX_OUT)
    d.R(0.35, 0.35, 1.9, 1.55, lit("#b9c0c8"), st=None)
    for x in (0.3, 2.24):
        d.R(x, 0.5, 0.06, 1.2, C["chrome"], st=None, rx=0.03)
    d.R(0.3, 0.3, 2.0, 0.06, C["chrome"], st=None, rx=0.03)
    d.R(0.6, 2.0, 1.4, 0.18, "#8c96a2", st=None)                                          # sill
    d.R(0.65, 2.02, 0.65, 0.08, soft(C["chrome"], "h"), 2.2, st=FX_OUT, sw=d.dw)            # doors
    d.R(1.3, 2.02, 0.65, 0.08, soft(C["chrome"], "h"), 2.2, st=FX_OUT, sw=d.dw)
    d.R(0.0, 2.16, w, 0.64, "#2c3441" if not glass else "#8fb7c9", 3.0, st=None)
    d.R(0.62, 2.2, 1.36, 0.6, lit("#d9dee4"), st=None)                                     # door frame reveal
    d.R(2.12, 2.82, 0.2, 0.12, "#2a313b", 1.2, rx=0.02, sw=d.dw)                           # call buttons
    d.C(2.17, 2.88, 0.022, C["ok"], st=None)
    d.C(2.27, 2.88, 0.022, "#f2a93b", st=None)
    d.R(1.1, 2.82, 0.4, 0.06, "#141c26", st=None)                                         # floor indicator
    d.L(1.14, 2.85, 1.46, 2.85, C["glow"], 1.2)


def elevator_bank(d):
    """Two lifts side by side, 5.4 by 2.8 m."""
    d.place(elevator, 0, 0)
    d.place(elevator, 2.8, 0)
    d.R(2.6, 0, 0.2, 2.8, "#2c3441", st=None)


def travelator(d, L=16.0, w=1.65, toward_top=True):
    """Moving walkway, pallet width 1.0 m, comb plates 1.2 m at both ends."""
    sx0, sw_ = 0.33, w - 0.66
    d.R(0.18, 0, w - 0.36, L, "#59616d", 0.1, st=None)
    d.R(sx0, 1.2, sw_, L - 2.4, lit("#4a5058", "h"), st=None)
    k = 1.4
    while k < L - 1.2:
        d.L(sx0 + 0.04, k, sx0 + sw_ - 0.04, k, "#6b737d", 0.5, cap="butt")
        k += 0.4
    d.L(sx0 + 0.02, 1.2, sx0 + 0.02, L - 1.2, C["hazard"], 1.4, cap="butt")
    d.L(sx0 + sw_ - 0.02, 1.2, sx0 + sw_ - 0.02, L - 1.2, C["hazard"], 1.4, cap="butt")
    for y0 in (0.0, L - 1.2):
        d.R(sx0, y0, sw_, 1.2, lit(C["steel"]), st=None)
        for j in range(1, 9):
            d.L(sx0 + j * sw_ / 9, y0 + 0.1, sx0 + j * sw_ / 9, y0 + 1.1, "#aab3bd", 0.5)
    _rails(d, w, L, 0.3, L - 0.3)
    cx = w / 2
    k = 2.6
    while k < L - 2.2:
        dy = -0.18 if toward_top else 0.18
        d.A(f"M{fmt(cx - 0.22)},{fmt(k - dy)} L{fmt(cx)},{fmt(k + dy)} L{fmt(cx + 0.22)},{fmt(k - dy)}", "none",
            C["hazard"], 2.0)
        k += 2.0


def travelator_pair(d, L=16.0):
    d.place(travelator, 0, 0, 0, L, toward_top=True)
    d.place(travelator, 1.95, 0, 0, L, toward_top=False)
    d.R(1.65, 0.3, 0.3, L - 0.6, "#3a414b", st=None)


# ---------------- janitor room, 4 by 3 m inside --------------------------------------------------------------

def mop_sink(d):
    d.R(0, 0, 0.7, 0.7, soft("#e3e7eb", "h"), 0.3, rx=0.06)
    d.R(0.08, 0.08, 0.54, 0.54, lit("#b9c0c8"), st=None, rx=0.04)
    d.C(0.35, 0.4, 0.04, "#59616d", st=None)
    d.R(0.3, 0.0, 0.1, 0.16, C["chrome"], 1.0, st=None, rx=0.02)
    d.A("M0.35,0.12 Q0.6,0.3 0.5,0.5", "none", "#2f6fd1", 1.6)


def supply_shelf(d, w=1.2):
    d.R(0, 0, w, 0.45, lit("#9aa3ad"), 1.8, rx=0.02)
    cols = ["#2f6fd1", "#f2c230", "#e9edf1", "#3ea35a", "#c8102e", "#ffffff"]
    x = 0.06
    k = 0
    while x < w - 0.12:
        if k % 3 == 2:
            d.R(x, 0.06, 0.22, 0.32, "#c9a27a", 1.6, st="#8a6a48", sw=d.dw)               # carton
            x += 0.26
        else:
            d.C(x + 0.06, 0.14, 0.06, cols[k % 6], 1.5, sw=d.dw)
            d.C(x + 0.06, 0.32, 0.06, cols[(k + 2) % 6], 1.5, sw=d.dw)
            x += 0.15
        k += 1


def floor_scrubber(d):
    d.R(0, 0.1, 1.1, 0.62, soft(C["hazard"], "v"), 1.0, rx=0.12)
    d.R(0.15, 0.18, 0.5, 0.46, soft("#3a414b", "h"), 1.05, rx=0.08)
    d.C(0.88, 0.41, 0.17, "#2a313b", st=None)
    d.R(-0.05, 0.0, 0.08, 0.82, "#2a313b", 1.0, st=None, rx=0.03)                          # handle
    d.R(0.98, 0.04, 0.16, 0.74, "#1d2430", 0.2, rx=0.05)                                  # squeegee


def wet_floor_sign(d):
    d.P([(0.0, 0.42), (0.25, 0.0), (0.5, 0.42)], C["hazard"], 0.6, st="#b38a12", sw=d.dw)
    d.P([(0.18, 0.34), (0.25, 0.18), (0.32, 0.34)], C["black"], st=None)


def mop_rack(d):
    d.R(0, 0, 1.0, 0.08, "#8c96a2", 1.4, st=None)
    for k in range(4):
        x = 0.12 + k * 0.25
        d.L(x, 0.04, x, 0.32, "#b98a5a", 1.4)
        d.E(x, 0.36, 0.08, 0.05, ["#e9edf1", "#2f6fd1", "#e9edf1", "#3ea35a"][k], 0.3, st=None)


def janitor_room(d):
    """Contents of a 4 by 3 m cleaning closet. The scene draws the walls and the door."""
    d.place(mop_sink, 0, 0)
    d.place(supply_shelf, 0.8, 0, 0, 1.6)
    d.place(mop_rack, 2.6, 0)
    d.place(floor_scrubber, 0.15, 1.4)
    d.place(fg.janitor_cart, 2.9, 1.2)
    d.place(wet_floor_sign, 3.35, 2.45)
    d.place(fg.trash_round, 1.6, 2.4, 0, "#3ea35a")
