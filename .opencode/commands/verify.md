---
description: Run every check and fix failures one at a time
---
Run the full verification and fix what fails.

!`npm run verify 2>&1 | tail -40`

For each FAIL line in the summary, starting with the first:
1. Read the error output above it in full.
2. Find the cause in the code. Do not change tests to hide a real bug.
3. Fix it and run only that check again.
After three failed attempts on the same error, stop and write it in handoff/QUESTIONS.md.
