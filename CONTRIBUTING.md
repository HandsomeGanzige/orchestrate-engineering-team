# Contributing

Use Node.js 22 and pnpm 10.13.1. Run:

```bash
pnpm install --frozen-lockfile
pnpm verify
git diff --check
```

## Architecture invariants

- `.agents/skills/` contains exactly one public Skill: `orchestrate-engineering-team`.
- The four stable roles live in `.agents/skills/orchestrate-engineering-team/references/role-contracts.yaml`; do not recreate public Role Skills or compatibility shims.
- Role Contracts own authority and independence. Configuration and Adapters may narrow but never expand them.
- Architecture is read-only for code, tests, executable configuration, and dependencies. It may write explicitly assigned Agent working files or project documentation only when the host supplies effective write access; an `AGENTS.md` change must be explicitly assigned.
- Keep configuration and Adapter contract packages host-neutral. Concrete host support belongs in independently trusted adapter packages.
- Main uses host-native subagents and may keep non-authoritative continuity material in `.agent-work/<task>/`. Never turn it into lifecycle state, a workflow runtime, locks, leases, receipts, voting, or quality gates.
- The Skill does not inspect or manage `.agent-work` Git ignore/exclude/commit policy. Preserve the user's and project's version-control decision.
- Repository discovery requirements must describe capabilities and evidence, not mandate a particular search command or index implementation.
- No dispatch/configuration path automatically installs or executes a package, plugin, extension, MCP server, or Adapter.

## Changes

Update tests for role contract/schema behavior, continuity resources, Architecture write boundaries, fallback prompt completeness, merge precedence, required/optional capabilities, material path safety, Adapter conformance, CLI exit codes, and single-Skill distribution shape. Keep the two config schema copies byte-identical. Keep generated or local configuration out of commits unless it is an intentional fixture.

Keep documentation claims within the boundaries recorded in `docs/acceptance-report.md`: local Skill installation is a copied fixture, concrete host Adapters do not ship, and workspace packages are not registry-installed until a publication path exists. Update `README.md`, package READMEs, the acceptance report, design decision, and changelog when those facts change.

For security-sensitive changes, distinguish advisory prompt restrictions from effective host sandbox/tool enforcement and avoid recording secrets or hidden reasoning.

Behavior cases under `evals/cases/` combine deterministic safety checks with an independent semantic rubric. Run `pnpm eval -- --list` to inspect them and use `pnpm eval -- --runner codex --repeat 1` only when a manual, authenticated model run is intended. Never add it to CI or `pnpm verify`, pin a model as the repository default, or commit `evals/.runs/`. Preserve a failed first run as the local baseline; correct harness, fixture, or clear hard-check mistakes before considering a separate Skill-tuning change.
