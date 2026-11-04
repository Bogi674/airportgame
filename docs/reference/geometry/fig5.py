import sys
sys.path.insert(0, '/home/claude/samples')
from lib import *
from shapely.geometry import box as sbox
from shapely import affinity
import fig4_stand_data as F

DOOR = {'A320': [6.5], 'B77W': [7.5, 20.0], 'A388': [9.5, 18.5]}
STANDS = [
    dict(key='MEDIUM', sub='Code C, wingspan up to 36 m', W=45, D=24.5, depth=52, surf='asphalt', num='B12',
         types=[('A320', 'A320'), ('ATR72', 'AT72')], gap=3.5,
         caps=['A320 family, B737, E195, ATR 72, Dash 8', 'Stand 45 x 52 m, wingtip clearance 4.5 m', 'One jet bridge, refuel by truck']),
    dict(key='LARGE', sub='Code D and E, wingspan up to 65 m', W=80, D=42.5, depth=88, surf='concrete', num='C23',
         types=[('B77W', 'B77W'), ('A359', 'A359'), ('B789', 'B789')], gap=5.0, pits=True,
         caps=['B777, B787, A350, A330, B767', 'Stand 80 x 88 m, wingtip clearance 7.5 m', 'Two jet bridges, hydrant fuel pits']),
    dict(key='EXTRA LARGE', sub='Code F, wingspan up to 80 m', W=95, D=50.5, depth=94, surf='concrete', num='D31',
         types=[('A388', 'A388'), ('B748', 'B748'), ('A124', 'A124')], gap=5.0, pits=True,
         caps=['A380, B747, An 124, B777X wingtips out', 'Stand 95 x 94 m, wingtip clearance 7.5 m', 'Main and upper deck bridge, hydrant pits']),
]
NC = 6.0
M, GAP = 30, 30
PW, PH = 350, 600
W_FIG = M * 2 + PW * 3 + GAP * 2
TOP = 96
LEG_Y = TOP + 44 + PH + 86
H_FIG = LEG_Y + 40 + 4 * 30 + 26

body = [text(W_FIG / 2, 38, 'Contact stand markings, revised', 22, TXT, 'middle', 'bold'),
        text(W_FIG / 2, 62, 'Rectilinear stand boundary with funnel at the nose, jet bridge zone and staging area in the front corners. ICAO Annex 14 clearances.', 13, MUTED)]
defs = hatch_pattern('hatchR', RED, 6) + hatch_pattern('hatchW', WHITE, 6) + grass_pattern('grass', 3)


def yline(v, pts, w, dark):
    return ('' if dark else polyline(v, pts, '#1b1b1b', w + 2.2)) + polyline(v, pts, YEL, w)


for i, st in enumerate(STANDS):
    ox = M + i * (PW + GAP)
    oy = TOP
    W, D, depth = st['W'], st['D'], st['depth']
    top = D + depth
    dark = st['surf'] == 'asphalt'
    # aircraft and stop bars
    planes, bars = [], []
    t0 = st['types'][0][0]
    for k, (t, lab) in enumerate(st['types']):
        bar_y = top - NC - F.NG[t0] - k * st['gap']
        nose = bar_y + F.NG[t]
        planes.append((t, place(aircraft(**F.TYPES[t]), 0, nose), nose))
        bars.append((bar_y, lab))
    keep_out = unary_union([p.buffer(3, 8) for _, p, _ in planes])
    fw = F.TYPES[t0]['fw']
    n = fw / 2 + 4.5
    yn = top - 5
    # find the lowest funnel start that keeps the front corners clear of every assigned type plus 3 m
    ys = D + 2
    while ys < yn - 2:
        corner = Polygon([(W / 2, ys), (n, yn), (n, top), (W / 2, top)])
        if not corner.intersects(keep_out):
            break
        ys += 0.5
    left = Polygon([(-W / 2, ys), (-n, yn), (-n, top), (-W / 2, top)])
    right = Polygon([(W / 2, ys), (n, yn), (n, top), (W / 2, top)])

    hx = W / 2 + 8
    ybot, ytop = -10, top + 22
    s = min(PW / (2 * hx), PH / (ytop - ybot))
    v = View(ox + PW / 2, oy + 44 + PH / 2 + (ytop + ybot) / 2 * s, s)
    body.append(text(ox, oy + 18, st['key'], 16, TXT, 'start', 'bold'))
    body.append(text(ox, oy + 36, st['sub'], 12.5, MUTED, 'start'))
    sb = 20
    bx1, bx0 = ox + PW, ox + PW - sb * s
    body.append(f'<line x1="{bx0:.1f}" y1="{oy + 31}" x2="{bx1:.1f}" y2="{oy + 31}" stroke="{TXT}" stroke-width="2"/>'
                f'<line x1="{bx0:.1f}" y1="{oy + 25}" x2="{bx0:.1f}" y2="{oy + 37}" stroke="{TXT}" stroke-width="2"/>'
                f'<line x1="{bx1:.1f}" y1="{oy + 25}" x2="{bx1:.1f}" y2="{oy + 37}" stroke="{TXT}" stroke-width="2"/>')
    body.append(text(bx0 - 8, oy + 36, f'{sb} m', 12.5, TXT, 'end'))

    g = [f'<rect x="{ox}" y="{oy + 44}" width="{PW}" height="{PH}" fill="{ASPH if dark else CONC}"/>']
    if not dark:
        for xx in range(-int(hx) - 10, int(hx) + 11, 5):
            g.append(polyline(v, [(xx, ybot - 10), (xx, top)], '#000', 0.6, op=0.12, cap='butt'))
        for yy in range(int(ybot) - 10, int(top) + 1, 5):
            g.append(polyline(v, [(-hx - 10, yy), (hx + 10, yy)], '#000', 0.6, op=0.12, cap='butt'))
    # service road with two lanes and arrows
    road_c = WHITE
    g.append(shp(v, sbox(-hx - 10, top, hx + 10, top + 12), '#3f4046'))
    g.append(polyline(v, [(-hx - 10, top + 0.4), (hx + 10, top + 0.4)], road_c, 1.6, cap='butt'))
    g.append(polyline(v, [(-hx - 10, top + 11.6), (hx + 10, top + 11.6)], road_c, 1.6, cap='butt'))
    g.append(polyline(v, [(-hx - 10, top + 6), (hx + 10, top + 6)], road_c, 1.3, f'{3 * s:.1f} {3 * s:.1f}', cap='butt'))
    for ax, ay, dirn in [(W * 0.3, top + 3.2, 1), (W * 0.3, top + 8.8, -1)]:
        x0, y0 = v.p(ax, ay)
        L = 26
        g.append(f'<line x1="{x0 - dirn * L / 2:.1f}" y1="{y0:.1f}" x2="{x0 + dirn * L / 2:.1f}" y2="{y0:.1f}" stroke="{road_c}" stroke-width="1.6"/>'
                 f'<polygon points="{x0 + dirn * L / 2:.1f},{y0 - 4:.1f} {x0 + dirn * (L / 2 + 7):.1f},{y0:.1f} {x0 + dirn * L / 2:.1f},{y0 + 4:.1f}" fill="{road_c}"/>')
    g.append(shp(v, sbox(-hx - 10, top + 12, hx + 10, ytop + 10), '#39414e'))
    tx, ty = v.p(0, top + 12 + (ytop - top - 12) / 2)
    g.append(text(tx, ty + 4.5, 'TERMINAL', 12.5, '#c3cad4', 'middle', 'bold'))

    # front corners: jet bridge zone (left) and equipment staging area (right)
    lz = left.buffer(-1.0, join_style='mitre')
    rz = right.buffer(-1.0, join_style='mitre')
    g.append(shp(v, lz, 'url(#hatchR)', RED, 1.6))
    g.append(shp(v, rz, 'url(#hatchW)', WHITE, 1.6))

    # stand safety line, stand boundary with funnel
    g.append(polyline(v, [(-hx - 10, D), (hx + 10, D)], RED, 2.4, cap='butt'))
    for sx in (-1, 1):
        g.append(polyline(v, [(sx * W / 2, D), (sx * W / 2, ys), (sx * n, yn), (sx * n, top)], RED, 2.4, cap='butt'))
    # neighbour stand boundaries continue at the panel edges
    for sx in (-1, 1):
        g.append(polyline(v, [(sx * W / 2, ys), (sx * (W / 2 + 12), ys + (yn - ys) * 12 / (W / 2 - n))], RED, 2.4, cap='butt'))

    # lead in fork and centerline
    g.append(yline(v, [(-hx - 10, 0), (hx + 10, 0)], 1.8, dark))
    g.append(yline(v, arc_pts(-D, D, D, 0, -math.pi / 2), 1.8, dark))
    g.append(yline(v, arc_pts(D, D, D, math.pi, 1.5 * math.pi), 1.8, dark))
    g.append(yline(v, [(0, D), (0, bars[0][0])], 1.8, dark))
    for by, lab in bars:
        g.append(yline(v, [(-1.5, by), (fw / 2 + 1, by)], 3.2, dark))
        bx, byy = v.p(fw / 2 + 1.6, by)
        _, lw, _ = label_box(0, 0, lab, 10, '#111', WHITE, 4, 2.5)
        g.append(label_box(bx + lw / 2, byy, lab, 10, '#111', WHITE, 4, 2.5)[0])

    # hydrant pits under the wings
    if st.get('pits'):
        tp = F.TYPES[t0]
        nose0 = planes[0][2]
        for sx in (-1, 1):
            px = sx * (tp['fw'] / 2 + 7)
            py = nose0 - (tp['yr'] + 7 * math.tan(math.radians(tp['sweep'])) + tp['cr'] * 0.55)
            sq = sbox(px - 1.1, py - 1.1, px + 1.1, py + 1.1)
            g.append(shp(v, sq, 'none', RED, 1.6))
            g.append(polyline(v, [(px - 1.1, py - 1.1), (px + 1.1, py + 1.1)], RED, 1.2, cap='butt'))

    g.append(shp(v, planes[0][1], WHITE, '#dfe3e8', 0.8, 0.62))

    # jet bridges: fixed link from terminal to rotunda in the hatched corner, tunnel to the door
    nose0 = planes[0][2]
    rx0 = -n - 6
    for k, dl in enumerate(DOOR.get(t0, [])):
        door = (-fw / 2 - 0.5, nose0 - dl)
        rot = (rx0 - k * 9, top - 4 - k * 3)
        link = LineString([(rot[0], top + 12), rot]).buffer(1.6, cap_style='flat')
        cab = sbox(door[0] - 3.5, door[1] - 2, door[0], door[1] + 2)
        tun = LineString([rot, (door[0] - 3.5, door[1])]).buffer(1.8, cap_style='flat')
        g.append(shp(v, unary_union([link, tun, cab]), '#cfd4da', '#2a2f37', 1.2))
        g.append(shp(v, Point(rot).buffer(2.6, 16), '#9aa3ae', '#2a2f37', 1.2))

    nx, ny = v.p(0, D * 0.35)
    g.append(label_box(nx, ny, st['num'], 11, YEL, '#111', 4, 3, '#111')[0])

    body.append(f'<clipPath id="c{i}"><rect x="{ox}" y="{oy + 44}" width="{PW}" height="{PH}" rx="6"/></clipPath>')
    body.append(f'<g clip-path="url(#c{i})">' + '\n'.join(g) + '</g>')
    body.append(f'<rect x="{ox}" y="{oy + 44}" width="{PW}" height="{PH}" rx="6" fill="none" stroke="#3a414c"/>')
    for k, c in enumerate(st['caps']):
        body.append(text(ox, oy + 44 + PH + 24 + k * 19, c, 12.5, TXT, 'start'))

body.append(text(M, LEG_Y + 16, 'LEGEND', 15, TXT, 'start', 'bold'))
items = [
    ('yline', 'Lead in line, fork and stand centerline'), ('num', 'Stand number'), ('bar', 'Stop line per aircraft type group'),
    ('safety', 'Stand safety line (taxilane side)'), ('bound', 'Stand boundary, wingtip clearance'), ('hatchR', 'Jet bridge zone, no parking'),
    ('gse', 'Equipment staging area'), ('road', 'Service road, two way'), ('pit', 'Hydrant fuel pit'),
    ('bridge', 'Jet bridge, docked'), ('ac', 'Largest assigned aircraft'), ('none', ''),
]
colw = (W_FIG - 2 * M) / 3
for k, (ic, lab) in enumerate(items):
    if ic == 'none':
        continue
    cx0 = M + (k % 3) * colw
    cy0 = LEG_Y + 44 + (k // 3) * 30
    sw = cx0 + 4
    if ic == 'yline':
        body.append(f'<line x1="{sw}" y1="{cy0}" x2="{sw + 34}" y2="{cy0}" stroke="{YEL}" stroke-width="2.5"/>')
    elif ic == 'num':
        body.append(label_box(sw + 17, cy0, 'B12', 10, YEL, '#111', 3, 2.5, '#111')[0])
    elif ic == 'bar':
        body.append(f'<line x1="{sw}" y1="{cy0}" x2="{sw + 12}" y2="{cy0}" stroke="{YEL}" stroke-width="4"/>' + label_box(sw + 27, cy0, 'A320', 9, '#111', WHITE, 2, 2)[0])
    elif ic == 'safety':
        body.append(f'<line x1="{sw}" y1="{cy0}" x2="{sw + 34}" y2="{cy0}" stroke="{RED}" stroke-width="3"/>')
    elif ic == 'bound':
        body.append(f'<polyline points="{sw},{cy0 + 8} {sw + 14},{cy0 + 8} {sw + 26},{cy0 - 6} {sw + 34},{cy0 - 6}" fill="none" stroke="{RED}" stroke-width="2.4"/>')
    elif ic == 'hatchR':
        body.append(f'<rect x="{sw}" y="{cy0 - 8}" width="34" height="16" fill="url(#hatchR)" stroke="{RED}" stroke-width="1.4"/>')
    elif ic == 'gse':
        body.append(f'<rect x="{sw}" y="{cy0 - 8}" width="34" height="16" fill="url(#hatchW)" stroke="{WHITE}" stroke-width="1.4"/>')
    elif ic == 'road':
        body.append(f'<line x1="{sw}" y1="{cy0 - 6}" x2="{sw + 34}" y2="{cy0 - 6}" stroke="{WHITE}" stroke-width="1.6"/><line x1="{sw}" y1="{cy0}" x2="{sw + 34}" y2="{cy0}" stroke="{WHITE}" stroke-width="1.3" stroke-dasharray="4 4"/><line x1="{sw}" y1="{cy0 + 6}" x2="{sw + 34}" y2="{cy0 + 6}" stroke="{WHITE}" stroke-width="1.6"/>')
    elif ic == 'pit':
        body.append(f'<rect x="{sw + 11}" y="{cy0 - 6}" width="12" height="12" fill="none" stroke="{RED}" stroke-width="1.6"/><line x1="{sw + 11}" y1="{cy0 + 6}" x2="{sw + 23}" y2="{cy0 - 6}" stroke="{RED}" stroke-width="1.2"/>')
    elif ic == 'bridge':
        body.append(f'<rect x="{sw}" y="{cy0 - 4}" width="34" height="8" fill="#cfd4da" stroke="#2a2f37"/>')
    else:
        body.append(f'<rect x="{sw}" y="{cy0 - 6}" width="34" height="12" rx="6" fill="{WHITE}" opacity="0.62"/>')
    body.append(text(cx0 + 58, cy0 + 4.5, lab, 13, TXT, 'start'))

open('/home/claude/samples/fig5_stands_v2.svg', 'w').write(svg_doc(W_FIG, H_FIG, '\n'.join(body), defs))
print(W_FIG, H_FIG)
