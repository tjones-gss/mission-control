#!/usr/bin/env python3
"""
tests/test_loop_halt.py — Phase 2: gates HALT the pipeline (ADR-0006).

When strict gates are on (and it isn't a dry run), a failing gate must STOP the
loop: dependent later phases must not run on an unmet gate. Previously the loop
ran every phase and only reported failures at the end. This test drives
run_next_mission_loop with stubbed drivers and a gate that fails on the second
of three phases, and asserts the third phase never executes and the loop returns
the strict-failure exit code 3.

Run:
    python3 -m unittest tests.test_loop_halt
"""

import sys
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "sdk" / "python"))

from harness_orchestrator import loop as loop_mod  # noqa: E402
from harness_orchestrator.cursor_driver import DriverConfig  # noqa: E402

PHASES = [
    {"id": "p1", "agent": "orchestrator", "gate": {"required": ["g_ok"]}},
    {"id": "p2", "agent": "orchestrator", "gate": {"required": ["g_FAIL"]}},
    {"id": "p3", "agent": "orchestrator", "gate": {"required": ["g_ok"]}},
]


def _fake_gates(required, ctx):
    # Fail any gate whose name contains FAIL; otherwise pass.
    bad = [g for g in required if "FAIL" in g]
    return (len(bad) == 0, [f"gate not satisfied: {g}" for g in bad])


class _Result:
    run_id = "run-test"


class TestLoopHalt(unittest.TestCase):
    def _run(self, *, dry_run: bool):
        executed: list[str] = []

        def _record_prompt(root, agent_name, phase, **kwargs):
            executed.append(phase.get("id"))
            return "prompt"

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
            m["build_phase_prompt"].side_effect = _record_prompt
            m["run_prompt"].return_value = _Result()
            m["config_from_env"].side_effect = lambda **kw: DriverConfig(dry_run=dry_run)
            m["update_sdk_state"].return_value = None
            m["set_pipeline_phase"].return_value = None
            m["harness_cli"].return_value = (0, "")
            m["evaluate_gates"].side_effect = _fake_gates
            m["load_yaml"].return_value = {}

            config = DriverConfig(dry_run=dry_run, strict_gates=True, api_key="x")
            code = loop_mod.run_next_mission_loop(Path("/tmp/whatever"), config)
        return code, executed

    def test_strict_gate_failure_halts_before_later_phases(self):
        code, executed = self._run(dry_run=False)
        self.assertEqual(executed, ["p1", "p2"], "p3 must NOT run after the p2 HALT")
        self.assertNotIn("p3", executed)
        self.assertEqual(code, 3, "strict gate failure must return exit code 3")

    def test_dry_run_does_not_halt(self):
        # enforce_strict is false in dry-run, so the loop runs every phase and
        # returns 0 (today's non-halting behavior is preserved for dry runs).
        code, executed = self._run(dry_run=True)
        self.assertEqual(executed, ["p1", "p2", "p3"])
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
