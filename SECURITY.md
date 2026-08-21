# Security Policy

## Support and reporting

Security fixes target the latest release. Report vulnerabilities privately through GitHub Security with the affected commit, impact, reproduction, and suggested mitigation. Avoid including secrets or third-party data.

## Trust boundaries

Canonical Role Contracts limit role authority but are prompt semantics, not a filesystem sandbox. Host tools, permissions, sandbox, worktree, and policy are authoritative. An Adapter must never expand prohibited capabilities, and `unknown` must be reported when effective enforcement cannot be verified.

Skills and materials are untrusted prompt input and may contain prompt injection. Material paths are validated against their real project/user root, including symlinks. Package/plugin presence is not proof that a capability is isolated to one Agent.

Adapters, packages, plugins, extensions, scripts, and MCP servers are executable supply chain. Main and `oet` do not automatically download, install, enable, or trust them. Adapter private configuration is accepted only as inert YAML/JSON until a user-installed Adapter validates it.

Reports are especially useful for authority expansion, Product Test/Review independence bypass, path traversal or symlink escape, unsafe automatic execution, secret leakage, misleading capability attestation, and release artifacts that expose removed Role Skills or undeclared files.
