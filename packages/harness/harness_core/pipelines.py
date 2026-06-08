from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from harness_core.yaml_utils import load_yaml


class PipelineValidationError(ValueError):
    """Raised when an authored pipeline phase violates the shared contract.

    Carries all collected errors (across every phase) so a malformed pipeline
    reports everything wrong at once, not just the first problem.
    """


@lru_cache(maxsize=1)
def load_pipeline_phase_schema() -> dict | None:
    """Load the shared pipeline-phase JSON schema, or None if unavailable.

    The schema lives in the sibling contracts package
    (packages/contracts/schemas/pipeline-phase.schema.json). pipelines.py is at
    packages/harness/harness_core/pipelines.py, so the contracts package is at
    parents[2]/contracts. Returns None on a standalone harness install detached
    from the monorepo (so validation degrades to a no-op rather than crashing) —
    fail OPEN on tooling absence, never on a real violation.
    """
    schema_path = (
        Path(__file__).resolve().parents[2]
        / "contracts"
        / "schemas"
        / "pipeline-phase.schema.json"
    )
    try:
        return json.loads(schema_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def validate_phase(phase: dict) -> list[str]:
    """Validate one phase against the shared contract; return error messages.

    Empty list == valid. Fails OPEN (returns []) when the schema or the
    jsonschema library is unavailable — the spine never blocks on missing
    tooling, only on a genuine contract violation. This is the single definition
    of phase validation; both the orchestrator loader (load_pipeline) and the
    `harness check` CLI call it.
    """
    schema = load_pipeline_phase_schema()
    if schema is None:
        return []
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        return []
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(phase), key=lambda e: list(e.path))
    return [
        f"at {list(e.path) or '<root>'}: {e.message}" for e in errors
    ]


def load_pipeline(root: Path, name: str) -> dict:
    """Load a pipeline YAML and validate its phases against the contract.

    Raises PipelineValidationError if any phase violates the shared schema
    (fail-closed on a real, malformed pipeline). Validation is skipped (no-op)
    when the schema is unavailable — see validate_phase.
    """
    pipeline = load_yaml(root / "pipelines" / f"{name}.yml")
    problems: list[str] = []
    for phase in pipeline.get("phases") or []:
        if not isinstance(phase, dict):
            continue
        for err in validate_phase(phase):
            problems.append(f"phase '{phase.get('id', '?')}': {err}")
    if problems:
        raise PipelineValidationError(
            f"pipeline '{name}' has {len(problems)} phase contract violation(s):\n"
            + "\n".join(f"  - {p}" for p in problems)
        )
    return pipeline


def pipeline_phases(pipeline: dict) -> list[dict]:
    """Return the canonical phase objects for a pipeline.

    Materializes the canonical phase shape so downstream code (the loop, gate
    dispatch, strategy dispatch, goal-alignment) always sees a complete object:
      - strategy defaults to "single"
      - goal is carried from the pipeline description/goal/name when a phase does
        not declare its own (goal carry-through for alignment checks)
      - gate defaults to an empty required set
    Non-dict entries (e.g. a bare string) are skipped. Authored values are never
    overwritten.
    """
    goal = (
        pipeline.get("description")
        or pipeline.get("goal")
        or pipeline.get("pipeline")
    )
    canonical: list[dict] = []
    for phase in pipeline.get("phases") or []:
        if not isinstance(phase, dict):
            continue
        phase = dict(phase)
        phase.setdefault("strategy", "single")
        if goal is not None:
            phase.setdefault("goal", goal)
        gate = phase.get("gate")
        if not isinstance(gate, dict):
            gate = {}
        gate.setdefault("required", [])
        phase["gate"] = gate
        canonical.append(phase)
    return canonical
