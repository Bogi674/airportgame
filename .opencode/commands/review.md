---
description: Review your own diff against the definition of done before finishing
---
Review the changes of the current task as a strict reviewer would.

Changed files:
!`git diff --stat origin/main...HEAD`

Rules check:
!`npm run rules 2>&1 | tail -15`

Go through the diff file by file and answer each question in the work file under a "Review" heading:
1. Does every requirement in the plan have a test or a screenshot as evidence?
2. Is every gameplay number in a data file with a schema, with its source in a note?
3. Does any sim code use Math.random, Date.now, performance.now, Math.sin, Math.cos or Math.atan2, or import from render, ui or worker?
4. Does anything allocate inside a tick loop or a render loop?
5. Is any logic duplicated between sim and UI that belongs in src/shared?
6. Did the save shape change without a SAVE_VERSION bump and a migration step?
7. Is every exported function documented in full sentences that cite the spec section?
8. Does any comment, string, doc or commit message use an em dash, an en dash or a spaced hyphen between words?
9. Are there any `any`, TODO, console.log or commented out code left?
Fix every problem you find, then run `npm run verify`.
