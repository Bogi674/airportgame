"""Baggage nodes from docs/BAGGAGE.md section 7, in the fixture kit style.

Ramp stubs (in, out, departure, arrival, idle, unconnected), screening machine with both ramps, baggage bay with
truck slots, staging lane, carousel with its feed ramp, the under floor link band and the node buffer ring.
Local frame as the other fixture modules. A ramp cell is 2 by 2 m with its node at the bottom edge.
"""
import math
from lib import fmt, rect, circle, line, poly, path, g, text
from fixture_core import D, C, FX_OUT, soft, lit, dome, shade, monitor, office_chair, status_light, _GRADS, suitcase

DEP, ARR, IDLE, WARN = "#3b82c4", "#e0a030", "#9aa3ad", "#d9534f"
BAG_COLS = ["#2f5aa8", "#c0392b", "#2f7f86", "#7a4f7f", "#d4a23a", "#20252c", "#59616d", "#e86a8f"]


def _ramp_grad():
    if "gRamp" not in _GRADS:
        _GRADS["gRamp"] = ('<linearGradient id="gRamp" x1="0" y1="1" x2="0" y2="0">'
                           '<stop offset="0" stop-color="#4a5058"/><stop offset="0.4" stop-color="#4a5058"/>'
                           '<stop offset="1" stop-color="#14181d"/></linearGradient>')
    fc_spec = __import__("fixture_core")
    fc_spec.SPEC["url(#gRamp)"] = {"g": "ramp"}
    fc_spec.BASE["url(#gRamp)"] = "#4a5058"
    return "url(#gRamp)"


def ramp(d, out=True, flow="dep", connected=True):
    """One ramp cell. Belt 0.8 m wide centered on x = 1, flat for 0.8 m from the node edge (bottom), sloping for
    0.8 m, ending at a 0.4 m slot. out: bags sink away from the node; in: bags rise toward the node."""
    bx, bw = 0.6, 0.8
    d.R(bx + 0.9, 0.45, 0.3, 1.55, "#000000", st=None, op=0.12)                               # side shadow
    d.R(bx - 0.1, 0.4, 0.1, 1.6, "#c5ccd4", 0.3, st=None)
    d.R(bx + bw, 0.4, 0.1, 1.6, "#c5ccd4", 0.3, st=None)
    d.R(bx, 0.4, bw, 1.6, _ramp_grad(), 0.3, st=None)
    d.R(bx - 0.2, 0.0, bw + 0.4, 0.2, C["wall"], st=None)                                     # frame
    d.R(bx - 0.2, 0.0, 0.2, 0.6, C["wall"], st=None)
    d.R(bx + bw, 0.0, 0.2, 0.6, C["wall"], st=None)
    d.R(bx, 0.2, bw, 0.4, C["slot"], st=None)
    d.R(bx, 0.6, bw, 0.1, "#9aa3ad", st=None)                                                  # steel lip
    k = 0.8
    while k < 1.95:
        d.L(bx + 0.05, k, bx + bw - 0.05, k, "#5a616a", 0.5, cap="butt")
        k += 0.2
    col = {"dep": DEP, "arr": ARR}.get(flow, IDLE) if connected else IDLE
    for cy in (1.62, 1.08):
        if out:
            dpath = f"M{fmt(bx + 0.22)},{fmt(cy + 0.1)} L{fmt(bx + 0.4)},{fmt(cy - 0.08)} L{fmt(bx + 0.58)},{fmt(cy + 0.1)}"
        else:
            dpath = f"M{fmt(bx + 0.22)},{fmt(cy - 0.1)} L{fmt(bx + 0.4)},{fmt(cy + 0.08)} L{fmt(bx + 0.58)},{fmt(cy - 0.1)}"
        d.A(dpath, "none", col, 2.2)
    if not connected:
        d.R(0.05, 0.05, 1.9, 1.9, "none", st=WARN, sw=0.1, extra='stroke-dasharray="0.25 0.18"')


def bag(d, cx, cy, k=0, rot=0):
    w, h = 0.62, 0.42
    d.R(cx - w / 2, cy - h / 2, w, h, soft(BAG_COLS[k % len(BAG_COLS)], "v"), 0.35, rx=0.06, sw=d.dw)
    d.R(cx - 0.08, cy - h / 2 - 0.03, 0.16, 0.05, "#2a313b", st=None, rx=0.01)
    d.R(cx + w / 2 - 0.12, cy - 0.08, 0.06, 0.16, "#f4f6f8", st=None)                           # bag tag


def screening_machine(d, with_ramps=True):
    """4 by 2 m tunnel with dark openings and curtains, console beside it. With ramps the node is 8 by 2 m:
    in ramp cell on the left, machine in the middle, out ramp cell on the right, one straight belt axis."""
    x0 = 2.0 if with_ramps else 0.0
    if with_ramps:
        d.place(ramp, 0, 2.0, 270, False, "dep")                                      # in ramp, left
        d.place(ramp, x0 + 6.0, 0, 90, True, "dep")                                     # out ramp, right
    d.R(x0 - 0.05, 0.6, 4.1, 0.8, lit(C["belt"]), 0.6, st=None)                               # belt through
    d.R(x0 + 0.5, 0.15, 3.0, 1.7, soft(C["machine"], "v"), 1.7, rx=0.12)
    d.R(x0 + 0.62, 0.27, 2.76, 1.46, lit(shade(C["machine"], 0.06)), st=None, rx=0.08)
    for xe in (x0 + 0.5, x0 + 3.36):
        d.R(xe, 0.55, 0.14, 0.9, "#141c26", st=None, rx=0.02)
        for k in range(6):
            yy = 0.6 + k * 0.15
            d.L(xe + 0.02, yy, xe + 0.12, yy, "#3a4250", 1.0, cap="butt")
    d.R(x0 + 1.7, 1.55, 0.6, 0.1, C["hazard"], st=None)
    status_light(d, x0 + 0.85, 0.42, C["ok"], 0.03)


def screening_console(d):
    """Operator console 0.8 by 0.6 m with two screens and a chair."""
    d.R(0, 0, 0.8, 0.6, lit(C["laminate"]), 0.95, rx=0.04)
    monitor(d, 0.22, 0.2, 0.3, "down", 1.3)
    monitor(d, 0.58, 0.2, 0.3, "down", 1.3)
    office_chair(d, 0.4, 0.92, "#3a414b", 180)


def baggage_bay(d, cells=4, bay_no=1):
    """Bay 2 * cells m wide and 8 m deep. Ramps in the back row (top), makeup belt, slots of 4 m, truck edge at the
    bottom on the exterior wall with a hazard stripe and a dashed roll up door per slot."""
    W, Dp = 2.0 * cells, 8.0
    d.R(0, 0, W, Dp, "#8d949c", st=None)
    d.R(0.15, 0.15, W - 0.3, Dp - 0.3, "none", st=C["hazard"], sw=0.15)
    d.place(ramp, 0, 0, 0, False, "dep")                                                      # in ramp, node below
    d.place(ramp, W - 2.0, 0, 0, True, "arr")                                                 # out ramp
    d.R(0.6, 2.0, W - 1.2, 0.85, lit(C["belt"]), 0.7, st=C["steelDk"], sw=d.dw)                 # makeup belt
    d.R(0.6, 2.0, W - 1.2, 0.1, "#c5ccd4", 0.75, st=None)
    d.R(0.6, 2.75, W - 1.2, 0.1, "#c5ccd4", 0.75, st=None)
    for k in range(int((W - 1.6) / 0.8)):
        if k % 3 != 2:
            bag(d, 1.1 + k * 0.8, 2.43, k)
    slots = int(W // 4)
    for s in range(slots):
        sx = s * 4.0
        for xx in (sx + 0.5, sx + 3.5):
            d.L(xx, 3.4, xx, Dp - 0.4, "#f2c230", 1.4, cap="butt")
        d.R(sx + 1.2, 3.6, 1.6, 0.9, "none", st="#f4f6f8", sw=0.06)
        d.T(sx + 2.0, 4.2, f"S{s + 1}", 0.5, "#f4f6f8")
    d.T(W / 2, 1.6, f"BAY {bay_no}", 0.9, "#f2c230")
    for k in range(int(W / 0.3)):
        d.R(k * 0.3, Dp - 0.3, 0.15, 0.3, C["hazard"] if k % 2 == 0 else C["black"], st=None)
    for s in range(slots):
        d.L(s * 4.0 + 0.3, Dp - 0.05, s * 4.0 + 3.7, Dp - 0.05, "#f4f6f8", 1.2,
            dash=f"{fmt(5 / d.px)} {fmt(3 / d.px)}")


def staging_lane(d):
    """4 by 16 m apron lane in front of a slot: white outline, hatching at its base, BAGS."""
    d.R(0.1, 0.1, 3.8, 15.8, "none", st="#f4f6f8", sw=0.15)
    for k in range(5):
        d.L(0.2 + k * 0.8, 15.8, 0.9 + k * 0.8, 14.6, "#f4f6f8", sw=0.12)
    d.T(2.0, 14.3, "BAGS", 0.8, "#f4f6f8")


def carousel(d):
    """Arrival carousel 20 by 4 m with an inclined plate loop and an island; feed ramp cell outside the left end."""
    d.R(0, 0, 20, 4, soft("#c3cad2", "v"), 0.75, rx=2.0)
    d.R(0.35, 0.35, 19.3, 3.3, "#59616d", st=None, rx=1.65)
    k = 0.0
    per = 2 * 15.0 + 2 * math.pi * 1.4
    step = 0.45
    while k < per:
        if k < 15.0:
            x, y, a = 2.5 + k, 0.65, 0
        elif k < 15.0 + math.pi * 1.4:
            t = (k - 15.0) / 1.4
            x, y, a = 17.5 + 1.35 * math.sin(t), 2.0 - 1.35 * math.cos(t), 0
        elif k < 30.0 + math.pi * 1.4:
            x, y, a = 17.5 - (k - 15.0 - math.pi * 1.4), 3.35, 0
        else:
            t = (k - 30.0 - math.pi * 1.4) / 1.4
            x, y, a = 2.5 - 1.35 * math.sin(t), 2.0 + 1.35 * math.cos(t), 0
        d.C(x, y, 0.035, "#8c96a2", st=None)
        k += step
    d.R(1.3, 1.3, 17.4, 1.4, soft("#e3e7eb", "v"), 0.9, rx=0.7)                              # island
    d.R(1.5, 1.5, 17.0, 1.0, lit("#cfd5dc"), st=None, rx=0.5)
    for i, (x, y) in enumerate(((4.0, 0.65), (6.2, 0.65), (9.6, 0.65), (14.0, 3.35), (11.2, 3.35), (7.5, 3.35),
                                (17.9, 1.0))):
        bag(d, x, y, i + 2)
    d.R(0.0, 1.6, 1.2, 0.8, lit(C["belt"]), 0.6, st=C["steelDk"], sw=d.dw)                   # feed belt
    d.T(10.0, 2.25, "1", 0.8, "#2f4a6e")


def carousel_with_ramp(d):
    d.place(ramp, 0.0, 3.0, 270, False, "arr")
    d.place(carousel, 2.0, 0.0)


# ---------------------------------------------------------------------------------------------------------------
# Overlay pieces, drawn in world meters by the overlay layer (not baked into fixtures)
# ---------------------------------------------------------------------------------------------------------------

def link_band(pts, color, solid=True, op=0.7, load=None):
    """Under floor link: 0.8 m band along a polyline, 0.1 m dashed edges, chevrons every 1.6 m in the flow
    direction. solid chevrons for departures, hollow for arrivals. load overrides the color (green, amber, red)."""
    if load is not None:
        color = "#3ea35a" if load < 0.6 else ("#f2a93b" if load <= 0.9 else "#d9312b")
    o = []
    dstr = "M" + " L".join(f"{fmt(x)},{fmt(y)}" for x, y in pts)
    o.append(path(dstr, "none", color, 0.8, extra=f'stroke-opacity="0.35" stroke-linejoin="round"'))
    o.append(path(dstr, "none", color, 0.96, extra='stroke-dasharray="0.25 0.18" stroke-opacity="0.9" '
                                                   'stroke-linejoin="round"'))
    o.append(path(dstr, "none", "#ffffff", 0.76, extra='stroke-opacity="1" stroke-linejoin="round"'))
    o.append(path(dstr, "none", color, 0.76, extra='stroke-opacity="0.32" stroke-linejoin="round"'))
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 0.1:
            continue
        ux, uy = (x1 - x0) / L, (y1 - y0) / L
        nx, ny = -uy, ux
        t = 0.8
        while t < L - 0.4:
            cx, cy = x0 + ux * t, y0 + uy * t
            tip = (cx + ux * 0.22, cy + uy * 0.22)
            a = (cx - ux * 0.08 + nx * 0.24, cy - uy * 0.08 + ny * 0.24)
            b = (cx - ux * 0.08 - nx * 0.24, cy - uy * 0.08 - ny * 0.24)
            if solid:
                o.append(poly([a, tip, b, (cx + ux * 0.04, cy + uy * 0.04)], color))
            else:
                o.append(path(f"M{fmt(a[0])},{fmt(a[1])} L{fmt(tip[0])},{fmt(tip[1])} L{fmt(b[0])},{fmt(b[1])}",
                              "none", color, 0.09, extra='stroke-linecap="round" stroke-linejoin="round"'))
            t += 1.6
    return g(o, None, f'opacity="{op}"')


def buffer_ring(cx, cy, r, fill_frac, color=None):
    color = color or ("#3ea35a" if fill_frac < 0.6 else ("#f2a93b" if fill_frac <= 0.9 else "#d9312b"))
    a = 2 * math.pi * min(fill_frac, 0.999)
    x1, y1 = cx + r * math.sin(a), cy - r * math.cos(a)
    large = 1 if a > math.pi else 0
    return (circle(cx, cy, r, "none", "#1d2430", 0.3, op=0.35)
            + path(f"M{fmt(cx)},{fmt(cy - r)} A{fmt(r)},{fmt(r)} 0 {large} 1 {fmt(x1)},{fmt(y1)}", "none", color,
                   0.3, extra='stroke-linecap="round"'))
