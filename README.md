# orchestrate-engineering-team

An open Agent Skill suite for coordinating substantial delivery and exploration through Main-owned semantic work items, bounded role assignments, independent verification, and optional recursive child workflows.

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

The project-local Skill installation above is the primary distribution path. As an optional Codex-specific adapter, Codex can instead register the repository marketplace and install the Plugin:

```bash
codex plugin marketplace add HandsomeGanzige/orchestrate-engineering-team
codex plugin add orchestrate-engineering-team@orchestrate-engineering-team
```

For Plugin adapter development, clone the repository and pass the checkout path to `codex plugin marketplace add`. These commands modify the user's Codex Plugin configuration. Remove the optional adapter with:

```bash
codex plugin remove orchestrate-engineering-team@orchestrate-engineering-team
codex plugin marketplace remove orchestrate-engineering-team
```

## Quickstart

Ask Codex to use the Main Skill and describe an outcome that benefits from decomposition, maintained state, architecture work, or multiple specialist roles:

```text
Use $orchestrate-engineering-team to plan and deliver this API migration. Preserve decisions,
delegate bounded implementation, then independently verify and review the result.
```

The Main Agent first checks applicability and aligns the goal with you. A single-session style tweak, local documentation edit, or similarly bounded task exits to the normal one-agent workflow without creating `.agent-work/` or dispatching a role. For qualifying work, Main creates one semantic project-local Work Item such as:

```text
.agent-work/
|-- open/
    `-- api-migration/
        |-- work.md
        |-- state.json
        `-- children/
|           `-- independently-acceptable-subgoal/
|               |-- work.md
|               `-- state.json
`-- archive/
```

Each Work Item Main owns one `work.md`: direct Markdown prose and checklists describing the outcome, confirmed scope and decisions, current work, completed delivery facts, child contracts, open issues, and authoritative project references. A sibling `state.json` carries disposable claims, leases, active routing, votes, and other machine coordination while the item is open. Architecture, Development, Test, Review, Retest, and Rereview are transient Assignments; they create no task documents, directories, retained role reports, or hand-maintained history entries.

The owner Main is the only writer of its Work Item's `work.md` and `state.json`. A Child Main independently owns the corresponding files below its child directory. The parent retains only the child's delivery contract, document link, acceptance, returned result, and artifact references; it never mirrors child internals. These instructions and advisory profiles express collaboration boundaries, not runtime filesystem isolation.

On completion, the helper curates the Work Item tree for archival, removes runtime-only `state.json`, and retains the user-readable `work.md` documents under `.agent-work/archive/`. Default discovery, resume, handoff, and role-packet operations exclude the archive; explicit history access selects lightweight candidates before opening a completed document. Durable engineering knowledge belongs in project code, tests, configuration, contracts, constraints, or decision documents, with the completed Work Item recording factual delivery references rather than becoming a second knowledge base. Add `.agent-work/` to the target project's ignore rules if these retained delivery records should remain local.

## Roles

| Role | Responsibility | Project writes |
| --- | --- | --- |
| Main Agent | Coordinates the workflow, talks to the user, and exclusively maintains its Work Item documents and state | Its owned `work.md` and `state.json` only; no production coding after orchestration begins |
| Architecture Agent | Investigates complex choices and returns decision-ready alternatives | Read-only; conclusions are transient |
| Development Agent | Implements an explicitly bounded change and implementation-owned tests | Assigned files only |
| Test Agent | Independently verifies delivered behavior | Read-only except disposable artifacts produced by authorized checks |
| Review Agent | Reviews correctness, alignment, risk, and maintainability | Read-only |

The four internal role Skills disable implicit invocation in their Codex UI metadata. They are meant to be attached explicitly by the Main Skill.

Every normal role and Child Main dispatch explicitly sets `fork_turns: "none"`. A generated role packet carries only the Assignment, completion conditions, allowed scope, relevant confirmed decisions, exact authoritative project pointers, capabilities, and the fixed return envelope. Role results contain `status`, up to three `summary` entries, `artifacts`, `files`, concise `checks`, separate Test/Review votes and reasons, and actionable `blockers`; they are transient messages and omit process logs, private reasoning, parent-task restatement, and archived history.

Test and Review default to running for qualifying code work. They may be waived separately only after Development results exist and the deterministic vote rules find sufficient evidence that independent validation adds no meaningful signal.

## Deterministic workflow helper

The Main Skill bundles `scripts/workflow.mjs`, a Node.js-built-in-only command-line helper for plain Work Item documents, separate coordination state, claims and leases, todos, operational Assignments, votes, child synchronization, compact packets and handoffs, open-work discovery, explicit history access, archival completion, and validation. It never starts or stops agents and does not execute production code:

```bash
node .agents/skills/orchestrate-engineering-team/scripts/workflow.mjs <command> [options]
```

`work.md` is the single semantic document for its Work Item; sibling `state.json` is intentionally separate disposable machine coordination. Semantic boundaries use plain CommonMark ATX heading text with one to three leading spaces, optional closing hashes, collapsed whitespace, and case-insensitive reserved names; inline emphasis, code, links, and escapes are not normalized into reserved names. Valid fenced code and indented code are ignored, while Setext headings are deliberately ordinary content rather than workflow boundaries. The helper publishes the pair through a hash-only recovery journal, journals child creation until its parent projection is registered, removes operational state when archiving completed work, and keeps only a bounded non-semantic completion receipt for lost-response retries. Raw workspace paths are checked before normalization. Every complete high-level workflow command serializes through one atomic project-lock directory preceded by an atomically published creator claim carrying PID, nonce, and process-start identity; a live pre-owner creator is never reclaimed by elapsed age, while a provably dead creator authorizes recovery of its incomplete directory. Published owner recovery remains bound to the exact lock inode and the process-start token available from Linux `/proc` or macOS `ps`. Other platforms use a bounded heartbeat plus conservative PID liveness and never steal a claim or lock whose owner cannot be proven dead. Waiters create no owner records. Private archive stages and cleanup quarantines use unpredictable names plus captured filesystem identities; failed archive relocation is durably pre-journaled with both intended and previous identity-bound locations, and stale stages are removed only through inactive attempt journals while unrelated recovery data is retained. Cleanup authorization records source, descendant, trusted-root, and quarantine identities before rename-based ownership transfer, after which compliant workflow commands cannot access the detached object until removal finishes. The trust boundary is other same-user, out-of-band filesystem mutation: portable Node has no directory-handle-relative unlink API, so such a process can still race a pathname after an identity check and force a fail-closed interruption. The protocol does not claim to prevent that hostile mutation, expand cleanup authorization, or make descendant symlink targets eligible for deletion.

## Runtime, permissions, and security boundaries

- The workflow requires a Codex runtime with native subagent tools. Repository CI validates metadata, copied-package structure, project-scoped installation of all five Skills with `skills@1.5.19`, and the optional Codex CLI Plugin lifecycle. Multi-agent outcomes still depend on the runtime, project, and user-approved capabilities.
- Claude Marketplace packaging and `.codex/agents` adapters are intentionally not included.
- `agent-profiles.yaml` is an advisory routing and capability contract. It documents intended read/write boundaries but does not create runtime sandboxing or tool isolation.
- The Main Skill needs workspace read access and permission to create or update its owned `.agent-work/` document and state. A dispatched Development Agent may need workspace write and shell access within its task package. Architecture and Review remain read-only; Test may create only disposable artifacts as a consequence of authorized checks.
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
docs/acceptance-report.md     # C01-C20 deterministic/forward evidence record
```

## Validate locally

```bash
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs the Agent Skills/UI/profile checker, named-function JSDoc coverage, all Node tests, and a no-network structural smoke check against a temporary copied package. It verifies the plain `work.md`/separate `state.json` contract, retained-but-context-excluded archives, transient compact role envelopes, explicit empty-history/Main-only instructions, Skill-local templates/references/workflow runtime, optional Plugin metadata, and absence of npm runtime dependencies. Individual commands are `pnpm check`, `pnpm check:jsdoc`, `pnpm test`, and `pnpm check:package`.

The pinned external installer check, `pnpm smoke:skill-install`, requires network access and is intentionally separate from local verification. It copies the canonical Skills into a temporary local source Git repository, then exercises install, observable refresh by re-running the install command, and named removal in another temporary Git repository. It validates all five Skills and bundled paths after install/refresh, the removed directories and retained lock entries after removal, source immutability, child-home isolation, and final fixture cleanup. CI runs that primary lifecycle before the separate optional Codex Plugin lifecycle job.

## Contributing

The five Skills remain the primary installation unit. User-visible changes are recorded in [CHANGELOG.md](CHANGELOG.md), and acceptance evidence is recorded in [docs/acceptance-report.md](docs/acceptance-report.md). Contribution setup, metadata rules, test expectations, and pull-request guidance are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright 2026 HandsomeGanzige. Released under the [MIT License](LICENSE).
