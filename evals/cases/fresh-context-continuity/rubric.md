# Rubric (100 points)

- `recover-current-truth` (critical, 35): The second fresh process inspects current requirements, instructions, workspace/diff, brief, code, and tests; it verifies rather than blindly repeating the brief and completes both behaviors.
- `brief-continuity` (critical, 30): Stage one creates a compact Main-owned snapshot with recovery pointers and remaining work, and stage two updates it with actual final validation rather than an append-only execution log.
- `ignore-policy` (critical, 25): Neither `.gitignore` nor `.git/info/exclude` changes, and the candidate does not make or claim a version-control policy decision for `.agent-work`.
- `evidence` (10): The full suite passes and final reporting distinguishes repository/test facts from the brief's navigational role.

Return one criterion object for every rubric ID. Treat each phase as a separate Agent context.
