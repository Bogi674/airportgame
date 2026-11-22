"""Finalize the terminal asset kit for the game build.

Writes
  src/data/fixtures/catalog.json          every asset: id, category, footprint, placement, zones, stats, ramps
  src/data/fixtures/sprites/<cat>.json    the vector draw ops of every asset, in meters, rotation 0, tier 3
and renders docs/art/fixture_catalog.png from those JSON files only (fixture_ops.py), which proves the exported data
is complete. Run from this folder: python3 export_fixtures.py
"""
import json
import os
import fixture_core as fc
from fixture_core import D, C
import fixtures_processing as fp
import fixtures_general as fg
import fixtures_building as fb
import fixtures_zoning as fz
import fixtures_baggage as fbg

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
OUT = os.path.join(ROOT, "src", "data", "fixtures")

ALL = ["public", "commercial", "secure", "international", "staff"]
PAX = ["public", "commercial", "secure", "international"]
AIR = ["secure", "international"]
STAFF = ["staff"]
LAND = ["public"]

CATEGORIES = [
    ("processing", "Processing", "Check in, security, passport control and boarding, three levels and automated"),
    ("zoning", "Zone transitions", "Security exits, staff door and customs"),
    ("baggage", "Baggage", "Ramps, screening, bays and carousels of docs/BAGGAGE.md"),
    ("seating", "Waiting seating", "Benches and seat rows"),
    ("lounge", "Lounge", "Sofas, tables, lamps, bar, buffet"),
    ("washroom", "Washrooms", "Stalls, urinals, basins and accessories"),
    ("decoration", "Decoration", "Plants, water, art and floor inlays"),
    ("vending", "Vending and service machines", "Vending, water, charging, ATM"),
    ("screens", "Screens and signs", "Flight boards, displays and wayfinding"),
    ("service", "Airport service items", "Trolleys, desks, queues, prayer, family, safety"),
    ("office", "Airline offices", "Computers, desks, meeting, pantry and executive"),
    ("circulation", "Circulation", "Escalators, stairs, elevators and travelators"),
    ("backOfHouse", "Back of house", "Janitor room and cleaning kit"),
]

E = []


def add(id_, name, cat, fn, w, h, kw=None, *, family=None, level=None, grid="sub", mount="floor", zones=None,
        gameKey=None, newKey=None, stats=None, confirm=(), ramps=None, sheet=None, gen=None):
    E.append(dict(id=id_, name=name, category=cat, fn=fn, kw=kw or {}, size=[w, h], family=family or id_,
                  level=level, grid=grid, mount=mount, zones=zones or PAX, gameKey=gameKey, newKey=newKey,
                  stats=stats or {}, confirm=list(confirm), ramps=ramps or [], sheet=sheet,
                  generator=gen or f"{fn.__module__}.{fn.__name__}"))


# ---------------- processing -----------------------------------------------------------------------------------
S_PROC = "docs/art/terminal_processing_kit.png"
for lv, t in ((1, 120), (2, 105), (3, 95)):
    add(f"checkIn.l{lv}", f"Check in desk, level {lv}", "processing", fp.checkin, 2, 2,
        dict(level=lv, livery="#c8102e"), family="checkIn", level=lv, grid="cell", zones=LAND, gameKey="checkIn",
        stats=dict(serviceTimeS=t, servers=1, staff=1, acceptsBags=True, premiumClasses=lv == 3),
        confirm=[] if lv == 1 else ["serviceTimeS"], ramps=[dict(cell=[0, -1], dir="out")], sheet=S_PROC)
add("kiosk", "Self check in kiosk", "processing", fp.kiosk_checkin, 2, 2, dict(livery="#1f6fd1"), level=None,
    grid="cell", zones=LAND, gameKey="kiosk", stats=dict(serviceTimeS=75, servers=1, staff=0), sheet=S_PROC)
add("bagDrop", "Self bag drop", "processing", fp.bagdrop_self, 4, 2, dict(livery="#1f6fd1"), grid="cell",
    zones=LAND, gameKey="bagDrop", stats=dict(serviceTimeS=40, servers=1, staffPerUnits=0.25),
    confirm=["staffPerUnits"], ramps=[dict(cell=[0, -1], dir="out")], sheet=S_PROC)
for lv, ph, off in ((1, 300, 4), (2, 360, 5), (3, 450, 4)):
    add(f"security.l{lv}", f"Security lane, level {lv}", "processing", fp.security, 16, 4, dict(level=lv),
        family="security", level=lv, grid="cell", zones=["public", "secure"], gameKey="security",
        stats=dict(throughputPerHour=ph, serviceTimeS=round(3600 / ph, 1), staff=off, remoteScreener=lv == 3,
                   transition=["public", "secure"]),
        confirm=[] if lv == 1 else ["throughputPerHour", "staff"], sheet="docs/art/terminal_security_kit.png")
for lv, t in ((1, 45), (2, 38), (3, 30)):
    add(f"passport.l{lv}", f"Passport control, level {lv}", "processing", fp.passport, 2, 2, dict(level=lv),
        family="passport", level=lv, grid="cell", zones=["secure", "international", "public"], gameKey="passport",
        stats=dict(serviceTimeS=t, servers=1, staff=1, modes=["departure", "arrival"]),
        confirm=[] if lv == 1 else ["serviceTimeS"], sheet=S_PROC)
add("eGate", "Automated passport gate", "processing", fp.egate, 2, 2, grid="cell",
    zones=["secure", "international", "public"], newKey="eGate",
    stats=dict(serviceTimeS=20, officersPerGates=0.2, referralShare=0.08, childrenUnder=12,
               modes=["departure", "arrival"]),
    confirm=["serviceTimeS", "officersPerGates", "referralShare"], sheet=S_PROC)
for lv, t, ag in ((1, 5, 1), (2, 3.5, 2), (3, 3, 2)):
    add(f"gateDesk.l{lv}", f"Boarding gate desk, level {lv}", "processing", fp.gatedesk, 4, 2,
        dict(level=lv, livery="#c8102e"), family="gateDesk", level=lv, grid="cell", zones=AIR, gameKey="gateDesk",
        stats=dict(secondsPerPassenger=t, agents=ag, priorityLane=lv == 3),
        confirm=[] if lv == 1 else ["secondsPerPassenger"], sheet=S_PROC)

# ---------------- zoning ---------------------------------------------------------------------------------------
S_Z = "docs/art/terminal_zones_kit.png"
add("securityExit.staffed", "Security exit, staffed", "zoning", fz.security_exit_staffed, 4, 4, grid="cell",
    zones=["secure", "public"], newKey="securityExit", family="securityExit", level=1,
    stats=dict(throughputPerHour=1200, staff=1, transition=["secure", "public"]), confirm=["throughputPerHour"],
    sheet=S_Z)
add("securityExit.auto", "Automated exit lane", "zoning", fz.security_exit_auto, 2, 6, grid="cell",
    zones=["secure", "public"], newKey="securityExit", family="securityExit", level=2,
    stats=dict(throughputPerHour=900, staff=0, transition=["secure", "public"]), confirm=["throughputPerHour"],
    sheet=S_Z)
add("securityExit.revolving", "Revolving exit door", "zoning", fz.exit_revolving, 2.6, 2.6, grid="cell",
    zones=["secure", "public"], newKey="securityExit", family="securityExit", level=3,
    stats=dict(throughputPerHour=1500, staff=0, transition=["secure", "public"]), confirm=["throughputPerHour"],
    sheet=S_Z)
add("staffDoor", "Staff door with card reader", "zoning", fz.staff_door, 2, 1.2, grid="cell", mount="edge",
    zones=ALL, newKey="staffDoor", stats=dict(wallType="staffDoor", staffOnly=True), sheet=S_Z)
add("customs", "Customs channel", "zoning", fz.customs_channel, 4, 4, grid="cell", zones=LAND, newKey="customs",
    stats=dict(serviceTimeS=8, redChannelShare=0.05, redServiceTimeS=120, staff=2),
    confirm=["serviceTimeS", "redChannelShare", "redServiceTimeS"], sheet=S_Z)

# ---------------- baggage --------------------------------------------------------------------------------------
S_B = "docs/art/baggage_kit.png"
for k, out, flow, conn in (("out", True, "dep", True), ("in", False, "dep", True), ("outArr", True, "arr", True),
                           ("inArr", False, "arr", True), ("unconnected", True, "dep", False)):
    add(f"ramp.{k}", f"Ramp stub, {k}", "baggage", fbg.ramp, 2, 2, dict(out=out, flow=flow, connected=conn),
        family="ramp", grid="cell", zones=ALL, stats=dict(state=k), sheet=S_B)
add("screeningMachine", "Baggage screening machine", "baggage", fbg.screening_machine, 8, 2, dict(with_ramps=True),
    grid="cell", zones=STAFF, newKey="screeningMachine",
    stats=dict(secondsPerBag=10, bufferBags=20, officers=1, room="baggage_screening"),
    confirm=["bufferBags"], ramps=[dict(cell=[0, 0], dir="in"), dict(cell=[3, 0], dir="out")], sheet=S_B)
add("screeningConsole", "Screening console", "baggage", fbg.screening_console, 0.8, 1.2, zones=STAFF, sheet=S_B)
for cells in (2, 4, 6, 8):
    add(f"baggageBay.w{cells}", f"Baggage bay, {cells * 2} m", "baggage", fbg.baggage_bay, cells * 2.0, 8,
        dict(cells=cells, bay_no=1), family="baggageBay", grid="cell", zones=["staff", "secure"],
        newKey="baggageBay",
        stats=dict(slots=cells // 2, bufferBags=200, loadSecondsPerBag=6, stagingLaneM=16),
        confirm=["bufferBags", "loadSecondsPerBag"],
        ramps=[dict(cell=[0, 0], dir="in"), dict(cell=[cells - 1, 0], dir="out")], sheet=S_B)
add("stagingLane", "Bay staging lane", "baggage", fbg.staging_lane, 4, 16, grid="cell", mount="floorLayer",
    zones=["apron"], sheet=S_B)
add("carousel", "Baggage carousel", "baggage", fbg.carousel_with_ramp, 22, 4, grid="cell", zones=LAND,
    newKey="carousel", stats=dict(capacityBags=60), ramps=[dict(cell=[0, 1], dir="in")], sheet=S_B)
for size, loop, bags in (("s", 10, 30), ("l", 30, 90)):
    add(f"carousel.{size}", f"Baggage carousel, {loop} m", "baggage", fbg.carousel_with_ramp, loop + 2.0, 4,
        dict(length=float(loop)), family="carousel", grid="cell", zones=LAND, newKey="carousel",
        stats=dict(capacityBags=bags), ramps=[dict(cell=[0, 1], dir="in")], sheet=S_B)

# ---------------- general --------------------------------------------------------------------------------------
S_F = "docs/art/terminal_furniture_kit.png"
S_A = "docs/art/terminal_amenities_kit.png"
S_O = "docs/art/terminal_office_infra_kit.png"
for id_, name, fn, w, h, kw, st in (
        ("bench.beam3", "Beam seat, 3", fg.bench_beam, 1.93, 0.68, {}, dict(seats=3, comfort=1)),
        ("bench.beam5", "Beam seat, 5", fg.bench_beam, 3.19, 0.68, dict(seats=5), dict(seats=5, comfort=1)),
        ("bench.b2b6", "Back to back, 6", fg.bench_b2b, 1.93, 1.36, {}, dict(seats=6, comfort=1)),
        ("bench.charge4", "Beam seat with charging", fg.bench_charge, 3.14, 0.68, {},
         dict(seats=4, comfort=1, charging=True)),
        ("bench.padded3", "Padded row, 3", fg.bench_padded, 2.11, 0.72, {}, dict(seats=3, comfort=2)),
        ("bench.slat", "Slat bench", fg.bench_wood, 1.9, 0.48, {}, dict(seats=3, comfort=0)),
        ("recliner", "Recliner", fg.recliner, 0.8, 1.86, {}, dict(seats=1, comfort=3, rest=True))):
    add(id_, name, "seating", fn, w, h, kw, stats=st, sheet=S_F, newKey="seat")
for id_, name, fn, w, h, kw in (
        ("sofa3", "Sofa, 3 seat", fg.sofa, 2.2, 0.92, {}), ("sofa2", "Sofa, 2 seat", fg.sofa, 1.6, 0.92,
                                                             dict(seats=2, col=C["teal"])),
        ("armchair", "Armchair", fg.armchair, 0.9, 0.9, {}), ("coffeeTable", "Coffee table", fg.coffee_table, 1.2,
                                                              0.6, {}),
        ("endTableLamp", "End table and lamp", fg.end_table_lamp, 0.5, 0.5, {}),
        ("floorLamp", "Floor lamp", fg.floor_lamp, 0.84, 0.75, {}), ("dining4", "Dining set, 4", fg.dining_set, 2,
                                                                     2, {}),
        ("barStools", "Bar with stools", fg.bar_counter, 3.0, 1.52, {}),
        ("tvCredenza", "TV on credenza", fg.tv_credenza, 2.0, 0.55, {}),
        ("cupboard", "Cupboard", fg.cupboard, 1.6, 0.55, {}), ("magazineShelf", "Magazine shelf", fg.bookshelf, 1.2,
                                                               0.35, {}),
        ("workDesk", "Work desk", fg.work_desk, 1.4, 1.2, {}), ("buffet", "Buffet counter", fg.buffet, 2.4, 0.8, {}),
        ("coffeeStation", "Coffee station", fg.coffee_station, 1.6, 0.6, {}),
        ("rug", "Rug", fg.rug, 2.4, 1.7, {})):
    wall = id_ in ("tvCredenza", "cupboard", "magazineShelf")
    add(f"lounge.{id_}", name, "lounge", fn, w, h, kw, mount="wall" if wall else ("floorLayer" if id_ == "rug"
                                                                                  else "floor"),
        zones=AIR, sheet=S_F, newKey="loungeProp")
for id_, name, fn, w, h, kw, wall, st in (
        ("wcStall", "Toilet stall", fg.wc_stall, 1.0, 1.6, {}, True, dict(capacity=1, serviceTimeS=90)),
        ("wcAccessible", "Accessible toilet", fg.wc_accessible, 2.2, 2.2, {}, True,
         dict(capacity=1, serviceTimeS=150, accessible=True)),
        ("urinals3", "Urinals, 3", fg.urinals, 2.4, 0.5, {}, True, dict(capacity=3, serviceTimeS=45)),
        ("vanity3", "Vanity, 3 basins", fg.vanity, 2.4, 0.6, {}, True, dict(capacity=3)),
        ("vanity2", "Vanity, 2 basins", fg.vanity, 1.6, 0.6, dict(n=2), True, dict(capacity=2)),
        ("sink", "Sink", fg.sink_single, 0.6, 0.48, {}, True, dict(capacity=1)),
        ("handDryer", "Hand dryer", fg.hand_dryer, 0.32, 0.22, {}, True, {}),
        ("towels", "Towels and bin", fg.towel_dispenser, 0.38, 0.62, {}, True, {}),
        ("trash", "Trash can", fg.trash_round, 0.42, 0.42, {}, False, {}),
        ("recycle", "Recycling bins", fg.trash_recycle, 1.2, 0.44, {}, False, {}),
        ("babyChange", "Baby changing", fg.baby_change, 0.9, 0.56, {}, True, {}),
        ("janitorCart", "Janitor cart", fg.janitor_cart, 0.95, 0.55, {}, False, {})):
    add(f"washroom.{id_}", name, "washroom", fn, w, h, kw, mount="wall" if wall else "floor", zones=ALL, stats=st,
        sheet=S_F, newKey="washroomProp", confirm=["serviceTimeS"] if "serviceTimeS" in st and id_ != "wcStall"
        else [])
for id_, name, fn, w, h, kw, layer in (
        ("planterSmall", "Planter, small", fg.planter_small, 0.7, 0.7, {}, False),
        ("planterLarge", "Planter, large", fg.planter_large, 1.6, 1.6, {}, False),
        ("trough", "Planter trough", fg.planter_trough, 2.0, 0.6, {}, False),
        ("bamboo", "Bamboo trough", fg.bamboo, 2.4, 0.5, {}, False),
        ("palm", "Potted palm", fg.palm, 2.0, 2.0, {}, False),
        ("treeBench", "Tree with ring bench", fg.tree_bench, 3.6, 3.6, {}, False),
        ("fountain", "Fountain", fg.fountain, 2.4, 2.4, {}, False),
        ("sculpture", "Sculpture on plinth", fg.sculpture, 1.6, 1.6, {}, False),
        ("medallion", "Floor medallion", fg.medallion, 3.0, 3.0, {}, True),
        ("modelCase", "Aircraft model case", fg.model_case, 2.0, 1.3, {}, False)):
    add(f"decor.{id_}", name, "decoration", fn, w, h, kw, mount="floorLayer" if layer else "floor", zones=PAX,
        stats=dict(ambience=1 if w * h < 2 else 2, seats=16 if id_ == "treeBench" else 0), confirm=["ambience"],
        sheet=S_A, newKey="decor")
for id_, name, kw in (("snack", "Snack vending", dict(body="#3a414b", accent="#d4a23a")),
                      ("drink", "Drink vending", dict(body="#b3262e", accent="#f4f6f8", kind="drink")),
                      ("coffee", "Coffee vending", dict(body="#4a3326", accent="#c9a27a", kind="coffee")),
                      ("fresh", "Fresh food vending", dict(body="#2f6b4f", accent="#e9d27a", kind="fresh")),
                      ("travel", "Travel essentials", dict(body="#2f4a6e", accent="#5fa8d3", kind="travel"))):
    add(f"vending.{id_}", name, "vending", fg.vending, 1.0, 0.86, kw, zones=PAX, sheet=S_A, newKey="vending",
        stats=dict(salesShare=0.15, restockStaff="retail"), confirm=["salesShare"])
add("vending.waterFiller", "Water bottle filler", "vending", fg.water_filler, 0.5, 0.34, mount="wall", zones=PAX,
    sheet=S_A, newKey="vending", stats=dict(thirst=True))
add("vending.chargeTower", "Charging tower", "vending", fg.charge_tower, 0.62, 0.62, zones=PAX, sheet=S_A,
    newKey="vending", stats=dict(charging=True))
add("vending.atmPair", "ATM pair", "vending", fg.atm_pair, 1.9, 0.82, zones=PAX, sheet=S_A, newKey="vending",
    stats=dict(feePerUse=2), confirm=["feePerUse"])
for id_, name, fn, w, h, kw, mount in (
        ("fids3", "Flight board, 3 screens", fg.fids_bank, 2.6, 0.32, {}, "floor"),
        ("fids5", "Flight board, 5 screens", fg.fids_bank, 4.2, 0.32, dict(n=5), "floor"),
        ("infoTotem", "Info totem", fg.info_totem, 0.6, 0.36, {}, "floor"),
        ("wallTv", "Wall TV", fg.wall_tv, 1.4, 0.1, {}, "wall"),
        ("gateDisplay", "Gate display", fg.gate_display, 1.2, 0.32, {}, "floor"),
        ("adTotem", "Digital ad totem", fg.ad_totem, 0.8, 0.42, {}, "floor"),
        ("ledWall", "LED video wall", fg.led_wall, 6.0, 0.4, {}, "floor"),
        ("ceilingFids", "Ceiling flight board", fg.ceiling_fids, 3.0, 0.3, {}, "overhead"),
        ("overheadSign", "Overhead wayfinding", fg.overhead_sign, 3.0, 0.32, {}, "overhead")):
    add(f"screen.{id_}", name, "screens", fn, w, h, kw, mount=mount, zones=PAX, sheet=S_A, newKey="screen",
        stats=dict(wayfinding=id_ in ("fids3", "fids5", "infoTotem", "ceilingFids", "overheadSign",
                                      "gateDisplay"), advertising=id_ in ("adTotem", "ledWall")))
for id_, name, fn, w, h, kw, mount, zones in (
        ("trolley", "Luggage trolley", lambda d: fg.trolley(d), 1.1, 0.6, {}, "floor", PAX),
        ("trolleyBay", "Trolley bay", fg.trolley_bay, 3.4, 1.0, {}, "floor", PAX),
        ("infoDesk", "Information desk", fg.info_desk, 3.0, 2.0, {}, "floor", PAX),
        ("queueKit", "Queue belts", fg.queue_kit, 3.9, 2.4, {}, "floor", PAX),
        ("ropePosts", "Rope posts", fg.rope_posts, 3.1, 0.4, {}, "floor", PAX),
        ("wrapStation", "Bag wrap station", fg.wrap_station, 2.0, 2.0, {}, "floor", LAND),
        ("prayerMats", "Prayer room set", fg.prayer_mats, 3.5, 2.0, {}, "floor", PAX),
        ("wheelchairs", "Wheelchair station", fg.wheelchair_park, 1.9, 0.9, {}, "floor", PAX),
        ("kidsPlay", "Kids play area", fg.kids_play, 3.0, 3.0, {}, "floorLayer", PAX),
        ("smokingPoint", "Smoking point", fg.ashtray_stand, 1.6, 1.6, {}, "floor", PAX),
        ("safetyWall", "Fire cabinet and AED", fg.safety_wall, 1.42, 0.26, {}, "wall", ALL),
        ("helpPoint", "Help point", fg.help_point, 0.4, 0.4, {}, "floor", PAX),
        ("columnRound", "Round column", fg.column_round, 0.9, 0.9, {}, "floor", ALL),
        ("columnAd", "Ad column", fg.column_round, 0.9, 0.9, dict(ad=True), "floor", ALL)):
    add(f"service.{id_}", name, "service", fn, w, h, kw, mount=mount, zones=zones, sheet=S_A, newKey="serviceProp",
        gen="fixtures_general.trolley" if id_ == "trolley" else None)
for id_, name, fn, w, h, kw, mount in (
        ("computerDual", "Computer, dual screen", fb.computer, 1.2, 0.5, {}, "desktop"),
        ("computerSingle", "Computer, single", fb.computer, 1.2, 0.5, dict(dual=False), "desktop"),
        ("workDesk", "Work desk and chair", fb.work_desk_pc, 1.6, 1.4, {}, "floor"),
        ("lDesk", "L desk", fb.l_desk, 1.8, 1.6, {}, "floor"),
        ("deskPod4", "Desk pod for 4", fb.desk_pod, 3.2, 2.8, {}, "floor"),
        ("reception", "Reception desk", fb.reception_desk, 3.0, 1.9, {}, "floor"),
        ("sofa", "Office sofa", fg.sofa, 1.6, 0.92, dict(seats=2, col="#59616d"), "floor"),
        ("cornerSofa", "Corner sofa", fb.office_sofa_l, 2.4, 2.4, {}, "floor"),
        ("meetingTable6", "Meeting table for 6", fb.meeting_table, 2.8, 2.4, {}, "floor"),
        ("roundTable4", "Round table for 4", fb.round_table4, 2.0, 2.0, {}, "floor"),
        ("copier", "Copier", fb.copier, 1.2, 0.7, {}, "floor"),
        ("filing", "Filing cabinets", fb.filing, 1.46, 0.62, {}, "floor"),
        ("whiteboard", "Whiteboard", fb.whiteboard, 1.8, 0.12, {}, "wall"),
        ("pantryCounter", "Pantry counter", fb.pantry_counter, 2.4, 0.65, {}, "wall"),
        ("fridge", "Fridge", fb.fridge, 0.72, 0.7, {}, "wall"),
        ("waterCooler", "Water cooler", fb.water_cooler, 0.36, 0.36, {}, "floor"),
        ("highTable", "Pantry high table", fb.high_table, 1.6, 1.5, {}, "floor"),
        ("execDesk", "Executive desk", fb.exec_desk, 2.0, 2.44, {}, "floor"),
        ("credenza", "Executive credenza", fb.credenza, 2.0, 0.5, {}, "wall"),
        ("modelStand", "Desk model aircraft", fb.model_stand, 0.6, 0.5, {}, "desktop")):
    st = {}
    if id_ in ("workDesk", "lDesk", "reception", "execDesk"):
        st = dict(workplaces=1 if id_ != "reception" else 2)
    if id_ == "deskPod4":
        st = dict(workplaces=4)
    if id_ in ("pantryCounter", "fridge", "waterCooler", "highTable"):
        st = dict(staffNeeds=["hunger", "thirst"])
    add(f"office.{id_}", name, "office", fn, w, h, kw, mount=mount, zones=STAFF, sheet=S_O, newKey="officeProp",
        stats=st)
for id_, name, fn, w, h, kw, st in (
        ("escalator", "Escalator", fb.escalator, 1.65, 13.2, {}, dict(risesM=5, peoplePerHour=3000, links="floor")),
        ("escalatorPair", "Escalator pair", fb.escalator_pair, 3.6, 13.2, {},
         dict(risesM=5, peoplePerHour=6000, links="floor")),
        ("stairsStraight", "Stairs, straight", fb.stairs_straight, 1.8, 10.4, {},
         dict(risesM=5, peoplePerHour=2000, links="floor")),
        ("stairsSwitchback", "Stairs, switchback", fb.stairs_switchback, 3.9, 6.4, {},
         dict(risesM=5, peoplePerHour=2000, links="floor")),
        ("elevator", "Elevator", fb.elevator, 2.6, 2.94, {}, dict(carPeople=13, roundTripS=60, accessible=True,
                                                                     links="floor")),
        ("elevatorGlass", "Glass elevator", fb.elevator, 2.6, 2.94, dict(glass=True),
         dict(carPeople=13, roundTripS=60, accessible=True, links="floor")),
        ("elevatorBank", "Elevator bank", fb.elevator_bank, 5.4, 2.94, {},
         dict(carPeople=13, cars=2, roundTripS=60, accessible=True, links="floor")),
        ("travelator8", "Travelator pair, 8 m", fb.travelator_pair, 3.6, 8.0, dict(L=8.0), dict(speedMps=0.65)),
        ("travelator16", "Travelator pair, 16 m", fb.travelator_pair, 3.6, 16.0, dict(L=16.0), dict(speedMps=0.65)),
        ("travelator24", "Travelator pair, 24 m", fb.travelator_pair, 3.6, 24.0, dict(L=24.0),
         dict(speedMps=0.65))):
    add(f"circulation.{id_}", name, "circulation", fn, w, h, kw, grid="cell", zones=ALL, stats=st,
        confirm=[k for k in ("peoplePerHour", "roundTripS", "speedMps") if k in st], sheet=S_O, newKey=id_
        if not id_.startswith("travelator") else "travelator")
for id_, name, fn, w, h, kw, mount in (
        ("janitorRoom", "Janitor room set", fb.janitor_room, 4.0, 3.0, {}, "floor"),
        ("mopSink", "Mop sink", fb.mop_sink, 0.7, 0.7, {}, "wall"),
        ("supplyShelf", "Supply shelf", fb.supply_shelf, 1.2, 0.45, {}, "wall"),
        ("floorScrubber", "Floor scrubber", fb.floor_scrubber, 1.14, 0.82, {}, "floor"),
        ("mopRack", "Mop rack", fb.mop_rack, 1.0, 0.45, {}, "wall"),
        ("wetFloorSign", "Wet floor sign", fb.wet_floor_sign, 0.5, 0.42, {}, "floor")):
    add(f"boh.{id_}", name, "backOfHouse", fn, w, h, kw, mount=mount, zones=STAFF, sheet=S_O, newKey="bohProp",
        stats=dict(cleanerBase=2) if id_ == "janitorRoom" else {}, confirm=["cleanerBase"] if id_ == "janitorRoom"
        else [])


def _run(e, kw):
    d = D(60.0, 3, 0)
    e["fn"](d, **kw)
    return d.ops


def ops_of(e):
    """Draw ops at rotation 0. For assets with an airline livery the parts in the livery color are marked with
    fLiv or sLiv: the shade factor (fixture_core.shade) to apply to the airline color."""
    ops = _run(e, e["kw"])
    if "livery" not in e["kw"]:
        return ops
    probe = "#3d6e9f"
    other = _run(e, dict(e["kw"], livery=probe))
    assert len(ops) == len(other), e["id"]
    factors = [round(-0.5 + i * 0.01, 2) for i in range(131)]
    for a, b in zip(ops, other):
        for key in ("f", "s"):
            if key in a and a[key] != b.get(key):
                cb = b[key]["c"] if isinstance(b[key], dict) else b[key]
                f = next(x for x in factors if fc.shade(probe, x) == cb)
                a[key + "Liv"] = f
    return ops


def main():
    os.makedirs(os.path.join(OUT, "sprites"), exist_ok=True)
    seen = set()
    catalog = dict(version=1, note=("Terminal asset kit (docs/TERMINAL_FIXTURES.md). Sizes in meters, local frame "
                                    "top left at 0,0 with the side people use at the bottom edge. Sprites are in "
                                    "sprites/<category>.json as vector draw ops. Values listed in confirm are "
                                    "proposals waiting for the owner."),
                   categories=[dict(id=c, name=n, note=t) for c, n, t in CATEGORIES], assets=[])
    packs = {c: dict(version=1, category=c, assets={}) for c, _, _ in CATEGORIES}
    for e in E:
        assert e["id"] not in seen, e["id"]
        seen.add(e["id"])
        ops = ops_of(e)
        packs[e["category"]]["assets"][e["id"]] = dict(size=e["size"], ops=ops)
        catalog["assets"].append({k: e[k] for k in ("id", "name", "category", "family", "level", "size", "grid",
                                                     "mount", "zones", "gameKey", "newKey", "stats", "confirm",
                                                     "ramps", "sheet", "generator")})
    with open(os.path.join(OUT, "catalog.json"), "w") as f:
        json.dump(catalog, f, indent=1, ensure_ascii=False)
        f.write("\n")
    total = 0
    for c, pack in packs.items():
        p = os.path.join(OUT, "sprites", f"{c}.json")
        with open(p, "w") as f:
            json.dump(pack, f, separators=(",", ":"), ensure_ascii=False)
            f.write("\n")
        total += os.path.getsize(p)
    print(f"catalog: {len(E)} assets in {len(CATEGORIES)} categories, sprite packs {total // 1024} KB")


if __name__ == "__main__":
    main()
