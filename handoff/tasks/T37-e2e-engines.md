# T37. Browser tests in three engines

Milestone M7. Roadmap line: "Playwright smoke tests in three engines (configured for three engines, run in Chromium only so far)".

## Goal

Prove the Playwright suite passes in Chromium, Firefox and WebKit and tick the line.

## Read first

* `docs/BROWSER.md` section 10, `playwright.config.ts`, `.github/workflows/ci.yml` (the `e2e` job sets `E2E_ALL=1`).

## Steps

1. Check the latest CI runs on `main`: the `e2e` job runs all three engines. Record the run links in the work file.
2. Run locally with `E2E_ALL=1 npm run e2e` if the browsers are installed (`npx playwright install firefox webkit`).
3. Fix any engine specific failure in the game, not by skipping the test.
4. Tick the roadmap line with the evidence.
