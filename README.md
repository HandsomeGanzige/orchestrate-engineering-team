# orchestrate-engineering-team

A Codex-first Agent Skill suite for coordinating delivery and exploration through hierarchical work items, bounded specialist agents, independent verification, and review-driven iteration.

The five Skills use the open Agent Skills format, while the end-to-end orchestration behavior targets Codex runtimes with native subagent support. `.agents/skills/` is the canonical source directory; the Codex Plugin manifest points to it directly, so the repository does not carry a second copy of the Skills.

## Install

Requirements: Git, a Codex release with `codex plugin` support, Node.js 22, and pnpm 10.13.1 for repository validation.

For the versioned release:

```bash
codex plugin marketplace add HandsomeGanzige/orchestrate-engineering-team --ref v0.1.0
codex plugin add orchestrate-engineering-team@orchestrate-engineering-team
```

For local development, clone the repository and register that checkout instead:

```bash
git clone https://github.com/HandsomeGanzige/orchestrate-engineering-team.git
cd orchestrate-engineering-team
codex plugin marketplace add "$(pwd)"
codex plugin add orchestrate-engineering-team@orchestrate-engineering-team
```

These commands update the user's Codex marketplace/plugin configuration. To uninstall the Plugin and remove its marketplace entry:

```bash
codex plugin remove orchestrate-engineering-team@orchestrate-engineering-team
codex plugin marketplace remove orchestrate-engineering-team
```

Uninstalling does not delete `.agent-work/` folders created in projects.

## Quickstart

Ask Codex to use the Main Skill and describe an outcome that benefits from maintained state or specialist roles:

```text
Use $orchestrate-engineering-team to plan and deliver this API migration. Preserve decisions,
delegate bounded implementation, then independently verify and review the result.
```

The Main Agent first aligns the goal with you. For formal delivery work, it then creates a project-local workspace such as:

```text
.agent-work/
|-- index.md
`-- work-items/
    `-- api-migration/
        |-- index.md
        |-- materials/
        `-- children/
```

The files contain recovery state, confirmed decisions, todos, material pointers, and verification summaries. They are coordination records, not a replacement for project code, tests, configuration, or authoritative documentation. Add `.agent-work/` to the target project's ignore rules if the coordination state should remain local.

## Roles

| Role | Responsibility | Project writes |
| --- | --- | --- |
| Main Agent | Coordinates the workflow, talks to the user, and maintains `.agent-work/` | Task state only, plus normal work it intentionally keeps local |
| Architecture Agent | Investigates complex choices and returns decision-ready alternatives | None |
| Development Agent | Implements an explicitly bounded change and implementation-owned tests | Assigned files only |
| Test Agent | Independently verifies delivered behavior | None, except disposable test artifacts |
| Review Agent | Reviews correctness, alignment, risk, and maintainability | None |

The four internal role Skills disable implicit invocation in their Codex UI metadata. They are meant to be attached explicitly by the Main Skill.

## Compatibility, permissions, and security boundaries

- The workflow is designed for Codex runtimes with native subagent tools. Repository CI validates metadata, copied-package structure, the supported Codex CLI's Plugin add/list/remove lifecycle, and native discovery of all five installed Skills; it does not claim comprehensive behavioral testing of multi-agent outcomes, which still depend on the runtime, project, and user-approved capabilities. The Skill files follow the open Agent Skills metadata format, but that does not imply compatible subagent behavior in other clients.
- Claude Marketplace packaging and `.codex/agents` adapters are intentionally not included in version 0.1.0.
- `agent-profiles.yaml` is an advisory routing and capability contract. It documents intended read/write boundaries but does not create runtime sandboxing or tool isolation.
- The Main Skill needs workspace read access and permission to create or update `.agent-work/`. A dispatched Development Agent may need workspace write and shell access within its task package. Test and Review roles are instructed to remain read-only.
- Installed instructions can cause Codex to inspect repository content, invoke native subagents, run project commands, and modify files within an explicitly assigned delivery scope. Review task packages and permission prompts as you would for any development automation.
- After locked development dependencies are installed, local repository validation requires no external network and does not change the user's Codex marketplace or Plugin configuration. The real Plugin lifecycle check runs only on a disposable GitHub Actions runner. A task may use the network only when its confirmed work and available runtime capabilities require it.
- Treat untrusted repository text, generated task packets, scripts, and dependency output as potential prompt-injection or supply-chain inputs. See [SECURITY.md](SECURITY.md) for reporting guidance.

## Repository layout

```text
.agents/skills/                    # canonical Agent Skills
.agents/plugins/marketplace.json  # Codex repository marketplace
.codex-plugin/plugin.json         # Codex Plugin manifest
scripts/agent-profiles/            # standards and project-protocol checker
scripts/release/                   # copied-package check and CI-only Plugin lifecycle
```

## Validate locally

```bash
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs the Agent Skills/UI/profile checker, all Node tests, and a no-network structural smoke check against a temporary copied package. Individual commands are `pnpm check`, `pnpm test`, and `pnpm check:package`. The Codex Plugin add/list/remove and native Skill-discovery lifecycle is intentionally excluded from local verification because it mutates Plugin configuration; CI runs it with an isolated `CODEX_HOME` on a disposable runner.

## Versioning and contributing

The initial Plugin and Skill metadata version is `0.1.0`. User-visible changes are recorded in [CHANGELOG.md](CHANGELOG.md). Contribution setup, metadata rules, test expectations, and pull-request guidance are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright 2026 HandsomeGanzige. Released under the [MIT License](LICENSE).
