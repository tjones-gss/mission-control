from __future__ import annotations

import logging
from pathlib import Path

from harness_core.gates import GateContext, evaluate_gates
from harness_core.pipelines import load_pipeline, pipeline_phases
from harness_core.yaml_utils import get, load_yaml

from harness_orchestrator.cursor_driver import DriverConfig, config_from_env, create_agent, run_prompt, send_and_wait
from harness_orchestrator.roles import build_phase_prompt
from harness_orchestrator.state import (
    harness_cli,
    harness_json,
    preflight,
    resolve_mission_for_loop,
    set_pipeline_phase,
    update_sdk_state,
)

logger = logging.getLogger(__name__)

ORCHESTRATOR_AGENTS = {"orchestrator", "tester", "reviewer", "session-memory"}


def run_next_mission_loop(root: Path, config: DriverConfig) -> int:
    """Execute one next-mission-loop iteration."""
    if not config.dry_run:
        preflight(root, strict=True)

    status = harness_json(root, "status")
    try:
        next_info = harness_json(root, "next")
    except RuntimeError:
        if config.dry_run:
            next_info = {"recommended": None, "ready_missions": []}
        else:
            raise
    pipeline = load_pipeline(root, "next-mission-loop")
    phases = pipeline_phases(pipeline)

    mission_id, mission_path = resolve_mission_for_loop(root)
    mission_body = mission_path.read_text() if mission_path else None
    implementation_occurred = False

    implementer_agent = None
    agent_id: str | None = config.resume_agent_id
    all_gate_failures: list[str] = []

    if config.resume_agent_id:
        implementer_agent = create_agent(config)
        agent_id = getattr(implementer_agent, "agent_id", config.resume_agent_id)

    for phase in phases:
        phase_id = phase.get("id", "unknown")
        agent_name = phase.get("agent", "orchestrator")
        gate_required = (phase.get("gate") or {}).get("required") or []

        set_pipeline_phase(root, phase_id, gate_required[0] if gate_required else None)

        prompt = build_phase_prompt(
            root,
            agent_name,
            phase,
            status_json={"status": status, "next": next_info},
            mission_body=mission_body if agent_name == "implementer" else None,
        )

        if agent_name == "implementer":
            if implementer_agent is None:
                implementer_agent = create_agent(config)
                agent_id = getattr(implementer_agent, "agent_id", None)
            result = send_and_wait(implementer_agent, prompt)
            implementation_occurred = True
            update_sdk_state(
                root,
                agent_id=agent_id,
                run_id=result.run_id,
                runtime=config.runtime,
                mission=mission_id,
            )
        elif agent_name in ORCHESTRATOR_AGENTS and agent_name != "implementer":
            cfg = config_from_env(
                cwd=str(root),
                runtime=config.runtime,
                dry_run=config.dry_run,
                api_key=config.api_key,
            )
            result = run_prompt(cfg, prompt)
            update_sdk_state(root, run_id=result.run_id, runtime=config.runtime)
        else:
            result = run_prompt(
                config_from_env(cwd=str(root), runtime=config.runtime, dry_run=config.dry_run, api_key=config.api_key),
                prompt,
            )
            update_sdk_state(root, run_id=result.run_id, runtime=config.runtime)

        ctx = GateContext(
            root=root,
            mission_id=mission_id,
            phase_id=phase_id,
            implementation_occurred=implementation_occurred,
        )
        ok, failures = evaluate_gates(gate_required, ctx)
        if not ok and implementation_occurred and phase_id == "validate":
            code, _ = harness_cli(root, "validate")
            ctx = GateContext(root=root, mission_id=mission_id, phase_id=phase_id, implementation_occurred=True)
            ok, failures = evaluate_gates(gate_required, ctx)

        if not ok:
            logger.warning("Phase %s gate failures: %s", phase_id, failures)
            for failure in failures:
                label = f"{phase_id}: {failure}"
                if label not in all_gate_failures:
                    all_gate_failures.append(label)

    if implementation_occurred:
        harness_cli(root, "validate")
        harness_cli(root, "handoff", *(["--mission", mission_id] if mission_id else []))

    if implementer_agent is not None:
        try:
            implementer_agent.close()
        except Exception:
            pass

    project = load_yaml(root / ".harness/project-state.yml")
    logger.info(
        "Loop complete mission=%s agent_id=%s runtime=%s",
        mission_id,
        get(project, "current", "agent_id"),
        config.runtime,
    )

    enforce_strict = config.strict_gates and not config.dry_run
    if enforce_strict and all_gate_failures:
        logger.error("Strict gate failures (%d): %s", len(all_gate_failures), all_gate_failures)
        return 3

    return 0
