# Changelog

Notable changes are recorded chronologically. Updates replace the current workflow contract directly; old formats and upgrade paths are not retained.

## Current

### Changed

- Modularized the workflow runtime into cohesive document, store, model, verification, application, and CLI modules.
- Removed obsolete format fields, dated module names, and old-format handling.
- Extended package and install checks across the complete transitive module graph and installed public CLI.

## 2026-07-28

### Changed

- Recast Architecture, Development, Test, Review, Retest, and Rereview executions as bounded Assignments inside a Main-owned Work Item; only independently acceptable recursive subgoals become Child Work Items.
- Made applicability exit, semantic naming, explicit empty-history dispatch, compact role returns, Main-only task-state ownership, safe Development parallelism, and separate Test/Review waiver votes part of the public workflow contract.
- Replaced repeated natural-language state edits with the dependency-free `workflow.mjs` helper, workflow templates, compact role packets, state/voting reference, atomic leases and writes, lightweight search, handoff, and validation.
- Updated the primary five-Skill installation and optional Codex Plugin packaging checks for all Skill-local scripts and resources.

### Added

- A completed C01-C20 acceptance report combining deterministic checks, independent Test/Review, and fresh-context forward scenarios.

## 2026-07-19

### Added

- Initial open Skill suite release containing the Main, Architecture, Development, Test, and Review Skills in canonical `.agents/skills/` directories.
- One-command project-scoped GitHub installation through the pinned external `skills@1.5.19` CLI, with an isolated CI installation smoke check.
- Optional Codex Plugin manifest and repository marketplace adapter backed by the same canonical Skill directories.
- Agent Skills metadata, Codex UI policy, advisory agent-profile, return-contract, copied-package validation, and a secondary disposable CI Plugin lifecycle check with native five-Skill discovery.
- Release documentation, contribution and security policies, GitHub templates, and CI.
