"""Contact stand for scenes: the stand markings of docs/art/surfaces_stands.png (stands2 primitives) with the jet
bridge of DESIGN_REVISION_3 section 4.2 (fixed link from a gate door, rotunda in the bridge zone, telescoping tunnel,
cab at the door), the aircraft in the composite look of docs/art/aircraft_style.png, and ground equipment that passes
gse.check.

Stand local frame as in stands2: meters, taxilane at the top (small y), head of stand and building at the bottom,
aircraft nose pointing down. A scene places the whole stand with one rotation, so every shadow is baked toward the
world sun with sun_local().
"""
import math
from shapely.geometry import Polygon, Point, box
from lib import fmt, rect, circle, line, poly, path, g, text
import stands2 as S2
import stands3 as S3
import gse
import air2
from specs2 import SPECS

WORLD_SUN_AC = (0.9, 1.3)       # aircraft, ART_AND_ASSETS section 1
WORLD_SUN_VEH = (0.25, 0.35)    # vehicles and people
BRIDGE_H = 4.2                  # tunnel height used for its shadow


def rot_vec(v, deg):
    a = math.radians(deg)
    return (v[0] * math.cos(a) - v[1] * math.sin(a), v[0] * math.sin(a) + v[1] * math.cos(a))


def sun_local(world, total_rot):
    """Offset to bake in a frame that the scene rotates by total_rot degrees, so it lands on the world sun."""
    return rot_vec(world, -total_rot)


# ----------------------------------------------------------------------------------------------------------------
# Jet bridge, revision 3 section 4.2
# ----------------------------------------------------------------------------------------------------------------

def jet_bridge(door_pt, rotunda, tip, sun=(0.72, -0.52), wdt=2.7):
    """door_pt: where the fixed link leaves the gate door. rotunda: rotation point inside the bridge zone.
    tip: cab center at the aircraft door. Returns (svg, shapely footprint). The fixed link runs straight from the
    door to the rotunda, the tunnel from the rotunda to the cab."""
    (dx, dy), (rx, ry), (tx, ty) = door_pt, rotunda, tip
    sx, sy = sun
    o_sh, o = [], []

    def seg(x0, y0, x1, y1, w):
        a = math.atan2(y1 - y0, x1 - x0)
        nx, ny = -math.sin(a) * w / 2, math.cos(a) * w / 2
        return [(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)]

    link = seg(dx, dy, rx, ry, 2.4)
    ang = math.atan2(ty - ry, tx - rx)
    L = math.hypot(tx - rx, ty - ry)
    cab_l, cab_w = 2.6, 3.2
    tun = seg(rx, ry, rx + (L - cab_l / 2) * math.cos(ang), ry + (L - cab_l / 2) * math.sin(ang), wdt)
    cab = seg(tx - cab_l / 2 * math.cos(ang), ty - cab_l / 2 * math.sin(ang),
              tx + cab_l / 2 * math.cos(ang), ty + cab_l / 2 * math.sin(ang), cab_w)
    for pts in (link, tun, cab):
        o_sh.append(poly([(x + sx, y + sy) for x, y in pts], "#000"))
    o_sh.append(circle(rx + sx, ry + sy, 2.0, "#000"))
    o.append(g(o_sh, None, 'opacity="0.28" filter="url(#fShadow)"'))
    # fixed link with roof ribs
    o.append(poly(link, "#c9ced4", "#5d6672", 0.06))
    n = int(math.hypot(rx - dx, ry - dy) / 1.2)
    for k in range(1, n):
        t = k / n
        a0 = math.atan2(ry - dy, rx - dx)
        px_, py_ = dx + (rx - dx) * t, dy + (ry - dy) * t
        o.append(line(px_ - math.sin(a0) * 1.1, py_ + math.cos(a0) * 1.1, px_ + math.sin(a0) * 1.1,
                      py_ - math.cos(a0) * 1.1, "#b4bbc3", 0.05))
    # telescoping tunnel: three nested sections, each a little narrower toward the cab
    a_n = (-math.sin(ang), math.cos(ang))
    sec = [(0.0, 0.42, wdt), (0.42, 0.74, wdt - 0.2), (0.74, 1.0, wdt - 0.4)]
    Lt = L - cab_l / 2
    for k, (t0, t1, w) in enumerate(sec):
        p0 = (rx + Lt * t0 * math.cos(ang), ry + Lt * t0 * math.sin(ang))
        p1 = (rx + Lt * t1 * math.cos(ang), ry + Lt * t1 * math.sin(ang))
        pts = seg(p0[0], p0[1], p1[0], p1[1], w)
        o.append(poly(pts, ["#d5dae0", "#dde1e6", "#e4e8ec"][k], "#5d6672", 0.06))
        o.append(line(p0[0] + a_n[0] * w * 0.32, p0[1] + a_n[1] * w * 0.32, p1[0] + a_n[0] * w * 0.32,
                      p1[1] + a_n[1] * w * 0.32, "#ffffff", 0.08, op=0.7))
    # wheel bogie under the outer section, drawn as two dark pads beside the tunnel
    bp = (rx + Lt * 0.8 * math.cos(ang), ry + Lt * 0.8 * math.sin(ang))
    for sg in (-1, 1):
        o.append(circle(bp[0] + a_n[0] * sg * (wdt / 2 + 0.35), bp[1] + a_n[1] * sg * (wdt / 2 + 0.35), 0.35,
                        "#2b3340"))
    # cab with the dark bumper on the aircraft side
    o.append(poly(cab, "#bfc5cc", "#5d6672", 0.06))
    fx, fy = tx + cab_l / 2 * math.cos(ang), ty + cab_l / 2 * math.sin(ang)
    o.append(poly(seg(fx - 0.3 * math.cos(ang), fy - 0.3 * math.sin(ang), fx, fy, cab_w - 0.2), "#3a414b"))
    # rotunda
    o.append(circle(rx, ry, 2.0, "#bfc5cc", "#5d6672", 0.06))
    o.append(circle(rx, ry, 1.25, "none", "#9aa3ad", 0.05))
    o.append(circle(rx, ry, 0.5, "#9aa3ad", None))
    fp = Polygon(link).union(Polygon(tun)).union(Polygon(cab)).union(Point(rx, ry).buffer(2.0))
    return "".join(o), fp


# ----------------------------------------------------------------------------------------------------------------
# Contact stand, code C, access type 1 (bridge on the left of the nose, seen from the pilot)
# ----------------------------------------------------------------------------------------------------------------

def contact_stand(tag, total_rot, number="22", occupied=True, x_ext=3.0, facade_y=85.8, crossings=(6.0, 46.0),
                  livery=("#c8102e", "#1f3864"), handler="#f28c28"):
    """Returns dict with svg layers (marks, vehicles, bridge, aircraft) in stand local meters, plus the world
    position of the gate door (local) for the scene to line up its terminal door."""
    Wm, cx = 50.0, 25.0
    m = []
    m.append(rect(-x_ext, 0, Wm + 2 * x_ext, 79, "url(#pConc)"))
    m.append(S2.taxilane(7, -x_ext, Wm + x_ext))
    m.append(S2.road(79, -x_ext, Wm + x_ext, crossings=crossings))
    m.append(rect(-x_ext, 85.4, Wm + 2 * x_ext, facade_y - 85.4, "#8f979f"))
    m.append(S2.wingtip_line(1.2, 15, 79) + S2.wingtip_line(Wm - 1.2, 15, 79))
    m.append(S2.era(cx, 17, 22.2, 64, 6.5, 79))
    m.append(S2.lead_in(cx, 7, 22, 74.2, x_left=-x_ext, x_right=Wm + x_ext))
    m.append(S2.num_box(cx, 27, number))
    m.append(S2.push_limit(cx, 44))
    m.append(S2.ladder(cx, [(70.0, "A319"), (71.6, "A320 B738"), (73.2, "A321 B739"), (74.8, "B38M B39M")]))
    m.append(S2.fuel_pit(cx - 9.6, 57.7) + S2.fuel_pit(cx + 9.6, 57.7))
    m.append(S2.gpu_pit(cx - 3.0, 66.5))
    m.append(S2.hatch_poly([(cx + 5.2, 66), (cx + 14.5, 66), (cx + 14.5, 78.6), (cx + 5.2, 78.6)], cid=f"hb{tag}"))
    m.append(S2.mtext(cx + 9.85, 64.9, "NO PARKING", 0.9, S2.RED))
    m.append(S2.hatch_poly([(2.2, 66), (2.2, 78.6), (14.6, 78.6)], cid=f"he{tag}"))
    m.append(S2.mtext(2.4, 64.9, "EMERGENCY EQUIPMENT ONLY", 0.85, S2.RED, "start"))
    m.append(S2.gse_parking(40.6, 66.2, 7.6, 12.2))
    m.append(S2.extinguisher(16.6, 77.6) + S2.extinguisher(39.2, 64.2))
    # VDGS board on the facade at the end of the centerline
    m.append(rect(cx - 1.6, 85.0, 3.2, 0.8, S2.BLK) + S2.mtext(cx, 85.62, "STOP", 0.6, S2.YEL))
    out = dict(marks="".join(m), vehicles="", bridge="", aircraft="", door_local=(cx + 12.0, facade_y + 0.8))
    if not occupied:
        return out
    yn = 70.2 + 5.07 + 2.0
    s = SPECS["a320neo"]
    door = (cx + 12.0, facade_y + 0.8)
    rotunda = (cx + 12.0, 77.4)
    tip = (cx + s["fw"] / 2 + 1.3, yn - s["doors"][0])
    bsun = sun_local((0.13 * BRIDGE_H, 0.18 * BRIDGE_H), total_rot)
    br_svg, br_fp = jet_bridge(door, rotunda, tip, bsun)
    veh = S3.a320_service(cx, yn, livery=handler)
    vsun = sun_local(WORLD_SUN_VEH, total_rot)
    for v in veh:                                 # rebake vehicle shadows toward the world sun
        VEH = gse.VEH[v.kind]
        c = v.footprint.centroid
        ang = _angle(v)
        v.svg_shadow = g(rect(-VEH["W"] / 2, -VEH["L"] / 2, VEH["W"], VEH["L"], "#000", None, rx=0.3),
                         f"translate({fmt(c.x + vsun[0])} {fmt(c.y + vsun[1])}) rotate({fmt(ang)})",
                         'opacity="0.28" filter="url(#fShadow)"')
    building = Polygon([(-x_ext, 85.4), (Wm + x_ext, 85.4), (Wm + x_ext, 92), (-x_ext, 92)])
    errs = gse.check([(s, cx, yn)], veh, [building, br_fp.difference(building)])
    if errs:
        raise SystemExit(f"{tag}: " + "; ".join(errs))
    asun = sun_local(WORLD_SUN_AC, total_rot + 180)
    ac = air2.render(s, 2, 14.0, True, asun, dict(fin=livery[0], nacelle=livery[1]))
    out["vehicles"] = "".join(v.svg() for v in veh)
    out["bridge"] = br_svg
    out["aircraft"] = g(ac, f"translate({fmt(cx)} {fmt(yn)}) rotate(180)")
    return out


def _angle(v):
    """Heading of a placed vehicle from its footprint, matching gse.Placed (0 means front toward -y)."""
    pts = list(v.footprint.exterior.coords)
    (x0, y0), (x1, y1), (x2, y2) = pts[0], pts[1], pts[2]
    l01, l12 = math.hypot(x1 - x0, y1 - y0), math.hypot(x2 - x1, y2 - y1)
    if l01 > l12:
        ax, ay = x1 - x0, y1 - y0
    else:
        ax, ay = x2 - x1, y2 - y1
    return math.degrees(math.atan2(ax, -ay))
