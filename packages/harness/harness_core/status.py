"""Single source for the `harness status --json` payload.

Both the CLI (`harness status --json`) and the MCP server's `harness_status`
tool emit THIS structure — one composition, no drift. The shape is the
versioned vendor-neutral contract published in packages/contracts (SPEC.md /
harness-status schema); change the contract first, then this.

Every enriched field (phases, transitions, guardrails, budget, gates) is
emitted from REAL data the harness already knows and is GRACEFULLY ABSENT when
its source is missing — a status payload never crashes and never invents data.
"""

from __future__ import annotations

from pathlib import Path

from harness_core.yaml_utils import get, load_yaml

# Gates that record a human decision rather than an automated evaluation. Their
# name is in the gate registry but they are NOT "auto" — a human must act.
_HUMAN_GATES = {"human_approval_for_plan"}


def _transitions(pipeline_state: dict) -> dict:
    """Copy the phase-transition rules verbatim from pipeline-state.yml.

    Passes through whatever `allowed_transitions` / `blocked_transitions`
    contain (in this repo: allowed is a map phase->list, blocked is a map
    name->bool). A key is omitted when its source key is absent.
    """
    out: dict = {}
    if "allowed_transitions" in pipeline_state:
        out["allowed"] = pipeline_state["allowed_transitions"]
    if "blocked_transitions" in pipeline_state:
        out["blocked"] = pipeline_state["blocked_transitions"]
    return out


def _build_phases(canonical_phases: list[dict]) -> list[dict]:
    """Project the canonical phase objects onto the published phase shape."""
    phases: list[dict] = []
    for phase in canonical_phases:
        entry: dict = {"id": phase.get("id")}
        for key in ("agent", "strategy", "goal", "description", "tier"):
            value = phase.get(key)
            if value is not None:
                entry[key] = value
        gate = phase.get("gate")
        if isinstance(gate, dict):
            required = gate.get("required")
            entry["gate"] = {
                "required": list(required) if isinstance(required, list) else []
            }
        phases.append(entry)
    return phases


def _build_gates(canonical_phases: list[dict]) -> dict:
    """Classify every gate name referenced by the active pipeline's phases.

    auto=true when the name is a real evaluator in the harness gate registry and
    is not a human-approval gate; auto=false for human-approval gates and for
    names the registry does not know.
    """
    from harness_core.gates import GATE_EVALUATORS

    gates: dict = {}
    for phase in canonical_phases:
        gate = phase.get("gate")
        required = gate.get("required") if isinstance(gate, dict) else None
        for name in required or []:
            if not isinstance(name, str):
                continue
            auto = name in GATE_EVALUATORS and name not in _HUMAN_GATES
            gates[name] = {"auto": auto}
    return gates


def _phases_and_gates(root: Path, active) -> tuple[list[dict] | None, dict | None]:
    """Load the active pipeline definition and derive phases + gate map.

    Returns (None, None) — both keys omitted — when there is no active pipeline
    name or the definition is missing/invalid. Never raises.
    """
    if not isinstance(active, str) or not active:
        return None, None
    try:
        from harness_core.pipelines import load_pipeline, pipeline_phases

        canonical = pipeline_phases(load_pipeline(root, active))
    except Exception:
        return None, None
    if not canonical:
        return None, None
    return _build_phases(canonical), _build_gates(canonical)


def _guardrails(root: Path) -> dict:
    """Summarize which guardrail config files exist and their shape.

    Each sub-object always carries `present`; details (counts + names) appear
    only when the config file exists. Never dumps full policy bodies (danger
    zone stays counts + policy; quality gates surface the stage->checks map).
    """
    guardrails: dict = {}

    danger = load_yaml(root / ".harness/danger-zone.yml")
    if danger:
        entry: dict = {"present": True}
        policy = danger.get("policy")
        if policy is not None:
            entry["policy"] = policy
        approvals = get(danger, "dangerous_operations", "require_human_approval")
        if isinstance(approvals, list):
            entry["approval_required_count"] = len(approvals)
        patterns = danger.get("blocked_command_patterns")
        if isinstance(patterns, list):
            entry["blocked_pattern_count"] = len(patterns)
        guardrails["danger_zone"] = entry
    else:
        guardrails["danger_zone"] = {"present": False}

    quality_doc = load_yaml(root / ".harness/quality-gates.yml")
    quality = quality_doc.get("quality_gates")
    if isinstance(quality, dict) and quality:
        entry = {"present": True}
        stages: dict = {}
        for stage, cfg in quality.items():
            required = cfg.get("required") if isinstance(cfg, dict) else None
            if isinstance(required, list):
                stages[stage] = required
        if stages:
            entry["stages"] = stages
        failure_policy = quality_doc.get("failure_policy")
        if failure_policy is not None:
            entry["failure_policy"] = failure_policy
        guardrails["quality_gates"] = entry
    else:
        guardrails["quality_gates"] = {"present": False}

    approval_doc = load_yaml(root / ".harness/human-approval-policy.yml")
    if approval_doc:
        entry = {"present": True}
        required = approval_doc.get("approval_required")
        if isinstance(required, dict):
            entry["categories"] = list(required.keys())
        guardrails["human_approval"] = entry
    else:
        guardrails["human_approval"] = {"present": False}

    return guardrails


def _budget(root: Path) -> dict | None:
    """Resolve the run cost ceiling + spend for the active loop ledger.

    Omitted entirely (returns None) when there is no cost policy AND no ledger —
    cost tracking is opt-in, so an unconfigured project reports no budget rather
    than a misleading zero.
    """
    try:
        from harness_core.cost import is_exceeded, load_ledger, resolve_ceiling

        ceiling = resolve_ceiling(root)
        ledger = load_ledger(root)
    except Exception:
        return None
    if ceiling is None and ledger is None:
        return None
    budget: dict = {"currency": "USD", "ceiling_usd": ceiling}
    if ledger is not None:
        budget["spent_usd"] = ledger.spent_usd
        budget["exceeded"] = is_exceeded(ledger)
    else:
        budget["spent_usd"] = None
        budget["exceeded"] = False
    return budget


def status_payload(root: Path) -> dict:
    project = load_yaml(root / ".harness/project-state.yml")
    pipeline_state = load_yaml(root / ".harness/pipeline-state.yml")
    missions = load_yaml(root / ".harness/mission-index.yml")
    readiness = load_yaml(root / ".harness/readiness-score.yml")
    plans = load_yaml(root / ".harness/plan-index.yml")
    pipeline = pipeline_state.get("pipeline", {})

    payload = {
        "project": project.get("project", {}),
        "stack": project.get("stack", {}),
        "pipeline": pipeline,
        "missions": missions.get("missions", {}),
        "plans": plans.get("plans", {}),
        "readiness_overall": get(readiness, "readiness", "overall", default={}),
        "next": project.get("next", {}),
    }

    transitions = _transitions(pipeline_state)
    if transitions:
        payload["transitions"] = transitions

    phases, gates = _phases_and_gates(
        root, pipeline.get("active") if isinstance(pipeline, dict) else None
    )
    if phases is not None:
        payload["phases"] = phases
    if gates is not None:
        payload["gates"] = gates

    payload["guardrails"] = _guardrails(root)

    budget = _budget(root)
    if budget is not None:
        payload["budget"] = budget

    return payload
