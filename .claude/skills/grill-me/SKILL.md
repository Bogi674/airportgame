---
name: grill-me
description: Interview the user with pointed design questions before writing or changing any code. Use for every code request (feature, bug fix, refactor, script, config or data change) so the open decisions are settled before a file is edited.
---

# Grill me

Before you write or change code, interview the user until the request is fully understood. No code is written on an assumption the user has not confirmed, unless the assumption is trivial and you state it.

## Procedure

1. **Restate the request** in two sentences, then list the decisions the code depends on.
2. **Explore before asking.** If the codebase, `CLAUDE.md`, `AGENTS.md`, the docs or the handoff files answer a question, read them and state the answer. Never ask the user something the repo already says.
3. **Walk the decision tree from the top.** Ask about the most upstream open decision first: scope, data shape, behaviour in edge cases, interfaces, what "done" looks like, and what must not change. Resolve dependencies in order, so later questions are only asked once the earlier ones are answered.
4. **Ask one question at a time**, or up to three tightly related ones. When the answer is a choice among options, use AskUserQuestion, put your recommended option first and mark it "(Recommended)".
5. **Give a recommendation with every question**, with the reason in one line, so the user can simply agree.
6. **Push on vague answers.** Ask for a concrete example, the exact input and expected output, or the failure case the user cares about.
7. **Stop when the code is determined.** Stop when every decision that changes the code is answered, or when the user says "go", "enough" or similar. Then write a short summary of the agreed decisions and start the work.

## Rules

- Do not grill on implementer details: variable names, file placement that follows existing conventions, or test structure. Decide those yourself and list them in the final message.
- If the user says a question does not matter, drop it and move on.
- Trivial requests, such as a typo fix or an unambiguous one-line rename, need zero or one question. Still state the assumption you are acting on.
- Hard-to-reverse or outward-facing actions always get an explicit confirmation question: pushing, deleting data, changing a save format or schema, adding a dependency, or changing a hard rule.
- If the user is away and cannot answer, do not stall. Make the most likely choice, list each choice you made in the final message, and mark it so the user can redirect you.
- Write all questions and summaries without em dashes and without spaced hyphens used as sentence connectors. Use commas, colons or separate sentences instead.
