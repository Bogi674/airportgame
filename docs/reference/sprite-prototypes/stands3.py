"""Occupied stand scenes: markings, then ground vehicles, then bridges, then aircraft. Every scene must pass gse.check."""
import math
from shapely.geometry import Polygon, Point
from lib import *
import stands2 as S2
import gse
from gse import Placed
from specs2 import SPECS


def bridge(x_root, y_root, x_tip, y_tip, wdt=3.0):
    svg = S2.jet_bridge(x_root, y_root, x_tip, y_tip, wdt)
    ang = math.atan2(y_tip - y_root, x_tip - x_root)
    nx, ny = -math.sin(ang) * wdt / 2, math.cos(ang) * wdt / 2
    tunnel = Polygon([(x_root + nx, y_root + ny), (x_tip + nx, y_tip + ny), (x_tip - nx, y_tip - ny), (x_root - nx, y_root - ny)])
    cab = Polygon([(x_tip - 2, y_tip - 1.6), (x_tip + 2, y_tip - 1.6), (x_tip + 2, y_tip + 1.6), (x_tip - 2, y_tip + 1.6)])
    rot = Point(x_root, y_root).buffer(2.2)
    return svg, tunnel.union(cab).union(rot)


def L2S(cx, yn, xl, yl):
    """local aircraft coordinates (starboard positive, aft positive) to screen when the nose points down"""
    return (cx - xl, yn - yl)


def a320_service(cx, yn, train=True, catering=True, livery="#f28c28"):
    v = []
    v.append(Placed("beltloader", L2S(cx, yn, 2.2, 8.6), (1, 0), livery, "Belt loader"))
    if train:
        f = L2S(cx, yn, 11.6, 1.0)
        v.append(Placed("tractor", f, (0, 1), livery, "Baggage tractor"))
        y = f[1] - 2.9 - 0.35
        for k in range(3):
            v.append(Placed("cart", (f[0], y), (0, 1), livery, f"Baggage cart {k + 1}"))
            y -= 3.9 + 0.35
    v.append(Placed("dispenser", L2S(cx, yn, 11.0, 17.4), (0, 1), livery, "Hydrant dispenser"))
    if catering:
        v.append(Placed("catering", L2S(cx, yn, 1.75, 32.4), (1, 0), livery, "Catering truck"))
    v.append(Placed("gpu", L2S(cx, yn, 3.45, 2.2), (0, 1), livery, "GPU"))
    return v


def scene(markings_fn, tag, aircraft, vehicles, bridges, building_y, Wm):
    wm, marks = markings_fn(False, tag)
    solids = [Polygon([(0, building_y), (Wm, building_y), (Wm, 92), (0, 92)])] + [b[1] for b in bridges]
    errs = gse.check([(SPECS[k], cx, yn) for k, cx, yn in aircraft], vehicles, solids)
    if errs:
        raise SystemExit(f"{tag}: " + "; ".join(errs))
    ac_svg = "".join(S2.place_ac(k, cx, yn) for k, cx, yn in aircraft)
    return wm, gse.draw_order(marks, vehicles, "".join(b[0] for b in bridges), ac_svg)


def contact_occupied():
    cx, yn = 25, 70.2 + 5.07 + 2.0
    v = a320_service(cx, yn)
    br = [bridge(cx + 12, 87, cx + 1.975 + 2.0, yn - 5.0)]
    return scene(S2.stand_contact, "a2", [("a320neo", cx, yn)], v, br, 85.4, 50)


def mars_occupied():
    xl, xr, yn = 21.5, 60.5, 73.8 + 5.07 + 2.0
    v = a320_service(xl, yn, train=True, catering=False, livery="#2f6fdd") + a320_service(xr, yn, train=True, catering=False, livery="#2a9d8f")
    br = [bridge(xl + 11, 88.2, xl + 1.975 + 2.0, yn - 5.0), bridge(xr + 11, 88.2, xr + 1.975 + 2.0, yn - 5.0)]
    return scene(S2.stand_mars, "b2", [("a320neo", xl, yn), ("a320neo", xr, yn)], v, br, 86.8, 82)


def remote_occupied():
    cx, yn = 21, 66.0
    Wm = 46
    v = [Placed("refueller", L2S(cx, yn, 9.25, 7.0), (0, 1), "#d9463e", "Refueller")]
    x0 = cx + 2.03
    v.append(Placed("cart", (x0 + 3.9, yn - 3.9), (1, 0), "#f28c28", "Baggage cart 1"))
    v.append(Placed("cart", (x0 + 3.9 + 0.35 + 3.9, yn - 3.9), (1, 0), "#f28c28", "Baggage cart 2"))
    v.append(Placed("tractor", (x0 + 2 * 3.9 + 0.7 + 2.9, yn - 3.9), (1, 0), "#f28c28", "Baggage tractor"))
    v.append(Placed("bus", (Wm - 2.0, 37.6 - 6.9), (0, -1), "#2f6fdd", "Apron bus"))
    wm, marks = S2.stand_remote(False, "c1")
    errs = gse.check([(SPECS["at76"], cx, yn)], v, [])
    if errs:
        raise SystemExit("c1: " + "; ".join(errs))
    return wm, gse.draw_order(marks, v, "", S2.place_ac("at76", cx, yn))
