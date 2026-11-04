import sys
sys.path.insert(0, '/home/claude/samples')
from lib import *
from shapely.geometry import box as sbox

TYPES.update({
    'A359': dict(L=66.8, S=64.8, fw=5.96, yr=24.5, cr=12, ct=2.4, sweep=31.9, hs=18.6, hcr=5.5, hsweep=32, engines=[9.5], eng_len=6.5, eng_w=3.4),
    'B789': dict(L=62.8, S=60.1, fw=5.77, yr=22.5, cr=11, ct=2.2, sweep=32.2, hs=19.8, hcr=5.0, hsweep=33, engines=[9.0], eng_len=6.5, eng_w=3.3),
    'B748': dict(L=76.3, S=68.4, fw=6.5, yr=27.0, cr=14, ct=3, sweep=37.5, hs=22.2, hcr=6.5, hsweep=37, engines=[12.0, 21.0], eng_len=6.0, eng_w=3.0),
    'A124': dict(L=69.1, S=73.3, fw=7.3, yr=24.5, cr=12, ct=3.5, sweep=32, hs=24, hcr=6, hsweep=35, engines=[10.5, 18.5], eng_len=5.5, eng_w=2.8),
})
NG = {'KA350': 2.5, 'C172': 1.6, 'A320': 5.1, 'ATR72': 2.5, 'B77W': 8.0, 'A359': 6.3, 'B789': 5.2, 'A388': 6.5, 'B748': 6.8, 'A124': 7.5}
DOOR = {'A320': [6.5], 'B77W': [7.5, 20.0], 'A388': [9.5, 18.5]}

STANDS = [
    dict(key='SMALL', sub='Code A and B, wingspan up to 24 m', W=30, D=16.5, depth=24, surf='asphalt', nc=2.5, num='G7',
         types=[('KA350', 'GA')], bars_gap=3.0, ga=True,
         caps=['Fits: C172, KA350, PC 12, Learjet 75, Citation', 'Surfaces: grass, dirt, gravel, asphalt, concrete', 'Stand 30 x 24 m, wingtip clearance 3 m', 'Unpaved build: no paint, cones and signboard']),
    dict(key='MEDIUM', sub='Code C, wingspan 24 to 36 m', W=45, D=24.5, depth=50, surf='concrete', nc=4, num='B12',
         types=[('A320', 'A320'), ('ATR72', 'AT72')], bars_gap=3.5,
         caps=['Fits: A320 family, B737, E195, ATR 72, Dash 8', 'Surfaces: grass, dirt, gravel, asphalt, concrete', 'Stand 45 x 50 m, wingtip clearance 4.5 m', 'Unpaved only for types rated for it (ATR, Dash 8)']),
    dict(key='LARGE', sub='Code D and E, wingspan 36 to 65 m', W=80, D=42.5, depth=84, surf='concrete', nc=4, num='C23',
         types=[('B77W', 'B77W'), ('A359', 'A359'), ('B789', 'B789')], bars_gap=5.0, pits=True,
         caps=['Fits: B777, B787, A350, A330, B767', 'Surfaces: asphalt, concrete', 'Stand 80 x 84 m, wingtip clearance 7.5 m', 'Two jet bridges, hydrant fuel pits']),
    dict(key='EXTRA LARGE', sub='Code F, wingspan 65 to 80 m', W=95, D=50.5, depth=90, surf='concrete', nc=4, num='D31',
         types=[('A388', 'A388'), ('B748', 'B748'), ('A124', 'A124')], bars_gap=5.0, pits=True,
         caps=['Fits: A380, B747, An 124, B777X with wingtips out', 'Surfaces: asphalt, concrete', 'Stand 95 x 90 m, wingtip clearance 7.5 m', 'Upper deck bridge, hydrant fuel pits']),
]

M, GAP = 30, 40
PW, PH = 460, 520
W_FIG = M * 2 + PW * 2 + GAP
TOP = 96
ROW = 40 + PH + 100
STRIP_Y = TOP + ROW * 2 + 10
STRIP_H = 320
LEG_Y = STRIP_Y + STRIP_H + 20
H_FIG = LEG_Y + 40 + 4 * 30 + 30

body = [text(W_FIG / 2, 38, 'Aircraft stand sizes with full markings', 22, TXT, 'middle', 'bold'),
        text(W_FIG / 2, 62, 'Nose in stands on a taxilane, ICAO Annex 14 clearances. Each panel has its own scale, see the strip below for true size.', 13, MUTED)]
defs = grass_pattern('grass', 3) + hatch_pattern('hatchR', RED, 6) + hatch_pattern('hatchW', WHITE, 5)


def yline(v, pts, w, concrete):
    out = ''
    if concrete:
        out += polyline(v, pts, '#1b1b1b', w + 2.2)
    return out + polyline(v, pts, YEL, w)


def build_stand(st):
    W, D, depth, nc = st['W'], st['D'], st['depth'], st['nc']
    top = D + depth
    planes, bars = [], []
    for k, (t, lab) in enumerate(st['types']):
        bar_y = top - nc - NG[st['types'][0][0]] - k * st['bars_gap']
        nose_y = bar_y + NG[t]
        planes.append((t, place(aircraft(**TYPES[t]), 0, nose_y), nose_y))
        bars.append((bar_y, lab))
    return top, planes, bars


for i, st in enumerate(STANDS):
    ox = M + (i % 2) * (PW + GAP)
    oy = TOP + (i // 2) * ROW
    W, D, depth = st['W'], st['D'], st['depth']
    top, planes, bars = build_stand(st)
    ga = st.get('ga', False)
    conc = st['surf'] == 'concrete'
    hx = max(W / 2, D) + 9
    ybot, ytop = -12, top + (6 if ga else 22)
    s = min(PW / (2 * hx), PH / (ytop - ybot))
    v = View(ox + PW / 2, oy + 40 + PH / 2 + (ytop + ybot) / 2 * s, s)
    body.append(text(ox, oy + 18, st['key'], 16, TXT, 'start', 'bold'))
    body.append(text(ox, oy + 35, st['sub'], 12.5, MUTED, 'start'))
    # scale bar, right aligned in the title row
    sb = 10 if s > 5 else 20
    bx1 = ox + PW
    bx0 = bx1 - sb * s
    body.append(f'<line x1="{bx0:.1f}" y1="{oy + 30}" x2="{bx1:.1f}" y2="{oy + 30}" stroke="{TXT}" stroke-width="2"/>'
                f'<line x1="{bx0:.1f}" y1="{oy + 24}" x2="{bx0:.1f}" y2="{oy + 36}" stroke="{TXT}" stroke-width="2"/>'
                f'<line x1="{bx1:.1f}" y1="{oy + 24}" x2="{bx1:.1f}" y2="{oy + 36}" stroke="{TXT}" stroke-width="2"/>')
    body.append(text(bx0 - 8, oy + 35, f'{sb} m', 12.5, TXT, 'end'))

    g = [f'<rect x="{ox}" y="{oy + 40}" width="{PW}" height="{PH}" fill="url(#grass)"/>']
    apron_top = top + (2 if ga else 8)
    apron = sbox(-hx - 5, ybot - 5, hx + 5, apron_top)
    g.append(shp(v, apron, CONC if conc else ASPH))
    if conc:
        for xx in range(-int(hx) - 5, int(hx) + 6, 5):
            g.append(polyline(v, [(xx, ybot - 5), (xx, apron_top)], '#000', 0.6, op=0.12, cap='butt'))
        for yy in range(int(ybot) - 5, int(apron_top) + 1, 5):
            g.append(polyline(v, [(-hx - 5, yy), (hx + 5, yy)], '#000', 0.6, op=0.12, cap='butt'))
    if not ga:
        # head of stand road and terminal
        g.append(polyline(v, [(-hx - 5, top + 0.4), (hx + 5, top + 0.4)], WHITE, 1.6, cap='butt'))
        g.append(polyline(v, [(-hx - 5, top + 7.6), (hx + 5, top + 7.6)], WHITE, 1.6, cap='butt'))
        g.append(polyline(v, [(-hx - 5, top + 4), (hx + 5, top + 4)], WHITE, 1.3, f'{3 * s:.1f} {3 * s:.1f}', cap='butt'))
        g.append(shp(v, sbox(-hx - 5, top + 8, hx + 5, ytop + 5), '#39414e'))
        tx, ty = v.p(0, top + 8 + (ytop - top - 8) / 2)
        g.append(text(tx, ty + 4.5, 'TERMINAL', 12.5, '#c3cad4', 'middle', 'bold'))

    # equipment restraint area: union of all assigned types plus 3 m, simplified
    era = unary_union([p.buffer(3, 8) for _, p, _ in planes]).convex_hull.simplify(1.0)
    stand_rect = sbox(-W / 2, D, W / 2, top)

    # taxilane centerline, lead in fork, stand centerline
    g.append(yline(v, [(-hx - 5, 0), (hx + 5, 0)], 1.8, conc))
    g.append(yline(v, arc_pts(-D, D, D, 0, -math.pi / 2), 1.8, conc))
    g.append(yline(v, arc_pts(D, D, D, math.pi, 1.5 * math.pi), 1.8, conc))
    g.append(yline(v, [(0, D), (0, bars[0][0])], 1.8, conc))

    # wingtip clearance lines
    for sx in (-1, 1):
        g.append(polyline(v, [(sx * W / 2, D), (sx * W / 2, top)], RED, 1.8, f'{2 * s:.1f} {1.5 * s:.1f}', cap='butt'))

    bridges = []
    if not ga:
        t0, p0, nose0 = planes[0]
        fw = TYPES[t0]['fw']
        for k, dl in enumerate(DOOR.get(t0, [])):
            door = (-fw / 2 - 0.5, nose0 - dl)
            rot = (-fw / 2 - 7 - k * 22, top + 8)
            cab = Polygon([(door[0] - 3.5, door[1] - 2), (door[0], door[1] - 2), (door[0], door[1] + 2), (door[0] - 3.5, door[1] + 2)])
            tun = LineString([rot, (door[0] - 3.5, door[1])]).buffer(1.8, cap_style='flat')
            bridges.append((rot, unary_union([tun, cab]), Point(rot).buffer(2.6, 16)))
        zone = unary_union([b.buffer(2.5) for _, b, _ in bridges]).intersection(stand_rect).difference(era.buffer(0.6))
        if not zone.is_empty:
            g.append(shp(v, zone, 'url(#hatchR)', RED, 1.3))
        # GSE staging box on the right, shrunk until it clears the ERA
        gw, gh = W * 0.22, depth * 0.16
        while gw > 3:
            gbox = sbox(W / 2 - 1.5 - gw, top - 1.5 - gh, W / 2 - 1.5, top - 1.5)
            if not gbox.intersects(era.buffer(1.0)):
                break
            gw -= 0.5
        g.append(shp(v, gbox, 'url(#hatchW)', WHITE, 1.4))

    # ERA double line (not used on GA stands)
    if not ga:
        g.append(shp_outline(v, era, RED, 2.2))
        g.append(shp_outline(v, era.buffer(-0.9, join_style='mitre'), RED, 1.1, f'{1.5 * s:.1f} {1.2 * s:.1f}'))

    # stop bars with type boxes
    t0 = planes[0][0]
    fw0 = TYPES[t0]['fw']
    for by, lab in bars:
        if ga:
            g.append(yline(v, [(-1.6, by), (1.6, by)], 3, False))
        else:
            g.append(yline(v, [(-1.5, by), (fw0 / 2 + 1, by)], 3.2, conc))
        bx, byy = v.p(fw0 / 2 + 1.5, by)
        lb, lw, _ = label_box(0, 0, lab, 10, '#111', WHITE, 4, 2.5)
        bxx, _, _ = label_box(bx + lw / 2, byy, lab, 10, '#111', WHITE, 4, 2.5)
        g.append(bxx)

    # hydrant fuel pits under the wings
    if st.get('pits'):
        tp = TYPES[t0]
        nose0 = planes[0][2]
        for sx in (-1, 1):
            px = sx * (tp['fw'] / 2 + 7)
            py = nose0 - (tp['yr'] + 7 * math.tan(math.radians(tp['sweep'])) + tp['cr'] * 0.55)
            g.append(shp(v, sbox(px - 0.9, py - 0.9, px + 0.9, py + 0.9), RED, '#111', 1))

    # GA tie down rings
    if ga:
        tp = TYPES[t0]
        nose0 = planes[0][2]
        for pt in [(-tp['S'] * 0.36, nose0 - tp['yr'] - tp['cr'] * 0.5), (tp['S'] * 0.36, nose0 - tp['yr'] - tp['cr'] * 0.5), (0, nose0 - tp['L'] - 1.2)]:
            cx, cy = v.p(*pt)
            g.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="4.2" fill="none" stroke="{WHITE}" stroke-width="2"/>')

    # aircraft (largest assigned type) on top, semi transparent
    g.append(shp(v, planes[0][1], WHITE, '#dfe3e8', 0.8, 0.62))

    for rot, b, rc in bridges:
        g.append(shp(v, b, '#cfd4da', '#2a2f37', 1.2))
        g.append(shp(v, rc, '#9aa3ae', '#2a2f37', 1.2))

    # stand number on the lead in, between the fork branches
    nx, ny = v.p(0, D * 0.33)
    lbx, _, _ = label_box(nx, ny, st['num'], 11, YEL, '#111', 4, 3, '#111')
    g.append(lbx)

    body.append(f'<clipPath id="c{i}"><rect x="{ox}" y="{oy + 40}" width="{PW}" height="{PH}" rx="6"/></clipPath>')
    body.append(f'<g clip-path="url(#c{i})">' + '\n'.join(g) + '</g>')
    body.append(f'<rect x="{ox}" y="{oy + 40}" width="{PW}" height="{PH}" rx="6" fill="none" stroke="#3a414c"/>')
    for k, c in enumerate(st['caps']):
        body.append(text(ox, oy + 40 + PH + 24 + k * 19, c, 12.5, TXT if k < 3 else MUTED, 'start'))

# ---------------- same scale strip ----------------
body.append(text(M, STRIP_Y + 16, 'SAME SCALE COMPARISON', 15, TXT, 'start', 'bold'))
body.append(f'<rect x="{M}" y="{STRIP_Y + 30}" width="{W_FIG - 2 * M}" height="{STRIP_H - 30}" rx="6" fill="{CONC}"/>')
ss = 2.3
gap_px = 70
total_px = sum(st['W'] for st in STANDS) * ss + 3 * gap_px
xpx = W_FIG / 2 - total_px / 2
base_y = STRIP_Y + STRIP_H - 52
from shapely import affinity
for st in STANDS:
    vv = View(xpx + st['W'] * ss / 2, base_y, ss)
    top, planes, bars = build_stand(st)
    body.append(shp(vv, sbox(-st['W'] / 2, 0, st['W'] / 2, st['depth']), 'none', RED, 1.4))
    body.append(shp(vv, affinity.translate(planes[0][1], 0, -st['D']), WHITE, '#555', 0.6, 0.9))
    lx, ly = vv.p(0, 0)
    body.append(text(lx, ly + 20, st['key'], 12, '#1d2128', 'middle', 'bold'))
    body.append(text(lx, ly + 36, f"{st['W']} x {st['depth']} m", 11.5, '#1d2128', 'middle'))
    xpx += st['W'] * ss + gap_px

# ---------------- legend ----------------
body.append(text(M, LEG_Y + 16, 'LEGEND', 15, TXT, 'start', 'bold'))
items = [
    ('yline', 'Lead in, fork and stand centerline'), ('num', 'Stand number'), ('bar', 'Stop bar per aircraft type group'),
    ('era', 'Equipment restraint area'), ('wing', 'Wingtip clearance line'), ('hatchR', 'No parking, jet bridge zone'),
    ('gse', 'GSE staging area'), ('road', 'Head of stand service road'), ('pit', 'Hydrant fuel pit'),
    ('ring', 'Tie down ring (GA)'), ('bridge', 'Jet bridge, docked'), ('ac', 'Largest assigned aircraft'),
]
colw = (W_FIG - 2 * M) / 3
for k, (ic, lab) in enumerate(items):
    cx0 = M + (k % 3) * colw
    cy0 = LEG_Y + 44 + (k // 3) * 30
    sw = cx0 + 4
    if ic == 'yline':
        body.append(f'<line x1="{sw}" y1="{cy0}" x2="{sw + 34}" y2="{cy0}" stroke="{YEL}" stroke-width="2.5"/>')
    elif ic == 'num':
        body.append(label_box(sw + 17, cy0, 'B12', 10, YEL, '#111', 3, 2.5, '#111')[0])
    elif ic == 'bar':
        body.append(f'<line x1="{sw}" y1="{cy0}" x2="{sw + 12}" y2="{cy0}" stroke="{YEL}" stroke-width="4"/>' + label_box(sw + 27, cy0, 'A320', 9, '#111', WHITE, 2, 2)[0])
    elif ic == 'era':
        body.append(f'<rect x="{sw}" y="{cy0 - 8}" width="34" height="16" fill="none" stroke="{RED}" stroke-width="2"/><rect x="{sw + 3}" y="{cy0 - 5}" width="28" height="10" fill="none" stroke="{RED}" stroke-width="1" stroke-dasharray="3 2"/>')
    elif ic == 'wing':
        body.append(f'<line x1="{sw}" y1="{cy0}" x2="{sw + 34}" y2="{cy0}" stroke="{RED}" stroke-width="2" stroke-dasharray="6 4"/>')
    elif ic == 'hatchR':
        body.append(f'<rect x="{sw}" y="{cy0 - 8}" width="34" height="16" fill="url(#hatchR)" stroke="{RED}" stroke-width="1.3"/>')
    elif ic == 'gse':
        body.append(f'<rect x="{sw}" y="{cy0 - 8}" width="34" height="16" fill="url(#hatchW)" stroke="{WHITE}" stroke-width="1.3"/>')
    elif ic == 'road':
        body.append(f'<line x1="{sw}" y1="{cy0 - 6}" x2="{sw + 34}" y2="{cy0 - 6}" stroke="{WHITE}" stroke-width="1.6"/><line x1="{sw}" y1="{cy0}" x2="{sw + 34}" y2="{cy0}" stroke="{WHITE}" stroke-width="1.3" stroke-dasharray="4 4"/><line x1="{sw}" y1="{cy0 + 6}" x2="{sw + 34}" y2="{cy0 + 6}" stroke="{WHITE}" stroke-width="1.6"/>')
    elif ic == 'pit':
        body.append(f'<rect x="{sw + 11}" y="{cy0 - 6}" width="12" height="12" fill="{RED}" stroke="#111"/>')
    elif ic == 'ring':
        body.append(f'<circle cx="{sw + 17}" cy="{cy0}" r="5" fill="none" stroke="{WHITE}" stroke-width="2"/>')
    elif ic == 'bridge':
        body.append(f'<rect x="{sw}" y="{cy0 - 4}" width="34" height="8" fill="#cfd4da" stroke="#2a2f37"/>')
    else:
        body.append(f'<rect x="{sw}" y="{cy0 - 6}" width="34" height="12" rx="6" fill="{WHITE}" opacity="0.62"/>')
    body.append(text(cx0 + 58, cy0 + 4.5, lab, 13, TXT, 'start'))

open('/home/claude/samples/fig4_stands.svg', 'w').write(svg_doc(W_FIG, H_FIG, '\n'.join(body), defs))
print(W_FIG, H_FIG)
