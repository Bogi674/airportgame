# AIRCRAFT_DATABASE.md

The aircraft roster, its data schema, its sprite geometry and the order in which models enter the game. The roster has 118 models split into five content phases. MVP 1 ships 10 of the Phase 1 models, MVP 2 and Release 1.0 ship all 42 Phase 1 models, and content updates add Phases 2 to 5 (see `docs/ROADMAP.md`). Any airline may fly any released model its scope and rating allow, see `docs/AIRLINES.md`.

The Phase 1 data ships as `src/data/aircraft/aircraft.mvp.json` (a copy is delivered next to these docs as `aircraft.mvp.json`). It is validated by a zod schema. Figures are rounded public manufacturer values. They are realistic on purpose because they drive gate fit, runway length, pavement load, payload and range.

## 1. Content phases

| Phase | Name | Ships with | Models | Content |
| --- | --- | --- | --- | --- |
| 1 | Core fleet | MVP 1 (10 models), MVP 2 (all 42) | 42 | Boeing 737NG and MAX, 747, 777, 787. Airbus A320ceo and neo, A330, A340, A350. ATR 42 and 72. Bombardier CRJ200 to CRJ1000 and Dash 8-400. Cessna 172, 208, Citation CJ4 and Latitude. King Air C90GTx, 260 and 360 |
| 2 | Mainline expansion | content update | 30 | A220, E-Jets and E2, A380, 757, 767, 777-200 and 200LR, 777X, A321XLR, A330-800, A340-500, A318, A319neo, converted freighters |
| 3 | Regional, GA and business depth | content update | 27 | Commuters (Twin Otter, Islander, PC-12, L-410), older regional props and jets, C919, MC-21, business jets |
| 4 | Classics and heavy cargo | content update | 18 | 737 Classic, MD-80, 727, 717, A300, A310, DC-10, MD-11, 747-200, Il-76, An-124 |
| 5 | Sandbox historic | content update | 1 | Concorde |

A model may enter the game only when it meets the definition of ready in section 6.

MVP 1 uses these 10 Phase 1 models, marked `"release": "mvp1"` in the data file (the other 32 are `"mvp2"`): Cessna 172S, Cessna 208B Grand Caravan EX, King Air 360, ATR 72-600, Dash 8-400, CRJ900, Airbus A320neo, Boeing 737-800, Boeing 787-9, Boeing 777-300ER. The loader filters by release. Phase lists live in `src/data/aircraft/phases.json`. A save records which phases were active, so older saves keep their fleets.

## 2. Schema

```
id                 slug, for example "a320neo"
name, family, phase, role, icaoType, generation
dimensions         lengthM, wingspanM, heightM, fuselageWidthM, wheelbaseM, mainGearTrackM
weights            mtowKg, mlwKg, oewKg
capacity           seatsTypical, seatsMax, maxPayloadKg (freighters, optional for others)
engines            count, type (piston | turboprop | turbofan), model, thrustKN or powerKW per engine
performance        rangeKm, cruiseKmh, ceilingM, takeoffFieldM, landingFieldM, vrefKt
surfaces           list of surfaces the type may use: asphalt, concrete, gravel, grass, dirt
sprite             base sprite key plus variant changes, see section 5
foldedSpanM        optional, folding wingtip types only
release            mvp1 or mvp2 for Phase 1 models
sandboxOnly        optional boolean
```

`takeoffFieldM` is the field length at MTOW, sea level, 15 C, dry. `landingFieldM` is at MLW. `rangeKm` is at typical seats, or at max payload for freighters.

Derived values, never typed by hand (the JSON carries a `derivedForReading` block that a schema test compares against):

* `code`: from wingspan. A under 15 m, B 15 to under 24, C 24 to under 36, D 36 to under 52, E 52 to under 65, F 65 to under 80. `foldedSpanM` gives code E on stands and taxiways where folding is allowed.
* `wake`: from MTOW. L is 7 t or less, M is up to 136 t, H is above, J is the A380.
* `approachCategory`: from Vref. A under 91 kt, B 91 to 120, C 121 to 140, D 141 to 165, E above.
* `maxPayloadKg` when not given: `min(seatsMax * 100, (mtowKg - oewKg) * 0.45)`.
* `acr`: game pavement load number, see `docs/GAME_DESIGN.md` section 6, Surfaces and pavement.

Generation meaning: `classic` first flew before 2000. `mature` designed 2000 to 2015. `modern` re-engined or clean sheet types from 2010 onward.

## Role defaults

Used when a model does not override them. Values are starting points.

| Role | Turnaround min | Fuel burn kg per km | Typical ground equipment |
| --- | --- | --- | --- |
| ga | 15 | 0.1 to 0.2 | fuel truck |
| commuter | 20 | 0.3 to 0.5 | fuel truck, baggage cart, steps |
| regionalTurboprop | 30 | 1.0 to 1.6 | tug optional, baggage tractor, fuel, catering, steps |
| regionalJet | 35 | 2.0 to 3.0 | tug, baggage tractor, fuel, catering, ground power |
| narrowbody | 45 | 2.5 to 3.5 | tug, tractors, fuel, catering, water, lavatory, ground power, bridge or steps |
| widebody | 90 | 6.0 to 12.0 | tug, 2 tractors, hydrant fuel, 2 catering trucks, water, lavatory, ground power, 2 bridges optional |
| freighter | 90 to 120 | 6.0 to 12.0 | tug, loaders, fuel, ground power |
| businessJet | 25 | 0.9 to 3.0 | fuel truck, steps, VIP handling |
| historic | 90 | 20 | as widebody |


## 3. Phase 1 roster: dimensions

These values decide stand fit, taxiway clearance, jet bridge reach and code letters.

| Model | ICAO | Code | Wake | Appr | Length m | Span m | Height m | Fus. width m | Wheelbase m | Track m |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boeing 737-700 | B737 | C | M | C | 33.63 | 35.79 | 12.57 | 3.76 | 12.60 | 5.72 |
| Boeing 737-800 | B738 | C | M | D | 39.47 | 35.79 | 12.55 | 3.76 | 15.60 | 5.72 |
| Boeing 737-900ER | B739 | C | M | D | 42.11 | 35.79 | 12.55 | 3.76 | 17.17 | 5.72 |
| Boeing 737 MAX 8 | B38M | C | M | D | 39.52 | 35.92 | 12.29 | 3.76 | 15.60 | 5.72 |
| Boeing 737 MAX 9 | B39M | C | M | D | 42.16 | 35.92 | 12.29 | 3.76 | 17.17 | 5.72 |
| Airbus A319ceo | A319 | C | M | C | 33.84 | 34.10 | 11.76 | 3.95 | 11.04 | 7.59 |
| Airbus A320ceo | A320 | C | M | C | 37.57 | 34.10 | 11.76 | 3.95 | 12.64 | 7.59 |
| Airbus A321ceo | A321 | C | M | D | 44.51 | 34.10 | 11.76 | 3.95 | 16.91 | 7.59 |
| Airbus A320neo | A20N | C | M | C | 37.57 | 35.80 | 11.76 | 3.95 | 12.64 | 7.59 |
| Airbus A321neo | A21N | C | M | C | 44.51 | 35.80 | 11.76 | 3.95 | 16.91 | 7.59 |
| Boeing 747-400 | B744 | E | H | D | 70.66 | 64.44 | 19.41 | 6.50 | 25.60 | 11.00 |
| Boeing 747-400F | B744 | E | H | D | 70.66 | 64.44 | 19.41 | 6.50 | 25.60 | 11.00 |
| Boeing 747-8 Intercontinental | B748 | F | H | D | 76.25 | 68.45 | 19.35 | 6.50 | 29.67 | 11.00 |
| Boeing 747-8F | B748 | F | H | D | 76.25 | 68.45 | 19.35 | 6.50 | 29.67 | 11.00 |
| Boeing 777-200ER | B772 | E | H | C | 63.73 | 60.93 | 18.52 | 6.19 | 25.88 | 10.97 |
| Boeing 777-300ER | B77W | E | H | D | 73.86 | 64.80 | 18.51 | 6.19 | 31.22 | 10.97 |
| Boeing 777F | B77L | E | H | D | 63.73 | 64.80 | 18.60 | 6.19 | 25.88 | 10.97 |
| Boeing 787-8 | B788 | E | H | C | 56.72 | 60.12 | 16.92 | 5.77 | 22.78 | 9.80 |
| Boeing 787-9 | B789 | E | H | D | 62.81 | 60.12 | 17.02 | 5.77 | 25.60 | 9.80 |
| Boeing 787-10 | B78X | E | H | D | 68.28 | 60.12 | 17.02 | 5.77 | 28.12 | 9.80 |
| Airbus A330-200 | A332 | E | H | C | 58.82 | 60.30 | 17.39 | 5.64 | 22.18 | 10.69 |
| Airbus A330-300 | A333 | E | H | C | 63.66 | 60.30 | 16.79 | 5.64 | 25.58 | 10.69 |
| Airbus A330-900 | A339 | E | H | C | 63.66 | 64.00 | 16.79 | 5.64 | 25.58 | 10.69 |
| Airbus A330-200F | A332 | E | H | C | 58.82 | 60.30 | 16.90 | 5.64 | 22.18 | 10.69 |
| Airbus A340-300 | A343 | E | H | C | 63.69 | 60.30 | 16.85 | 5.64 | 25.37 | 10.69 |
| Airbus A340-600 | A346 | E | H | D | 75.36 | 63.45 | 17.22 | 5.64 | 32.89 | 10.69 |
| Airbus A350-900 | A359 | E | H | C | 66.80 | 64.75 | 17.05 | 5.96 | 28.67 | 10.60 |
| Airbus A350-1000 | A35K | E | H | D | 73.79 | 64.75 | 17.08 | 5.96 | 32.48 | 10.73 |
| ATR 42-600 | AT46 | C | M | B | 22.67 | 24.57 | 7.59 | 2.87 | 8.78 | 4.10 |
| ATR 72-600 | AT76 | C | M | B | 27.17 | 27.05 | 7.65 | 2.87 | 10.77 | 4.10 |
| Bombardier CRJ200 | CRJ2 | B | M | C | 26.77 | 21.21 | 6.22 | 2.69 | 11.39 | 3.18 |
| Bombardier CRJ700 | CRJ7 | B | M | C | 32.51 | 23.24 | 7.57 | 2.69 | 14.60 | 4.10 |
| Bombardier CRJ900 | CRJ9 | C | M | C | 36.19 | 24.85 | 7.51 | 2.69 | 17.32 | 4.10 |
| Bombardier CRJ1000 | CRJX | C | M | D | 39.13 | 26.18 | 7.51 | 2.69 | 19.00 | 4.10 |
| De Havilland Canada Dash 8-400 | DH8D | C | M | B | 32.81 | 28.42 | 8.34 | 2.69 | 13.94 | 8.79 |
| Cessna 172S Skyhawk | C172 | A | L | A | 8.28 | 11.00 | 2.72 | 1.12 | 1.65 | 2.54 |
| Cessna 208B Grand Caravan EX | C208 | B | L | A | 12.67 | 15.87 | 4.53 | 1.75 | 3.56 | 3.56 |
| Cessna Citation CJ4 Gen2 | C25C | B | M | B | 16.26 | 15.49 | 4.67 | 1.60 | 6.40 | 3.40 |
| Cessna Citation Latitude | C68A | B | M | B | 18.97 | 22.05 | 6.38 | 2.10 | 8.10 | 3.80 |
| Beechcraft King Air C90GTx | BE9L | B | L | B | 10.82 | 16.10 | 4.34 | 1.60 | 3.73 | 3.89 |
| Beechcraft King Air 260 | BE20 | B | L | B | 13.36 | 16.61 | 4.37 | 1.60 | 4.56 | 5.23 |
| Beechcraft King Air 360 | BE30 | B | L | B | 14.22 | 17.65 | 4.37 | 1.60 | 4.56 | 5.23 |

## 4. Phase 1 roster: weights, engines and performance

These values decide runway length, pavement load, payload, range, block time and turnaround.


| Model | MTOW kg | MLW kg | OEW kg | Seats typ / max | Payload kg | Engines | Thrust or power each | Range km | Cruise km/h | TOFL m | LDL m | Vref kt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boeing 737-700 | 70,080 | 58,604 | 38,147 | 126 / 149 | derived | 2 x CFM56-7B24 | 107 kN | 6,370 | 842 | 1,900 | 1,415 | 130 |
| Boeing 737-800 | 79,010 | 66,361 | 41,413 | 162 / 189 | derived | 2 x CFM56-7B27 | 121 kN | 5,436 | 842 | 2,316 | 1,634 | 146 |
| Boeing 737-900ER | 85,139 | 71,350 | 44,676 | 178 / 220 | derived | 2 x CFM56-7B27 | 121 kN | 5,460 | 842 | 2,500 | 1,800 | 150 |
| Boeing 737 MAX 8 | 82,191 | 69,309 | 45,070 | 172 / 210 | derived | 2 x CFM LEAP-1B27 | 124 kN | 6,570 | 839 | 2,500 | 1,600 | 145 |
| Boeing 737 MAX 9 | 88,314 | 74,344 | 50,300 | 193 / 220 | derived | 2 x CFM LEAP-1B28 | 130 kN | 6,110 | 839 | 2,700 | 1,700 | 150 |
| Airbus A319ceo | 75,500 | 62,500 | 40,800 | 124 / 156 | derived | 2 x CFM56-5B6 | 105 kN | 6,850 | 828 | 1,950 | 1,470 | 130 |
| Airbus A320ceo | 78,000 | 66,000 | 42,600 | 150 / 180 | derived | 2 x CFM56-5B4 | 120 kN | 6,150 | 828 | 2,100 | 1,500 | 136 |
| Airbus A321ceo | 93,500 | 77,800 | 48,500 | 185 / 220 | derived | 2 x CFM56-5B3 | 147 kN | 5,950 | 828 | 2,500 | 1,600 | 142 |
| Airbus A320neo | 79,000 | 67,400 | 44,300 | 165 / 194 | derived | 2 x CFM LEAP-1A26 or PW1127G | 121 kN | 6,300 | 828 | 1,950 | 1,500 | 136 |
| Airbus A321neo | 97,000 | 79,200 | 50,100 | 206 / 244 | derived | 2 x CFM LEAP-1A32 or PW1133G | 143 kN | 7,400 | 828 | 2,200 | 1,600 | 140 |
| Boeing 747-400 | 396,890 | 285,764 | 178,756 | 416 / 660 | derived | 4 x CF6-80C2B5F or PW4062 or RB211-524H | 270 kN | 13,450 | 913 | 3,300 | 2,130 | 157 |
| Boeing 747-400F | 396,890 | 302,093 | 164,382 | freighter | 112,630 | 4 x CF6-80C2B5F | 270 kN | 8,230 | 913 | 3,300 | 2,130 | 157 |
| Boeing 747-8 Intercontinental | 447,700 | 312,072 | 220,128 | 410 / 605 | derived | 4 x GEnx-2B67 | 296 kN | 14,320 | 913 | 3,100 | 2,200 | 158 |
| Boeing 747-8F | 447,700 | 346,090 | 197,131 | freighter | 137,750 | 4 x GEnx-2B67 | 296 kN | 7,630 | 913 | 3,100 | 2,200 | 158 |
| Boeing 777-200ER | 297,550 | 213,180 | 138,100 | 313 / 440 | derived | 2 x GE90-94B or PW4090 or Trent 895 | 417 kN | 13,080 | 905 | 3,380 | 1,770 | 140 |
| Boeing 777-300ER | 351,535 | 251,290 | 167,829 | 396 / 550 | derived | 2 x GE90-115B | 513 kN | 13,650 | 905 | 3,050 | 1,960 | 149 |
| Boeing 777F | 347,815 | 260,816 | 144,379 | freighter | 102,010 | 2 x GE90-110B1 | 489 kN | 9,200 | 905 | 3,200 | 1,900 | 147 |
| Boeing 787-8 | 227,930 | 172,365 | 119,950 | 248 / 381 | derived | 2 x GEnx-1B70 or Trent 1000 | 285 kN | 13,530 | 903 | 2,600 | 1,700 | 140 |
| Boeing 787-9 | 254,011 | 192,777 | 128,850 | 296 / 420 | derived | 2 x GEnx-1B74 or Trent 1000-TEN | 320 kN | 14,010 | 903 | 2,800 | 1,800 | 144 |
| Boeing 787-10 | 254,011 | 201,849 | 135,500 | 336 / 440 | derived | 2 x GEnx-1B76 or Trent 1000-TEN | 338 kN | 11,910 | 903 | 2,900 | 1,900 | 148 |
| Airbus A330-200 | 242,000 | 182,000 | 120,600 | 247 / 406 | derived | 2 x Trent 772B or CF6-80E1 or PW4168 | 316 kN | 13,450 | 871 | 2,500 | 1,750 | 137 |
| Airbus A330-300 | 242,000 | 187,000 | 129,400 | 277 / 440 | derived | 2 x Trent 772B or CF6-80E1 or PW4168 | 316 kN | 11,750 | 871 | 2,770 | 1,850 | 140 |
| Airbus A330-900 | 251,000 | 191,000 | 135,000 | 287 / 460 | derived | 2 x Trent 7000-72 | 324 kN | 13,330 | 871 | 2,600 | 1,800 | 140 |
| Airbus A330-200F | 233,000 | 187,000 | 109,000 | freighter | 70,000 | 2 x Trent 772B or PW4170 | 316 kN | 7,400 | 871 | 2,600 | 1,800 | 140 |
| Airbus A340-300 | 276,500 | 192,000 | 129,800 | 277 / 440 | derived | 4 x CFM56-5C4 | 151 kN | 13,700 | 871 | 3,000 | 1,900 | 140 |
| Airbus A340-600 | 380,000 | 265,000 | 177,000 | 326 / 475 | derived | 4 x Trent 556 | 249 kN | 14,450 | 871 | 3,200 | 2,050 | 150 |
| Airbus A350-900 | 283,000 | 207,000 | 142,400 | 315 / 440 | derived | 2 x Trent XWB-84 | 374 kN | 15,000 | 903 | 2,600 | 1,850 | 140 |
| Airbus A350-1000 | 319,000 | 236,000 | 155,000 | 369 / 480 | derived | 2 x Trent XWB-97 | 431 kN | 16,100 | 903 | 2,800 | 2,000 | 145 |
| ATR 42-600 | 18,600 | 18,300 | 11,550 | 48 / 50 | derived | 2 x PW127M | 1790 kW | 1,326 | 556 | 1,165 | 1,126 | 104 |
| ATR 72-600 | 23,000 | 22,350 | 13,600 | 70 / 78 | derived | 2 x PW127M | 2051 kW | 1,528 | 510 | 1,367 | 1,067 | 113 |
| Bombardier CRJ200 | 24,040 | 21,319 | 13,835 | 50 / 50 | derived | 2 x CF34-3B1 | 41 kN | 3,045 | 786 | 1,920 | 1,480 | 140 |
| Bombardier CRJ700 | 34,019 | 30,390 | 20,069 | 70 / 78 | derived | 2 x CF34-8C5B1 | 61 kN | 2,553 | 828 | 1,605 | 1,515 | 140 |
| Bombardier CRJ900 | 38,330 | 33,339 | 21,845 | 76 / 90 | derived | 2 x CF34-8C5 | 64 kN | 2,956 | 828 | 1,778 | 1,596 | 140 |
| Bombardier CRJ1000 | 41,640 | 36,968 | 23,188 | 100 / 104 | derived | 2 x CF34-8C5A1 | 61 kN | 3,004 | 828 | 2,120 | 1,750 | 145 |
| De Havilland Canada Dash 8-400 | 29,574 | 28,123 | 17,819 | 78 / 90 | derived | 2 x PW150A | 3781 kW | 2,040 | 667 | 1,425 | 1,295 | 120 |
| Cessna 172S Skyhawk | 1,157 | 1,157 | 767 | 3 / 3 | derived | 1 x Lycoming IO-360-L2A | 134 kW | 1,185 | 226 | 497 | 407 | 62 |
| Cessna 208B Grand Caravan EX | 3,995 | 3,856 | 2,326 | 9 / 13 | derived | 1 x PT6A-140 | 647 kW | 1,689 | 344 | 734 | 518 | 78 |
| Cessna Citation CJ4 Gen2 | 7,761 | 7,103 | 4,980 | 8 / 10 | derived | 2 x Williams FJ44-4A | 16.1 kN | 4,010 | 835 | 1,036 | 905 | 115 |
| Cessna Citation Latitude | 14,061 | 12,746 | 9,525 | 9 / 9 | derived | 2 x PW306D1 | 25.7 kN | 5,000 | 826 | 1,091 | 768 | 110 |
| Beechcraft King Air C90GTx | 4,756 | 4,513 | 3,130 | 5 / 7 | derived | 2 x PT6A-135A | 410 kW | 2,446 | 500 | 840 | 650 | 100 |
| Beechcraft King Air 260 | 5,670 | 5,670 | 3,840 | 7 / 9 | derived | 2 x PT6A-52 | 634 kW | 3,185 | 578 | 1,021 | 870 | 103 |
| Beechcraft King Air 360 | 6,804 | 6,577 | 4,445 | 9 / 11 | derived | 2 x PT6A-60A | 783 kW | 3,345 | 576 | 1,006 | 820 | 105 |

Unpaved operation: the Cessna 172, Cessna 208 and King Air family may use gravel and grass, the 172 and 208 also dirt. The ATR 42 and 72 may use gravel with the unpaved runway kit option. Every other type needs asphalt or concrete.

## 5. Sprite geometry

Every model renders from vector geometry in meters, never from a fixed bitmap. The full method and art direction live in `docs/ART_AND_ASSETS.md` section 4. The data side works like this.

Base sprites (`spriteBases` in the JSON) hold one fully measured geometry per family representative:

* Fuselage: `L`, `fw`, nose length `nose` with ogive exponents `nose_n` and `nose_m`, tail cone `tail`, `tail_end`, `tail_p`.
* Wing: root leading edge station `x`, root chord `c`, leading edge `sweep`, trailing edge kink station `kink`, inboard trailing edge sweep `te_in`, rounding of the kink `kink_round`, tip chord `tip`, semispan `sb`, optional raked tip (`rake`, `rake_extra`), winglet type (`none`, `fence`, `blended`, `split`, `sharklet`, `canted`) and its outward projection `ext`, high wing flag.
* Tail: horizontal stabilizer station, chord, sweep, span, tip chord and a T tail flag. Fin projection from above.
* Engines: lateral station `y`, nacelle front station `x`, length, diameter, `kind` (`fan`, `rear`, `prop`), `flow` (`separate` shows the core cowl and plug behind the fan cowl, `longduct` is one long cowl), `fan_end`, chevrons, prop diameter and blade count.
* Cockpit: windscreen station, depth, side sweep and `style` (`airbus`, `b737`, `boeing`, `b787`, `a350`, `crj`, `atr`, `q400`, `kingair`, `ga`).
* Cabin: door stations, overwing exits, window row start, end and pitch, upper deck outline for the 747.
* Boundary: `gear` (nose gear station, wheelbase, track) and `heights` (wing and stabilizer underside in meters). Hard footprints and overhead zones are built from these and the planform, see `docs/GAME_DESIGN.md` section 10 and `docs/ART_AND_ASSETS.md` section 4.8.
* Service points (required before a type ships): door, cargo door, bulk door, fuel panel, ground power, water and lavatory positions in local meters, with the side (left or right). Example for the A320neo base: L1 and R1 at 5.0 m, forward cargo door right at 8.6 m, fuel coupling under the right wing at 9 m outboard and 19.7 m aft, R2 at 32.4 m, ground power at the nose gear.

Variants reference a base and list only what differs:

* `plugFwd` and `plugAft` in meters. Every station ahead of the wing root leading edge minus 1 m stays put, stations behind it move by `plugFwd`, and stations behind the wing root trailing edge plus 1 m move by a further `plugAft`. Negative values shorten.
* Optional `span`, `winglet`, `ext`, `rake`, `wing`, `engine`, `ttail`, `upperEnd` and `windows` overrides.

A schema test rebuilds every variant and checks that its length and span match `dimensions` within 1 percent.

The `sprite.calibration` field records how far a geometry has been verified: `photo calibrated`, `dimension checked` or `needs photo calibration`. Only the 777 base is photo calibrated today, against a top down photo of a 777-9 (see `docs/art/b777_calibration.png`).

## 6. Definition of ready for a new model

A model may be added to a released phase only when all of these hold:

1. Every schema field is filled from a published source, and the source is noted in `src/data/aircraft/SOURCES.md`.
2. Its sprite geometry is overlaid on at least one true top down photo or manufacturer 3 view at a known scale. Length and span error stay within 1 percent, and wing root, engine stations and stabilizer position within 0.5 m.
3. The type's own windscreen shape, wing planform, winglet type, nacelle type and engine stations are represented. Two types may share a sprite base only if they share these features in reality.
4. Stop bar labels, stand fit, runway length and pavement tests pass with the new data.

## Families

Fleet commonality in the airline generator uses the `family` key. Airlines prefer to stay inside one or two families.

| Family key | Members |
| --- | --- |
| `cessnaLight` | Cessna 172S, Cessna 208B |
| `citation` | Citation CJ4, Citation Latitude, Citation CJ3+ |
| `kingAir` | King Air C90GTx, King Air 260, King Air 360 |
| `commuterOther` | BN-2, Twin Otter, Dornier 228, L-410, Pilatus PC-12, Beechcraft 1900D |
| `emb120` | EMB 120 |
| `saab` | Saab 340B, Saab 2000 |
| `dash8` | Dash 8-100, Dash 8-300, Dash 8-400 (Q400) |
| `atr` | ATR 42-600, ATR 72-600, ATR 72-600F |
| `fokkerProp` | Fokker 50 |
| `ma60` | Xian MA60 |
| `erj` | ERJ 145 |
| `crj` | CRJ-200, CRJ-700, CRJ-900, CRJ-1000 |
| `ejet` | E170, E175, E190, E195 |
| `ejet2` | E175-E2, E190-E2, E195-E2 |
| `ssj` | Sukhoi Superjet 100 |
| `arj21` | COMAC ARJ21-700 |
| `fokkerJet` | Fokker 100 |
| `bae146` | BAe 146-300 |
| `a220` | A220-100, A220-300 |
| `md80` | 717-200, MD-82, MD-90 |
| `b727` | 727-200 |
| `b737classic` | 737-200, 737-300, 737-400, 737-500 |
| `b737ng` | 737-700, 737-800, 737-900ER, 737-800BCF |
| `b737max` | 737 MAX 8, 737 MAX 9, 737 MAX 10 |
| `a320ceo` | A318, A319ceo, A320ceo, A321ceo, A321P2F |
| `a320neo` | A319neo, A320neo, A321neo, A321XLR, ACJ320neo |
| `c919` | COMAC C919 |
| `mc21` | Irkut MC-21-300 |
| `tu154` | Tu-154M |
| `b757b767` | 757-200, 757-300, 757-200F, 767-200ER, 767-300ER, 767-400ER, 767-300F |
| `a300a310` | A300-600R, A310-300 |
| `trijet` | MD-11, MD-11F, DC-10-30 |
| `il` | Il-96-300, Il-76TD, An-124-100 |
| `a330ceo` | A330-200, A330-300, A330-200F |
| `a330neo` | A330-800neo, A330-900neo |
| `a340` | A340-300, A340-500, A340-600 |
| `a350` | A350-900, A350-1000 |
| `b777` | 777-200, 777-200ER, 777-200LR, 777-300ER, 777F |
| `b777x` | 777-8, 777-9 |
| `b787` | 787-8, 787-9, 787-10 |
| `b747` | 747-200B, 747-400, 747-400F, 747-8I, 747-8F |
| `a380` | A380-800 |
| `bizjet` | business jets not in another family |
| `concorde` | Concorde |

## 7. Later phase rosters

Gameplay values for models that are not built yet. Each one must be upgraded to the full Phase 1 schema and pass the definition of ready before its phase ships. The Seats column shows maximum seats, or payload in tonnes for freighters.

### Phase 2: mainline expansion

| Model | Group | Code | Wake | Span m | Length m | Seats or payload t | MTOW t | Takeoff m | Landing m | Range km | Gen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Embraer E170 | Regional jet | C | M | 26.0 | 29.9 | 76 | 37.2 | 1600 | 1300 | 3700 | mature |
| Embraer E175 | Regional jet | C | M | 26.0 | 31.7 | 88 | 40.0 | 2200 | 1300 | 4000 | mature |
| Embraer E190 | Regional jet | C | M | 28.7 | 36.2 | 100 | 51.8 | 2100 | 1300 | 4500 | mature |
| Embraer E195 | Regional jet | C | M | 28.7 | 38.7 | 118 | 52.3 | 2200 | 1400 | 4300 | mature |
| Embraer E175-E2 | Regional jet | C | M | 31.0 | 32.4 | 88 | 44.8 | 1800 | 1200 | 3800 | modern |
| Embraer E190-E2 | Regional jet | C | M | 33.7 | 36.2 | 106 | 56.4 | 1500 | 1300 | 5300 | modern |
| Embraer E195-E2 | Regional jet | C | M | 35.1 | 41.5 | 132 | 61.5 | 1900 | 1500 | 4800 | modern |
| Airbus A220-100 | Narrowbody | C | M | 35.1 | 35.0 | 120 | 63.1 | 1500 | 1400 | 5700 | modern |
| Airbus A220-300 | Narrowbody | C | M | 35.1 | 38.7 | 145 | 70.9 | 1900 | 1500 | 6700 | modern |
| Boeing 737 MAX 10 | Narrowbody | C | M | 35.9 | 43.8 | 230 | 89.9 | 2700 | 1800 | 6100 | modern |
| Airbus A318 | Narrowbody | C | M | 34.1 | 31.4 | 107 | 68.0 | 1500 | 1400 | 5700 | mature |
| Airbus A319neo | Narrowbody | C | M | 35.8 | 33.8 | 160 | 75.5 | 2000 | 1400 | 6850 | modern |
| Airbus A321XLR | Narrowbody | C | M | 35.8 | 44.5 | 220 | 101.0 | 2500 | 1700 | 8700 | modern |
| Boeing 757-200 | Narrowbody | D | M | 38.0 | 47.3 | 200 | 115.7 | 2000 | 1500 | 7250 | classic |
| Boeing 757-300 | Narrowbody | D | M | 38.0 | 54.4 | 243 | 122.5 | 2500 | 1700 | 6400 | classic |
| Boeing 767-200ER | Widebody | D | H | 47.6 | 48.5 | 224 | 179.2 | 2500 | 1500 | 12200 | classic |
| Boeing 767-300ER | Widebody | D | H | 47.6 | 54.9 | 269 | 186.9 | 2700 | 1600 | 11070 | classic |
| Boeing 767-400ER | Widebody | D | H | 51.9 | 61.4 | 304 | 204.1 | 3000 | 1900 | 10415 | mature |
| Airbus A330-800neo | Widebody | E | H | 64.0 | 58.8 | 257 | 251.0 | 2350 | 1700 | 13900 | modern |
| Airbus A340-500 | Widebody | E | H | 63.5 | 67.9 | 313 | 380.0 | 3200 | 2000 | 16700 | mature |
| Boeing 777-200 | Widebody | E | H | 60.9 | 63.7 | 305 | 247.2 | 2700 | 1700 | 9700 | mature |
| Boeing 777-200LR | Widebody | E | H | 64.8 | 63.7 | 301 | 347.5 | 3500 | 1800 | 15840 | mature |
| Boeing 777-8 | Widebody | F | H | 71.8 | 69.5 | 350 | 351.5 | 3000 | 1800 | 16170 | modern |
| Boeing 777-9 | Widebody | F | H | 71.8 | 76.7 | 426 | 351.5 | 3050 | 1900 | 13500 | modern |
| Airbus A380-800 | Widebody | F | J | 79.8 | 72.7 | 500 | 575.0 | 3000 | 2100 | 15200 | mature |
| ATR 72-600F | Freighter | C | M | 27.1 | 27.2 | 8.5 | 23.0 | 1330 | 915 | 1400 | mature |
| Boeing 737-800BCF | Freighter | C | M | 35.8 | 39.5 | 23.0 | 79.0 | 2300 | 1600 | 3700 | mature |
| Airbus A321P2F | Freighter | C | M | 34.1 | 44.5 | 27.0 | 93.5 | 2500 | 1700 | 3700 | mature |
| Boeing 757-200F | Freighter | D | M | 38.0 | 47.3 | 39.7 | 115.7 | 2000 | 1500 | 5800 | classic |
| Boeing 767-300F | Freighter | D | H | 47.6 | 54.9 | 52.7 | 186.9 | 2700 | 1600 | 6000 | classic |

The 777-8 and 777-9 carry `foldedSpanM` 64.85, so they fit code E stands and taxiways when the folding wingtip rule is on.

### Phase 3: regional, GA and business depth

| Model | Group | Code | Wake | Span m | Length m | Seats or payload t | MTOW t | Takeoff m | Landing m | Range km | Gen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Britten-Norman BN-2 Islander | GA and commuter | A | L | 14.9 | 10.9 | 9 | 3.0 | 400 | 300 | 1100 | classic |
| Pilatus PC-12 NGX | GA and commuter | B | L | 16.3 | 14.4 | 9 | 4.7 | 800 | 700 | 3400 | modern |
| DHC-6 Twin Otter 400 | GA and commuter | B | L | 19.8 | 15.8 | 19 | 5.7 | 400 | 350 | 1480 | mature |
| Dornier 228-212 | GA and commuter | B | L | 17.0 | 16.6 | 19 | 6.4 | 600 | 500 | 1100 | classic |
| Let L-410 NG | GA and commuter | B | L | 19.5 | 14.4 | 19 | 7.0 | 600 | 500 | 1300 | modern |
| Beechcraft 1900D | GA and commuter | B | M | 17.6 | 17.6 | 19 | 7.8 | 1100 | 900 | 1700 | classic |
| Embraer EMB 120 Brasilia | Regional turboprop | B | M | 19.8 | 20.0 | 30 | 12.0 | 1420 | 1100 | 1750 | classic |
| Saab 340B | Regional turboprop | B | M | 21.4 | 19.7 | 34 | 13.2 | 1220 | 1100 | 1700 | classic |
| Dash 8-100 | Regional turboprop | C | M | 25.9 | 22.3 | 37 | 16.5 | 950 | 900 | 1900 | classic |
| Dash 8-300 | Regional turboprop | C | M | 27.4 | 25.7 | 50 | 19.5 | 1100 | 1050 | 1700 | classic |
| Saab 2000 | Regional turboprop | C | M | 24.8 | 27.3 | 50 | 23.0 | 1300 | 1000 | 2500 | classic |
| Fokker 50 | Regional turboprop | C | M | 29.0 | 25.2 | 50 | 20.8 | 1350 | 1100 | 2000 | classic |
| Xian MA60 | Regional turboprop | C | M | 29.2 | 24.7 | 56 | 21.8 | 1400 | 1100 | 1600 | mature |
| Embraer ERJ 145 | Regional jet | B | M | 20.0 | 29.9 | 50 | 22.0 | 1500 | 1250 | 2800 | classic |
| Sukhoi Superjet 100 | Regional jet | C | M | 27.8 | 29.9 | 98 | 49.5 | 1700 | 1600 | 4400 | mature |
| COMAC ARJ21-700 | Regional jet | C | M | 27.3 | 33.5 | 90 | 40.5 | 1700 | 1500 | 2200 | mature |
| Fokker 100 | Regional jet | C | M | 28.1 | 35.5 | 100 | 44.5 | 1800 | 1300 | 3200 | classic |
| BAe 146-300 | Regional jet | C | M | 26.3 | 31.0 | 100 | 44.2 | 1400 | 1200 | 2900 | classic |
| COMAC C919 | Narrowbody | C | M | 35.8 | 38.9 | 164 | 77.3 | 2000 | 1500 | 5555 | modern |
| Irkut MC-21-300 | Narrowbody | C | M | 35.9 | 42.2 | 211 | 79.2 | 1950 | 1500 | 6000 | modern |
| Cessna Citation CJ3+ | Business jet | B | L | 16.2 | 15.5 | 7 | 6.3 | 960 | 800 | 3700 | mature |
| Embraer Phenom 300E | Business jet | B | M | 16.2 | 15.9 | 10 | 8.2 | 960 | 800 | 3650 | mature |
| Bombardier Challenger 350 | Business jet | B | M | 21.0 | 20.9 | 10 | 17.6 | 1400 | 800 | 5900 | mature |
| Dassault Falcon 7X | Business jet | C | M | 26.2 | 23.4 | 14 | 31.8 | 1600 | 700 | 11000 | mature |
| Gulfstream G650ER | Business jet | C | M | 30.4 | 30.4 | 19 | 45.4 | 1800 | 900 | 13890 | mature |
| Bombardier Global 7500 | Business jet | C | M | 31.7 | 33.9 | 19 | 52.2 | 1700 | 800 | 14260 | modern |
| Airbus ACJ320neo | Business jet | C | M | 35.8 | 37.6 | 19 | 79.0 | 2100 | 1500 | 11100 | modern |

### Phase 4: classics and heavy cargo

| Model | Group | Code | Wake | Span m | Length m | Seats or payload t | MTOW t | Takeoff m | Landing m | Range km | Gen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boeing 717-200 | Narrowbody | C | M | 28.4 | 37.8 | 117 | 54.9 | 2100 | 1500 | 2600 | classic |
| McDonnell Douglas MD-82 | Narrowbody | C | M | 32.9 | 45.1 | 150 | 67.8 | 2300 | 1500 | 3800 | classic |
| McDonnell Douglas MD-90 | Narrowbody | C | M | 32.9 | 46.5 | 160 | 70.8 | 2100 | 1500 | 3800 | classic |
| Boeing 727-200 | Narrowbody | C | M | 32.9 | 46.7 | 189 | 95.0 | 2500 | 1500 | 4400 | classic |
| Boeing 737-200 | Narrowbody | C | M | 28.4 | 30.5 | 130 | 52.4 | 1900 | 1300 | 3500 | classic |
| Boeing 737-300 | Narrowbody | C | M | 28.9 | 33.4 | 140 | 62.8 | 2100 | 1400 | 4000 | classic |
| Boeing 737-400 | Narrowbody | C | M | 28.9 | 36.5 | 168 | 68.0 | 2500 | 1500 | 4000 | classic |
| Boeing 737-500 | Narrowbody | C | M | 28.9 | 31.0 | 132 | 60.5 | 1900 | 1400 | 4400 | classic |
| Tupolev Tu-154M | Narrowbody | D | M | 37.6 | 47.9 | 164 | 100.0 | 2100 | 1350 | 5300 | classic |
| Airbus A300-600R | Widebody | D | H | 44.8 | 54.1 | 266 | 170.5 | 2400 | 1700 | 7500 | classic |
| Airbus A310-300 | Widebody | D | H | 43.9 | 46.7 | 220 | 164.0 | 2300 | 1500 | 8050 | classic |
| McDonnell Douglas MD-11 | Widebody | D | H | 51.7 | 61.6 | 293 | 273.3 | 3000 | 2200 | 12670 | classic |
| McDonnell Douglas DC-10-30 | Widebody | D | H | 50.4 | 55.5 | 270 | 259.5 | 3000 | 1900 | 9900 | classic |
| Ilyushin Il-96-300 | Widebody | E | H | 60.1 | 55.3 | 300 | 250.0 | 2300 | 1500 | 11500 | classic |
| Boeing 747-200B | Widebody | E | H | 59.6 | 70.5 | 366 | 377.8 | 3200 | 2100 | 12700 | classic |
| McDonnell Douglas MD-11F | Freighter | D | H | 51.7 | 61.6 | 91.0 | 273.3 | 3000 | 2200 | 7300 | classic |
| Ilyushin Il-76TD | Freighter | D | H | 50.5 | 46.6 | 50.0 | 210.0 | 1700 | 900 | 5000 | classic |
| Antonov An-124-100 | Freighter | F | H | 73.3 | 69.1 | 120.0 | 392.0 | 3000 | 900 | 4800 | classic |

### Phase 5: sandbox historic

Marked `sandboxOnly`. Concorde uses very high fuel burn and is flown only by an airline with rating 5 and the `fullService` model.

| Model | Group | Code | Wake | Span m | Length m | Seats or payload t | MTOW t | Takeoff m | Landing m | Range km | Gen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Concorde | Historic | C | H | 25.6 | 61.7 | 100 | 185.0 | 3400 | 2000 | 7200 | classic |

## 8. Validation tests

* Derived code letter, wake category and approach category match the data file for every model.
* Every model has positive dimensions, weights, takeoff and landing field lengths, range and engine output.
* `oewKg < mlwKg <= mtowKg` for every model.
* No model requires more than 3600 m of runway at MTOW, sea level, standard day.
* Every family key exists in the Families table, and every model has a phase from 1 to 5.
* Every Phase 1 variant rebuilds from its sprite base to within 1 percent of its length and span.
* The roster contains 118 models, 42 of them in Phase 1, 10 of those with release `mvp1`.
