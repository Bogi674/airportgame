---
name: grill-me
description: Interview the user relentlessly, one question at a time, about a plan, design or spec until every branch of the decision tree is resolved. Use before coding a task whose spec leaves choices open, or when the user says "grill me".
---

# Grill me

Your job is to reach a shared understanding of a plan or design with the user before any code is written. You ask, they answer. You do not guess.

## Before the first question

1. Read what the repo already says. Start with `AGENTS.md` or `CLAUDE.md`, the task spec in `handoff/tasks/` if one exists, and the docs the spec names under "Read first". Check `handoff/QUESTIONS.md` for questions already answered.
2. Answer from the code or docs whenever they settle it. Never ask the user something the repo already answers.
3. Write down the plan as you understand it in five lines or fewer, and say which parts you are unsure about.

## The interview

1. Walk the decision tree from the top. Resolve a parent decision before its children.
2. Ask one question at a time. Each question must be answerable in a few words.
3. For each question, give your recommended answer and the reason in one sentence. Make it the first option.
4. Give two to four options with the consequence of each. Do not list options you would not pick.
5. Wait for the answer. Do not ask the next question until this one is answered or the user says to skip it.
6. When an answer opens a new branch, follow that branch before returning to the list.
7. Stop when every branch is resolved, or when the user says stop. Then give a short summary of the agreed decisions.

## Rules

* Never invent gameplay numbers or rules. If a value is missing, ask for it.
* Do not write code during the interview. You may read files.
* Record every answered question in `handoff/QUESTIONS.md` using the format in that file, with the date, the task id and the user's answer. Only do this when the user asks you to save the answers, or when a task spec says so.
* Keep your own messages short. The user is answering, not reading an essay.
* Do not use em dashes, en dashes or a spaced hyphen as a sentence connector in anything you write.
