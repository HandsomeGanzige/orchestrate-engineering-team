# Single Main Skill and configurable role capability injection

## Decision

The product publishes one discoverable Skill: `orchestrate-engineering-team`. Architecture, Development, Product Test, and Review are stable internal Role Contracts. Professional Skills are optional capabilities attached by configuration; packages/plugins are distribution sources; host Adapters translate a resolved role into native launch settings.

This is a breaking replacement for the former five-Skill design. There are no compatibility shims.

## Terms and layers

- **Role Contract**: immutable purpose, routing, authority ceiling, independence, capability intent, context, and returns in `references/role-contracts.yaml`.
- **Professional capability**: an installed Skill or a safe material reference that improves domain work without defining role identity.
- **Adapter**: trusted executable host integration implementing detect, binding validation, resolve, optional scaffold, and diagnose.
- **Resolved Role**: one dispatch request containing contract, focused task, capability status/provenance, host launch facts, and limitations.

Main alone decides whether and how to delegate and synthesizes results. Adapters cannot expand canonical authority or coordinate workflow.

## Configuration

Configuration uses `apiVersion: orchestrate-engineering-team/v1` at, from lowest to highest precedence:

1. `~/.agents/orchestrate-engineering-team.yaml`
2. `.agents/orchestrate-engineering-team.yaml`
3. `.agents/orchestrate-engineering-team.local.yaml`
4. ephemeral task additions
5. host permission/capability ceiling

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

Project materials must be relative and remain inside the real project root after symlink resolution. External user materials require a user-layer entry with `scope: user`. Required missing capabilities block that specialist; optional missing capabilities become visible limitations. No configuration is a valid, quiet baseline.

## Dispatch and fallback

An Adapter implements `detect`, `validateBinding`, `resolve`, and `diagnose`; `scaffold` is optional. It returns native Agent, mode, effective or unknown tools policy, sandbox, isolation, capabilities, provenance, and limitations. The v1 core ships only the protocol, fixtures, conformance helper, and generic fallback—not Pi, Claude Code, Codex, or Gemini adapters.

Without an Adapter, Main injects a compact Role Contract, focused task, exact resolved Skill references, and materials into the host's normal subagent prompt. It does not copy the whole parent conversation or silently claim enforcement.

## Interaction and CLI

Explicit team configuration first shows effective values/provenance, asks scope and role, records capabilities/bindings, warns about executable trust, displays a diff, asks confirmation, writes, then runs doctor. Normal delegation never forces setup.

The optional `@orchestrate-engineering-team/cli` exposes `oet init`, `configure`, `config show/apply`, `doctor`, and `schema`. Writes support dry-run; existing files require explicit overwrite; local init maintains `.gitignore`. The CLI never installs an Adapter or follows a package locator. Main must not invoke `npx --yes` automatically.

## Security and observability

Skills and materials are untrusted prompt input. Adapter/package/plugin/MCP code is executable supply chain and requires explicit installation and trust. A package existing does not prove per-role isolation. The host sandbox and permissions are authoritative.

Required missing items, source conflicts, prompt fallback, requested/effective permission mismatch, and unmet executable trust must be visible. Summaries never include secrets, complete environment variables, hidden reasoning, or sensitive MCP data.

## Repository shape and extension

- `.agents/skills/orchestrate-engineering-team/`: the only public Skill, contracts, schema, and request packet.
- `packages/config`: pure validation, merging, provenance, path safety, and diagnostics.
- `packages/adapter-contract`: protocol, launch-plan validation, generic fallback, and conformance helper.
- `packages/cli`: optional configuration/doctor tool.

Future host support belongs in separately trusted packages such as `@orchestrate-engineering-team/adapter-pi` and must pass conformance tests without owning role semantics.

## Rejected alternatives

- Four public Role Skills: confuses role identity with optional expertise and pollutes discovery.
- Compatibility shims: preserve the wrong public model.
- Automatic adapter/package/MCP installation: violates executable trust and reproducibility.
- Host-specific core: makes one vendor's capability model canonical.
- Reintroducing workflow state/runtime: unnecessary for role resolution and contrary to host-native dispatch.
