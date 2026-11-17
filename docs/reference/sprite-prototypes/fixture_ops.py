"""Reference baker for the exported fixture sprites: draw ops (src/data/fixtures/sprites/*.json) to SVG.

This is the behaviour the TypeScript baker in src/render/sprites/fixtureSprite.ts must match:
  * fills: a hex color, or a spec {g: soft|lit|dome|screen|glow|water|ramp|escalator, c, a} or {pat: perf|weave}
  * strokes: sw {px} is screen pixels at the bake scale, sw {m} is meters
  * tiers: 3 everything; 2 drops parts under 0.012 m2, lines under 1 px and open paths under 1.2 px;
    1 keeps only parts of 0.1 m2 or more that stand 0.3 m or taller, flat base color, no outline, no lines
  * shadow: every kept part with a height ht adds the hull of its outline and the outline moved by the world sun
    offset (0.13 h, 0.18 h), h capped at 2.6 m, rotated into the sprite frame for the placement rotation, all parts
    unioned, blurred 0.07 m, 28 percent black
  * overhead ops (ov) are drawn last, only from tier 2
"""
import json
import math
from lib import fmt, rect, circle, ellipse, line, poly, path, g, text
from fixture_core import hull, rect_pts, ell_pts, shade, SUN, SH_CAP

_defs = {}


def _grad(spec):
    gk = spec.get("g")
    c = spec.get("c", "#888888")
    a = spec.get("a", "h")
    gid = f"x{gk}{a}{c[1:]}" if gk in ("soft", "lit", "dome") else f"x{gk}"
    if gid in _defs:
        return f"url(#{gid})"
    x2, y2 = ("1", "0") if a == "h" else ("0", "1")
    if gk == "soft":
        e, m, cc = shade(c, -0.12), shade(c, 0.06), shade(c, 0.14)
        d = (f'<linearGradient id="{gid}" x1="0" y1="0" x2="{x2}" y2="{y2}"><stop offset="0" stop-color="{e}"/>'
             f'<stop offset="0.2" stop-color="{m}"/><stop offset="0.5" stop-color="{cc}"/>'
             f'<stop offset="0.8" stop-color="{m}"/><stop offset="1" stop-color="{e}"/></linearGradient>')
    elif gk == "lit":
        d = (f'<linearGradient id="{gid}" x1="0" y1="0" x2="{x2}" y2="{y2}"><stop offset="0" '
             f'stop-color="{shade(c, 0.12)}"/><stop offset="1" stop-color="{shade(c, -0.08)}"/></linearGradient>')
    elif gk == "dome":
        d = (f'<radialGradient id="{gid}" cx="0.4" cy="0.38" r="0.65"><stop offset="0" stop-color="{shade(c, 0.18)}"/>'
             f'<stop offset="0.7" stop-color="{c}"/><stop offset="1" stop-color="{shade(c, -0.14)}"/>'
             f'</radialGradient>')
    elif gk == "screen":
        d = (f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2c4864"/>'
             f'<stop offset="0.55" stop-color="#1d2a38"/><stop offset="1" stop-color="#141c26"/></linearGradient>')
    elif gk == "glow":
        d = (f'<radialGradient id="{gid}" cx="0.5" cy="0" r="1"><stop offset="0" stop-color="#9fd3f2" '
             f'stop-opacity="0.55"/><stop offset="1" stop-color="#9fd3f2" stop-opacity="0"/></radialGradient>')
    elif gk == "water":
        d = (f'<radialGradient id="{gid}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#bfe6f5"/>'
             f'<stop offset="0.7" stop-color="#7cc3e0"/><stop offset="1" stop-color="#4f9fc4"/></radialGradient>')
    elif gk == "ramp":
        d = (f'<linearGradient id="{gid}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#4a5058"/>'
             f'<stop offset="0.4" stop-color="#4a5058"/><stop offset="1" stop-color="#14181d"/></linearGradient>')
    else:
        d = (f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dee4"/>'
             f'<stop offset="1" stop-color="#8c96a2"/></linearGradient>')
    _defs[gid] = d
    return f"url(#{gid})"


def _base(spec):
    return {"screen": "#1d2a38", "glow": None, "water": "#7cc3e0", "ramp": "#4a5058",
            "escalator": "#b9c0c8"}.get(spec.get("g"), spec.get("c", "#888888"))


def _fill(f, tier):
    if f is None:
        return "none"
    if isinstance(f, str):
        return f
    if "pat" in f:
        return None if tier < 3 else ("url(#pPerf)" if f["pat"] == "perf" else "url(#pWeave)")
    if tier == 1:
        return _base(f)
    return _grad(f)


def defs():
    return "".join(_defs.values())


def _area(o):
    k = o["k"]
    if k == "r":
        return o["w"] * o["h"]
    if k == "c":
        return 3.14 * o["r"] ** 2
    if k == "e":
        return 3.14 * o["rx"] * o["ry"]
    if k in ("p", "a"):
        pts = o.get("p") or o.get("shp")
        if not pts:
            return 1.0
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        return (max(xs) - min(xs)) * (max(ys) - min(ys)) * 0.6
    return 1.0


def _outline(o):
    k = o["k"]
    if k == "r":
        return rect_pts(o["x"], o["y"], o["w"], o["h"], o.get("rx", 0))
    if k == "c":
        return ell_pts(o["x"], o["y"], o["r"], o["r"])
    if k == "e":
        pts = ell_pts(o["x"], o["y"], o["rx"], o["ry"])
        a = math.radians(o.get("rot", 0))
        return [(o["x"] + (x - o["x"]) * math.cos(a) - (y - o["y"]) * math.sin(a),
                 o["y"] + (x - o["x"]) * math.sin(a) + (y - o["y"]) * math.cos(a)) for x, y in pts]
    if k == "p":
        return [tuple(p) for p in o["p"]]
    if k == "a":
        return [tuple(p) for p in o.get("shp", [])]
    return []


def bake(ops, ppm, tier=3, rot=0, shadow=True, air_render=None):
    """SVG in sprite meters for one asset at bake scale ppm (px per m) and placement rotation rot."""
    sx, sy = SUN
    body, sh, over = [], [], []
    for o in ops:
        k = o["k"]
        ov = o.get("ov")
        if ov and tier < 2:
            continue
        sw = o.get("sw")
        swm = None if not sw else (sw["px"] / ppm if "px" in sw else sw["m"])
        st = o.get("s") if tier > 1 else None
        op = o.get("o")
        dash = None
        if o.get("dash"):
            dash = " ".join(fmt(v / ppm if o.get("dashPx") else v) for v in o["dash"])
        extra = f'stroke-dasharray="{dash}"' if dash else ""
        if k == "l":
            if tier == 1 or (tier == 2 and "px" in sw and sw["px"] < 1.0):
                continue
            body.append(line(o["x1"], o["y1"], o["x2"], o["y2"], o["s"], swm, dash, o.get("cap", "round"), op))
            continue
        if k == "t":
            body.append(text(o["x"], o["y"], o["s"], o["size"], o["f"], "bold", o.get("anchor", "middle"),
                             f'transform="rotate({o.get("rot", 0)} {fmt(o["x"])} {fmt(o["y"])})"'
                             if o.get("rot") else ""))
            continue
        if k == "glow":
            if tier >= 2:
                body.append(poly(o["p"], _grad({"g": "glow"}), None))
            continue
        if k == "air":
            if tier >= 2 and air_render:
                body.append(air_render(o))
            continue
        f = o.get("f")
        h = o.get("ht", 0)
        if k == "a":
            if tier < 3 and not o.get("shp") and f is None and (sw or {}).get("px", 0) < 1.2:
                continue
            if tier == 1 and (not o.get("shp") or h < 0.3):
                continue
        else:
            a = _area(o)
            if tier == 2 and a < 0.012:
                continue
            if tier == 1 and (a < 0.1 or h < 0.3):
                continue
        fill = _fill(f, tier)
        if fill is None:
            continue
        if tier == 1:
            st = None
        target = over if ov else body
        if k == "r":
            target.append(rect(o["x"], o["y"], o["w"], o["h"], fill, st, swm, o.get("rx", 0), op, extra))
        elif k == "c":
            target.append(circle(o["x"], o["y"], o["r"], fill, st, swm, op))
        elif k == "e":
            e_ = ellipse(o["x"], o["y"], o["rx"], o["ry"], fill, st, swm, op)
            if o.get("rot"):
                e_ = g(e_, f"rotate({fmt(o['rot'])} {fmt(o['x'])} {fmt(o['y'])})")
            target.append(e_)
        elif k == "p":
            target.append(poly(o["p"], fill, st, swm, op, 'stroke-linejoin="round"'))
        elif k == "a":
            target.append(path(o["d"], fill, st, swm, op, extra + ' stroke-linecap="round" stroke-linejoin="round"'))
        if shadow and h and not ov:
            hh = min(h, SH_CAP)
            dx, dy = sx * hh, sy * hh
            dx, dy = {0: (dx, dy), 90: (dy, -dx), 180: (-dx, -dy), 270: (-dy, dx)}[rot % 360]
            pts = _outline(o)
            if pts:
                sh.append(poly(hull(pts + [(x + dx, y + dy) for x, y in pts]), "#000"))
    out = []
    if sh:
        out.append(g(sh, None, 'opacity="0.28" filter="url(#fxs)"'))
    return "".join(out + body + over)


def load(path_):
    with open(path_) as f:
        return json.load(f)
