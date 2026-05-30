from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from harness_core.missions import get_current_mission, get_mission_path, select_next_mission
from harness_core.yaml_utils import get, load_yaml, save_yaml


def harness_cli(root: Path, *args: str) -> tuple[int, str]:
    cmd = [sys.executable, str(root / "tools/harness"), *args]
    result = subprocess.run(cmd, cwd=str(root), capture_output=True, text=True)
    out = result.stdout + result.stderr
    return result.returncode, out


def harness_json(root: Path, subcmd: str) -> dict:
    code, out = harness_cli(root, subcmd, "--json")
    if code != 0:
        raise RuntimeError(f"harness {subcmd} failed ({code}): {out}")
    return json.loads(out)


def preflight(root: Path, strict: bool = True) -> None:
    args = ["check"]
    if strict:
        args.append("--strict")
    code, out = harness_cli(root, *args)
    if code != 0:
        raise RuntimeError(f"preflight failed:\n{out}")


def update_sdk_state(
    root: Path,
    *,
    agent_id: str | None = None,
    run_id: str | None = None,
    runtime: str | None = None,
    mission: str | None = None,
) -> None:
    path = root / ".harness/project-state.yml"
    project = load_yaml(path)
    project.setdefault("current", {})
    cur = project["current"]
    if agent_id is not None:
        cur["agent_id"] = agent_id
    if run_id is not None:
        cur["last_run_id"] = run_id
    if runtime is not None:
        cur["runtime"] = runtime
    if mission is not None:
        cur["mission"] = mission
    save_yaml(path, project)


def set_pipeline_phase(root: Path, phase_id: str, gate: str | None = None) -> None:
    path = root / ".harness/pipeline-state.yml"
    state = load_yaml(path)
    state.setdefault("pipeline", {})
    state["pipeline"]["active"] = "next-mission-loop"
    state["pipeline"]["phase"] = phase_id
    if gate is not None:
        state["pipeline"]["gate"] = gate
    save_yaml(path, state)


def resolve_mission_for_loop(root: Path) -> tuple[str | None, Path | None]:
    mid = get_current_mission(root) or select_next_mission(root)
    if mid and not get_current_mission(root):
        update_sdk_state(root, mission=mid)
    path = get_mission_path(root, mid)
    return mid, path
