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

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from harness_core.gates import GateContext, evaluate_gate  # noqa: E402

ONE_VALID = "one_valid_next_action_chosen_or_stop_reason_documented"
WORK_DONE = "work_completed_within_scope_or_stop_reason_documented"


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
