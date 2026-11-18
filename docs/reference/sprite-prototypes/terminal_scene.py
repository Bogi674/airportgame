"""Terminal scene with the fixture kit in use, at the default terminal zoom of 14 px per meter (tier 2).

Landside hall with check in, kiosks and self bag drop, security lanes of all three levels, passport control with
automated gates, an airside plaza, a premium lounge, washrooms, the gate lounge, and an A320neo on a jet bridge
stand, so the interior can be judged side by side with the aircraft sprites.
"""
import math
import random
from lib import fmt, rect, circle, line, text, g, path, poly, vwall, hwall, glass_v, glass_h, label_chip
import fixture_core as fc
from fixture_core import D, C
import fixtures_processing as fp
import fixtures_general as fg
import fixtures_building as fb
import people2 as pp
import air2
import specs2
import apron_stand
import fixtures_zoning as fz
from terminal_sheets import PAX, STAFF, nobag, person, header, BG, MUTED, WHITE, text as _t

PX = 14.0
TIER = 2
W_M, H_M = 197.8, 56.0


OBST = []


def put(fn, x, y, w, h, rot=0, **kw):
    """Place a fixture whose local footprint is w by h at world (x, y), the top left of its rotated footprint."""
    OBST.append((x, y, x + (h if rot in (90, 270) else w), y + (w if rot in (90, 270) else h)))
    d = D(PX, TIER, rot)
    fn(d, **kw)
    s = d.svg()
    if rot == 0:
        t = f"translate({fmt(x)} {fmt(y)})"
    elif rot == 90:
        t = f"translate({fmt(x + h)} {fmt(y)}) rotate(90)"
    elif rot == 180:
        t = f"translate({fmt(x + w)} {fmt(y + h)}) rotate(180)"
    else:
        t = f"translate({fmt(x)} {fmt(y + w)}) rotate(-90)"
    return g(s, t)


def build(write, emit=True):
    rng = random.Random(7)
    L = []          # floors
    Wl = []         # walls
    F = []          # fixtures
    A = []          # apron and aircraft
    P = []          # people
    # ---------------- floors -------------------------------------------------------------------------------
    L.append(rect(0, 0, 36, H_M, "url(#f_terrazzo)"))
    L.append(rect(36, 10, 18, 22, "url(#f_secure)"))
    L.append(rect(36, 0, 26, 10, "url(#f_office)"))
    L.append(rect(36, 32, 26, 24, "url(#f_terrazzo)"))
    L.append(rect(54, 10, 8, 22, "url(#f_stone)"))
    L.append(rect(62, 0, 28, H_M, "url(#f_stone)"))
    L.append(rect(74, 34, 16, 22, "url(#f_wood)"))
    L.append(rect(90, 0, 22, H_M, "url(#f_carpet)"))
    L.append(rect(22, 40, 14, 16, "url(#f_tile_wc)"))
    L.append(rect(62, 40, 12, 16, "url(#f_tile_wc)"))
    # ---------------- walls and glass -----------------------------------------------------------------------
    Wl.append(hwall(0.3, 0, 112))
    Wl.append(hwall(H_M - 0.3, 0, 112))
    Wl.append(glass_v(0.3, 0, H_M))
    Wl.append(rect(0, 9, 0.6, 5, "#e4e8ed") + rect(0, 42, 0.6, 5, "#e4e8ed"))        # entrance doors
    Wl.append(vwall(36, 0, H_M, gaps=[(10, 32), (36.5, 38.5)]))
    Wl.append(hwall(10, 36, 62, gaps=[(40, 42)]))
    Wl.append(hwall(32, 36, 62, gaps=[(59.6, 61.6)]))
    Wl.append(vwall(54, 10, 32, gaps=[(12, 30)]))
    Wl.append(vwall(62, 0, H_M, gaps=[(12, 30), (34, 38)]))
    Wl.append(vwall(48, 0, 10, gaps=[(4, 6)]))
    # washrooms landside
    Wl.append(hwall(40, 22, 36, gaps=[(23, 25), (33, 35)]))
    Wl.append(vwall(22, 40, H_M))
    Wl.append(vwall(29, 40, H_M))
    # washrooms airside and lounge
    Wl.append(hwall(40, 62, 74, gaps=[(62.6, 64.2), (72, 73.6)]))
    Wl.append(vwall(68, 40, H_M))
    Wl.append(vwall(74, 34, H_M))
    Wl.append(glass_h(34, 74, 90))
    Wl.append(rect(76, 33.7, 3, 0.6, "#e4e8ed"))
    Wl.append(vwall(90, 34, H_M, gaps=[(36, 38)]))
    Wl.append(glass_v(112, 0, H_M))
    for gy in (8, 39, 48):
        Wl.append(rect(111.6, gy, 0.8, 2, "#35557f"))

    # ---------------- check in hall -------------------------------------------------------------------------
    islands = [(4, 3, 1, fc.LIVERY[3]), (12, 4, 2, fc.LIVERY[0]), (22, 4, 3, fc.LIVERY[1])]
    for x0, n, lvl, liv in islands:
        for k in range(n):
            x = x0 + 2 * k
            F.append(put(lambda d: fc.ramp_stub(d, 0, 0, True), x, 2, 2, 2))
            if lvl == 3:
                F.append(put(fp.checkin_mat, x, 4, 2, 2))
            F.append(put(fp.checkin, x, 4, 2, 2, level=lvl, livery=liv, bag=(k % 2 == 0)))
            P.append(person(x + 0.3, 4.44, 180, STAFF["agent"] if k % 2 else STAFF["agent2"]))
            P.append(person(x + 1.25, 5.9, 0, PAX[(x0 + k) % 8]))
        qx = x0 + n - 1.8
        F.append(put(fg.queue_kit, qx, 7.4, 3.9, 2.4, cols=3, rows=3, pitch=1.6, row_gap=1.0))
        for j in range(4):
            P.append(person(qx + 0.6 + j * 0.8, 8.15, 90, PAX[(j + x0) % 8], j % 4))
            P.append(person(qx + 2.6 - j * 0.75, 9.15, -90, PAX[(j + x0 + 3) % 8], (j + 1) % 4))
    for k in range(5):
        F.append(put(fp.kiosk_checkin, 3 + 2 * k, 15, 2, 2, livery=fc.LIVERY[1]))
        if k in (0, 2, 3):
            P.append(person(4 + 2 * k, 16.5, 0, PAX[k + 2]))
    for k in range(3):
        x = 16 + 5 * k
        F.append(put(lambda d: fc.ramp_stub(d, 0, 0, True), x, 13, 2, 2))
        F.append(put(fp.bagdrop_self, x, 15, 4, 2, livery=fc.LIVERY[1], bag=(k != 1)))
        if k != 1:
            P.append(person(x + 2.41, 16.65, 0, PAX[k + 3]))
    F.append(put(fg.fids_bank, 6, 22.5, 4.2, 0.32, n=5))
    F.append(put(fg.info_desk, 18, 24, 3, 2))
    F.append(put(fg.fids_bank, 25.6, 22.5, 2.6, 0.32))
    F.append(put(fg.column_round, 24, 34, 0.9, 0.9, ad=True))
    F.append(put(fg.bench_charge, 22, 37.0, 3.14, 0.68))
    P.append(person(18.95, 24.32, 180, STAFF["agent"]))
    P.append(person(19.9, 26.3, 0, PAX[7]))
    for k in range(3):
        F.append(put(fg.bench_wood, 4 + k * 5.5, 30, 1.9, 0.48))
        F.append(put(fg.bench_wood, 4 + k * 5.5, 31.0, 1.9, 0.48, rot=180))
    for (x, y) in ((2, 26), (32, 26), (2, 36), (32, 36)):
        F.append(put(fg.planter_large, x, y, 1.6, 1.6))
    F.append(put(fg.trolley_bay, 1.2, 48.5, 3.4, 1.0))
    F.append(put(fb.escalator_pair, 4.0, 41.0, 3.6, 13.2, rot=90))
    F.append(put(fb.stairs_switchback, 7.5, 46.0, 3.9, 6.4, rot=180))
    F.append(put(fb.elevator_bank, 15.5, 46.4, 5.4, 2.94, rot=180))
    for x, y, r in ((8.0, 41.83, 90), (12.4, 41.83, 90), (10.2, 43.78, -90), (14.6, 43.78, -90)):
        P.append(person(x, y, r, PAX[int(x) % 8], 1))
    F.append(put(fg.atm_pair, 8, 54.88 - 0.82 - 0.0, 1.9, 0.82, rot=180))
    for k, (b, a, kd) in enumerate((("#3a414b", "#d4a23a", "snack"), ("#b3262e", "#f4f6f8", "drink"),
                                    ("#4a3326", "#c9a27a", "coffee"))):
        F.append(put(fg.vending, 11.2 + k * 1.1, 54.88 - 0.86 - 0.0, 1.0, 0.86, rot=180, body=b, accent=a, kind=kd))
    F.append(put(fg.help_point, 16, 53, 0.4, 0.4))
    for x, y in ((30.5, 20.5), (12, 28)):
        F.append(put(fg.column_round, x, y, 0.9, 0.9))
    # landside washrooms: men (22 to 29) and women (29 to 36)
    F.append(put(fg.urinals, 22.4, 55.4 - 0.5, 2.4, 0.5, rot=180, n=3))
    for k in range(2):
        F.append(put(fg.wc_stall, 25.3 + k * 1.0, 55.4 - 1.6, 1.0, 1.6, rot=180))
    F.append(put(fg.vanity, 26.2, 40.3, 1.6, 0.6, n=2))
    F.append(put(fg.hand_dryer, 28.68 - 0.22, 44, 0.32, 0.22, rot=90))
    for k in range(5):
        F.append(put(fg.wc_stall, 29.4 + k * 1.0, 55.4 - 1.6, 1.0, 1.6, rot=180))
    F.append(put(fg.vanity, 30.0, 40.3, 2.4, 0.6, n=3))
    F.append(put(fg.baby_change, 35.68 - 0.56, 44, 0.9, 0.56, rot=90))
    F.append(put(fg.trash_round, 23.5, 46, 0.42, 0.42))
    F.append(put(fg.trash_round, 31.0, 46, 0.42, 0.42))

    # ---------------- security ------------------------------------------------------------------------------
    lane_people = {
        1: [(1.6, 2.8, 90, nobag(PAX[2])), (1.8, 1.58, 0, nobag(PAX[0])), (4.92, 2.46, 90, nobag(PAX[3])),
            (5.9, 3.3, -90, STAFF["security"]), (6.74, 2.06, 0, STAFF["security2"]), (7.9, 1.58, 0, nobag(PAX[5]))],
        2: [(1.5, 1.62, 0, nobag(PAX[1])), (3.3, 1.62, 0, nobag(PAX[6])), (2.6, 2.46, 90, nobag(PAX[2])),
            (5.62, 2.46, 90, nobag(PAX[0])), (7.96, 2.4, 0, STAFF["security"]), (9.0, 1.62, 0, nobag(PAX[3]))],
        3: [(0.94, 1.92, 0, nobag(PAX[0])), (3.24, 1.92, 0, nobag(PAX[5])), (6.6, 2.62, 90, nobag(PAX[3])),
            (7.7, 3.6, -90, STAFF["security"]), (12.75, 3.15, 0, STAFF["security2"]), (10.4, 2.5, 0, nobag(PAX[6]))],
    }
    for i, lvl in enumerate((3, 2, 1)):
        ly = 13 + 4.4 * i
        d = D(PX, TIER)
        fp.security(d, lvl)
        F.append(g(d.svg(), f"translate(37 {fmt(ly)})"))
        for (x, y, r, rc) in lane_people[lvl]:
            P.append(person(37 + x, ly + y, r, rc))
    # airline offices above security: open office (36 to 48), pantry (48 to 55), executive office (55 to 62)
    Wl.append(vwall(55, 0, 10, gaps=[(7.2, 8.6)]))
    F.append(put(fb.desk_pod, 37.4, 0.9, 3.2, 2.8))
    F.append(put(fb.desk_pod, 41.8, 0.9, 3.2, 2.8))
    F.append(put(fb.copier, 46.2, 0.65, 1.2, 0.7))
    F.append(put(fb.whiteboard, 36.3, 4.2, 1.8, 0.12, rot=270))
    F.append(put(fb.meeting_table, 36.9, 6.6, 2.8, 2.4))
    F.append(put(fb.round_table4, 43.2, 6.4, 2.0, 2.0))
    F.append(put(fb.filing, 45.6, 9.7 - 0.62, 1.46, 0.62, rot=180))
    for k, (x, y, r) in enumerate(((38.2, 1.2, 180), (39.8, 3.4, 0), (42.6, 3.4, 0), (44.2, 1.2, 180),
                                   (37.52, 7.0, 180), (38.3, 8.5, 0), (43.5, 6.9, 225))):
        P.append(person(x, y, r, STAFF["agent"] if k % 2 else STAFF["agent2"]))
    F.append(put(fb.pantry_counter, 48.6, 0.62, 2.4, 0.65))
    F.append(put(fb.fridge, 51.2, 0.62, 0.72, 0.7))
    F.append(put(fb.water_cooler, 52.3, 0.7, 0.36, 0.36))
    F.append(put(fb.high_table, 48.9, 3.0, 1.6, 1.5))
    F.append(put(fb.round_table4, 51.9, 3.6, 2.0, 2.0))
    F.append(put(fg.sofa, 48.8, 9.7 - 0.92, 1.6, 0.92, rot=180, seats=2, col="#59616d"))
    F.append(put(fg.trash_recycle, 51.6, 9.7 - 0.44, 1.2, 0.44, rot=180))
    P.append(person(49.7, 1.6, 0, STAFF["agent"]))
    P.append(person(49.7, 4.75, 0, PAX[7]))
    F.append(put(fb.credenza, 57.4, 0.62, 2.0, 0.5))
    F.append(put(fb.exec_desk, 57.4, 1.3, 2.0, 2.44))
    F.append(put(fg.planter_large, 55.5, 0.75, 1.6, 1.6))
    F.append(put(fb.office_sofa_l, 59.1, 7.1, 2.4, 2.4, rot=180))
    F.append(put(fg.coffee_table, 57.3, 7.5, 1.2, 0.6))
    F.append(put(fb.model_stand, 60.6, 0.66, 0.6, 0.5))
    P.append(person(58.4, 1.62, 180, STAFF["agent2"]))
    P.append(person(57.95, 3.5, 0, PAX[0]))
    # janitor room off the prayer room corridor
    Wl.append(hwall(35.6, 36, 40.9, gaps=[(36.9, 37.8)]))
    Wl.append(vwall(40.6, 32, 35.9))
    L.append(rect(36.3, 32.3, 4.0, 3.0, "url(#f_office)"))
    F.append(put(fb.janitor_room, 36.3, 32.3, 4.0, 3.0))
    # prayer room and kids below security
    Wl.append(vwall(46, 32, H_M, gaps=[(34, 36)]))
    F.append(put(fg.prayer_mats, 37.5, 44, 3.5, 2.0, n=4))
    F.append(put(fg.prayer_mats, 37.5, 49, 3.5, 2.0, n=4))
    F.append(put(fg.kids_play, 50, 44, 3, 3))
    F.append(put(fg.bench_padded, 49.5, 40, 2.11, 0.72))
    F.append(put(fg.bench_padded, 53.0, 40, 2.11, 0.72, col=C["mustard"]))
    F.append(put(fg.planter_small, 58, 42, 0.7, 0.7))

    # ---------------- security exit: glass corridor from the secure side back to the landside hall -----------
    Wl.append(glass_h(27.6, 36.4, 56.0))
    Wl.append(glass_h(30.0, 36.4, 56.0))
    L.append(rect(36.0, 27.6, 20.0, 2.4, "url(#f_stone)"))
    F.append(put(fz.security_exit_auto, 37.0, 27.8, 2, 6, rot=270))
    P.append(person(46.0, 28.8, -90, PAX[2], 1))
    P.append(person(49.5, 28.8, -90, PAX[6], 3))
    # staff door from the security hall into the airline offices
    F.append(put(fz.staff_door, 40.0, 8.95, 2, 1.2, rot=180))

    # ---------------- passport control ----------------------------------------------------------------------
    units = [("p", 1), ("p", 2), ("p", 3), ("e", 0), ("e", 0), ("e", 0), ("e", 0)]
    for k, (kind, lvl) in enumerate(units):
        y = 13 + 2 * k
        if kind == "p":
            F.append(put(fp.passport, 57, y, 2, 2, rot=90, level=lvl))
            P.append(person(58.0, y + 0.35, 180, STAFF["customs"]))
            P.append(person(58.0, y + 1.56, 0, PAX[k + 4]))
        else:
            F.append(put(fp.egate, 57, y, 2, 2, rot=90))
            if k % 2:
                P.append(person(57.95, y + 1.0, 90, PAX[k]))
    for k in range(5):
        P.append(person(55.2 - (k % 2) * 0.7, 15 + k * 2.4, 90, PAX[(k * 3) % 8], k % 4))

    # ---------------- airside plaza -------------------------------------------------------------------------
    for k, (b, a, kd) in enumerate((("#3a414b", "#d4a23a", "snack"), ("#b3262e", "#f4f6f8", "drink"),
                                    ("#4a3326", "#c9a27a", "coffee"), ("#2f6b4f", "#e9d27a", "fresh"),
                                    ("#2f4a6e", "#5fa8d3", "travel"))):
        F.append(put(fg.vending, 63 + k * 1.1, 0.62, 1.0, 0.86, body=b, accent=a, kind=kd))
    F.append(put(fg.water_filler, 69, 0.62, 0.5, 0.34))
    F.append(put(fg.led_wall, 74, 0.62, 6.0, 0.4))
    F.append(put(fg.ceiling_fids, 82, 6, 3.0, 0.3))
    F.append(put(fg.tree_bench, 66, 16, 3.6, 3.6))
    F.append(put(fg.fountain, 76, 17, 2.4, 2.4))
    F.append(put(fg.model_case, 71, 7, 2.0, 1.3, air_svg=g(air2.render(specs2.SPECS["a320neo"], 2, PX / 32, True,
                                                                         (0.9, 1.3)),
                                                              f"translate(1.0 0.65) scale({fmt(1 / 32)}) rotate(90) "
                                                              f"translate(0 {fmt(-37.57 / 2)})")))
    F.append(put(fg.sculpture, 82, 17.5, 1.6, 1.6))
    F.append(put(fg.medallion, 69.5, 26, 3, 3))
    F.append(put(fg.overhead_sign, 80, 28, 3.0, 0.32))
    for x, y in ((64, 8), (64, 30), (86, 30)):
        F.append(put(fg.bench_charge, x, y, 3.14, 0.68))
    F.append(put(fb.travelator_pair, 85.8, 3.0, 3.6, 20.0, L=20.0))
    for x, y, r in ((86.63, 8.0, 0), (86.63, 15.0, 0), (88.58, 6.0, 180), (88.58, 12.5, 180), (88.58, 19.0, 180)):
        P.append(person(x, y, r, PAX[int(y) % 8], 1))
    for x, y in ((80, 12), (66, 23)):
        F.append(put(fg.charge_tower, x, y, 0.62, 0.62))
    for x, y in ((63, 13), (63, 34.6), (72, 31)):
        F.append(put(fg.planter_small, x, y, 0.7, 0.7))
    F.append(put(fg.trash_recycle, 74, 13, 1.2, 0.44))
    F.append(put(fg.info_totem, 74, 24, 0.6, 0.36))
    # airside washrooms
    F.append(put(fg.urinals, 62.4, 55.4 - 0.5, 2.4, 0.5, rot=180, n=3))
    F.append(put(fg.wc_accessible, 65.4, 55.4 - 2.2, 2.2, 2.2, rot=180))
    F.append(put(fg.vanity, 64.6, 40.3, 1.6, 0.6, n=2))
    for k in range(5):
        F.append(put(fg.wc_stall, 68.4 + k * 1.0, 55.4 - 1.6, 1.0, 1.6, rot=180))
    F.append(put(fg.vanity, 69.0, 40.3, 2.4, 0.6, n=3))
    F.append(put(fg.janitor_cart, 69.2, 46, 0.95, 0.55))
    P.append(person(68.9, 46.9, 0, STAFF["cleaner"]))

    # ---------------- premium lounge (74 to 90, 34 to 56) --------------------------------------------------
    F.append(put(fg.rug, 76, 38, 2.4, 1.7))
    F.append(put(fg.sofa, 75.6, 36.0, 2.2, 0.92))
    F.append(put(fg.armchair, 78.4, 38.4, 0.9, 0.9, rot=90))
    F.append(put(fg.coffee_table, 76.6, 38.6, 1.2, 0.6))
    F.append(put(fg.end_table_lamp, 75.0, 36.2, 0.5, 0.5))
    F.append(put(fg.rug, 82, 38, 2.4, 1.7, col="#2f6b4f"))
    F.append(put(fg.sofa, 81.8, 36.0, 1.6, 0.92, seats=2, col=C["teal"]))
    F.append(put(fg.armchair, 81.0, 38.4, 0.9, 0.9, rot=270, col=C["mustard"]))
    F.append(put(fg.coffee_table, 82.6, 38.6, 1.2, 0.6))
    F.append(put(fg.floor_lamp, 86.6, 35.6, 0.84, 0.75))
    F.append(put(fg.bar_counter, 75.6, 43, 3.0, 1.52))
    F.append(put(fg.buffet, 80.4, 43, 2.4, 0.8))
    for k in range(2):
        F.append(put(fg.dining_set, 80 + k * 2.6, 46.2, 2, 2))
    F.append(put(fg.tv_credenza, 89.15, 41.5, 2.0, 0.55, rot=90))
    for k in range(3):
        F.append(put(fg.recliner, 75.2 + k * 1.0, 49.0, 0.8, 1.86))
    F.append(put(fg.bookshelf, 79, 55.4 - 0.35, 1.2, 0.35, rot=180))
    F.append(put(fg.work_desk, 86, 49.6, 1.4, 1.2, rot=0))
    F.append(put(fg.cupboard, 86.2, 55.4 - 0.55, 1.6, 0.55, rot=180))
    F.append(put(fg.planter_large, 86.8, 45.2, 1.6, 1.6))
    P.append(person(77.0, 44.9, 0, PAX[0]))
    P.append(person(81.6, 44.3, 0, PAX[5]))
    P.append(person(84.0, 45.5, 90, PAX[7]))

    # ---------------- gate lounge (90 to 112) ---------------------------------------------------------------
    gates = [(3.8, 1), (34.8, 2), (43.8, 3)]
    for gy, lvl in gates:
        F.append(put(fp.gatedesk, 107.6, gy, 4, 2, rot=90, level=lvl, livery=fc.LIVERY[0]))
        if lvl == 1:
            P.append(person(109.1, gy + 1.5, -90, STAFF["agent"]))
        else:
            P.append(person(109.1, gy + 0.95, -90, STAFF["agent"]))
            P.append(person(109.1, gy + 2.25, -90, STAFF["agent2"]))
        if lvl == 3:
            F.append(put(fg.gate_display, 104.2, gy - 1.6, 1.2, 0.32))
    seat_rows_y = [1.4, 8.6, 12.6, 16.6, 28.6, 32.6, 36.6, 48.6]
    for x in (92.0, 95.6, 99.2, 102.8):
        for y in seat_rows_y:
            F.append(put(fg.bench_beam, x, y, 3.19, 0.68, seats=5))
    for y in (6.0, 26.0, 46.0):
        F.append(put(fg.bench_padded, 92.0, y, 2.11, 0.72))
        F.append(put(fg.bench_padded, 99.2, y, 2.11, 0.72, col=C["navy"]))
    for x, y in ((106.5, 13), (106.5, 30.6), (91, 21)):
        F.append(put(fg.planter_large, x, y, 1.6, 1.6))
    for x, y in ((106.6, 10.4), (106.6, 26.0)):
        F.append(put(fg.trash_round, x, y, 0.42, 0.42))
    F.append(put(fg.wall_tv, 93, 0.62, 1.4, 0.1))
    F.append(put(fg.ad_totem, 97, 21.5, 0.8, 0.42))
    for x in (92.0, 95.6, 99.2, 102.8):
        for y in seat_rows_y:
            for s_ in range(5):
                if rng.random() < 0.38:
                    P.append(person(x + 0.36 + s_ * 0.63, y + 0.42, 180, PAX[rng.randrange(8)], 1))
    for k in range(4):
        P.append(person(106.8, 39.4 + k * 0.72, 0, PAX[k % 8], k % 4))

    # ---------------- apron: contact stand 22 from the stand templates, rotated so the head faces the terminal ----
    X0, Y0, ROT = 197.8, 3.0, 90          # stand local (x, y) to world (X0 - y, Y0 + x)
    st = apron_stand.contact_stand("s22", ROT, "22")
    T = f"translate({fmt(X0)} {fmt(Y0)}) rotate({ROT})"
    A.append(g(st["marks"], T))
    AV = [g(st["vehicles"], T), g(st["bridge"], T), g(st["aircraft"], T)]

    # ---------------- walkers, placed clear of every fixture and of each other ------------------------------
    OBST.extend([(16.5, 40, 36, 56), (0, 46, 6, 56)])
    taken = []
    zones = [((1.2, 11.2, 35.2, 39.5), 46), ((62.8, 2.2, 89.4, 33.4), 34), ((74.8, 35.2, 89.4, 55.0), 5),
             ((90.6, 1.0, 107.0, 55.0), 8), ((46.8, 33.0, 61.4, 55.0), 5), ((41.2, 33.0, 45.4, 43.5), 2), ((36.8, 36.4, 41.0, 43.5), 2)]
    for (x0, y0, x1, y1), n in zones:
        placed, tries = 0, 0
        while placed < n and tries < 4000:
            tries += 1
            x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
            if any(a - 0.45 < x < c + 0.45 and b - 0.45 < y < d + 0.45 for a, b, c, d in OBST):
                continue
            if any((x - u) ** 2 + (y - v) ** 2 < 0.9 for u, v in taken):
                continue
            taken.append((x, y))
            P.append(person(x, y, rng.choice((0, 90, 180, 270, 45, 135, 225, 315)), PAX[rng.randrange(8)],
                            rng.randrange(4)))
            placed += 1

    # ---------------- labels (pixel space) -----------------------------------------------------------------
    labels = [(3, 11.4, "Check in"), (3, 18.2, "Kiosks and self bag drop"), (3, 33.5, "Landside hall"),
              (23.0, 51.6, "Washrooms"), (37.4, 10.9, "Security: smart, standard and basic lanes"),
              (54.6, 30.0, "Passport"), (37.4, 40.6, "Prayer room"),
              (49.6, 51.0, "Family area"), (63.5, 3.6, "Airside plaza"), (75.4, 52.6, "Premium lounge"),
              (62.5, 47.5, "Washrooms"), (92.0, 23.2, "Gate lounge"), (92.0, 41.0, "Gates 21 to 23"),
              (37.0, 4.25, "Airline offices"), (44.0, 30.12, "Security exit"), (48.7, 6.1, "Pantry"), (55.6, 4.4, "Executive"),
              (4.0, 39.1, "Escalators, stairs and lifts"), (81.0, 23.6, "Travelator"), (150, 0.6, "Stand 22, A320neo on the jet bridge, turnaround in progress")]
    lab = []
    for x, y, s_ in labels:
        c, w = label_chip(x * PX, y * PX, s_, 12, "#1d2b45", WHITE, 9, 22)
        lab.append(c)

    parts = dict(L=L, A=A, Wl=Wl, F=F, AV=AV, P=P, labels=labels)
    if not emit:
        return parts
    W, H = int(W_M * PX) + 80, int(H_M * PX) + 190
    scene = g("".join(L) + "".join(A) + "".join(Wl) + "".join(F) + "".join(AV) + "".join(P),
              f"translate(40 120) scale({fmt(PX)})")
    body = (header("Terminal scene with the fixture kit at the default zoom",
                   "14 px per meter, tier 2, one slice from the landside entrance to stand 22. Stand paint from the stand "
                   "templates, jet bridge per Revision 3 section 4.2, aircraft in the composite livery of the style sheet.")
            + rect(40, 120, W_M * PX, H_M * PX, "none", "#3b4656", 1)
            + scene + g("".join(lab), "translate(40 120)")
            + text(40, H - 34, "Draw order: floors and apron paint, walls and glass, fixtures, ground vehicles, jet "
                               "bridge, aircraft, people, labels. Every shadow is baked toward the world sun after "
                               "rotation, and the ground equipment passes the GSE collision check.", 13, MUTED))
    write("terminal_scene_kit", W, H, body)
    return parts
