"""Sprite geometry for the MVP family representatives. Meters. See air2.py for the coordinate frame.

Published reference values used for sanity checks: length, span, fuselage width, wing area.
"""


def W(x, c, sweep, kink, tip, span_half, te_in=0.0, **kw):
    d = dict(x=x, c=c, sweep=sweep, kink=kink, tip=tip, sb=span_half, te_in=te_in)
    d.update(kw)
    return d


SPECS = {}

SPECS["a320neo"] = dict(
    gear=dict(nose=5.07, wheelbase=12.64, track=7.59), heights=dict(wing=3.0, stab=5.4),
    name="Airbus A320neo", L=37.57, span=35.80, fw=3.95, area=122.6, nose=5.6, nose_n=1.2, nose_m=0.66, tail=10.6, tail_end=0.32,
    wing=W(13.2, 6.1, 27.5, 6.3, 1.55, 17.05, te_in=0, winglet="sharklet", ext=0.85,
           tracks=[3.3, 8.2, 11.0, 13.8]),
    hstab=dict(x=31.7, c=3.7, sweep=32, span=12.45, tip=1.3),
    fin=dict(x0=29.8, x1=37.35, w=0.52, dorsal=28.3),
    engines=[dict(kind="fan", y=5.75, x=11.4, len=5.6, d=2.45, flow="separate", fan_end=0.72)],
    ws=dict(y=1.05, d=0.62, c=0.95, style="airbus"),
    doors=[5.0, 32.4], overwing=[16.3, 17.1], windows=(5.9, 31.6, 0.533), tail_color="#e9ecef",
)

SPECS["b738"] = dict(
    gear=dict(nose=3.9, wheelbase=15.60, track=5.72), heights=dict(wing=2.6, stab=5.6),
    name="Boeing 737-800", L=39.47, span=35.79, fw=3.76, area=124.6, nose=6.2, nose_n=1.15, nose_m=0.58, tail=11.2, tail_end=0.3,
    wing=W(14.3, 6.25, 29.0, 6.0, 1.25, 17.16, winglet="blended", ext=0.73, tracks=[3.2, 7.6, 10.4, 13.1]),
    hstab=dict(x=33.9, c=3.9, sweep=34, span=14.35, tip=1.15),
    fin=dict(x0=30.4, x1=39.3, w=0.48, dorsal=27.6),
    engines=[dict(kind="fan", y=4.9, x=12.3, len=4.9, d=2.05, fair_len=1.4, flow="separate", fan_end=0.62, core_r=0.55)],
    ws=dict(y=1.15, d=0.58, c=1.05, style="b737"),
    doors=[4.4, 36.4], overwing=[17.3, 18.2], windows=(5.2, 35.6, 0.508),
)

SPECS["b789"] = dict(
    gear=dict(nose=4.6, wheelbase=25.60, track=9.80), heights=dict(wing=4.6, stab=8.0),
    name="Boeing 787-9", L=62.81, span=60.12, fw=5.77, area=377.0, nose=9.0, nose_n=1.2, nose_m=0.62, tail=15.0, tail_end=0.42, tail_p=1.5,
    wing=W(22.0, 11.7, 34.5, 9.6, 1.3, 30.06, te_in=-2, rake=4.0, rake_extra=10, kink_round=0.6, tracks=[6.0, 12.0, 16.6, 21.2, 25.4]),
    hstab=dict(x=53.6, c=5.9, sweep=40, span=19.8, tip=1.5),
    fin=dict(x0=54.0, x1=62.6, w=0.78, dorsal=51.0),
    engines=[dict(kind="fan", y=9.8, x=21.6, len=7.6, d=3.6, chevrons=True, fair_len=2.2, flow="separate", fan_end=0.7, core_r=0.45)],
    ws=dict(y=1.25, d=1.0, c=1.55, style="b787"),
    doors=[5.4, 16.0, 37.8, 55.6], windows=(6.2, 55.0, 0.61), win_r=0.15,
)

SPECS["b77w"] = dict(
    gear=dict(nose=4.9, wheelbase=31.22, track=10.97), heights=dict(wing=5.0, stab=8.3),
    name="Boeing 777-300ER", L=73.86, span=64.80, fw=6.19, area=436.8, nose=10.2, nose_n=1.2, nose_m=0.6, tail=15.6, tail_end=0.45, tail_p=1.5,
    wing=W(26.3, 12.7, 34.6, 9.3, 1.1, 32.4, te_in=-4, rake=4.0, rake_extra=10, kink_round=0.5, tracks=[7.2, 13.2, 18.0, 22.8, 27.2]),
    hstab=dict(x=63.1, c=6.8, sweep=46, span=21.51, tip=1.4),
    fin=dict(x0=64.0, x1=73.7, w=0.85, dorsal=61.0),
    engines=[dict(kind="fan", y=9.75, x=24.9, len=8.0, d=4.1, fair_len=2.4, flow="separate", fan_end=0.66, core_r=0.42)],
    ws=dict(y=1.05, d=0.85, c=1.6, style="boeing"),
    doors=[5.6, 18.6, 39.6, 52.6, 66.0], windows=(6.4, 67.0, 0.533), win_r=0.13,
)

SPECS["b744"] = dict(
    gear=dict(nose=4.2, wheelbase=25.60, track=11.00), heights=dict(wing=5.0, stab=8.5),
    name="Boeing 747-400", L=70.66, span=64.44, fw=6.50, area=525.0, nose=9.6, nose_n=1.2, nose_m=0.66, tail=16.2, tail_end=0.45, tail_p=1.45,
    wing=W(24.7, 15.2, 40.0, 12.4, 3.6, 31.2, te_in=2, winglet="canted", ext=1.0, tracks=[8.0, 14.8, 19.0, 23.4, 27.2]),
    hstab=dict(x=60.4, c=7.4, sweep=41, span=22.17, tip=1.9),
    fin=dict(x0=60.6, x1=70.4, w=0.9, dorsal=57.6),
    engines=[dict(kind="fan", y=11.9, x=27.0, len=6.6, d=2.95, fair_len=2.2, flow="separate", fan_end=0.6, core_r=0.5),
             dict(kind="fan", y=21.0, x=34.6, len=6.6, d=2.95, fair_len=2.0, flow="separate", fan_end=0.6, core_r=0.5)],
    ws=dict(y=4.6, d=0.85, c=0.6, wf=0.62, style="boeing"),
    upper=dict(y0=3.6, y1=26.0, w=4.6, win=(8.0, 23.4, 1.95)),
    doors=[6.0, 14.4, 43.6, 57.0], overwing=[31.6], windows=(6.8, 61.6, 0.508), win_r=0.13,
)

SPECS["a333"] = dict(
    gear=dict(nose=4.8, wheelbase=25.58, track=10.69), heights=dict(wing=4.5, stab=7.8),
    name="Airbus A330-300", L=63.66, span=60.30, fw=5.64, area=361.6, nose=8.2, nose_n=1.2, nose_m=0.66, tail=14.8, tail_end=0.42, tail_p=1.5,
    wing=W(22.2, 10.9, 31.5, 9.8, 2.0, 29.6, te_in=-1, winglet="canted", ext=0.55, tracks=[6.0, 12.2, 16.8, 21.2, 25.4]),
    hstab=dict(x=56.0, c=5.8, sweep=35, span=19.4, tip=1.6),
    fin=dict(x0=55.2, x1=63.4, w=0.75, dorsal=52.6),
    engines=[dict(kind="fan", y=9.37, x=22.1, len=6.8, d=3.0, fair_len=2.0, flow="longduct")],
    ws=dict(y=1.55, d=0.9, c=1.35, style="airbus"),
    doors=[5.6, 17.2, 40.6, 57.4], windows=(6.4, 57.8, 0.533), win_r=0.13,
)

SPECS["a346"] = dict(
    gear=dict(nose=4.8, wheelbase=32.89, track=10.69), heights=dict(wing=4.5, stab=7.9),
    name="Airbus A340-600", L=75.36, span=63.45, fw=5.64, area=439.4, nose=8.2, nose_n=1.2, nose_m=0.66, tail=14.8, tail_end=0.42, tail_p=1.5,
    wing=W(28.3, 12.4, 31.5, 10.6, 2.2, 31.2, te_in=-1, winglet="canted", ext=0.52, tracks=[6.4, 13.2, 18.0, 22.8, 27.2]),
    hstab=dict(x=67.0, c=6.2, sweep=35, span=21.5, tip=1.7),
    fin=dict(x0=66.6, x1=75.1, w=0.8, dorsal=64.0),
    engines=[dict(kind="fan", y=10.1, x=28.6, len=6.8, d=3.0, fair_len=2.0, flow="longduct"),
             dict(kind="fan", y=19.6, x=34.6, len=6.8, d=3.0, fair_len=1.8, flow="longduct")],
    ws=dict(y=1.55, d=0.9, c=1.35, style="airbus"),
    doors=[5.6, 20.4, 50.0, 69.0], overwing=[35.4], windows=(6.4, 69.4, 0.533), win_r=0.13,
)

SPECS["a359"] = dict(
    gear=dict(nose=5.0, wheelbase=28.67, track=10.60), heights=dict(wing=4.7, stab=8.2),
    name="Airbus A350-900", L=66.80, span=64.75, fw=5.96, area=442.0, nose=9.3, nose_n=1.2, nose_m=0.63, tail=15.4, tail_end=0.42, tail_p=1.5,
    wing=W(23.9, 13.4, 33.5, 10.8, 1.5, 31.57, te_in=-2, winglet="sharklet", ext=0.8, kink_round=0.6, tracks=[6.4, 13.0, 18.0, 23.0, 27.4]),
    hstab=dict(x=58.3, c=6.0, sweep=38, span=19.06, tip=1.5),
    fin=dict(x0=57.6, x1=66.6, w=0.75, dorsal=54.6),
    engines=[dict(kind="fan", y=10.3, x=23.0, len=7.6, d=3.8, fair_len=2.2, flow="separate", fan_end=0.7, core_r=0.42)],
    ws=dict(y=1.45, d=0.95, c=1.5, style="a350"),
    doors=[5.6, 18.0, 41.4, 59.2], windows=(6.4, 59.6, 0.56), win_r=0.14,
)

SPECS["at76"] = dict(
    gear=dict(nose=2.5, wheelbase=10.77, track=4.10), heights=dict(wing=3.9, stab=7.0),
    name="ATR 72-600", L=27.17, span=27.05, fw=2.865, area=61.0, nose=4.0, nose_n=1.25, nose_m=0.66, tail=9.4, tail_end=0.22, tail_p=1.25,
    wing=W(11.0, 2.57, 2.0, 5.0, 1.41, 13.525, high=True, aileron=0.7),
    hstab=dict(x=24.9, c=1.65, sweep=8, span=7.31, tip=1.0, ttail=True),
    fin=dict(x0=21.2, x1=27.1, w=0.45, dorsal=17.6),
    engines=[dict(kind="prop", y=4.10, x=8.3, len=5.8, d=1.05, prop_d=3.93, blades=6, phase=8)],
    ws=dict(y=0.95, d=0.62, c=0.62, style="atr"),
    sponsons=[(10.4, 15.4, 0.38)],
    doors=[3.9, 23.3], windows=(4.9, 22.4, 0.76), win_r=0.1, door_len=1.1,
)

SPECS["dh8d"] = dict(
    gear=dict(nose=2.6, wheelbase=13.94, track=8.79), heights=dict(wing=4.0, stab=7.6),
    name="Dash 8 Q400", L=32.81, span=28.42, fw=2.69, area=63.1, nose=4.4, nose_n=1.2, nose_m=0.6, tail=10.6, tail_end=0.22, tail_p=1.25,
    wing=W(13.6, 2.95, 2.5, 4.6, 1.25, 14.21, high=True, aileron=0.72),
    hstab=dict(x=29.9, c=1.85, sweep=10, span=7.9, tip=1.1, ttail=True),
    fin=dict(x0=26.2, x1=32.8, w=0.45, dorsal=22.6),
    engines=[dict(kind="prop", y=4.15, x=10.3, len=8.6, d=1.15, prop_d=4.11, blades=6, phase=20)],
    ws=dict(y=1.1, d=0.58, c=0.7, style="q400"),
    doors=[3.0, 28.4], windows=(4.0, 27.8, 0.69), win_r=0.1, door_len=1.0,
)

SPECS["crj9"] = dict(
    gear=dict(nose=2.5, wheelbase=17.32, track=4.10), heights=dict(wing=1.9, stab=6.8),
    name="CRJ900", L=36.19, span=24.85, fw=2.69, area=71.1, nose=4.8, nose_n=1.15, nose_m=0.55, tail=10.4, tail_end=0.3,
    wing=W(16.6, 4.6, 27.0, 4.3, 1.3, 11.87, winglet="canted", ext=0.55, tracks=[2.6, 5.6, 7.8], track_len=0.8, track_w=0.24),
    hstab=dict(x=33.2, c=2.3, sweep=33, span=8.54, tip=1.0, ttail=True),
    fin=dict(x0=29.6, x1=36.0, w=0.42, dorsal=28.0),
    engines=[dict(kind="rear", y=2.45, x=25.3, len=4.1, d=1.45, flow="separate", fan_end=0.62, core_r=0.55)],
    ws=dict(y=1.25, d=0.5, c=0.72, style="crj"),
    doors=[3.2], overwing=[17.4, 18.2], windows=(4.2, 25.0, 0.508), win_r=0.09, door_len=0.85,
)

SPECS["c208"] = dict(
    gear=dict(nose=1.3, wheelbase=3.56, track=3.56), heights=dict(wing=2.4, stab=2.0),
    name="Cessna 208B Grand Caravan EX", L=12.67, span=15.87, fw=1.75, area=25.96, nose=2.4, nose_n=1.6, nose_m=0.62, tail=5.4,
    tail_end=0.16, tail_p=1.1,
    wing=W(3.9, 1.98, 1.5, 2.6, 1.24, 7.935, high=True, aileron=0.68),
    hstab=dict(x=10.8, c=1.35, sweep=8, span=6.25, tip=0.9),
    fin=dict(x0=9.7, x1=12.6, w=0.18, dorsal=8.6),
    nose_prop=dict(d=2.69, blades=3, spinner=0.24, phase=25),
    ws=dict(y=2.05, d=0.55, c=0.3, style="ga"),
    rear_window=(6.0, 6.35), doors=[], windows=(6.9, 8.4, 0.75), win_r=0.1,
)

SPECS["b360"] = dict(
    gear=dict(nose=1.6, wheelbase=4.56, track=5.23), heights=dict(wing=1.2, stab=3.8),
    name="King Air 360", L=14.22, span=17.65, fw=1.6, area=28.8, nose=3.0, nose_n=1.3, nose_m=0.6, tail=6.2, tail_end=0.2,
    wing=W(5.3, 2.3, 4.0, 3.0, 0.9, 8.6, winglet="canted", ext=0.22, aileron=0.7),
    hstab=dict(x=12.7, c=1.25, sweep=12, span=5.6, tip=0.75, ttail=True),
    fin=dict(x0=11.1, x1=14.2, w=0.2, dorsal=9.8),
    engines=[dict(kind="prop", y=2.55, x=3.4, len=4.7, d=0.85, prop_d=2.67, blades=4, phase=30, stage="over")],
    ws=dict(y=2.15, d=0.6, c=0.42, style="kingair"),
    doors=[9.6], windows=(4.4, 8.8, 0.62), win_r=0.11, door_len=0.7,
)

SPECS["c172"] = dict(
    gear=dict(nose=0.9, wheelbase=1.65, track=2.54), heights=dict(wing=2.0, stab=1.3),
    name="Cessna 172S Skyhawk", L=8.28, span=11.00, fw=1.12, area=16.2, nose=1.5, nose_n=1.6, nose_m=0.62, tail=4.6,
    tail_end=0.11, tail_p=1.05,
    wing=W(2.05, 1.63, 0.0, 2.5, 1.13, 5.5, high=True, aileron=0.66),
    hstab=dict(x=6.95, c=1.2, sweep=6, span=3.45, tip=0.75),
    fin=dict(x0=6.4, x1=8.28, w=0.12, dorsal=5.4),
    nose_prop=dict(d=1.93, blades=2, spinner=0.15, phase=5),
    ws=dict(y=1.35, d=0.6, c=0.25, style="ga"),
    rear_window=(3.75, 4.25), doors=[], windows=None,
)

ORDER = ["b744", "a346", "b77w", "a359", "a333", "b789", "b738", "a320neo", "crj9", "dh8d", "at76", "b360", "c208", "c172"]
