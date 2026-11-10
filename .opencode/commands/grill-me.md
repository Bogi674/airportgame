---
description: Interview the user one question at a time until a plan or spec is fully decided
---
Interview the user about the plan or spec for the current task, one question at a time, until every branch of the decision tree is resolved. Follow the full procedure in `.claude/skills/grill-me/SKILL.md`.

Context from the repo:
!`git status --short | head -20`

Start here:
1. Read `AGENTS.md`, the task spec in `handoff/tasks/` if one exists, and `handoff/QUESTIONS.md`.
2. Answer from the code or docs whenever they settle a point. Never ask what the repo already answers.
3. Ask the first question with your recommended answer and the reason in one sentence. Wait for the answer before asking the next.

Never invent gameplay numbers or rules. Do not write code during the interview. When every branch is resolved, summarize the agreed decisions and ask whether to record them in `handoff/QUESTIONS.md`.
