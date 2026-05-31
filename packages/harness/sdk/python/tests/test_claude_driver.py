import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "harness_core"))
sys.path.insert(0, str(ROOT / "sdk/python"))

from harness_orchestrator import claude_driver, cursor_driver, drivers
from harness_orchestrator.cursor_driver import DriverConfig, MockAgent


class TestParseOutput(unittest.TestCase):
    def test_parses_json_envelope(self):
        sid, text = claude_driver._parse_output(
            '{"type":"result","result":"done","session_id":"abc-123"}'
        )
        self.assertEqual(sid, "abc-123")
        self.assertEqual(text, "done")

    def test_falls_back_to_raw_text(self):
        sid, text = claude_driver._parse_output("not json")
        self.assertIsNone(sid)
        self.assertEqual(text, "not json")

    def test_warns_loudly_when_output_is_not_json(self):
        with self.assertLogs("harness_orchestrator.claude_driver", level="ERROR") as cm:
            sid, text = claude_driver._parse_output("<html>gateway error</html>")
        self.assertIsNone(sid)
        self.assertEqual(text, "<html>gateway error</html>")
        self.assertTrue(any("session continuity disabled" in m for m in cm.output))

    def test_warns_when_session_id_missing(self):
        with self.assertLogs("harness_orchestrator.claude_driver", level="WARNING") as cm:
            sid, text = claude_driver._parse_output('{"result":"done"}')
        self.assertIsNone(sid)
        self.assertEqual(text, "done")
        self.assertTrue(any("session_id" in m for m in cm.output))


class TestRunClaudeCommand(unittest.TestCase):
    @patch("harness_orchestrator.claude_driver.shutil.which", return_value="/usr/bin/claude")
    @patch("harness_orchestrator.claude_driver.subprocess.run")
    def test_builds_command_with_model_and_resume(self, mock_run, _which):
        mock_run.return_value = MagicMock(
            returncode=0, stdout='{"result":"ok","session_id":"s1"}', stderr=""
        )
        cfg = DriverConfig(runtime="claude", model="opus", cwd=".")
        result = claude_driver._run_claude(cfg, "hello", session_id="prev")
        cmd = mock_run.call_args[0][0]
        self.assertEqual(cmd[:3], ["/usr/bin/claude", "-p", "hello"])
        self.assertIn("--model", cmd)
        self.assertEqual(cmd[cmd.index("--model") + 1], "opus")
        self.assertIn("--resume", cmd)
        self.assertEqual(cmd[cmd.index("--resume") + 1], "prev")
        self.assertEqual(result.text, "ok")
        self.assertEqual(result.agent_id, "s1")

    @patch("harness_orchestrator.claude_driver.shutil.which", return_value=None)
    def test_missing_cli_raises(self, _which):
        cfg = DriverConfig(runtime="claude", model="sonnet")
        with self.assertRaises(RuntimeError):
            claude_driver._run_claude(cfg, "hello")

    @patch("harness_orchestrator.claude_driver.shutil.which", return_value="/usr/bin/claude")
    @patch("harness_orchestrator.claude_driver.subprocess.run")
    def test_nonzero_exit_raises(self, mock_run, _which):
        mock_run.return_value = MagicMock(returncode=2, stdout="", stderr="boom")
        with self.assertRaises(RuntimeError):
            claude_driver._run_claude(DriverConfig(runtime="claude"), "hi")


class TestPersistentSessionResumes(unittest.TestCase):
    @patch("harness_orchestrator.claude_driver.shutil.which", return_value="/usr/bin/claude")
    @patch("harness_orchestrator.claude_driver.subprocess.run")
    def test_second_send_resumes_captured_session(self, mock_run, _which):
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout='{"result":"a","session_id":"sess-9"}', stderr=""),
            MagicMock(returncode=0, stdout='{"result":"b","session_id":"sess-9"}', stderr=""),
        ]
        agent = claude_driver.ClaudeAgent(DriverConfig(runtime="claude", model="sonnet"))
        agent.send("first").wait()
        self.assertEqual(agent.agent_id, "sess-9")
        agent.send("second").wait()
        second_cmd = mock_run.call_args_list[1][0][0]
        self.assertIn("--resume", second_cmd)
        self.assertEqual(second_cmd[second_cmd.index("--resume") + 1], "sess-9")


class TestDryRunUsesMock(unittest.TestCase):
    def test_create_agent_and_run_prompt_are_mock_under_dry_run(self):
        cfg = DriverConfig(runtime="claude", dry_run=True)
        self.assertIsInstance(claude_driver.create_agent(cfg), MockAgent)
        self.assertEqual(claude_driver.run_prompt(cfg, "x").status, "finished")


class TestDriverSelector(unittest.TestCase):
    def test_selects_claude_for_claude_runtime(self):
        self.assertIs(drivers._driver(DriverConfig(runtime="claude")), claude_driver)

    def test_selects_cursor_for_local_and_cloud(self):
        self.assertIs(drivers._driver(DriverConfig(runtime="local")), cursor_driver)
        self.assertIs(drivers._driver(DriverConfig(runtime="cloud")), cursor_driver)

    def test_send_and_wait_routes_claude_agent(self):
        cfg = DriverConfig(runtime="claude", dry_run=True)
        # Dry-run create returns a MockAgent -> routed through the cursor path.
        mock_agent = claude_driver.create_agent(cfg)
        self.assertEqual(drivers.send_and_wait(mock_agent, "x").status, "finished")


if __name__ == "__main__":
    unittest.main(verbosity=2)
