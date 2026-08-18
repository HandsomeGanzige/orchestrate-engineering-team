# `orchestrate-engineering-team` acceptance report

> Contract updated: 2026-08-12

## Conclusion

Status: **pending final integrated verification**

The acceptance baseline now covers plain per-Main Work Item documents, separate disposable coordination state, independent child ownership, retained context-safe archives, and transient specialist returns. Final pass counts belong here only after the runtime, contract surface, and package checks have been integrated and executed together.

## Required release evidence

- `pnpm verify` must pass the Skill/profile checker, workflow tests, and copied-package validation.
- `pnpm smoke:skill-install` must pass the networked install, refresh, installed-runtime, and removal lifecycle for all five Skills.
- `git diff --check` must pass.
- Independent Test and Review must pass after any findings are fixed.

## Acceptance criteria

| ID | Expected behavior | Required evidence | Status |
| --- | --- | --- | --- |
| C01 | Simple work exits orchestration before creating task state or roles | Applicability test and fresh-context scenario | pending |
| C02 | Each Main-owned Work Item has exactly one semantic plain-Markdown `work.md` | Document rendering, discovery, and validation tests | pending |
| C03 | Machine coordination is isolated in sibling `state.json` while work is open | State mutation, ownership, lease, lock, and atomic-write tests | pending |
| C04 | `work.md` contains prose and checklists without frontmatter, fenced JSON, raw role envelopes, or controlled blocks | Template and adversarial document tests | pending |
| C05 | Architecture, Development, Test, Review, Retest, and Rereview remain bounded Assignments without task documents or directories | Packet and Assignment lifecycle tests | pending |
| C06 | Ordinary roles cannot write `work.md`, `state.json`, or other task state | Skill/profile checker and bounded-role scenario | pending |
| C07 | Main coordinates and does not implement production code | Main/role checker and forward delivery scenario | pending |
| C08 | Every normal role and Child Main dispatch explicitly uses `fork_turns: "none"` | Skill, packet, and profile checks | pending |
| C09 | Role packets contain only current bounded facts and exact authoritative project pointers | Packet context and exclusion tests | pending |
| C10 | Role returns use the compact envelope and remain transient | Result validation plus Skills and packet checks | pending |
| C11 | Durable facts are promoted to project code, tests, configuration, contracts, constraints, or decision documents | Skills/profile checker and forward scenario | pending |
| C12 | Parallel Development requires disjoint safe scopes, settled interfaces, and a named integrator | Scope, dependency, global-file, and integration tests | pending |
| C13 | Test and Review remain independent defaults with separate evidence-based exemption votes | Voting and completion tests | pending |
| C14 | A Child Main independently owns its child `work.md` and `state.json` | Child create, ownership, synchronization, and recovery tests | pending |
| C15 | Parent projection contains only child contract, link, acceptance, result, and artifacts | Parent/child projection tests | pending |
| C16 | Completion curates a factual user-readable delivery record and removes runtime state | Completion and archive tests | pending |
| C17 | Completed Work Item trees remain available under the archive | Archive retention and explicit history tests | pending |
| C18 | Default list, find, resume, handoff, synchronization, and packet operations exclude archived work | Context-boundary and history opt-in tests | pending |
| C19 | Explicit history access returns lightweight candidates before opening only the selected completed document | History query and bounded-read tests | pending |
| C20 | Copied and installed packages preserve the same templates, references, runtime, and five fixed role Skills | Copied-package and installed-suite checks | pending |

## Residual boundaries

- Agent file and context boundaries remain advisory unless the host runtime enforces them; the Skills do not claim operating-system isolation.
- Plugin end-to-end lifecycle remains CI-only by design; local package and unit checks cover its static contract.
- Archived Work Items are delivery records, not authoritative engineering documentation; durable requirements and decisions remain in project artifacts.
