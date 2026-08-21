# Focused resolved-role request

Use this as a prompt checklist, not a required schema. Include only information that helps the selected specialist reason independently.

## Outcome

- User outcome and focused specialist question
- Useful completion evidence

## Context

- Relevant project facts, exact files, and confirmed decisions
- Assumptions to verify; only necessary prior findings
- Canonical role purpose, authority, independence, prohibited capabilities, and return expectations

## Capabilities

- Requested Skills with stable ID, exact ref/path, required/optional status, source, and resolution status
- Materials with exact safe path and provenance
- Native Agent/Adapter or generic prompt fallback
- Effective tools policy, sandbox, isolation, and known limitations (`unknown` when unverified)

Never treat package presence as proof of per-Agent capability or silently install an adapter, plugin, extension, MCP server, or package.

## Scope and tools

- Allowed reads and writes
- Host-provided tools and real enforcement boundaries
- Integration ownership for multiple writers

## Independence

Use a fresh or explicitly isolated context when the host supports it. Product Test and Review remain independent: do not include approval coaching or unrelated implementation history.

## Return

Return concise, decision-useful conclusions, evidence and commands actually used, changed/relevant files, severity-ordered findings where applicable, blockers, uncertainty, residual risk, and recommended next action. Do not fabricate evidence or force empty fields into a template.
