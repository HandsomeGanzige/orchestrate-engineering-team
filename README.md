# orchestrate-engineering-team

One open Agent Skill for coordinating substantial engineering work through host-native specialist contexts and configurable professional capabilities.

The only public Skill is `orchestrate-engineering-team`. Architecture, Development, Product Test, and Review are internal canonical Role Contracts, not separate Skills or mandatory stages. Main uses them only when independent context, expertise, or verification materially improves the result.

## Install

```bash
npx --yes skills@1.5.19 add https://github.com/HandsomeGanzige/orchestrate-engineering-team --skill orchestrate-engineering-team --agent codex --yes
```

Remove it with:

```bash
npx --yes skills@1.5.19 remove orchestrate-engineering-team --agent codex --yes
```

An optional Codex Plugin points at the same canonical Skill directory:

```bash
codex plugin marketplace add .
codex plugin add orchestrate-engineering-team@orchestrate-engineering-team
```

## Use

Ask the Main Skill to deliver or investigate a substantial engineering outcome. Main may use any useful combination of:

- Architecture for consequential options and tradeoffs;
- Development for focused implementation ownership;
- Product Test for independent user/business/compatibility/stability judgement;
- Review for independent engineering inspection.

One clear change stays with a normal single Agent. Main dispatches through the host's native subagent mechanism. With no host Adapter it uses an explicit compact prompt fallback and reports meaningful capability limitations.

## Configure professional capabilities

Configuration is optional. Precedence is user → project → project-local → task additions → host capability ceiling.

```yaml
# .agents/orchestrate-engineering-team.yaml
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
```

The optional CLI provides validation, merge/provenance inspection, dry-run writes, and diagnostics:

```bash
npm install --global @orchestrate-engineering-team/cli
oet init --scope local --dry-run
oet config show --effective --json
oet configure
oet doctor --json
```

The CLI and Main never automatically install adapters, plugins, packages, extensions, or MCP servers. A required missing capability blocks only that specialist dispatch; no configuration remains a valid baseline.

## Packages

- `@orchestrate-engineering-team/config` — host-neutral schema validation, merge, provenance, path safety, and capability diagnostics.
- `@orchestrate-engineering-team/adapter-contract` — Adapter protocol, generic fallback, and conformance helpers.
- `@orchestrate-engineering-team/cli` — optional `oet` CLI.

No concrete host Adapter ships in v1. Future adapters are separate trusted packages.

## Safety

- Role Contracts are immutable authority ceilings; overlays cannot remove independence or grant user decision authority.
- Product Test and Review remain independent from implementation.
- Prompt restrictions are not sandboxes; effective host permissions and isolation are authoritative.
- Skill/material content can contain prompt injection. Executable adapter/package/MCP sources require explicit trust.
- Concurrent writers need disjoint ownership or real host-provided isolation.

See [the design decision](docs/design/single-main-skill-role-capability-injection.md), [SECURITY.md](SECURITY.md), and [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Use Node.js 22 and pnpm 10.13.1:

```bash
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install --frozen-lockfile
pnpm verify
git diff --check
```
