"""Detailed stand marking templates. Meters, head of stand at the bottom (larger y), taxilane at the top."""
import math
from lib import *
import air2
from specs2 import SPECS

YEL, RED, WHT, ORG, BLK = "#f2c230", "#d9312b", "#f4f6f8", "#f28c28", "#141414"
PH = 92


def mtext(x, y, s_, size=1.2, fill=BLK, anchor="middle", weight="bold", rot=None):
    extra = f'transform="rotate({rot} {fmt(x)} {fmt(y)})"' if rot is not None else ""
    return text(x, y, s_, size, fill, weight, anchor, extra=extra)


def taxilane(y, x0, x1):
    return rect(x0, y - 7, x1 - x0, 14, "url(#pAsph)") + line(x0, y, x1, y, YEL, 0.3) \
        + line(x0, y - 6.8, x1, y - 6.8, YEL, 0.15) + line(x0, y + 6.8, x1, y + 6.8, YEL, 0.15)


def road(y0, x0, x1, crossings=()):
    o = rect(x0, y0, x1 - x0, 6.4, "url(#pAsph)")
    o += line(x0, y0 + 0.25, x1, y0 + 0.25, WHT, 0.2) + line(x0, y0 + 6.15, x1, y0 + 6.15, WHT, 0.2)
    o += line(x0, y0 + 3.2, x1, y0 + 3.2, WHT, 0.15, dash="2 2")
    for cx in crossings:
        for k in range(6):
            o += rect(cx - 1.6, y0 + 0.6 + k * 0.95, 3.2, 0.5, WHT)
    # direction arrows
    for ax, d in ((x0 + 6, 1), (x1 - 6, -1)):
        yy = y0 + 1.7 if d > 0 else y0 + 4.7
        o += line(ax - 1.4 * d, yy, ax + 0.6 * d, yy, WHT, 0.25) + poly([(ax + 1.4 * d, yy), (ax + 0.5 * d, yy - 0.5), (ax + 0.5 * d, yy + 0.5)], WHT)
    return o


def building(y0, x0, x1):
    return rect(x0, y0, x1 - x0, PH - y0, "#9aa4b2") + rect(x0, y0, x1 - x0, 0.6, "#9fd3ea")


def hatch_poly(pts, color=RED, step=1.0, sw=0.14, outline=0.22, cid="h"):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    lines = []
    k = x0 - (y1 - y0)
    while k < x1:
        lines.append(line(k, y1, k + (y1 - y0), y0, color, sw))
        k += step
    P_ = " ".join(f"{fmt(x)},{fmt(y)}" for x, y in pts)
    return (f'<clipPath id="{cid}"><polygon points="{P_}"/></clipPath><g clip-path="url(#{cid})">{"".join(lines)}</g>'
            + poly(pts, "none", color, outline))


def era(cx, top, wide_half, neck_y, neck_half, head_y, color=RED, dashed=False):
    """Equipment restraint area: double line, solid outer and dashed inner, narrowing at the nose."""
    def pts(off):
        return [(cx - wide_half + off, top + off), (cx + wide_half - off, top + off), (cx + wide_half - off, neck_y - 4),
                (cx + neck_half - off, neck_y), (cx + neck_half - off, head_y), (cx - neck_half + off, head_y),
                (cx - neck_half + off, neck_y), (cx - wide_half + off, neck_y - 4)]
    if dashed:
        return poly(pts(0), "none", color, 0.22, extra='stroke-dasharray="1.6 1"')
    return poly(pts(0), "none", color, 0.28) + poly(pts(0.7), "none", color, 0.16, extra='stroke-dasharray="1.2 0.8"')


def wingtip_line(x, y0, y1):
    return line(x, y0, x, y1, RED, 0.2, dash="2.2 1.4")


def ladder(cx, rows, color_bar=YEL, both=True, box_w=5.8):
    """Stop position ladder: a yellow stop bar across the centerline per type, black boxes with white type text."""
    o = []
    for y, lab in rows:
        o.append(line(cx - 1.3, y, cx + 1.3, y, color_bar, 0.35))
        for sg in ((-1, 1) if both else (-1,)):
            bx = cx + sg * 1.6 - (box_w if sg < 0 else 0)
            o.append(rect(bx, y - 0.65, box_w, 1.3, BLK, None, rx=0.12))
            o.append(mtext(bx + box_w / 2, y + 0.36, lab, 0.88, WHT))
    return "".join(o)


def num_box(cx, cy, label, w=4.4, h=2.4, fill=YEL, fg=BLK):
    return rect(cx - w / 2, cy - h / 2, w, h, fill, BLK, 0.12, rx=0.2) + mtext(cx, cy + 0.6, label, 1.7, fg)


def lead_in(cx, lane_y, turn_y, stop_y, color=YEL, dash=None, sides=("L", "R"), x_left=0, x_right=50):
    o = []
    extra = f'stroke-dasharray="{dash}"' if dash else ""
    for sd in sides:
        xs = x_left if sd == "L" else x_right
        d = f"M{fmt(xs)},{fmt(lane_y)} C{fmt(cx)},{fmt(lane_y)} {fmt(cx)},{fmt(lane_y)} {fmt(cx)},{fmt(turn_y)}"
        o.append(path(d, "none", color, 0.3, extra=extra))
    o.append(line(cx, turn_y, cx, stop_y, color, 0.3, dash=dash))
    return "".join(o)


def fuel_pit(x, y):
    return rect(x - 0.55, y - 0.55, 1.1, 1.1, RED, BLK, 0.08) + circle(x, y, 0.28, "#333333") + mtext(x, y + 1.9, "FUEL", 0.9, WHT)


def gpu_pit(x, y):
    return rect(x - 0.45, y - 0.45, 0.9, 0.9, YEL, BLK, 0.08) + mtext(x, y + 1.7, "GPU", 0.8, YEL)


def extinguisher(x, y):
    return circle(x, y, 0.75, RED, WHT, 0.15) + mtext(x, y + 0.35, "F", 0.9, WHT)


def gse_parking(x0, y0, w, h, label="GSE"):
    o = [rect(x0, y0, w, h, "none", WHT, 0.18)]
    k = 0
    while k < w - 0.5:
        o.append(line(x0 + k, y0 + h, x0 + k + 1.6, y0 + h - 2.6, WHT, 0.15))
        k += 2.2
    o.append(mtext(x0 + w / 2, y0 + 1.4, label, 1.0, WHT))
    return "".join(o)


def push_limit(cx, y, label="PUSH LIMIT"):
    return line(cx - 3.5, y, cx + 3.5, y, WHT, 0.3) + mtext(cx + 4.2, y + 0.4, label, 0.9, WHT, "start")


def jet_bridge(x_root, y_root, x_tip, y_tip, wdt=3.0):
    ang = math.atan2(y_tip - y_root, x_tip - x_root)
    nx, ny = -math.sin(ang) * wdt / 2, math.cos(ang) * wdt / 2
    o = poly([(x_root + nx, y_root + ny), (x_tip + nx, y_tip + ny), (x_tip - nx, y_tip - ny), (x_root - nx, y_root - ny)],
             "#7b8796", "#4e5866", 0.15)
    o += circle(x_root, y_root, 2.2, "#6b7684", "#4e5866", 0.15)
    o += rect(x_tip - 2.0, y_tip - 1.6, 4.0, 3.2, "#5c6674", "#3c4552", 0.15, rx=0.4)
    return o


def vdgs(cx, y):
    return rect(cx - 1.6, y, 3.2, 1.6, BLK) + mtext(cx, y + 1.15, "STOP", 0.9, YEL)


def place_ac(key, cx, y_nose, px=12):
    return g(air2.render(SPECS[key], 2, px, shadow=True), f"translate({fmt(cx)} {fmt(y_nose)}) rotate(180)")


def veh(x, y, w, h, color, cab="#2b3340", cab_at="top"):
    o = rect(x, y, w, h, color, "#2b3340", 0.12, rx=0.25)
    if cab_at == "top":
        o += rect(x + 0.15, y + 0.15, w - 0.3, min(1.4, h * 0.3), cab, None, rx=0.2)
    else:
        o += rect(x + 0.15, y + h - 0.15 - min(1.4, h * 0.3), w - 0.3, min(1.4, h * 0.3), cab, None, rx=0.2)
    return o


# ----------------------------------------------------------------------------- stand A: contact, code C
def stand_contact(occupied, tag):
    Wm, cx = 50, 25
    o = [rect(0, 0, Wm, PH, "url(#pConc)"), taxilane(7, 0, Wm), road(79, 0, Wm, crossings=(5,)), building(85.4, 0, Wm)]
    o.append(wingtip_line(1.2, 15, 79) + wingtip_line(Wm - 1.2, 15, 79))
    o.append(era(cx, 17, 22.2, 64, 6.5, 79))
    o.append(lead_in(cx, 7, 22, 74.2, x_right=Wm))
    o.append(num_box(cx, 27, "12"))
    o.append(push_limit(cx, 44))
    o.append(ladder(cx, [(70.0, "A319"), (71.6, "A320 B738"), (73.2, "A321 B739"), (74.8, "B38M B39M")]))
    o.append(fuel_pit(cx - 9.6, 57.7) + fuel_pit(cx + 9.6, 57.7))
    o.append(gpu_pit(cx + 3.0, 66.5))
    o.append(hatch_poly([(cx + 5.2, 66), (cx + 14.5, 66), (cx + 14.5, 78.6), (cx + 5.2, 78.6)], cid=f"hb{tag}"))
    o.append(mtext(cx + 9.85, 64.9, "NO PARKING", 0.9, RED))
    o.append(hatch_poly([(2.2, 66), (2.2, 78.6), (14.6, 78.6)], cid=f"he{tag}"))
    o.append(mtext(2.4, 64.9, "EMERGENCY EQUIPMENT ONLY", 0.85, RED, "start"))
    o.append(gse_parking(40.6, 66.2, 7.6, 12.2))
    o.append(extinguisher(16.6, 77.6) + extinguisher(cx + 16.6 if cx + 16.6 < 40 else 39.2, 64.2))
    o.append(num_box(cx - 6.6, 83.0 - 0.0, "12", 3.4, 2.0, BLK, YEL) if False else "")
    o.append(vdgs(cx, 85.9))
    if occupied:
        nose = 70.2 + 5.07 + 1.6
        o.append(place_ac("a320neo", cx, nose))
        o.append(jet_bridge(cx + 12, 87, cx + 3.9, nose - 5.0))
        o.append(veh(cx - 4.4, 66.6, 1.8, 5.0, "#e3e7eb"))           # belt loader at the forward hold, right side
        for k in range(3):
            o.append(rect(cx - 11.6, 61.0 + k * 3.2, 2.0, 2.8, "#8e99a8", "#2b3340", 0.1, rx=0.2))
        o.append(veh(cx - 11.6, 70.8, 2.0, 3.0, "#d9463e"))          # baggage tractor
        o.append(veh(cx - 10.2, 51.2, 2.4, 4.4, "#f2c230"))          # hydrant dispenser behind the wing, hose to the pit
        o.append(rect(cx - 9.6, 47.0, 7.4, 2.6, "#e9eef4", "#2b3340", 0.12, rx=0.25) + rect(cx - 9.45, 47.15, 1.4, 2.3, "#2b3340", None, rx=0.2))  # catering at R2
        o.append(veh(cx + 1.6, 77.6, 2.0, 1.4, "#3d6b8a"))          # GPU
    else:
        o.append(mtext(cx, 79 - 0.8, "", 1))
    return Wm, "".join(o)


# ----------------------------------------------------------------------------- stand B: MARS
def stand_mars(occupied, tag):
    Wm, cx = 82, 41
    o = [rect(0, 0, Wm, PH, "url(#pConc)"), taxilane(7, 0, Wm), road(80.4, 0, Wm, crossings=(4, 78)), building(86.8, 0, Wm)]
    o.append(wingtip_line(1.0, 15, 80.4) + wingtip_line(Wm - 1.0, 15, 80.4))
    o.append(era(cx, 13.5, 33.8, 66, 7.5, 80.4))
    xl, xr = cx - 19.5, cx + 19.5
    for xa in (xl, xr):
        o.append(era(xa, 34, 19.4, 68, 5.5, 80.4, dashed=True))
    o.append(lead_in(cx, 7, 20, 76.6, x_right=Wm))
    o.append(lead_in(xl, 7, 26, 76.4, ORG, "1.6 1", sides=("L",)))
    o.append(lead_in(xr, 7, 26, 76.4, ORG, "1.6 1", sides=("R",), x_right=Wm))
    o.append(num_box(cx, 22, "21"))
    o.append(num_box(xl, 30, "21L", 5.0, 2.4, ORG))
    o.append(num_box(xr, 30, "21R", 5.0, 2.4, ORG))
    o.append(ladder(cx, [(71.0, "B788 A332"), (72.6, "B789 A333"), (74.2, "A359 B77W"), (75.8, "A35K B744")], box_w=6.2))
    for xa in (xl, xr):
        o.append(ladder(xa, [(73.8, "A320 B738"), (75.4, "A321 B739")], ORG, both=False, box_w=5.8))
    o.append(fuel_pit(cx - 13, 50) + fuel_pit(cx + 13, 50) + fuel_pit(xl - 9.0, 61.4) + fuel_pit(xr + 9.0, 61.4))
    o.append(gpu_pit(cx + 3.2, 68.5))
    o.append(push_limit(cx, 36))
    o.append(hatch_poly([(cx + 7.6, 68.4), (cx + 26, 68.4), (cx + 26, 80.0), (cx + 7.6, 80.0)], cid=f"hb{tag}"))
    o.append(mtext(cx + 16.8, 67.3, "NO PARKING", 0.95, RED))
    o.append(hatch_poly([(1.6, 68.4), (1.6, 80.0), (13.2, 80.0)], cid=f"he{tag}"))
    o.append(mtext(1.9, 67.3, "EMERGENCY EQUIPMENT ONLY", 0.85, RED, "start"))
    o.append(gse_parking(Wm - 13.6, 68.6, 12.0, 11.2))
    o.append(extinguisher(16.2, 78.8) + extinguisher(cx - 9.5, 78.8))
    o.append(vdgs(cx, 87.3) + vdgs(xl, 87.3) + vdgs(xr, 87.3))
    if occupied:
        for xa in (xl, xr):
            nose = 73.8 + 5.07 + 1.6
            o.append(place_ac("a320neo", xa, nose))
        o.append(jet_bridge(xl + 11, 88.2, xl + 3.9, 73.8 + 1.6))
        o.append(jet_bridge(xr + 11, 88.2, xr + 3.9, 73.8 + 1.6))
        for xa in (xl, xr):
            o.append(veh(xa - 4.4, 70.4, 1.8, 5.0, "#e3e7eb"))
            o.append(veh(xa - 10.2, 55.0, 2.4, 4.4, "#f2c230"))
    return Wm, "".join(o)


# ----------------------------------------------------------------------------- stand C: remote taxi through
def stand_remote(occupied, tag):
    Wm, cx = 46, 21
    o = [rect(0, 0, Wm, PH, "url(#pAsph)"), taxilane(8, 0, Wm), taxilane(84, 0, Wm)]
    o.append(wingtip_line(1.0, 16, 76) + wingtip_line(Wm - 1.0, 16, 76))
    o.append(era(cx, 22, 17.6, 64, 17.6, 70))
    d = (f"M0,8 C{cx},8 {cx},8 {cx},22 L{cx},70 C{cx},84 {cx},84 {Wm},84")
    o.append(path(d, "none", YEL, 0.3))
    o.append(poly([(cx - 1.1, 72.5), (cx + 1.1, 72.5), (cx, 74.9)], YEL))
    o.append(num_box(cx, 17, "R9"))
    o.append(ladder(cx, [(60.4, "AT45 AT46"), (62.0, "AT76 DH8D")], both=True, box_w=4.8))
    o.append(circle(cx, 67.6, 1.0, "none", WHT, 0.22) + mtext(cx, 68.0, "M", 1.1, WHT))
    o.append(rect(cx - 11.05, 48.4, 3.6, 11.0, "none", WHT, 0.18, extra='stroke-dasharray="1 0.6"') + mtext(cx - 9.25, 47.6, "FUEL TRUCK", 0.8, WHT))
    o.append(extinguisher(cx + 14.5, 64.5))
    door_y = 37.6
    o.append(rect(cx + 2.2, door_y - 1.3, Wm - cx - 6.2, 2.6, "none", WHT, 0.15))
    k = cx + 2.8
    while k < Wm - 4.6:
        o.append(rect(k, door_y - 1.3, 0.55, 2.6, WHT))
        k += 1.2
    o.append(hatch_poly([(Wm - 3.8, door_y - 8.4), (Wm - 0.2, door_y - 8.4), (Wm - 0.2, door_y + 8.4), (Wm - 3.8, door_y + 8.4)], cid=f"hbus{tag}"))
    o.append(mtext(Wm - 1.7, door_y, "BUS ONLY", 0.9, RED, rot=-90))
    if occupied:
        o.append(place_ac("at76", cx, 62.0 + 4.0))
        o.append(veh(Wm - 2.9, door_y - 6.6, 2.4, 12, "#2f6fdd"))
        o.append(veh(cx - 12.8, 47.3, 2.4, 6.4, "#f2c230"))
    return Wm, "".join(o)


def stand_ga(occupied, tag):
    import surfaces as H
    return H.stand_d()
