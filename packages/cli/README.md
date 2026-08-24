# @orchestrate-engineering-team/cli

Optional `oet` configuration and diagnostics CLI.

## Status and source usage

The package manifest is versioned `1.0.0`, but the CLI is currently a repository workspace package rather than a published global npm command. From a clone, run:

```bash
node packages/cli/bin/oet.js --help
```

Node.js 22 is required.

## Commands

```text
oet init --scope user|project|local [--dry-run]
oet configure [--role ROLE] [--scope SCOPE]
oet config show [--effective] [--role ROLE] [--json]
oet config apply --scope SCOPE --input FILE_OR_YAML [--dry-run] [--yes]
oet doctor [--role ROLE] [--adapter PACKAGE] [--json]
oet schema [--json]
```

`configure` requires an interactive terminal. It previews a diff, asks before writing, then runs doctor for the selected role. Use `config apply` for automation. Applying over an existing file requires `--yes` unless `--dry-run` is used.

`doctor` discovers Skills only from the current project's `.agents/skills` and the user's `~/.agents/skills`. It validates configured material files and can import an explicitly requested, already-installed Adapter package. It does not install one.

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | success |
| `2` | invalid configuration or other validation failure |
| `3` | a required capability is missing |
| `4` | an explicitly requested Adapter is unavailable |
| `64` | command or option usage error |

JSON output is available for `config show`, `doctor`, and `schema`. Diff output for write commands is human-oriented text.

## Safety boundary

The CLI never automatically installs an Adapter, Skill, package, plugin, extension, or MCP server. Adapter private configuration remains data until an explicitly requested installed Adapter is imported and validates it.
