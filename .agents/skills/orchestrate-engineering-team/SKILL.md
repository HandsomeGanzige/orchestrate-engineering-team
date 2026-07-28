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

- A **Work Item** is an independently acceptable, resumable delivery or exploration goal. It has one `index.md`, owned by one Main.
- An **Assignment** is one bounded Architecture, Development, Test, Review, Retest, or Rereview execution. Record it in the owning Work Item; never create a directory or `index.md` for it.
- A **Material** is retained task-local evidence or design work. Architecture may write only assigned `materials/architecture/` paths. Test and Review may write only assigned `materials/test/` or `materials/review/` paths, and only for long evidence worth retaining. Development writes no task materials by default.
- A **Child Work Item** is an independently acceptable subgoal that needs multiple Todos, role coordination, or cross-session recovery. A step, stage, single Todo, or role execution is not a child.

Main is the sole writer of its Work Item `index.md`. A Child Main writes only its child index; ordinary roles write no task index. These are collaboration constraints, not filesystem security guarantees.

## Run the Main workflow

1. Read [state-and-voting.md](references/state-and-voting.md) when creating, resuming, transitioning, validating, or closing a Work Item.
2. Use `node .agents/skills/orchestrate-engineering-team/scripts/workflow.mjs <command>` for initialization, creation, claims, Todos, Assignments, results, votes, children, materials, search, handoff, and validation. Let the script use the bundled assets; do not hand-maintain controlled blocks.
3. Move through `align -> design -> develop -> verify -> close`. Skip `design` when no substantive architecture decision is needed. Keep exactly one Todo in progress for each active Work Item.
4. Make Architecture, Development, Test, and Review bounded Assignments. Main integrates their concise results into its index; role completion never implies Work Item completion.
5. Default medium and large code changes to independent Test and Review. After the final Development result is known, calculate their exemption votes separately as defined in the reference. Run every role not validly exempted.
6. Route a Test or Review finding to a Development Assignment. After a Test fix, rerun only Test; after a Review fix, rerun only Review unless the fix changes a shared interface or introduces a new behavior surface that warrants a fresh vote.
7. Complete only after success criteria, required verification, descendants, blockers, and residual issues are reconciled. Main records the final result and reports it to the user.

## Dispatch minimal Assignments

Read only the selected entry in [agent-profiles.yaml](references/agent-profiles.yaml), then generate a package shaped by [role-task-packet.md](assets/role-task-packet.md). Include only the Assignment, done conditions, allowed read/write scopes, exact project and Material pointers, directly relevant confirmed decisions, capability availability, and the fixed return schema. Never include the full parent conversation, ancestor or sibling indexes, unrelated history, full role reports, or tool logs.

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

Spawn the Child Main with this same Skill and explicit `fork_turns: "none"`. Give it only its child entry, confirmed bounded outcome, parent result contract, capability facts, and exact pointers. The Child Main owns only the child index and returns a concise completion event; the parent Main updates the parent index or later uses `child sync`.

## Load resources progressively

- Read [state-and-voting.md](references/state-and-voting.md) for schemas, lifecycle, child rules, votes, and completion invariants.
- Read the selected profile only in [agent-profiles.yaml](references/agent-profiles.yaml) immediately before dispatch.
- Treat files under `assets/` as script-consumed output templates; do not load them merely to operate the workflow.
