from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from harness_core.missions import get_current_mission
from harness_core.yaml_utils import get, load_yaml


@dataclass
class GateContext:
    root: Path
    mission_id: str | None = None
    phase_id: str | None = None
    implementation_occurred: bool = False

    def __post_init__(self) -> None:
        if self.mission_id is None:
            self.mission_id = get_current_mission(self.root)


GATE_EVALUATORS: dict[str, Callable[[GateContext], bool]] = {}


def register_gate(name: str):
    def deco(fn):
        GATE_EVALUATORS[name] = fn
        return fn
    return deco


@register_gate("state_read_complete")
def _state_read_complete(ctx: GateContext) -> bool:
    for rel in (
        ".harness/project-state.yml",
        ".harness/pipeline-state.yml",
        ".harness/mission-index.yml",
    ):
        if not (ctx.root / rel).exists():
            return False
    return True


def _stop_reason_documented(project: dict) -> bool:
    """A documented stop reason = next.blocked is true AND next.blocker is a
    non-empty string. This verifies the *presence and shape* of a stop reason;
    it cannot judge whether the stated blocker is actually true or sensible."""
    blocked = get(project, "next", "blocked")
    blocker = get(project, "next", "blocker")
    return blocked is True and isinstance(blocker, str) and blocker.strip() != ""


@register_gate("one_valid_next_action_chosen_or_stop_reason_documented")
def _one_valid_action(ctx: GateContext) -> bool:
    # Honest evaluation: read project-state.yml and require that the agent has
    # either chosen a concrete next action OR documented why it stopped.
    # What this verifies: a non-empty recommended_action string exists, or a
    # blocked+blocker stop reason is recorded. What it CANNOT verify: that the
    # recommended action is the *correct* next action, or that the blocker is
    # genuine — only that the field is populated, not abandoned/empty.
    project = load_yaml(ctx.root / ".harness/project-state.yml")
    action = get(project, "next", "recommended_action")
    if isinstance(action, str) and action.strip() != "":
        return True
    return _stop_reason_documented(project)


@register_gate("work_completed_within_scope_or_stop_reason_documented")
def _work_completed(ctx: GateContext) -> bool:
    # Only meaningful when implementation actually occurred. If no code changed,
    # there is nothing to have completed, so this passes vacuously.
    if not ctx.implementation_occurred:
        return True
    project = load_yaml(ctx.root / ".harness/project-state.yml")
    # A documented stop reason is always an acceptable terminal state.
    if _stop_reason_documented(project):
        return True
    mid = ctx.mission_id
    if not mid:
        # Implementation happened but we cannot attribute it to a mission and no
        # stop reason is recorded — that is not honestly "completed within scope".
        return False
    # The mission is marked complete/review in the index = closure was recorded.
    # What this verifies: that *someone declared* the mission done/under review.
    # What it CANNOT verify: that the implementation truly stayed within the
    # mission's declared scope (allowed/forbidden files) — that is a separate
    # concern the diff/permission hooks police, not this gate.
    missions = load_yaml(ctx.root / ".harness/mission-index.yml")
    entry = (missions.get("missions") or {}).get(mid)
    if isinstance(entry, dict) and entry.get("status") in ("complete", "review"):
        return True
    # Fall back to the same runs/session-notes evidence the session-note gate
    # uses: a recorded session note for this mission is evidence work was wrapped
    # up rather than abandoned mid-flight.
    notes = ctx.root / "runs/session-notes"
    if notes.is_dir():
        for p in notes.glob("*.md"):
            if mid in p.name or mid in p.read_text(errors="replace"):
                return True
    return False


@register_gate("validation_recorded_or_skip_documented")
def _validation_recorded(ctx: GateContext) -> bool:
    if not ctx.implementation_occurred:
        return True
    mid = ctx.mission_id
    if not mid:
        return False
    reports = ctx.root / "runs/test-reports"
    if not reports.is_dir():
        return False
    return any(mid in p.name for p in reports.glob("*.md"))


@register_gate("review_recorded_or_skip_documented")
def _review_recorded(ctx: GateContext) -> bool:
    if not ctx.implementation_occurred:
        return True
    mid = ctx.mission_id
    if not mid:
        return False
    reviews = ctx.root / "runs/reviews"
    if not reviews.is_dir():
        return False
    return any(mid in p.name for p in reviews.glob("*.md"))


@register_gate("state_files_consistent")
def _state_consistent(ctx: GateContext) -> bool:
    return _state_read_complete(ctx)


@register_gate("session_note_written_if_meaningful_work_occurred")
def _session_note(ctx: GateContext) -> bool:
    if not ctx.implementation_occurred:
        return True
    mid = ctx.mission_id
    if not mid:
        return True
    notes = ctx.root / "runs/session-notes"
    if not notes.is_dir():
        return False
    for p in notes.glob("*.md"):
        if mid in p.name or mid in p.read_text(errors="replace"):
            return True
    return False


def evaluate_gate(name: str, ctx: GateContext) -> tuple[bool, str]:
    fn = GATE_EVALUATORS.get(name)
    if fn is None:
        return False, f"unknown gate: {name}"
    try:
        ok = bool(fn(ctx))
    except Exception as exc:
        return False, f"gate {name} error: {exc}"
    if ok:
        return True, ""
    return False, f"gate not satisfied: {name}"


def evaluate_gates(required: list[str], ctx: GateContext) -> tuple[bool, list[str]]:
    failures: list[str] = []
    for name in required:
        ok, msg = evaluate_gate(name, ctx)
        if not ok:
            failures.append(msg or name)
    return len(failures) == 0, failures
