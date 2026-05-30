# SPEC-003: SDK State Fields

Status: Accepted  
Date: 2026-05-26  
Owner: harness  

## Context

The Cursor SDK integration needs durable identifiers in the tool-neutral control
plane so orchestrators can resume agents, route local vs cloud runtime, and
correlate runs with harness missions.

## Decision

Extend `.harness/project-state.yml` `current:` with three optional fields:

| Field | Type | Purpose |
|-------|------|---------|
| `agent_id` | string \| null | Cursor SDK agent ID (`Agent.resume`) |
| `last_run_id` | string \| null | Last SDK run ID for logs and `Agent.getRun` |
| `runtime` | `local` \| `cloud` \| null | Explicit runtime; never infer silently |

## Rules

1. Orchestrator writes these fields after each SDK `send()` / `wait()`.
2. `runtime` must be set explicitly before cloud or local invocation.
3. On mission completion, `agent_id` may be cleared; session notes retain history.
4. YAML remains source of truth for pipeline progress; SDK holds in-mission dialogue.

## Related

- `docs/roadmap/cursor-sdk-roadmap.md`
- `sdk/README.md`
- ADR-001 agentic control plane
