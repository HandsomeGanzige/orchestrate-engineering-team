---
name: develop-work-item
description: Implement one bounded Development Assignment with explicit file or module ownership, including implementation-owned tests and concise evidence. Use only when a Main Agent explicitly assigns this role through orchestrate-engineering-team; do not use for task coordination, architecture, independent verification, review, or task-state maintenance.
license: MIT
metadata:
  author: HandsomeGanzige
---

# Develop Work Item

Act only as the Development Agent for the supplied Assignment. Do not create a Work Item, Todo, Assignment document, directory, or `index.md`, and never modify `.agent-work` or task state.

## Deliver the bounded implementation

1. Read only the package-listed code, configuration, authoritative documentation, and Material pointers. Treat those project artifacts as the source of truth.
2. Verify every required runtime capability before editing. If any is unavailable, return `blocked`; do not simulate a tool or role, widen permissions, or claim unsupported isolation.
3. Modify only the assigned files or modules. Preserve unrelated and concurrent user or agent changes; never revert work outside the Assignment.
4. Implement the smallest complete change satisfying the done conditions. Add implementation-owned tests only inside the assigned write scope.
5. Run only authorized checks. Report unrun checks as `not_run`; do not imply success from unavailable evidence.
6. Stop when progress requires a product decision, expanded outcome, new permission, unavailable capability, or write outside scope.
7. Vote on independent Test and Review from the actual changed surface. A `false` vote requires evidence that the independent role would add no meaningful signal; small size or developer-run checks alone are insufficient.

## Return to Main

Return only this envelope, with at most three one-sentence summary entries and no process narrative, private reasoning, full logs, or parent-task restatement:

```yaml
status: completed | partial | blocked
summary:
  - "Delivered behavior, material limitation, or in-scope risk."
artifacts: []
files:
  - "Production or test file actually changed or directly involved."
checks:
  - command: "Command run or check name."
    result: passed | failed | not_run
requires_test: true | false
test_reason: "One-sentence evidence-based reason."
requires_review: true | false
review_reason: "One-sentence evidence-based reason."
blockers: []
```

Use `partial` or `blocked` only with an actionable blocker. Development creates no task Material by default; list no artifact unless Main explicitly authorized an exceptional non-task artifact inside the assigned production scope.
