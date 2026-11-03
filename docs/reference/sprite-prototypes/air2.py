"""Aircraft renderer v2: reference style, real proportions.

Coordinates in meters. x is lateral (right wing positive), y is longitudinal with the nose at y = 0
and the tail at y = L. Drawn nose up. Every function returns SVG in meters; callers scale.

Geometry is the same data that the game stores in src/data/aircraft/*.json under `sprite`.
"""
import math
from lib import fmt, rect, circle, ellipse, line, poly, path, g

T = math.tan
R_ = math.radians

COL = {
    "skin": "#ffffff", "skin_edge": "#d3d9e0", "outline": "#8f99a5", "wing": "#e9ecef",
    "wing_line": "#b7bfc8", "wing_dark": "#d7dce2", "glass": "#1c2530", "glass_line": "#c9d2dc",
    "window": "#6f7a86", "door": "#8f99a5", "nacelle_lip": "#c4cbd3", "core": "#5f6873",
    "pylon": "#d9dee4", "prop": "#2b3036", "spinner": "#e9ecef", "mask": "#14191f",
}


# ------------------------------------------------------------------ geometry helpers
def hw(s, y):
    """Fuselage half width at station y."""
    R = s["fw"] / 2
    L = s["L"]
    if y <= 0:
        return 0.0
    if y < s["nose"]:
        # ogive nose fitted to a measured 777 photo: w = R (1 - (1 - t)^n)^m
        t = y / s["nose"]
        return R * (1 - (1 - t) ** s.get("nose_n", 1.2)) ** s.get("nose_m", 0.6)
    ts = L - s["tail"]
    if y > ts:
        u = min(1.0, (y - ts) / s["tail"])
        te = s.get("tail_end", 0.3)
        return R - (R - te) * u ** s.get("tail_p", 1.35)
    return R


def fuselage_pts(s, n=90):
    L = s["L"]
    ys = [L * (i / n) ** 1.0 for i in range(n + 1)]
    # extra samples near the nose for a smooth tip
    ys = sorted(set([s["nose"] * (i / 60) ** 2.2 for i in range(61)] + ys))
    right = [(hw(s, y), y) for y in ys]
    left = [(-x, y) for x, y in reversed(right)]
    return right + left


def wing_right(s, w, R=None, span_key="sb"):
    """Right wing planform from fuselage side to tip (no winglet)."""
    if R is None:
        R = w.get("root_y", s["fw"] / 2)
    sb = w[span_key]
    sw = R_(w["sweep"])
    A = (R, w["x"])
    pts = [A]
    if w.get("rake"):
        rb = sb - w["rake"]
        B = (rb, w["x"] + (rb - R) * T(sw))
        Tp = (sb, B[1] + w["rake"] * T(R_(w["sweep"] + w.get("rake_extra", 15))))
        pts += [B, Tp]
    else:
        Tp = (sb, w["x"] + (sb - R) * T(sw))
        pts.append(Tp)
    TT = (sb, Tp[1] + w["tip"])
    K = (w["kink"], w["x"] + w["c"] + (w["kink"] - R) * T(R_(w.get("te_in", 0))))
    Z = (R, w["x"] + w["c"])
    kr = w.get("kink_round", 0.35)
    if kr > 0:
        a = (K[0] + (Z[0] - K[0]) * kr, K[1] + (Z[1] - K[1]) * kr)
        b = (K[0] + (TT[0] - K[0]) * kr * 0.5, K[1] + (TT[1] - K[1]) * kr * 0.5)
        curve = []
        for i in range(13):
            t = i / 12
            curve.append(((1 - t) ** 2 * b[0] + 2 * (1 - t) * t * K[0] + t * t * a[0],
                          (1 - t) ** 2 * b[1] + 2 * (1 - t) * t * K[1] + t * t * a[1]))
        pts += [TT] + curve + [Z]
    else:
        pts += [TT, K, Z]
    return pts


def le_y(s, w, y_span):
    R = w.get("root_y", s["fw"] / 2)
    if w.get("rake") and y_span > w["sb"] - w["rake"]:
        rb = w["sb"] - w["rake"]
        return w["x"] + (rb - R) * T(R_(w["sweep"])) + (y_span - rb) * T(R_(w["sweep"] + w.get("rake_extra", 15)))
    return w["x"] + (y_span - R) * T(R_(w["sweep"]))


def te_y(s, w, y_span):
    R = w.get("root_y", s["fw"] / 2)
    sb = w["sb"]
    TTy = le_y(s, w, sb) + w["tip"]
    TT = (sb, TTy)
    K = (w["kink"], w["x"] + w["c"] + (w["kink"] - R) * T(R_(w.get("te_in", 0))))
    Z = (R, w["x"] + w["c"])
    if y_span <= K[0]:
        f = (y_span - R) / max(1e-6, K[0] - R)
        return Z[1] + (K[1] - Z[1]) * f
    f = (y_span - K[0]) / max(1e-6, TT[0] - K[0])
    return K[1] + (TT[1] - K[1]) * f


def shoelace(pts):
    a = 0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def wing_area(s):
    w = s["wing"]
    return 2 * shoelace(wing_right(s, w)) + s["fw"] * w["c"]


def mirror(pts):
    return [(-x, y) for x, y in pts]


def smooth_path(pts, closed=True):
    d = "M" + " L".join(f"{fmt(x)},{fmt(y)}" for x, y in pts)
    return d + ("Z" if closed else "")


# ------------------------------------------------------------------ parts
def winglet(s, w, side=1):
    kind = w.get("winglet")
    if not kind or kind == "none":
        return []
    sb = w["sb"]
    ext = w.get("ext", 0.6)
    yl = le_y(s, w, sb)
    tip = w["tip"]
    if kind in ("sharklet", "blended"):
        pts = [(sb, yl + 0.05 * tip), (sb + ext * 0.55, yl + 0.35 * tip + ext * 0.4),
               (sb + ext, yl + 0.85 * tip + ext * 0.9), (sb + ext, yl + 1.05 * tip + ext * 0.95),
               (sb, yl + tip)]
    else:  # canted
        pts = [(sb, yl + 0.1 * tip), (sb + ext, yl + 0.55 * tip + ext * 0.7),
               (sb + ext, yl + 0.95 * tip + ext * 0.7), (sb, yl + tip)]
    return [(side * x, y) for x, y in pts]


def nacelle_fan(e, px, tier, liv=None):
    """Top view nacelle. flow='separate': fan cowl ends early, the narrower core cowl and plug stick out behind.
    flow='longduct': one long cowl to a single nozzle, only a small plug shows."""
    x, y0, Ln, d = e["y"], e["x"], e["len"], e["d"]
    r = d / 2
    flow = e.get("flow", "separate")
    fan_end = e.get("fan_end", 0.66 if flow == "separate" else 0.94)
    out = []
    if flow == "separate":
        cr = r * e.get("core_r", 0.5)
        core = [(x - cr, y0 + fan_end * Ln - 0.05 * Ln), (x - cr * 0.92, y0 + 0.86 * Ln), (x - cr * 0.7, y0 + Ln),
                (x + cr * 0.7, y0 + Ln), (x + cr * 0.92, y0 + 0.86 * Ln), (x + cr, y0 + fan_end * Ln - 0.05 * Ln)]
        out.append(poly(core, "#e3e7eb", COL["outline"], 0.7 / px))
        pr = cr * 0.62
        out.append(poly([(x - pr, y0 + Ln), (x - pr * 0.5, y0 + Ln * 1.1), (x, y0 + Ln * 1.15),
                         (x + pr * 0.5, y0 + Ln * 1.1), (x + pr, y0 + Ln)], COL["core"], COL["outline"], 0.5 / px))
        fe = fan_end
        pts = [(x - r * 0.9, y0 + 0.02 * Ln), (x - r, y0 + 0.2 * Ln), (x - r * 0.98, y0 + 0.5 * fe * Ln + 0.15 * Ln),
               (x - r * 0.84, y0 + fe * Ln), (x + r * 0.84, y0 + fe * Ln), (x + r * 0.98, y0 + 0.5 * fe * Ln + 0.15 * Ln),
               (x + r, y0 + 0.2 * Ln), (x + r * 0.9, y0 + 0.02 * Ln)]
    else:
        pts = [(x - r * 0.9, y0 + 0.02 * Ln), (x - r, y0 + 0.2 * Ln), (x - r * 0.96, y0 + 0.55 * Ln),
               (x - r * 0.72, y0 + 0.88 * Ln), (x - r * 0.5, y0 + Ln), (x + r * 0.5, y0 + Ln),
               (x + r * 0.72, y0 + 0.88 * Ln), (x + r * 0.96, y0 + 0.55 * Ln), (x + r, y0 + 0.2 * Ln), (x + r * 0.9, y0 + 0.02 * Ln)]
        pr = r * 0.26
        out.append(poly([(x - pr, y0 + Ln), (x, y0 + Ln * 1.07), (x + pr, y0 + Ln)], COL["core"], COL["outline"], 0.5 / px))
    front = f"M{fmt(x - r * 0.9)},{fmt(y0 + 0.02 * Ln)} Q{fmt(x)},{fmt(y0 - 0.1 * Ln)} {fmt(x + r * 0.9)},{fmt(y0 + 0.02 * Ln)}"
    body = smooth_path(pts)
    out.append(path(front + " " + body.replace("M", "L", 1), "#ffffff", None))
    out.append(path(body, "url(#gNac)", COL["outline"], 0.9 / px))
    if liv and liv.get("nacelle"):
        fe = fan_end
        out.append(poly([(x - r * 0.97, y0 + 0.12 * Ln), (x - r * 0.97, y0 + 0.5 * fe * Ln + 0.15 * Ln), (x - r * 0.84, y0 + fe * Ln * 0.97),
                         (x + r * 0.84, y0 + fe * Ln * 0.97), (x + r * 0.97, y0 + 0.5 * fe * Ln + 0.15 * Ln), (x + r * 0.97, y0 + 0.12 * Ln)],
                        liv["nacelle"], None, op=0.92))
    out.append(path(front + f" L{fmt(x + r * 0.92)},{fmt(y0 + 0.09 * Ln)} Q{fmt(x)},{fmt(y0 + 0.02 * Ln)} {fmt(x - r * 0.92)},{fmt(y0 + 0.09 * Ln)}Z",
                    COL["nacelle_lip"], COL["outline"], 0.6 / px))
    if e.get("chevrons"):
        ye = y0 + fan_end * Ln
        zz = []
        n = 9
        for i in range(n + 1):
            xx = x - r * 0.84 + i * (1.68 * r / n)
            zz.append((xx, ye + (0.035 * Ln if i % 2 else 0)))
        out.append(path(smooth_path(zz, False), "none", COL["outline"], 0.7 / px))
    if tier >= 3:
        out.append(line(x - r * 0.97, y0 + 0.4 * Ln, x + r * 0.97, y0 + 0.4 * Ln, COL["wing_line"], 0.6 / px))
    return "".join(out)


def pylon(e, s, w, px, liv=None):
    x, y0, Ln, d = e["y"], e["x"], e["len"], e["d"]
    wl = le_y(s, w, x)
    pw = max(0.35, d * 0.16)
    fill = liv["nacelle"] if liv and liv.get("nacelle") else "#f3f5f7"
    return rect(x - pw / 2, y0 + 0.45 * Ln, pw, wl - (y0 + 0.45 * Ln) + 0.4, fill, "#b3bcc6", 0.5 / px)


def prop(x, y, pd, blades, px, phase=12):
    """Top view of a propeller: the disc is seen edge on, so blades project onto a lateral bar."""
    out = []
    R = pd / 2
    for i in range(blades):
        a = R_(phase + i * 360 / blades)
        ln = R * abs(math.cos(a))
        if ln < 0.05:
            continue
        sgn = 1 if math.cos(a) > 0 else -1
        ch = 0.09 + 0.06 * abs(math.sin(a)) + pd * 0.012
        off = (0.04 if math.sin(a) > 0 else -0.04)
        pts = [(x + sgn * 0.15, y + off - ch * 0.5), (x + sgn * ln * 0.75, y + off - ch * 0.6),
               (x + sgn * ln, y + off - ch * 0.25), (x + sgn * ln, y + off + ch * 0.25),
               (x + sgn * ln * 0.75, y + off + ch * 0.5), (x + sgn * 0.15, y + off + ch * 0.45)]
        out.append(poly(pts, COL["prop"], None))
    return "".join(out)


def nacelle_prop(e, px, tier):
    x, y0, Ln, d = e["y"], e["x"], e["len"], e["d"]
    r = d / 2
    out = []
    pts = [(x - r * 0.55, y0 + 0.06 * Ln), (x - r, y0 + 0.2 * Ln), (x - r, y0 + 0.62 * Ln),
           (x - r * 0.7, y0 + 0.9 * Ln), (x - r * 0.3, y0 + Ln), (x + r * 0.3, y0 + Ln),
           (x + r * 0.7, y0 + 0.9 * Ln), (x + r, y0 + 0.62 * Ln), (x + r, y0 + 0.2 * Ln),
           (x + r * 0.55, y0 + 0.06 * Ln)]
    out.append(path(smooth_path(pts), "url(#gNac)", COL["outline"], 0.8 / px))
    if tier >= 3:
        out.append(ellipse(x - r * 0.6, y0 + 0.2 * Ln, r * 0.18, Ln * 0.03, COL["core"], None))
        out.append(ellipse(x + r * 0.6, y0 + 0.2 * Ln, r * 0.18, Ln * 0.03, COL["core"], None))
    return "".join(out)


def spinner(x, y, rs, px):
    return path(f"M{fmt(x - rs)},{fmt(y + rs * 1.1)} Q{fmt(x - rs)},{fmt(y)} {fmt(x)},{fmt(y - rs * 0.6)} "
                f"Q{fmt(x + rs)},{fmt(y)} {fmt(x + rs)},{fmt(y + rs * 1.1)}Z", COL["spinner"], COL["outline"], 0.6 / px)


WS_STYLES = {
    # k: front edge exponent (1 = sharp V, 2 = round), kb: back edge exponent, side: how far the side windows run back,
    # divs: pane dividers across the band (-1 left edge to 1 right edge)
    "airbus": dict(k=1.25, kb=1.6, side=0.55, divs=[-0.8, -0.5, 0.0, 0.5, 0.8]),
    "b737": dict(k=0.95, kb=1.3, side=0.5, divs=[-0.8, -0.45, 0.0, 0.45, 0.8]),
    "boeing": dict(k=1.15, kb=1.5, side=0.5, divs=[-0.8, -0.46, 0.0, 0.46, 0.8]),
    "b787": dict(k=2.0, kb=2.2, side=0.95, divs=[-0.55, 0.0, 0.55]),
    "a350": dict(k=1.6, kb=1.9, side=0.75, divs=[-0.62, 0.0, 0.62]),
    "crj": dict(k=1.05, kb=1.4, side=0.45, divs=[-0.55, 0.0, 0.55]),
    "atr": dict(k=1.7, kb=1.8, side=0.5, divs=[-0.56, 0.0, 0.56]),
    "q400": dict(k=1.35, kb=1.6, side=0.6, divs=[-0.72, -0.36, 0.0, 0.36, 0.72]),
    "kingair": dict(k=1.5, kb=1.7, side=0.55, divs=[0.0]),
    "ga": dict(k=2.0, kb=2.0, side=0.3, divs=[0.0]),
}


def windscreen(s, px):
    c = s["ws"]
    st = dict(WS_STYLES[c.get("style", "airbus")])
    st.update({k: v for k, v in c.items() if k in ("k", "kb", "side", "divs")})
    y0, dep, cur = c["y"], c["d"], c["c"]
    wf = c.get("wf", 0.97)
    n = 32
    def fy(u):
        return y0 + cur * abs(u) ** st["k"]
    def by(u):
        return y0 + dep + (cur + dep * st["side"]) * abs(u) ** st["kb"]
    front = [(u * hw(s, fy(u)) * wf, fy(u)) for u in [-1 + 2 * i / n for i in range(n + 1)]]
    back = [(u * hw(s, by(u)) * wf, by(u)) for u in [-1 + 2 * i / n for i in range(n + 1)]]
    shape = front + list(reversed(back))
    out = []
    if c.get("style") == "a350":
        mf = [(u * hw(s, fy(u) - 0.3) * 0.995, fy(u) - 0.3) for u in [-1 + 2 * i / n for i in range(n + 1)]]
        mb = [(u * hw(s, by(u) + 0.4) * 0.995, by(u) + 0.4) for u in [-1 + 2 * i / n for i in range(n + 1)]]
        out.append(poly(mf + list(reversed(mb)), COL["mask"], None))
        out.append(poly(shape, "#2d3a48", None))
    else:
        out.append(poly(shape, COL["glass"], None))
    for u in st["divs"]:
        out.append(line(u * hw(s, fy(u)) * wf, fy(u), u * hw(s, by(u)) * wf, by(u), COL["glass_line"], 1.0 / px))
    if s.get("rear_window"):
        a, b = s["rear_window"]
        rw = [(u * hw(s, a) * 0.9, a + 0.08 * u * u) for u in [-1 + 2 * i / n for i in range(n + 1)]]
        rw += [(u * hw(s, b) * 0.85, b - 0.05 * u * u) for u in [-1 + 2 * i / n for i in range(n, -1, -1)]]
        out.append(poly(rw, COL["glass"], None))
    return "".join(out)


def doors_windows(s, px, tier):
    out = []
    dd = s.get("doors", [])
    ow = s.get("overwing", [])
    inset = s.get("door_inset", 0.07)
    dw = s.get("door_w", 0.24)
    for y in dd:
        h = s.get("door_len", 0.95)
        for sg in (-1, 1):
            xe = hw(s, y) - inset - dw
            out.append(rect(sg * (xe + dw / 2) - dw / 2, y - h / 2, dw, h, "none", COL["door"], 0.8 / px, rx=0.05))
    for y in ow:
        for sg in (-1, 1):
            xe = hw(s, y) - inset - dw * 0.8
            out.append(rect(sg * (xe + dw * 0.4) - dw * 0.4, y - 0.3, dw * 0.8, 0.6, "none", COL["door"], 0.7 / px, rx=0.04))
    wn = s.get("windows")
    if wn:
        a, b, pitch = wn
        rr = s.get("win_r", 0.09)
        skip = [(y - 0.75, y + 0.75) for y in dd] + [(y - 0.45, y + 0.45) for y in ow]
        y = a
        while y <= b:
            if not any(lo < y < hi for lo, hi in skip):
                xw = hw(s, y) - s.get("win_inset", 0.2)
                out.append(circle(-xw, y, rr, COL["window"], None))
                out.append(circle(xw, y, rr, COL["window"], None))
            y += pitch
        if s.get("upper"):
            ua, ub, uw = s["upper"]["win"]
            y = ua
            while y <= ub:
                out.append(circle(-uw, y, rr, COL["window"], None))
                out.append(circle(uw, y, rr, COL["window"], None))
                y += pitch
    return "".join(out)


def tail_parts(s, px, tier, which):
    out = []
    h = s["hstab"]
    if which == "hstab":
        R = 0 if h.get("ttail") else max(0.2, hw(s, h["x"] + h["c"] * 0.5) * 0.92)
        sb = h["span"] / 2
        A = (R, h["x"])
        Tp = (sb, h["x"] + (sb - R) * T(R_(h["sweep"])))
        TT = (sb, Tp[1] + h["tip"])
        Z = (R, h["x"] + h["c"])
        rp = [A, Tp, TT, Z]
        for sg in (-1, 1):
            out.append(poly([(sg * x, y) for x, y in rp], COL["wing"], COL["outline"], 0.9 / px))
            if tier >= 2:
                # elevator hinge line at 72% chord
                p1 = (R, h["x"] + h["c"] * 0.7)
                p2 = (sb * 0.97, Tp[1] + h["tip"] * 0.68)
                out.append(line(sg * p1[0], p1[1], sg * p2[0], p2[1], COL["wing_line"], 0.7 / px))
        if h.get("ttail"):
            out.append(ellipse(0, h["x"] + h["c"] * 0.45, 0.22 * h["c"] * 0.4 + 0.1, h["c"] * 0.55, COL["wing"], COL["outline"], 0.7 / px))
    else:
        f = s["fin"]
        a, b, wd = f["x0"], f["x1"], f["w"]
        d0 = f.get("dorsal", a)
        pts = [(0, d0), (wd * 0.12, a), (wd * 0.5, a + (b - a) * 0.3), (wd * 0.32, a + (b - a) * 0.8), (0.04, b),
               (-0.04, b), (-wd * 0.32, a + (b - a) * 0.8), (-wd * 0.5, a + (b - a) * 0.3), (-wd * 0.12, a)]
        out.append(path(smooth_path(pts), s.get("_fin", COL["wing"]), COL["outline"], 0.8 / px))
    return "".join(out)


def wing_parts(s, px, tier):
    w = s["wing"]
    out = []
    rp = wing_right(s, w, R=0 if w.get("high") else None)
    if w.get("high"):
        out.append(poly(rp + [(-x, y) for x, y in reversed(rp)], COL["wing"], COL["outline"], 0.9 / px))
    for sg in (-1, 1):
        if not w.get("high"):
            out.append(poly([(sg * x, y) for x, y in rp], COL["wing"], COL["outline"], 0.9 / px))
        wl = winglet(s, w, sg)
        if wl:
            out.append(poly(wl, s.get("_fin", COL["wing_dark"]), COL["outline"], 0.8 / px))
    if tier >= 2:
        R = w.get("root_y", s["fw"] / 2)
        for sg in (-1, 1):
            # flap and aileron line roughly parallel to the trailing edge
            ys = [R + 0.05, w["kink"], w["sb"] * 0.97]
            fl = []
            for yy in ys:
                c = te_y(s, w, yy) - le_y(s, w, yy)
                fl.append((sg * yy, te_y(s, w, yy) - c * 0.24))
            out.append(path(smooth_path(fl, False), "none", COL["wing_line"], 0.8 / px))
            ail = w.get("aileron", 0.72) * w["sb"]
            c = te_y(s, w, ail) - le_y(s, w, ail)
            out.append(line(sg * ail, te_y(s, w, ail) - c * 0.24, sg * ail, te_y(s, w, ail), COL["wing_line"], 0.8 / px))
            if tier >= 3:
                # slats and spoilers
                sl = []
                for yy in (R + 0.6, w["sb"] * 0.97):
                    c = te_y(s, w, yy) - le_y(s, w, yy)
                    sl.append((sg * yy, le_y(s, w, yy) + c * 0.12))
                out.append(path(smooth_path(sl, False), "none", COL["wing_line"], 0.6 / px,
                                extra=f'stroke-dasharray="{fmt(1.6)} {fmt(0.15)}"'))
                for k in range(5):
                    yy = R + 0.8 + k * (ail - R - 1.0) / 5
                    c = te_y(s, w, yy) - le_y(s, w, yy)
                    out.append(line(sg * yy, te_y(s, w, yy) - c * 0.24, sg * yy, te_y(s, w, yy) - c * 0.4, COL["wing_line"], 0.5 / px))
    return "".join(out)


def flap_tracks(s, px):
    w = s["wing"]
    out = []
    for yy in w.get("tracks", []):
        ty = te_y(s, w, yy)
        ln = w.get("track_len", 1.2)
        wd = w.get("track_w", 0.32)
        for sg in (-1, 1):
            out.append(path(f"M{fmt(sg * yy - wd / 2)},{fmt(ty - 0.6)} L{fmt(sg * yy - wd / 2)},{fmt(ty + ln * 0.5)} "
                            f"Q{fmt(sg * yy)},{fmt(ty + ln * 1.15)} {fmt(sg * yy + wd / 2)},{fmt(ty + ln * 0.5)} "
                            f"L{fmt(sg * yy + wd / 2)},{fmt(ty - 0.6)}Z", COL["wing_dark"], COL["outline"], 0.7 / px))
    for e in s.get("engines", []):
        if e["kind"] == "fan" and e.get("aft_fairing", True):
            ty = te_y(s, w, e["y"])
            ln = e.get("fair_len", 1.6)
            wd = 0.42
            for sg in (-1, 1):
                x = sg * e["y"]
                out.append(path(f"M{fmt(x - wd / 2)},{fmt(ty - 0.6)} L{fmt(x - wd / 2)},{fmt(ty + ln * 0.55)} "
                                f"Q{fmt(x)},{fmt(ty + ln * 1.15)} {fmt(x + wd / 2)},{fmt(ty + ln * 0.55)} "
                                f"L{fmt(x + wd / 2)},{fmt(ty - 0.6)}Z", COL["wing_dark"], COL["outline"], 0.7 / px))
    return "".join(out)


def engines_all(s, px, tier, stage, liv=None):
    """stage: 'under' (before wing), 'over' (after wing), 'rear'."""
    out = []
    w = s["wing"]
    for e in s.get("engines", []):
        for sg in (-1, 1):
            ee = dict(e, y=sg * e["y"])
            if e["kind"] == "fan" and stage == "under":
                out.append(nacelle_fan(ee, px, tier, liv))
                if tier >= 3:
                    out.append(pylon(ee, s, w, px, liv))
            elif e["kind"] == "rear" and stage == "rear":
                yy = ee["y"]
                inner = sg * hw(s, e["x"] + e["len"] * 0.5)
                out.append(rect(min(inner, yy), e["x"] + e["len"] * 0.35, abs(yy - inner), e["len"] * 0.35,
                                COL["pylon"], COL["outline"], 0.6 / px))
                out.append(nacelle_fan(ee, px, tier, liv))
            elif e["kind"] == "prop" and stage == e.get("stage", "under"):
                out.append(nacelle_prop(ee, px, tier))
            elif e["kind"] == "prop" and stage == "props":
                out.append(prop(ee["y"], e["x"] - 0.05, e["prop_d"], e["blades"], px, e.get("phase", 12)))
                out.append(spinner(ee["y"], e["x"] + 0.1, e["d"] * 0.28, px))
    return "".join(out)


def upper_deck(s, px):
    u = s.get("upper")
    if not u:
        return ""
    a, b, wd = u["y0"], u["y1"], u["w"]
    pts = []
    n = 30
    for i in range(n + 1):
        t = i / n
        y = a + (b - a) * t
        if t < 0.18:
            k = (t / 0.18) ** 0.5
        elif t > 0.75:
            k = ((1 - t) / 0.25) ** 0.8
        else:
            k = 1
        pts.append((wd / 2 * k, y))
    full = pts + [(-x, y) for x, y in reversed(pts)]
    return poly(full, "none", COL["skin_edge"], 1.2 / px)


def lights(s, px):
    w = s["wing"]
    sb = w["sb"] + (w.get("ext", 0) if w.get("winglet") not in (None, "none") else 0)
    yl = le_y(s, w, w["sb"]) + w["tip"] * 0.5
    r = max(0.12, 1.6 / px)
    return (circle(-sb, yl, r, "#e5322d", None) + circle(sb, yl, r, "#25b04a", None)
            + circle(0, s["L"] * 0.42, r * 0.9, "#e5322d", None))


# ------------------------------------------------------------------ assembly
def silhouette(s):
    """Union of all parts in one color for shadow and far tiers."""
    out = [poly(fuselage_pts(s), "#000")]
    w = s["wing"]
    rp = wing_right(s, w, R=0)
    out.append(poly(rp, "#000") + poly(mirror(rp), "#000"))
    for sg in (-1, 1):
        wl = winglet(s, w, sg)
        if wl:
            out.append(poly(wl, "#000"))
    h = s["hstab"]
    sb = h["span"] / 2
    hp = [(0, h["x"]), (sb, h["x"] + sb * T(R_(h["sweep"]))), (sb, h["x"] + sb * T(R_(h["sweep"])) + h["tip"]), (0, h["x"] + h["c"])]
    out.append(poly(hp, "#000") + poly(mirror(hp), "#000"))
    for e in s.get("engines", []):
        for sg in (-1, 1):
            x = sg * e["y"]
            out.append(rect(x - e["d"] / 2, e["x"], e["d"], e["len"], "#000", rx=e["d"] * 0.3))
    return "".join(out)


def render(s, tier=2, px=6.0, shadow=True, sun=(0.9, 1.3), livery=None):
    """tier 0 marker, 1 silhouette, 2 default (reference style), 3 close up.
    px is the target scale in pixels per meter. Stroke widths are given in pixels."""
    out = []
    if shadow:
        sx, sy = sun
        out.append(g(silhouette(s), f"translate({fmt(sx)} {fmt(sy)})",
                     'fill-opacity="0.32" filter="url(#fShadow)"'))
    if tier <= 1:
        out.append(g(silhouette(s), None, 'fill="#ffffff"').replace('"#000"', '"#f4f6f8"'))
        return "".join(out)
    if livery:
        s = dict(s, _fin=livery.get("fin"))
    liv = livery
    w = s["wing"]
    high = w.get("high")
    fus = poly(fuselage_pts(s), "url(#gFus)", COL["outline"], 1.0 / px)
    ttail = s["hstab"].get("ttail")
    if not high:
        out.append(flap_tracks(s, px))
        out.append(engines_all(s, px, tier, "under", liv))
        out.append(wing_parts(s, px, tier))
        out.append(engines_all(s, px, tier, "over"))
        if not ttail:
            out.append(tail_parts(s, px, tier, "hstab"))
        out.append(fus)
    else:
        if not ttail:
            out.append(tail_parts(s, px, tier, "hstab"))
        out.append(fus)
        for sp in s.get("sponsons", []):
            a, b, o = sp
            for sg in (-1, 1):
                x = sg * (hw(s, (a + b) / 2) + o / 2)
                out.append(rect(x - o / 2 - 0.15, a, o + 0.3, b - a, "url(#gNac)", COL["outline"], 0.7 / px, rx=0.4))
        if tier >= 2:
            out.append(doors_windows(s, px, tier))
            out.append(windscreen(s, px))
        out.append(flap_tracks(s, px))
        out.append(engines_all(s, px, tier, "under", liv))
        out.append(wing_parts(s, px, tier))
    if tier >= 2 and not high:
        out.append(upper_deck(s, px))
        out.append(doors_windows(s, px, tier))
        out.append(windscreen(s, px))
    out.append(engines_all(s, px, tier, "rear", liv))
    out.append(tail_parts(s, px, tier, "fin"))
    if ttail:
        out.append(tail_parts(s, px, tier, "hstab"))
    out.append(engines_all(s, px, tier, "props"))
    if s.get("nose_prop"):
        np_ = s["nose_prop"]
        out.append(prop(0, 0.05, np_["d"], np_["blades"], px, np_.get("phase", 10)))
        out.append(spinner(0, 0.2, np_.get("spinner", 0.22), px))
    if tier >= 3:
        out.append(lights(s, px))
        out.append(circle(0, s["L"] * 0.25, max(0.08, 1.2 / px), "#6d7783", None))
        out.append(circle(0, s["L"] * 0.6, max(0.08, 1.2 / px), "#6d7783", None))
    return "".join(out)


def defs():
    return """
<linearGradient id="gFus" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#cfd6de"/><stop offset="0.18" stop-color="#f1f4f7"/>
  <stop offset="0.5" stop-color="#ffffff"/><stop offset="0.82" stop-color="#f1f4f7"/>
  <stop offset="1" stop-color="#cfd6de"/>
</linearGradient>
<linearGradient id="gNac" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#c9d0d8"/><stop offset="0.35" stop-color="#ffffff"/>
  <stop offset="0.65" stop-color="#ffffff"/><stop offset="1" stop-color="#c9d0d8"/>
</linearGradient>
<filter id="fShadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.35"/></filter>
"""


def extent(s):
    """Bounding box (xmin, ymin, xmax, ymax) in meters, including props and winglets."""
    w = s["wing"]
    half = s["span"] / 2
    for e in s.get("engines", []):
        if e["kind"] == "prop":
            half = max(half, e["y"] + e["prop_d"] / 2)
    ymin = 0
    for e in s.get("engines", []):
        ymin = min(ymin, e["x"] - 0.3)
    ymax = s["L"]
    for e in s.get("engines", []):
        ymax = max(ymax, e["x"] + e["len"] * 1.22)
    h = s["hstab"]
    ymax = max(ymax, h["x"] + (h["span"] / 2) * T(R_(h["sweep"])) + h["tip"])
    return (-half, ymin, half, ymax)


def livery_layer(s, fin="#c8102e", nacelle="#1f3864", px=6.0):
    """Airline tint layer: only the parts visible from above (fin, nacelles, winglets)."""
    out = []
    w = s["wing"]
    f = s["fin"]
    a, b, wd = f["x0"], f["x1"], f["w"]
    d0 = f.get("dorsal", a)
    pts = [(0, d0), (wd * 0.12, a), (wd * 0.5, a + (b - a) * 0.3), (wd * 0.32, a + (b - a) * 0.8), (0.04, b),
           (-0.04, b), (-wd * 0.32, a + (b - a) * 0.8), (-wd * 0.5, a + (b - a) * 0.3), (-wd * 0.12, a)]
    out.append(path(smooth_path(pts), fin, None))
    for e in s.get("engines", []):
        if e["kind"] in ("fan", "rear"):
            for sg in (-1, 1):
                x, y0, Ln, r = sg * e["y"], e["x"], e["len"], e["d"] / 2
                yend = y0 + 0.88 * Ln
                if e["kind"] == "fan":
                    yend = min(yend, le_y(s, w, e["y"] - r) )
                out.append(rect(x - r * 0.97, y0 + 0.12 * Ln, r * 1.94, yend - (y0 + 0.12 * Ln), nacelle, None, op=0.9))
    w = s["wing"]
    for sg in (-1, 1):
        wl = winglet(s, w, sg)
        if wl:
            out.append(poly(wl, fin, None))
    return "".join(out)


def marker(s, color="#f08a24"):
    L = s["L"]
    k = max(6, L * 0.5)
    return poly([(0, 0), (k * 0.55, k * 1.6), (0, k * 1.2), (-k * 0.55, k * 1.6)], color, "#ffffff", k * 0.08,
                extra='stroke-linejoin="round"')
