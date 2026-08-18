# Work Item documents, coordination state, and verification voting

Use this reference when Main creates, resumes, transitions, verifies, completes, archives, or explicitly inspects history. `workflow.mjs` is the deterministic authority for machine-state mutations and context-safe discovery.

## Contents

- [Object and ownership rules](#object-and-ownership-rules)
- [Work Item document and lifecycle](#work-item-document-and-lifecycle)
- [Operational state](#operational-state)
- [Assignment and child rules](#assignment-and-child-rules)
- [Test and Review exemption voting](#test-and-review-exemption-voting)
- [Completion, archives, and recovery](#completion-archives-and-recovery)

## Object and ownership rules

| Object | Representation | Writer | Purpose |
| --- | --- | --- | --- |
| Work Item | One plain-Markdown `work.md` | Its Main only | Semantic, user-readable record for one independently acceptable goal |
| Operational state | Sibling `state.json` while open | Its Main through the helper | Disposable claims, leases, active routing, votes, and lifecycle coordination |
| Assignment | Runtime entry plus transient role message | Owning Main for state; role for its message | One bounded Architecture, Development, Test, Review, Retest, or Rereview execution |
| Child Work Item | Its own `work.md` and open-state sibling | Its Child Main only | Independently acceptable subgoal needing recursive coordination |

There is one semantic Markdown document per Main-owned Work Item, not one document for the whole task tree. `state.json` is separate machine data and never a competing semantic source. Role protocols and write scopes are advisory collaboration boundaries, not runtime filesystem or security isolation.

## Work Item document and lifecycle

Use semantic lowercase kebab-case IDs that describe the deliverable. Reject stage, role, and transit names such as `phase-0`, `phase-1`, `development`, `implementation`, `test`, `review`, `retest`, and `rereview`, including numeric or batch prefixes.

An open Work Item tree has this shape:

```text
.agent-work/open/<work-item-id>/
|-- work.md
|-- state.json
`-- children/<child-id>/
    |-- work.md
    `-- state.json
```

`work.md` is direct Markdown prose and checklists with no YAML frontmatter, fenced JSON, capability matrix, raw role envelope, execution log, or machine-controlled block. Keep its sections concise and useful to a person:

- outcome and success conditions;
- confirmed scope, decisions, constraints, and unresolved issues;
- current Work checklist and completed delivery facts;
- child delivery contracts, links, acceptance, returned results, and artifacts;
- references to authoritative project artifacts.

Stages are operational state, never directories:

```text
align -> design -> develop -> verify -> close
```

Use `design` only for a substantive Architecture Assignment. A clear user request supplies confirmed goal input without a confirmation ceremony. Pause for the user only when ambiguity would change the outcome, permissions, irreversible effects, material cost, or an accepted product or architecture decision.

## Operational state

The helper stores IDs, status, stage, parent linkage, ownership leases, active Todo and Assignment routing, verification votes, and other runtime coordination in `state.json`. Main does not hand-maintain JSON. Ordinary roles must never write `work.md`, `state.json`, or any other task state.

Keep exactly one in-progress Todo in every active Work Item. Todo and Assignment runtime records exist only to coordinate unfinished work; do not reproduce a chronological Assignment ledger or paste role returns into `work.md`. Main extracts useful delivery facts from transient messages and routes durable engineering knowledge to authoritative project artifacts.

Default list, find, resume, handoff, child synchronization, and packet generation operate only on open Work Items and the exact current pointers needed for the action. Directory depth never authorizes reading ancestors, siblings, descendants, or archives. History is a separate explicit operation and should return lightweight candidates before any archived `work.md` is opened.

## Assignment and child rules

- Architecture, Development, Test, Review, Retest, and Rereview are Assignments, not Work Items. They own no task document, directory, or retained result file.
- Architecture, Test, and Review return concise transient messages. Development returns a concise transient message plus references to authoritative project artifacts it changed.
- Durable facts belong in project code, tests, configuration, schemas, contracts, constraints, or decision documents. Task-local materials and role-result persistence are not part of the workflow.
- Parallel Development is permitted only when Assignments have no ordering dependency, disjoint write scopes, settled shared interfaces, no shared migration, lockfile, global configuration, generated file, or model, a named integrator, enough runtime slots, and meaningful critical-path benefit.

Promote a subgoal to a Child Work Item only when all are true:

1. It can be accepted independently and return a bounded result to the parent.
2. It needs multiple Todos, multiple role executions, or cross-session recovery.
3. It stays inside the parent's confirmed goal, authority, and cost.
4. A Child Main can own and converge it while the parent consumes only its contract, link, acceptance, result, and artifact references.

A single Todo, ordinary implementation step, stage, role execution, or one-step relay is never a Child Work Item. The parent creates the child delivery contract and link; the Child Main then owns only the child `work.md` and `state.json`. Parent and child never mirror each other's internal checklist, progress, role results, or machine state. Child completion is recorded child-first and returned as a concise event for parent acceptance.

## Test and Review exemption voting

Independent Test and Review are separate defaults for orchestrated code work. Vote only after Development finishes and the final changed surface is known. Voting decides whether an independent role adds no meaningful signal; it is not a checklist for finding reasons to validate.

Architecture and every Development return `requires_test` and `requires_review` booleans with one-sentence reasons. Aggregate multiple Development votes separately:

```text
development_requires_test   = OR(each Development.requires_test)
development_requires_review = OR(each Development.requires_review)
```

When Architecture participated and its analysis still covers the final implementation, Architecture, aggregated Development, and Main each cast one vote per role. At least two `false` votes are required to exempt that role. Every other result runs it.

When Architecture did not participate, failed, or no longer covers the changed surface, its vote is absent. Development is advisory and Main makes the final decision, recording an evidence-based reason in operational state. Main must not pre-exempt a role before Development reports.

A `false` vote is valid only when independent verification would add no meaningful signal, for example:

- no executable behavior, runtime configuration, schema, infrastructure, generated runtime artifact, or public interface changed;
- a fully mechanical change is covered by reproducible deterministic checks;
- only tests, comments, formatting, or static non-runtime documentation changed;
- for Test, a behavior-preserving internal refactor has complete automated coverage of the success criteria;
- for Review, a deterministic generator produced the change with no semantic decision.

“Small change,” “looks correct,” and “Development already tested it” are not sufficient exemptions.

Test and Review return `null` for both vote fields. A Test failure routes to Development and then only a Test Assignment is rerun. A Review finding routes to Development and then only a Review Assignment is rerun. Recompute both votes only when a fix changes a shared interface or introduces a new behavior surface. Retest and Rereview remain Assignments.

## Completion, archives, and recovery

- One unexpired owner lease controls each open Work Item; no role or other Main may write its files.
- An active Work Item has exactly one in-progress Todo, and a completed parent has no open descendant.
- Parent and child links, semantic IDs, enums, ownership, active routing, and vote results must validate without treating Markdown prose as machine state.
- Resume reads only open-work candidates, the selected `work.md` and `state.json`, and exact current pointers. Handoff contains only the outcome, current focus, active work, blockers, key authoritative references, and next action.
- Before completion, validate the tree, reconcile success conditions and required Test/Review outcomes, close descendants, record residual issues, and curate `work.md` into a factual delivery record that describes what was delivered, accepted, unresolved, and where durable artifacts live.
- Completion removes runtime-only `state.json` throughout the completed tree and moves the retained `work.md` tree under the archive. The archive is user-readable history, not default Agent context.
- Default discovery and role dispatch exclude archived Work Items. An explicit history request may locate archived summaries and then open only the selected completed `work.md`; it must not bulk-load historical task trees.
