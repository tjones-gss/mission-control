#!/usr/bin/env python3
"""
tests/test_cost_ledger.py — Phase 2: per-run cost ledger with a hard ceiling.

The harness loop tracks per-phase cost in a run-wide ledger and HARD-ABORTS
(exit code 4, distinct from the gate-HALT 3) when the ceiling is reached or when
entering the next phase would obviously blow it. With no ceiling configured the
ledger is inert and the run is unbounded — today's behavior.

Run:
    python3 -m unittest tests.test_cost_ledger
"""

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "sdk" / "python"))

from harness_core import cost  # noqa: E402
from harness_core.cost import (  # noqa: E402
    RunLedger,
    accrue,
    is_exceeded,
    load_ledger,
    new_ledger,
    per_phase_estimate,
    resolve_ceiling,
    save_ledger,
    would_exceed,
)
from harness_orchestrator import loop as loop_mod  # noqa: E402
from harness_orchestrator.cursor_driver import DriverConfig  # noqa: E402


class TestLedgerCore(unittest.TestCase):
    def test_accrue_sums_and_records_each_phase(self):
        led = RunLedger(run_id="r", ceiling_usd=None)
        accrue(led, "p1", 0.25)
        accrue(led, "p2", 0.5, source="fleet")
        self.assertAlmostEqual(led.spent_usd, 0.75)
        self.assertEqual(len(led.per_phase), 2)
        self.assertEqual(led.per_phase[1]["source"], "fleet")

    def test_negative_cost_is_clamped(self):
        led = RunLedger(run_id="r")
        accrue(led, "p", -3.0)
        self.assertEqual(led.spent_usd, 0.0)

    def test_is_exceeded_latches_at_ceiling(self):
        led = RunLedger(run_id="r", ceiling_usd=1.0, spent_usd=1.0)
        self.assertTrue(is_exceeded(led))
        self.assertFalse(is_exceeded(RunLedger(run_id="r", ceiling_usd=1.0, spent_usd=0.99)))

    def test_would_exceed_projection(self):
        led = RunLedger(run_id="r", ceiling_usd=1.0, spent_usd=0.6)
        self.assertTrue(would_exceed(led, 0.6))
        self.assertFalse(would_exceed(led, 0.3))

    def test_no_ceiling_never_exceeds(self):
        led = RunLedger(run_id="r", ceiling_usd=None, spent_usd=999.0)
        self.assertFalse(is_exceeded(led))
        self.assertFalse(would_exceed(led, 999.0))

    def test_save_and_load_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / ".harness").mkdir()
            led = RunLedger(run_id="r", ceiling_usd=2.0, spent_usd=1.5)
            accrue(led, "p1", 0.5)
            save_ledger(root, led)
            loaded = load_ledger(root)
            self.assertEqual(loaded.run_id, "r")
            self.assertEqual(loaded.ceiling_usd, 2.0)
            self.assertAlmostEqual(loaded.spent_usd, 2.0)


class TestCeilingResolution(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / ".harness").mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_absent_policy_is_unbounded(self):
        self.assertIsNone(resolve_ceiling(self.tmp))
        self.assertEqual(per_phase_estimate(self.tmp), 0.0)

    def test_reads_policy_file(self):
        (self.tmp / ".harness/cost-policy.yml").write_text(
            "run_ceiling_usd: 5.5\nper_phase_usd: 0.7\n"
        )
        self.assertEqual(resolve_ceiling(self.tmp), 5.5)
        self.assertEqual(per_phase_estimate(self.tmp), 0.7)

    def test_env_overrides_policy_ceiling(self):
        (self.tmp / ".harness/cost-policy.yml").write_text("run_ceiling_usd: 5.5\n")
        with mock.patch.dict(os.environ, {"HARNESS_RUN_CEILING_USD": "2.0"}):
            self.assertEqual(resolve_ceiling(self.tmp), 2.0)

    def test_invalid_policy_ceiling_warns_not_silent(self):
        # A typo'd ceiling must NOT silently read as unbounded — it WARNs, then
        # degrades to None (no silent-failure trap).
        (self.tmp / ".harness/cost-policy.yml").write_text("run_ceiling_usd: ten-bucks\n")
        with self.assertLogs("harness_core.cost", level="WARNING") as cm:
            self.assertIsNone(resolve_ceiling(self.tmp))
        self.assertTrue(any("run_ceiling_usd" in line for line in cm.output))

    def test_invalid_env_ceiling_warns_not_silent(self):
        (self.tmp / ".harness/cost-policy.yml").write_text("")
        with mock.patch.dict(os.environ, {"HARNESS_RUN_CEILING_USD": "lots"}):
            with self.assertLogs("harness_core.cost", level="WARNING") as cm:
                self.assertIsNone(resolve_ceiling(self.tmp))
        self.assertTrue(any("HARNESS_RUN_CEILING_USD" in line for line in cm.output))

    def test_invalid_per_phase_estimate_warns_not_silent(self):
        (self.tmp / ".harness/cost-policy.yml").write_text("per_phase_usd: free\n")
        with self.assertLogs("harness_core.cost", level="WARNING") as cm:
            self.assertEqual(per_phase_estimate(self.tmp), 0.0)
        self.assertTrue(any("per_phase_usd" in line for line in cm.output))


PHASES = [
    {"id": "p1", "agent": "orchestrator", "gate": {"required": []}},
    {"id": "p2", "agent": "orchestrator", "gate": {"required": []}},
    {"id": "p3", "agent": "orchestrator", "gate": {"required": []}},
]


class _Result:
    run_id = "run-test"


class TestLoopCostAbort(unittest.TestCase):
    def _run(self, *, cost_policy: str | None):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / ".harness").mkdir()
        if cost_policy is not None:
            (self.tmp / ".harness/cost-policy.yml").write_text(cost_policy)
        executed: list[str] = []

        def _record(root, agent_name, phase, **kwargs):
            executed.append(phase.get("id"))
            return "prompt"

        try:
            with mock.patch.multiple(
                loop_mod,
                preflight=mock.DEFAULT,
                harness_json=mock.DEFAULT,
                load_pipeline=mock.DEFAULT,
                pipeline_phases=mock.DEFAULT,
                resolve_model=mock.DEFAULT,
                resolve_mission_for_loop=mock.DEFAULT,
                build_phase_prompt=mock.DEFAULT,
                run_prompt=mock.DEFAULT,
                config_from_env=mock.DEFAULT,
                update_sdk_state=mock.DEFAULT,
                set_pipeline_phase=mock.DEFAULT,
                harness_cli=mock.DEFAULT,
                evaluate_gates=mock.DEFAULT,
                load_yaml=mock.DEFAULT,
            ) as m:
                m["preflight"].return_value = None
                m["harness_json"].return_value = {}
                m["load_pipeline"].return_value = {"phases": PHASES}
                m["pipeline_phases"].return_value = [dict(p) for p in PHASES]
                m["resolve_model"].return_value = None
                m["resolve_mission_for_loop"].return_value = (None, None)
                m["build_phase_prompt"].side_effect = _record
                m["run_prompt"].return_value = _Result()
                m["config_from_env"].side_effect = lambda **kw: DriverConfig(dry_run=False)
                m["update_sdk_state"].return_value = None
                m["set_pipeline_phase"].return_value = None
                m["harness_cli"].return_value = (0, "")
                m["evaluate_gates"].side_effect = lambda req, ctx: (True, [])
                m["load_yaml"].return_value = {}

                config = DriverConfig(dry_run=False, strict_gates=True, api_key="x")
                code = loop_mod.run_next_mission_loop(self.tmp, config)
            return code, executed, load_ledger(self.tmp)
        finally:
            shutil.rmtree(self.tmp, ignore_errors=True)

    def test_aborts_before_phase_that_would_exceed_ceiling(self):
        # ceiling 1.0, each phase costs 0.6: p1 runs (spend 0.6), entering p2
        # would project 1.2 > 1.0 -> abort before p2. Exit 4.
        code, executed, ledger = self._run(
            cost_policy="run_ceiling_usd: 1.0\nper_phase_usd: 0.6\n"
        )
        self.assertEqual(executed, ["p1"], "p2/p3 must not run after the cost abort")
        self.assertEqual(code, 4, "cost ceiling abort must return exit code 4")

    def test_no_ceiling_runs_all_phases(self):
        code, executed, ledger = self._run(cost_policy=None)
        self.assertEqual(executed, ["p1", "p2", "p3"])
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
