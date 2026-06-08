#!/usr/bin/env python3
"""
tests/test_gates.py — Tests for the real (non-stubbed) quality gates.

Covers the two gates that previously returned True unconditionally:
  - one_valid_next_action_chosen_or_stop_reason_documented
  - work_completed_within_scope_or_stop_reason_documented

Each is asserted False for an unsatisfied state and True for a satisfied state.

Run:
    python3 tests/test_gates.py
or, from the harness package root:
    python3 -m unittest tests.test_gates
"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import subprocess  # noqa: E402

from harness_core.gates import GateContext, evaluate_gate  # noqa: E402

ONE_VALID = "one_valid_next_action_chosen_or_stop_reason_documented"
WORK_DONE = "work_completed_within_scope_or_stop_reason_documented"
VALIDATION = "validation_recorded_or_skip_documented"
REVIEW = "review_recorded_or_skip_documented"
SCOPE = "scope_adherence"


def write_state(root: Path, *, next_block: str, current_mission="null"):
    (root / ".harness").mkdir(parents=True, exist_ok=True)
    (root / ".harness/project-state.yml").write_text(
        "project:\n  name: t\n  mode: feature-development\n  stage: implementation\n"
        f"current:\n  mission: {current_mission}\n"
        f"{next_block}"
    )


def write_mission_index(root: Path, mission_id: str, status: str):
    (root / ".harness").mkdir(parents=True, exist_ok=True)
    (root / ".harness/mission-index.yml").write_text(
        "missions:\n"
        f"  {mission_id}:\n"
        f"    status: {status}\n"
    )


class TestOneValidNextAction(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="harness-gates-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_fails_when_no_action_and_not_blocked(self):
        # Empty recommended_action, not blocked, no blocker -> abandoned state.
        write_state(
            self.tmp,
            next_block="next:\n  recommended_action: ''\n  blocked: false\n  blocker: null\n",
        )
        ok, msg = evaluate_gate(ONE_VALID, GateContext(root=self.tmp))
        self.assertFalse(ok, msg)

    def test_passes_with_recommended_action(self):
        write_state(
            self.tmp,
            next_block="next:\n  recommended_action: begin classify-feature phase\n"
            "  blocked: false\n  blocker: null\n",
        )
        ok, _ = evaluate_gate(ONE_VALID, GateContext(root=self.tmp))
        self.assertTrue(ok)

    def test_passes_with_documented_stop_reason(self):
        # No action, but blocked with a real blocker string.
        write_state(
            self.tmp,
            next_block="next:\n  recommended_action: ''\n  blocked: true\n"
            "  blocker: waiting on human approval for prod deploy\n",
        )
        ok, _ = evaluate_gate(ONE_VALID, GateContext(root=self.tmp))
        self.assertTrue(ok)

    def test_fails_when_blocked_but_no_blocker(self):
        # blocked is true but blocker is empty -> not an honest stop reason.
        write_state(
            self.tmp,
            next_block="next:\n  recommended_action: ''\n  blocked: true\n  blocker: ''\n",
        )
        ok, _ = evaluate_gate(ONE_VALID, GateContext(root=self.tmp))
        self.assertFalse(ok)


class TestWorkCompletedWithinScope(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="harness-gates-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_passes_when_no_implementation(self):
        # Vacuously true: nothing was implemented, nothing to complete.
        write_state(
            self.tmp,
            next_block="next:\n  recommended_action: ''\n  blocked: false\n  blocker: null\n",
        )
        write_mission_index(self.tmp, "MISSION-001", "in-progress")
        ctx = GateContext(root=self.tmp, mission_id="MISSION-001", implementation_occurred=False)
        ok, _ = evaluate_gate(WORK_DONE, ctx)
        self.assertTrue(ok)

    def test_fails_when_implementation_but_no_closure(self):
        # Implementation occurred, mission still in-progress, no stop reason,
        # no session note -> not honestly completed.
        write_state(
            self.tmp,
            next_block="next:\n  recommended_action: ''\n  blocked: false\n  blocker: null\n",
            current_mission="MISSION-001",
        )
        write_mission_index(self.tmp, "MISSION-001", "in-progress")
        ctx = GateContext(root=self.tmp, mission_id="MISSION-001", implementation_occurred=True)
        ok, _ = evaluate_gate(WORK_DONE, ctx)
        self.assertFalse(ok)

    def test_passes_when_mission_marked_complete(self):
        write_state(
            self.tmp,
            next_block="next:\n  recommended_action: ''\n  blocked: false\n  blocker: null\n",
            current_mission="MISSION-001",
        )
        write_mission_index(self.tmp, "MISSION-001", "complete")
        ctx = GateContext(root=self.tmp, mission_id="MISSION-001", implementation_occurred=True)
        ok, _ = evaluate_gate(WORK_DONE, ctx)
        self.assertTrue(ok)

    def test_passes_when_mission_marked_review(self):
        write_state(
            self.tmp,
            next_block="next:\n  recommended_action: ''\n  blocked: false\n  blocker: null\n",
            current_mission="MISSION-001",
        )
        write_mission_index(self.tmp, "MISSION-001", "review")
        ctx = GateContext(root=self.tmp, mission_id="MISSION-001", implementation_occurred=True)
        ok, _ = evaluate_gate(WORK_DONE, ctx)
        self.assertTrue(ok)

    def test_passes_with_documented_stop_reason(self):
        write_state(
            self.tmp,
            next_block="next:\n  recommended_action: ''\n  blocked: true\n"
            "  blocker: blocked on upstream API outage\n",
            current_mission="MISSION-001",
        )
        write_mission_index(self.tmp, "MISSION-001", "in-progress")
        ctx = GateContext(root=self.tmp, mission_id="MISSION-001", implementation_occurred=True)
        ok, _ = evaluate_gate(WORK_DONE, ctx)
        self.assertTrue(ok)

    def test_passes_with_session_note(self):
        write_state(
            self.tmp,
            next_block="next:\n  recommended_action: ''\n  blocked: false\n  blocker: null\n",
            current_mission="MISSION-001",
        )
        write_mission_index(self.tmp, "MISSION-001", "in-progress")
        notes = self.tmp / "runs/session-notes"
        notes.mkdir(parents=True)
        (notes / "2026-05-30-MISSION-001.md").write_text("# session note\nwork wrapped up\n")
        ctx = GateContext(root=self.tmp, mission_id="MISSION-001", implementation_occurred=True)
        ok, _ = evaluate_gate(WORK_DONE, ctx)
        self.assertTrue(ok)


class TestPlanApprovalGate(unittest.TestCase):
    GATE = "human_approval_for_plan"

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="harness-plan-gate-"))
        (self.tmp / ".harness").mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_index(self, body: str):
        (self.tmp / ".harness/plan-index.yml").write_text(body)

    def test_fails_when_no_index(self):
        ok, _ = evaluate_gate(self.GATE, GateContext(root=self.tmp))
        self.assertFalse(ok)

    def test_fails_when_only_in_review(self):
        self._write_index("plans:\n  PRD-x:\n    status: in-review\n")
        ok, _ = evaluate_gate(self.GATE, GateContext(root=self.tmp))
        self.assertFalse(ok)

    def test_passes_when_a_plan_is_approved(self):
        self._write_index(
            "plans:\n  PRD-x:\n    status: in-review\n  PRD-y:\n    status: approved\n"
        )
        ok, _ = evaluate_gate(self.GATE, GateContext(root=self.tmp))
        self.assertTrue(ok)


class TestValidationVerdictGate(unittest.TestCase):
    """validation_recorded must check the report's VERDICT, not mere existence."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="harness-validate-"))
        (self.tmp / "runs/test-reports").mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _report(self, body: str):
        (self.tmp / "runs/test-reports/MISSION-001.md").write_text(body, encoding="utf-8")

    def _ctx(self):
        return GateContext(root=self.tmp, mission_id="MISSION-001", implementation_occurred=True)

    def test_skip_is_vacuously_true_without_implementation(self):
        ctx = GateContext(root=self.tmp, mission_id="MISSION-001", implementation_occurred=False)
        ok, _ = evaluate_gate(VALIDATION, ctx)
        self.assertTrue(ok)

    def test_passes_on_all_exit_zero(self):
        self._report("# Validation Report: MISSION-001\n\n## `npm test`\n\n**Status:** ✓ pass (exit 0)\n")
        ok, msg = evaluate_gate(VALIDATION, self._ctx())
        self.assertTrue(ok, msg)

    def test_fails_on_nonzero_exit(self):
        self._report("## `npm test`\n\n**Status:** ✗ fail (exit 1)\n")
        ok, _ = evaluate_gate(VALIDATION, self._ctx())
        self.assertFalse(ok)

    def test_fails_on_timeout(self):
        self._report("## `npm test`\n\n**TIMEOUT after 600s**\n")
        ok, _ = evaluate_gate(VALIDATION, self._ctx())
        self.assertFalse(ok)

    def test_fails_on_unparseable_report(self):
        # Report exists but has no recognizable verdict line -> fail closed.
        self._report("# Validation Report\n\nsome freeform notes, no status lines\n")
        ok, _ = evaluate_gate(VALIDATION, self._ctx())
        self.assertFalse(ok)

    def test_fails_when_no_report_present(self):
        ok, _ = evaluate_gate(VALIDATION, self._ctx())
        self.assertFalse(ok)


class TestReviewVerdictGate(unittest.TestCase):
    """review_recorded must check the `## Mergeable?` verdict, not mere existence."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="harness-review-"))
        (self.tmp / "runs/reviews").mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _review(self, body: str):
        (self.tmp / "runs/reviews/MISSION-001-review.md").write_text(body, encoding="utf-8")

    def _ctx(self):
        return GateContext(root=self.tmp, mission_id="MISSION-001", implementation_occurred=True)

    def test_passes_on_mergeable_yes(self):
        self._review("# Review Report\n\n## Mergeable?\n\nYes\n\n## Blocking Issues\n\n-\n")
        ok, msg = evaluate_gate(REVIEW, self._ctx())
        self.assertTrue(ok, msg)

    def test_fails_on_mergeable_no(self):
        self._review("# Review Report\n\n## Mergeable?\n\nNo\n\n## Blocking Issues\n\n- broken\n")
        ok, _ = evaluate_gate(REVIEW, self._ctx())
        self.assertFalse(ok)

    def test_fails_when_no_mergeable_section(self):
        self._review("# Review Report\n\nfreeform, no verdict\n")
        ok, _ = evaluate_gate(REVIEW, self._ctx())
        self.assertFalse(ok)

    def test_skip_is_vacuously_true_without_implementation(self):
        ctx = GateContext(root=self.tmp, mission_id="MISSION-001", implementation_occurred=False)
        ok, _ = evaluate_gate(REVIEW, ctx)
        self.assertTrue(ok)


class TestScopeAdherenceGate(unittest.TestCase):
    """scope_adherence diffs git-touched files vs the mission's Allowed/Forbidden."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="harness-scope-"))
        # A real throwaway git repo so `git status --porcelain` has something to say.
        subprocess.run(["git", "init", "-q"], cwd=self.tmp, check=True)
        subprocess.run(["git", "config", "user.email", "t@t.t"], cwd=self.tmp, check=True)
        subprocess.run(["git", "config", "user.name", "t"], cwd=self.tmp, check=True)
        (self.tmp / ".harness").mkdir()
        (self.tmp / "runs/missions").mkdir(parents=True)
        # Mission scope: only src/auth/** allowed; migrations/** forbidden.
        (self.tmp / "runs/missions/MISSION-001-auth.md").write_text(
            "# MISSION-001\n\n## Allowed Files\n\n- src/auth/**\n\n"
            "## Forbidden Files\n\n- migrations/**\n"
        )
        (self.tmp / ".harness/mission-index.yml").write_text(
            "missions:\n  MISSION-001:\n    status: in-progress\n"
            "    file: runs/missions/MISSION-001-auth.md\n"
        )
        # Commit the scaffolding so it is NOT reported as touched — only files
        # changed AFTER this baseline count as the mission's work.
        subprocess.run(["git", "add", "-A"], cwd=self.tmp, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "baseline"], cwd=self.tmp, check=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _touch(self, rel: str):
        p = self.tmp / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("x\n")

    def _ctx(self):
        return GateContext(root=self.tmp, mission_id="MISSION-001", implementation_occurred=True)

    def test_vacuously_true_without_implementation(self):
        ctx = GateContext(root=self.tmp, mission_id="MISSION-001", implementation_occurred=False)
        ok, _ = evaluate_gate(SCOPE, ctx)
        self.assertTrue(ok)

    def test_passes_when_touched_within_allowed(self):
        self._touch("src/auth/login.py")
        ok, msg = evaluate_gate(SCOPE, self._ctx())
        self.assertTrue(ok, msg)

    def test_fails_on_forbidden_hit(self):
        self._touch("src/auth/login.py")
        self._touch("migrations/001.sql")
        ok, _ = evaluate_gate(SCOPE, self._ctx())
        self.assertFalse(ok)

    def test_fails_on_out_of_allowed(self):
        self._touch("src/billing/charge.py")  # not under src/auth/**
        ok, _ = evaluate_gate(SCOPE, self._ctx())
        self.assertFalse(ok)

    def test_passes_when_nothing_touched(self):
        # No working-tree changes -> nothing to police.
        ok, _ = evaluate_gate(SCOPE, self._ctx())
        self.assertTrue(ok)

    def test_fails_open_when_git_cannot_enumerate(self):
        """DOCUMENTED LIMITATION (council move #5): scope_adherence is best-effort,
        NOT a sandbox. When git can't enumerate touched files (subprocess error /
        not a repo), _git_touched_files returns [] and the gate PASSES even though
        an out-of-scope file exists on disk. This asserts that fail-OPEN behavior
        so the degradation is explicit and tested, not an unproven claim."""
        # An out-of-allowed file is present, but git enumeration is forced to fail.
        self._touch("src/billing/charge.py")  # not under src/auth/**
        with mock.patch(
            "harness_core.gates.subprocess.run",
            side_effect=OSError("git not found"),
        ):
            ok, _ = evaluate_gate(SCOPE, self._ctx())
        self.assertTrue(ok, "scope_adherence must fail OPEN when git is unavailable")

    def test_fails_open_in_a_non_git_directory(self):
        """Same fail-open, exercised end-to-end through real git (non-zero exit in a
        directory that is not a repo) rather than a mock."""
        import tempfile as _tempfile

        non_git = Path(_tempfile.mkdtemp(prefix="harness-scope-nogit-"))
        try:
            (non_git / ".harness").mkdir()
            (non_git / "runs/missions").mkdir(parents=True)
            (non_git / "runs/missions/MISSION-001-auth.md").write_text(
                "# M\n\n## Allowed Files\n\n- src/auth/**\n"
            )
            (non_git / ".harness/mission-index.yml").write_text(
                "missions:\n  MISSION-001:\n    status: in-progress\n"
                "    file: runs/missions/MISSION-001-auth.md\n"
            )
            out = non_git / "src/billing/charge.py"
            out.parent.mkdir(parents=True)
            out.write_text("x\n")
            ctx = GateContext(
                root=non_git, mission_id="MISSION-001", implementation_occurred=True
            )
            ok, _ = evaluate_gate(SCOPE, ctx)
            self.assertTrue(ok, "non-git dir -> git can't enumerate -> fail open")
        finally:
            shutil.rmtree(non_git, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
