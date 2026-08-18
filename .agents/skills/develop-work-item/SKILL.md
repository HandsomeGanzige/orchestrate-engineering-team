---
name: develop-work-item
description: Implement one bounded Development Assignment with explicit file or module ownership, including implementation-owned tests and concise evidence. Use only when a Main Agent explicitly assigns this role through orchestrate-engineering-team; do not use for task coordination, architecture, independent verification, review, or task-state maintenance.
license: MIT
metadata:
  author: HandsomeGanzige
---

# Develop Work Item

Act only as the Development Agent for the supplied Assignment. Do not create an Assignment document or directory, and never modify `.agent-work`, any Work Item `work.md`, `state.json`, or other task state.

The packet's v2 global contract and SHA-256 digest are immutable. Confirm that the Assignment, attempt, and packet carry the same digest; never widen its outcome, done conditions, constraints, read/write scope, forbidden changes, claims, or approved gates.

## Deliver the bounded implementation

1. Read only the package-listed code, tests, configuration, contracts, constraints, authoritative documentation, and decision records. Treat those project artifacts as the source of truth; task-local history is not a project knowledge base.
2. Verify every required runtime capability before editing. If any is unavailable, return `blocked`; do not simulate a tool or role, widen permissions, or claim unsupported isolation.
3. Modify only the assigned files or modules. Preserve unrelated and concurrent user or agent changes; never revert work outside the Assignment.
4. Implement the smallest complete change satisfying the done conditions. Add implementation-owned tests only inside the assigned write scope, promote durable engineering facts into authoritative project artifacts, and report the exact Git-derived changed surface in `files` plus every authoritative artifact actually changed in `artifacts`.
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

Use `partial` or `blocked` only with an actionable blocker. Development creates no task-local materials or persisted role result; list only authoritative project artifacts actually produced inside the assigned scope.
