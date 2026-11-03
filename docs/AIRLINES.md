# AIRLINES.md

Airline system for the game. Read together with `docs/AIRCRAFT_DATABASE.md`. There are no rival airports in this game. The player's airport is the only airport in its region, so airlines decide using demand, fees, punctuality, facilities and a hidden outside option, described below.

## 1. Three axes

Every airline has these fields.

| Field | Values | Meaning |
| --- | --- | --- |
| `scope` | `regional`, `national`, `international` | What kind of network the airline runs. This is the airline type. |
| `fleetRating` | 1 to 5 stars | Quality of aircraft and service. Derived, see section 3. |
| `model` | `fullService`, `lowCost`, `charter`, `cargo`, `businessJet` | How the airline earns money and what it asks from the airport. |

Scope and model combine. A regional low cost airline and a national full service airline are both valid. A cargo or business jet airline also carries a scope, which limits its route distance.

The word national means domestic. A national airline flies mostly inside the player's country. Whether a route is domestic or international is decided by the destination city's country relative to the airport.

## 2. Scope rules

| Rule | Regional | National | International |
| --- | --- | --- | --- |
| Typical stage length km | 100 to 1500, up to 2500 with jets | 300 to 4000 | 500 to 16000 |
| Allowed roles | ga, commuter, regionalTurboprop, regionalJet, small narrowbody up to 150 seats | regionalTurboprop, regionalJet, narrowbody, widebody up to 400 seats on trunk routes | regionalJet as feeder, narrowbody, widebody, historic in sandbox |
| Fleet size | 3 to 25 | 15 to 120 | 40 to 300 |
| Share of international routes | 0 to 30 percent | 0 to 20 percent | at least 60 percent |
| Needs customs and immigration | only for cross border routes | rarely | yes |
| Typical stand code | A to C | C to E | C to F |
| Hub behavior | none | can base up to 20 aircraft | can base up to 60 aircraft |
| Slot behavior | requests small frequent slots | requests peak banks | requests long haul night or morning slots |

Cargo, charter and business jet models follow their own role lists.

| Model | Allowed roles | Notes |
| --- | --- | --- |
| `fullService` | per scope table | Wants premium services, lounges and bridges when rating is 4 or 5. |
| `lowCost` | narrowbody, regionalJet, regionalTurboprop only | Single family fleet, 25 minute narrowbody turnaround target, hates high fees, prefers remote stands without bridges. Never operates widebodies unless scope is international and rating is 3 or more. |
| `charter` | narrowbody, widebody | Seasonal bursts. Few flights in low season, many in high season. Accepts old aircraft. |
| `cargo` | freighter | Night operations preferred. Needs cargo apron and handling. Ignores terminal quality. |
| `businessJet` | businessJet, ga | Needs a business aviation stand and VIP handling. Pays high fees. |

## 3. Fleet rating

`fleetRating` is an integer from 1 to 5, shown as stars. It is computed from the airline's actual fleet and service level and recomputed every game year.

```
score = 0.5 * generationScore + 0.3 * ageScore + 0.2 * serviceScore
generationScore: classic 0.0, mature 0.5, modern 1.0, averaged over the fleet by aircraft count
ageScore: clamp(1 - averageAgeYears / 25, 0, 1)
serviceScore: set by the airline at creation from its model, 0 to 1
rating = 1 + floor(score * 4.99)
```

What each rating means by default.

| Stars | Typical fleet | Average age years | Technical delay chance per turnaround | Turnaround time multiplier | Passenger mix | Fee tolerance multiplier | Satisfaction modifier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Mostly classic, noisy | 22 and above | 8 percent | 1.15 | budget | 0.7 | minus 6 |
| 2 | Classic and mature | 16 to 22 | 5 percent | 1.08 | budget and leisure | 0.85 | minus 3 |
| 3 | Mostly mature | 10 to 16 | 3 percent | 1.00 | leisure and business | 1.0 | 0 |
| 4 | Mature and modern | 5 to 10 | 1.5 percent | 0.97 | business and premium | 1.15 | plus 3 |
| 5 | Mostly modern | under 5 | 0.7 percent | 0.95 | premium | 1.3 | plus 6 |

Effects on the airport.

* **Satisfaction**: the modifier is added to every cohort traveling on that airline. It feeds the airport rating, so a high rating airline helps your score and a low rating airline drags it down even when your terminal is fine.
* **Delays**: technical delay chance is rolled per turnaround and is attributed to the airline, not to the airport, in the delay ledger.
* **Spending**: passenger mix changes the retail spend budget of cohorts and which shop categories they prefer.
* **Fees**: fee tolerance multiplies the landing and passenger charge the airline accepts before it threatens to leave.
* **Requirements**: rating 4 and 5 full service airlines ask for bridges and lounges, rating 1 and 2 are happy with remote stands and buses.

### Rating change

* Each game year an airline with positive profit may replace its oldest aircraft with newer generation ones, which raises its rating over time.
* An airline with losses keeps old aircraft and its rating can fall.
* Rating changes by at most 1 star per year.
* The player sees the airline's rating and fleet list in the airline panel and a history chart.

## 4. World airline pool

At game start the seed generates a world pool of 40 to 80 airlines using a forked RNG stream named `airlines`. Only airlines whose home region, range and aircraft can reach the airport appear as potential customers.

Default distribution of the pool.

* Scope: 40 percent regional, 35 percent national, 25 percent international
* Model: 60 percent full service, 25 percent low cost, 5 percent charter, 5 percent cargo, 5 percent business jet
* Rating: weighted by scope. Regional airlines lean to 1 to 3 stars, national to 2 to 4, international to 3 to 5.

Names come from syllable lists in `src/data/airlineNames.json` and a home country list. Never use real airline names or logos.

## 5. Fleet generation

Deterministic algorithm, run per airline.

1. Roll scope, model, rating, home region, budget and personality.
2. Build the candidate list: every aircraft in a released content phase whose role is allowed by scope and model, excluding `sandboxOnly` unless sandbox mode is on. In MVP 1 only the 10 `mvp1` models are released, so fleets use those, and airline scopes are limited to regional and national. From MVP 2 all 42 Phase 1 models and the international scope are available.
3. Apply the generation weights for the rating.

| Stars | classic weight | mature weight | modern weight |
| --- | --- | --- | --- |
| 1 | 0.70 | 0.25 | 0.05 |
| 2 | 0.45 | 0.45 | 0.10 |
| 3 | 0.15 | 0.60 | 0.25 |
| 4 | 0.05 | 0.45 | 0.50 |
| 5 | 0.00 | 0.20 | 0.80 |

4. Choose a fleet strategy by model.
   * `lowCost`: one family only
   * `fullService`: one to three families, one of which is the main family
   * `charter`: one to two families, ignoring commonality
   * `regional`: one or two families, usually one turboprop and one jet family
5. Choose fleet size from the scope range, scaled by budget.
6. Split fleet size across the chosen families. Within a family, pick members so that seat sizes make sense, for example a mix of A320neo and A321neo.
7. Assign an age to each airframe from a distribution centered on the rating's average age. Older airframes lower reliability.
8. Keep only aircraft that can operate at the player's airport. Compare required runway length from `GAME_DESIGN.md` with the usable runway. An airline whose entire fleet fails does not appear. An airline with a partial fit appears and flies only the fitting aircraft.

### Fleet compatibility tests

* For 200 seeds, every generated fleet obeys the role rules of its scope and model.
* For 200 seeds, generation weights across the pool match the table within tolerance.
* A low cost airline always has exactly one family.
* Rating 5 airlines never have a classic aircraft unless the model is full service and the aircraft is Concorde in sandbox mode.
* The same seed always generates the same pool, verified by hash.

## 6. Route choice and aircraft assignment

* A route has a distance, a demand level and a country type. The airline picks the smallest aircraft in its fleet whose seats satisfy the demand and whose range covers the distance with a 10 percent margin.
* Aircraft whose required runway exceeds the usable runway length for that route weight are excluded for that route. Long routes load more fuel, so a long route can fail on a short runway even for an aircraft that can use the airport on short routes.
* Frequency grows when load factor stays above 85 percent and shrinks when it stays below 60 percent.
* Upgauging, moving to a larger aircraft on a route, needs stand code, fire category and runway to allow it, and the airline asks the player if anything must change.

## 7. How airlines judge the airport

There are no competing airports, so each airline has a hidden `outsideOption` value between 0 and 1. It represents everywhere else the airline could deploy its aircraft. Higher means the airline walks away more easily. Regional airlines have the highest values, international airlines the lowest because their flights to this region are harder to replace.

Each month an airline computes a satisfaction score.

```
airlineScore = w1 * feeFit + w2 * punctuality + w3 * facilityFit + w4 * demandStrength + w5 * relationship
```

* `feeFit`: the fee level compared with `feeTolerance`, which depends on rating and model
* `punctuality`: share of its flights delayed by airport causes
* `facilityFit`: how well stands, desks, bridges, lounges, cargo and VIP facilities match what its profile asks for
* `demandStrength`: its load factors at the airport
* `relationship`: grows with years of service and contract discounts, falls after penalties and disputes

If `airlineScore` falls below `outsideOption` for 3 consecutive months, the airline cuts frequencies. If it stays below for 6 months, it exits. If `airlineScore` is far above `outsideOption`, the airline asks to add routes.

Weights `w1` to `w5` depend on model. Low cost weights fee fit most, full service weights facility fit and punctuality, cargo weights punctuality and night operations, business jets weight facility fit highest and barely react to fee level.

## 8. Requirements by scope and rating

What the airline expects. Failing a required item reduces `facilityFit` strongly.

| Profile | Needs |
| --- | --- |
| Regional, any rating | Stand code A to C, boarding by steps, check in desk or shared desk, short turnaround support |
| National, rating 1 to 3 | Stand code C to D, bus or bridge, check in desks, baggage belt |
| National, rating 4 to 5 | Stand code C to E, bridge, priority check in, domestic lounge |
| International, rating 1 to 3 | Stand code C to E, customs and immigration, remote stands accepted |
| International, rating 4 to 5 | Stand code D to F, two bridges for widebodies, lounge, fast track security, transfer facilities |
| Low cost | Remote stands accepted, quick turnaround, low fees, no lounge needs |
| Cargo | Cargo apron, handling equipment, night operations, fuel hydrants for large freighters |
| Business jet | Business aviation stand, VIP lounge, quick customs when international |

## 9. Contracts

Contract terms are set per airline.

* Fee schedule with volume discounts
* Minimum guaranteed movements, with a penalty if the airline falls short
* Desk, gate and lounge leases
* Incentive for new routes, lasting 1 to 3 years
* Penalty clauses for airport caused delays, paid by the player
* Exclusivity, rarely requested, only by hub airlines

A national or international airline that bases at least 5 aircraft counts as a hub carrier. A hub carrier stabilizes traffic but has more bargaining power in negotiations.

## 10. JSON shape

```
{
  "id": "airline_0001",
  "name": "string",
  "scope": "regional" | "national" | "international",
  "model": "fullService" | "lowCost" | "charter" | "cargo" | "businessJet",
  "fleetRating": 1 to 5,
  "serviceScore": 0 to 1,
  "homeRegion": "string",
  "budget": number,
  "outsideOption": 0 to 1,
  "personality": { "feeSensitivity": 0 to 1, "punctualityDemand": 0 to 1, "premiumDemand": 0 to 1 },
  "fleet": [ { "aircraftId": "a320neo", "ageYears": 4, "count": 12 } ],
  "families": ["a320neo"],
  "routes": []
}
```

Fleet entries are grouped by aircraft model and age band for compactness. The generator stores airframe level reliability as an array in typed memory when the airline is active at the airport.
