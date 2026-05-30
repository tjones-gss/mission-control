# ADR-002: harness_core Shared Library

Status: Accepted  
Date: 2026-05-26  
Owner: harness  

## Context

The harness CLI (`tools/harness`) and Cursor SDK orchestrator (`sdk/python`) both parse
`.harness/` YAML, select missions, and evaluate pipeline gates. Duplicating this logic
risks drift.

## Decision

Extract shared utilities into `harness_core/`:

- `yaml_utils` — find root, load/save YAML, nested get
- `missions` — ready mission selection, mission path resolution
- `gates` — gate evaluator registry for pipeline phases
- `pipelines` — load pipeline YAML

Both `tools/harness` and `harness_orchestrator` import from this package.

## Consequences

Positive:
- Single source of truth for mission selection and gates
- SDK and CLI stay aligned

Negative:
- Requires `pip install -e harness_core` for development
- CLI adds repo-root `sys.path` insertion when run as script

## Related

- docs/roadmap/cursor-sdk-roadmap.md Phase 3
- SPEC-003 SDK state fields
