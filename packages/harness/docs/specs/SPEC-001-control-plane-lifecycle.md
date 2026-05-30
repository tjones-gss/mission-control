# SPEC-001: Control Plane Lifecycle

Status: Draft  
Related ADR: docs/adrs/ADR-001-agentic-control-plane.md  

## Goal

Define how the harness routes work through state, agents, gates, and stop conditions.

## Requirements

- [ ] orchestrator reads state before action
- [ ] implementation requires mission
- [ ] gates block invalid transitions
- [ ] dangerous operations require human approval
- [ ] mission index tracks status
- [ ] session notes preserve memory

## Acceptance Criteria

- [ ] next action can be determined from state files
- [ ] code edits are blocked without missions
- [ ] release requires readiness gate
