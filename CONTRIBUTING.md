# Contributing

Use Node.js 22 and pnpm 10.13.1. Run:

```bash
pnpm install --frozen-lockfile
pnpm verify
git diff --check
```

## Architecture invariants

- `.agents/skills/` contains exactly one public Skill: `orchestrate-engineering-team`.
- The four stable roles live only in `references/role-contracts.yaml`; do not recreate public Role Skills or compatibility shims.
- Role Contracts own authority and independence. Configuration and Adapters may narrow but never expand them.
- Keep configuration and Adapter contract packages host-neutral. Concrete host support belongs in independently trusted adapter packages.
- Main uses host-native subagents and has no `.agent-work`, lifecycle state machine, workflow runtime, leases, receipts, or voting.
- No dispatch/configuration path automatically installs or executes a package, plugin, extension, MCP server, or Adapter.

## Changes

Update tests for role contract/schema behavior, merge precedence, required/optional capabilities, material path safety, Adapter conformance, CLI exit codes, and single-Skill install/release shape. Keep generated or local configuration out of commits unless it is an intentional fixture.

For security-sensitive changes, distinguish advisory prompt restrictions from effective host sandbox/tool enforcement and avoid recording secrets or hidden reasoning.
