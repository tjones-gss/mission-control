#!/usr/bin/env python3
"""
tests/test_cli.py — Lightweight tests for the harness CLI.

Uses only stdlib (unittest, subprocess, tempfile, shutil) so it runs anywhere
PyYAML is installed.

Run:
    python3 tests/test_cli.py
or, from the repo root:
    python3 -m unittest tests.test_cli

Tests focus on behavior visible at the CLI surface:
  - `harness check` exits 0 on a healthy fixture
  - `harness check --strict` escalates warnings to a non-zero exit
  - `harness status` reads the active mission
  - `harness init <mode>` rejects unknown modes and writes the expected fields
  - Pipeline schema validation accepts `no_outputs_reason` / `no_gate_reason`
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLI = ROOT / "tools" / "harness"
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def run_cli(*args, cwd=None, env_extra=None):
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    # Use `-C` so the CLI walks up from a target path rather than the cwd.
    full = [sys.executable, str(CLI)] + list(args)
    return subprocess.run(
        full, capture_output=True, text=True, cwd=str(cwd or ROOT), env=env, timeout=30
    )


def make_minimal_project(tmpdir: Path):
    """Build the tiniest harness tree that satisfies the required-files list."""
    (tmpdir / ".harness").mkdir()
    (tmpdir / "pipelines").mkdir()
    (tmpdir / "runs/missions").mkdir(parents=True)
    (tmpdir / "agents/roles").mkdir(parents=True)
    (tmpdir / "AGENTS.md").write_text("# AGENTS\n")

    # Mandatory state files (kept terse).
    for name, body in {
        "project-state.yml": "project:\n  name: t\n  mode: unset\n  stage: intake\ncurrent:\n  mission: null\n",
        "pipeline-state.yml": "pipeline:\n  active: unset\n  phase: unset\n  gate: unset\n",
        "mission-index.yml": "missions: {}\n",
        "context-manifest.yml": "context_manifest:\n  principle: test\n",
        "quality-gates.yml": "quality_gates: {}\n",
        "danger-zone.yml": "dangerous_operations:\n  require_human_approval: [production_deploy]\nblocked_command_patterns:\n  - 'rm -rf'\n",
        "human-approval-policy.yml": "policy: {}\n",
        "anti-patterns.yml": "anti_patterns: []\n",
        "artifact-index.yml": "artifacts: {}\n",
        "mvp-checklist.yml": "checklist: []\n",
        "readiness-score.yml": "readiness:\n  overall:\n    score: 0\n    mvp_ready: false\n",
    }.items():
        (tmpdir / ".harness" / name).write_text(body)


class TestHarnessCheck(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="harness-test-"))
        make_minimal_project(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_check_on_minimal_project_passes_with_warnings(self):
        # Add a minimal valid pipeline so the pipelines section has something to validate.
        (self.tmpdir / "pipelines/feature-development.yml").write_text(textwrap.dedent("""
            pipeline: feature-development
            phases:
              - id: implementation
                agent: implementer
                outputs:
                  - <files>
                gate:
                  required:
                    - tests_pass
        """).strip() + "\n")
        (self.tmpdir / "agents/roles/implementer.md").write_text("# implementer\n")
        r = run_cli("-C", str(self.tmpdir), "check")
        # Should be 0 (healthy / degraded) — mode warning is expected on a fresh project.
        self.assertIn(r.returncode, (0,), f"check failed: rc={r.returncode}\n{r.stdout}\n{r.stderr}")

    def test_strict_escalates_warnings_to_failure(self):
        # No pipelines at all → triggers warnings.
        r = run_cli("-C", str(self.tmpdir), "check", "--strict")
        # With strict + warnings (e.g. project.mode unset), the CLI should exit non-zero.
        self.assertNotEqual(r.returncode, 0, "--strict did not escalate warnings to failure")

    def test_no_outputs_reason_is_accepted(self):
        """A phase that explicitly declares no_outputs_reason should NOT be flagged."""
        (self.tmpdir / "pipelines/test.yml").write_text(textwrap.dedent("""
            pipeline: test
            phases:
              - id: thinking
                agent: implementer
                no_outputs_reason: pure analysis phase
                no_gate_reason: continues to next phase directly
        """).strip() + "\n")
        (self.tmpdir / "agents/roles/implementer.md").write_text("# implementer\n")
        r = run_cli("-C", str(self.tmpdir), "check")
        # The pipeline must not be in the failure list.
        self.assertNotIn("test.yml: ", r.stdout.split("[FAIL]")[1] if "[FAIL]" in r.stdout else "",
                         f"no_outputs_reason was incorrectly flagged:\n{r.stdout}")

    def test_unresolved_agent_warns(self):
        (self.tmpdir / "pipelines/test.yml").write_text(textwrap.dedent("""
            pipeline: test
            phases:
              - id: x
                agent: this-agent-does-not-exist
                outputs: [foo]
                gate:
                  required: [bar]
        """).strip() + "\n")
        r = run_cli("-C", str(self.tmpdir), "check")
        self.assertIn("this-agent-does-not-exist", r.stdout)
        self.assertIn("unresolved", r.stdout.lower())

    def test_current_mission_must_exist(self):
        # Set current.mission to something with no matching mission-index entry.
        (self.tmpdir / ".harness/project-state.yml").write_text(
            "project:\n  name: t\n  mode: feature-development\n  stage: implementation\n"
            "current:\n  mission: MISSION-999-ghost\n"
        )
        r = run_cli("-C", str(self.tmpdir), "check")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("MISSION-999-ghost", r.stdout)


class TestHarnessInit(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="harness-test-"))
        make_minimal_project(self.tmpdir)
        # Provide a pipeline file so init has something to bind to.
        (self.tmpdir / "pipelines/bugfix.yml").write_text(textwrap.dedent("""
            pipeline: bugfix
            phases:
              - id: reproduce
                agent: tester
                outputs:
                  - runs/test-reports/repro.md
                gate:
                  required:
                    - reproduction_confirmed
        """).strip() + "\n")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_init_rejects_unknown_mode(self):
        r = run_cli("-C", str(self.tmpdir), "init", "wonky-mode")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("mode must be one of", r.stderr.lower())

    def test_init_writes_state(self):
        r = run_cli("-C", str(self.tmpdir), "init", "bugfix")
        self.assertEqual(r.returncode, 0, msg=r.stderr)
        state = (self.tmpdir / ".harness/project-state.yml").read_text()
        self.assertIn("mode: bugfix", state)


class TestHarnessStatus(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="harness-test-"))
        make_minimal_project(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_status_json_shape(self):
        r = run_cli("-C", str(self.tmpdir), "status", "--json")
        self.assertEqual(r.returncode, 0, msg=r.stderr)
        d = json.loads(r.stdout)
        self.assertIn("project", d)
        self.assertIn("missions", d)


class TestWindowsGitBash(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "win32", "Windows only")
    def test_find_git_bash_windows_prefers_git_over_wsl(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "install_claude_adapter",
            ROOT / "tools" / "install-claude-adapter.py",
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        git_bash = mod.find_git_bash_windows()
        self.assertIsNotNone(git_bash, "Git for Windows should be installed")
        self.assertIn("git", str(git_bash).lower())
        self.assertNotIn("system32", str(git_bash).lower())

    @unittest.skipUnless(sys.platform == "win32", "Windows only")
    def test_patch_claude_settings_wraps_sh_hooks(self):
        import importlib.util
        import json

        spec = importlib.util.spec_from_file_location(
            "install_claude_adapter",
            ROOT / "tools" / "install-claude-adapter.py",
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        git_bash = mod.find_git_bash_windows()
        self.assertIsNotNone(git_bash)

        tmpdir = Path(tempfile.mkdtemp(prefix="harness-claude-settings-"))
        try:
            settings = tmpdir / "settings.json"
            settings.write_text(
                json.dumps(
                    {
                        "hooks": {
                            "Stop": [
                                {
                                    "hooks": [
                                        {
                                            "type": "command",
                                            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-session-note-reminder.sh",
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            mod.patch_claude_settings_for_windows(settings, git_bash)
            data = json.loads(settings.read_text(encoding="utf-8"))
            cmd = data["hooks"]["Stop"][0]["hooks"][0]["command"]
            self.assertIn("bash.exe", cmd.lower())
            self.assertIn("stop-session-note-reminder.sh", cmd)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
