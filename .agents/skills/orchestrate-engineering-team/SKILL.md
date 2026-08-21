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

Do not call bundled workflow scripts. Do not create workflow state, `.agent-work`, task databases, lifecycle stages, leases, receipts, voting, or machine-managed quality gates.

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

Prefer the optional `oet` CLI when installed: `oet config show --effective --json`, `oet config apply`, and `oet doctor`. Never run `npx --yes` automatically. If the CLI is absent, provide `npm install --global @orchestrate-engineering-team/cli` and may prepare an unverified draft; do not claim it was validated.

## Deliver one coherent outcome

Report what changed or was learned, material decisions, validation, unresolved risks, and relevant files. Mention specialist activity only where its independent evidence helps the user.
