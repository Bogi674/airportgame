import sys
sys.path.insert(0, '/home/claude/samples')
from netdraw import *
from shapely.geometry import box as sbox

SHOULDER = '#5e5f66'


def junction2(v, node, angles_deg, hw, rc, shoulder_w, surf='asphalt', L=400, signs=False):
    angs = sorted(math.radians(a) % (2 * math.pi) for a in angles_deg)
    parts = [Point(node).buffer(hw, 32)]
    for a in angs:
        d = unit(a)
        parts.append(LineString([node, (node[0] + d[0] * L, node[1] + d[1] * L)]).buffer(hw, cap_style='flat'))
    curves, tdist = [], {a: [] for a in angs}
    for i, a in enumerate(angs):
        b = angs[(i + 1) % len(angs)]
        th = (b - a) % (2 * math.pi)
        if th < math.radians(170):
            _, cpts, td = fillet(node, a, b, 0, rc)
            curves.append(cpts)
            tdist[a].append(td); tdist[b].append(td)
            parts.append(LineString(cpts).buffer(hw, 32))
            parts.append(Polygon([node] + cpts).buffer(0))
    pave = unary_union(parts)
    out = []
    paved = surf in ('asphalt', 'concrete')
    base = {'asphalt': ASPH, 'concrete': CONC, 'gravel': '#9b968c', 'dirt': '#8a6c4c', 'grass': '#86ad5a'}[surf]
    if paved and shoulder_w > 0:
        sh = pave.buffer(shoulder_w, join_style='round')
        out.append(shp(v, sh, SHOULDER if surf == 'asphalt' else '#8e8c87'))
    out.append(shp(v, pave, base))
    centers = [LineString([node, (node[0] + unit(a)[0] * L, node[1] + unit(a)[1] * L)]) for a in angs]
    if paved:
        lw = 1.3
        dark = surf == 'asphalt'
        # shoulder stripes on the fillets
        if shoulder_w > 0:
            ring = pave.exterior
            n_s = int(ring.length / 7)
            for k in range(n_s):
                p = ring.interpolate(k * 7)
                q = ring.interpolate(k * 7 + 0.5)
                if min(c.distance(p) for c in centers) < hw + 0.4:
                    continue
                if Point(node).distance(p) > rc * 2.2:
                    continue
                tx, ty = q.x - p.x, q.y - p.y
                ln = math.hypot(tx, ty)
                nx, ny = ty / ln, -tx / ln
                if pave.contains(Point(p.x + nx * 1.0, p.y + ny * 1.0)):
                    nx, ny = -nx, -ny
                out.append(polyline(v, [(p.x + nx * 1.4, p.y + ny * 1.4), (p.x + nx * (shoulder_w - 0.6), p.y + ny * (shoulder_w - 0.6))], YEL, 1.6, cap='butt'))
        # double edge line at the full strength pavement edge
        for off in (0.25, 0.95):
            ring = pave.buffer(-off, join_style='round')
            if not dark:
                out.append(shp_outline(v, ring, '#1b1b1b', lw + 0.8))
            out.append(shp_outline(v, ring, YEL, lw))
        cl = []
        for a in angs:
            d = unit(a)
            straight = any(abs(((b - a) % (2 * math.pi)) - math.pi) < math.radians(10) for b in angs if b != a)
            start = 0 if straight or not tdist[a] else min(tdist[a])
            cl.append([(node[0] + d[0] * start, node[1] + d[1] * start), (node[0] + d[0] * L, node[1] + d[1] * L)])
        cl += curves
        for c in cl:
            if not dark:
                out.append(polyline(v, c, '#1b1b1b', 2.6))
            out.append(polyline(v, c, YEL, 1.6))
    else:
        # unpaved: no paint, edge markers every 15 m
        ring = pave.exterior
        for k in range(int(ring.length / 15)):
            p = ring.interpolate(k * 15)
            x, y = v.p(p.x, p.y)
            out.append(f'<rect x="{x - 2.5:.1f}" y="{y - 2.5:.1f}" width="5" height="5" fill="{YEL}" stroke="#222" stroke-width="0.8"/>')
    return '\n'.join(out), pave


if __name__ == '__main__':
    M, GAP = 30, 30
    W_FIG = 1170
    PW = (W_FIG - 2 * M - GAP) / 2
    S1 = 2.2
    PH1 = 400
    TOP = 96
    defs = grass_pattern('grass', 2.2)
    body = [text(W_FIG / 2, 38, 'Taxiway junction radius, markings and surfaces', 22, TXT, 'middle', 'bold'),
            text(W_FIG / 2, 62, 'Code C taxiway, 15 m wide with 5 m paved shoulders. Markings per ICAO Annex 14 and FAA AC 150/5340 1.', 13, MUTED)]
    panels = [('CURRENT: centerline radius 40 m', 40, '#ff7b82', ['Inner edge radius 32.5 m, more than 2 x the width', 'Junction area feels oversized']),
              ('PROPOSED: centerline radius 25 m', 25, '#7fe08a', ['Inner edge radius 17.5 m, close to 1 x the width', 'Matches the reference pictures you sent'])]
    for i, (title, rc, col, caps) in enumerate(panels):
        ox = M + i * (PW + GAP)
        oy = TOP
        v = View(ox + PW / 2, oy + 28 + PH1 * 0.38, S1)
        body.append(text(ox, oy + 16, title, 14, col, 'start', 'bold'))
        body.append(f'<clipPath id="c{i}"><rect x="{ox}" y="{oy + 28}" width="{PW}" height="{PH1}" rx="6"/></clipPath>')
        g = [f'<rect x="{ox}" y="{oy + 28}" width="{PW}" height="{PH1}" fill="url(#grass)"/>']
        g.append(junction2(v, (0, 0), [0, 180, 270], HW, rc, 5)[0])
        # dimension: taxiway width
        x0, y0 = v.p(-95, -HW)
        x1, y1 = v.p(-95, HW)
        body_dim = f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" stroke="{WHITE}" stroke-width="1.4"/>'
        body.append(f'<g clip-path="url(#c{i})">' + '\n'.join(g) + '</g>')
        # location sign beside the junction (yellow on black location, black on yellow direction)
        sx, sy = v.p(-62, 24)
        cx = sx
        for lab, bg, fg in [('← A', YEL, '#111'), ('B', '#111', YEL), ('A →', YEL, '#111')]:
            w = len(lab) * 7.6 + 12
            body.append(f'<rect x="{cx:.1f}" y="{sy - 11:.1f}" width="{w:.1f}" height="22" fill="{bg}" stroke="#111" stroke-width="1.5"/>')
            body.append(text(cx + w / 2, sy + 4.5, lab, 12.5, fg, 'middle', 'bold'))
            cx += w
        body.append(f'<rect x="{ox}" y="{oy + 28}" width="{PW}" height="{PH1}" rx="6" fill="none" stroke="#3a414c"/>')
        for k, c in enumerate(caps):
            body.append(text(ox, oy + 28 + PH1 + 24 + k * 19, c, 12.5, TXT, 'start'))

    # radius table
    TY = TOP + 28 + PH1 + 76
    body.append(text(M, TY, 'CENTERLINE TURN RADIUS BY CODE', 14, TXT, 'start', 'bold'))
    rows = [('Code', 'A', 'B', 'C', 'D', 'E', 'F'), ('Width', '7.5 m', '10.5 m', '15 m', '18 m', '23 m', '25 m'),
            ('Turn radius', '13 m', '18 m', '25 m', '30 m', '38 m', '42 m'), ('Shoulders', 'none', 'none', '5 m', '5.5 m', '5.5 m', '7.5 m')]
    cw = (W_FIG - 2 * M) / 7
    for r, row in enumerate(rows):
        for c, cell in enumerate(row):
            x = M + c * cw
            y = TY + 14 + r * 30
            fill = '#323944' if r == 0 else (PANEL if r % 2 else '#2b313a')
            body.append(f'<rect x="{x:.1f}" y="{y}" width="{cw:.1f}" height="30" fill="{fill}" stroke="#3a414c"/>')
            body.append(text(x + cw / 2, y + 20, cell, 13, TXT, 'middle', 'bold' if r == 0 or c == 0 else 'normal'))

    # surfaces row
    SY = TY + 14 + 4 * 30 + 50
    body.append(text(M, SY, 'TAXIWAY SURFACES', 14, TXT, 'start', 'bold'))
    surfs = [('grass', 'GRASS', 'Codes A to C'), ('dirt', 'DIRT', 'Codes A to C'), ('gravel', 'GRAVEL', 'Codes A to C'),
             ('asphalt', 'ASPHALT', 'All codes'), ('concrete', 'CONCRETE', 'All codes')]
    sw_w = (W_FIG - 2 * M - 4 * 20) / 5
    SH = 300
    for k, (sf, name, codes) in enumerate(surfs):
        ox = M + k * (sw_w + 20)
        oy = SY + 14
        v = View(ox + sw_w / 2, oy + SH * 0.55, 1.5)
        body.append(f'<clipPath id="s{k}"><rect x="{ox:.1f}" y="{oy}" width="{sw_w:.1f}" height="{SH}" rx="6"/></clipPath>')
        g = [f'<rect x="{ox:.1f}" y="{oy}" width="{sw_w:.1f}" height="{SH}" fill="url(#grass)"/>']
        g.append(junction2(v, (0, 0), [90, 270, 0], HW, 25, 5 if sf in ('asphalt', 'concrete') else 0, sf)[0])
        body.append(f'<g clip-path="url(#s{k})">' + '\n'.join(g) + '</g>')
        body.append(f'<rect x="{ox:.1f}" y="{oy}" width="{sw_w:.1f}" height="{SH}" rx="6" fill="none" stroke="#3a414c"/>')
        body.append(text(ox, oy + SH + 22, name, 13, TXT, 'start', 'bold'))
        body.append(text(ox, oy + SH + 40, codes, 12.5, MUTED, 'start'))
    body.append(text(M, SY + 14 + SH + 70, 'Unpaved taxiways get no paint, only yellow edge markers every 15 m. Each aircraft type still checks its own surface list.', 12.5, MUTED, 'start'))

    # upgrade context bar mock
    UY = SY + 14 + SH + 100
    body.append(text(M, UY, 'SURFACE UPGRADE AND DOWNGRADE AFTER BUILD', 14, TXT, 'start', 'bold'))
    bx, by, bw, bh = M, UY + 14, W_FIG - 2 * M, 128
    body.append(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="8" fill="#14181e" stroke="#3a414c"/>')
    body.append(text(bx + 18, by + 30, 'Taxiway B2', 16, TXT, 'start', 'bold'))
    body.append(text(bx + 18, by + 52, '420 m, code C, two way', 12.5, MUTED, 'start'))
    segx = bx + 230
    names = ['Grass', 'Dirt', 'Gravel', 'Asphalt', 'Concrete']
    segw = 104
    for k, nm in enumerate(names):
        x = segx + k * segw
        cur = nm == 'Asphalt'
        tgt = nm == 'Concrete'
        fill = '#2e3540' if not (cur or tgt) else ('#3a4350' if cur else '#1f4a5a')
        stroke = CYAN if tgt else '#4a5260'
        body.append(f'<rect x="{x}" y="{by + 16}" width="{segw - 6}" height="34" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="{2 if tgt else 1}"/>')
        body.append(text(x + (segw - 6) / 2, by + 38, nm, 13, CYAN if tgt else TXT, 'middle', 'bold' if (cur or tgt) else 'normal'))
    body.append(text(segx, by + 72, 'Current: Asphalt', 12.5, MUTED, 'start'))
    body.append(text(segx + 160, by + 72, 'Selected: Concrete (upgrade)', 12.5, CYAN, 'start'))
    body.append(text(bx + 18, by + 104, 'Upgrade cost 1.9 M, works 21 days, segment closed during works, markings regenerate. Downgrade refunds part of the value.', 12.5, TXT, 'start'))
    bxx = bx + bw - 150
    body.append(f'<rect x="{bxx}" y="{by + 16}" width="132" height="34" rx="6" fill="{CYAN}"/>')
    body.append(text(bxx + 66, by + 38, 'Apply', 14, '#0d1116', 'middle', 'bold'))

    H_FIG = UY + 14 + bh + 30
    open('/home/claude/samples/fig6_taxiways_v2.svg', 'w').write(svg_doc(W_FIG, int(H_FIG), '\n'.join(body), defs))
    print(W_FIG, H_FIG)
