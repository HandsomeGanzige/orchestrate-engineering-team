# Acceptance report: current v1 repository state

This report describes the checks present in the repository. It is not evidence of npm publication, a live remote install, or production behavior in every host.

## Verified product shape

`pnpm verify` checks that:

- `.agents/skills/` contains only `orchestrate-engineering-team`;
- the Main Skill contains the three supporting resources plus `SKILL.md` and Codex UI metadata;
- exactly four internal Role Contracts exist: architecture, development, product-test, and review;
- former public Role Skill directories are rejected;
- the Skill config schema and package config schema remain byte-identical;
- host-neutral core files do not contain the host-specific references prohibited by the static check.

The Main Skill behavior checks are static contract checks. They confirm required instructions and resources are present; they do not launch real specialist Agents.

## Verified library and CLI behavior

The current 18 Node test cases cover:

- strict config parsing, layer replacement/disable behavior, provenance, required/optional Skill diagnosis, and material traversal/symlink rejection;
- Adapter shape and LaunchPlan validation, authority-expansion rejection, and generic prompt fallback;
- CLI local init, apply/show JSON, required-missing and Adapter-unavailable exit codes;
- copied-repository shape and local one-Skill installation fixtures.

Package smoke tests pack `config`, `adapter-contract`, and `cli`, install their tarballs into a clean temporary directory, run CLI help, and reject test or `node_modules` content in the tarballs.

## CI-only integration

GitHub Actions installs a pinned Codex CLI and exercises marketplace add, Plugin add/discovery, and cleanup in a disposable runner. The lifecycle script intentionally refuses to run outside that environment.

The `smoke:skill-install` check is a local copied fixture. It validates the installed directory shape but does **not** execute the README's remote `npx skills add` command.

## Not currently provided or verified

- No concrete Pi, Claude Code, Codex, or Gemini Adapter ships.
- No test launches a real specialist through an Adapter or proves effective host sandbox/tool isolation.
- No npm publish workflow or release tag is present; workspace packages are currently source packages.
- Ephemeral task additions are assembled by Main for a dispatch; they are not a persisted CLI config layer.
- Prompt restrictions remain advisory and are not operating-system enforcement.

## Reproduce

Use Node.js 22 and pnpm 10.13.1:

```bash
pnpm install --frozen-lockfile
pnpm verify
git diff --check
```
