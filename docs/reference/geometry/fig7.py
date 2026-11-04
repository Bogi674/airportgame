import sys
sys.path.insert(0, '/home/claude/samples')
from lib import *
from shapely.geometry import box as sbox

M, GAP = 30, 30
W_FIG = 1170
PW = (W_FIG - 2 * M - 2 * GAP) / 3
PH = 300
S = 1.55
TOP = 96
defs = grass_pattern('grass', S)
body = [text(W_FIG / 2, 38, 'Apron tool modes and terminal size', 22, TXT, 'middle', 'bold'),
        text(W_FIG / 2, 62, 'Both apron modes build the same apron object. Overlapping pieces merge into one apron.', 13, MUTED)]


def dim_tag(x, y, s_, color=TXT, fill='#14181e', stroke='#4a5260'):
    return label_box(x, y, s_, 11, fill, color, 5, 3, stroke)[0]


def handle(v, p, color=WHITE):
    x, y = v.p(*p)
    return f'<rect x="{x - 4:.1f}" y="{y - 4:.1f}" width="8" height="8" fill="{color}" stroke="{BG}" stroke-width="1.2"/>'


def cursor(v, p):
    mx, my = v.p(*p)
    return f'<path d="M {mx:.1f} {my:.1f} l 0 18 l 5 -5 l 4 9 l 3 -1.5 l -4 -9 l 7 0 z" fill="{WHITE}" stroke="{BG}" stroke-width="1.2"/>'


panels = ['A  FREE POLYGON', 'B  RECTANGLE PAINT', 'C  RESULT, ONE APRON']
caps = [['Click to add corners, double click to close.', 'Shift snaps corners to 15 degree steps.'],
        ['Drag a rectangle. It aligns to the runway', 'frame and snaps to existing apron edges.'],
        ['Overlapping pieces merge into one apron.', 'Ctrl drag a rectangle to cut a piece out.']]
old = sbox(-95, -55, -15, 40)
new = sbox(-15, -55, 75, 15)
for i, title in enumerate(panels):
    ox = M + i * (PW + GAP)
    oy = TOP
    v = View(ox + PW / 2, oy + 28 + PH / 2, S)
    body.append(text(ox, oy + 16, title, 14, TXT, 'start', 'bold'))
    body.append(f'<clipPath id="c{i}"><rect x="{ox:.1f}" y="{oy + 28}" width="{PW:.1f}" height="{PH}" rx="6"/></clipPath>')
    g = [f'<rect x="{ox:.1f}" y="{oy + 28}" width="{PW:.1f}" height="{PH}" fill="url(#grass)"/>']
    if i == 0:
        pts = [(-80, -55), (55, -55), (78, -25), (66, 40), (-20, 58)]
        cur = (-82, 28)
        g.append(poly(v, pts + [cur], ASPH, op=0.85))
        g.append(polyline(v, pts, CYAN, 2))
        cur = (-82, 28)
        g.append(polyline(v, [pts[-1], cur], CYAN, 2, '6 5'))
        g.append(polyline(v, [cur, pts[0]], CYAN, 1.4, '3 5', 0.7))
        for p in pts:
            g.append(handle(v, p))
        g.append(cursor(v, cur))
        for a, b in [(0, 1), (2, 3), (3, 4)]:
            ax, ay = pts[a]; bx, by = pts[b]
            mx, my = (ax + bx) / 2, (ay + by) / 2
            L = math.hypot(bx - ax, by - ay)
            # label inside the polygon, pulled 11 m toward the centroid
            cx, cy = 0, 0
            d = math.hypot(cx - mx, cy - my)
            px, py = v.p(mx + (cx - mx) / d * 11, my + (cy - my) / d * 11)
            g.append(dim_tag(px, py, f'{L:.0f} m'))
        tx, ty = v.p(0, 0)
        g.append(dim_tag(tx, ty + 8, f'{Polygon(pts + [cur]).area:,.0f} m²', CYAN, '#14181e', CYAN))
    elif i == 1:
        g.append(shp(v, old, ASPH))
        g.append(shp(v, new, CYAN, op=0.22))
        g.append(shp_outline(v, new, CYAN, 2, '7 5'))
        g.append(handle(v, (-15, 15), CYAN))
        g.append(handle(v, (75, -55), CYAN))
        g.append(cursor(v, (75, -55)))
        bx, by = v.p(30, -66)
        g.append(dim_tag(bx, by, '90 m'))
        rx, ry = v.p(87, -20)
        g.append(dim_tag(rx, ry, '70 m'))
        cx, cy = v.p(30, -20)
        g.append(dim_tag(cx, cy, '6,300 m²', CYAN, '#14181e', CYAN))
    else:
        merged = unary_union([old, new])
        g.append(shp(v, merged, ASPH))
        g.append(shp_outline(v, merged, CYAN, 2))
        cx, cy = v.p(-20, -10)
        g.append(dim_tag(cx, cy, 'Apron 1, 13,900 m²', TXT))
    body.append(f'<g clip-path="url(#c{i})">' + '\n'.join(g) + '</g>')
    body.append(f'<rect x="{ox:.1f}" y="{oy + 28}" width="{PW:.1f}" height="{PH}" rx="6" fill="none" stroke="#3a414c"/>')
    for k, c in enumerate(caps[i]):
        body.append(text(ox, oy + 28 + PH + 24 + k * 19, c, 12.5, TXT, 'start'))

# mode switch mock in the context bar
MY = TOP + 28 + PH + 76
bx, bw, bh = M, W_FIG - 2 * M, 56
body.append(f'<rect x="{bx}" y="{MY}" width="{bw}" height="{bh}" rx="8" fill="#14181e" stroke="#3a414c"/>')
body.append(text(bx + 18, MY + 33, 'Apron tool', 15, TXT, 'start', 'bold'))
for k, (nm, on) in enumerate([('Free polygon', False), ('Rectangle', True)]):
    x = bx + 140 + k * 150
    body.append(f'<rect x="{x}" y="{MY + 11}" width="140" height="34" rx="6" fill="{"#1f4a5a" if on else "#2e3540"}" stroke="{CYAN if on else "#4a5260"}" stroke-width="{2 if on else 1}"/>')
    body.append(text(x + 70, MY + 33, nm, 13, CYAN if on else TXT, 'middle', 'bold' if on else 'normal'))
body.append(text(bx + 460, MY + 33, 'Surface: Concrete', 13, TXT, 'start'))
body.append(text(bx + 640, MY + 33, 'Hotkey A switches mode.  Ctrl drag cuts.', 13, MUTED, 'start'))

# terminal size
TY = MY + bh + 50
body.append(text(M, TY, 'TERMINAL SIZE: NO FIXED LIMIT', 14, TXT, 'start', 'bold'))
TS = 1.25
th = 120 * TS
body.append(f'<rect x="{M}" y="{TY + 14}" width="{W_FIG - 2 * M}" height="{th + 60}" rx="6" fill="{PANEL}" stroke="#3a414c"/>')
vt = View(M + 30, TY + 14 + 30 + th, TS)
small = sbox(0, 0, 17.3, 17.3)
body.append(shp(vt, small, '#ff7b82', op=0.9))
sx, sy = vt.p(8.65, 17.3)
body.append(text(sx, sy - 8, 'Old cap', 12, MUTED, 'middle'))
body.append(text(sx, sy - 24, '300 m²', 12, '#ff7b82', 'middle', 'bold'))
big = sbox(60, 0, 60 + 640, 120)
body.append(shp(vt, big, '#39414e', '#7fe08a', 2))
cx, cy = vt.p(60 + 320, 60)
body.append(text(cx, cy - 6, 'Example terminal 640 x 120 m', 14, TXT, 'middle', 'bold'))
body.append(text(cx, cy + 16, '76,800 m², same scale as the red square', 12.5, MUTED, 'middle'))
notes = ['Footprint is limited only by owned land, budget and clearances to runways and taxiways.',
         'Build in rectangle pieces that merge, like the apron. Extend or shrink an existing terminal any time.',
         'Interior grid is stored in 64 m chunks, so large terminals stay light in the browser.']
for k, n_ in enumerate(notes):
    body.append(text(M, TY + 14 + th + 60 + 26 + k * 19, n_, 12.5, TXT, 'start'))
H_FIG = TY + 14 + th + 60 + 26 + 3 * 19 + 20
open('/home/claude/samples/fig7_apron_terminal.svg', 'w').write(svg_doc(W_FIG, int(H_FIG), '\n'.join(body), defs))
print(W_FIG, H_FIG)
