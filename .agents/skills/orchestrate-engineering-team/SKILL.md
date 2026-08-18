---
name: orchestrate-engineering-team
description: Coordinate a project-local engineering team for a medium or large delivery or exploration goal that needs decomposition, multiple specialist roles, meaningful parallel work, architecture tradeoffs, or cross-session recovery. Also use to resume an existing Work Item. Do not use for a single clear change that one agent can complete in the current session without architecture or coordination; exit orchestration before creating `.agent-work` or spawning roles in that case.
license: MIT
metadata:
  author: HandsomeGanzige
---

# Orchestrate Engineering Team

Act as the Main Agent. Coordinate the outcome and own task state; never implement production code, impersonate a role, or use a local fix to bypass Development.

## Gate orchestration first

Before any `.agent-work` write or role spawn, decide whether the request actually needs orchestration.

- Enter for independent engineering parts, multiple specialist roles, material architecture tradeoffs, useful parallel development, or cross-session recovery.
- Exit for a single clear outcome with an obvious implementation that one agent can complete now. Create no Work Item or Assignment and spawn no role; continue as an ordinary single-agent task outside this Skill.
- Treat a clear, unambiguous user request as confirmed input. Do not ask the user to repeat or reconfirm it. Ask only when an unresolved choice would materially change the outcome, permissions, irreversible effects, cost, or an already confirmed decision.

If orchestration applies, require native subagent dispatch with explicit empty-history isolation and the capabilities required by each selected role. If a required runtime capability, Role Skill, or dispatch control is unavailable, mark the affected work blocked and report it. Do not simulate a specialist, silently widen access, or claim isolation that the runtime cannot enforce.

## Use the workflow model

- A **Work Item** is an independently acceptable, resumable delivery or exploration goal. Each Work Item Main owns exactly one plain-Markdown `work.md` as its semantic document.
- A sibling **`state.json`** holds disposable operational coordination while the Work Item is open. It is machine state, not a second semantic task document, and is removed rather than archived at completion.
- An **Assignment** is one bounded Architecture, Development, Test, Review, Retest, or Rereview execution. It has no document or directory, and its role envelope is a transient message rather than retained history.
- A **Child Work Item** is an independently acceptable subgoal that needs multiple Todos, role coordination, or cross-session recovery. Its Child Main independently owns the child's `work.md`; a step, stage, single Todo, or role execution is not a child.

Main is the sole semantic writer of its Work Item `work.md` and the sole task-state writer for its sibling `state.json`. A Child Main writes only its own child documents. Ordinary roles write neither file. These are collaboration constraints, not filesystem security guarantees.

`governance-v2.mjs` is the fail-closed authority for immutable contracts, narrowing, capabilities, gates, claims, limits, attempts, Git attribution, and bounded evidence records. `inspect` exposes only persisted graph/evidence counters as persisted facts; transient checks are never described as persisted proof, and Skill-local enforcement is not operating-system isolation.

## Run the Main workflow

1. Read [state-and-voting.md](references/state-and-voting.md) when creating, resuming, transitioning, validating, or closing a Work Item.
2. Use only `open`, `plan`, `next`, `dispatch`, `accept`, `resolve`, `close`, and `inspect` through `node .agents/skills/orchestrate-engineering-team/scripts/workflow.mjs <intent> --payload <file|->`. Generate help, payload JSON Schema, result/error contracts, and examples with `--help`, `--schema`, and `--examples`; legacy low-level commands and aliases do not exist. Let the helper maintain `state.json`; keep `work.md` direct Markdown with no frontmatter, fenced JSON, raw role envelopes, or execution logs.
3. Move through `align -> design -> develop -> verify -> close`. Skip `design` when no substantive architecture decision is needed. Keep exactly one Todo in progress for each active Work Item.
4. Make Architecture, Development, Test, and Review bounded Assignments under the byte-identical immutable v2 global contract and digest inherited by every descendant, Assignment, attempt, and packet. Architecture returns advisory decision proposals that Main must explicitly confirm; Development returns its exact Git-derived changed surface and authoritative artifacts; Test and Review return their evidence method and bounded structured findings. Role completion never implies Work Item completion.
5. Default medium and large code changes to independent Test and Review. After the final Development result is known, calculate their exemption votes separately as defined in the reference. Run every role not validly exempted.
6. Route a Test or Review finding to a Development Assignment. After a Test fix, rerun only Test; after a Review fix, rerun only Review unless the fix changes a shared interface or introduces a new behavior surface that warrants a fresh vote.
7. Complete only after success criteria, required verification, descendants, blockers, and residual issues are reconciled. Curate `work.md` into a factual user-readable delivery record, remove runtime-only `state.json`, retain the completed tree in the archive, and report the result to the user.

Normal Agent context excludes the retained archive. Use explicit history access to locate lightweight completed candidates, then read only the selected `work.md`.

## Dispatch minimal Assignments

Read only the selected entry in [agent-profiles.yaml](references/agent-profiles.yaml), then generate a package shaped by [role-task-packet.md](assets/role-task-packet.md). Include only the Assignment, done conditions, allowed read/write scopes, exact authoritative project pointers, directly relevant confirmed decisions, capability availability, and the fixed return schema. Never include the full parent conversation, ancestor or sibling documents, archived Work Items, unrelated history, prior role envelopes, or tool logs.

Every role spawn must explicitly use:

```json
{
  "fork_turns": "none"
}
```

Name the Role Skill and its path at the start of the spawn message and require the agent to read it completely. If the runtime supports typed Skill attachment, attach only that role's Skill as well. Role agents send no progress narration; allow one short message only for a blocker Main can act on.

Parallelize Development Assignments only when they have no ordering dependency, have disjoint write scopes, use settled shared interfaces, avoid shared migrations/lockfiles/global configuration/generated files/models, have a named integrator, fit available slots, and shorten the critical path. Otherwise run them sequentially.

## Delegate a Child Work Item

Create a child only when it meets every Child Work Item condition in the state reference and stays inside the confirmed parent scope. Main may do this without redundant user confirmation.

Spawn the Child Main with this same Skill and explicit `fork_turns: "none"`. Give it only the child delivery contract, its document link, confirmed bounded outcome, parent acceptance and result contract, capability facts, and exact pointers. The Child Main owns only its child `work.md` and sibling `state.json` and returns a concise completion event. The parent never mirrors child internals; it retains only the contract, link, acceptance, returned result, and artifact references.

## Load resources progressively

- Read [state-and-voting.md](references/state-and-voting.md) for document/state separation, lifecycle, child rules, votes, history access, and completion invariants.
- Read the selected profile only in [agent-profiles.yaml](references/agent-profiles.yaml) immediately before dispatch.
- Treat files under `assets/` as script-consumed output templates; do not load them merely to operate the workflow.
