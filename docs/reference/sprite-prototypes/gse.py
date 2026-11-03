"""Ground support equipment sprites at real size, aircraft boundaries and a collision checker.

Vehicles are drawn nose up (front toward negative y) centered on the origin, in meters, then placed by a front point
and a direction. Every placed object carries a shapely footprint used by the checker.
"""
import math
from shapely.geometry import Polygon, box
from shapely import affinity
from lib import fmt, rect, circle, ellipse, line, poly, path, g
import air2

# length m, width m, height m (working height for overhead checks), docks (front touches aircraft)
VEH = {
    "tug":        dict(L=5.8, W=2.5, H=1.9, name="Push back tug"),
    "tractor":    dict(L=2.9, W=1.45, H=1.9, name="Baggage tractor"),
    "cart":       dict(L=3.9, W=1.55, H=2.0, name="Baggage cart"),
    "beltloader": dict(L=7.6, W=2.1, H=1.8, name="Belt loader", dock=True),
    "catering":   dict(L=9.5, W=2.5, H=4.6, name="Catering high loader", dock=True),
    "dispenser":  dict(L=6.8, W=2.5, H=2.2, name="Hydrant dispenser"),
    "refueller":  dict(L=10.0, W=2.5, H=3.2, name="Refueller truck"),
    "gpu":        dict(L=3.2, W=1.7, H=1.6, name="Ground power unit"),
    "bus":        dict(L=13.8, W=3.0, H=3.1, name="Apron bus"),
    "stairs":     dict(L=7.2, W=2.4, H=3.2, name="Passenger stairs", dock=True),
}
OUTL = "#2b3340"


def _cab(L, W, y0, depth, col="#e9eef4"):
    o = rect(-W / 2, y0, W, depth, col, OUTL, 0.08, rx=0.3)
    o += rect(-W / 2 + 0.18, y0 + 0.15, W - 0.36, depth * 0.32, "#1f2833", None, rx=0.15)
    return o


def draw(kind, livery="#f28c28"):
    v = VEH[kind]
    L, W = v["L"], v["W"]
    y0 = -L / 2
    o = []
    if kind == "tug":
        o.append(rect(-W / 2, y0 + 0.4, W, L - 0.4, "#3d4652", OUTL, 0.08, rx=0.35))
        o.append(rect(-W / 2 + 0.1, y0 + 0.8, W - 0.2, 0.5, livery, None))
        o.append(rect(-W / 2 + 0.15, y0 + L - 2.2, 1.5, 1.7, "#e9eef4", OUTL, 0.06, rx=0.2))
        o.append(rect(-W / 2 + 0.3, y0 + L - 2.05, 1.2, 0.5, "#1f2833", None, rx=0.1))
        o.append(rect(-0.25, y0, 0.5, 0.6, "#59616d", None))
        for k in range(3):
            o.append(line(-W / 2 + 0.25, y0 + 1.7 + k * 0.6, W / 2 - 0.25, y0 + 1.7 + k * 0.6, "#2b3340", 0.08))
    elif kind == "tractor":
        o.append(rect(-W / 2, y0, W, L, "#d9463e", OUTL, 0.08, rx=0.3))
        o.append(rect(-W / 2 + 0.12, y0 + 1.0, W - 0.24, 1.6, "#2b3340", None, rx=0.15))
        o.append(rect(-W / 2 + 0.25, y0 + 0.2, W - 0.5, 0.45, "#1f2833", None, rx=0.1))
        o.append(rect(-0.12, y0 + L - 0.05, 0.24, 0.35, "#59616d", None))
    elif kind == "cart":
        o.append(poly([(-0.5, y0 + 0.95), (0, y0), (0.5, y0 + 0.95)], "none", "#59616d", 0.1))
        o.append(rect(-W / 2, y0 + 0.9, W, L - 0.9, "#c9d0d8", OUTL, 0.08, rx=0.12))
        o.append(rect(-W / 2 + 0.1, y0 + 1.0, W - 0.2, L - 1.1, "#e3e7eb", None, rx=0.08))
        for k in range(5):
            o.append(line(-W / 2 + 0.15, y0 + 1.3 + k * 0.55, W / 2 - 0.15, y0 + 1.3 + k * 0.55, "#aeb7c1", 0.05))
        o.append(rect(-W / 2, y0 + 0.9, 0.16, L - 0.9, livery, None))
    elif kind == "beltloader":
        o.append(rect(-W / 2, y0, W, L, "#59616d", OUTL, 0.08, rx=0.2))
        o.append(rect(-0.55, y0 + 0.1, 1.1, L - 1.6, "#222831", None))
        k = 0.3
        while k < L - 1.7:
            o.append(line(-0.5, y0 + k, 0.5, y0 + k, "#59616d", 0.06))
            k += 0.35
        o.append(line(-0.62, y0 + 0.1, -0.62, y0 + L - 1.5, "#f2c230", 0.08) + line(0.62, y0 + 0.1, 0.62, y0 + L - 1.5, "#f2c230", 0.08))
        o.append(rect(-W / 2 + 0.05, y0 + L - 1.5, 1.2, 1.3, "#e9eef4", OUTL, 0.06, rx=0.15))
        o.append(rect(-W / 2 + 0.15, y0 + L - 1.4, 1.0, 0.45, "#1f2833", None, rx=0.08))
        o.append(rect(-0.6, y0, 1.2, 0.18, "#111", None))
    elif kind == "catering":
        o.append(rect(-W / 2, y0, W, 0.6, "#c9d0d8", OUTL, 0.06))
        o.append(rect(-W / 2, y0 + 0.6, W, 6.4, "#f4f6f8", OUTL, 0.08, rx=0.15))
        o.append(rect(-W / 2 + 0.1, y0 + 1.0, W - 0.2, 0.25, livery, None))
        o.append(rect(-W / 2 + 0.1, y0 + 6.5, W - 0.2, 0.25, livery, None))
        o.append(_cab(L, W, y0 + 7.1, 2.4))
    elif kind == "dispenser":
        o.append(rect(-W / 2, y0, W, 2.0, "#e9eef4", OUTL, 0.08, rx=0.3))
        o.append(rect(-W / 2 + 0.18, y0 + 0.15, W - 0.36, 0.6, "#1f2833", None, rx=0.12))
        o.append(rect(-W / 2, y0 + 2.0, W, L - 2.0, "#f2c230", OUTL, 0.08, rx=0.2))
        o.append(circle(-0.55, y0 + 3.3, 0.5, "#2b3340") + circle(0.55, y0 + 3.3, 0.5, "#2b3340"))
        o.append(rect(-W / 2 + 0.2, y0 + 4.4, W - 0.4, 2.1, "#d9a21b", OUTL, 0.06))
        for k in range(4):
            o.append(line(-W / 2 + 0.25, y0 + 4.7 + k * 0.45, W / 2 - 0.25, y0 + 4.7 + k * 0.45, "#b88a17", 0.05))
    elif kind == "refueller":
        o.append(_cab(L, W, y0, 2.4, "#e9eef4"))
        o.append(rect(-W / 2, y0 + 2.5, W, L - 3.4, "#f4f6f8", OUTL, 0.08, rx=1.0))
        o.append(rect(-0.25, y0 + 2.6, 0.5, L - 3.6, "#d5dbe1", None))
        o.append(rect(-W / 2 + 0.1, y0 + 4.2, W - 0.2, 0.3, "#d9463e", None))
        o.append(rect(-W / 2, y0 + L - 0.9, W, 0.9, "#59616d", OUTL, 0.06))
    elif kind == "gpu":
        o.append(poly([(-0.4, y0 + 0.7), (0, y0), (0.4, y0 + 0.7)], "none", "#59616d", 0.1))
        o.append(rect(-W / 2, y0 + 0.6, W, L - 0.6, "#3d6b8a", OUTL, 0.08, rx=0.15))
        for k in range(4):
            o.append(line(-W / 2 + 0.2, y0 + 1.1 + k * 0.45, W / 2 - 0.2, y0 + 1.1 + k * 0.45, "#2c5470", 0.06))
    elif kind == "bus":
        o.append(rect(-W / 2, y0, W, L, "#f4f6f8", OUTL, 0.08, rx=0.5))
        o.append(rect(-W / 2 + 0.2, y0 + 0.12, W - 0.4, 0.7, "#1f2833", None, rx=0.2))
        o.append(rect(-0.9, y0 + 3.0, 1.8, 2.2, "#c9d0d8", None, rx=0.2) + rect(-0.9, y0 + 8.4, 1.8, 2.2, "#c9d0d8", None, rx=0.2))
        o.append(rect(-W / 2, y0 + 1.0, 0.18, L - 1.6, "#2f6fdd", None))
        for yy in (2.0, 6.4, 11.4):
            o.append(rect(W / 2 - 0.16, y0 + yy, 0.16, 1.4, "#1f2833", None))
    elif kind == "stairs":
        o.append(_cab(L, W, y0 + L - 2.4, 2.4))
        o.append(rect(-W / 2 + 0.2, y0, W - 0.4, L - 2.5, "#c9d0d8", OUTL, 0.08))
        k = 0.4
        while k < L - 2.6:
            o.append(line(-W / 2 + 0.3, y0 + k, W / 2 - 0.3, y0 + k, "#8e99a8", 0.06))
            k += 0.3
    return "".join(o)


class Placed:
    def __init__(self, kind, front, direction, livery="#f28c28", label=None):
        v = VEH[kind]
        self.kind, self.H, self.dock = kind, v["H"], v.get("dock", False)
        dx, dy = direction
        n = math.hypot(dx, dy)
        dx, dy = dx / n, dy / n
        ang = math.degrees(math.atan2(dx, -dy))  # 0 means front toward negative y
        cx, cy = front[0] - dx * v["L"] / 2, front[1] - dy * v["L"] / 2
        self.svg_body = g(draw(kind, livery), f"translate({fmt(cx)} {fmt(cy)}) rotate({fmt(ang)})")
        self.svg_shadow = g(rect(-v["W"] / 2, -v["L"] / 2, v["W"], v["L"], "#000", None, rx=0.3),
                            f"translate({fmt(cx + 0.25)} {fmt(cy + 0.35)}) rotate({fmt(ang)})", 'opacity="0.28" filter="url(#fShadow)"')
        fp = box(-v["W"] / 2, -v["L"] / 2, v["W"] / 2, v["L"] / 2)
        self.footprint = affinity.translate(affinity.rotate(fp, ang, origin=(0, 0)), cx, cy)
        self.label = label or v["name"]

    def svg(self):
        return self.svg_shadow + self.svg_body


# ------------------------------------------------------------------ aircraft boundaries
def boundary(s):
    """Hard footprint (nothing may enter) and overhead zones with underside height, in local nose up meters."""
    hard = [Polygon(air2.fuselage_pts(s))]
    w = s["wing"]
    for e in s.get("engines", []):
        for sg in (-1, 1):
            x = sg * e["y"]
            if e["kind"] in ("fan", "rear"):
                hard.append(box(x - e["d"] / 2, e["x"] - 0.1 * e["len"], x + e["d"] / 2, e["x"] + e["len"] * 1.15))
            else:
                hard.append(box(x - e["d"] / 2, e["x"], x + e["d"] / 2, e["x"] + e["len"]))
                hard.append(box(x - e["prop_d"] / 2, e["x"] - 0.4, x + e["prop_d"] / 2, e["x"] + 0.3))
    gb = s.get("gear", {})
    if gb:
        ny, wb, tr = gb["nose"], gb["wheelbase"], gb["track"]
        hard.append(box(-0.6, ny - 0.8, 0.6, ny + 0.8))
        for sg in (-1, 1):
            hard.append(box(sg * tr / 2 - 0.9, ny + wb - 1.2, sg * tr / 2 + 0.9, ny + wb + 1.2))
    rp = air2.wing_right(s, w, R=0)
    wing = Polygon(rp + [(-x, y) for x, y in reversed(rp)])
    h = s["hstab"]
    sb = h["span"] / 2
    tp = [(0, h["x"]), (sb, h["x"] + sb * math.tan(math.radians(h["sweep"]))),
          (sb, h["x"] + sb * math.tan(math.radians(h["sweep"])) + h["tip"]), (0, h["x"] + h["c"])]
    stab = Polygon(tp + [(-x, y) for x, y in reversed(tp)])
    heights = s.get("heights", {})
    over = [(wing, heights.get("wing", 3.0)), (stab, heights.get("stab", 5.4))]
    return hard, over


def place_aircraft(poly_, cx, ynose):
    """Local nose up geometry to a stand where the nose points down the screen (rotate 180)."""
    return affinity.translate(affinity.scale(poly_, -1, -1, origin=(0, 0)), cx, ynose)


def check(aircraft, vehicles, solids=(), clearance=0.5, gap=0.3, dock_tol=0.8):
    """aircraft: list of (spec, cx, ynose). vehicles: list of Placed. solids: shapely polygons (buildings, bridges)."""
    errors = []
    hard_all, over_all = [], []
    for s, cx, yn in aircraft:
        hard, over = boundary(s)
        hard_all += [place_aircraft(p, cx, yn) for p in hard]
        over_all += [(place_aircraft(p, cx, yn), hgt) for p, hgt in over]
    for v in vehicles:
        for hp in hard_all:
            inter = v.footprint.intersection(hp.buffer(clearance)).area
            allowed = dock_tol if v.dock else 0.0
            if inter > allowed:
                errors.append(f"{v.label} enters an aircraft hard footprint ({inter:.2f} m2)")
        for op, hgt in over_all:
            if v.footprint.intersects(op) and v.H >= hgt:
                errors.append(f"{v.label} is {v.H} m tall but passes under a part only {hgt} m high")
        for sp in solids:
            if v.footprint.intersection(sp).area > 0.01:
                errors.append(f"{v.label} overlaps a building or bridge")
    for i in range(len(vehicles)):
        for j in range(i + 1, len(vehicles)):
            a, b = vehicles[i], vehicles[j]
            if a.footprint.buffer(gap / 2).intersects(b.footprint.buffer(gap / 2)):
                errors.append(f"{a.label} touches {b.label}")
    return errors


def draw_order(markings, vehicles, bridges, aircraft_svg):
    """Ground vehicles first so wings and tails cover anything parked under them, then bridges, then aircraft."""
    return markings + "".join(v.svg() for v in vehicles) + bridges + aircraft_svg
