"""Core helpers for terminal fixture sprites.

Every fixture is drawn in meters with its top left corner at (0, 0). The passenger side is the bottom edge (+y),
the staff or back side is the top edge. The game rotates the baked sprite in 90 degree steps.

Shadows follow docs/ART_AND_ASSETS.md section 1: sun from the upper left, so the shadow falls right and down.
The offset scales with the height of each solid part, (0.13 h, 0.18 h), which gives the documented 0.25 m and
0.35 m for a 1.9 m vehicle. Each solid adds its outline to one shadow group, the group is blurred once and drawn at
28 percent black, so overlapping parts never darken twice.
"""
import math
from lib import fmt, rect, circle, ellipse, line, poly, path, g, text

FX_OUT = "#5d6672"      # fixture outline
SUN = (0.13, 0.18)      # shadow offset per meter of height
SH_CAP = 2.6            # tallest height used for the shadow offset

# Terminal palette tokens (proposed additions to src/render/palette.ts)
C = dict(
    counter="#f4f2ec", counterEdge="#cfc9bb", laminate="#e9ecef", stone="#efece5", walnut="#6e4a33",
    oak="#b88a5c", steel="#c3cad2", steelDk="#8c96a2", machine="#dfe3e8", machineDk="#aeb6c0",
    belt="#4a5058", beltDk="#2f343b", roller="#6b737d", slot="#0b0e12",
    screen="#1d2a38", glow="#5fa8d3", glass="#bfe3f5", glassEdge="#5fa8d3",
    navy="#2f4a6e", teal="#2f7f86", mustard="#d4a23a", terracotta="#c46a4a", charcoal="#4b5565",
    sage="#7f9c7a", plum="#7a4f7f", cream="#ece3d0",
    leaf="#4f8a4a", leafLt="#6aa65a", leafDk="#3d6f3c", soil="#6b5440", pot="#d9d4c8",
    ok="#3ec46d", stop="#e04848", amber="#f2a93b", hazard="#f2c230", black="#141414",
    porcelain="#fbfcfd", chrome="#dfe5ea", wall="#2c3441", red="#d9312b",
)
LIVERY = ["#c8102e", "#1f6fd1", "#0f8a6b", "#f08a24", "#6a3fb5"]


def mix(c1, c2, t):
    a = [int(c1[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(c2[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02x%02x%02x" % tuple(int(round(a[k] + (b[k] - a[k]) * t)) for k in range(3))


def shade(c, f):
    """f < 0 darkens toward black, f > 0 lightens toward white."""
    return mix(c, "#000000", -f) if f < 0 else mix(c, "#ffffff", f)


# ----------------------------------------------------------------------------------------------------------------
# Gradients. Registered on demand, written once into <defs>.
# ----------------------------------------------------------------------------------------------------------------
_GRADS = {}
BASE = {}   # gradient url -> base color, used by the flat tier 1 bake
SPEC = {"url(#pPerf)": {"pat": "perf"}, "url(#pWeave)": {"pat": "weave"}}   # url -> exported fill spec


def soft(color, axis="h"):
    """Soft cylinder shading like the aircraft fuselage: darker edges, light center."""
    gid = f"s{axis}{color[1:]}"
    if gid not in _GRADS:
        x2, y2 = ("1", "0") if axis == "h" else ("0", "1")
        e, m, c = shade(color, -0.12), shade(color, 0.06), shade(color, 0.14)
        _GRADS[gid] = (f'<linearGradient id="{gid}" x1="0" y1="0" x2="{x2}" y2="{y2}">'
                       f'<stop offset="0" stop-color="{e}"/><stop offset="0.2" stop-color="{m}"/>'
                       f'<stop offset="0.5" stop-color="{c}"/><stop offset="0.8" stop-color="{m}"/>'
                       f'<stop offset="1" stop-color="{e}"/></linearGradient>')
    BASE[f"url(#{gid})"] = color
    SPEC[f"url(#{gid})"] = {"g": "soft", "c": color, "a": axis}
    return f"url(#{gid})"


def lit(color, axis="v"):
    """Top lit panel: lighter at the top or left edge, a little darker at the far edge."""
    gid = f"l{axis}{color[1:]}"
    if gid not in _GRADS:
        x2, y2 = ("1", "0") if axis == "h" else ("0", "1")
        _GRADS[gid] = (f'<linearGradient id="{gid}" x1="0" y1="0" x2="{x2}" y2="{y2}">'
                       f'<stop offset="0" stop-color="{shade(color, 0.12)}"/>'
                       f'<stop offset="1" stop-color="{shade(color, -0.08)}"/></linearGradient>')
    BASE[f"url(#{gid})"] = color
    SPEC[f"url(#{gid})"] = {"g": "lit", "c": color, "a": axis}
    return f"url(#{gid})"


def dome(color):
    """Radial shading for round parts (stools, bins, plant canopies)."""
    gid = f"d{color[1:]}"
    if gid not in _GRADS:
        _GRADS[gid] = (f'<radialGradient id="{gid}" cx="0.4" cy="0.38" r="0.65">'
                       f'<stop offset="0" stop-color="{shade(color, 0.18)}"/>'
                       f'<stop offset="0.7" stop-color="{color}"/>'
                       f'<stop offset="1" stop-color="{shade(color, -0.14)}"/></radialGradient>')
    BASE[f"url(#{gid})"] = color
    SPEC[f"url(#{gid})"] = {"g": "dome", "c": color}
    return f"url(#{gid})"


def screen_grad():
    gid = "gScreenFx"
    BASE["url(#gScreenFx)"] = "#1d2a38"
    SPEC["url(#gScreenFx)"] = {"g": "screen"}
    if gid not in _GRADS:
        _GRADS[gid] = ('<linearGradient id="gScreenFx" x1="0" y1="0" x2="1" y2="1">'
                       '<stop offset="0" stop-color="#2c4864"/><stop offset="0.55" stop-color="#1d2a38"/>'
                       '<stop offset="1" stop-color="#141c26"/></linearGradient>')
    return f"url(#{gid})"


def glow_grad():
    gid = "gGlowFx"
    SPEC["url(#gGlowFx)"] = {"g": "glow"}
    if gid not in _GRADS:
        _GRADS[gid] = ('<radialGradient id="gGlowFx" cx="0.5" cy="0" r="1">'
                       '<stop offset="0" stop-color="#9fd3f2" stop-opacity="0.55"/>'
                       '<stop offset="1" stop-color="#9fd3f2" stop-opacity="0"/></radialGradient>')
    return f"url(#{gid})"


def water_grad():
    gid = "gWaterFx"
    SPEC["url(#gWaterFx)"] = {"g": "water"}
    BASE["url(#gWaterFx)"] = "#7cc3e0"
    if gid not in _GRADS:
        _GRADS[gid] = ('<radialGradient id="gWaterFx" cx="0.5" cy="0.5" r="0.5">'
                       '<stop offset="0" stop-color="#bfe6f5"/><stop offset="0.7" stop-color="#7cc3e0"/>'
                       '<stop offset="1" stop-color="#4f9fc4"/></radialGradient>')
    return f"url(#{gid})"


def defs():
    base = ('<filter id="fxs" x="-30%" y="-30%" width="160%" height="160%">'
            '<feGaussianBlur stdDeviation="0.07"/></filter>'
            '<pattern id="pHatchW" width="0.35" height="0.35" patternUnits="userSpaceOnUse" '
            'patternTransform="rotate(45)"><rect width="0.35" height="0.35" fill="none"/>'
            '<line x1="0" y1="0" x2="0" y2="0.35" stroke="#ffffff" stroke-width="0.06"/></pattern>'
            '<pattern id="pPerf" width="0.07" height="0.07" patternUnits="userSpaceOnUse">'
            '<circle cx="0.035" cy="0.035" r="0.014" fill="#00000030"/></pattern>'
            '<pattern id="pWeave" width="0.1" height="0.1" patternUnits="userSpaceOnUse">'
            '<path d="M0,0.05H0.1M0.05,0V0.1" stroke="#ffffff22" stroke-width="0.012"/></pattern>')
    return base + "".join(_GRADS.values())


# ----------------------------------------------------------------------------------------------------------------
# Convex hull for shadows
# ----------------------------------------------------------------------------------------------------------------

def hull(pts):
    pts = sorted(set((round(x, 4), round(y, 4)) for x, y in pts))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def rect_pts(x, y, w, h, rx=0.0):
    if rx <= 0:
        return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
    rx = min(rx, w / 2, h / 2)
    out = []
    for cx, cy, a0 in ((x + w - rx, y + rx, -90), (x + w - rx, y + h - rx, 0), (x + rx, y + h - rx, 90),
                       (x + rx, y + rx, 180)):
        for k in range(4):
            a = math.radians(a0 + k * 30)
            out.append((cx + rx * math.cos(a), cy + rx * math.sin(a)))
    return out


def ell_pts(cx, cy, rx, ry, n=20):
    return [(cx + rx * math.cos(2 * math.pi * k / n), cy + ry * math.sin(2 * math.pi * k / n)) for k in range(n)]


# ----------------------------------------------------------------------------------------------------------------
# Drawing context
# ----------------------------------------------------------------------------------------------------------------

def _r(v):
    return round(v, 3)


def _xf_pt(x, y, tx, ty, rot):
    if rot == 0:
        return (_r(tx + x), _r(ty + y))
    if rot == 90:
        return (_r(tx - y), _r(ty + x))
    if rot == 180:
        return (_r(tx - x), _r(ty - y))
    return (_r(tx + y), _r(ty - x))


def _xf_path(d, tx, ty, rot):
    """Transform an absolute path string (M L Q C A H V Z) by a translate and a 90 degree rotation."""
    import re
    toks = re.findall(r"[MLQCAHVZ]|-?\d*\.?\d+(?:e-?\d+)?", d)
    out, i, cmd = [], 0, None
    cur = (0.0, 0.0)
    while i < len(toks):
        t = toks[i]
        if t in "MLQCAHVZ":
            cmd = t
            i += 1
            if cmd == "Z":
                out.append("Z")
            continue
        if cmd in "MLQC":
            n = {"M": 1, "L": 1, "Q": 2, "C": 3}[cmd]
            pts = []
            for _ in range(n):
                x, y = float(toks[i]), float(toks[i + 1])
                i += 2
                pts.append(_xf_pt(x, y, tx, ty, rot))
                cur = (x, y)
            out.append(cmd + " ".join(f"{fmt(a)},{fmt(b)}" for a, b in pts))
        elif cmd == "A":
            rx, ry, xr, la, sw, x, y = [float(v) for v in toks[i:i + 7]]
            i += 7
            if rot in (90, 270):
                rx, ry = ry, rx
            px_, py_ = _xf_pt(x, y, tx, ty, rot)
            cur = (x, y)
            out.append(f"A{fmt(rx)},{fmt(ry)} {fmt(xr)} {int(la)} {int(sw)} {fmt(px_)},{fmt(py_)}")
        elif cmd in "HV":
            v = float(toks[i])
            i += 1
            x, y = (v, cur[1]) if cmd == "H" else (cur[0], v)
            cur = (x, y)
            px_, py_ = _xf_pt(x, y, tx, ty, rot)
            out.append(f"L{fmt(px_)},{fmt(py_)}")
    return " ".join(out)


def xf_op(op, tx, ty, rot):
    """Move one recorded op into the parent frame."""
    o = dict(op)
    k = o["k"]
    if k == "r":
        pts = [_xf_pt(o["x"], o["y"], tx, ty, rot), _xf_pt(o["x"] + o["w"], o["y"] + o["h"], tx, ty, rot)]
        o["x"], o["y"] = min(p[0] for p in pts), min(p[1] for p in pts)
        o["w"], o["h"] = (o["h"], o["w"]) if rot in (90, 270) else (o["w"], o["h"])
        if "fd" in o and rot:
            o["fr"] = (o.get("fr", 0) + rot) % 360
    elif k in ("c", "e", "t", "air"):
        o["x"], o["y"] = _xf_pt(o["x"], o["y"], tx, ty, rot)
        if k in ("e", "t", "air"):
            o["rot"] = (o.get("rot", 0) + rot) % 360
        if k == "c" and rot and "fd" in o:
            o["fr"] = (o.get("fr", 0) + rot) % 360
    elif k in ("p", "glow"):
        o["p"] = [list(_xf_pt(x, y, tx, ty, rot)) for x, y in o["p"]]
        if rot and "fd" in o:
            o["fr"] = (o.get("fr", 0) + rot) % 360
    elif k == "a":
        o["d"] = _xf_path(o["d"], tx, ty, rot)
        if "shp" in o:
            o["shp"] = [list(_xf_pt(x, y, tx, ty, rot)) for x, y in o["shp"]]
        if rot and "fd" in o:
            o["fr"] = (o.get("fr", 0) + rot) % 360
    elif k == "l":
        o["x1"], o["y1"] = _xf_pt(o["x1"], o["y1"], tx, ty, rot)
        o["x2"], o["y2"] = _xf_pt(o["x2"], o["y2"], tx, ty, rot)
    return o


class D:
    """Collects body and shadow for one fixture. px is the bake scale, used to keep strokes in screen pixels.
    Every call is also recorded in self.ops as plain data, the format exported to the game."""

    def __init__(self, px=60.0, tier=3, rot=0):
        self.px = px
        self.tier = tier
        self.rot = rot % 360     # placement rotation, so the shadow is baked toward the world sun
        self.b = []
        self.sh = []
        self.over = []      # overhead parts: drawn last, translucent with a dashed edge
        self.ops = []       # recorded draw ops, see export_fixtures.py for the schema

    def _fill(self, f):
        if f is None or f == "none":
            return None
        spec = SPEC.get(f)
        return spec if spec else f

    def _sw(self, sw):
        if sw is None:
            return {"px": 0.9}
        if abs(sw - 0.6 / self.px) < 1e-9:
            return {"px": 0.6}
        return {"m": _r(sw)}

    def _rec(self, op, st, sw, opacity, ht, extra=""):
        f = op.get("f")
        op["f"] = self._fill(f) if isinstance(f, str) else f
        if op["f"] is None:
            op.pop("f")
        if st:
            op["s"] = st
            op["sw"] = self._sw(sw)
        if opacity is not None:
            op["o"] = opacity
        if ht:
            op["ht"] = _r(ht)
        if "stroke-dasharray" in extra:
            import re
            m_ = re.search(r'stroke-dasharray="([^"]+)"', extra)
            if m_:
                op["dash"] = [float(v) for v in m_.group(1).replace(",", " ").split()]
        self.ops.append(op)

    def _gate(self, area, fill, ht):
        """Tier rules. 3: everything. 2: drop parts under 0.012 m2. 1: only parts of 0.1 m2 or more that stand
        0.3 m or taller, flat base color, no outline. Returns the fill to use, or None to skip."""
        if self.tier >= 3:
            return fill
        if self.tier == 2:
            return fill if area >= 0.012 else None
        if area < 0.1 or ht < 0.3:
            return None
        return BASE.get(fill, fill)

    @property
    def lw(self):
        return 0.9 / self.px

    @property
    def dw(self):
        return 0.6 / self.px

    def _shadow(self, pts, h):
        if not h:
            return
        hh = min(h, SH_CAP)
        dx, dy = SUN[0] * hh, SUN[1] * hh
        dx, dy = {0: (dx, dy), 90: (dy, -dx), 180: (-dx, -dy), 270: (-dy, dx)}[self.rot]
        hp = hull(pts + [(x + dx, y + dy) for x, y in pts])
        self.sh.append(poly(hp, "#000"))

    # solids --------------------------------------------------------------------------------------------------
    def R(self, x, y, w, h, fill, ht=0.0, rx=0.0, st=FX_OUT, sw=None, op=None, extra=""):
        self._rec({"k": "r", "x": _r(x), "y": _r(y), "w": _r(w), "h": _r(h), **({"rx": _r(rx)} if rx else {}),
                   "f": fill}, st, sw, op, ht, extra)
        fill = self._gate(w * h, fill, ht)
        if fill is None:
            return
        if self.tier == 1:
            st, extra = None, ""
        self._shadow(rect_pts(x, y, w, h, rx), ht)
        self.b.append(rect(x, y, w, h, fill, st, self.lw if sw is None else sw, rx, op, extra))

    def C(self, cx, cy, r, fill, ht=0.0, st=FX_OUT, sw=None, op=None):
        self._rec({"k": "c", "x": _r(cx), "y": _r(cy), "r": _r(r), "f": fill}, st, sw, op, ht)
        fill = self._gate(3.14 * r * r, fill, ht)
        if fill is None:
            return
        if self.tier == 1:
            st = None
        self._shadow(ell_pts(cx, cy, r, r), ht)
        self.b.append(circle(cx, cy, r, fill, st, self.lw if sw is None else sw, op))

    def E(self, cx, cy, rx, ry, fill, ht=0.0, st=FX_OUT, sw=None, op=None, rot=0):
        self._rec({"k": "e", "x": _r(cx), "y": _r(cy), "rx": _r(rx), "ry": _r(ry), **({"rot": _r(rot)} if rot else {}),
                   "f": fill}, st, sw, op, ht)
        fill = self._gate(3.14 * rx * ry, fill, ht)
        if fill is None:
            return
        if self.tier == 1:
            st = None
        self._shadow(ell_pts(cx, cy, rx, ry) if not rot else
                     [(cx + (px - cx) * math.cos(math.radians(rot)) - (py - cy) * math.sin(math.radians(rot)),
                       cy + (px - cx) * math.sin(math.radians(rot)) + (py - cy) * math.cos(math.radians(rot)))
                      for px, py in ell_pts(cx, cy, rx, ry)], ht)
        e = ellipse(cx, cy, rx, ry, fill, st, self.lw if sw is None else sw, op)
        if rot:
            e = g(e, f"rotate({fmt(rot)} {fmt(cx)} {fmt(cy)})")
        self.b.append(e)

    def P(self, pts, fill, ht=0.0, st=FX_OUT, sw=None, op=None):
        self._rec({"k": "p", "p": [[_r(a), _r(b)] for a, b in pts], "f": fill}, st, sw, op, ht)
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        fill = self._gate((max(xs) - min(xs)) * (max(ys) - min(ys)) * 0.6, fill, ht)
        if fill is None:
            return
        if self.tier == 1:
            st = None
        self._shadow(list(pts), ht)
        self.b.append(poly(pts, fill, st, self.lw if sw is None else sw, op, 'stroke-linejoin="round"'))

    def A(self, d, fill="none", st=FX_OUT, spx=None, sw=None, op=None, shadow_pts=None, ht=0.0, extra=""):
        """Path. spx is a stroke width in screen pixels, sw in meters."""
        rop = {"k": "a", "d": d, "f": fill}
        if shadow_pts:
            rop["shp"] = [[_r(a), _r(b)] for a, b in shadow_pts]
        self._rec(rop, st, sw if sw is not None else (None if not spx else spx / self.px), op, ht if shadow_pts else 0,
                  extra)
        if st and spx and sw is None:
            rop["sw"] = {"px": spx}
        if self.tier < 3 and not shadow_pts and fill == "none" and (spx or 0) < 1.2:
            return
        if self.tier == 1:
            if not shadow_pts or ht < 0.3:
                return
            fill, st = BASE.get(fill, fill), None
        if shadow_pts:
            self._shadow(shadow_pts, ht)
        w = sw if sw is not None else (spx / self.px if spx else self.lw)
        self.b.append(path(d, fill, st, w, op, extra + ' stroke-linecap="round" stroke-linejoin="round"'))

    # details -------------------------------------------------------------------------------------------------
    def L(self, x1, y1, x2, y2, col, spx=0.7, dash=None, cap="round", op=None, sw=None):
        lop = {"k": "l", "x1": _r(x1), "y1": _r(y1), "x2": _r(x2), "y2": _r(y2), "s": col,
               "sw": {"m": _r(sw)} if sw is not None else {"px": spx}}
        if cap != "round":
            lop["cap"] = cap
        if dash:
            lop["dash"] = [float(v) for v in str(dash).split()]
        if op is not None:
            lop["o"] = op
        self.ops.append(lop)
        if self.tier == 1 or (self.tier == 2 and sw is None and spx < 1.0):
            return
        self.b.append(line(x1, y1, x2, y2, col, sw if sw is not None else spx / self.px, dash, cap, op))

    def T(self, x, y, s, size, fill="#ffffff", weight="bold", anchor="middle"):
        self.ops.append({"k": "t", "x": _r(x), "y": _r(y), "s": s, "size": _r(size), "f": fill,
                         **({"anchor": anchor} if anchor != "middle" else {})})
        self.b.append(text(x, y, s, size, fill, weight, anchor))

    def raw(self, s):
        if self.tier >= 2:
            self.b.append(s)

    def place(self, fn, tx, ty, rot=0, *a, **kw):
        """Draw another fixture function inside this one at (tx, ty), rotated by rot (90 degree steps).
        The child bakes its shadow for the combined rotation, so the sun stays right in world space."""
        sub = D(self.px, self.tier, (self.rot + rot) % 360)
        fn(sub, *a, **kw)
        self.ops += [xf_op(o_, tx, ty, rot % 360) for o_ in sub.ops]
        t = f"translate({fmt(tx)} {fmt(ty)})" + (f" rotate({rot})" if rot else "")
        self.b.append(g(sub.b, t))
        if sub.sh:
            self.sh.append(g(sub.sh, t))
        if sub.over:
            self.over.append(g(sub.over, t))

    def overhead(self, x, y, w, h, fill, rx=0.05, op=0.8):
        self.ops.append({"k": "r", "x": _r(x), "y": _r(y), "w": _r(w), "h": _r(h), "rx": _r(rx), "f": fill,
                         "s": "#1d2430", "sw": {"px": 0.9}, "o": op, "dash": [4, 3], "dashPx": 1, "ov": 1})
        if self.tier < 2:
            return
        self.over.append(rect(x, y, w, h, fill, "#1d2430", 0.9 / self.px, rx, op,
                              f'stroke-dasharray="{fmt(4 / self.px)} {fmt(3 / self.px)}"'))

    def overhead_path(self, d, fill="none", st=None, spx=1.6, op=0.95):
        """Overhead artwork (sign faces, screen edges) drawn in the overhead pass."""
        rop = {"k": "a", "d": d, "ov": 1, "o": op}
        if fill and fill != "none":
            rop["f"] = fill
        if st:
            rop["s"] = st
            rop["sw"] = {"px": spx}
        self.ops.append(rop)
        if self.tier >= 2:
            self.over.append(path(d, fill or "none", st, spx / self.px, op,
                                  'stroke-linecap="round" stroke-linejoin="round"'))

    def glow(self, pts):
        """Soft screen light on the floor: a fan polygon with the glow gradient, no outline, no shadow."""
        self.ops.append({"k": "glow", "p": [[_r(a), _r(b)] for a, b in pts]})
        if self.tier >= 2:
            self.b.append(poly(pts, glow_grad(), None))

    def aircraft(self, type_id, x, y, scale, rot=0, svg=""):
        """A scale model drawn by the aircraft generator (type id from aircraft.mvp.json)."""
        self.ops.append({"k": "air", "type": type_id, "x": _r(x), "y": _r(y), "scale": scale, "rot": rot})
        if self.tier >= 2:
            self.b.append(svg)

    def svg(self, shadow=True):
        out = []
        if shadow and self.sh:
            out.append(g(self.sh, None, 'opacity="0.28" filter="url(#fxs)"'))
        out += self.b
        if self.tier >= 2:
            out += self.over
        return "".join(out)


# ----------------------------------------------------------------------------------------------------------------
# Shared small parts
# ----------------------------------------------------------------------------------------------------------------

def monitor(d, cx, cy, w=0.42, facing="up", ht=1.25):
    """Flat monitor seen from above: thin slab, glowing face edge, small round foot behind."""
    t = 0.05
    if facing in ("up", "down"):
        d.E(cx, cy + (0.07 if facing == "up" else -0.07), 0.09, 0.06, "#3a414b", ht - 0.3, st=None)
        d.R(cx - w / 2, cy - t / 2, w, t, "#2a313b", ht, rx=0.015, sw=d.dw)
        fy = cy - t / 2 if facing == "up" else cy + t / 2
        d.L(cx - w / 2 + 0.03, fy, cx + w / 2 - 0.03, fy, C["glow"], 1.1)
    else:
        d.E(cx + (0.07 if facing == "left" else -0.07), cy, 0.06, 0.09, "#3a414b", ht - 0.3, st=None)
        d.R(cx - t / 2, cy - w / 2, t, w, "#2a313b", ht, rx=0.015, sw=d.dw)
        fx = cx - t / 2 if facing == "left" else cx + t / 2
        d.L(fx, cy - w / 2 + 0.03, fx, cy + w / 2 - 0.03, C["glow"], 1.1)


def office_chair(d, cx, cy, col="#3a414b", rot=0):
    """Swivel chair: five star base hint, round seat, curved back toward rot direction (0 = back at top)."""
    d.C(cx, cy, 0.26, "#2a2f36", 0.05, st=None)
    d.C(cx, cy + 0.02, 0.22, dome(col), 0.48, sw=d.dw)
    a = math.radians(rot)
    bx, by = cx + 0.2 * math.sin(a), cy - 0.2 * math.cos(a)
    d.E(bx, by, 0.22, 0.07, soft(shade(col, -0.1)), 0.9, sw=d.dw, rot=rot)


def stool(d, cx, cy, col="#3a414b", r=0.18):
    d.C(cx, cy, r, dome(col), 0.75, sw=d.dw)


def keyboard(d, x, y, w=0.36, h=0.12):
    d.R(x, y, w, h, "#d9dde2", 0.76, rx=0.015, sw=d.dw)
    for k in range(1, 4):
        d.L(x + 0.02, y + k * h / 4, x + w - 0.02, y + k * h / 4, "#aeb5be", 0.4)


def printer(d, x, y, w=0.24, h=0.2, col="#e3e7eb"):
    d.R(x, y, w, h, col, 0.85, rx=0.025, sw=d.dw)
    d.R(x + 0.04, y + h - 0.06, w - 0.08, 0.035, "#2a313b", st=None)


def tray(d, cx, cy, w=0.6, h=0.42, col="#8f99a5", ht=1.0):
    d.R(cx - w / 2, cy - h / 2, w, h, col, ht, rx=0.05, sw=d.dw)
    d.R(cx - w / 2 + 0.05, cy - h / 2 + 0.05, w - 0.1, h - 0.1, shade(col, -0.12), st=None, rx=0.03)


def suitcase(d, cx, cy, col="#2f5aa8", w=0.42, h=0.26, ht=1.05):
    d.R(cx - w / 2, cy - h / 2, w, h, soft(col, "v"), ht, rx=0.04, sw=d.dw)
    d.L(cx - w / 2 + 0.06, cy - h / 2 + 0.03, cx - w / 2 + 0.06, cy + h / 2 - 0.03, shade(col, -0.25), 0.6)
    d.L(cx + w / 2 - 0.06, cy - h / 2 + 0.03, cx + w / 2 - 0.06, cy + h / 2 - 0.03, shade(col, -0.25), 0.6)
    d.R(cx - 0.07, cy - h / 2 - 0.03, 0.14, 0.04, "#2a313b", st=None, rx=0.01)


def rollers(d, x, y, w, h, pitch=0.12, along="x", col=None):
    """Roller bed: frame plus cross rollers with a soft highlight."""
    d.R(x, y, w, h, C["steelDk"], 0.8, rx=0.03)
    if along == "x":
        n = int(w / pitch)
        for k in range(n):
            xx = x + (k + 0.5) * w / n
            d.L(xx, y + 0.05, xx, y + h - 0.05, col or "#e6eaee", cap="butt", sw=0.055)
    else:
        n = int(h / pitch)
        for k in range(n):
            yy = y + (k + 0.5) * h / n
            d.L(x + 0.05, yy, x + w - 0.05, yy, col or "#e6eaee", cap="butt", sw=0.055)


def belt(d, x, y, w, h, along="x", ht=0.75, chev=None):
    """Rubber belt with rails and faint ridges. chev = flow color for chevrons."""
    d.R(x, y, w, h, C["steel"], ht, rx=0.03)
    if along == "x":
        d.R(x, y + 0.06, w, h - 0.12, lit(C["belt"], "v"), st=None)
        k = x + 0.1
        while k < x + w - 0.05:
            d.L(k, y + 0.08, k, y + h - 0.08, "#5a616a", 0.5)
            k += 0.1
    else:
        d.R(x + 0.06, y, w - 0.12, h, lit(C["belt"], "h"), st=None)
        k = y + 0.1
        while k < y + h - 0.05:
            d.L(x + 0.08, k, x + w - 0.08, k, "#5a616a", 0.5)
            k += 0.1
    if chev:
        if along == "x":
            cy = y + h / 2
            k = x + 0.25
            while k < x + w - 0.2:
                d.A(f"M{fmt(k)},{fmt(cy - 0.12)} L{fmt(k + 0.12)},{fmt(cy)} L{fmt(k)},{fmt(cy + 0.12)}",
                    "none", chev, 1.2)
                k += 0.4
        else:
            cx = x + w / 2
            k = y + h - 0.25
            while k > y + 0.2:
                d.A(f"M{fmt(cx - 0.12)},{fmt(k)} L{fmt(cx)},{fmt(k - 0.12)} L{fmt(cx + 0.12)},{fmt(k)}",
                    "none", chev, 1.2)
                k -= 0.4


def status_light(d, cx, cy, col=None, r=0.05):
    col = col or C["ok"]
    d.C(cx, cy, r * 2.2, col, st=None, op=0.25)
    d.C(cx, cy, r, col, st="#ffffff", sw=d.dw)


def floor_mark_feet(d, cx, cy, col="#f2c230", s=1.0):
    for sx in (-1, 1):
        d.E(cx + sx * 0.09 * s, cy, 0.045 * s, 0.1 * s, col, st=None, op=0.85)


def stop_line(d, x1, x2, y, col="#f2c230"):
    d.R(x1, y - 0.04, x2 - x1, 0.08, col, st=None, op=0.95)


def ramp_stub(d, x, y, out=True, active=True):
    """BAGGAGE.md 7.1 ramp stub: 2 by 2 m cell, belt runs along y, node at the bottom edge for out ramps."""
    bx = x + 0.6
    d.R(x + 0.5, y + 0.35, 1.0, 1.65, "#00000018", st=None, rx=0.05)
    d.R(bx - 0.1, y + 0.4, 0.1, 1.6, "#c5ccd4", 0.3, st=None)
    d.R(bx + 0.8, y + 0.4, 0.1, 1.6, "#c5ccd4", 0.3, st=None)
    gid = "gRampOut" if out else "gRampIn"
    if gid not in _GRADS:
        _GRADS[gid] = (f'<linearGradient id="{gid}" x1="0" y1="1" x2="0" y2="0">'
                       f'<stop offset="0" stop-color="#4a5058"/><stop offset="0.4" stop-color="#4a5058"/>'
                       f'<stop offset="1" stop-color="#14181d"/></linearGradient>')
    d.R(bx, y + 0.4, 0.8, 1.6, f"url(#{gid})", st=None)
    d.R(bx - 0.2, y + 0.2, 1.2, 0.2, C["wall"], st=None)
    d.R(bx, y + 0.2, 0.8, 0.4, C["slot"], st=None)
    d.R(bx, y + 0.6, 0.8, 0.1, "#9aa3ad", st=None)
    k = y + 0.8
    while k < y + 1.95:
        d.L(bx + 0.05, k, bx + 0.75, k, "#5a616a", 0.5)
        k += 0.2
    col = "#3b82c4" if active else "#9aa3ad"
    for cy in (y + 1.55, y + 1.05):
        d.A(f"M{fmt(bx + 0.25)},{fmt(cy + 0.12)} L{fmt(bx + 0.4)},{fmt(cy - 0.05)} L{fmt(bx + 0.55)},{fmt(cy + 0.12)}",
            "none", col, 1.4)
