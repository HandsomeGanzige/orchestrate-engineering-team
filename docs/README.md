# Documentation map

Use this page to distinguish current repository contracts from background material.

## Current product and operations

- [`../README.md`](../README.md) — current product shape, source usage, repository layout, and verification commands.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — repository invariants and change requirements.
- [`../SECURITY.md`](../SECURITY.md) — trust boundaries and vulnerability reporting.
- [`acceptance-report.md`](acceptance-report.md) — what the current automated suite does and does not verify.
- Package references: [`../packages/config/README.md`](../packages/config/README.md), [`../packages/adapter-contract/README.md`](../packages/adapter-contract/README.md), and [`../packages/cli/README.md`](../packages/cli/README.md).

The executable product contract lives in `.agents/skills/orchestrate-engineering-team/`: `SKILL.md`, `references/role-contracts.yaml`, `references/config.schema.json`, and `assets/role-task-packet.md`.

## Design decision

- [`design/single-main-skill-role-capability-injection.md`](design/single-main-skill-role-capability-injection.md) — accepted v1 architecture and implemented boundaries.

## Supporting research

- [`research/context-exhaustion-continuity-goal-drift.md`](research/context-exhaustion-continuity-goal-drift.md)
- [`research/multi-agent-coordination-state-machines.md`](research/multi-agent-coordination-state-machines.md)
- [`research/role-specific-agent-capability-injection.md`](research/role-specific-agent-capability-injection.md)

Research files are dated evidence and design input, not current behavior contracts. When research text conflicts with the product files above, the product files and tested source are authoritative.
