# orchestrate-engineering-team

A host-neutral Agent Skill for coordinating substantial engineering work through host-native specialist contexts and configurable professional capabilities.

The repository exposes one public Skill, `orchestrate-engineering-team`. Architecture, Development, Product Test, and Review are internal Role Contracts, not separate Skills or mandatory stages. Main uses a role only when independent context, expertise, verification, or safe concurrency materially improves the result.

## Current status

- Repository/workspace version: `1.0.0`.
- Public Skill: one.
- Internal Role Contracts: four (`architecture`, `development`, `product-test`, `review`).
- Workspace packages: config, Adapter contract, and CLI.
- Concrete host Adapters: none.
- npm publication: the three scoped workspace packages are currently source-only and are not an installation prerequisite for the Skill.

The Skill itself is usable without configuration or the CLI. The CLI supports configuration and diagnostics; it is not the orchestration runtime.

## Install the Skill

Install the canonical Skill directly from GitHub:

```bash
npx --yes skills add https://github.com/HandsomeGanzige/orchestrate-engineering-team --skill orchestrate-engineering-team --agent codex --yes
```

Remove it with:

```bash
npx --yes skills remove orchestrate-engineering-team --agent codex --yes
```

An optional Codex Plugin manifest points to the same Skill directory when working from a clone:

```bash
codex plugin marketplace add .
codex plugin add orchestrate-engineering-team@orchestrate-engineering-team
```

## Use

Ask the Main Skill to deliver or investigate a substantial engineering outcome. Main may select any useful combination of:

- **Architecture** for consequential options and tradeoffs;
- **Development** for focused implementation ownership;
- **Product Test** for independent user, business, compatibility, and stability judgement;
- **Review** for independent engineering inspection.

One clear change stays with a normal single Agent. Main dispatches through the host's native subagent mechanism. Without a host Adapter it uses an explicit compact prompt fallback and reports meaningful capability limitations.

## Configure professional capabilities

Configuration is optional. Precedence is user → project → project-local → ephemeral task additions → host capability ceiling.

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

From a repository clone, run the source CLI with Node.js:

```bash
node packages/cli/bin/oet.js --help
node packages/cli/bin/oet.js init --scope local --dry-run
node packages/cli/bin/oet.js config show --effective --json
node packages/cli/bin/oet.js doctor --json
```

The CLI and Main never automatically install Adapters, plugins, packages, extensions, or MCP servers. A required missing capability blocks only that specialist dispatch; no configuration remains a valid baseline. See [`packages/cli/README.md`](packages/cli/README.md) for exact commands and exit codes.

## Repository layout

- `.agents/skills/orchestrate-engineering-team/` — canonical public Skill, Role Contracts, config schema copy, and task packet.
- `packages/config/` — configuration parsing, merging, provenance, material-path checks, and capability diagnostics.
- `packages/adapter-contract/` — Adapter and LaunchPlan validation, conformance helper, and generic prompt fallback.
- `packages/cli/` — optional source CLI for configuration and diagnostics.
- `scripts/` — repository validation, package smoke checks, and distribution fixtures.
- `docs/` — current decision, verification scope, and supporting research; see [`docs/README.md`](docs/README.md).

## Safety

- Role Contracts are authority ceilings; configuration and Adapters must not expand them.
- Product Test and Review remain independent from implementation.
- Prompt restrictions are not sandboxes; effective host permissions and isolation are authoritative.
- Skill and material content may contain prompt injection. Executable Adapter/package/MCP sources require explicit trust.
- Concurrent writers need disjoint ownership or real host-provided isolation.

See [`SECURITY.md`](SECURITY.md) for trust boundaries.

## Development and verification

Use Node.js 22 and pnpm 10.13.1:

```bash
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install --frozen-lockfile
pnpm verify
git diff --check
```

`pnpm verify` currently checks the one-Skill/four-contract shape, host-neutral core, 18 Node test cases, copied-repository shape, and installable workspace tarballs. The GitHub Skills command above is represented by a local installation fixture; the Codex Plugin lifecycle is exercised separately only on a disposable GitHub Actions runner. See [`docs/acceptance-report.md`](docs/acceptance-report.md) for the exact boundary.
