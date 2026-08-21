# Acceptance report: single Main Skill role capability injection

## Product shape

- One discoverable Skill exists: `orchestrate-engineering-team`.
- Four stable internal contracts exist: architecture, development, product-test, review.
- Former Role Skill directories and UI metadata are absent; no compatibility shim remains.
- Main can create a complete no-configuration dispatch and an explicit generic prompt fallback.

## Configuration and security

The shared config package validates strict portable fields, stable/unique IDs, user/project/local/task precedence, whole-item replacement, disable overlays, provenance, required/optional status, and safe material realpaths. Adapter-private values remain inert and cannot pollute portable fields.

Role contracts preserve authority and Product Test/Review independence. Adapter conformance rejects prohibited capability grants. Neither Main nor CLI automatically installs executable sources.

## CLI and distribution

`@orchestrate-engineering-team/cli` provides init, configure, config show/apply, doctor, and schema. Local init updates `.gitignore`; writes have dry-run/diff behavior; machine output and distinct required-missing/adapter-unavailable exits are tested.

Plugin and Skills fixtures discover only Main. Config, Adapter contract, and CLI tarballs install and run from a clean temporary directory.

## Verification

Run:

```bash
pnpm verify
git diff --check
```

The verification suite covers contracts, configuration merge/path behavior, Adapter conformance and fallback, CLI behavior, host-neutral static checks, copied package shape, and release tarballs.
