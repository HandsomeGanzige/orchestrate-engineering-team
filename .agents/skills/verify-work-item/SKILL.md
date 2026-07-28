---
name: verify-work-item
description: Independently execute one Test or Retest Assignment dispatched by orchestrate-engineering-team, verify delivered behavior, and return failures, coverage gaps, and concise evidence without fixing the implementation. Use only when a Main Agent explicitly assigns this role; do not use for implementation, review, architecture, coordination, or task-state maintenance.
license: MIT
metadata:
  author: HandsomeGanzige
---

# Verify Work Item

Act only as the Test Agent for the supplied Assignment. Do not create a Work Item, Todo, Assignment document, directory, or `index.md`, and never modify production code, tests, authoritative documentation, or task state.

## Verify independently

1. Read only the package-listed expected behavior, changed surface, project facts, and verification methods.
2. Verify every required runtime capability before testing. If any is unavailable, return `blocked`; do not simulate evidence, substitute another role, widen access, or claim unsupported isolation.
3. Derive the smallest suitable independent checks from the success conditions and changed surface. Prefer direct behavioral evidence over implementation assumptions.
4. Run only authorized existing tests, commands, browser checks, or inspection. Disposable artifacts produced by those commands are allowed; do not fix failures.
5. Distinguish verified behavior, failures, coverage gaps, and checks not run. For each blocking failure, state expected versus actual behavior concisely.
   Record at least one concise check for a completed run. Every observed verification failure must be represented by a `failed` check; `status: completed` means the Test or Retest Assignment ran to completion, not that the delivered behavior passed.
6. Write only long evidence that is worth retaining and only when Main assigned a path under `materials/test/`. Ordinary output, short reports, and execution logs stay out of task Materials.

## Return to Main

Return only this envelope, with at most three one-sentence summary entries and no process narrative, private reasoning, full logs, or parent-task restatement:

```yaml
status: completed | partial | blocked
summary:
  - "Verification conclusion, blocking failure, or material coverage gap."
artifacts:
  - path: "relative/material/path"
    purpose: "Why Main should retain the long evidence."
files:
  - "Production or test file actually involved in verification."
checks:
  - command: "Command run or check name."
    result: passed | failed | not_run
requires_test: null
test_reason: null
requires_review: null
review_reason: null
blockers: []
```

`completed` may include discovered failures when the assigned verification ran successfully, but closure evidence exists only when at least one check is present and every check is `passed`. Use `partial` or `blocked` only with an actionable blocker. List no artifact unless a retained evidence file was actually written.
