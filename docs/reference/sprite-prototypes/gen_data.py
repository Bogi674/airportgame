"""Single source for MVP aircraft data. Writes src/data JSON and the markdown tables for the docs."""
import json, math, copy
from specs2 import SPECS

# columns: id, name, family, role, icao, L, span, height, fw, wheelbase, track,
#          mtow, mlw, oew, payload(freighter only or None), seats typical, seats max,
#          engine count, engine type, engine model, thrust kN or power kW,
#          range km, cruise km/h, ceiling m, TOFL m, LDL m, Vref kt, generation, sprite base, sprite variant
ROWS = [
 # Boeing 737
 ("b737_700", "Boeing 737-700", "b737ng", "narrowbody", "B737", 33.63, 35.79, 12.57, 3.76, 12.60, 5.72, 70080, 58604, 38147, None, 126, 149, 2, "turbofan", "CFM56-7B24", 107, 6370, 842, 12500, 1900, 1415, 130, "mature", "b738", dict(plugFwd=-3.05, plugAft=-2.79)),
 ("b737_800", "Boeing 737-800", "b737ng", "narrowbody", "B738", 39.47, 35.79, 12.55, 3.76, 15.60, 5.72, 79010, 66361, 41413, None, 162, 189, 2, "turbofan", "CFM56-7B27", 121, 5436, 842, 12500, 2316, 1634, 146, "mature", "b738", {}),
 ("b737_900er", "Boeing 737-900ER", "b737ng", "narrowbody", "B739", 42.11, 35.79, 12.55, 3.76, 17.17, 5.72, 85139, 71350, 44676, None, 178, 220, 2, "turbofan", "CFM56-7B27", 121, 5460, 842, 12500, 2500, 1800, 150, "mature", "b738", dict(plugFwd=1.57, plugAft=1.07)),
 ("b737_max8", "Boeing 737 MAX 8", "b737max", "narrowbody", "B38M", 39.52, 35.92, 12.29, 3.76, 15.60, 5.72, 82191, 69309, 45070, None, 172, 210, 2, "turbofan", "CFM LEAP-1B27", 124, 6570, 839, 12500, 2500, 1600, 145, "modern", "b738",
  dict(plugFwd=0.05, winglet="split", ext=0.79, engine=dict(len=5.0, d=2.2, chevrons=True, fan_end=0.66))),
 ("b737_max9", "Boeing 737 MAX 9", "b737max", "narrowbody", "B39M", 42.16, 35.92, 12.29, 3.76, 17.17, 5.72, 88314, 74344, 50300, None, 193, 220, 2, "turbofan", "CFM LEAP-1B28", 130, 6110, 839, 12500, 2700, 1700, 150, "modern", "b738",
  dict(plugFwd=1.62, plugAft=1.07, winglet="split", ext=0.79, engine=dict(len=5.0, d=2.2, chevrons=True, fan_end=0.66))),
 # Airbus A320 family
 ("a319ceo", "Airbus A319ceo", "a320ceo", "narrowbody", "A319", 33.84, 34.10, 11.76, 3.95, 11.04, 7.59, 75500, 62500, 40800, None, 124, 156, 2, "turbofan", "CFM56-5B6", 105, 6850, 828, 11900, 1950, 1470, 130, "mature", "a320neo",
  dict(plugFwd=-2.13, plugAft=-1.60, span=34.10, winglet="fence", ext=0.0, engine=dict(len=4.6, d=2.1, fan_end=0.62))),
 ("a320ceo", "Airbus A320ceo", "a320ceo", "narrowbody", "A320", 37.57, 34.10, 11.76, 3.95, 12.64, 7.59, 78000, 66000, 42600, None, 150, 180, 2, "turbofan", "CFM56-5B4", 120, 6150, 828, 11900, 2100, 1500, 136, "mature", "a320neo",
  dict(span=34.10, winglet="fence", ext=0.0, engine=dict(len=4.6, d=2.1, fan_end=0.62))),
 ("a321ceo", "Airbus A321ceo", "a320ceo", "narrowbody", "A321", 44.51, 34.10, 11.76, 3.95, 16.91, 7.59, 93500, 77800, 48500, None, 185, 220, 2, "turbofan", "CFM56-5B3", 147, 5950, 828, 11900, 2500, 1600, 142, "mature", "a320neo",
  dict(plugFwd=4.27, plugAft=2.67, span=34.10, winglet="fence", ext=0.0, engine=dict(len=4.7, d=2.15, fan_end=0.62))),
 ("a320neo", "Airbus A320neo", "a320neo", "narrowbody", "A20N", 37.57, 35.80, 11.76, 3.95, 12.64, 7.59, 79000, 67400, 44300, None, 165, 194, 2, "turbofan", "CFM LEAP-1A26 or PW1127G", 121, 6300, 828, 11900, 1950, 1500, 136, "modern", "a320neo", {}),
 ("a321neo", "Airbus A321neo", "a320neo", "narrowbody", "A21N", 44.51, 35.80, 11.76, 3.95, 16.91, 7.59, 97000, 79200, 50100, None, 206, 244, 2, "turbofan", "CFM LEAP-1A32 or PW1133G", 143, 7400, 828, 11900, 2200, 1600, 140, "modern", "a320neo", dict(plugFwd=4.27, plugAft=2.67)),
 # Boeing 747
 ("b747_400", "Boeing 747-400", "b747", "widebody", "B744", 70.66, 64.44, 19.41, 6.50, 25.60, 11.00, 396890, 285764, 178756, None, 416, 660, 4, "turbofan", "CF6-80C2B5F or PW4062 or RB211-524H", 270, 13450, 913, 13700, 3300, 2130, 157, "classic", "b744", {}),
 ("b747_400f", "Boeing 747-400F", "b747", "freighter", "B744", 70.66, 64.44, 19.41, 6.50, 25.60, 11.00, 396890, 302093, 164382, 112630, 0, 0, 4, "turbofan", "CF6-80C2B5F", 270, 8230, 913, 13700, 3300, 2130, 157, "classic", "b744", dict(upperEnd=14.5, windows=False)),
 ("b747_8i", "Boeing 747-8 Intercontinental", "b747", "widebody", "B748", 76.25, 68.45, 19.35, 6.50, 29.67, 11.00, 447700, 312072, 220128, None, 410, 605, 4, "turbofan", "GEnx-2B67", 296, 14320, 913, 13100, 3100, 2200, 158, "mature", "b744",
  dict(plugFwd=3.6, plugAft=1.99, winglet="none", rake=5.5, span=68.45, upperEnd=30.1, engine=dict(len=7.0, d=3.3, chevrons=True, fan_end=0.66))),
 ("b747_8f", "Boeing 747-8F", "b747", "freighter", "B748", 76.25, 68.45, 19.35, 6.50, 29.67, 11.00, 447700, 346090, 197131, 137750, 0, 0, 4, "turbofan", "GEnx-2B67", 296, 7630, 913, 13100, 3100, 2200, 158, "mature", "b744",
  dict(plugFwd=3.6, plugAft=1.99, winglet="none", rake=5.5, span=68.45, upperEnd=18.0, windows=False, engine=dict(len=7.0, d=3.3, chevrons=True, fan_end=0.66))),
 # Boeing 777
 ("b777_200er", "Boeing 777-200ER", "b777", "widebody", "B772", 63.73, 60.93, 18.52, 6.19, 25.88, 10.97, 297550, 213180, 138100, None, 313, 440, 2, "turbofan", "GE90-94B or PW4090 or Trent 895", 417, 13080, 905, 13100, 3380, 1770, 140, "mature", "b77w",
  dict(plugFwd=-5.33, plugAft=-4.80, rake=0, span=60.93, engine=dict(d=3.9, len=7.6))),
 ("b777_300er", "Boeing 777-300ER", "b777", "widebody", "B77W", 73.86, 64.80, 18.51, 6.19, 31.22, 10.97, 351535, 251290, 167829, None, 396, 550, 2, "turbofan", "GE90-115B", 513, 13650, 905, 13100, 3050, 1960, 149, "mature", "b77w", {}),
 ("b777f", "Boeing 777F", "b777", "freighter", "B77L", 63.73, 64.80, 18.60, 6.19, 25.88, 10.97, 347815, 260816, 144379, 102010, 0, 0, 2, "turbofan", "GE90-110B1", 489, 9200, 905, 13100, 3200, 1900, 147, "mature", "b77w",
  dict(plugFwd=-5.33, plugAft=-4.80, windows=False)),
 # Boeing 787
 ("b787_8", "Boeing 787-8", "b787", "widebody", "B788", 56.72, 60.12, 16.92, 5.77, 22.78, 9.80, 227930, 172365, 119950, None, 248, 381, 2, "turbofan", "GEnx-1B70 or Trent 1000", 285, 13530, 903, 13100, 2600, 1700, 140, "modern", "b789", dict(plugFwd=-3.05, plugAft=-3.04)),
 ("b787_9", "Boeing 787-9", "b787", "widebody", "B789", 62.81, 60.12, 17.02, 5.77, 25.60, 9.80, 254011, 192777, 128850, None, 296, 420, 2, "turbofan", "GEnx-1B74 or Trent 1000-TEN", 320, 14010, 903, 13100, 2800, 1800, 144, "modern", "b789", {}),
 ("b787_10", "Boeing 787-10", "b787", "widebody", "B78X", 68.28, 60.12, 17.02, 5.77, 28.12, 9.80, 254011, 201849, 135500, None, 336, 440, 2, "turbofan", "GEnx-1B76 or Trent 1000-TEN", 338, 11910, 903, 13100, 2900, 1900, 148, "modern", "b789", dict(plugFwd=3.05, plugAft=2.42)),
 # Airbus A330
 ("a330_200", "Airbus A330-200", "a330ceo", "widebody", "A332", 58.82, 60.30, 17.39, 5.64, 22.18, 10.69, 242000, 182000, 120600, None, 247, 406, 2, "turbofan", "Trent 772B or CF6-80E1 or PW4168", 316, 13450, 871, 12500, 2500, 1750, 137, "mature", "a333", dict(plugFwd=-2.13, plugAft=-2.71)),
 ("a330_300", "Airbus A330-300", "a330ceo", "widebody", "A333", 63.66, 60.30, 16.79, 5.64, 25.58, 10.69, 242000, 187000, 129400, None, 277, 440, 2, "turbofan", "Trent 772B or CF6-80E1 or PW4168", 316, 11750, 871, 12500, 2770, 1850, 140, "mature", "a333", {}),
 ("a330_900", "Airbus A330-900", "a330neo", "widebody", "A339", 63.66, 64.00, 16.79, 5.64, 25.58, 10.69, 251000, 191000, 135000, None, 287, 460, 2, "turbofan", "Trent 7000-72", 324, 13330, 871, 12500, 2600, 1800, 140, "modern", "a333",
  dict(winglet="sharklet", ext=1.2, span=64.0, engine=dict(flow="separate", d=3.5, len=7.2, fan_end=0.7))),
 ("a330_200f", "Airbus A330-200F", "a330ceo", "freighter", "A332", 58.82, 60.30, 16.90, 5.64, 22.18, 10.69, 233000, 187000, 109000, 70000, 0, 0, 2, "turbofan", "Trent 772B or PW4170", 316, 7400, 871, 12500, 2600, 1800, 140, "mature", "a333",
  dict(plugFwd=-2.13, plugAft=-2.71, windows=False)),
 # Airbus A340
 ("a340_300", "Airbus A340-300", "a340", "widebody", "A343", 63.69, 60.30, 16.85, 5.64, 25.37, 10.69, 276500, 192000, 129800, None, 277, 440, 4, "turbofan", "CFM56-5C4", 151, 13700, 871, 12500, 3000, 1900, 140, "mature", "a346",
  dict(plugFwd=-6.40, plugAft=-5.27, span=60.30, wing=dict(c=10.9, sb=29.6, kink=9.8), engine=dict(d=2.4, len=5.8))),
 ("a340_600", "Airbus A340-600", "a340", "widebody", "A346", 75.36, 63.45, 17.22, 5.64, 32.89, 10.69, 380000, 265000, 177000, None, 326, 475, 4, "turbofan", "Trent 556", 249, 14450, 871, 12500, 3200, 2050, 150, "mature", "a346", {}),
 # Airbus A350
 ("a350_900", "Airbus A350-900", "a350", "widebody", "A359", 66.80, 64.75, 17.05, 5.96, 28.67, 10.60, 283000, 207000, 142400, None, 315, 440, 2, "turbofan", "Trent XWB-84", 374, 15000, 903, 13100, 2600, 1850, 140, "modern", "a359", {}),
 ("a350_1000", "Airbus A350-1000", "a350", "widebody", "A35K", 73.79, 64.75, 17.08, 5.96, 32.48, 10.73, 319000, 236000, 155000, None, 369, 480, 2, "turbofan", "Trent XWB-97", 431, 16100, 903, 13100, 2800, 2000, 145, "modern", "a359",
  dict(plugFwd=4.20, plugAft=2.79, engine=dict(d=3.9))),
 # ATR
 ("atr42_600", "ATR 42-600", "atr", "regionalTurboprop", "AT46", 22.67, 24.57, 7.59, 2.865, 8.78, 4.10, 18600, 18300, 11550, None, 48, 50, 2, "turboprop", "PW127M", 1790, 1326, 556, 7620, 1165, 1126, 104, "mature", "at76",
  dict(plugFwd=-2.0, plugAft=-2.5, span=24.57)),
 ("atr72_600", "ATR 72-600", "atr", "regionalTurboprop", "AT76", 27.17, 27.05, 7.65, 2.865, 10.77, 4.10, 23000, 22350, 13600, None, 70, 78, 2, "turboprop", "PW127M", 2051, 1528, 510, 7620, 1367, 1067, 113, "mature", "at76", {}),
 # Bombardier and De Havilland Canada
 ("crj200", "Bombardier CRJ200", "crj", "regionalJet", "CRJ2", 26.77, 21.21, 6.22, 2.69, 11.39, 3.18, 24040, 21319, 13835, None, 50, 50, 2, "turbofan", "CF34-3B1", 41, 3045, 786, 12500, 1920, 1480, 140, "classic", "crj9",
  dict(plugFwd=-5.0, plugAft=-4.42, span=21.21, wing=dict(c=3.9, kink=3.8, tip=1.1), engine=dict(d=1.25, len=3.6))),
 ("crj700", "Bombardier CRJ700", "crj", "regionalJet", "CRJ7", 32.51, 23.24, 7.57, 2.69, 14.60, 4.10, 34019, 30390, 20069, None, 70, 78, 2, "turbofan", "CF34-8C5B1", 61, 2553, 828, 12500, 1605, 1515, 140, "mature", "crj9", dict(plugFwd=-2.0, plugAft=-1.68, span=23.24)),
 ("crj900", "Bombardier CRJ900", "crj", "regionalJet", "CRJ9", 36.19, 24.85, 7.51, 2.69, 17.32, 4.10, 38330, 33339, 21845, None, 76, 90, 2, "turbofan", "CF34-8C5", 64, 2956, 828, 12500, 1778, 1596, 140, "mature", "crj9", {}),
 ("crj1000", "Bombardier CRJ1000", "crj", "regionalJet", "CRJX", 39.13, 26.18, 7.51, 2.69, 19.00, 4.10, 41640, 36968, 23188, None, 100, 104, 2, "turbofan", "CF34-8C5A1", 61, 3004, 828, 12500, 2120, 1750, 145, "mature", "crj9", dict(plugFwd=1.6, plugAft=1.34, span=26.18)),
 ("dash8_q400", "De Havilland Canada Dash 8-400", "dash8", "regionalTurboprop", "DH8D", 32.81, 28.42, 8.34, 2.69, 13.94, 8.79, 29574, 28123, 17819, None, 78, 90, 2, "turboprop", "PW150A", 3781, 2040, 667, 8230, 1425, 1295, 120, "mature", "dh8d", {}),
 # Cessna
 ("c172s", "Cessna 172S Skyhawk", "cessnaLight", "ga", "C172", 8.28, 11.00, 2.72, 1.12, 1.65, 2.54, 1157, 1157, 767, None, 3, 3, 1, "piston", "Lycoming IO-360-L2A", 134, 1185, 226, 4270, 497, 407, 62, "mature", "c172", {}),
 ("c208b", "Cessna 208B Grand Caravan EX", "cessnaLight", "commuter", "C208", 12.67, 15.87, 4.53, 1.75, 3.56, 3.56, 3995, 3856, 2326, None, 9, 13, 1, "turboprop", "PT6A-140", 647, 1689, 344, 7620, 734, 518, 78, "modern", "c208", {}),
 ("citation_cj4", "Cessna Citation CJ4 Gen2", "citation", "businessJet", "C25C", 16.26, 15.49, 4.67, 1.6, 6.40, 3.40, 7761, 7103, 4980, None, 8, 10, 2, "turbofan", "Williams FJ44-4A", 16.1, 4010, 835, 13716, 1036, 905, 115, "modern", "cj4", {}),
 ("citation_latitude", "Cessna Citation Latitude", "citation", "businessJet", "C68A", 18.97, 22.05, 6.38, 2.1, 8.10, 3.80, 14061, 12746, 9525, None, 9, 9, 2, "turbofan", "PW306D1", 25.7, 5000, 826, 13716, 1091, 768, 110, "modern", "latitude", {}),
 # Beechcraft King Air
 ("kingair_c90gtx", "Beechcraft King Air C90GTx", "kingAir", "ga", "BE9L", 10.82, 16.10, 4.34, 1.6, 3.73, 3.89, 4756, 4513, 3130, None, 5, 7, 2, "turboprop", "PT6A-135A", 410, 2446, 500, 9144, 840, 650, 100, "mature", "b360",
  dict(plugFwd=-1.6, plugAft=-1.8, span=16.10, ttail=False, engine=dict(blades=4, prop_d=2.29))),
 ("kingair_260", "Beechcraft King Air 260", "kingAir", "ga", "BE20", 13.36, 16.61, 4.37, 1.6, 4.56, 5.23, 5670, 5670, 3840, None, 7, 9, 2, "turboprop", "PT6A-52", 634, 3185, 578, 10668, 1021, 870, 103, "modern", "b360",
  dict(plugFwd=-0.86, span=16.61, winglet="none")),
 ("kingair_360", "Beechcraft King Air 360", "kingAir", "ga", "BE30", 14.22, 17.65, 4.37, 1.6, 4.56, 5.23, 6804, 6577, 4445, None, 9, 11, 2, "turboprop", "PT6A-60A", 783, 3345, 576, 10668, 1006, 820, 105, "modern", "b360", {}),
]

UNPAVED = {"c172s": ["dirt", "gravel", "grass"], "c208b": ["dirt", "gravel", "grass"], "kingair_c90gtx": ["gravel", "grass"],
           "kingair_260": ["gravel", "grass"], "kingair_360": ["gravel", "grass"], "atr42_600": ["gravel"], "atr72_600": ["gravel"]}

# geometry for the two business jets that are not in the render sheets yet (dimension checked, not photo calibrated)
EXTRA_SPRITES = {
    "cj4": dict(name="Cessna Citation CJ4", L=16.26, span=15.49, fw=1.6, area=30.7, nose=3.4, nose_n=1.2, nose_m=0.58, tail=5.6, tail_end=0.2,
                wing=dict(x=6.7, c=2.6, sweep=12.5, kink=2.2, tip=1.0, sb=7.745, te_in=0, aileron=0.7),
                hstab=dict(x=14.4, c=1.2, sweep=25, span=6.3, tip=0.7), fin=dict(x0=12.6, x1=16.2, w=0.22, dorsal=11.2),
                engines=[dict(kind="rear", y=1.55, x=10.6, len=2.3, d=0.85, flow="separate", fan_end=0.66)],
                ws=dict(y=1.75, d=0.55, c=0.5, style="crj"), doors=[3.6], windows=(4.6, 8.8, 0.62), win_r=0.11),
    "latitude": dict(name="Cessna Citation Latitude", L=18.97, span=22.05, fw=2.1, area=50.4, nose=4.0, nose_n=1.2, nose_m=0.58, tail=6.6, tail_end=0.22,
                     wing=dict(x=7.9, c=3.3, sweep=17, kink=3.0, tip=1.1, sb=11.025, te_in=0, aileron=0.7),
                     hstab=dict(x=16.9, c=1.5, sweep=28, span=7.6, tip=0.8, ttail=True), fin=dict(x0=14.4, x1=18.9, w=0.26, dorsal=13.0),
                     engines=[dict(kind="rear", y=1.95, x=12.3, len=2.8, d=1.05, flow="separate", fan_end=0.66)],
                     ws=dict(y=1.9, d=0.6, c=0.55, style="crj"), doors=[3.8], windows=(5.0, 10.6, 0.7), win_r=0.12),
}

MVP1 = {"c172s", "c208b", "kingair_360", "atr72_600", "dash8_q400", "crj900", "a320neo", "b737_800", "b787_9", "b777_300er"}

CALIBRATION = {"b77w": "photo calibrated", "b789": "dimension checked", "b738": "dimension checked", "a320neo": "dimension checked"}


def derived(r):
    span, mtow, vref = r[6], r[11], r[26]
    code = "A" if span < 15 else "B" if span < 24 else "C" if span < 36 else "D" if span < 52 else "E" if span < 65 else "F"
    wake = "L" if mtow <= 7000 else "M" if mtow <= 136000 else "H"
    appr = "A" if vref < 91 else "B" if vref < 121 else "C" if vref < 141 else "D" if vref < 166 else "E"
    return code, wake, appr


def record(r):
    (id_, name, fam, role, icao, L, span, h, fw, wb, tr, mtow, mlw, oew, pay, st, sm, ec, et, em, power,
     rng, crz, ceil, tofl, ldl, vref, gen, sbase, svar) = r
    code, wake, appr = derived(r)
    rec = dict(id=id_, name=name, family=fam, phase=1, release="mvp1" if id_ in MVP1 else "mvp2", role=role, icaoType=icao, generation=gen,
               dimensions=dict(lengthM=L, wingspanM=span, heightM=h, fuselageWidthM=fw, wheelbaseM=wb, mainGearTrackM=tr),
               weights=dict(mtowKg=mtow, mlwKg=mlw, oewKg=oew),
               capacity=dict(seatsTypical=st, seatsMax=sm),
               engines=dict(count=ec, type=et, model=em, **({"powerKW": power} if et in ("turboprop", "piston") else {"thrustKN": power})),
               performance=dict(rangeKm=rng, cruiseKmh=crz, ceilingM=ceil, takeoffFieldM=tofl, landingFieldM=ldl, vrefKt=vref),
               surfaces=["asphalt", "concrete"] + UNPAVED.get(id_, []),
               sprite=dict(base=sbase, calibration=CALIBRATION.get(sbase, "needs photo calibration"), **svar),
               derivedForReading=dict(code=code, wake=wake, approachCategory=appr))
    if pay:
        rec["capacity"]["maxPayloadKg"] = pay
    return rec


def main(out_json, out_md):
    recs = [record(r) for r in ROWS]
    sprites = {k: v for k, v in copy.deepcopy(SPECS).items()}
    sprites.update(EXTRA_SPRITES)
    for k, v in sprites.items():
        v.pop("area", None)
        v.pop("_fin", None)
        for kk, vv in list(v.items()):
            if isinstance(vv, tuple):
                v[kk] = list(vv)
    doc = dict(version=1, units="SI, meters, kilograms, kilonewtons, kilowatts, km/h, knots",
               note="Rounded public manufacturer figures. Sprite geometry is in meters, nose at y = 0, x positive to the right wing.",
               aircraft=recs, spriteBases=sprites)
    json.dump(doc, open(out_json, "w"), indent=1)
    # markdown tables
    md = []
    md.append("| Model | ICAO | Code | Wake | Appr | Length m | Span m | Height m | Fus. width m | Wheelbase m | Track m |")
    md.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for r in ROWS:
        c, w, a = derived(r)
        md.append(f"| {r[1]} | {r[4]} | {c} | {w} | {a} | {r[5]:.2f} | {r[6]:.2f} | {r[7]:.2f} | {r[8]:.2f} | {r[9]:.2f} | {r[10]:.2f} |")
    t1 = "\n".join(md)
    md = []
    md.append("| Model | MTOW kg | MLW kg | OEW kg | Seats typ / max | Payload kg | Engines | Thrust or power each | Range km | Cruise km/h | TOFL m | LDL m | Vref kt |")
    md.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for r in ROWS:
        pw = f"{r[20]:g} kW" if r[18] in ("turboprop", "piston") else f"{r[20]:g} kN"
        seats = "freighter" if r[15] == 0 else f"{r[15]} / {r[16]}"
        pay = f"{r[14]:,}" if r[14] else "derived"
        md.append(f"| {r[1]} | {r[11]:,} | {r[12]:,} | {r[13]:,} | {seats} | {pay} | {r[17]} x {r[19]} | {pw} | {r[21]:,} | {r[22]} | {r[24]:,} | {r[25]:,} | {r[26]} |")
    t2 = "\n".join(md)
    open(out_md, "w").write(t1 + "\n\nSPLIT\n\n" + t2 + "\n")
    print(len(recs), "records")


if __name__ == "__main__":
    main("/home/claude/docs/aircraft.mvp.json", "/tmp/claude-0/-home-claude/aff872f7-ae21-5a30-819d-b3ed12584421/scratchpad/mvp_tables.md")
