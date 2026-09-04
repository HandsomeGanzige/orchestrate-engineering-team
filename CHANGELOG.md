# Changelog

Notable changes are recorded chronologically. Updates replace the current workflow contract directly; old formats and upgrade paths are not retained.

## Current repository state

### v1.0.0 (unreleased workspace version)

The package manifests use `1.0.0`, but the repository currently has no release tag or npm publication workflow. The scoped workspace packages are validated from local tarballs and should not yet be documented as registry-installed packages.

- Replaced five public Skills with one `orchestrate-engineering-team` Skill and four immutable internal Role Contracts; no compatibility shims are retained.
- Added user/project/local/task capability configuration with strict merging, provenance, safe material paths, required/optional behavior, and no-configuration fallback.
- Added host-neutral config and Adapter contract packages, generic prompt fallback, fake Adapter conformance coverage, and explicit effective-capability limitations.
- Added the optional `@orchestrate-engineering-team/cli` with init/configure/show/apply/doctor/schema, dry-run diffs, local ignore maintenance, JSON output, and distinct exit codes.
- Added optional `.agent-work/<task>/` continuity guidance and a Main work-brief template while keeping working material non-authoritative and outside workflow-state, lifecycle, quality-gate, and Git-policy management.
- Made repository recovery and specialist self-discovery tool-neutral, with supplied paths and symbols treated as entry points rather than a complete inspection boundary.
- Added bundled `retrievability-review.md` guidance for optional fresh-context Review of durable knowledge discovery, canonical ownership, stale material, and retrieval noise; Review remains read-only and Main routes accepted repairs.
- Expanded Architecture from fully read-only to code-read-only with optional writes for explicitly assigned Agent materials and project documentation; unconfirmed proposals remain distinct from established rules.
- Strengthened generic prompt fallback to carry the full compact role guidance, prohibited capabilities, document write scope, resolved capability provenance/status, effective unknown host boundaries, and actual limitations.
- Added a manual black-box Skill behavior evaluation harness with disposable repositories, Codex and Fake Runner contracts, filtered local evidence, deterministic safety checks, independent rubric judging, and ten orchestration/continuity/Architecture cases. It is excluded from CI and `pnpm verify`, inherits user-selected models by default, and keeps first-run baselines out of version control and release evidence.
- Updated Plugin, installer, copied-package, tarball, documentation, security, and host-neutral validation around the single-Skill release shape.

### v0.5.0

- Removed the bundled workflow runtime, eight-intent CLI, strict state v3, `.agent-work` persistence, lifecycle stages, leases, revisions, receipts, and machine-managed quality gates.
- Made Main directly responsible for deciding when specialists add value, which roles to select, how to sequence or parallelize them, what evidence is proportionate, and when delivery is complete.
- Reframed multi-Agent collaboration around independent context windows, domain expertise, alternative judgement, independent verification, and useful concurrency rather than mandatory role progression.
- Replaced exact role packets and machine result envelopes with a focused specialist prompt checklist and concise evidence-based role guidance.
- Simplified validation, packaging, and installer fixtures to verify the five canonical Skills and prohibit reintroducing bundled workflow-state machinery.

### v0.4.0

- Replaced `verify-work-item` with `test-product-work-item` and split Product Test from engineering Review: Product Test performs pre-development risk analysis plus post-development user/business/compatibility/stability verification; Review covers engineering-only architecture, standards, maintainability, security, performance, and test design.
- Replaced Test/Review exemption voting with independent Product/engineering freshness gates and residual-risk disposition. Quality reports bind to the revision captured at Assignment start, preserve evidence when waived, and carry the specialist Agent's explicit judgement instead of deriving quality from test counts or scenario coverage.
- Added strict state v3 with no migration or aliases, required `product-test` activities `risk-analysis|verification`, required `product-retest` activity `retest`, exact split result schemas, and a human-readable advisory Product risk brief in `work.md`. The brief informs Development without requiring matching tests; checks and scenarios remain optional report detail. Retest/Rereview is limited to completed non-passing origins.
- Kept Development serial by default while permitting Main-selected parallel Assignments only for dependency-ready, bounded, disjoint work with settled shared interfaces, one integration owner, and a serial integration Development step when code combination is required; branch/worktree orchestration is outside the Skill model.
- Updated all five Skills, eight-intent dependency-free runtime, checkers, copied/install/Plugin fixtures, documentation, and deterministic tests while retaining the Work Item/Child/archive model and its concurrency, crash-recovery, symlink, lock, journal, and cleanup protections.

### v0.3.0 - 2026-08-18

- Replaced the low-level CLI with eight descriptor-driven intent commands and generated help, JSON Schemas, stable result/error contracts, allowlisted error codes, and examples.
- Added immutable state-v2 global contracts and digests across descendants, Assignments, attempts, claims, gates, and role packets while retaining fail-closed Skill-local governance.
- Narrowed role protocols: Development reports Git-derived changed surface and authoritative artifacts, Test/Review report evidence methods and structured findings, and Architecture returns advisory proposals for Main confirmation.
- Exposed only persisted graph/evidence metrics and clarified that transient checks are not persisted proof and Skill-local enforcement is not operating-system isolation.

### Changed

- Replaced JSON-in-Markdown Work Item indexes with one plain `work.md` per Main-owned Work Item and a disposable sibling `state.json` for operational coordination.
- Made Child Main documents independently owned, limited parent projection to child contract and result facts, and retained completed `work.md` trees in an archive excluded from normal Agent discovery and resume context.
- Removed task-local role materials, persisted role results, and hand-maintained Assignment histories; Architecture, Test, and Review now return concise transient messages while durable engineering facts live in authoritative project artifacts.
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
