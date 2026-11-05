# T18. Stress: 20 000 cohorts

Milestone M4. Roadmap line: "Stress: 20 000 cohorts under the medium budget".

## Goal

A stress scenario holds 20 000 active cohorts and stays under 4 ms per tick.

## Read first

* `docs/PERFORMANCE.md` sections 1, 3, 8 and 9.
* `scripts/stress.ts` (the scenarios and `buildBigTerminal`), `perf-baseline.json`.
* T14's cohort update.

## Requirements

* R1. Scenario `cohorts20k` in `scripts/stress.ts`: a terminal large enough for the load, flights scheduled so that 20 000 cohorts are active at the peak, printed in the scenario line like the terminal area is today.
* R2. Mean and p99 under 4 ms. If not, profile with `node --cpu-prof` on a small runner script and fix the hot spots: timer wheel instead of scanning, no per tick allocation, typed arrays only.
* R3. Add the scenario to the baseline with `--update-baseline` (this task explicitly allows it for the new scenario only) and check the other scenarios did not regress.
* R4. CI runs it (the stress step already runs every scenario).

## Report

The full stress table before and after.
