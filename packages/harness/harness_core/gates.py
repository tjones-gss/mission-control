from __future__ import annotations

import re
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from harness_core.missions import (
    allowed_patterns,
    forbidden_patterns,
    get_current_mission,
    get_mission_path,
    path_matches_any,
)
from harness_core.yaml_utils import get, load_yaml

# The validate report (tools/harness::cmd_validate) writes one
# `**Status:** ✓ pass (exit 0)` / `✗ fail (exit 1)` line per command and a
# `**TIMEOUT after 600s**` marker on timeout. The verdict gates parse those.
_EXIT_LINE = re.compile(r"\*\*Status:\*\*.*?\(exit\s+(\d+)\)")
_TIMEOUT_MARKER = "**TIMEOUT"


def _report_passed(path: Path) -> bool:
    """True iff a validate report shows a real PASS verdict.

    Requires at least one parsed `(exit N)` line, every exit code 0, and no
    TIMEOUT marker. An unparseable report (present but no recognizable verdict)
    fails CLOSED — a report that exists but cannot be shown to pass is not
    evidence of passing validation (mirrors Fleet's parseVerdict fail-closed).
    """
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    if _TIMEOUT_MARKER in text:
        return False
    codes = _EXIT_LINE.findall(text)
    if not codes:
        return False
    return all(code == "0" for code in codes)


def _review_mergeable(path: Path) -> bool:
    """True iff a review report's `## Mergeable?` section answers Yes.

    Convention from runs/templates/review-report-template.md: the first
    non-empty line under `## Mergeable?` is Yes or No. Unparseable / No / missing
    section fails CLOSED.
    """
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return False
    in_sec = False
    for line in lines:
        if line.startswith("##"):
            in_sec = line.strip().lower().startswith("## mergeable")
            continue
        if in_sec and line.strip():
            return line.strip().lower().startswith("yes")
    return False


def _git_touched_files(root: Path) -> list[str]:
    """Repo-relative paths touched in the working tree (staged, unstaged, new).

    Uses `git status --porcelain` so untracked NEW files count too. Returns []
    when git is unavailable or the dir isn't a repo — scope policing then
    degrades to a no-op (best-effort, consistent with the rails framing) rather
    than producing false HALTs.
    """
    try:
        proc = subprocess.run(
            # --untracked-files=all lists each new file individually; without it
            # git collapses an untracked directory to just "dir/", which would
            # hide the real per-file paths scope_adherence must check.
            ["git", "-C", str(root), "status", "--porcelain", "--untracked-files=all"],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if proc.returncode != 0:
        return []
    touched: list[str] = []
    for line in proc.stdout.splitlines():
        if len(line) < 4:
            continue
        entry = line[3:]
        # Renames/copies are reported as "ORIG -> NEW": take the destination.
        if " -> " in entry:
            entry = entry.split(" -> ", 1)[1]
        entry = entry.strip().strip('"')
        if entry:
            touched.append(entry)
    return touched


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
    # Vacuously true when nothing was implemented (legitimate skip).
    if not ctx.implementation_occurred:
        return True
    mid = ctx.mission_id
    if not mid:
        return False
    reports = ctx.root / "runs/test-reports"
    if not reports.is_dir():
        return False
    # Verification is not theater: the report must not merely EXIST, it must
    # show a real pass verdict. A failing or unparseable report fails the gate.
    matching = [p for p in reports.glob("*.md") if mid in p.name]
    if not matching:
        return False
    return any(_report_passed(p) for p in matching)


@register_gate("review_recorded_or_skip_documented")
def _review_recorded(ctx: GateContext) -> bool:
    # Vacuously true when nothing was implemented (legitimate skip).
    if not ctx.implementation_occurred:
        return True
    mid = ctx.mission_id
    if not mid:
        return False
    reviews = ctx.root / "runs/reviews"
    if not reviews.is_dir():
        return False
    # The review must record a Mergeable? Yes verdict — a recorded "No" (or an
    # unparseable review) fails the gate rather than passing on file presence.
    matching = [p for p in reviews.glob("*.md") if mid in p.name]
    if not matching:
        return False
    return any(_review_mergeable(p) for p in matching)


@register_gate("scope_adherence")
def _scope_adherence(ctx: GateContext) -> bool:
    """Touched files must stay inside the mission's Allowed/Forbidden globs.

    What this verifies: every file changed in the working tree matches the
    mission's `## Allowed Files` globs and none matches `## Forbidden Files`.
    Passes vacuously when no implementation occurred. Fails CLOSED when work
    happened but no mission scope can be located. Degrades to pass when git
    can't enumerate changes (best-effort, not a sandbox).
    """
    if not ctx.implementation_occurred:
        return True
    path = get_mission_path(ctx.root, ctx.mission_id)
    if path is None:
        # Code changed but we cannot attribute it to a scoped mission.
        return False
    allowed = allowed_patterns(path)
    forbidden = forbidden_patterns(path)
    for touched in _git_touched_files(ctx.root):
        if forbidden and path_matches_any(touched, forbidden):
            return False
        if allowed and not path_matches_any(touched, allowed):
            return False
    return True


@register_gate("human_approval_for_plan")
def _plan_approved(ctx: GateContext) -> bool:
    """True when at least one PRD in plan-index.yml is approved.

    What this verifies: a human approval was recorded for a plan. `status:
    approved` is only written by `harness plan sync`, which projects it from a
    matching approval-decision (decision == allow) in .harness/approvals/ — so
    the projection, not a hand-edited field, is what flips this gate. What it
    CANNOT verify: that the approved plan is the *right* plan.
    """
    index = load_yaml(ctx.root / ".harness/plan-index.yml")
    plans = index.get("plans")
    if not isinstance(plans, dict):
        return False
    return any(
        isinstance(data, dict) and data.get("status") == "approved"
        for data in plans.values()
    )


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
