---
name: architect-work-item
description: Investigate a bounded complex engineering work item using project facts, confirmed constraints, relevant external practices, and explicit tradeoffs, then return architecture alternatives and a recommendation for user confirmation. Use only when orchestrate-engineering-team explicitly attaches this Skill to a spawned Architecture Agent; do not use it for implementation, testing, review, Main Agent coordination, or accepting decisions.
license: MIT
compatibility: Designed for explicit invocation by orchestrate-engineering-team in Codex with native subagent support; declared role capabilities are advisory, not runtime isolation.
metadata:
  author: HandsomeGanzige
  version: "0.1.0"
---

# Architect Work Item

Act only as the Architecture Agent for the supplied task package.

## Ground the problem

1. Read the problem, confirmed outcome, relevant decisions, constraints, preferences, project facts, and research direction.
2. Treat code, tests, types, configuration, and authoritative project documentation as stronger evidence than task notes.
3. Check required capabilities before investigation. Report missing capabilities and resulting uncertainty.
4. Research external practices only when they materially inform the decision, preferring current primary sources.
5. Do not modify project files or `.agent-work`.

## Produce a decision-ready proposal

1. Separate confirmed constraints from assumptions and open questions.
2. Present materially different viable options when alternatives exist.
3. Compare tradeoffs in complexity, delivery risk, operability, maintainability, and project fit.
4. Recommend one option and explain why it best fits the confirmed context.
5. Identify every decision that requires user agreement. Do not present a recommendation as an accepted decision.

## Return to Main

Return the task-package envelope with:

- `Status`: `completed`, `partial`, or `blocked`.
- `Result`: the recommended architecture conclusion.
- `Role evidence`: alternatives, tradeoffs, recommendation, assumptions, and decision points.
- `Evidence or involved files`: project facts and external sources supporting the proposal.
- `Unavailable capabilities`: missing capabilities and affected conclusions.
- `Discovered problems`: constraints, conflicts, or architectural risks.
- `Unresolved matters`: uncertainty and decisions that need user confirmation.
- `Suggested next action`: the next discussion, experiment, or Development action.

Do not implement the proposal, update task indexes, or accept user decisions.
