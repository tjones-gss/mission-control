# SPEC-002: Pipeline Schema

Status: Accepted
Related ADR: docs/adrs/ADR-001-agentic-control-plane.md

## Goal

Every file in `pipelines/` follows the same schema so the orchestrator, the CLI, and human readers can parse them the same way.

## Schema

```yaml
pipeline: <kebab-case-name>        # required — must match filename
description: <one line>            # optional — surfaced in `harness status`

rules:                              # optional — pipeline-level constraints
  <key>: <value>                    #            e.g. observe_before_edit: true

phases:                             # required — ordered list of phase objects
  - id: <kebab-case-phase-id>      # required — referenced by pipeline-state.gate
    agent: <agent-name>             # required — matches agents/roles/<agent>.md
                                    #            or .claude/agents/<agent>.md
    description: <one line>         # optional
    inputs:                         # optional — what to read for this phase
      - <path-or-glob>
    outputs:                        # required — at least one artifact path
      - <path>
    gate:                           # required — completion criteria
      required:
        - <condition-name>
    rules:                          # optional — phase-specific constraints
      - <rule>
    loop:                           # optional — nest another pipeline as a loop
      pipeline: <pipeline-file>
```

## Required fields

- `pipeline` (top level)
- `phases` (top level, non-empty list)
- For each phase: `id`, `agent`, `outputs` (at least one), `gate.required` (at least one)

## Forbidden patterns

- Bare-string phase lists (`phases: [classify_feature, create_spec, ...]`) — these read fine to a human but the orchestrator and CLI cannot extract gate/agent/outputs from them.
- Anonymous phases (no `id`) — gates in `pipeline-state.yml:allowed_transitions` reference phase ids by name.
- Phases without a gate — without a gate condition, the orchestrator can't decide when to advance.

## Validation

`tools/harness check` validates every pipeline file against this schema. CI should run `harness check` on every PR that touches `pipelines/`.
