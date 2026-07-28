# `orchestrate-engineering-team` acceptance report

> Evaluated: 2026-07-28
>
> Expected behavior baseline: externally supplied `orchestrate-engineering-team-user-feedback-baseline.md`; C01-C20 are reproduced below.

## Conclusion

Status: **passed**

All C01-C20 criteria from the user-feedback baseline passed deterministic checks and the applicable fresh-context forward scenarios. The implementation also passed independent Test and Review Assignments after their findings were fixed.

## Verification summary

- `pnpm verify`: passed, 121/121 Node tests plus profile and copied-package validation.
- `pnpm smoke:skill-install`: passed the networked install, refresh, and removal lifecycle for all five Skills.
- `git diff --check`: passed.
- Independent Test: passed after adversarial lease, ownership, vote, completion, packet, Todo, and verification-evidence checks.
- Independent Review: passed after closure, packet-context, blocked-restart, and latest-Retest precedence defects were fixed.
- Skill Creator's optional Python `quick_validate.py` could not run because the host lacks PyYAML; the repository's strict YAML/Profile checker passed and is the release check used here.

## Post-refactor regression — 2026-07-28

- `pnpm verify`: passed with 121/121 Node tests, 5 Skill/5 UI metadata/4 profile validation, and copied-package structural smoke.
- JSDoc check: passed for 187 named functions across 22 modules, requiring an adjacent functional summary, one detailed entry per parameter, and a detailed return description.
- `pnpm smoke:skill-install`: passed the pinned `skills@1.5.19` project-local install; executed the installed public `scripts/workflow.mjs` entry in fresh Node subprocesses for `init`, `create`, and `validate`; instantiated the installed canonical templates; and passed refresh, removal, and retained-lock lifecycle checks for all five Skills.
- `git diff --check`: passed.
- Independent Test: passed after focused recovery, canonical-document, copied-package, and installed-suite regression checks.
- Independent Review: passed after its findings were closed for Assignment prerequisites, DAG and identity integrity; root shape, projection, topology, and path normalization; Material canonical identity; template literal safety; and installed public CLI fresh-process execution with complete import-closure validation.

Reproduce with:

```sh
pnpm verify
pnpm smoke:skill-install
git diff --check
```

## Forward scenarios

All scenario Main Agents and role Agents were started with empty inherited history.

1. **Simple style change** — an explicitly invoked Skill changed one CSS color without creating `.agent-work` or spawning a role.
2. **Medium greeting behavior** — one semantic Work Item contained Development, Test, and Review Assignments; no role directories or child Work Items were created; 5/5 tests passed.
3. **Complex notification package** — Architecture wrote a task-local Material, overlapping registry writes were rejected for parallel execution, a recursive Child Main delivered audit formatting, Review findings routed to Development and only Rereview, 45/45 tests passed, and parent/child validation passed.
4. **Disjoint parallel extension** — two Development Agents with disjoint source paths ran concurrently; the shared test Assignment ran afterward; independent Test/Review passed, with 6/6 tests.
5. **Fresh-context search** — `find` returned two lightweight candidates for audit normalization; only the selected child's compact handoff was read.

The additional parallel and search scenarios are focused extensions of the three required forward-test categories, used to produce direct evidence for C14 and C20.

## C01-C20 comparison

| ID | Expected behavior | Deterministic evidence | Forward evidence | Status |
| --- | --- | --- | --- | --- |
| C01 | Simple work creates no orchestration state or roles | Main Skill applicability checker requires early exit | Simple CSS scenario had no `.agent-work` and no descendant Agent | passed |
| C02 | Development is an Assignment, not a Work Item | Assignment tests create no `index.md` | Medium scenario recorded Development in the sole Work Item | passed |
| C03 | Test/Review create no task documents | Test/Review/Retest/Rereview share the Assignment schema | Medium and complex scenarios created no role directories | passed |
| C04 | No phase/role Work Item names | `create`/`validate` reject phase, batch, implementation, test, and review IDs | Forward Work Items used semantic names and `stage` frontmatter | passed |
| C05 | Ordinary steps remain Todo/Assignment | Child eligibility rejects non-recursive single-step children | Medium steps stayed in one Work Item; only recursive audit became a child | passed |
| C06 | Semantic metadata supports retrieval | `create`/`find` require and search ID, name, summary, keywords | Fresh search selected `normalized-audit-records` by keyword/name/summary | passed |
| C07 | Main coordinates and does not code | Main/role checker enforces Main no-code and Development ownership | All production diffs in medium/complex/parallel scenarios came from Development Agents | passed |
| C08 | Only owner Main maintains an index | Claim, owner mismatch, lease expiry, lock, and atomic-write adversarial tests pass | Role outputs contained no task-index files; all forward Work Items validated | passed |
| C09 | Child Main writes child state only | Child create/sync tests enforce separate owner and bounded projection | Audit Child Main owned only the child index; parent consumed its synced result | passed |
| C10 | Empty-history dispatch is explicit | Profile checker and packet tests require `fork_turns: "none"` | Fresh Main, role, and Child Main runs received only their bounded packets | passed |
| C11 | Deep roles read only packet-listed pointers | Packet tests exclude ancestor/sibling bodies and include exact pointers | Audit role returns referenced only assigned source/tests, not ancestor indexes | passed |
| C12 | Role results use the compact envelope | Strict result validator rejects unknown fields, >3 summaries, logs, and invalid votes | All observed role results used the bounded role envelope | passed |
| C13 | Architecture Material is task-local | Material tests reject traversal and wrong role directories | Notification contract was written only to `materials/architecture/` and registered | passed |
| C14 | Parallel Development requires safe independence | Scope-prefix, dependency shape/reference/acyclicity/recovery, interface, global-file, and integrator tests pass | Disjoint ID modules ran concurrently; shared registry writes ran sequentially after helper rejection | passed |
| C15 | Development validation advice aggregates with OR | Vote table tests exercise conflicting Development votes | Complex/parallel Work Items aggregated multiple Development votes to `true` | passed |
| C16 | Test/Review run by default | Vote and completion tests require decisions and successful verification evidence | Medium, complex, and parallel scenarios all executed independent Test and Review | passed |
| C17 | Main decides when Architecture is absent | Vote tests require Main booleans/reasons without covered Architecture | Medium and parallel Work Items record Development advice plus Main reasons | passed |
| C18 | Fix reruns only affected verification role | Assignment tests preserve Retest/Rereview as roles, never Work Items | Complex Review finding routed to Development and only Rereview; no Retest/Rereview directory | passed |
| C19 | JS helper owns deterministic state operations | 20 semantic commands plus normalized-root, Material-identity, root/child projection, and Assignment-graph recovery, lease/lock/atomic failure, state, vote, child, packet, search, and validation tests pass | Forward Work Items completed and resumed through the helper and validated cleanly | passed |
| C20 | Search stays lightweight | `find`/`list` cap results and return only light metadata/match reasons | Fresh search returned two candidates, then read only the selected compact handoff | passed |

## Defects found and closed during acceptance

- Custom lease duration was initially ignored; it is now validated, persisted, and rolled on mutation.
- A Work Item could initially close without reconciled evidence; completion now checks Todos, Assignments, success criteria, votes, verification results, blockers, and descendants.
- Development could initially vote before a completed result; votes now project only from completed Development results.
- Role packets initially omitted role-critical context; packets now contain bounded, role-specific goal, changed-surface, capability, and verification context.
- Verification execution was initially mistaken for verification success; closure now requires the latest applicable Test/Retest and Review/Rereview checks to pass.
- Active Todo and blocked-Assignment retry state were incomplete; active work now has exactly one Todo and retries clear stale blocked state.
- Review packets initially allowed old Test summaries to crowd out a Retest; they now select the latest completed Test/Retest before bounding the summary.

## Residual boundaries

- Agent file and context boundaries remain advisory unless the host runtime enforces them; the Skills do not claim OS-level isolation.
- Plugin end-to-end lifecycle remains CI-only by design; local unit guards and package validation passed.
- Temporary forward-test fixtures and their role outputs were deleted after this report was finalized; this report preserves the replayable scenarios and outcomes, not full logs or private reasoning.
