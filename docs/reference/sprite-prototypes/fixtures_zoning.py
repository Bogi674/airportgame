"""Zone transition fixtures and the zone overlay.

Security exit (staffed lane, automated anti return corridor, one way revolving door), staff door with card reader,
customs channel, and the overlay painter for terminal zones (docs/TERMINAL_ZONING.md).
Local frame as the other fixture modules: meters, top left at (0, 0), people enter at the bottom edge and leave at
the top edge.
"""
import math
from lib import fmt, rect, circle, line, poly, path, g, text
from fixture_core import (D, C, FX_OUT, soft, lit, dome, shade, monitor, office_chair, status_light,
                          floor_mark_feet, stop_line)


def _arrows(d, cx, y0, y1, col="#ffffff", step=0.9, op=0.9):
    y = y1 - 0.4
    while y > y0 + 0.3:
        d.A(f"M{fmt(cx - 0.25)},{fmt(y + 0.18)} L{fmt(cx)},{fmt(y - 0.1)} L{fmt(cx + 0.25)},{fmt(y + 0.18)}",
            "none", col, 2.2, op=op)
        y -= step


def _glass_wall(d, x, y0, y1):
    d.R(x - 0.03, y0, 0.06, y1 - y0, C["glass"], 1.4, st=C["glassEdge"], sw=d.dw)
    for y in (y0, y1):
        d.R(x - 0.06, y - 0.06, 0.12, 0.12, "#8c96a2", 1.4, st=None, rx=0.02)


def _no_entry(d, cx, cy):
    """Round no entry sign seen from above on a short post, facing the wrong way side."""
    d.C(cx, cy, 0.16, C["stop"], 1.6, st="#ffffff", sw=d.dw)
    d.R(cx - 0.1, cy - 0.025, 0.2, 0.05, "#ffffff", st=None)


def security_exit_staffed(d):
    """Staffed exit lane, 4 by 4 m: lane on the right between glass, officer post on the left, drop arm."""
    d.R(2.15, 0.1, 1.7, 3.8, "#3a414b", st=None, rx=0.04, op=0.45)                       # rubber lane mat
    _glass_wall(d, 2.1, 0.2, 3.8)
    _glass_wall(d, 3.9, 0.2, 3.8)
    _arrows(d, 3.0, 0.2, 3.8)
    d.R(0.75, 1.3, 0.9, 1.4, lit(C["laminate"], "h"), 1.1, rx=0.05)                       # podium
    d.R(1.55, 1.3, 0.1, 1.4, C["red"], st=None)
    monitor(d, 1.15, 1.7, 0.32, "right", 1.4)
    office_chair(d, 0.3, 2.0, "#3a414b", -90)
    d.R(2.15, 1.96, 1.2, 0.08, C["hazard"], 1.0, st=None, rx=0.02)                        # drop arm, closed
    for k in range(4):
        d.R(2.3 + k * 0.28, 1.96, 0.14, 0.08, C["black"], st=None)
    d.C(3.62, 2.0, 0.12, dome("#59616d"), 1.1, sw=d.dw)
    _no_entry(d, 3.0, 3.6)
    status_light(d, 2.25, 0.35, C["ok"], 0.03)


def security_exit_auto(d):
    """Automated anti return corridor, 2 by 6 m, two pairs of sliding doors, sensors and a camera dome."""
    d.R(0.15, 0.1, 1.7, 5.8, "#3a414b", st=None, rx=0.04, op=0.45)
    _glass_wall(d, 0.1, 0.1, 5.9)
    _glass_wall(d, 1.9, 0.1, 5.9)
    for y in (1.2, 4.8):
        d.R(0.13, y - 0.05, 0.86, 0.1, soft(C["chrome"], "h"), 2.2, st=FX_OUT, sw=d.dw)
        d.R(1.01, y - 0.05, 0.86, 0.1, soft(C["chrome"], "h"), 2.2, st=FX_OUT, sw=d.dw)
        for x in (0.05, 1.83):
            d.R(x, y - 0.2, 0.12, 0.4, "#1d2430", 2.2, rx=0.03, sw=d.dw)
            d.C(x + 0.06, y - 0.1, 0.025, C["ok"] if y > 3 else C["stop"], st=None)
    _arrows(d, 1.0, 1.4, 4.6)
    floor_mark_feet(d, 1.0, 5.4, "#f2c230")
    d.overhead(0.82, 2.82, 0.36, 0.36, "#1d2430", rx=0.18)                                  # ceiling camera
    _no_entry(d, 1.0, 0.55)


def exit_revolving(d):
    """One way revolving exit door, 2.6 by 2.6 m drum with three wings, glass enclosure."""
    cx = cy = 1.3
    d.C(cx, cy, 1.25, "none", 2.4, st=C["glassEdge"], sw=0.08)
    d.C(cx, cy, 1.21, C["glass"], st=None, op=0.35)
    d.R(0.0, 1.2, 0.2, 0.2, "#8c96a2", 2.4, st=None)
    d.R(2.4, 1.2, 0.2, 0.2, "#8c96a2", 2.4, st=None)
    for k in range(3):
        a = math.radians(30 + k * 120)
        d.L(cx, cy, cx + 1.18 * math.cos(a), cy + 1.18 * math.sin(a), C["glassEdge"], sw=0.06)
    d.C(cx, cy, 0.12, dome("#59616d"), 2.4, sw=d.dw)
    d.A(f"M{fmt(cx - 0.75)},{fmt(cy + 0.25)} A0.8,0.8 0 0 1 {fmt(cx + 0.55)},{fmt(cy - 0.6)}", "none", "#ffffff",
        2.0)
    d.A(f"M{fmt(cx + 0.38)},{fmt(cy - 0.72)} L{fmt(cx + 0.58)},{fmt(cy - 0.6)} L{fmt(cx + 0.46)},{fmt(cy - 0.4)}",
        "none", "#ffffff", 2.0)
    _no_entry(d, cx, 2.3)


def staff_door(d):
    """Staff only door on a wall edge, 2 by 1.2 m: leaf with card reader, magnetic lock and swing arc."""
    d.R(0.0, 0.0, 0.5, 0.3, C["wall"], st=None)
    d.R(1.5, 0.0, 0.5, 0.3, C["wall"], st=None)
    d.R(0.5, 0.06, 1.0, 0.18, "#d9463e", st=None, op=0.18)                                  # threshold tint
    d.R(0.52, 0.26, 0.06, 0.94, soft("#9aa3ad", "h"), 2.1, st=FX_OUT, sw=d.dw)             # open leaf
    d.A("M0.55,1.2 A0.95,0.95 0 0 0 1.5,0.25", "none", "#8f99a5", 0.8, extra='stroke-dasharray="0.06 0.05"')
    d.R(1.56, 0.32, 0.16, 0.2, "#1d2430", 1.3, rx=0.03, sw=d.dw)                           # card reader
    d.C(1.64, 0.38, 0.025, C["stop"], st=None)
    d.R(1.6, 0.44, 0.08, 0.05, C["glow"], st=None)
    d.R(1.18, 0.0, 0.3, 0.08, "#5d6672", st=None)                                          # magnetic lock


def customs_channel(d):
    """Customs exit, 4 by 4 m: green channel on the left, red channel with an inspection bench on the right."""
    d.R(0.1, 0.0, 1.8, 4.0, "#2f9d5a", st=None, op=0.22)
    d.R(2.1, 0.0, 1.8, 4.0, "#d9312b", st=None, op=0.18)
    d.R(0.1, 3.75, 1.8, 0.2, "#2f9d5a", st=None)
    d.R(2.1, 3.75, 1.8, 0.2, "#d9312b", st=None)
    _glass_wall(d, 2.0, 0.2, 3.6)
    _arrows(d, 1.0, 0.2, 3.6, "#2f9d5a")
    d.R(2.25, 0.9, 1.0, 1.9, lit(C["steel"], "h"), 0.9, rx=0.04)                          # inspection bench
    d.R(2.32, 1.0, 0.86, 0.8, "#e9edf1", st=None, rx=0.03)
    d.R(2.4, 1.9, 0.75, 0.7, soft(C["machine"], "v"), 1.3, rx=0.06)                        # small x-ray
    d.R(2.4, 2.18, 0.75, 0.14, "#141c26", st=None)
    office_chair(d, 3.6, 1.6, "#3a414b", 90)
    d.overhead(0.2, 0.15, 1.6, 0.3, "#2f9d5a", op=0.85)
    d.overhead(2.2, 0.15, 1.6, 0.3, "#d9312b", op=0.85)


# ================================================================================================================
# Zone overlay
# ================================================================================================================

ZONE_STYLE = {
    # key: (label, color, hatch)
    "public": ("Public, landside", "#3ea35a", False),
    "commercial": ("Commercial", "#2f9d8f", False),
    "secure": ("Secure, airside domestic", "#2f6fd1", False),
    "staff": ("Staff only", "#d9463e", True),
    "international": ("International, airside", "#7a4fd0", False),
}


def zone_defs():
    o = []
    for k, (_, col, hatch) in ZONE_STYLE.items():
        if hatch:
            o.append(f'<pattern id="zh_{k}" width="0.8" height="0.8" patternUnits="userSpaceOnUse" '
                     f'patternTransform="rotate(45)"><rect width="0.8" height="0.8" fill="{col}" '
                     f'fill-opacity="0.16"/><line x1="0" y1="0" x2="0" y2="0.8" stroke="{col}" '
                     f'stroke-width="0.22" stroke-opacity="0.45"/></pattern>')
    return "".join(o)


def zone_fill(k):
    col, hatch = ZONE_STYLE[k][1], ZONE_STYLE[k][2]
    return f"url(#zh_{k})" if hatch else col


def zone_rect(k, x, y, w, h):
    col, hatch = ZONE_STYLE[k][1], ZONE_STYLE[k][2]
    return (rect(x, y, w, h, zone_fill(k), op=None if hatch else 0.28)
            + rect(x + 0.12, y + 0.12, w - 0.24, h - 0.24, "none", col, 0.24, op=0.85))


def gate_badge(x, y, kind, r=0.9):
    """Transition badge on the overlay: circle in the target zone color with a one way arrow."""
    col = ZONE_STYLE[kind][1]
    return (circle(x, y, r, "#ffffff", col, 0.22)
            + path(f"M{fmt(x - r * 0.45)},{fmt(y)} H{fmt(x + r * 0.35)} M{fmt(x + r * 0.05)},{fmt(y - r * 0.32)} "
                   f"L{fmt(x + r * 0.4)},{fmt(y)} L{fmt(x + r * 0.05)},{fmt(y + r * 0.32)}", "none", col, 0.2,
                   extra='stroke-linecap="round" stroke-linejoin="round"'))


def breach_badge(x, y, r=0.9):
    return (circle(x, y, r, "#d9312b", "#ffffff", 0.18)
            + rect(x - 0.09, y - r * 0.55, 0.18, r * 0.7, "#ffffff") + circle(x, y + r * 0.45, 0.11, "#ffffff"))
