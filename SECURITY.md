# Security Policy

## Supported versions

Security fixes are provided for the latest published `0.1.x` release. Pre-release branches and older snapshots may receive fixes only through an upgrade to the latest release.

## Report a vulnerability

Please use GitHub's private vulnerability reporting flow in the repository Security tab rather than filing a public issue. Include the affected version, impact, reproduction steps or a proof of concept, and any suggested mitigation. Avoid including secrets or data from other people.

The maintainer aims to acknowledge a report within 7 days and provide an initial assessment within 14 days. Disclosure timing will be coordinated with the reporter when a vulnerability is confirmed.

## Security-relevant behavior

Reports are especially useful for:

- prompt injection that crosses the documented user, Main Agent, or specialist-role authority boundaries;
- unintended file writes, task-state changes, or command execution outside a bounded task package;
- unsafe path resolution in Plugin, Skill, registry, or template resources;
- malicious or unexpectedly executed scripts and dependency or release supply-chain issues;
- leakage of credentials, private repository material, or subagent context.

`agent-profiles.yaml` is advisory metadata, not an enforcement boundary. A report should distinguish an instruction-contract violation from a bypass of runtime sandboxing supplied by Codex or the host environment.
