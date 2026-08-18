# Assignment package

Protocol: `orchestrate-engineering-team/v0.3.0`

Assignment ID: <semantic-assignment-id>
Attempt ID: <assignment-id-attempt-n>
Role: <Architecture | Development | Test | Review | Retest | Rereview>

## Immutable v2 global contract

Contract digest: `<sha256>`

<Byte-identical contract inherited from the root Work Item. The Assignment, attempt, and packet must carry the same digest; roles may narrow but never widen it.>

## Objective and done conditions

<One bounded objective and observable completion conditions.>

## Scope

Allowed reads:

- <Exact authoritative project path and why it is needed.>

Allowed writes:

- <Exact assigned project file or module; use `none` when read-only.>

## Directly relevant confirmed decisions

- <Only decisions that constrain this Assignment.>

## Capabilities

Available:

- <Capability>

Required:

- <Capability; any missing required capability makes the Assignment blocked.>

Unavailable:

- <Capability or `none`.>

## Dispatch

Spawn this role with `fork_turns: "none"`. The role must not create or modify any Work Item `work.md`, `state.json`, or other task state.

## Return

Return only the schema for the selected role. Role returns are transient messages and must not be persisted as task-local history. Do not include progress narration, private reasoning, full logs, the parent task, or unknown fields.

```yaml
status: completed | partial | blocked
summary:
  - "At most three one-sentence results."
artifacts:
  - path: "relative/path"
    purpose: "One-sentence purpose."
files:
  - "Only production or test files actually involved."
checks:
  - command: "Command run or check name."
    result: passed | failed | not_run
requires_test: true | false | null
test_reason: "One-sentence reason or null."
requires_review: true | false | null
review_reason: "One-sentence reason or null."
blockers: []
```

Development uses the envelope above with boolean votes, the exact Git-derived changed surface in `files`, and authoritative changed project artifacts. Architecture uses the same envelope with `artifacts: []` plus `decision_proposals` entries containing exactly `id`, `summary`, `options`, and `recommendation`; proposals remain advisory until Main confirms them.

Test, Retest, Review, and Rereview omit `artifacts` and all four vote fields. They add `evidence_method` and bounded `findings`; each finding contains exactly `severity`, `summary`, `evidence`, and canonical `pointers`. `partial` and `blocked` require actionable blockers.
