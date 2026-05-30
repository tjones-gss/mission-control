import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "harness_core"))
sys.path.insert(0, str(ROOT / "sdk/python"))

from harness_core.gates import GateContext, evaluate_gate
from harness_orchestrator.cursor_driver import DriverConfig, DriverResult
from harness_orchestrator.loop import run_next_mission_loop


class TestGates(unittest.TestCase):
    def test_state_read_gate(self):
        tmp = Path(self._get_temp_dir())
        (tmp / ".harness").mkdir()
        (tmp / ".harness/project-state.yml").write_text("project:\n  mode: test\n")
        (tmp / ".harness/pipeline-state.yml").write_text("pipeline:\n  active: x\n")
        (tmp / ".harness/mission-index.yml").write_text("missions: {}\n")
        ctx = GateContext(root=tmp)
        ok, _ = evaluate_gate("state_read_complete", ctx)
        self.assertTrue(ok)

    def _get_temp_dir(self):
        import tempfile

        return tempfile.mkdtemp()


class TestLoopDryRun(unittest.TestCase):
    @unittest.skipUnless((ROOT / ".harness").is_dir(), "harness root not found")
    def test_run_loop_dry_run(self):
        cfg = DriverConfig(api_key=None, cwd=str(ROOT), runtime="local", dry_run=True)
        code = run_next_mission_loop(ROOT, cfg)
        self.assertEqual(code, 0)

    @unittest.skipUnless((ROOT / ".harness").is_dir(), "harness root not found")
    @patch("harness_orchestrator.loop.evaluate_gates", return_value=(False, ["gate not satisfied: test_gate"]))
    def test_dry_run_gate_failure_still_exits_0(self, _mock_eval):
        cfg = DriverConfig(api_key=None, cwd=str(ROOT), runtime="local", dry_run=True, strict_gates=True)
        code = run_next_mission_loop(ROOT, cfg)
        self.assertEqual(code, 0)


class TestStrictGates(unittest.TestCase):
    _MOCK_RESULT = DriverResult(agent_id="test-agent", run_id="test-run", status="finished")

    @unittest.skipUnless((ROOT / ".harness").is_dir(), "harness root not found")
    @patch("harness_orchestrator.loop.evaluate_gates", return_value=(False, ["gate not satisfied: test_gate"]))
    @patch("harness_orchestrator.loop.harness_cli", return_value=(0, ""))
    @patch("harness_orchestrator.loop.send_and_wait", return_value=_MOCK_RESULT)
    @patch("harness_orchestrator.loop.create_agent")
    @patch("harness_orchestrator.loop.run_prompt", return_value=_MOCK_RESULT)
    @patch("harness_orchestrator.loop.preflight")
    def test_live_gate_failure_exits_3(
        self,
        _mock_preflight,
        _mock_run_prompt,
        mock_create_agent,
        _mock_send,
        _mock_cli,
        _mock_eval,
    ):
        mock_create_agent.return_value = MagicMock(agent_id="test-agent", close=MagicMock())
        cfg = DriverConfig(
            api_key="cursor_test_key",
            cwd=str(ROOT),
            runtime="local",
            dry_run=False,
            strict_gates=True,
        )
        code = run_next_mission_loop(ROOT, cfg)
        self.assertEqual(code, 3)

    @unittest.skipUnless((ROOT / ".harness").is_dir(), "harness root not found")
    @patch("harness_orchestrator.loop.evaluate_gates", return_value=(False, ["gate not satisfied: test_gate"]))
    @patch("harness_orchestrator.loop.harness_cli", return_value=(0, ""))
    @patch("harness_orchestrator.loop.send_and_wait", return_value=_MOCK_RESULT)
    @patch("harness_orchestrator.loop.create_agent")
    @patch("harness_orchestrator.loop.run_prompt", return_value=_MOCK_RESULT)
    @patch("harness_orchestrator.loop.preflight")
    def test_no_strict_gates_live_exits_0(
        self,
        _mock_preflight,
        _mock_run_prompt,
        mock_create_agent,
        _mock_send,
        _mock_cli,
        _mock_eval,
    ):
        mock_create_agent.return_value = MagicMock(agent_id="test-agent", close=MagicMock())
        cfg = DriverConfig(
            api_key="cursor_test_key",
            cwd=str(ROOT),
            runtime="local",
            dry_run=False,
            strict_gates=False,
        )
        code = run_next_mission_loop(ROOT, cfg)
        self.assertEqual(code, 0)


class TestLiveSdk(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("CURSOR_API_KEY"), "live SDK test requires CURSOR_API_KEY")
    @unittest.skipUnless((ROOT / ".harness").is_dir(), "harness root not found")
    def test_one_shot_agent_prompt(self):
        import subprocess

        result = subprocess.run(
            [sys.executable, str(ROOT / "sdk/python/examples/one_shot_status.py")],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=300,
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr or result.stdout)
        combined = result.stdout + result.stderr
        self.assertNotIn("CURSOR_API_KEY not set", combined)


if __name__ == "__main__":
    unittest.main()
