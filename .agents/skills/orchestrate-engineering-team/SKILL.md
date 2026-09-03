---
name: orchestrate-engineering-team
description: Coordinate an engineering team through one Main Skill. Dynamically resolve canonical Architecture, Development, Product Test, and Review roles, inject configured professional capabilities and materials, use host-native subagents when valuable, and fall back honestly when native role injection is unavailable. Also use when asked to configure or strengthen the engineering team.
license: MIT
metadata:
  author: HandsomeGanzige
---

# Orchestrate Engineering Team

Act as the Main Agent. Decide whether independent context, domain expertise, alternative judgement, or safe concurrency will materially improve the user's outcome. Never dispatch roles ceremonially or impose a mandatory phase order. Exit to ordinary single-Agent work for one clear change.

This is the only public Skill. Architecture, Development, Product Test, and Review are stable internal roles defined in [role-contracts.yaml](references/role-contracts.yaml), not separate Skills. Read only the selected contract immediately before dispatch. A contract is an immutable authority ceiling: configuration may add professional capabilities, materials, and native bindings or narrow permissions, but may not remove independence, grant user decision authority, or take overall coordination from Main.

## Resolve a role

For each useful specialist:

1. Build a focused task using [role-task-packet.md](assets/role-task-packet.md).
2. Read configuration layers, when present, in this order: `~/.agents/orchestrate-engineering-team.yaml`, `.agents/orchestrate-engineering-team.yaml`, `.agents/orchestrate-engineering-team.local.yaml`, then explicit task additions. Higher layers replace the same capability ID and append different IDs. `enabled: false` disables a lower-layer item.
3. Resolve requested Skills and materials. Skills add professional knowledge; they do not define role identity. A package/plugin is only a distribution or availability requirement and must not be automatically installed or trusted during dispatch.
4. Ask a configured host Adapter to validate its private binding and create a native launch plan. Prefer the host's native subagent mechanism and effective sandbox/isolation controls.
5. If no Adapter is available, use a generic prompt fallback containing the compact role contract, focused task, exact resolved Skill names/paths, and material references. Do not copy every Skill body or the entire parent conversation.

A resolved request should account for role/contract, requested capability and provenance, native Agent, mode (`native` or `prompt-fallback`), effective or unknown tools policy, sandbox, workspace isolation, and limitations. Host permissions are always the final capability ceiling. Prompt restrictions are advisory, not a sandbox.

Required capability missing: do not dispatch that specialist. Ask the user whether to degrade the requirement, use an ordinary single Agent, or cancel. Optional capability missing: continue and record the limitation. With no configuration, silently use the built-in contracts and normal generic/native dispatch.

## Choose specialists dynamically

- **Architecture**: consequential options and tradeoffs need independent investigation.
- **Development**: a focused implementation responsibility benefits from dedicated ownership.
- **Product Test**: user, business, compatibility, or stability behavior needs independent product judgement.
- **Review**: engineering correctness, integration, architecture, standards, security, performance, maintainability, or test design needs independent inspection.

Roles are optional, not mandatory phases. Main decides sequencing and completion. Product Test and Review remain independent from implementation; do not coach them toward approval. Concurrent writers need disjoint ownership or real host-provided worktree/sandbox isolation. Otherwise serialize.

Do not call bundled workflow scripts. Do not create task databases, lifecycle stages, leases, receipts, voting, or machine-managed quality gates.

## Preserve continuity and authoritative facts

Current user requests, revisions, and acceptance criteria are intent facts. Code, tests, types, configuration, diffs, and observed command results are implementation facts. Verify both from their current sources instead of treating a prior Agent summary as authoritative.

Use the discovery, search, symbol navigation, indexes, language services, or custom host capabilities appropriate to the repository. Known paths, symbols, test names, and errors are entry points, not limits on what may be inspected. The contract requires current repository discovery, not a particular tool.

Place material according to who needs it:

- Agent-only working material belongs under `.agent-work/<task>/`.
- Long-lived architecture decisions, engineering guidance, and project rules follow existing project documentation conventions.
- Implementation facts remain with the code, tests, types, executable configuration, schemas, and necessary comments that enforce or explain them.
- User collaboration material follows the user's chosen location or the project's existing issue, pull request, plan, and acceptance-report conventions.

Main may create `.agent-work/<task>/` whenever it provides useful continuity; there is no creation threshold or permission ceremony. Do not check whether it is ignored, change `.gitignore` or Git exclude, or decide whether it should be committed. Version-control treatment belongs to the user and project. Never use `.agent-work` as a lock, queue, database, lifecycle, state machine, or quality gate. Do not store full conversations, hidden reasoning, bulk tool output, or secrets. Concurrent Agents write separate files.

When a brief is useful, instantiate [main-work-brief.md](assets/main-work-brief.md) as `.agent-work/<task>/brief.md`. Main alone maintains it as a current snapshot, not an execution log. Update it when the user outcome or acceptance changes, verified repository facts or risks materially change, before a context switch or handoff, and at final delivery. It may retain compact recovery pointers such as paths, symbols, tests, and errors, but project facts and current instructions always take precedence.

To resume work, read the latest user requirements and repository/host instructions, then the brief if present; inspect the current workspace, branch, diff, and uncommitted changes; rediscover relevant code, tests, configuration, and documentation with available repository capabilities; rerun necessary validation; correct stale brief conclusions; and recompute the remaining work.

Prefer durable implementation truth in this order: clear code and types, executable tests and configuration, necessary comments or JSDoc, cross-module project documentation, then Agent working material. Development maintains comments only for non-obvious rationale, local invariants, compatibility constraints, or public contract details types cannot express, and removes stale comments with implementation changes. Never write task history into code comments.

## Capability honesty

Expose a capability summary whenever a required item is missing, Skill sources conflict, native binding falls back to a prompt, requested and effective tools/sandbox/isolation differ, or executable package/MCP/extension trust is unmet. Use `unknown` rather than inventing enforcement. Never log secrets, complete environment variables, hidden reasoning, or sensitive MCP data.

After each result, evaluate evidence rather than an envelope, reconcile contradictions from project facts, route defects to the smallest useful focused context, and ask the user only about changed outcomes, permissions, irreversible actions, material cost, or accepted risk. Keep durable facts in code, tests, configuration, documentation, and decision records.

## Configure the team

When explicitly asked to “configure the engineering team”, strengthen a role, or run `configure`:

1. Show effective configuration and provenance.
2. Ask for scope (`user`, `project`, or `local`); never choose silently.
3. Ask which role and which installed Skill, material, preferred native Agent, or adapter-specific requirement to add.
4. Treat executable adapters/packages/plugins/MCP as untrusted requirements; record but do not install them.
5. Show the diff, replacement provenance, required/optional meaning, and permission implications.
6. Write only after confirmation, then run doctor and report `resolved`, `missing`, `conflict`, or `unsupported`.

Prefer the optional `oet` CLI when it is already available: `oet config show --effective --json`, `oet config apply`, and `oet doctor`. Never run `npx --yes` automatically. The CLI package is currently source-only in this repository, so do not claim a global npm installation path exists. If the CLI is absent, prepare an unverified draft or point to the repository source; do not claim it was validated.

## Deliver one coherent outcome

Report what changed or was learned, material decisions, validation, unresolved risks, and relevant files. Mention specialist activity only where its independent evidence helps the user.
