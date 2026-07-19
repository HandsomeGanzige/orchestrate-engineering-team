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

The repository currently has no third-party runtime dependencies. Validation uses a pinned development dependency and lockfile. `package.json` remains private because npm is not a distribution channel.

## Repository contracts

- Keep `.agents/skills/` canonical. Do not duplicate the Skill directories under another packaging path.
- Every `SKILL.md` must use only current Agent Skills frontmatter fields and must retain `license: MIT`. `name`, length, type, metadata, and compatibility constraints are enforced by the checker.
- Describe Codex/native-subagent requirements accurately. Open-format compatibility is not a claim of cross-platform runtime compatibility.
- Keep internal Architecture, Development, Test, and Review Skills explicitly invoked with `policy.allow_implicit_invocation: false`. The Main Skill remains implicitly invocable.
- Treat `references/agent-profiles.yaml` as advisory. Do not describe its capability lists as enforced isolation.
- Keep Plugin and marketplace paths relative to the Plugin/marketplace root and beginning with `./`.
- Do not commit project-specific `.agent-work/`, credentials, caches, or generated dependency directories.

## Tests

Run `pnpm verify` before opening a pull request. It covers:

- Agent Skills frontmatter and Codex UI metadata;
- role registry, advisory capabilities, paths, and return contracts;
- parser error handling and fail-closed schemas;
- a temporary copied-package structural smoke check of marketplace, Plugin, Skills, and registry resources.

When changing validation behavior, add a success case and a precise failure case. When changing packaging, extend the copied-package check rather than validating only the source tree. GitHub Actions separately exercises Plugin marketplace add, Plugin add, native discovery of the five installed Skills, list, remove, and marketplace removal with the pinned supported Codex CLI in an isolated disposable configuration; do not run that lifecycle script as part of local `pnpm verify`.

## Pull requests

Keep pull requests focused and explain the user-visible behavior, compatibility impact, and verification performed. Update `CHANGELOG.md` for notable changes. Use an issue first when a change would add a new runtime adapter, alter role authority, or change the confirmed workflow model.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
