"""docs/art/baggage_kit.png: baggage nodes, ramps, overlay pieces and an automatically linked chain.

The chain scene places nodes only. Every under floor link in it comes from baggage_links.Network (rules A to C),
so the sheet doubles as a visual test of the auto connection logic.
"""
import math
from lib import fmt, rect, circle, line, text, g, path, poly, vwall, hwall, glass_v
import fixture_core as fc
from fixture_core import D, C
import fixtures_processing as fp
import fixtures_baggage as fbg
import baggage_links as BL
import gse
from terminal_sheets import (card, flow, section, header, write, chip, tw, wrap, gen_card, bake, person, PAX, STAFF,
                             MUTED, WHITE)


def sheet_baggage():
    W = 1880
    body = [header("Baggage network kit",
                   "Nodes from docs/BAGGAGE.md in the terminal kit style. The player places nodes, the game links "
                   "them under the floor. Ramps are 2 by 2 m cells with the node at their inner edge.")]
    y = 110

    # ---------------- ramps ------------------------------------------------------------------------------------
    px = 70
    cards = []
    for title, kw, note in (("Out ramp, departures", dict(out=True, flow="dep"), "Bags sink away from the node"),
                            ("In ramp, departures", dict(out=False, flow="dep"), "Bags rise toward the node"),
                            ("Out ramp, arrivals", dict(out=True, flow="arr"), "Amber for arrival flow"),
                            ("In ramp, arrivals", dict(out=False, flow="arr"), "Amber for arrival flow"),
                            ("Unconnected ramp", dict(out=True, flow="dep", connected=False),
                             "Grey chevrons, dashed red outline")):
        cards.append(gen_card(fbg.ramp, 2, 2, title, "2 x 2 m cell", note, px, floor="f_terrazzo", kw=kw, ah=230,
                              cw=270))

    def tiers(x, yy):
        o = [rect(x, yy, 560, 230, "#d9dee4", rx=8)]
        cx = x + 14
        for lab, t, tpx in (("Tier 3", 3, 70), ("Tier 2", 2, 40), ("Tier 1", 1, 24)):
            s, _ = bake(fbg.ramp, tpx, tier=t)
            o.append(rect(cx, yy + 14, 170, 180, "#e4e8ed", rx=6))
            o.append(g(s, f"translate({fmt(cx + 85 - tpx)} {fmt(yy + 104 - tpx)}) scale({tpx})"))
            o.append(text(cx + 85, yy + 214, lab, 12, "#2b333e", "bold", "middle"))
            cx += 180
        o.append(text(x + 2, yy + 252, "Ramp detail tiers", 15, WHITE, "bold"))
        o.append(text(x + 2, yy + 272, "Tier 1 keeps the belt strip, tier 2 adds rails and the slot.", 12, MUTED))
        return "".join(o), 290
    cards.append(dict(w=560, draw=tiers))
    s, yend = flow(40, y + 52, W - 80, cards)
    body.append(section(20, y, W - 40, yend - y + 24, "Ramp stubs"))
    body.append(s)
    y = yend + 50

    # ---------------- nodes ------------------------------------------------------------------------------------
    px = 46
    ramp_cell = lambda d: fc.ramp_stub(d, 0, 0, True)                                       # noqa: E731

    def desk_with_ramp(d):
        d.place(fbg.ramp, 0, 0, 0, True, "dep")
        d.place(fp.checkin, 0, 2.0, 0, level=2, livery=fc.LIVERY[0], bag=True)

    def sbd_with_ramp(d):
        d.place(fbg.ramp, 0, 0, 0, True, "dep")
        d.place(fp.bagdrop_self, 0, 2.0, 0, livery=fc.LIVERY[1], bag=True)

    def machine_with_console(d):
        d.place(fbg.screening_machine, 0, 0, 0, True)
        d.place(fbg.screening_console, 3.6, 2.3)

    cards = [
        gen_card(desk_with_ramp, 2, 4, "Check in desk with bag drop", "2 x 4 m with the ramp cell",
                 "Belt lane meets the out ramp", px, ah=290, cw=250),
        gen_card(sbd_with_ramp, 4, 4, "Self bag drop", "4 x 4 m with the ramp cell", "Ramp behind the left cell",
                 px, ah=290, cw=290),
        gen_card(machine_with_console, 8, 3.6, "Screening machine", "8 x 2 m with both ramps",
                 "In ramp left, out ramp right, console", px, ah=290, cw=470, floor="f_secure"),
        gen_card(fbg.carousel_with_ramp, 22, 4, "Baggage carousel", "20 x 4 m plus the feed ramp",
                 "Holds 60 bags, island in the middle", 34, ah=290, cw=820),
    ]
    s, yend = flow(40, y + 52, W - 80, cards)

    # bay with lanes and a tractor train, drawn as one composite card
    def bay_card(x, yy):
        bpx = 22
        aw, ah = 560, 640
        o = [rect(x, yy, aw, ah, "#d9dee4", rx=8)]
        inner = [rect(-6, -4, 30, 32, "url(#f_stone)"), rect(-6, 8.0, 30, 22, "url(#pConc)"),
                 rect(-6, 7.7, 30, 0.6, C["wall"])]
        d = D(bpx, 3)
        fbg.baggage_bay(d, 4, 1)
        inner.append(d.svg())
        for s_ in range(2):
            dl = D(bpx, 3)
            fbg.staging_lane(dl)
            inner.append(g(dl.svg(), f"translate({4 * s_} 8.3)"))
        v = [gse.Placed("tractor", (2.0, 20.9), (0, 1), "#f28c28", "Tractor"),
             gse.Placed("cart", (2.0, 17.65), (0, 1), "#f28c28", "Cart 1"),
             gse.Placed("cart", (2.0, 13.4), (0, 1), "#f28c28", "Cart 2")]
        inner.append("".join(q.svg() for q in v))
        o.append(g(inner, f"translate({fmt(x + 6 * bpx)} {fmt(yy + 4 * bpx)}) scale({bpx})"))
        o.append(f'<clipPath id="bayclip"><rect x="{x}" y="{yy}" width="{aw}" height="{ah}" rx="8"/></clipPath>')
        o[1] = g(o[1], None, 'clip-path="url(#bayclip)"')
        o.append(text(x + 2, yy + ah + 22, "Baggage bay with staging lanes", 15, WHITE, "bold"))
        o.append(text(x + 2, yy + ah + 42, "8 x 8 m, 2 truck slots, 4 x 16 m lane per slot", 12, "#d5dbe3"))
        o.append(text(x + 2, yy + ah + 58, "In ramp left, out ramp right, makeup belt, hazard stripe at the door",
                      12, MUTED))
        return "".join(o), ah + 70
    s2, yend2 = flow(40, yend + 26, W - 80, [dict(w=560, draw=bay_card), dict(w=1240, draw=lambda x, yy:
                                                                            overlay_panel(x, yy))])
    body.append(section(20, y, W - 40, yend2 - y + 24, "Nodes and overlay"))
    body.append(s + s2)
    y = yend2 + 50

    # ---------------- chain ------------------------------------------------------------------------------------
    sc, sh = chain_scene(40, y + 52)
    body.append(section(20, y, W - 40, sh + 76, "Automatic chain", "nodes placed by the player, every link "
                                                                     "made by rules A to C, overlay on"))
    body.append(sc)
    y += sh + 100
    write("baggage_kit", W, int(y), "".join(body))


def overlay_panel(x, yy):
    """Under floor link samples, load colors, buffer rings and connection chips (world meters at 24 px/m)."""
    aw, ah = 1240, 640
    s = 24
    o = [rect(x, yy, aw, ah, "#d9dee4", rx=8)]
    inner = [rect(0, 0, aw / s, ah / s, "url(#f_terrazzo)")]
    inner.append(fbg.link_band([(2, 3), (20, 3), (20, 8)], fbg.DEP, True))
    inner.append(fbg.link_band([(24, 8), (24, 3), (42, 3)], fbg.ARR, False))
    for i, ld in enumerate((0.4, 0.75, 0.95)):
        inner.append(fbg.link_band([(2 + i * 14, 12.5), (13 + i * 14, 12.5)], None, True, load=ld))
    for i, f in enumerate((0.25, 0.6, 0.95)):
        inner.append(fbg.buffer_ring(5 + i * 8, 20, 1.6, f))
    o.append(g(inner, f"translate({x} {yy}) scale({s})"))
    labels = [(2, 1.4, "Departure link, solid chevrons"), (24, 1.4, "Arrival link, hollow chevrons"),
              (2, 10.8, "Load under 60 percent"), (16, 10.8, "60 to 90 percent"), (30, 10.8, "Over 90 percent"),
              (2, 23.6, "Node buffer ring, 25, 60 and 95 percent full")]
    for lx, ly, t_ in labels:
        o.append(text(x + lx * s, yy + ly * s, t_, 12, "#2b333e", "bold"))
    cx = x + 30 * s
    o.append(text(cx, yy + 16.6 * s, "Connection chips", 12, "#2b333e", "bold"))
    for i, (lab, col) in enumerate((("Auto", "#2f6fd1"), ("Manual", "#5d6672"), ("Not connected", "#d9534f"),
                                    ("Warning", "#b8862b"))):
        c, w = chip(0, 0, lab, col)
        o.append(g(c, f"translate({fmt(cx)} {fmt(yy + 17.4 * s + i * 30)})"))
    o.append(text(x + 2, yy + ah + 22, "Under floor links and overlay", 15, WHITE, "bold"))
    o.append(text(x + 2, yy + ah + 42, "Drawn only with the baggage overlay on or a node selected, at 70 percent "
                                       "opacity above floors and fixtures", 12, "#d5dbe3"))
    o.append(text(x + 2, yy + ah + 58, "Auto: placed by the rules. Manual: chosen in a menu. Not connected: no "
                                       "valid link. Warning: missing link, full buffer or unstaffed", 12, MUTED))
    return "".join(o), ah + 70


def chain_scene(x0, y0):
    s = 15.0
    Wm, Hm = 58.0, 54.0
    o = []
    inner = [rect(0, 0, Wm, 36, "url(#f_terrazzo)"), rect(28, 2, 14, 12, "url(#f_secure)"),
             rect(42, 0, 16, 36, "url(#f_stone)"), rect(0, 36, Wm, Hm - 36, "url(#pConc)")]
    walls = [hwall(0.3, 0, Wm), hwall(36, 0, Wm, gaps=[(44, 52)]), glass_v(0.3, 0, 36), vwall(Wm - 0.3, 0, 36),
             vwall(42, 0, 36, gaps=[(17, 19)]), hwall(2, 28, 42), hwall(14, 28, 42, gaps=[(31, 33)]),
             vwall(28, 2, 14), hwall(21, 0, 42), vwall(26.5, 21, 36, gaps=[(23, 25)])]
    F = []

    def put(fn, x, y, rot=0, **kw):
        d = D(s, 2)
        d.place(fn, x, y, rot, **kw)
        F.append(d.svg())

    net = BL.Network()
    nid = [0]

    def node(kind, inp=None, outp=None):
        nid[0] += 1
        n = BL.Node(nid[0], kind, in_port=inp, out_port=outp)
        return n

    # nodes are created first, then added in placement order so the rules run as in the game
    order = []
    for k in range(3):
        x = 4 + 2 * k
        put(fbg.ramp, x, 2, 0, out=True, flow="dep")
        put(fp.checkin, x, 4, 0, level=2, livery=fc.LIVERY[0], bag=(k != 1))
        order.append(node("drop", outp=(x // 2, 1)))
    put(fbg.ramp, 14, 10, 0, out=True, flow="dep")
    put(fp.bagdrop_self, 14, 12, 0, livery=fc.LIVERY[1], bag=True)
    order.append(node("drop", outp=(7, 5)))
    desk_ids, sbd_id = [q.id for q in order[:3]], order[3].id
    for k, yy in enumerate((4, 8)):
        put(fbg.screening_machine, 30, yy, 0, with_ramps=True)
        put(fbg.screening_console, 33.6, yy + 2.3) if k == 0 else None
        order.insert(0 if k == 0 else 1, node("machine", inp=(15, yy // 2), outp=(18, yy // 2)))
    put(fbg.carousel, 4, 27)
    put(fbg.ramp, 26, 26, 90, out=False, flow="arr")
    car = node("carousel", inp=(12, 14))
    put(fbg.baggage_bay, 44, 28, 0, cells=4, bay_no=1)
    bay = node("bay", inp=(22, 14), outp=(25, 14))
    for q in order:
        net.add(q)
    net.add(car)
    net.add(bay)
    net.assign_stand(bay.id, 22)
    for k in range(2):
        d = D(s, 2)
        fbg.staging_lane(d)
        F.append(g(d.svg(), f"translate({44 + 4 * k} 36.3)"))
    veh = [gse.Placed("tractor", (46.0, 48.9), (0, 1), "#f28c28", "Tractor"),
           gse.Placed("cart", (46.0, 45.65), (0, 1), "#f28c28", "Cart 1"),
           gse.Placed("cart", (46.0, 41.4), (0, 1), "#f28c28", "Cart 2")]
    F.append("".join(v.svg() for v in veh))
    ppl = [person(4.3, 4.44, 180, STAFF["agent"]), person(6.3, 4.44, 180, STAFF["agent2"]),
           person(8.3, 4.44, 180, STAFF["agent"]), person(5.25, 5.9, 0, PAX[0]), person(9.25, 5.9, 0, PAX[3]),
           person(16.41, 13.62, 0, PAX[4]), person(34.0, 7.2, 180, STAFF["security"]),
           person(10.0, 32.6, 0, PAX[1]), person(15.0, 32.8, 0, PAX[5]), person(20.5, 25.6, 180, PAX[6])]
    # overlay from the network
    ov = []
    for l in net.links:
        kinds = (net.nodes[l.src].kind, net.nodes[l.dst].kind)
        pts = [(cx * 2 + 1, cy * 2 + 1) for cx, cy in l.cells]
        arr = kinds == ("bay", "carousel")
        ov.append(fbg.link_band(pts, fbg.ARR if arr else fbg.DEP, not arr))
    for n, frac in ((order[0], 0.35), (order[1], 0.1), (bay, 0.62), (car, 0.2)):
        p = n.in_port or n.out_port
        ov.append(fbg.buffer_ring(p[0] * 2 + 1, p[1] * 2 + 1, 1.5, frac))
    o.append(g(inner + walls + F + ppl + ov, f"translate({x0} {y0}) scale({s})"))
    o.append(rect(x0, y0, Wm * s, Hm * s, "none", "#3b4656", 1))
    # labels in clear floor
    labs = [(1.0, 8.2, "Check in, 3 desks"), (11.0, 15.4, "Self bag drop"), (28.6, 14.8, "Screening room"),
            (43.0, 1.2, "Airside"), (46.2, 24.4, "Bay serves stand 22"), (1.0, 22.0, "Arrivals hall"),
            (1.0, 33.2, "Carousel 1"), (34.0, 40.5, "Apron, staging lanes")]
    from lib import label_chip
    for lx, ly, t_ in labs:
        c, w = label_chip(x0 + lx * s, y0 + ly * s, t_, 12, "#1d2b45", WHITE, 9, 22)
        o.append(c)
    # inspector mock and rule log
    px_ = x0 + Wm * s + 40
    o.append(rect(px_, y0, 740, 470, "#2e3642", rx=10))
    o.append(text(px_ + 20, y0 + 34, "Links made by the rules, as the overlay lists them", 15, WHITE, "bold"))
    rows = []
    for l in net.links:
        a, b = net.nodes[l.src], net.nodes[l.dst]
        rows.append((f"{a.kind} {a.id} to {b.kind} {b.id}", f"{int(l.length_m)} m, {l.length_m / 0.8:.0f} s",
                     l.mode.capitalize()))
    yy = y0 + 64
    for name, meta, mode in rows:
        o.append(rect(px_ + 16, yy - 18, 708, 30, "#262d37", rx=6))
        o.append(text(px_ + 28, yy + 2, name, 12, "#d5dbe3", "bold"))
        o.append(text(px_ + 360, yy + 2, meta, 12, MUTED))
        c, w = chip(0, 0, mode, "#2f6fd1")
        o.append(g(c, f"translate({fmt(px_ + 708 - w + 8)} {fmt(yy - 13)})"))
        yy += 36
    yy += 6
    o.append(text(px_ + 20, yy + 4, "Rules that made these links", 13, WHITE, "bold"))
    yy += 24
    for ln in ("A. Each drop point took the machine with the shortest valid link.",
               f"The desks went to machine {net.machine_of(desk_ids[0])}, the self bag drop to machine "
               f"{net.machine_of(sbd_id)}.",
               "B. The bay took the nearest carousel when it was placed.",
               "C. Assigning stand 22 linked every machine with a drop point to the bay.",
               "Paths are L shaped on the 2 m grid, length over 0.8 m/s is the transit time."):
        for part in wrap(ln, 700, 12):
            o.append(text(px_ + 20, yy, part, 12, MUTED))
            yy += 17
    warns = net.warnings()
    o.append(text(px_ + 20, yy + 10, "Warnings: " + ("none" if not warns else "; ".join(w for _, w in warns)), 12,
                  "#d5dbe3", "bold"))
    return "".join(o), Hm * s


if __name__ == "__main__":
    sheet_baggage()
