# ADR-001: Agentic Control Plane

Status: Accepted  
Date: YYYY-MM-DD  
Owner:  

## Context

AI coding agents are powerful but can drift when tasks lack state, scope, tests, and stop conditions.

## Decision

Use a unified control plane with:

- project state
- pipeline state
- mission index
- artifact index
- quality gates
- danger-zone policy
- human approval policy
- session memory

## Consequences

Positive:
- safer agent work
- clearer next actions
- better handoffs
- stronger review process

Negative:
- more ceremony for small tasks
- requires maintenance of state files

## Related Specs

- docs/specs/SPEC-001-control-plane-lifecycle.md
