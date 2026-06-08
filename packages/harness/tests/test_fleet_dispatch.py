#!/usr/bin/env python3
"""
tests/test_fleet_dispatch.py — Phase 2: Fleet as a pipeline phase strategy.

A `strategy: fleet` phase makes the Python spine call OUT to the cockpit's
/api/fleet, poll the run to a terminal status, accrue the real spentUsd, and
write the mission outcome back via the harness CLI single-writer. If the cockpit
is unreachable the phase fails CLOSED — never a silent fall-back to single-agent.

The HTTP boundary is stubbed (no real cockpit); the loop's collaborators are
stubbed as in test_loop_halt.

Run:
    python3 -m unittest tests.test_fleet_dispatch
"""

import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "sdk" / "python"))

from harness_orchestrator import fleet_dispatch as fd  # noqa: E402
from harness_orchestrator import loop as loop_mod  # noqa: E402
from harness_orchestrator.cursor_driver import DriverConfig  # noqa: E402
from harness_orchestrator.fleet_dispatch import (  # noqa: E402
    FleetDispatchError,
    build_request,
    run_fleet_phase,
)


class TestBuildRequest(unittest.TestCase):
    def test_defaults_single_child_and_opt_in_verify(self):
        body = build_request(Path("/repo"), {"id": "p", "goal": "do it"})
        self.assertEqual(body["goal"], "do it")
        self.assertEqual(len(body["children"]), 1)
        self.assertEqual(body["children"][0]["cwd"], str(Path("/repo")))
        self.assertEqual(body["children"][0]["prompt"], "do it")
        # Locked decision: verify opt-in defaults to 1 verifier / 1 round.
        self.assertEqual(body["policy"]["verify"], {"minApprovals": 1, "maxRounds": 1})

    def test_budget_remaining_sets_budget(self):
        body = build_request(Path("/repo"), {"id": "p", "goal": "g"}, budget_remaining=4.0)
        self.assertEqual(body["policy"]["budgetUsd"], 4.0)

    def test_explicit_fleet_children_preserved_with_cwd_default(self):
        phase = {"id": "p", "goal": "g", "fleet": {"children": [{"prompt": "a"}, {"prompt": "b"}]}}
        body = build_request(Path("/repo"), phase)
        self.assertEqual(len(body["children"]), 2)
        self.assertTrue(all(c["cwd"] == str(Path("/repo")) for c in body["children"]))


class TestRunFleetPhase(unittest.TestCase):
    def test_polls_until_terminal_and_returns_state(self):
        # POST returns an id; GET returns running, running, then succeeded.
        states = [
            {"status": "running"},
            {"status": "running"},
            {"status": "succeeded", "spentUsd": 1.25},
        ]
        with mock.patch.object(fd, "_post_json", return_value={"id": "run-1"}), \
             mock.patch.object(fd, "_get_json", side_effect=states):
            state = run_fleet_phase(
                Path("/repo"), {"id": "p", "goal": "g"}, poll_interval=0, sleep=lambda s: None
            )
        self.assertEqual(state["status"], "succeeded")
        self.assertEqual(state["spentUsd"], 1.25)

    def test_unreachable_cockpit_fails_closed(self):
        import urllib.error

        with mock.patch.object(fd, "_post_json", side_effect=urllib.error.URLError("refused")):
            with self.assertRaises(FleetDispatchError):
                run_fleet_phase(Path("/repo"), {"id": "p", "goal": "g"})

    def test_missing_run_id_fails_closed(self):
        with mock.patch.object(fd, "_post_json", return_value={}):
            with self.assertRaises(FleetDispatchError):
                run_fleet_phase(Path("/repo"), {"id": "p", "goal": "g"})

    def test_timeout_without_settling_fails_closed(self):
        with mock.patch.object(fd, "_post_json", return_value={"id": "r"}), \
             mock.patch.object(fd, "_get_json", return_value={"status": "running"}):
            with self.assertRaises(FleetDispatchError):
                run_fleet_phase(
                    Path("/repo"),
                    {"id": "p", "goal": "g"},
                    poll_interval=1,
                    timeout=2,
                    sleep=lambda s: None,
                )


FLEET_PHASES = [
    {"id": "fanout", "agent": "fleet", "strategy": "fleet", "goal": "g", "gate": {"required": []}},
]


class _Result:
    run_id = "r"


class TestLoopFleetStrategy(unittest.TestCase):
    def _run(self, *, fleet_behavior):
        calls = {"mission_status": []}

        def _harness_cli(root, *args):
            if args[:2] == ("mission", "status"):
                calls["mission_status"].append(args)
            return (0, "")

        with mock.patch.multiple(
            loop_mod,
            preflight=mock.DEFAULT,
            harness_json=mock.DEFAULT,
            load_pipeline=mock.DEFAULT,
            pipeline_phases=mock.DEFAULT,
            resolve_model=mock.DEFAULT,
            resolve_mission_for_loop=mock.DEFAULT,
            build_phase_prompt=mock.DEFAULT,
            run_fleet_phase=mock.DEFAULT,
            update_sdk_state=mock.DEFAULT,
            set_pipeline_phase=mock.DEFAULT,
            harness_cli=mock.DEFAULT,
            evaluate_gates=mock.DEFAULT,
            load_yaml=mock.DEFAULT,
        ) as m:
            m["preflight"].return_value = None
            m["harness_json"].return_value = {}
            m["load_pipeline"].return_value = {"phases": FLEET_PHASES}
            m["pipeline_phases"].return_value = [dict(p) for p in FLEET_PHASES]
            m["resolve_model"].return_value = None
            m["resolve_mission_for_loop"].return_value = ("MISSION-001", None)
            m["build_phase_prompt"].return_value = "prompt"
            m["run_fleet_phase"].side_effect = fleet_behavior
            m["update_sdk_state"].return_value = None
            m["set_pipeline_phase"].return_value = None
            m["harness_cli"].side_effect = _harness_cli
            m["evaluate_gates"].side_effect = lambda req, ctx: (True, [])
            m["load_yaml"].return_value = {}

            config = DriverConfig(dry_run=False, strict_gates=True, api_key="x")
            code = loop_mod.run_next_mission_loop(Path("/tmp/x"), config)
        return code, calls

    def test_success_writes_review_outcome(self):
        code, calls = self._run(
            fleet_behavior=lambda root, phase, **kw: {"status": "succeeded", "spentUsd": 0.5}
        )
        self.assertEqual(code, 0)
        self.assertEqual(calls["mission_status"], [("mission", "status", "MISSION-001", "review")])

    def test_failed_run_writes_failed_outcome(self):
        code, calls = self._run(
            fleet_behavior=lambda root, phase, **kw: {"status": "failed", "spentUsd": 0.2}
        )
        self.assertEqual(calls["mission_status"], [("mission", "status", "MISSION-001", "failed")])

    def test_unreachable_cockpit_halts_closed(self):
        def _boom(root, phase, **kw):
            raise FleetDispatchError("cockpit down")

        code, calls = self._run(fleet_behavior=_boom)
        # Fail closed: strict run HALTs with exit 3, no outcome write-back.
        self.assertEqual(code, 3)
        self.assertEqual(calls["mission_status"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
