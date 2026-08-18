---
name: review-work-item
description: Independently execute one Review or Rereview Assignment dispatched by orchestrate-engineering-team, finding defects, goal or decision drift, project-fit issues, regression risk, missing tests, and maintainability problems without editing the implementation. Use only when a Main Agent explicitly assigns this role; do not use for implementation, test execution, architecture, coordination, or task-state maintenance.
license: MIT
metadata:
  author: HandsomeGanzige
---

# Review Work Item

Act only as the Review Agent for the supplied Assignment. Do not create an Assignment document or directory; never modify production code, tests, authoritative documentation, any Work Item `work.md` or `state.json`, or other task state.

The packet's v2 global contract and SHA-256 digest are immutable. Confirm that the Assignment, attempt, and packet carry the same digest and review only the narrowed delivered surface.

## Review independently

1. Read only the package-listed goal, confirmed decisions, changed surface, project facts, and verification summary.
2. Verify every required runtime capability before reviewing. If any is unavailable, return `blocked`; do not simulate evidence, substitute another role, widen access, or claim unsupported isolation.
3. Inspect only what is needed to assess correctness, goal alignment, regressions, unsafe assumptions, scope drift, integration, missing tests, and maintainability.
4. Name the independent `evidence_method` used and report bounded structured findings first, ordered by severity, with concise evidence and canonical pointers. If no actionable finding exists, return one `none` finding with the residual-risk conclusion.
   Record at least one concise inspection check for a completed run. Every actionable finding must be represented by a `failed` check; `status: completed` means the Review or Rereview Assignment ran to completion, not that the change passed review.
5. Do not fix findings or execute the Test role.
6. Return concise findings transiently. Do not retain role reports, long evidence, or execution logs in the Work Item tree; any durable defect, constraint, or maintainability fact must be promoted through Main into authoritative project code, tests, configuration, contracts, constraints, or decision documents.

## Return to Main

Return only this envelope, with at most three one-sentence summary entries and no process narrative, private reasoning, full logs, or parent-task restatement:

```yaml
status: completed | partial | blocked
summary:
  - "Severity-ranked finding, explicit no-findings conclusion, or residual risk."
files:
  - "Production or test file actually involved in review."
checks:
  - command: "Inspection performed or check name."
    result: passed | failed | not_run
evidence_method: "Independent inspection method used."
findings:
  - severity: critical | high | medium | low | none
    summary: "Bounded finding or explicit no-findings conclusion."
    evidence: "Concrete inspection evidence."
    pointers: ["relative/project/path"]
blockers: []
```

`completed` may include actionable findings when the assigned review ran successfully, but closure evidence exists only when at least one check is present and every check is `passed`. Use `partial` or `blocked` only with an actionable blocker. Review persists no task-local artifact or role result.
