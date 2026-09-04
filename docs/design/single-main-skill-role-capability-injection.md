# Single Main Skill and configurable role capability injection

**Status:** accepted and implemented in the current `1.0.0` workspace.

## Decision

The product publishes one top-level public Skill: `orchestrate-engineering-team`. Architecture, Development, Product Test, and Review are stable internal Role Contracts. Professional Skills are optional capabilities attached by configuration; focused internal guidance may be bundled behind Main's progressive disclosure; packages/plugins are distribution sources; host Adapters translate a resolved role into native launch settings.

This replaces the former five-Skill design. There are no compatibility shims.

## Terms and layers

- **Role Contract**: immutable purpose, routing, authority ceiling, independence, capability intent, context, and returns in `.agents/skills/orchestrate-engineering-team/references/role-contracts.yaml`.
- **Professional capability**: an installed Skill or safe material reference that improves domain work without defining role identity.
- **Adapter**: trusted executable host integration implementing detect, binding validation, resolve, optional scaffold, and diagnose.
- **Resolved role request**: the focused task, selected contract, resolved capability status/provenance, host facts, and known limitations assembled for one dispatch.
- **LaunchPlan**: the Adapter contract's validated host launch fields: Adapter, Agent, mode, tools policy, sandbox, isolation, limitations, and optional granted capabilities/prompt.

Main alone decides whether and how to delegate and synthesizes results. Adapters cannot expand canonical authority or coordinate the overall task.

## Continuity and material ownership

Current user requirements and acceptance criteria are intent facts; current code, tests, configuration, diffs, and observed results are implementation facts. Main and specialists verify these sources using suitable host discovery and semantic-navigation capabilities rather than depending on a specific search command.

Main may keep non-authoritative working material under `.agent-work/<task>/` and instantiate the bundled `assets/main-work-brief.md` as `brief.md`. The brief is a replaceable current snapshot for recovery pointers and open work, not a history or source of truth. `.agent-work` is not a workflow state machine, lock, queue, database, lifecycle, or quality gate. The Skill neither inspects nor changes Git ignore, exclude, or commit policy for that directory.

Long-lived architecture guidance follows project documentation conventions. Implementation truth remains in code, types, tests, executable configuration, schemas, and necessary comments. User collaboration artifacts follow the user's chosen or project-established location.

## Bundled Review retrievability guidance

The Main Skill bundles a progressively disclosed reference at `references/retrievability-review.md`. It is neither a fifth role nor a separately invocable Skill. Main reads it only for a focused Review after a material interface, cross-module, security, compatibility, migration, or architecture change when independent fresh-context inspection can expose knowledge that future Agents would otherwise miss.

The guidance keeps Review read-only. It audits discovery cost, canonical ownership, current evidence, stale or superseded material, and retrieval noise; it does not reward documentation or tag count and does not introduce a repository-wide taxonomy without a separate project decision. Main evaluates its findings and routes accepted code/type/test/configuration/comment repairs to Development or confirmed architecture documentation repairs to explicitly write-enabled Architecture.

## Architecture documentation authority

Architecture is code-read-only, not fully filesystem-read-only. Its contract permits optional `workspace-write` for explicitly assigned Agent working files and project documentation. Production code, tests, executable configuration, dependencies, user decisions, and overall coordination remain prohibited. If effective write access is unavailable, Architecture returns recommendations or a patch for Main to route.

Architecture may author decisions, system boundaries, interface and compatibility principles, design guides, README architecture sections, confirmed Agent constraints, and maintainable diagram sources. Unconfirmed proposals stay in Agent working material or an established proposal directory. Established rules require confirmation within the user/Main authority, and `AGENTS.md` is writable only as an explicit assignment. Long-lived documents record status, scope, rationale, invariants, compatibility constraints, related implementation, and supersession, and are linked from an existing documentation entry point.

## Configuration

Persistent configuration uses `apiVersion: orchestrate-engineering-team/v1` at, from lowest to highest precedence:

1. `~/.agents/orchestrate-engineering-team.yaml`
2. `.agents/orchestrate-engineering-team.yaml`
3. `.agents/orchestrate-engineering-team.local.yaml`

Main may add ephemeral task-specific capabilities after those files and before the host permission ceiling. The config package and CLI load only the three persistent files; task additions are not persisted by the CLI.

Only `architecture`, `development`, `product-test`, and `review` are accepted. Capability items have stable IDs. Different IDs append; a higher layer replaces the complete item with the same ID; `enabled: false` disables it. Unknown portable fields, duplicate IDs, and unsafe private YAML values fail validation.

```yaml
apiVersion: orchestrate-engineering-team/v1
roles:
  development:
    capabilities:
      skills:
        - id: frontend
          ref: acme-frontend-development
          required: false
      materials:
        - id: standards
          path: docs/engineering/standards.md
          required: true
    hostBindings:
      preferred: team-development
      adapters:
        example-host:
          agent: team-development
```

Project materials must be relative and remain inside the real project root after symlink resolution. External user materials require a user-layer entry with `scope: user`. Required missing capabilities block that specialist; optional missing capabilities become visible limitations. No configuration is a valid baseline.

## Dispatch and fallback

An Adapter implements `detect`, `validateBinding`, `resolve`, and `diagnose`; `scaffold` is optional. `resolve` returns a LaunchPlan and `diagnose` reports at least a limitations array. The current core ships only the protocol, fixtures, conformance helper, and generic fallback—not Pi, Claude Code, Codex, or Gemini adapters.

Without an Adapter, Main builds a compact prompt from the complete role purpose, route, authority, independence, write scope, prohibited capabilities, professional guidance, focused task, exact resolved Skill/material references with status and provenance, actual limitations, returns, and explicitly unknown host boundaries. It then uses the host's normal subagent mechanism without copying the whole parent conversation or claiming unverified enforcement.

## Interaction and CLI

Explicit team configuration first shows effective values/provenance, asks scope and role, records capabilities/bindings, warns about executable trust, displays a diff, asks confirmation, writes, then runs doctor. Normal delegation never forces setup.

The source CLI at `packages/cli/bin/oet.js` exposes `init`, `configure`, `config show`, `config apply`, `doctor`, and `schema`. Init/apply support dry-run; apply requires `--yes` before overwriting an existing file; the interactive configure command previews its diff and asks before writing. Local writes maintain `.gitignore`. The CLI never installs an Adapter or follows a package locator.

The package manifest is versioned `1.0.0`, but this repository currently has no npm publication workflow or release tag. Documentation must not present `npm install --global @orchestrate-engineering-team/cli` as an available installation path until publication exists.

## Security and observability

Skills and materials are untrusted prompt input. Adapter/package/plugin/MCP code is executable supply chain and requires explicit installation and trust. Package presence does not prove per-role isolation. The host sandbox and permissions are authoritative.

Required missing items, source conflicts, prompt fallback, requested/effective permission mismatch, and unmet executable trust must be visible. Summaries never include secrets, complete environment variables, hidden reasoning, or sensitive MCP data.

## Repository shape

- `.agents/skills/orchestrate-engineering-team/`: only public Skill, contracts, schema copy, request packet, Main work-brief template, and the Review retrievability reference intended for Main-selected disclosure.
- `packages/config`: validation, persistent layer merging, provenance, path safety, and diagnostics.
- `packages/adapter-contract`: protocol, LaunchPlan validation, generic fallback, and conformance helper.
- `packages/cli`: optional source configuration/doctor tool.

The two config schema copies are intentionally identical and checked by `pnpm check:host-neutral`.

## Rejected alternatives

- Four public Role Skills: confuses role identity with optional expertise and pollutes discovery.
- Compatibility shims: preserve the wrong public model.
- Automatic Adapter/package/MCP installation: violates executable trust and reproducibility.
- Host-specific core: makes one vendor's capability model canonical.
- Reintroducing workflow state/runtime: unnecessary for role resolution and contrary to host-native dispatch; optional `.agent-work` material deliberately has no state-machine semantics.
