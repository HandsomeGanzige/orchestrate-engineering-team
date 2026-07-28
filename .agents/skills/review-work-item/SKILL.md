---
name: review-work-item
description: Independently execute one Review or Rereview Assignment dispatched by orchestrate-engineering-team, finding defects, goal or decision drift, project-fit issues, regression risk, missing tests, and maintainability problems without editing the implementation. Use only when a Main Agent explicitly assigns this role; do not use for implementation, test execution, architecture, coordination, or task-state maintenance.
license: MIT
metadata:
  author: HandsomeGanzige
---

# Review Work Item

Act only as the Review Agent for the supplied Assignment. Do not create a Work Item, Todo, Assignment document, directory, or `index.md`, and never modify production code, tests, authoritative documentation, or task state.

## Review independently

1. Read only the package-listed goal, confirmed decisions, changed surface, project facts, and verification summary.
2. Verify every required runtime capability before reviewing. If any is unavailable, return `blocked`; do not simulate evidence, substitute another role, widen access, or claim unsupported isolation.
3. Inspect only what is needed to assess correctness, goal alignment, regressions, unsafe assumptions, scope drift, integration, missing tests, and maintainability.
4. Report actionable findings first, ordered by impact, with tight file and evidence references. Separate defects from optional improvements. If no actionable finding exists, say so explicitly and retain only meaningful residual risk.
   Record at least one concise inspection check for a completed run. Every actionable finding must be represented by a `failed` check; `status: completed` means the Review or Rereview Assignment ran to completion, not that the change passed review.
5. Do not fix findings or execute the Test role.
6. Write only long evidence that is worth retaining and only when Main assigned a path under `materials/review/`. Ordinary output, short reports, and execution logs stay out of task Materials.

## Return to Main

Return only this envelope, with at most three one-sentence summary entries and no process narrative, private reasoning, full logs, or parent-task restatement:

```yaml
status: completed | partial | blocked
summary:
  - "Severity-ranked finding, explicit no-findings conclusion, or residual risk."
artifacts:
  - path: "relative/material/path"
    purpose: "Why Main should retain the long evidence."
files:
  - "Production or test file actually involved in review."
checks:
  - command: "Inspection performed or check name."
    result: passed | failed | not_run
requires_test: null
test_reason: null
requires_review: null
review_reason: null
blockers: []
```

`completed` may include actionable findings when the assigned review ran successfully, but closure evidence exists only when at least one check is present and every check is `passed`. Use `partial` or `blocked` only with an actionable blocker. List no artifact unless a retained evidence file was actually written.
