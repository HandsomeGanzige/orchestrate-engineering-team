# Manual Skill behavior evaluation

This directory contains black-box behavior cases for `orchestrate-engineering-team`. The harness copies the current Skill into a disposable case repository, invokes a real Agent in a fresh session, applies deterministic checks, and asks a separate Agent session to judge the filtered evidence against the case rubric.

The suite is intentionally manual. It is not part of CI or `pnpm verify`, does not pin a model, and does not turn a single model run into release proof. A first run is a local baseline even when cases fail; do not tune the Skill from that result until runner, fixture, and hard-check false positives have been ruled out.

## Requirements and commands

Use Node.js 22, Git, pnpm 10.13.1, and an authenticated Agent CLI supported by the selected Runner. The built-in `codex` Runner reuses the invoking user's Codex authentication and default model unless `--model` or `--judge-model` is supplied.

```bash
pnpm eval -- --list
pnpm eval -- --case single-agent-exit
pnpm eval -- --repeat 3
pnpm eval -- --runner codex --model <candidate-model> --judge-model <judge-model>
pnpm eval -- --json
pnpm eval -- --keep-workspaces
```

`--case` may be repeated. `--repeat` runs each selected case independently. `--runner` selects the candidate Runner; `--judge-runner` may select another Runner module. Omit model flags to inherit the corresponding CLI defaults. `--keep-workspaces` is for debugging and preserves otherwise disposable repositories, which may contain untrusted Agent output.

An attempt passes only when every hard check passes, the Judge score is at least 80, every configured critical criterion passes, and the Judge reports no safety violation. A failing attempt still writes its report and exits nonzero.

## Case format

Each directory under `cases/` contains:

- `case.json` — versioned manifest with phases, sandbox, timeout, environment adjustments, hard checks, and Judge policy;
- one or more prompt Markdown files;
- `rubric.md` — semantic criteria with stable IDs and criticality;
- `fixture/` — the complete initial repository content.

Manifest fields are closed to unknown keys. Paths must remain relative to the case. Supported hard checks execute a command, inspect a file, constrain changed paths, or match filtered events/final messages. Hard safety boundaries belong in checks; qualitative orchestration behavior belongs in the rubric.

The initial suite covers:

1. single-Agent exit for a clear edit;
2. dynamic specialist selection and Main integration;
3. required capability blocking;
4. optional capability degradation;
5. complete generic fallback packets;
6. fresh-context recovery and Git-ignore preservation;
7. tool-neutral discovery when `rg` is unavailable;
8. confirmed Architecture documentation writes;
9. unconfirmed Architecture proposals;
10. independent Product Test and Review with defect closure.

## Runner contract

A Runner is an ESM module whose default export has a stable string `id` and two async methods:

```js
export default {
  id: "example",
  async preflight(context) {},
  async run(request) {},
};
```

`preflight(context)` receives the disposable `workspace`, exact injected `skillPath`, process `environment`, and timeout. It returns Runner/tool versions, capability booleans, and `skillPaths`. The exact copied Skill path must be present or the attempt stops before execution.

`run(request)` receives `kind` (`candidate` or `judge`), `cwd`, prompt, sandbox, optional model, optional output-schema path, timeout, environment, case/phase IDs, and returns an exit code, timeout state, structured events, final message, usage, error, and metadata. Candidate phases are separate calls. The Judge runs in a different read-only Git repository that does not contain the tested Skill.

The built-in Codex Runner uses `codex exec --json --ephemeral`, a per-request sandbox, project-level Skill discovery, and `--output-schema` for the Judge. These capabilities follow the official [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) and [Skill discovery](https://learn.chatgpt.com/docs/build-skills) documentation. A custom Runner is selected by module path:

```bash
pnpm eval -- --runner ./path/to/runner.mjs
```

The Fake Runner is test-only. `pnpm test` uses it to verify manifest validation, disposable repositories, Skill injection, event filtering, untracked-file diffs, timeouts, Judge schema/thresholds, hard checks, and reports without invoking a model.

## Local evidence and privacy

Runs are written below the ignored `evals/.runs/<timestamp>/<case>/<attempt>/` directory:

- `metadata.json`
- `events.jsonl`
- `final.md`
- `diff.patch`
- `checks.json`
- `judge-result.json`
- per-attempt `result.json`
- suite-level `result.json` and `report.md`

Reasoning events and fields that look like authentication, tokens, or secrets are removed; unrelated strings and command output are bounded. Authentication files and complete environment variables are never copied into evidence. Review preserved workspaces before sharing them. Neither local results nor a particular model's score are release artifacts.
