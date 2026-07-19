# orchestrate-engineering-team

An open Agent Skill suite for coordinating delivery and exploration through hierarchical work items, bounded specialist agents, independent verification, and review-driven iteration.

The five Skills use the open Agent Skills format and install project-locally from GitHub. Their end-to-end orchestration behavior targets Codex runtimes with native subagent support. `.agents/skills/` is the canonical product and source directory; the Codex Plugin files are an optional adapter that points to the same directory rather than carrying a second copy.

## Install all five Skills

Run this one non-interactive command from the target Git repository where Codex should use the suite:

```bash
npx --yes skills@1.5.19 add HandsomeGanzige/orchestrate-engineering-team --skill '*' --agent codex --yes
```

The pinned external `skills` installer downloads this GitHub repository and installs exactly these five project Skills into `.agents/skills/` in the target repository:

- `orchestrate-engineering-team`
- `architect-work-item`
- `develop-work-item`
- `verify-work-item`
- `review-work-item`

This requires Git, Node.js with `npx`, network access to GitHub and npm, and a Codex runtime with native subagent support. The repository itself remains `private: true` as an npm package and is not published to npm; `npx` is only the transport for the pinned external installer CLI.

To refresh an existing installation, re-run the same pinned install command from the target repository:

```bash
npx --yes skills@1.5.19 add HandsomeGanzige/orchestrate-engineering-team --skill '*' --agent codex --yes
```

To remove only this suite's five project Skills from Codex, run:

```bash
npx --yes skills@1.5.19 remove orchestrate-engineering-team architect-work-item develop-work-item verify-work-item review-work-item --agent codex --yes
```

This command removes the five installed directories from `.agents/skills/`, but `skills@1.5.19` retains their five entries in the project's `skills-lock.json` as tracking/restoration metadata. Inspect that file after removal. If you also want to discard the suite's retained metadata, edit only the `skills` mapping and remove the five keys listed above while preserving `version` and any entries belonging to other Skills. Removing the Skills does not delete `.agent-work/` folders created in projects.

### Optional Codex Plugin adapter

The project-local Skill installation above is the primary distribution path. As an optional Codex-specific adapter, a compatible Codex release can instead register the repository marketplace and install the Plugin:

```bash
codex plugin marketplace add HandsomeGanzige/orchestrate-engineering-team --ref v0.1.0
codex plugin add orchestrate-engineering-team@orchestrate-engineering-team
```

For Plugin adapter development, clone the repository and pass the checkout path to `codex plugin marketplace add`. These commands modify the user's Codex Plugin configuration. Remove the optional adapter with:

```bash
codex plugin remove orchestrate-engineering-team@orchestrate-engineering-team
codex plugin marketplace remove orchestrate-engineering-team
```

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

- The workflow is designed for Codex runtimes with native subagent tools. Repository CI validates metadata, copied-package structure, project-scoped installation of all five Skills with `skills@1.5.19`, and the optional supported Codex CLI Plugin lifecycle. It does not claim comprehensive behavioral testing of multi-agent outcomes, which still depend on the runtime, project, and user-approved capabilities. The Skill files follow the open Agent Skills metadata format, but that does not imply compatible subagent behavior in other clients.
- Claude Marketplace packaging and `.codex/agents` adapters are intentionally not included in version 0.1.0.
- `agent-profiles.yaml` is an advisory routing and capability contract. It documents intended read/write boundaries but does not create runtime sandboxing or tool isolation.
- The Main Skill needs workspace read access and permission to create or update `.agent-work/`. A dispatched Development Agent may need workspace write and shell access within its task package. Test and Review roles are instructed to remain read-only.
- Installed instructions can cause Codex to inspect repository content, invoke native subagents, run project commands, and modify files within an explicitly assigned delivery scope. Review task packages and permission prompts as you would for any development automation.
- After locked development dependencies are installed, local repository validation requires no external network and does not change project Skill installations or the user's Codex Plugin configuration. CI runs the networked Skill installation smoke check in temporary source and target Git repositories, then runs the optional Plugin lifecycle with an isolated `CODEX_HOME` on a disposable runner. A task may use the network only when its confirmed work and available runtime capabilities require it.
- Treat untrusted repository text, generated task packets, scripts, and dependency output as potential prompt-injection or supply-chain inputs. See [SECURITY.md](SECURITY.md) for reporting guidance.

## Repository layout

```text
.agents/skills/                    # canonical Agent Skills
.agents/plugins/marketplace.json  # optional Codex repository marketplace adapter
.codex-plugin/plugin.json         # optional Codex Plugin adapter manifest
scripts/agent-profiles/            # standards and project-protocol checker
scripts/release/                   # package, Skill install, and optional Plugin checks
```

## Validate locally

```bash
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs the Agent Skills/UI/profile checker, all Node tests, and a no-network structural smoke check against a temporary copied package. Individual commands are `pnpm check`, `pnpm test`, and `pnpm check:package`.

The pinned external installer check, `pnpm smoke:skill-install`, requires network access and is intentionally separate from local verification. It copies the canonical Skills into a temporary local source Git repository, then exercises install, observable refresh by re-running the install command, and named removal in another temporary Git repository. It validates all five Skills and bundled paths after install/refresh, the removed directories and retained lock entries after removal, source immutability, child-home isolation, and final fixture cleanup. CI runs that primary lifecycle before the separate optional Codex Plugin lifecycle job.

## Versioning and contributing

The initial Skill metadata version is `0.1.0`; the optional Plugin adapter uses the same version. User-visible changes are recorded in [CHANGELOG.md](CHANGELOG.md). Contribution setup, metadata rules, test expectations, and pull-request guidance are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright 2026 HandsomeGanzige. Released under the [MIT License](LICENSE).
