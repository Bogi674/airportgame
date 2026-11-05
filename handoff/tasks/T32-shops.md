# T32. Shop sales and tenant fill

Milestone M6. Roadmap line: "Shop units with 6 categories, simple tenant fill by rating, sales and rent (rent only, sales are not tracked)".

## Goal

Airside cohorts spend in shops they pass during dwell, shops record sales, tenants fill units by rating, and the airport earns rent plus a share of sales.

## Read first

* `docs/GAME_DESIGN.md` section 8 (dwell and spend) and section 9 (shops and tenants).
* `src/shared/business.ts` (`SHOP_FIXTURE_KEYS`, `leased`), `src/sim/business/business.ts` (tenant fill, rent).
* T14 cohorts (`spendBudget`, airside stage), T12 walking distances.

## Requirements

* R1. During the airside stage a cohort visits shops within a walking radius of its path to the gate, weighted by profile shop preferences (data), spending from its budget with a conversion rate per category (data).
* R2. Sales per shop per day; rent plus a sales share per lease in data; both in the ledger.
* R3. Tenant fill by rating per section 9; empty units show as vacant.
* R4. A tenant sales overlay or inspector numbers per shop.
* R5. Tests: a shop on the path sells more than one off the path; budgets never go negative; conservation of money between cohorts and ledger.
