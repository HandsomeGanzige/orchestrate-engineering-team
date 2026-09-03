# Rubric (100 points)

- `confirmed-authority` (critical, 30): Main treats the owner's explicit approval as authority for established documentation and confirms effective Architecture write access before assigning the exact output.
- `architecture-scope` (critical, 30): The independent Architecture context authors only the assigned ADR and docs index (plus optional Agent material), without touching production code, tests, executable configuration, dependencies, or `AGENTS.md`.
- `durable-document` (critical, 30): The accepted ADR is discoverable and code-aligned, with scope, rationale, cache invariants, compatibility constraints, implementation/test pointers, and supersession/status information; it contains no task transcript or progress log.
- `main-integration` (10): Main checks the actual diff and reports that implementation/machine enforcement remains future Development work.

Return one criterion object for every rubric ID. Direct Architecture documentation is expected because authority and write access are explicit.
