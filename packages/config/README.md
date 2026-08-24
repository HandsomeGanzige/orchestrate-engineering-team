# @orchestrate-engineering-team/config

Host-neutral configuration utilities for `orchestrate-engineering-team`.

## Status

This is a Node.js 22 ESM workspace package at version `1.0.0`. It is packed and installed from a tarball by `pnpm verify`, but is currently maintained as repository source rather than a published npm dependency.

## Exports

The package root exports:

- `API_VERSION`, `ROLE_IDS`, and `CONFIG_FILES`;
- `ConfigError`;
- `validateConfig(config)` and `parseConfig(yaml, label)`;
- `mergeConfigLayers(layers)` with per-capability provenance;
- `configPaths()` and `loadConfigLayers()` for user, project, and local files;
- `validateMaterialPath(entry, options)`;
- `diagnoseCapabilities(role, availableSkills)`.

`@orchestrate-engineering-team/config/schema` exports `schema.json`. The same schema is copied to the Main Skill at `.agents/skills/orchestrate-engineering-team/references/config.schema.json`; the host-neutral check requires byte equality.

## Merge boundary

`loadConfigLayers()` reads, in order:

1. `~/.agents/orchestrate-engineering-team.yaml`
2. `.agents/orchestrate-engineering-team.yaml`
3. `.agents/orchestrate-engineering-team.local.yaml`

Different capability IDs append, the same ID is replaced by a higher layer, and `enabled: false` removes an earlier item. Ephemeral task additions are a Main dispatch concept; this package does not discover or persist a fourth task layer automatically.

## Material paths

Paths must be relative, resolve to a file, and remain inside the selected real root after symlink resolution. `scope: user` is accepted only for an entry originating in user configuration.
