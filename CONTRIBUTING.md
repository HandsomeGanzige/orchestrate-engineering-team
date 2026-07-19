# Contributing

Thank you for improving `orchestrate-engineering-team`. Bug fixes, clearer instructions, compatibility reports, tests, and focused workflow improvements are welcome.

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
- Treat the project-local five-Skill GitHub installation as the primary distribution contract. Keep the installer version and its non-interactive `--skill '*' --agent codex --yes` semantics pinned in documentation and CI.
- Every `SKILL.md` must use only current Agent Skills frontmatter fields and must retain `license: MIT`. `name`, length, type, metadata, and compatibility constraints are enforced by the checker.
- Describe Codex/native-subagent requirements accurately. Open-format compatibility is not a claim of cross-platform runtime compatibility.
- Keep internal Architecture, Development, Test, and Review Skills explicitly invoked with `policy.allow_implicit_invocation: false`. The Main Skill remains implicitly invocable.
- Treat `references/agent-profiles.yaml` as advisory. Do not describe its capability lists as enforced isolation.
- Keep the Codex Plugin and marketplace files optional. Their paths must remain relative to the Plugin/marketplace root and begin with `./`; they must point to the canonical Skill suite rather than become a required or duplicate distribution path.
- Do not commit project-specific `.agent-work/`, credentials, caches, or generated dependency directories.

## Tests

Run `pnpm verify` before opening a pull request. It covers:

- Agent Skills frontmatter and Codex UI metadata;
- role registry, advisory capabilities, paths, and return contracts;
- parser error handling and fail-closed schemas;
- a temporary copied-package structural smoke check of the canonical Skills, registry resources, and optional Plugin adapter.

When changing validation behavior, add a success case and a precise failure case. When changing packaging, extend the copied-package check rather than validating only the source tree.

GitHub Actions separately runs `pnpm smoke:skill-install`: it uses the pinned external installer to install all five Skills from an isolated local source Git repository into a clean temporary target Git repository, deliberately alters one installed file, refreshes the suite by re-running the same install command, and removes the five named Skills. The check requires valid Skills/resources after install and observable refresh, absent Skill directories plus the documented five retained `skills-lock.json` entries after removal, an unchanged source worktree, isolated child user/global state, and full temporary cleanup. This networked lifecycle is the primary distribution check and must not join no-network `pnpm verify`. A later, separate job exercises the optional Plugin marketplace add, Plugin add, native Skill discovery, list, remove, and marketplace removal with the pinned supported Codex CLI and an isolated configuration.

## Pull requests

Keep pull requests focused and explain the user-visible behavior, compatibility impact, and verification performed. Update `CHANGELOG.md` for notable changes. Use an issue first when a change would add a new runtime adapter, alter role authority, or change the confirmed workflow model.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
