"""Processing fixtures: check in desk, passport control and boarding gate desk in three levels, the security lane in
three levels, and the automated variants (self check in kiosk, self bag drop, automated passport gate).

Local frame: meters, top left at (0, 0), passenger side at the bottom edge. Security lanes are the exception: they
are drawn with the passenger flow along +x (16 m by 4 m) and rotate like every other fixture.
"""
import math
from lib import fmt
from fixture_core import (D, C, FX_OUT, soft, lit, dome, screen_grad, glow_grad, shade, mix, monitor, office_chair,
                          keyboard, printer, tray, suitcase, rollers, belt, status_light, floor_mark_feet,
                          stop_line, ramp_stub)


# ================================================================================================================
# Check in desk, 2 by 2 m, one agent. The belt lane runs down the middle (x 0.6 to 1.4) so it meets the out ramp
# cell behind the desk, as in docs/BAGGAGE.md 7.1. Agent counter on the left, passenger ledge on the right.
# ================================================================================================================

def checkin(d: D, level=1, livery="#c8102e", bag=False):
    bx0, bw = 0.62, 0.76
    if level == 1:
        belt(d, bx0, 0.0, bw, 1.02, "y", 0.6)
        d.R(bx0, 1.02, bw, 0.62, lit(C["steel"], "v"), 0.35, rx=0.03)               # flat weighing plate
        for k in range(1, 4):
            d.L(bx0 + 0.04, 1.02 + k * 0.155, bx0 + bw - 0.04, 1.02 + k * 0.155, "#aab3bd", 0.5)
    else:
        belt(d, bx0, 0.0, bw, 1.66, "y", 0.6)
        d.L(bx0, 1.02, bx0 + bw, 1.02, "#9aa3ad", 1.0)                             # weigh section joint
        rail = C["chrome"] if level == 3 else C["steelDk"]
        d.R(bx0 - 0.04, 0.0, 0.05, 1.66, rail, 0.75, st=None)
        d.R(bx0 + bw - 0.01, 0.0, 0.05, 1.66, rail, 0.75, st=None)
        if level == 3:
            d.R(bx0, 1.6, bw, 0.06, C["chrome"], 0.4, st=None)

    # back panel behind the agent
    if level == 2:
        d.R(0.0, 0.0, 0.58, 0.1, soft(livery, "v"), 2.2, rx=0.02)
    if level == 3:
        d.R(0.0, 0.0, 0.58, 0.14, soft(shade(livery, -0.2), "v"), 2.4, rx=0.03)
        d.R(0.06, 0.03, 0.46, 0.08, livery, st=None, rx=0.02)
        d.R(0.12, 0.05, 0.34, 0.04, shade(livery, 0.45), st=None, rx=0.02)

    office_chair(d, 0.3, 0.44, "#3a414b" if level < 3 else "#5a3a2a")

    # agent counter (left) and passenger ledge (right)
    if level == 1:
        d.R(0.02, 0.8, 0.58, 0.62, lit(C["laminate"]), 1.05, rx=0.04)
        d.R(0.02, 1.34, 0.58, 0.08, livery, st=None)
        monitor(d, 0.3, 1.1, 0.36, "up", 1.4)
        keyboard(d, 0.12, 0.86, 0.36, 0.11)
        d.R(1.42, 0.86, 0.5, 0.56, lit(C["laminate"]), 1.0, rx=0.04)
        d.R(1.42, 1.34, 0.5, 0.08, livery, st=None)
        d.R(1.5, 0.94, 0.16, 0.1, "#141c26", st=None, rx=0.015)                     # scale readout
        d.R(1.53, 0.96, 0.1, 0.05, C["ok"], st=None)
        printer(d, 1.66, 1.06, 0.2, 0.18)
    elif level == 2:
        d.R(0.02, 0.78, 0.58, 0.66, lit(C["stone"]), 1.08, rx=0.06)
        d.R(0.02, 1.34, 0.58, 0.1, soft(livery, "h"), st=None, rx=0.03)
        monitor(d, 0.3, 1.08, 0.36, "up", 1.4)
        keyboard(d, 0.12, 0.84, 0.36, 0.11)
        d.R(1.42, 0.78, 0.5, 0.66, lit(C["stone"]), 1.08, rx=0.06)
        d.R(1.42, 1.34, 0.5, 0.1, soft(livery, "h"), st=None, rx=0.03)
        monitor(d, 1.67, 1.18, 0.3, "down", 1.35)                                   # passenger facing display
        printer(d, 1.48, 0.84, 0.2, 0.16)
        printer(d, 1.72, 0.84, 0.16, 0.16, "#d3d9df")
        d.R(1.96, 0.66, 0.04, 1.02, C["glass"], 1.4, st=C["glassEdge"], sw=d.dw)     # divider to next desk
    else:
        for x0, x1 in ((0.02, 0.6), (1.42, 1.94)):
            m = (x0 + x1) / 2
            top = f"M{x0},0.78 L{x1},0.78 L{x1},1.36 Q{m},1.5 {x0},1.36 Z"
            d.A(top, soft(C["walnut"], "h"), FX_OUT,
                shadow_pts=[(x0, 0.78), (x1, 0.78), (x1, 1.36), (m, 1.43), (x0, 1.36)], ht=1.1)
            d.A(f"M{x0 + 0.05},0.82 L{x1 - 0.05},0.82 L{x1 - 0.05},1.3 Q{m},1.42 {x0 + 0.05},1.3 Z",
                lit(C["stone"]), None)
            d.A(f"M{x0 + 0.02},1.4 Q{m},1.52 {x1 - 0.02},1.4", "none", livery, 2.0)
        monitor(d, 0.31, 1.08, 0.36, "up", 1.4)
        keyboard(d, 0.13, 0.86, 0.36, 0.1)
        monitor(d, 1.68, 1.18, 0.3, "down", 1.35)
        printer(d, 1.5, 0.86, 0.18, 0.15)
        d.C(1.82, 0.92, 0.07, "#f4f6f8", 0.3, sw=d.dw)                              # vase
        for a in (0, 120, 240):
            r = math.radians(a)
            d.E(1.82 + 0.05 * math.cos(r), 0.92 + 0.05 * math.sin(r), 0.04, 0.02, C["leafLt"], st=None, rot=a)
        d.C(1.82, 0.92, 0.025, "#e86a8f", st=None)
        status_light(d, 1.0, 1.62, C["ok"], 0.03)
        for gx in (0.0, 1.96):
            d.R(gx, 0.62, 0.04, 1.3, C["glass"], 1.6, st=C["glassEdge"], sw=d.dw, op=0.85)
    if bag:
        suitcase(d, 1.0, 1.32, "#2f5aa8", 0.36, 0.56, 0.95)


def checkin_mat(d: D):
    """Premium mat in front of a level 3 desk, floor level, drawn before people."""
    d.R(0.5, 1.62, 1.0, 0.34, C["navy"], st=None, rx=0.04)
    d.R(0.54, 1.66, 0.92, 0.26, "none", st=C["mustard"], sw=0.02, rx=0.03)


# ================================================================================================================
# Self check in kiosk, 2 by 2 m, automated. One passenger at a time.
# ================================================================================================================

def kiosk_checkin(d: D, livery="#1f6fd1"):
    d.R(0.42, 1.12, 1.16, 0.82, "none", st="#9aa3ad", sw=0.025, rx=0.12, extra='stroke-dasharray="0.08 0.06"')
    floor_mark_feet(d, 1.0, 1.6, "#9aa3ad")
    for s in (-1, 1):                                                               # privacy wings
        x0 = 1.0 + s * 0.4
        d.P([(x0, 0.42), (x0 + s * 0.05, 0.42), (x0 + s * 0.2, 1.0), (x0 + s * 0.15, 1.0)], C["glass"], 1.5,
            st=C["glassEdge"], sw=d.dw)
    d.R(0.6, 0.3, 0.8, 0.66, soft("#f2f4f6", "h"), 1.65, rx=0.12)
    d.R(0.6, 0.3, 0.8, 0.14, soft(livery, "h"), st=None, rx=0.07)
    status_light(d, 1.3, 0.37, C["ok"], 0.025)
    d.P([(0.68, 0.5), (1.32, 0.5), (1.36, 0.86), (0.64, 0.86)], screen_grad(), st="#11161d", sw=d.dw)
    d.L(0.67, 0.85, 1.33, 0.85, C["glow"], 1.4)
    for k in range(3):                                                              # menu tiles on screen
        d.R(0.76 + k * 0.17, 0.62, 0.13, 0.12, shade(livery, 0.3 + 0.15 * k), st=None, rx=0.015, op=0.9)
    d.R(0.58, 0.88, 0.84, 0.12, lit(C["steel"]), 1.0, rx=0.03)                     # ledge
    d.R(0.64, 0.9, 0.18, 0.08, "#9fd3f2", st="#5fa8d3", sw=d.dw)                    # passport scanner glass
    d.L(0.9, 0.94, 1.08, 0.94, "#141c26", 1.6)                                      # print slot
    d.R(1.18, 0.9, 0.16, 0.08, "#2a313b", st=None, rx=0.015)                        # card reader
    d.C(1.31, 0.94, 0.012, C["ok"], st=None)


# ================================================================================================================
# Self bag drop, 4 by 2 m, automated. Lane centered on x = 1.0 to meet the out ramp cell behind cell 1.
# ================================================================================================================

def bagdrop_self(d: D, livery="#1f6fd1", bag=False):
    d.R(0.08, 0.0, 3.0, 0.18, soft("#59616d", "v"), 2.3, rx=0.03)                   # header frame
    d.R(0.1, 0.04, 2.96, 0.06, livery, st=None)
    for x0, w in ((0.12, 0.44), (1.44, 0.52)):                                     # side cabinets
        d.R(x0, 0.18, w, 1.4, soft("#f2f4f6", "h"), 1.1, rx=0.06)
        d.R(x0 + 0.04, 0.22, w - 0.08, 0.05, C["glow"], st=None, op=0.8)
    belt(d, 0.56, 0.18, 0.88, 1.44, "y", 0.4)
    d.R(0.56, 0.18, 0.88, 0.22, C["slot"], st=None)                                 # rear shutter
    for k in range(6):
        x = 0.56 + k * 0.147
        d.R(x, 0.38, 0.074, 0.05, C["hazard"], st=None)
        d.R(x + 0.074, 0.38, 0.073, 0.05, C["black"], st=None)
    d.L(0.6, 1.0, 1.4, 1.0, "#e0a030", 0.8, dash=f"{fmt(4 / d.px)} {fmt(3 / d.px)}")  # weigh zone edge
    d.R(0.54, 1.58, 0.92, 0.07, C["chrome"], 0.45, st=FX_OUT, sw=d.dw)
    for x in (0.6, 1.4):                                                           # light curtain posts
        d.R(x - 0.035, 1.44, 0.07, 0.12, "#2a313b", 0.9, st=None, rx=0.015)
        d.C(x, 1.47, 0.015, C["stop"], st=None)
    # screen tower
    d.R(2.1, 0.62, 0.62, 0.66, soft("#f2f4f6", "h"), 1.6, rx=0.1)
    d.R(2.1, 0.62, 0.62, 0.12, soft(livery, "h"), st=None, rx=0.06)
    d.P([(2.16, 0.82), (2.66, 0.82), (2.69, 1.14), (2.13, 1.14)], screen_grad(), st="#11161d", sw=d.dw)
    d.L(2.15, 1.13, 2.67, 1.13, C["glow"], 1.4)
    d.R(2.12, 1.18, 0.58, 0.12, lit(C["steel"]), 1.0, rx=0.03)
    d.R(2.18, 1.2, 0.16, 0.08, "#9fd3f2", st="#5fa8d3", sw=d.dw)
    d.L(2.42, 1.24, 2.62, 1.24, "#141c26", 1.6)
    floor_mark_feet(d, 2.41, 1.7, "#9aa3ad")
    # side screen and tag bin
    d.R(3.86, 0.3, 0.05, 1.4, C["glass"], 1.5, st=C["glassEdge"], sw=d.dw)
    d.C(3.45, 0.55, 0.18, dome("#59616d"), 0.75, sw=d.dw)
    d.C(3.45, 0.55, 0.1, "#2a313b", st=None)
    if bag:
        suitcase(d, 1.0, 1.12, "#c0392b", 0.4, 0.62, 0.7)


# ================================================================================================================
# Passport control, 2 by 2 m, one officer. Officer on the left, passenger lane x 1.15 to 1.95, flow bottom to top.
# ================================================================================================================

def passport(d: D, level=1):
    if level == 1:
        office_chair(d, 0.32, 1.0, "#3a414b", -90)
        d.R(0.58, 0.44, 0.44, 1.12, lit(C["laminate"], "h"), 1.1, rx=0.05)
        d.R(0.98, 0.44, 0.06, 1.12, "#7a8794", st=None)
        monitor(d, 0.72, 0.9, 0.34, "left", 1.45)
        d.R(0.8, 1.2, 0.16, 0.12, "#9fd3f2", st="#5fa8d3", sw=d.dw)                 # document reader
        d.C(0.86, 0.62, 0.05, "#7b2d2d", 1.15, sw=d.dw)                             # stamp
        d.R(0.72, 0.58, 0.08, 0.08, "#3a4a6b", st=None, rx=0.01)
        stop_line(d, 1.18, 1.92, 1.88)
        d.C(1.94, 0.36, 0.06, dome("#59616d"), 1.0, sw=d.dw)                       # lane post
        d.L(1.94, 0.36, 1.2, 0.36, "#2f4a6e", 1.6)
    elif level == 2:
        wall = "#3d4652"
        d.R(0.04, 0.16, 1.1, 0.06, wall, 2.3, st=None)
        d.R(0.04, 1.78, 1.1, 0.06, wall, 2.3, st=None)
        d.R(0.04, 0.16, 0.06, 0.5, wall, 2.3, st=None)                              # door gap on the left
        d.R(0.04, 1.2, 0.06, 0.64, wall, 2.3, st=None)
        d.R(1.08, 0.16, 0.06, 0.36, wall, 2.3, st=None)
        d.R(1.08, 1.46, 0.06, 0.38, wall, 2.3, st=None)
        d.R(1.09, 0.52, 0.04, 0.94, C["glass"], 2.0, st=C["glassEdge"], sw=d.dw)
        d.A("M0.07,0.66 A0.54,0.54 0 0 1 0.61,1.2", "none", "#8f99a5", 0.6, extra='stroke-dasharray="0.05 0.04"')
        d.R(0.66, 0.26, 0.4, 1.46, lit(C["laminate"], "h"), 1.0, rx=0.03, sw=d.dw)
        office_chair(d, 0.38, 1.0, "#3a414b", -90)
        monitor(d, 0.8, 0.72, 0.32, "left", 1.4)
        d.R(0.86, 1.06, 0.14, 0.1, "#9fd3f2", st="#5fa8d3", sw=d.dw)
        d.R(1.14, 0.78, 0.14, 0.46, lit(C["steel"], "h"), 1.1, rx=0.02)              # passenger ledge
        d.R(1.17, 0.92, 0.08, 0.1, "#2a313b", st=None, rx=0.015)                    # fingerprint pad
        d.R(1.18, 0.94, 0.06, 0.06, "#3ec46d", st=None, op=0.6)
        d.C(1.94, 0.3, 0.06, dome("#59616d"), 1.0, sw=d.dw)                        # exit flap post
        d.R(1.3, 0.27, 0.6, 0.06, C["glass"], 0.9, st=C["glassEdge"], sw=d.dw)
        stop_line(d, 1.18, 1.92, 1.88)
    else:
        shell = "#f4f6f8"
        pts = [(0.04, 0.14), (1.16, 0.14), (1.16, 1.86), (0.04, 1.86)]
        d.R(0.04, 0.14, 1.12, 1.72, soft(shell, "h"), 2.4, rx=0.18)
        d.R(0.12, 0.22, 0.96, 1.56, lit("#e3e8ee"), st=None, rx=0.12)               # interior floor
        d.R(0.04, 0.6, 0.06, 0.62, "#e3e8ee", st=None)                              # door gap
        d.L(1.13, 0.3, 1.13, 1.7, C["glow"], 1.6)                                   # LED strip
        d.R(1.1, 0.54, 0.05, 0.92, C["glass"], st=C["glassEdge"], sw=d.dw)
        d.A("M0.62,0.3 Q1.02,0.3 1.02,0.7 L1.02,1.3 Q1.02,1.7 0.62,1.7 Z", lit(C["stone"], "h"), FX_OUT,
            shadow_pts=[(0.62, 0.3), (1.02, 0.3), (1.02, 1.7), (0.62, 1.7)], ht=1.0, sw=d.dw)
        office_chair(d, 0.36, 1.0, "#2f4a6e", -90)
        monitor(d, 0.78, 0.74, 0.32, "left", 1.4)
        monitor(d, 0.78, 1.24, 0.24, "left", 1.4)
        d.R(1.16, 0.62, 0.16, 0.2, "#1d2430", 1.7, rx=0.04)                         # face camera pillar
        d.C(1.24, 0.68, 0.035, "#5fa8d3", st=None)
        status_light(d, 1.24, 0.77, C["ok"], 0.022)
        d.R(1.16, 0.92, 0.14, 0.34, lit(C["steel"], "h"), 1.1, rx=0.03)
        d.R(1.19, 1.02, 0.08, 0.12, "#2a313b", st=None, rx=0.015)
        d.R(1.2, 1.04, 0.06, 0.08, "#3ec46d", st=None, op=0.7)
        d.C(1.94, 0.32, 0.06, dome("#59616d"), 1.0, sw=d.dw)
        d.R(1.2, 0.29, 0.36, 0.06, C["glass"], 1.0, st=C["glassEdge"], sw=d.dw)    # double flap doors
        d.R(1.56, 0.29, 0.32, 0.06, C["glass"], 1.0, st=C["glassEdge"], sw=d.dw)
        floor_mark_feet(d, 1.55, 1.15, "#f2c230")
        stop_line(d, 1.18, 1.92, 1.88)


# ================================================================================================================
# Automated passport gate, 2 by 2 m. Mantrap lane between two cabinets, glass flaps at entry and exit.
# ================================================================================================================

def egate(d: D, open_entry=False):
    d.R(0.66, 0.2, 0.68, 1.62, "#3a414b", st=None, rx=0.04, op=0.55)              # rubber lane mat
    floor_mark_feet(d, 1.0, 1.0, "#f2c230")
    for x0 in (0.2, 1.34):
        d.R(x0, 0.2, 0.46, 1.6, soft("#f2f4f6", "h"), 1.1, rx=0.08)
        d.R(x0 + 0.05, 0.25, 0.36, 1.5, lit("#e6eaee"), st=None, rx=0.05)
        d.L(x0 + (0.42 if x0 < 1 else 0.04), 0.3, x0 + (0.42 if x0 < 1 else 0.04), 1.7, C["glow"], 1.4)
    # entry flaps
    if open_entry:
        d.R(0.62, 1.42, 0.06, 0.34, C["glass"], 1.0, st=C["glassEdge"], sw=d.dw)
        d.R(1.32, 1.42, 0.06, 0.34, C["glass"], 1.0, st=C["glassEdge"], sw=d.dw)
    else:
        d.R(0.66, 1.52, 0.34, 0.06, C["glass"], 1.0, st=C["glassEdge"], sw=d.dw)
        d.R(1.0, 1.52, 0.34, 0.06, C["glass"], 1.0, st=C["glassEdge"], sw=d.dw)
    # exit flaps
    d.R(0.66, 0.42, 0.34, 0.06, C["glass"], 1.0, st=C["glassEdge"], sw=d.dw)
    d.R(1.0, 0.42, 0.34, 0.06, C["glass"], 1.0, st=C["glassEdge"], sw=d.dw)
    # passport reader on the right cabinet, angled glass toward the lane
    d.R(1.38, 1.18, 0.34, 0.3, "#2a313b", 1.15, rx=0.04, sw=d.dw)
    d.R(1.42, 1.22, 0.26, 0.22, "#9fd3f2", st="#5fa8d3", sw=d.dw)
    # camera mast with screen facing into the lane
    d.R(1.4, 0.6, 0.22, 0.24, "#1d2430", 1.9, rx=0.05)
    monitor(d, 1.38, 0.72, 0.22, "left", 1.7)
    d.C(1.51, 0.66, 0.03, "#5fa8d3", st=None)
    status_light(d, 0.42, 1.68, C["ok"], 0.03)
    status_light(d, 1.58, 1.68, C["ok"], 0.03)


# ================================================================================================================
# Boarding gate desk, 4 by 2 m. Agents at the top, passengers at the bottom.
# ================================================================================================================

def gatedesk(d: D, level=1, livery="#c8102e"):
    if level == 1:
        office_chair(d, 1.5, 0.42)
        d.R(0.6, 0.78, 1.9, 0.6, lit(C["laminate"]), 1.05, rx=0.05)
        d.R(0.6, 1.3, 1.9, 0.08, livery, st=None)
        monitor(d, 1.4, 1.04, 0.38, "up", 1.4)
        keyboard(d, 1.22, 0.84, 0.34, 0.1)
        printer(d, 1.86, 0.86, 0.22, 0.16)
        d.R(2.12, 1.1, 0.22, 0.14, "#2a313b", 1.15, rx=0.03, sw=d.dw)               # pass reader
        d.R(2.16, 1.13, 0.14, 0.08, "#3ec46d", st=None, op=0.6)
        d.C(3.3, 0.6, 0.16, dome("#59616d"), 0.1, sw=d.dw)                          # gate sign pole
        d.R(3.0, 0.56, 0.6, 0.08, "#1d2430", 2.4, rx=0.02, sw=d.dw)
        d.L(3.03, 0.64, 3.57, 0.64, C["hazard"], 1.4)
    else:
        n_pos = 2
        xs = (0.95, 2.25)
        if level == 2:
            d.R(0.4, 0.04, 2.4, 0.12, "#1d2430", 2.6, rx=0.02)                       # gate display on a stand
            d.L(0.44, 0.16, 2.76, 0.16, C["glow"], 1.6)
            for x in (0.6, 2.6):
                d.R(x - 0.04, 0.16, 0.08, 0.14, "#59616d", 0.6, st=None)
            for x in xs:
                office_chair(d, x, 0.48)
            d.R(0.2, 0.8, 2.8, 0.62, lit(C["stone"]), 1.05, rx=0.06)
            d.R(0.2, 1.34, 2.8, 0.08, soft(livery, "h"), st=None, rx=0.03)
            for x in xs:
                monitor(d, x - 0.06, 1.08, 0.36, "up", 1.4)
                keyboard(d, x - 0.22, 0.86, 0.32, 0.1)
                d.R(x + 0.26, 1.12, 0.2, 0.14, "#2a313b", 1.15, rx=0.03, sw=d.dw)
                d.R(x + 0.29, 1.15, 0.14, 0.08, "#3ec46d", st=None, op=0.6)
            printer(d, 1.5, 0.86, 0.2, 0.16)
            for y in (0.4, 1.9):                                                     # queue posts
                d.C(3.5, y, 0.08, dome("#59616d"), 1.0, sw=d.dw)
            d.L(3.5, 0.4, 3.5, 1.9, "#c24545", 2.2)
        else:
            d.R(0.3, 0.02, 2.6, 0.16, "#141c26", 2.8, rx=0.02)                       # LED wall
            d.L(0.34, 0.18, 2.86, 0.18, C["glow"], 2.0)
            for x in (0.5, 2.7):
                d.R(x - 0.05, 0.18, 0.1, 0.12, "#59616d", 0.6, st=None)
            for x in xs:
                office_chair(d, x, 0.5, "#5a3a2a")
            top = "M0.15,0.8 L2.95,0.8 L2.95,1.32 Q1.55,1.6 0.15,1.32 Z"
            d.A(top, soft(C["walnut"], "h"), FX_OUT, shadow_pts=[(0.15, 0.8), (2.95, 0.8), (2.95, 1.32),
                                                                   (1.55, 1.46), (0.15, 1.32)], ht=1.08)
            d.A("M0.22,0.85 L2.88,0.85 L2.88,1.26 Q1.55,1.5 0.22,1.26 Z", lit(C["stone"]), None)
            d.A("M0.17,1.36 Q1.55,1.62 2.93,1.36", "none", livery, 2.0)
            for x in xs:
                monitor(d, x - 0.06, 1.06, 0.36, "up", 1.4)
                keyboard(d, x - 0.22, 0.88, 0.32, 0.1)
                d.R(x + 0.26, 1.1, 0.2, 0.14, "#2a313b", 1.15, rx=0.03, sw=d.dw)
                d.R(x + 0.29, 1.13, 0.14, 0.08, "#3ec46d", st=None, op=0.6)
            # priority lane with its own scanner and flap
            d.R(3.06, 0.12, 0.9, 1.84, "#7a2534", st=None, rx=0.04)
            d.R(3.1, 0.16, 0.82, 1.76, "none", st=C["mustard"], sw=0.02, rx=0.03)
            d.R(3.1, 0.96, 0.24, 0.28, soft("#f2f4f6", "h"), 1.15, rx=0.04, sw=d.dw)
            d.R(3.14, 1.02, 0.16, 0.12, "#9fd3f2", st="#5fa8d3", sw=d.dw)
            status_light(d, 3.22, 1.19, C["ok"], 0.022)
            d.R(3.34, 0.64, 0.58, 0.06, C["glass"], 1.0, st=C["glassEdge"], sw=d.dw)
            d.C(3.94, 0.67, 0.05, dome("#59616d"), 1.0, sw=d.dw)


# ================================================================================================================
# Security lane, 16 by 4 m, flow along +x. Conveyor band y 0.4 to 1.2, walkway below it.
# ================================================================================================================

def _xray(d, x0, L, w=1.05, yc=0.8, col=None, dual=False):
    col = col or C["machine"]
    y0 = yc - w / 2
    if dual:
        d.R(x0 + L * 0.38, y0 - 0.16, L * 0.24, 0.2, soft(C["machineDk"], "v"), 1.9, rx=0.04, sw=d.dw)
    d.R(x0, y0, L, w, soft(col, "v"), 1.6, rx=0.08)
    d.R(x0 + 0.1, y0 + 0.08, L - 0.2, w - 0.16, lit(shade(col, 0.06)), st=None, rx=0.05)
    for xe in (x0, x0 + L - 0.14):
        d.R(xe, yc - 0.34, 0.14, 0.68, "#141c26", st=None, rx=0.02)
        for k in range(5):
            yy = yc - 0.3 + k * 0.15
            d.L(xe + 0.02, yy, xe + 0.12, yy, "#3a4250", 1.0, cap="butt")
    d.R(x0 + L * 0.42, y0 + w - 0.2, L * 0.16, 0.08, C["hazard"], st=None)
    status_light(d, x0 + 0.3, y0 + 0.16, C["ok"], 0.03)


def _ct(d, x0, L, yc=0.8):
    w = 1.25
    y0 = yc - w / 2
    d.R(x0, y0, L, w, soft(C["machine"], "v"), 1.7, rx=0.12)
    cx = x0 + L / 2
    d.E(cx, yc, 0.72, 0.76, soft("#e9edf1", "h"), 2.0)
    d.E(cx, yc, 0.56, 0.6, "none", st="#b6bec8", sw=0.03)
    d.L(cx - 0.56, yc, cx + 0.56, yc, "#c6cdd5", 0.8)
    for xe in (x0, x0 + L - 0.14):
        d.R(xe, yc - 0.36, 0.14, 0.72, "#141c26", st=None, rx=0.02)
        for k in range(5):
            yy = yc - 0.32 + k * 0.16
            d.L(xe + 0.02, yy, xe + 0.12, yy, "#3a4250", 1.0, cap="butt")
    d.L(x0 + 0.25, y0 + 0.1, x0 + L - 0.25, y0 + 0.1, C["glow"], 1.4)
    status_light(d, cx, yc + 0.48, C["ok"], 0.035)


def _wtmd(d, x, yc):
    for yy in (yc - 0.53, yc + 0.38):
        d.R(x, yy, 0.6, 0.15, soft("#d9dee4", "h"), 2.2, rx=0.04)
    d.R(x + 0.02, yc - 0.42, 0.04, 0.84, "#c2c9d1", 2.2, st=None)                  # top beam edges
    d.R(x + 0.54, yc - 0.42, 0.04, 0.84, "#c2c9d1", 2.2, st=None)
    for yy in (yc - 0.46, yc + 0.46):
        status_light(d, x + 0.08, yy, C["ok"], 0.022)


def _bodyscan(d, cx, cy):
    d.C(cx, cy, 0.86, lit("#e3e8ee"), 0.08)
    for a0, a1 in ((205, 335), (25, 155)):
        r = 0.74
        p0 = (cx + r * math.cos(math.radians(a0)), cy + r * math.sin(math.radians(a0)))
        p1 = (cx + r * math.cos(math.radians(a1)), cy + r * math.sin(math.radians(a1)))
        pts = [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
               for a in range(a0, a1 + 1, 10)]
        d._shadow(pts, 2.3)
        d.A(f"M{fmt(p0[0])},{fmt(p0[1])} A{r},{r} 0 0 1 {fmt(p1[0])},{fmt(p1[1])}", "none", "#bfc7d0", sw=0.2)
        d.A(f"M{fmt(p0[0])},{fmt(p0[1])} A{r},{r} 0 0 1 {fmt(p1[0])},{fmt(p1[1])}", "none", "#eef1f4", sw=0.12)
    floor_mark_feet(d, cx, cy, "#f2c230", 1.1)
    status_light(d, cx, cy - 0.52, C["ok"], 0.03)


def _glass_run(d, x0, x1, y):
    d.R(x0, y - 0.025, x1 - x0, 0.05, C["glass"], 1.1, st=C["glassEdge"], sw=d.dw)
    for x in (x0, x1):
        d.R(x - 0.04, y - 0.06, 0.08, 0.12, "#8c96a2", 1.1, st=None, rx=0.02)


def _belt_posts(d, pts, col="#2f4a6e"):
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        d.L(x1, y1, x2, y2, col, 2.0, cap="butt")
    for x, y in pts:
        d.C(x, y, 0.08, "#2a313b", 0.08, st=None)
        d.C(x, y, 0.045, dome("#9aa3ad"), 1.0, st=None)


def _bench(d, x, y, w):
    d.R(x, y, w, 0.42, soft("#7d8794", "v"), 0.45, rx=0.06)
    k = x + 0.5
    while k < x + w - 0.1:
        d.L(k, y + 0.04, k, y + 0.38, "#5d6672", 0.6)
        k += 0.5


def _console(d, x, y, n=2):
    d.R(x, y, 0.42 * n + 0.16, 0.42, lit(C["laminate"]), 0.9, rx=0.04)
    for k in range(n):
        monitor(d, x + 0.29 + k * 0.42, y + 0.24, 0.34, "down", 1.25)
    office_chair(d, x + (0.42 * n + 0.16) / 2, y + 0.72, "#3a414b", 180)


def _tray_stack(d, cx, cy, n=4):
    for k in range(n):
        tray(d, cx + 0.015 * k, cy - 0.015 * k, 0.6, 0.42, "#8f99a5" if k < n - 1 else "#a3acb7", 0.8 + 0.08 * k)


def _podium(d, x, y):
    d.R(x, y, 0.5, 0.4, lit(C["laminate"]), 1.1, rx=0.05)
    d.R(x + 0.12, y + 0.08, 0.26, 0.2, "#2a313b", st=None, rx=0.03)
    d.R(x + 0.16, y + 0.12, 0.18, 0.12, "#3ec46d", st=None, op=0.6)


def security(d: D, level=1):
    """Returns a dict of labelled parts with their x centers, for the reference sheet legend."""
    parts = []
    yc = 0.8
    if level == 1:
        _podium(d, 0.3, 3.25)
        parts.append(("Pass check", 0.55))
        _belt_posts(d, [(1.2, 2.0), (4.62, 2.0)])
        _belt_posts(d, [(1.2, 3.6), (3.0, 3.6), (4.0, 2.97), (4.62, 2.97)])
        d.R(0.4, 0.4, 2.8, 0.8, lit(C["steel"]), 0.85, rx=0.05)                       # static divest table
        d.R(0.46, 0.46, 2.68, 0.68, lit("#d5dbe1"), st=None, rx=0.03)
        _tray_stack(d, 0.85, yc, 3)
        tray(d, 2.3, yc)
        parts.append(("Divest table", 1.8))
        rollers(d, 3.2, 0.44, 0.6, 0.72)
        _xray(d, 3.8, 2.6)
        parts.append(("X-ray, single view", 5.1))
        rollers(d, 6.4, 0.44, 3.0, 0.72)
        tray(d, 7.4, yc)
        tray(d, 8.6, yc)
        parts.append(("Reclaim rollers", 7.9))
        _wtmd(d, 4.62, 2.46)
        parts.append(("Metal detector", 4.92))
        _console(d, 6.45, 1.36, 1)
        parts.append(("Operator", 6.74))
        d.R(8.0, 2.05, 1.0, 1.0, "#3a414b", st=None, rx=0.05, op=0.6)
        floor_mark_feet(d, 8.5, 2.55)
        parts.append(("Search mat", 8.5))
        d.R(9.7, 0.38, 0.86, 0.84, lit("#9aa3ad"), 0.9, rx=0.05)                     # tray cart
        _tray_stack(d, 10.13, yc, 3)
        parts.append(("Tray cart", 10.13))
        _bench(d, 11.0, 3.3, 2.0)
        parts.append(("Re-dress bench", 12.0))
        d.C(13.5, 3.5, 0.22, dome("#59616d"), 0.8, sw=d.dw)
        d.C(13.5, 3.5, 0.13, "#2a313b", st=None)
        parts.append(("Bin", 13.5))
    elif level == 2:
        _podium(d, 0.3, 3.25)
        status_light(d, 0.55, 3.2, C["ok"], 0.03)
        parts.append(("Pass reader", 0.55))
        _glass_run(d, 1.2, 5.32, 2.0)
        _glass_run(d, 1.2, 5.32, 2.95)
        rollers(d, 0.3, 0.42, 4.1, 0.76)
        d.R(0.3, 1.18, 4.1, 0.14, lit(C["steel"]), 0.82, rx=0.02)                    # divest ledge
        _tray_stack(d, 0.75, yc, 3)
        _tray_stack(d, 2.55, yc, 3)
        tray(d, 1.7, yc)
        tray(d, 3.6, yc)
        parts.append(("Divest, 2 positions", 2.2))
        _xray(d, 4.4, 3.0, 1.15, dual=True)
        parts.append(("X-ray, dual view", 5.9))
        _wtmd(d, 5.32, 2.46)
        parts.append(("Metal detector", 5.62))
        rollers(d, 7.4, 0.42, 5.0, 0.76)
        tray(d, 8.4, yc)
        tray(d, 9.8, yc)
        parts.append(("Powered reclaim", 9.0))
        _console(d, 7.5, 1.4, 2)
        parts.append(("Operator", 7.96))
        d.R(6.3, 2.05, 1.0, 0.95, "#3a414b", st=None, rx=0.05, op=0.6)
        floor_mark_feet(d, 6.8, 2.52)
        parts.append(("Search mat", 6.8))
        rollers(d, 10.4, 1.36, 2.0, 0.56)
        parts.append(("Reject table", 11.4))
        d.R(9.5, 3.15, 0.8, 0.6, lit(C["laminate"]), 0.9, rx=0.04)                   # ETD table
        d.R(9.62, 3.24, 0.34, 0.28, soft("#e3e7eb", "h"), 1.25, rx=0.04, sw=d.dw)
        d.R(9.68, 3.3, 0.22, 0.1, "#141c26", st=None)
        parts.append(("Trace table", 9.9))
        d.R(12.8, 0.38, 0.86, 0.84, lit("#9aa3ad"), 0.9, rx=0.05)
        _tray_stack(d, 13.23, yc, 4)
        parts.append(("Tray cart", 13.23))
        _bench(d, 13.2, 3.3, 2.0)
        parts.append(("Re-dress bench", 14.2))
        d.C(15.5, 3.5, 0.22, dome("#59616d"), 0.8, sw=d.dw)
        d.C(15.5, 3.5, 0.13, "#2a313b", st=None)
    else:
        # automatic tray return runs along the back edge and under the scanner
        belt(d, 0.3, 0.04, 14.1, 0.3, "x", 0.5, chev="#3b82c4")
        for x in (2.0, 9.5, 12.0):
            tray(d, x, 0.19, 0.5, 0.26, "#a3acb7", 0.65)
        parts.append(("Auto tray return", 11.0))
        d.R(0.3, 2.0, 0.34, 0.6, "#1d2430", 1.7, rx=0.05)                            # lane status pillar
        status_light(d, 0.47, 2.18, C["ok"], 0.04)
        d.R(0.36, 2.34, 0.22, 0.16, "#9fd3f2", st="#5fa8d3", sw=d.dw)
        parts.append(("Lane pillar", 0.47))
        rollers(d, 0.3, 0.42, 4.7, 0.8)
        for k, x in enumerate((0.45, 1.6, 2.75, 3.9)):                               # four divest stations
            d.R(x, 1.24, 0.98, 0.42, lit(C["steel"]), 0.9, rx=0.04)
            d.R(x + 0.05, 1.28, 0.36, 0.34, "#59616d", 0.95, rx=0.03, sw=d.dw)        # tray dispenser
            tray(d, x + 0.23, 1.45, 0.3, 0.26, "#a3acb7", 1.0)
            d.R(x + 0.5, 1.32, 0.4, 0.24, "#141c26", st=None, rx=0.03)
            d.R(x + 0.54, 1.36, 0.32, 0.16, C["ok"] if k != 2 else C["amber"], st=None, op=0.75, rx=0.02)
            if k in (0, 2):
                tray(d, x + 0.5, yc, 0.6, 0.42)
        parts.append(("4 divest stations", 2.4))
        _glass_run(d, 0.9, 5.6, 2.25)
        _glass_run(d, 0.9, 5.6, 3.3)
        _ct(d, 5.0, 3.6)
        parts.append(("CT scanner", 6.8))
        _bodyscan(d, 6.6, 2.62)
        parts.append(("Body scanner", 6.6))
        rollers(d, 8.6, 0.42, 5.8, 0.8)
        tray(d, 9.4, yc)
        tray(d, 11.6, yc)
        parts.append(("Powered reclaim", 9.6))
        d.P([(9.6, 1.22), (10.1, 1.22), (10.5, 1.42), (10.0, 1.42)], lit(C["steelDk"]), 0.8)   # diverter
        rollers(d, 10.0, 1.42, 4.4, 0.62)
        tray(d, 12.9, 1.73, 0.6, 0.42, "#c0794a")
        parts.append(("Auto reject lane", 12.2))
        d.R(12.2, 2.3, 1.1, 0.6, lit(C["laminate"]), 0.9, rx=0.04)                   # resolution table
        d.R(12.3, 2.38, 0.34, 0.28, soft("#e3e7eb", "h"), 1.25, rx=0.04, sw=d.dw)
        d.R(12.36, 2.44, 0.22, 0.1, "#141c26", st=None)
        monitor(d, 12.95, 2.55, 0.3, "down", 1.3)
        parts.append(("Resolution table", 12.75))
        _bench(d, 13.6, 3.3, 2.0)
        parts.append(("Re-dress bench", 14.6))
        d.C(15.6, 3.5, 0.22, dome("#59616d"), 0.8, sw=d.dw)
        d.C(15.6, 3.5, 0.13, "#2a313b", st=None)
    return parts
