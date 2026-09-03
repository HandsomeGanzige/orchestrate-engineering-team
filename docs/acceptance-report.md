# Acceptance report: current v1 repository state

This report describes the checks present in the repository. It is not evidence of npm publication, a live remote install, or production behavior in every host.

## Verified product shape

`pnpm verify` checks that:

- `.agents/skills/` contains only `orchestrate-engineering-team`;
- the Main Skill contains four supporting resources plus `SKILL.md` and Codex UI metadata, including the Main work-brief template;
- exactly four internal Role Contracts exist: architecture, development, product-test, and review;
- former public Role Skill directories are rejected;
- Main continuity instructions preserve `.agent-work` as non-authoritative working material, require the work-brief sections, and use tool-neutral discovery language;
- Architecture has optional `workspace-write` only for assigned Agent working files and project documentation while production code, tests, executable configuration, dependencies, user decisions, and overall coordination remain prohibited;
- the Skill config schema and package config schema remain byte-identical;
- host-neutral core files do not contain the host-specific references prohibited by the static check.

The Main Skill behavior checks are static contract checks. They confirm required instructions and resources are present; they do not launch real specialist Agents.

## Verified library and CLI behavior

The current 28 Node test cases cover:

- strict config parsing, layer replacement/disable behavior, provenance, required/optional Skill diagnosis, and material traversal/symlink rejection;
- Adapter shape and LaunchPlan validation, authority-expansion rejection, and generic prompt fallback that includes professional guidance, prohibited capabilities, document scope, resolved references, host-boundary unknowns, and actual limitations;
- CLI local init, apply/show JSON, required-missing and Adapter-unavailable exit codes;
- copied-repository shape and local one-Skill installation fixtures, including all four Main resources.
- behavior-eval manifest validation, case inventory, disposable Git repositories, current-Skill injection, event filtering, untracked-file diffs, Runner timeout behavior, Judge schema/threshold handling, seeded fixture defects, and report generation through a Fake Runner that consumes no model usage.

Package smoke tests pack `config`, `adapter-contract`, and `cli`, install their tarballs into a clean temporary directory, run CLI help, and reject test or `node_modules` content in the tarballs.

## CI-only integration

GitHub Actions installs a pinned Codex CLI and exercises marketplace add, Plugin add/discovery, and cleanup in a disposable runner. The lifecycle script intentionally refuses to run outside that environment.

The `smoke:skill-install` check is a local copied fixture. It validates the installed directory shape but does **not** execute the README's remote `npx skills add` command.

## Manual black-box behavior evaluation

`pnpm eval` is deliberately outside CI and `pnpm verify`. It copies the current branch's Skill into `.agents/skills/orchestrate-engineering-team/` in a fresh case repository, confirms that the Runner discovers that exact copy, and invokes one independent Agent session per candidate phase. A second read-only repository without the tested Skill hosts the independent Judge.

Every case combines executable/file/diff/event hard checks with a semantic rubric. Any hard safety check fails the attempt. The Judge must score at least 80/100 and pass every critical criterion; its other violations remain diagnostic because safety gates are deterministic. The ten initial cases exercise single-Agent exit, dynamic selection, required/optional capability behavior, generic fallback completeness, fresh-context continuity, tool-neutral discovery, confirmed/unconfirmed Architecture writing, and separate Product Test/Review evidence.

The built-in Codex Runner uses the operator's existing authentication and inherits CLI model defaults unless overridden. Filtered events, final messages, diffs, checks, Judge output, metadata, and summaries are written only below ignored `evals/.runs/`; temporary workspaces are deleted unless explicitly retained. Hidden reasoning, authentication files, complete environments, and unbounded unrelated output are not retained.

A first real run is recorded as a local diagnostic baseline whether it passes or fails. A failure does not authorize immediate Skill changes: Runner failures, bad fixtures, and deterministic false positives are corrected first, while genuine behavior failures remain visible for a later, separately scoped tuning decision. No run result or model-specific score is committed or treated as release evidence.

## Not currently provided or verified

- No concrete Pi, Claude Code, Codex, or Gemini Adapter ships.
- Deterministic tests do not launch real specialists, and a manual behavior run does not prove effective host sandbox/tool isolation beyond the Runner's observed preflight and execution metadata.
- No npm publish workflow or release tag is present; workspace packages are currently source packages.
- Ephemeral task additions are assembled by Main for a dispatch; they are not a persisted CLI config layer.
- Prompt restrictions remain advisory and are not operating-system enforcement.
- `.agent-work` is optional Agent material, not authoritative state, and the Skill does not decide its Git ignore or commit policy.

## Reproduce

Use Node.js 22 and pnpm 10.13.1:

```bash
pnpm install --frozen-lockfile
pnpm verify
git diff --check
```

Optionally run the local, authenticated behavior baseline separately:

```bash
pnpm eval -- --list
pnpm eval -- --runner codex --repeat 1
```
