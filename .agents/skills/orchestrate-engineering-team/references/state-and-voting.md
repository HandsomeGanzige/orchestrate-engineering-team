# Work Item state and verification voting

Use this reference when Main creates, resumes, transitions, verifies, or closes a Work Item. `workflow.mjs` is the deterministic authority for valid state mutations.

## Contents

- [Object and ownership rules](#object-and-ownership-rules)
- [Work Item schema and lifecycle](#work-item-schema-and-lifecycle)
- [Todo, Assignment, Material, and child rules](#todo-assignment-material-and-child-rules)
- [Test and Review exemption voting](#test-and-review-exemption-voting)
- [Completion and recovery invariants](#completion-and-recovery-invariants)

## Object and ownership rules

| Object | State entry | Writer | Purpose |
| --- | --- | --- | --- |
| Work Item | One `index.md` | Its Main only | Independently acceptable, resumable delivery or exploration goal |
| Assignment | Entry in the owning Work Item | Owning Main | One bounded role execution |
| Material | Ordinary task-local file plus index pointer | Assigned Architecture/Test/Review role | Retained design work or unusually useful long evidence |
| Child Work Item | Its own `index.md` | Its Child Main only | Independently acceptable subgoal needing recursive coordination |

Role protocols and write scopes are advisory collaboration boundaries. Never describe them as runtime filesystem or security isolation.

## Work Item schema and lifecycle

Use semantic lowercase kebab-case IDs that describe the deliverable. Reject stage, role, and transit names such as `phase-0`, `phase-1`, `development`, `implementation`, `test`, `review`, `retest`, and `rereview` even with numeric or batch prefixes.

Each Work Item frontmatter has:

```yaml
id: semantic-deliverable-id
name: Human-readable outcome
summary: One sentence describing the deliverable and its value.
keywords: [three, to, eight, search-terms]
type: delivery | exploration
status: active | paused | blocked | completed | cancelled
stage: align | design | develop | verify | close
parent: relative/path/to/index.md
owner: session-or-agent-id
lease_until: ISO-8601-with-timezone
updated_at: ISO-8601-with-timezone
```

Use empty strings for `owner` and `lease_until` before claim. A top-level Work Item points to the root index; a child points to its parent Work Item index.

Stages describe current state, never directories:

```text
align -> design -> develop -> verify -> close
```

Use `design` only for a substantive Architecture Assignment. A clear user request supplies confirmed goal input without a confirmation ceremony. Pause for the user only when ambiguity would change the outcome, permissions, irreversible effects, material cost, or an accepted product/architecture decision.

The fixed body sections are Goal, Success criteria, Confirmed decisions, Current progress, Todo, Assignments, Children, Materials, Verification decision and evidence, and Result. Mutate controlled blocks through `workflow.mjs`; missing, duplicate, or crossed markers are validation failures.

## Todo, Assignment, Material, and child rules

- Keep exactly one `[>]` Todo in every active Work Item. A Todo is a bounded step Main can describe and route; it has no separate index.
- Record Architecture, Development, Test, Review, Retest, and Rereview as Assignments. An Assignment never owns a directory or `index.md`.
- Record only concise role results in the Assignment entry. The return envelope, diffs, project artifacts, and registered Materials are the evidence sources.
- Architecture may write only explicitly assigned `materials/architecture/` paths. Test and Review may write only explicitly assigned `materials/test/` or `materials/review/` paths and only for long reusable evidence. Development creates no task Material by default.
- Register each retained Material with relative path, one-sentence summary, and purpose. Reject traversal or paths outside the role's allowed Material directory.

Promote a subgoal to Child Work Item only when all are true:

1. It can be accepted independently and return a bounded result to the parent.
2. It needs multiple Todos, multiple role executions, or cross-session recovery.
3. It stays inside the parent's confirmed goal, authority, and cost.
4. A Child Main can own and converge it while the parent consumes only a result summary and artifact pointers.

A single Todo, ordinary implementation step, stage, role execution, or one-step relay is never a Child Work Item. Parent Main creates the child entry; Child Main then writes only the child index. Child completion is recorded child-first, then returned as a concise event for parent update or later `child sync`.

Parallel Development is permitted only when all Assignments have no ordering dependency, disjoint write scopes, stable shared interfaces, no shared migration/lockfile/global configuration/generated file/model, a named integrator, enough runtime slots, and meaningful critical-path benefit.

## Test and Review exemption voting

Independent Test and Review are separate defaults for orchestrated code work. Vote only after Development finishes and the final changed surface is known. Voting decides whether an independent role adds no meaningful signal; it is not a checklist for finding reasons to validate.

Architecture and every Development return `requires_test` and `requires_review` booleans with one-sentence reasons. Aggregate multiple Development votes separately:

```text
development_requires_test   = OR(each Development.requires_test)
development_requires_review = OR(each Development.requires_review)
```

When Architecture participated and its analysis still covers the final implementation, Architecture, aggregated Development, and Main each cast one vote per role. At least two `false` votes are required to exempt that role. Every other result runs it.

When Architecture did not participate, failed, or no longer covers the changed surface, its vote is absent. Development is advisory and Main makes the final decision, recording an evidence-based reason. Main must not pre-exempt a role before Development reports.

A `false` vote is valid only when independent verification would add no meaningful signal, for example:

- no executable behavior, runtime configuration, schema, infrastructure, generated runtime artifact, or public interface changed;
- a fully mechanical change is covered by reproducible deterministic checks;
- only tests, comments, formatting, or static non-runtime material changed;
- for Test, a behavior-preserving internal refactor has complete automated coverage of the success criteria;
- for Review, a deterministic generator produced the change with no semantic decision.

“Small change,” “looks correct,” and “Development already tested it” are not sufficient exemptions.

Test and Review return `null` for both vote fields. A Test failure routes to Development and then only a Test Assignment is rerun. A Review finding routes to Development and then only a Review Assignment is rerun. Recompute both votes only when a fix changes a shared interface or introduces a new behavior surface. Retest and Rereview remain Assignments.

## Completion and recovery invariants

- One unexpired owner lease controls each index; no role or other Main may write it.
- An active Work Item has exactly one in-progress Todo.
- A completed parent has no active, paused, or blocked descendant.
- Parent/child links, semantic IDs, enums, controlled markers, Material paths, and vote results must validate.
- Root `.agent-work/index.md` lists only active or paused top-level items with name, summary, status, and entry path. Detailed state lives only in each Work Item.
- Search uses only ID, name, summary, keywords, and Material summaries and returns lightweight candidates. Resume reads the root, the selected Work Item, and only its current pointers; directory depth does not authorize ancestor or sibling reads.
- Handoff contains only goal, current state, in-progress Todo, active Assignments, blockers, key Materials, and next action.
- Before completion, run `validate`, reconcile success criteria and required Test/Review outcomes, close descendants, record residual issues, set the result, and then mark the Work Item completed.
