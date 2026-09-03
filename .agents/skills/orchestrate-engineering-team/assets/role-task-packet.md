# Focused resolved-role request

Use this as a prompt checklist, not a required schema. Include only information that helps the selected specialist reason independently.

## Outcome

- User outcome and focused specialist question
- Useful completion evidence

## Context

- Relevant project facts, known entry files, symbols, errors or tests, and confirmed decisions; entry points are not the presumed complete scope
- Assumptions to verify; only necessary prior findings
- Canonical role purpose, authority, independence, prohibited capabilities, and return expectations

## Capabilities

- Requested Skills with stable ID, exact ref/path, required/optional status, source, and resolution status
- Materials with exact safe path and provenance
- Native Agent/Adapter or generic prompt fallback
- Effective tools policy, sandbox, isolation, and known limitations (`unknown` when unverified)

Never treat package presence as proof of per-Agent capability or silently install an adapter, plugin, extension, MCP server, or package.

## Scope and discovery

- Allowed reads and writes
- Host-provided discovery, search, semantic navigation, and execution capabilities with their real enforcement boundaries
- Integration ownership for multiple writers

Independently verify the current repository with suitable host capabilities. Locate relevant code, symbols, call relationships, tests, configuration, comments, and project documentation beyond the supplied entry points when the task requires it. No particular search tool or index implementation is required.

## Independence

Use a fresh or explicitly isolated context when the host supports it. Product Test and Review remain independent: do not include approval coaching or unrelated implementation history.

## Return

Return concise, decision-useful conclusions, evidence and commands actually used, changed/relevant files, severity-ordered findings where applicable, blockers, uncertainty, residual risk, and recommended next action. Do not fabricate evidence or force empty fields into a template.
