# orchestrate-engineering-team

A host-neutral Agent Skill for coordinating substantial engineering work through host-native specialist contexts and configurable professional capabilities.

The repository exposes one public Skill, `orchestrate-engineering-team`. Architecture, Development, Product Test, and Review are internal Role Contracts, not separate Skills or mandatory stages. Main uses a role only when independent context, expertise, verification, or safe concurrency materially improves the result.

## Current status

- Repository/workspace version: `1.0.0`.
- Public Skill: one.
- Internal Role Contracts: four (`architecture`, `development`, `product-test`, `review`).
- Main supporting resources: five, including the optional work-brief template and bundled Review retrievability capability.
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

- **Architecture** for consequential options, tradeoffs, and explicitly assigned architecture documentation;
- **Development** for focused implementation ownership;
- **Product Test** for independent user, business, compatibility, and stability judgement;
- **Review** for independent engineering inspection, optionally using the bundled `review-agent-retrievability` capability to audit whether a fresh Agent can recover consequential project knowledge without implementation history.

One clear change stays with a normal single Agent. Main dispatches through the host's native subagent mechanism. Without a host Adapter it uses an explicit compact prompt fallback that carries the role guidance, prohibited capabilities, write boundary, resolved material references, and actual limitations.

Main may use `.agent-work/<task>/` for private working material and may instantiate the bundled `main-work-brief.md` as `brief.md` when continuity is useful. The directory is never a workflow state machine, lock, queue, database, or quality gate, and the Skill never decides whether it is ignored or committed. Current user instructions and verified repository facts always outrank a brief.

Repository discovery is tool-neutral: known files and symbols are starting points, while each role uses the host's suitable search, navigation, index, or language capabilities to verify the current code and documentation. Architecture remains code-read-only; direct writes require an explicit document assignment and effective host write permission. Unconfirmed proposals stay separate from established project rules.

## Configure professional capabilities

Configuration is optional. Precedence is user → project → project-local → ephemeral task additions → host capability ceiling. The bundled `review-agent-retrievability` reference Skill is selected separately by Main for focused Review and is not a persistent configuration layer.

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

- `.agents/skills/orchestrate-engineering-team/` — canonical public Skill, Role Contracts, config schema copy, role task packet, Main work-brief template, and the nested `review-agent-retrievability` reference Skill intended for selective disclosure through Main. Independent discovery or invocation of nested Skill files remains host-dependent.
- `packages/config/` — configuration parsing, merging, provenance, material-path checks, and capability diagnostics.
- `packages/adapter-contract/` — Adapter and LaunchPlan validation, conformance helper, and generic prompt fallback.
- `packages/cli/` — optional source CLI for configuration and diagnostics.
- `scripts/` — repository validation, package smoke checks, distribution fixtures, and the behavior-eval harness.
- `evals/cases/` — ten isolated black-box Skill behavior cases; see [`evals/README.md`](evals/README.md).
- `docs/` — current decision, verification scope, and supporting research; see [`docs/README.md`](docs/README.md).

## Safety

- Role Contracts are authority ceilings; configuration and Adapters must not expand them.
- Architecture may write only assigned Agent working files and project documentation, never production code, tests, executable configuration, or dependencies.
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

`pnpm verify` currently checks the one-Skill/four-contract/five-resource shape, host-neutral core, 30 Node test cases, copied-repository shape, and installable workspace tarballs. It never launches a real Agent or consumes model usage.

Black-box behavior evaluation is a separate manual workflow:

```bash
pnpm eval -- --list
pnpm eval -- --runner codex --repeat 1
```

The built-in Runner requires an already authenticated Codex CLI. It copies the current Skill into a disposable Git fixture, starts independent ephemeral candidate and Judge sessions, applies deterministic safety checks, and writes filtered local evidence under ignored `evals/.runs/`. Candidate and Judge models are not fixed; explicit `--model` and `--judge-model` overrides are optional. Runs, including the first pass/fail baseline, are diagnostic local evidence rather than release proof and are not committed. See [`evals/README.md`](evals/README.md) and [`docs/acceptance-report.md`](docs/acceptance-report.md) for the exact boundaries.

The GitHub Skills command above is represented by a local installation fixture; the Codex Plugin lifecycle is exercised separately only on a disposable GitHub Actions runner.
