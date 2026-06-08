from __future__ import annotations

import logging
from dataclasses import replace
from pathlib import Path

from harness_core.cost import (
    accrue,
    is_exceeded,
    new_ledger,
    per_phase_estimate,
    save_ledger,
    would_exceed,
)
from harness_core.gates import GateContext, evaluate_gates
from harness_core.model_tiers import resolve_model
from harness_core.pipelines import load_pipeline, pipeline_phases
from harness_core.yaml_utils import get, load_yaml

from harness_orchestrator.cursor_driver import DriverConfig, config_from_env
from harness_orchestrator.drivers import create_agent, run_prompt, send_and_wait
from harness_orchestrator.fleet_dispatch import FleetDispatchError, run_fleet_phase
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

    # The implementer runs on a single persistent agent whose model is bound
    # once at create_agent, so per-phase swaps aren't meaningful for it. Resolve
    # its tier up front from its pipeline phase and bind it to the base config.
    impl_phase = next((p for p in phases if p.get("agent") == "implementer"), None)
    if impl_phase is not None:
        impl_model = resolve_model(root, impl_phase, agent="implementer", cfg_default=config.model)
        if impl_model and impl_model != config.model:
            config = replace(config, model=impl_model)

    mission_id, mission_path = resolve_mission_for_loop(root)
    mission_body = mission_path.read_text() if mission_path else None
    implementation_occurred = False

    implementer_agent = None
    agent_id: str | None = config.resume_agent_id
    all_gate_failures: list[str] = []
    # When strict gates are on (and this isn't a dry run), a failing gate HALTs
    # the pipeline: dependent later phases must NOT run on an unmet gate (ADR-0006
    # "gates HALT"). Computed once so the loop can break and the finalize step can
    # be skipped on a halt.
    enforce_strict = config.strict_gates and not config.dry_run
    halted = False

    # Per-run cost ledger with a hard abort ceiling (distinct from gate HALT).
    # A ceiling of None (no cost-policy / env) means unbounded — today's behavior.
    ledger = new_ledger(root, mission_id or "next-mission-loop")
    phase_cost = per_phase_estimate(root)
    cost_aborted = False
    save_ledger(root, ledger)

    if config.resume_agent_id:
        implementer_agent = create_agent(config)
        agent_id = getattr(implementer_agent, "agent_id", config.resume_agent_id)

    for phase in phases:
        phase_id = phase.get("id", "unknown")
        agent_name = phase.get("agent", "orchestrator")
        gate_required = (phase.get("gate") or {}).get("required") or []

        # Refuse to ENTER a phase that would obviously blow the ceiling.
        if would_exceed(ledger, phase_cost):
            logger.error(
                "ABORT before phase %s: projected cost %.4f + %.4f would exceed "
                "ceiling %.4f", phase_id, ledger.spent_usd, phase_cost, ledger.ceiling_usd
            )
            set_pipeline_phase(root, phase_id, "cost_ceiling")
            cost_aborted = True
            break

        set_pipeline_phase(
            root,
            phase_id,
            gate_required[0] if gate_required else None,
            goal=phase.get("goal"),
            strategy=phase.get("strategy"),
        )

        phase_model = resolve_model(root, phase, agent=agent_name, cfg_default=config.model)

        prompt = build_phase_prompt(
            root,
            agent_name,
            phase,
            status_json={"status": status, "next": next_info},
            mission_body=mission_body if agent_name == "implementer" else None,
        )

        # Cost for THIS phase: single phases use the configured estimate; a
        # fleet phase overrides with the real spentUsd reported by the cockpit.
        strategy = phase.get("strategy", "single")
        phase_actual_cost = phase_cost
        phase_cost_source = "estimate"

        if strategy == "fleet":
            # Fleet is a phase strategy owned by the cockpit (L2). The spine (L1)
            # dispatches OUT to /api/fleet, waits for settle, accrues the real
            # cost, and writes the outcome back via the harness CLI single-writer.
            budget_remaining = (
                (ledger.ceiling_usd - ledger.spent_usd)
                if ledger.ceiling_usd is not None
                else None
            )
            try:
                fleet_state = run_fleet_phase(
                    root, phase, budget_remaining=budget_remaining
                )
            except FleetDispatchError as exc:
                # Fail closed: a requested fleet strategy that can't run is a hard
                # failure, never a silent fall-back to single-agent execution.
                logger.error("Fleet phase %s failed: %s", phase_id, exc)
                label = f"{phase_id}: fleet dispatch failed: {exc}"
                if label not in all_gate_failures:
                    all_gate_failures.append(label)
                if enforce_strict:
                    set_pipeline_phase(root, phase_id, "fleet")
                    halted = True
                    break
                continue
            implementation_occurred = True
            spent = fleet_state.get("spentUsd")
            if isinstance(spent, (int, float)) and spent > 0:
                phase_actual_cost = float(spent)
                phase_cost_source = "fleet"
            # Record the mission outcome via the single-writer CLI (never edit
            # mission-index.yml directly from the loop).
            if mission_id:
                outcome = (
                    "review"
                    if fleet_state.get("status") in ("succeeded", "partial")
                    else "failed"
                )
                harness_cli(root, "mission", "status", mission_id, outcome)
        elif agent_name == "implementer":
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
                model=phase_model,
            )
            result = run_prompt(cfg, prompt)
            update_sdk_state(root, run_id=result.run_id, runtime=config.runtime)
        else:
            result = run_prompt(
                config_from_env(
                    cwd=str(root),
                    runtime=config.runtime,
                    dry_run=config.dry_run,
                    api_key=config.api_key,
                    model=phase_model,
                ),
                prompt,
            )
            update_sdk_state(root, run_id=result.run_id, runtime=config.runtime)

        # Accrue this phase's cost and persist. Single phases use the configured
        # per-phase estimate (the drivers don't surface real token cost here); a
        # fleet phase accrues its real spentUsd (see _run_fleet_phase). Then the
        # hard ceiling latch aborts before any further work — distinct exit 4.
        accrue(ledger, phase_id, phase_actual_cost, phase_cost_source)
        save_ledger(root, ledger)
        if is_exceeded(ledger):
            logger.error(
                "ABORT after phase %s: cost %.4f reached ceiling %.4f",
                phase_id, ledger.spent_usd, ledger.ceiling_usd
            )
            set_pipeline_phase(root, phase_id, "cost_ceiling")
            cost_aborted = True
            break

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
            if enforce_strict:
                # HALT: record the halted phase/gate and stop — do not advance to
                # dependent phases on an unmet gate.
                logger.error("HALT at phase %s: %s", phase_id, failures)
                set_pipeline_phase(
                    root, phase_id, gate_required[0] if gate_required else None
                )
                halted = True
                break

    # Finalize only on a clean run. On a HALT or a cost abort the pipeline
    # stopped early, so validating/handing off would paper over the stop.
    if implementation_occurred and not halted and not cost_aborted:
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

    # Cost ceiling abort takes precedence and has its own exit code, distinct
    # from a gate HALT (3) so callers can tell a budget stop from a gate stop.
    if cost_aborted:
        logger.error("Run aborted on cost ceiling (spent %.4f)", ledger.spent_usd)
        return 4

    if enforce_strict and all_gate_failures:
        logger.error("Strict gate failures (%d): %s", len(all_gate_failures), all_gate_failures)
        return 3

    return 0
