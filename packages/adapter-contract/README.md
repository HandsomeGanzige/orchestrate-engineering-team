# @orchestrate-engineering-team/adapter-contract

Host-neutral Adapter v1 validation, conformance helpers, and generic prompt fallback.

## Status

This is a Node.js 22 ESM workspace package at version `1.0.0`. It contains no concrete host Adapter and is currently source-only rather than published to npm.

## Adapter interface

An Adapter must provide:

- `apiVersion: "orchestrate-engineering-team/adapter-v1"`;
- a stable lowercase `id`;
- `detect(context)`;
- `validateBinding(binding)`;
- `resolve(request)`;
- `diagnose(plan)`;
- optional `scaffold(options)`.

`resolve()` returns a LaunchPlan with `adapter`, `agent`, `mode`, `toolsPolicy`, `sandbox`, `isolation`, and string `limitations`. `grantedCapabilities` and `prompt` are optional.

LaunchPlan also accepts three optional continuity facts. Omitted values normalize to `unknown` so existing Adapters remain compatible:

- `resultDelivery`: `terminal-result | receipt-notification | text-only | unknown`;
- `dependencyBarrier`: `terminal-only | nonterminal-possible | unknown`;
- `supervisorContinuation`: `automatic | parent-managed | unsupported | unknown`.

These fields report host behavior; they grant no authority. Main may place dependent stages that can ask the supervisor in one auto-continuing workflow only when the barrier is `terminal-only` and supervisor continuation is `automatic`. Unknown or weaker semantics require parent-managed waves. A `text-only` result also needs authoritative lifecycle status or finalized-artifact verification before it can release a dependent stage.

## Exports

- `ADAPTER_API_VERSION` and `HOST_FACT_VALUES`;
- `validateAdapter()` and `validateLaunchPlan()`;
- `assertAuthorityNotExpanded()`;
- `runAdapterConformance()`;
- `genericPromptFallback()`.

The conformance helper checks interface shape, LaunchPlan enums, continuity-fact normalization, diagnosis shape, and direct overlap between a request's prohibited capabilities and a plan's `grantedCapabilities`. It does not prove real host permissions, sandbox behavior, isolation, lifecycle behavior, or semantic compliance beyond those checks.

`genericPromptFallback()` preserves the compact role purpose, route, authority, independence, write scope, prohibited capabilities, professional guidance, returns, resolved Skill/material status and provenance, actual limitations, and explicit `unknown` host permission and continuity boundaries. It does not copy Skill bodies or claim prompt restrictions are enforced.

Fixtures under `fixtures/` show native and prompt-fallback plan shapes.
