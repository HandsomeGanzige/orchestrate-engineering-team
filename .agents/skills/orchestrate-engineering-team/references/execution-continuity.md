# Execution continuity guidance

Read this reference immediately before dispatch or recovery when work uses asynchronous or background runs, dependent stages, supervisor questions, pause or detach behavior, completion notifications, or restart recovery. It defines Main's host-neutral continuity rules; host-native status remains authoritative.

## Lifecycle and evidence

Treat lifecycle state and activity signals separately. `running`, `waiting-supervisor`, `paused`, `detached`, and `unknown` are nonterminal. `completed`, `failed` or `rejected`, and `cancelled` or `stopped` are terminal only when the host identifies the exact run and reports that state authoritatively. An attention signal, receipt, progress update, saved-output promise, or completion notification is evidence about a run, not by itself its terminal result.

A role's human-readable artifact and a host acceptance ledger are independent results even when one Agent produced both. A Markdown path does not determine the acceptance encoding. Preserve each result and its failure separately.

Before a dependent stage consumes an upstream result, Main confirms all of the following:

- the exact upstream run is terminal;
- the result came from that run rather than a placeholder, stale notification, or sibling;
- every required parallel lane has reached a terminal state;
- each expected artifact exists and contains a finalized role result, or the missing artifact is recorded as a failure;
- failed, rejected, cancelled, stopped, and partial lanes are represented honestly in the downstream decision.

A text-only result cannot prove terminality through phrases such as “done” or “detached.” Combine it with authoritative host status or independently verified finalized artifacts. Do not pass a receipt, waiting message, detach notice, or progress text to a dependent role as a completed report.

## Choose an execution shape

Use a single automatically dependent workflow across a possible supervisor question only when the resolved host plan reports both `dependencyBarrier=terminal-only` and `supervisorContinuation=automatic`. Otherwise use conservative waves: dispatch one stage or independent fanout, receive and verify its terminal results, then let Main dispatch the next stage.

`resultDelivery=receipt-notification` requires Main to correlate the receipt and later notification to the exact run before consuming the result. `resultDelivery=text-only` requires authoritative lifecycle status or finalized-artifact verification. Unknown lifecycle facts always select conservative waves.

## Supervisor questions and detach recovery

When a child needs supervisor input:

1. Reply to the original request through the host's supported channel.
2. Observe or wait for the original run; do not start a replacement while it is active or unknown.
3. Confirm the original child reaches a real terminal state and recover its finalized result.
4. Determine from authoritative host state whether the enclosing workflow continuation resumed.
5. If continuation is automatic and confirmed, observe that continuation. If it is parent-managed, Main dispatches only the remaining unexecuted stages as a new wave. If it is unsupported, unknown, or apparently lost, first prove from authoritative host state that the original workflow is no longer advancing, then dispatch only its remaining unexecuted stages.

Restoring a child is not proof that its enclosing workflow resumed. Record the last terminal stage, remaining stages, continuation owner, and wake condition in the current brief when continuity material is useful.

Use run identity as the idempotency key. Repeated questions, wake-ups, and completion notifications update knowledge about that run; they do not authorize a duplicate writer or a second release of the same dependency barrier. After restart or context recovery, inspect current host state and the workspace before taking action.

## Acceptance-report recovery

Malformed explicit acceptance remains rejected. Preserve implementation changes, the human-readable report, run identity, output reference, and parse diagnostics; never relabel rejection as success.

Prefer resuming the same retained child solely to correct the acceptance report, then verify that the workspace did not change during report repair. If that child cannot be resumed, Main independently rechecks the current repository and records the evidence needed to continue review. Independent review may continue because product artifacts still exist, but required explicit acceptance remains unresolved until corrected or the user explicitly waives it. Do not reimplement completed work merely to regenerate a report, and do not skip review because report parsing failed.

## Failures and completion

- **Partial parallel failure:** collect every lane's terminal outcome before deciding whether a dependent wave is safe; never fabricate a successful aggregate.
- **Timeout:** treat the run as nonterminal until the host confirms termination; inspect possible partial writes before replacement.
- **Cancellation or stop:** preserve useful artifacts, record unexecuted stages, and do not describe the cancelled scope as complete.
- **Unknown or lost continuation:** prove the original workflow is no longer advancing, then let Main launch only the missing stages.
- **Repeated notification:** reconcile by exact run identity and consume each terminal result once.

Use precise user-facing states with these meanings (localized wording is allowed): `后台运行中`, `等待主管决策`, `子线程已恢复/外层待确认`, `等待最终评审`, `待 Main 验收`, and `已交付`. “Child” may refer to the host's run, job, or subthread abstraction. Ending an interactive turn while background work runs is not delivery. Use `已交付` only after required final review, validation, finding disposition, and Main acceptance are complete; otherwise state the active owner, remaining work, and wake condition.
