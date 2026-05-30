from __future__ import annotations

from pathlib import Path

from harness_core.yaml_utils import get, load_yaml


def list_ready_missions(root: Path) -> list[tuple[str, dict]]:
    missions = load_yaml(root / ".harness/mission-index.yml")
    do_not_select = set(missions.get("do_not_select") or [])
    mission_dict = missions.get("missions") or {}
    if not isinstance(mission_dict, dict):
        return []

    ready: list[tuple[str, dict]] = []
    for mid, data in mission_dict.items():
        if not isinstance(data, dict):
            continue
        status = data.get("status", "")
        if status == "ready" and status not in do_not_select:
            ready.append((mid, data))

    priority_order = {"high": 0, "medium": 1, "low": 2}
    ready.sort(key=lambda kv: priority_order.get(kv[1].get("priority", "medium"), 1))
    return ready


def select_next_mission(root: Path) -> str | None:
    ready = list_ready_missions(root)
    return ready[0][0] if ready else None


def get_mission_path(root: Path, mission_id: str | None) -> Path | None:
    if not mission_id:
        return None
    missions = load_yaml(root / ".harness/mission-index.yml")
    entry = (missions.get("missions") or {}).get(mission_id)
    if isinstance(entry, dict) and entry.get("file"):
        p = root / entry["file"]
        if p.exists():
            return p
    for cand in (root / "runs/missions").glob(f"{mission_id}*.md"):
        return cand
    return None


def get_current_mission(root: Path) -> str | None:
    project = load_yaml(root / ".harness/project-state.yml")
    mid = get(project, "current", "mission")
    if mid in (None, "", "null", "unset"):
        return None
    return str(mid)
