import math, sys
sys.path.insert(0, '/home/claude/samples')
from lib import *
from shapely.geometry import box

HW, RC, RE = 7.5, 40.0, 29.5   # code C: half width, centerline turn radius, edge fillet radius


def unit(a):
    return (math.cos(a), math.sin(a))


def fillet(node, a, b, off, r, n=30):
    """Fillet in the CCW sector from ray angle a to ray angle b, lines offset 'off' into the sector."""
    th = (b - a) % (2 * math.pi)
    da, db = unit(a), unit(b)
    bx, by = da[0] + db[0], da[1] + db[1]
    bl = math.hypot(bx, by); bx, by = bx / bl, by / bl
    P = (node[0] + bx * off / math.sin(th / 2), node[1] + by * off / math.sin(th / 2))
    td = r / math.tan(th / 2)
    Ta = (P[0] + da[0] * td, P[1] + da[1] * td)
    Tb = (P[0] + db[0] * td, P[1] + db[1] * td)
    C = (P[0] + bx * r / math.sin(th / 2), P[1] + by * r / math.sin(th / 2))
    a0 = math.atan2(Ta[1] - C[1], Ta[0] - C[0])
    a1 = math.atan2(Tb[1] - C[1], Tb[0] - C[0])
    d = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
    pts = [(C[0] + r * math.cos(a0 + d * i / n), C[1] + r * math.sin(a0 + d * i / n)) for i in range(n + 1)]
    return P, pts, td


def junction(v, node, angles_deg, L=400, hw=HW, rc=RC, re=RE, fill=ASPH, op=1, lines=True, line_op=1):
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
            # pavement follows the turn: curve swept at full width plus the area it encloses
            parts.append(LineString(cpts).buffer(hw, 32))
            parts.append(Polygon([node] + cpts).buffer(0))
        elif th < math.pi - 0.02:
            P, pts, _ = fillet(node, a, b, hw, re)
            parts.append(Polygon([P] + pts).buffer(0))
    pave = unary_union(parts)
    out = [shp(v, pave, fill, op=op)]
    if lines:
        out.append(shp_outline(v, pave.buffer(-0.7, join_style='round'), YEL, 1.6, op=line_op))
        for a in angs:
            d = unit(a)
            straight = any(abs(((b - a) % (2 * math.pi)) - math.pi) < math.radians(10) for b in angs if b != a)
            start = 0 if straight or not tdist[a] else min(tdist[a])
            out.append(polyline(v, [(node[0] + d[0] * start, node[1] + d[1] * start), (node[0] + d[0] * L, node[1] + d[1] * L)], YEL, 1.6, op=line_op))
        for c in curves:
            out.append(polyline(v, c, YEL, 1.6, op=line_op))
    return '\n'.join(out), pave


def bend(v, node, a_in_deg, a_out_deg, L=400, hw=HW, rc=60.0):
    a1, a2 = math.radians(a_in_deg), math.radians(a_out_deg)
    _, arc, td = fillet(node, a1, a2, 0, rc) if ((a2 - a1) % (2 * math.pi)) < math.pi else fillet(node, a2, a1, 0, rc)
    d1, d2 = unit(a1), unit(a2)
    far1 = (node[0] + d1[0] * L, node[1] + d1[1] * L)
    far2 = (node[0] + d2[0] * L, node[1] + d2[1] * L)
    if math.dist(arc[0], far1) > math.dist(arc[-1], far1):
        arc = arc[::-1]
    cl = [far1] + arc + [far2]
    pave = LineString(cl).buffer(hw, cap_style='flat', join_style='round')
    out = [shp(v, pave, ASPH), shp_outline(v, pave.buffer(-0.7, join_style='round'), YEL, 1.6), polyline(v, cl, YEL, 1.6)]
    return '\n'.join(out)
