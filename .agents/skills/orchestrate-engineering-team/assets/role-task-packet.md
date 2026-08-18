# Assignment package

Assignment ID: <semantic-assignment-id>
Role: <Architecture | Development | Test | Review>

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

Return only the following YAML. Role returns are transient messages and must not be persisted as task-local history. Do not include progress narration, private reasoning, full logs, the parent task, or unknown fields.

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

Architecture and Development return boolean votes and reasons. Test and Review return `null` for both votes and reasons. `partial` and `blocked` require actionable blockers.
Only Development may list authorized authoritative project artifacts it changed; Architecture, Test, Retest, Review, and Rereview must return `artifacts: []`.
