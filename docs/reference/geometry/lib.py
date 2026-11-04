import math
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.ops import unary_union

YEL = '#f2c230'
RED = '#e0414a'
WHITE = '#f4f4f4'
ASPH = '#4b4c52'
CONC = '#a9a7a2'
GRASS = '#6c9146'
GRASS2 = '#679041'
BG = '#1d2128'
PANEL = '#262b33'
TXT = '#e9edf2'
MUTED = '#9aa4b2'
CYAN = '#3cc8ea'
FONT = "DejaVu Sans, Arial, sans-serif"


class View:
    """Maps world meters (x right, y up) to screen pixels."""
    def __init__(self, ox, oy, s):
        self.ox, self.oy, self.s = ox, oy, s

    def p(self, x, y):
        return (self.ox + x * self.s, self.oy - y * self.s)

    def pts(self, pts):
        return ' '.join(f'{a:.1f},{b:.1f}' for a, b in (self.p(x, y) for x, y in pts))


def arc_pts(cx, cy, r, a0, a1, n=40):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def polyline(v, pts, color, w, dash=None, op=1, cap='round'):
    d = f' stroke-dasharray="{dash}"' if dash else ''
    return f'<polyline points="{v.pts(pts)}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="{cap}" stroke-linejoin="round" opacity="{op}"{d}/>'


def poly(v, pts, fill, stroke='none', w=0, op=1, extra=''):
    return f'<polygon points="{v.pts(pts)}" fill="{fill}" stroke="{stroke}" stroke-width="{w}" opacity="{op}" {extra}/>'


def shp(v, geom, fill, stroke='none', w=0, op=1, extra=''):
    out = []
    geoms = geom.geoms if hasattr(geom, 'geoms') else [geom]
    for g in geoms:
        if g.is_empty or g.geom_type != 'Polygon':
            continue
        d = 'M ' + ' L '.join(f'{a:.1f},{b:.1f}' for a, b in (v.p(x, y) for x, y in g.exterior.coords)) + ' Z'
        for ring in g.interiors:
            d += ' M ' + ' L '.join(f'{a:.1f},{b:.1f}' for a, b in (v.p(x, y) for x, y in ring.coords)) + ' Z'
        out.append(f'<path d="{d}" fill="{fill}" fill-rule="evenodd" stroke="{stroke}" stroke-width="{w}" stroke-linejoin="round" opacity="{op}" {extra}/>')
    return '\n'.join(out)


def shp_outline(v, geom, color, w, dash=None, op=1):
    out = []
    geoms = geom.geoms if hasattr(geom, 'geoms') else [geom]
    for g in geoms:
        if g.geom_type == 'Polygon':
            out.append(polyline(v, list(g.exterior.coords), color, w, dash, op))
    return '\n'.join(out)


def text(x, y, s, size=13, color=TXT, anchor='middle', weight='normal'):
    s = s.replace('&', '&amp;')
    return f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}" fill="{color}" text-anchor="{anchor}" font-weight="{weight}">{s}</text>'


def label_box(cx, cy, s, size, fill, color, pad_x=5, pad_y=3, stroke='none'):
    """Text drawn inside its own box, box sized to text with padding."""
    w = len(s) * size * 0.62 + pad_x * 2
    h = size + pad_y * 2
    return (f'<rect x="{cx - w / 2:.1f}" y="{cy - h / 2:.1f}" width="{w:.1f}" height="{h:.1f}" rx="2" fill="{fill}" stroke="{stroke}" stroke-width="1"/>'
            + text(cx, cy + size * 0.36, s, size, color, 'middle', 'bold')), w, h


def badge(cx, cy, n, r=10):
    return (f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="{WHITE}" stroke="{BG}" stroke-width="1.5"/>'
            + text(cx, cy + 4.5, str(n), 12, BG, 'middle', 'bold'))


# ---------------- aircraft planform ----------------
def aircraft(L, S, fw, yr, cr, ct, sweep, hs, hcr, hsweep, engines, eng_len=4.0, eng_w=2.2, straight_nose=False):
    """Planform in local coords: nose at y=0, tail at y=L (y grows toward tail). x lateral."""
    parts = []
    # fuselage with tapered nose and tail
    nose = [(-fw * 0.15, 0), (fw * 0.15, 0), (fw * 0.42, fw * 0.6), (fw / 2, fw * 1.6)]
    tail = [(fw / 2, L * 0.80), (fw * 0.22, L * 0.98), (0.0, L), (-fw * 0.22, L * 0.98), (-fw / 2, L * 0.80)]
    fus = nose + tail + [(-fw / 2, fw * 1.6), (-fw * 0.42, fw * 0.6)]
    parts.append(Polygon(fus))
    t = math.tan(math.radians(sweep))
    for sg in (1, -1):
        span = S / 2
        tip_le = yr + (span - fw / 2) * t
        parts.append(Polygon([(sg * fw / 2 * 0.9, yr), (sg * span, tip_le), (sg * span, tip_le + ct), (sg * fw / 2 * 0.9, yr + cr)]))
        ht = math.tan(math.radians(hsweep))
        hroot = L - hcr - L * 0.03
        htip = hroot + (hs / 2 - fw * 0.2) * ht
        parts.append(Polygon([(sg * fw * 0.2, hroot), (sg * hs / 2, htip), (sg * hs / 2, htip + hcr * 0.45), (sg * fw * 0.2, hroot + hcr)]))
        for ex in engines:
            ey = yr + (ex - fw / 2) * t - eng_len * 0.7
            parts.append(Polygon([(sg * (ex - eng_w / 2), ey), (sg * (ex + eng_w / 2), ey), (sg * (ex + eng_w / 2), ey + eng_len), (sg * (ex - eng_w / 2), ey + eng_len)]))
    return unary_union(parts)


TYPES = {
    'KA350': dict(L=14.2, S=17.6, fw=1.6, yr=5.6, cr=2.4, ct=1.2, sweep=2, hs=5.6, hcr=1.4, hsweep=10, engines=[2.6], eng_len=4.2, eng_w=1.1),
    'C172': dict(L=8.3, S=11.0, fw=1.1, yr=2.6, cr=1.6, ct=1.1, sweep=0, hs=3.4, hcr=1.0, hsweep=5, engines=[]),
    'A320': dict(L=37.6, S=35.8, fw=3.95, yr=12.6, cr=6.1, ct=1.6, sweep=25, hs=12.5, hcr=3.4, hsweep=29, engines=[5.75], eng_len=4.4, eng_w=2.2),
    'ATR72': dict(L=27.2, S=27.1, fw=2.8, yr=10.2, cr=2.6, ct=1.4, sweep=2, hs=7.3, hcr=1.9, hsweep=10, engines=[4.1], eng_len=5.4, eng_w=1.3),
    'B77W': dict(L=73.9, S=64.8, fw=6.2, yr=25.5, cr=13.0, ct=2.4, sweep=31.6, hs=21.5, hcr=6.0, hsweep=32, engines=[9.6], eng_len=7.3, eng_w=3.9),
    'A388': dict(L=72.7, S=79.8, fw=7.1, yr=23.5, cr=17.0, ct=3.0, sweep=33.5, hs=30.4, hcr=7.5, hsweep=34, engines=[15.4, 25.7], eng_len=6.5, eng_w=3.4),
}


def place(geom, nose_x, nose_y):
    """Local (y toward tail) to world (y up): world = (nose_x + x, nose_y - y)."""
    from shapely import affinity
    g = affinity.scale(geom, 1, -1, origin=(0, 0))
    return affinity.translate(g, nose_x, nose_y)


def svg_doc(w, h, body, defs=''):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<defs>{defs}</defs><rect width="{w}" height="{h}" fill="{BG}"/>{body}</svg>')


def grass_pattern(pid='grass', s=2.0):
    st = 6 * s
    return (f'<pattern id="{pid}" width="{st * 2:.1f}" height="{st * 2:.1f}" patternUnits="userSpaceOnUse">'
            f'<rect width="{st * 2:.1f}" height="{st * 2:.1f}" fill="{GRASS}"/>'
            f'<rect width="{st * 2:.1f}" height="{st:.1f}" fill="{GRASS2}"/></pattern>')


def hatch_pattern(pid, color, gap=6):
    return (f'<pattern id="{pid}" width="{gap}" height="{gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
            f'<line x1="0" y1="0" x2="0" y2="{gap}" stroke="{color}" stroke-width="1.6"/></pattern>')
