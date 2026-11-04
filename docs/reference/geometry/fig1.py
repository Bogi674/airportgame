import math, sys
sys.path.insert(0, '/home/claude/samples')
from lib import *

S = 3.2
PW, PH = 160 * S, 104 * S
X0 = [30, 30 + PW + 40]
Y0 = 96
W = int(X0[1] + PW + 30)
H = int(Y0 + PH + 120)
R = 22.5          # lead in radius = fork distance from taxilane centerline
EDGE = 24.5       # stand edge
DEPTH = 50
STANDS = [-45, 0, 45]
NOSE_Y = EDGE + DEPTH - 4
A320 = aircraft(**TYPES['A320'])

body = [text(W / 2, 38, 'Stand lead in and push back marking', 22, TXT, 'middle', 'bold'),
        text(W / 2, 62, 'Medium stands, code C taxilane. Same stands, only the yellow lines change.', 13, MUTED)]


def circle3(p1, p2, p3):
    ax, ay = p1; bx, by = p2; cx, cy = p3
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
    return ux, uy, math.hypot(ax - ux, ay - uy)


for pi, mode in enumerate(['current', 'proposed']):
    ox = X0[pi]
    v = View(ox + PW / 2, Y0 + 30 + 80 * S, S)
    title = 'CURRENT (wrong)' if mode == 'current' else 'PROPOSED'
    col = '#ff7b82' if mode == 'current' else '#7fe08a'
    body.append(text(ox, Y0 + 18, title, 15, col, 'start', 'bold'))
    body.append(f'<clipPath id="c{pi}"><rect x="{ox}" y="{Y0 + 30}" width="{PW}" height="{PH}" rx="6"/></clipPath>')
    g = [f'<rect x="{ox}" y="{Y0 + 30}" width="{PW}" height="{PH}" fill="{ASPH}"/>']
    # taxilane centerline
    g.append(polyline(v, [(-90, 0), (90, 0)], YEL, 2))
    for i, xs in enumerate(STANDS):
        # stand box as drawn in game today
        g.append(poly(v, [(xs - 22.5, EDGE), (xs + 22.5, EDGE), (xs + 22.5, EDGE + DEPTH), (xs - 22.5, EDGE + DEPTH)], 'none', RED, 1.6, 0.9))
        stop_y = NOSE_Y - 5
        g.append(polyline(v, [(xs - 3, stop_y), (xs + 3, stop_y)], YEL, 3, cap='butt'))
        if mode == 'current':
            g.append(polyline(v, [(xs, stop_y), (xs, -12)], YEL, 2))
            ux, uy, r = circle3((xs, -12), (xs + 22.5, 6), (xs + 45, -12))
            if i < 2:
                a0 = math.atan2(-12 - uy, xs - ux); a1 = math.atan2(-12 - uy, xs + 45 - ux)
                am = math.atan2(6 - uy, xs + 22.5 - ux)
                if a1 < a0:
                    a1 += 2 * math.pi
                if not (a0 <= am <= a1 or a0 <= am + 2 * math.pi <= a1):
                    a0, a1 = a1, a0 + 2 * math.pi
                g.append(polyline(v, arc_pts(ux, uy, r, a0, a1), YEL, 2))
        else:
            g.append(polyline(v, [(xs, stop_y), (xs, R)], YEL, 2))
            g.append(polyline(v, arc_pts(xs - R, R, R, 0, -math.pi / 2), YEL, 2))
            g.append(polyline(v, arc_pts(xs + R, R, R, math.pi, 1.5 * math.pi), YEL, 2))
        # stand number box on the lead in, behind the tail
        bx, by = v.p(xs, EDGE + 4.5)
        lb, _, _ = label_box(bx, by, str(i + 1), 11, YEL, '#111')
        g.append(lb)
        g.append(shp(v, place(A320, xs, NOSE_Y), WHITE, '#c9ced6', 0.8, 0.8))
    if mode == 'proposed':
        # push back path highlight on stand 2, tail goes left
        path = arc_pts(-R, R, R, 0, -math.pi / 2) + [(-R - 28, 0)]
        g.append(polyline(v, path, WHITE, 5, '2 7', 0.85))
        ex, ey = v.p(-R - 28, 0)
        g.append(f'<polygon points="{ex - 12:.1f},{ey:.1f} {ex:.1f},{ey - 7:.1f} {ex:.1f},{ey + 7:.1f}" fill="{WHITE}"/>')
        g.append(f'<circle cx="{v.p(45, R)[0]:.1f}" cy="{v.p(45, R)[1]:.1f}" r="4.5" fill="{WHITE}"/>')
        bs = [(45, 5, 1), (22.5, -9, 2), (-58, -9, 3)]
    else:
        bs = [(45, -16.5, 1), (22.5, 12, 2), (-22.5, -6, 3)]
    for bxw, byw, n in bs:
        px, py = v.p(bxw, byw)
        g.append(badge(px, py, n))
    body.append(f'<g clip-path="url(#c{pi})">' + '\n'.join(g) + '</g>')
    body.append(f'<rect x="{ox}" y="{Y0 + 30}" width="{PW}" height="{PH}" rx="6" fill="none" stroke="#3a414c"/>')
    if mode == 'current':
        caps = ['1  Stand centerline runs straight across the taxilane', '2  Curves start beyond the taxilane and bend back', '3  Aircraft would overshoot the taxilane, then reverse']
    else:
        caps = ['1  One fork point on the stand centerline, right behind the tail', '2  Each branch joins the taxilane centerline tangentially', '3  Push back runs tail first along one branch, then taxi forward']
    for k, c in enumerate(caps):
        body.append(text(ox, Y0 + 30 + PH + 26 + k * 21, c, 13, TXT, 'start'))

open('/home/claude/samples/fig1_pushback.svg', 'w').write(svg_doc(W, H, '\n'.join(body)))
print(W, H)
