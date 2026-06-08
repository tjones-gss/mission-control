#!/usr/bin/env python3
"""
tests/test_loop_e2e.py — Phase 2 END-TO-END loop integration.

The council's sharpest fair critique: every other loop test mocks the very things
it claims to prove (evaluate_gates, the cost ledger, run_fleet_phase are all
stubbed), so a green "p1 -> p2 -> HALT" proves wiring intent, not that gates halt
or the ceiling aborts IN PRACTICE.

This test closes that gap. It drives the REAL run_next_mission_loop against a REAL
temp .harness tree and lets the things under test run for real:
  - real evaluate_gates (gates.py reads the real state/report files)
  - real set_pipeline_phase (writes the real pipeline-state.yml)
  - real load_pipeline / pipeline_phases (reads a real pipeline YAML)
  - real cost ledger (cost.py reads the real cost-policy.yml, writes run-ledger.yml)

Only the LLM EDGES are mocked (there is no API/subprocess in CI): agent creation
and prompt execution, preflight, the status/next JSON reads, prompt building, the
validate/handoff CLI shellouts, and SDK-state writes. Nothing in the gate / cost /
halt path is stubbed.

Run:
    python3 -m unittest tests.test_loop_e2e
"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "sdk" / "python"))

from harness_core.yaml_utils import load_yaml  # noqa: E402
from harness_orchestrator import loop as loop_mod  # noqa: E402
from harness_orchestrator.cursor_driver import DriverConfig  # noqa: E402


class _FakeResult:
    run_id = "run-e2e"


def _scaffold(root: Path, *, pipeline_yaml: str, cost_policy: str | None = None):
    h = root / ".harness"
    h.mkdir(parents=True)
    # State files the real gates / loader / final read touch.
    (h / "project-state.yml").write_text(
        "project:\n  name: e2e\n  mode: feature-development\n  stage: implementation\n"
        "current:\n  mission: MISSION-E2E\n"
        "next:\n  recommended_action: ''\n  blocked: false\n  blocker: null\n"
    )
    (h / "pipeline-state.yml").write_text("pipeline:\n  active: next-mission-loop\n")
    (h / "mission-index.yml").write_text(
        "missions:\n  MISSION-E2E:\n    status: in-progress\n"
        "    file: runs/missions/MISSION-E2E.md\n"
    )
    (root / "runs" / "missions").mkdir(parents=True)
    (root / "runs" / "missions" / "MISSION-E2E.md").write_text("# MISSION-E2E\n")
    (root / "pipelines").mkdir()
    (root / "pipelines" / "next-mission-loop.yml").write_text(pipeline_yaml)
    if cost_policy is not None:
        (h / "cost-policy.yml").write_text(cost_policy)


# Patch ONLY the LLM/I-O edges — never the gate/cost/halt logic under test.
_EDGE_PATCHES = dict(
    preflight=mock.DEFAULT,
    harness_json=mock.DEFAULT,
    build_phase_prompt=mock.DEFAULT,
    create_agent=mock.DEFAULT,
    run_prompt=mock.DEFAULT,
    send_and_wait=mock.DEFAULT,
    update_sdk_state=mock.DEFAULT,
    harness_cli=mock.DEFAULT,
    resolve_model=mock.DEFAULT,
)


class TestLoopEndToEnd(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="harness-loop-e2e-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _drive(self):
        reached: list[str] = []

        def _record_prompt(root, agent_name, phase, **kwargs):
            reached.append(phase.get("id"))
            return "prompt"

        with mock.patch.multiple(loop_mod, **_EDGE_PATCHES) as m:
            m["preflight"].return_value = None
            m["harness_json"].return_value = {}
            m["build_phase_prompt"].side_effect = _record_prompt
            m["create_agent"].return_value = mock.MagicMock(agent_id="impl-1")
            m["run_prompt"].return_value = _FakeResult()
            m["send_and_wait"].return_value = _FakeResult()
            m["update_sdk_state"].return_value = None
            # Real validate/handoff would shell out; no-op them but let the gate
            # itself decide based on the (absent) report file we control.
            m["harness_cli"].return_value = (0, "")
            m["resolve_model"].return_value = None

            config = DriverConfig(dry_run=False, strict_gates=True, api_key="x")
            code = loop_mod.run_next_mission_loop(self.tmp, config)
        return code, reached

    def test_real_gate_failure_halts_the_pipeline(self):
        # execute (implementer) makes implementation_occurred True; the validate
        # gate then runs the REAL validation_recorded gate, which fails because no
        # passing test-report exists -> real HALT before review.
        _scaffold(
            self.tmp,
            pipeline_yaml=(
                "pipeline: next-mission-loop\n"
                "description: e2e halt\n"
                "phases:\n"
                "  - id: execute\n    agent: implementer\n    gate:\n      required: []\n"
                "  - id: validate\n    agent: tester\n    gate:\n"
                "      required:\n        - validation_recorded_or_skip_documented\n"
                "  - id: review\n    agent: reviewer\n    gate:\n"
                "      required:\n        - review_recorded_or_skip_documented\n"
            ),
        )
        code, reached = self._drive()

        self.assertEqual(code, 3, "real unmet gate must HALT with exit 3")
        self.assertIn("execute", reached)
        self.assertIn("validate", reached)
        self.assertNotIn("review", reached, "review must NOT run after the HALT")
        # The real set_pipeline_phase recorded the halted phase on disk.
        state = load_yaml(self.tmp / ".harness/pipeline-state.yml")
        self.assertEqual(state["pipeline"]["phase"], "validate")

    def test_real_gate_pass_runs_all_phases(self):
        # All-empty gates -> the real gate evaluator passes every phase -> clean
        # run to completion, exit 0, every phase reached.
        _scaffold(
            self.tmp,
            pipeline_yaml=(
                "pipeline: next-mission-loop\n"
                "description: e2e clean\n"
                "phases:\n"
                "  - id: a\n    agent: orchestrator\n    gate:\n      required: []\n"
                "  - id: b\n    agent: orchestrator\n    gate:\n      required: []\n"
            ),
        )
        code, reached = self._drive()
        self.assertEqual(code, 0)
        self.assertEqual(reached, ["a", "b"])

    def test_real_cost_ceiling_aborts_the_pipeline(self):
        # ceiling 1.0, per-phase estimate 0.6: phase a accrues 0.6, entering b
        # projects 1.2 > 1.0 -> the REAL cost ledger aborts before b. Exit 4.
        _scaffold(
            self.tmp,
            pipeline_yaml=(
                "pipeline: next-mission-loop\n"
                "description: e2e cost\n"
                "phases:\n"
                "  - id: a\n    agent: orchestrator\n    gate:\n      required: []\n"
                "  - id: b\n    agent: orchestrator\n    gate:\n      required: []\n"
            ),
            cost_policy="run_ceiling_usd: 1.0\nper_phase_usd: 0.6\n",
        )
        code, reached = self._drive()

        self.assertEqual(code, 4, "real cost ceiling must abort with exit 4")
        self.assertEqual(reached, ["a"], "phase b must not be entered after the cost abort")
        # The real ledger persisted the accrued spend.
        ledger = load_yaml(self.tmp / ".harness/run-ledger.yml")
        self.assertAlmostEqual(ledger["spent_usd"], 0.6)
        self.assertEqual(ledger["ceiling_usd"], 1.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
