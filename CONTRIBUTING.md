# Contributing

Thank you for improving `orchestrate-engineering-team`. Bug fixes, clearer instructions, tests, and focused workflow improvements are welcome.

## Development setup

Use Node.js 22 and the pinned pnpm release:

```bash
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install --frozen-lockfile
pnpm verify
```

The repository currently has no third-party runtime dependencies. Validation uses a pinned development dependency and lockfile. `package.json` remains private because the open Skill suite is distributed from GitHub and this project must not be published to npm; the README's `npx` command runs the external `skills@1.5.19` installer.

## Repository contracts

- Keep `.agents/skills/` canonical. Do not duplicate the Skill directories under another packaging path.
- Treat the project-local five-Skill GitHub installation as the primary distribution contract. Keep the installer pinned and preserve its non-interactive `--skill '*' --agent codex --yes` semantics in documentation and CI.
- Every `SKILL.md` must use only current Agent Skills frontmatter fields and must retain `license: MIT`. `name`, length, type, and metadata constraints are enforced by the checker.
- Describe Codex/native-subagent runtime requirements accurately.
- Keep internal Architecture, Development, Test, and Review Skills explicitly invoked with `policy.allow_implicit_invocation: false`. The Main Skill remains implicitly invocable.
- Treat `references/agent-profiles.yaml` as advisory. Do not describe its capability lists, material scopes, or Main-only state rule as enforced isolation.
- Preserve the workflow domain boundary: a Main-owned Work Item has one `index.md`; role executions are Assignments without directories; only independently acceptable, recursively coordinated subgoals become Child Work Items.
- Every normal role and Child Main dispatch must explicitly set `fork_turns: "none"`. Task packets must remain minimal and every role return must use the compact role envelope (`status`, at most three `summary` entries, `artifacts`, `files`, `checks`, separate Test/Review votes and reasons, and `blockers`).
- Keep the Main Skill resources at `assets/{workspace-index,work-item-index,role-task-packet}.md`, `references/{agent-profiles.yaml,state-and-voting.md}`, and `scripts/{workflow,workflow-core}.mjs`. Renames must update the checker, copied-package check, installer smoke, and public documentation together.
- Keep the bundled workflow runtime dependency-free: its entry and local modules may import only Node.js built-ins or other bundled relative workflow modules. The repository's locked dev-only YAML dependency is allowed for validation, but do not add a `dependencies` block to `package.json`.
- Keep the Codex Plugin and marketplace files optional. Their paths must remain relative to the Plugin/marketplace root and begin with `./`; they must point to the canonical Skill suite rather than become a required or duplicate distribution path.
- Do not commit project-specific `.agent-work/`, credentials, caches, or generated dependency directories.

## Tests

Run `pnpm verify` before opening a pull request. It covers:

- Agent Skills frontmatter and Codex UI metadata;
- role registry, advisory capabilities, paths, and return contracts;
- explicit empty-history dispatch, Main-only Work Item state, and role state-write prohibitions;
- parser error handling and fail-closed schemas;
- a temporary copied-package structural smoke check of the canonical Skills, templates, references, built-in-only workflow runtime, and optional Plugin adapter.

Use [docs/acceptance-report.md](docs/acceptance-report.md) for C01-C20 release evidence. Keep a criterion `pending` until its named deterministic check or forward multi-agent scenario has actually run; static wording or an implementation diff is not behavioral proof.

When changing validation behavior, add a success case and a precise failure case. When changing packaging, extend the copied-package check rather than validating only the source tree.

GitHub Actions separately runs `pnpm smoke:skill-install`: it uses the pinned external installer to install all five Skills from an isolated local source Git repository into a clean temporary target Git repository, deliberately alters one installed file, refreshes the suite by re-running the same install command, and removes the five named Skills. The check requires valid Skills/resources after install and observable refresh, absent Skill directories plus the documented five retained `skills-lock.json` entries after removal, an unchanged source worktree, isolated child user/global state, and full temporary cleanup. This networked lifecycle is the primary distribution check and must not join no-network `pnpm verify`. A later, separate job exercises the optional Plugin marketplace add, Plugin add, native Skill discovery, list, remove, and marketplace removal with the pinned supported Codex CLI and an isolated configuration.

## Pull requests

Keep pull requests focused and explain the user-visible behavior, runtime impact, and verification performed. Update `CHANGELOG.md` for notable changes. Use an issue first when a change would add a new runtime adapter, alter role authority, or change the confirmed workflow model.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
