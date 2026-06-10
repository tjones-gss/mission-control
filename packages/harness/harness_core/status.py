"""Single source for the `harness status --json` payload.

Both the CLI (`harness status --json`) and the MCP server's `harness_status`
tool emit THIS structure — one composition, no drift. The shape is the
versioned vendor-neutral contract published in packages/contracts (SPEC.md /
harness-status schema); change the contract first, then this.
"""

from __future__ import annotations

from pathlib import Path

from harness_core.yaml_utils import get, load_yaml


def status_payload(root: Path) -> dict:
    project = load_yaml(root / ".harness/project-state.yml")
    pipeline = load_yaml(root / ".harness/pipeline-state.yml")
    missions = load_yaml(root / ".harness/mission-index.yml")
    readiness = load_yaml(root / ".harness/readiness-score.yml")
    plans = load_yaml(root / ".harness/plan-index.yml")
    return {
        "project": project.get("project", {}),
        "stack": project.get("stack", {}),
        "pipeline": pipeline.get("pipeline", {}),
        "missions": missions.get("missions", {}),
        "plans": plans.get("plans", {}),
        "readiness_overall": get(readiness, "readiness", "overall", default={}),
        "next": project.get("next", {}),
    }
