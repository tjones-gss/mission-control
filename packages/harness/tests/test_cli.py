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


class TestHarnessScaffold(unittest.TestCase):
    """`harness scaffold <mode>` creates a NEW harness project in an uninitialized dir."""

    def setUp(self):
        # A brand-new, empty target directory — NOT a harness project yet.
        self.tmpdir = Path(tempfile.mkdtemp(prefix="harness-scaffold-"))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_scaffold_creates_project_in_empty_dir(self):
        r = run_cli("-C", str(self.tmpdir), "scaffold", "idea-to-mvp", "--json")
        self.assertEqual(r.returncode, 0, msg=f"{r.stdout}\n{r.stderr}")
        # Core files exist.
        self.assertTrue((self.tmpdir / ".harness/project-state.yml").exists())
        self.assertTrue((self.tmpdir / ".harness/quality-gates.yml").exists(),
                        "reusable config templates should be copied")
        self.assertTrue((self.tmpdir / "pipelines/idea-to-mvp.yml").exists(),
                        "the active mode's pipeline file must be present")
        self.assertTrue((self.tmpdir / "AGENTS.md").exists())
        # JSON contract.
        out = json.loads(r.stdout)
        self.assertTrue(out["ok"])
        self.assertEqual(out["mode"], "idea-to-mvp")
        self.assertIn("stage", out)
        self.assertIn("phase", out)
        self.assertIsInstance(out["created"], list)
        self.assertTrue(len(out["created"]) > 0)

    def test_scaffold_writes_clean_identity_not_the_harness_own_state(self):
        """A fresh project must NOT inherit the harness package's own live state."""
        r = run_cli("-C", str(self.tmpdir), "scaffold", "bugfix", "--json")
        self.assertEqual(r.returncode, 0, msg=f"{r.stdout}\n{r.stderr}")
        state = (self.tmpdir / ".harness/project-state.yml").read_text()
        self.assertIn(f"name: {self.tmpdir.name}", state, "project name should be the target dir")
        self.assertIn("mode: bugfix", state)
        # None of the harness's own live-state leakage.
        self.assertNotIn("MISSION-001-example", state)
        self.assertNotIn("mock-run", state)
        self.assertNotIn("adaptive-agentic-engineering-harness", state)
        index = (self.tmpdir / ".harness/mission-index.yml").read_text()
        self.assertNotIn("MISSION-001-example", index)

    def test_scaffolded_project_is_a_working_harness_project(self):
        sc = run_cli("-C", str(self.tmpdir), "scaffold", "feature-development", "--json")
        self.assertEqual(sc.returncode, 0, msg=f"{sc.stdout}\n{sc.stderr}")
        # The scaffolded tree must satisfy the CLI: status --json works end-to-end.
        st = run_cli("-C", str(self.tmpdir), "status", "--json")
        self.assertEqual(st.returncode, 0, msg=f"{st.stdout}\n{st.stderr}")
        d = json.loads(st.stdout)
        self.assertEqual(d["project"]["mode"], "feature-development")

    def test_scaffolded_project_passes_check_cleanly(self):
        """A fresh scaffold should be healthy — agent roles resolved, check exits 0."""
        sc = run_cli("-C", str(self.tmpdir), "scaffold", "idea-to-mvp", "--json")
        self.assertEqual(sc.returncode, 0, msg=f"{sc.stdout}\n{sc.stderr}")
        chk = run_cli("-C", str(self.tmpdir), "check")
        self.assertEqual(chk.returncode, 0,
                         msg=f"scaffolded project is not healthy:\n{chk.stdout}\n{chk.stderr}")
        self.assertNotIn("unresolved", chk.stdout.lower(),
                         "pipeline agents should resolve to copied role files")

    def test_scaffold_rejects_existing_without_force(self):
        first = run_cli("-C", str(self.tmpdir), "scaffold", "bugfix", "--json")
        self.assertEqual(first.returncode, 0, msg=f"{first.stdout}\n{first.stderr}")
        second = run_cli("-C", str(self.tmpdir), "scaffold", "bugfix", "--json")
        self.assertNotEqual(second.returncode, 0, "re-scaffolding without --force must fail")
        out = json.loads(second.stdout)
        self.assertFalse(out["ok"])
        self.assertEqual(out["error"], "already_initialized")
        # --force lets it through.
        forced = run_cli("-C", str(self.tmpdir), "scaffold", "bugfix", "--json", "--force")
        self.assertEqual(forced.returncode, 0, msg=f"{forced.stdout}\n{forced.stderr}")

    def test_scaffold_rejects_unknown_mode(self):
        r = run_cli("-C", str(self.tmpdir), "scaffold", "wonky-mode", "--json")
        self.assertNotEqual(r.returncode, 0)
        out = json.loads(r.stdout)
        self.assertFalse(out["ok"])
        self.assertEqual(out["error"], "invalid_mode")


class TestModelTiersCheck(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="harness-test-"))
        make_minimal_project(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_missing_tiers_file_is_ok(self):
        r = run_cli("-C", str(self.tmpdir), "check")
        self.assertIn("single-model behavior", r.stdout)

    def test_bad_default_tier_fails(self):
        (self.tmpdir / ".harness/model-tiers.yml").write_text(
            "tiers:\n  heavy: m-big\ndefault_tier: ghost\n"
        )
        r = run_cli("-C", str(self.tmpdir), "check")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("default_tier", r.stdout)

    def test_undefined_role_tier_warns(self):
        (self.tmpdir / ".harness/model-tiers.yml").write_text("tiers:\n  heavy: m-big\n")
        (self.tmpdir / ".harness/agent-registry.yml").write_text(
            "aliases: {}\nrole_tiers:\n  orchestrator: heavt\n"
        )
        r = run_cli("-C", str(self.tmpdir), "check")
        self.assertIn("heavt", r.stdout)
        self.assertIn("not a defined tier", r.stdout)


class TestPlanCli(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="harness-test-"))
        make_minimal_project(self.tmpdir)
        (self.tmpdir / ".harness/plan-index.yml").write_text("plans: {}\n")
        (self.tmpdir / "docs/plans").mkdir(parents=True)
        (self.tmpdir / "docs/plans/PRD-demo.md").write_text("# PRD: demo\n")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _decide(self, request_path: Path, *, decision: str, command_hash: str):
        req = json.loads(request_path.read_text())
        decided = self.tmpdir / ".harness/approvals/decided"
        decided.mkdir(parents=True, exist_ok=True)
        (decided / f"{req['id']}.json").write_text(
            json.dumps(
                {
                    "id": req["id"],
                    "schemaVersion": req["schemaVersion"],
                    "decision": decision,
                    "approver": "tester",
                    "commandHash": command_hash,
                    "decidedAt": "2026-05-31T00:00:00+00:00",
                }
            )
        )

    def _pending(self) -> Path:
        return next((self.tmpdir / ".harness/approvals/pending").glob("*.json"))

    def test_register_request_sync_approves(self):
        r = run_cli("-C", str(self.tmpdir), "plan", "register", "PRD-demo",
                    "--file", "docs/plans/PRD-demo.md")
        self.assertEqual(r.returncode, 0, msg=r.stderr)
        r = run_cli("-C", str(self.tmpdir), "plan", "request", "PRD-demo")
        self.assertEqual(r.returncode, 0, msg=r.stderr)
        req = self._pending()
        chash = json.loads(req.read_text())["commandHash"]
        self._decide(req, decision="allow", command_hash=chash)
        r = run_cli("-C", str(self.tmpdir), "plan", "sync")
        self.assertIn("approved", r.stdout)
        r = run_cli("-C", str(self.tmpdir), "plan", "list", "--json")
        self.assertEqual(json.loads(r.stdout)["PRD-demo"]["status"], "approved")

    def test_sync_ignores_hash_mismatch(self):
        run_cli("-C", str(self.tmpdir), "plan", "register", "PRD-demo",
                "--file", "docs/plans/PRD-demo.md")
        run_cli("-C", str(self.tmpdir), "plan", "request", "PRD-demo")
        self._decide(self._pending(), decision="allow", command_hash="tampered")
        r = run_cli("-C", str(self.tmpdir), "plan", "sync")
        self.assertIn("mismatch", (r.stdout + r.stderr).lower())
        r = run_cli("-C", str(self.tmpdir), "plan", "list", "--json")
        self.assertEqual(json.loads(r.stdout)["PRD-demo"]["status"], "in-review")


class TestMissionReady(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="harness-test-"))
        make_minimal_project(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _write_index(self, body: str):
        (self.tmpdir / ".harness/mission-index.yml").write_text(body)

    def _index(self) -> dict:
        r = run_cli("-C", str(self.tmpdir), "status", "--json")
        return json.loads(r.stdout)["missions"]

    def test_ready_flips_draft_to_ready(self):
        self._write_index(
            "missions:\n"
            "  MISSION-001-auth:\n"
            "    status: draft\n"
            "    file: runs/missions/MISSION-001-auth.md\n"
        )
        r = run_cli("-C", str(self.tmpdir), "mission", "ready", "MISSION-001-auth")
        self.assertEqual(r.returncode, 0, msg=r.stderr)
        self.assertEqual(self._index()["MISSION-001-auth"]["status"], "ready")

    def test_ready_errors_when_not_found(self):
        self._write_index("missions: {}\n")
        r = run_cli("-C", str(self.tmpdir), "mission", "ready", "MISSION-ghost")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no mission", r.stderr.lower())

    def test_ready_errors_when_not_draft(self):
        self._write_index(
            "missions:\n"
            "  MISSION-001-auth:\n"
            "    status: ready\n"
            "    file: runs/missions/MISSION-001-auth.md\n"
        )
        r = run_cli("-C", str(self.tmpdir), "mission", "ready", "MISSION-001-auth")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("not `draft`", r.stderr)
        # Status is unchanged (still ready, not corrupted).
        self.assertEqual(self._index()["MISSION-001-auth"]["status"], "ready")


class TestMissionStatus(unittest.TestCase):
    """`harness mission status <id> <state>` — the single-writer outcome path
    Fleet/loop write back through (instead of editing mission-index.yml)."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="harness-test-"))
        make_minimal_project(self.tmpdir)
        (self.tmpdir / ".harness/mission-index.yml").write_text(
            "missions:\n"
            "  MISSION-001-auth:\n"
            "    status: in-progress\n"
            "    file: runs/missions/MISSION-001-auth.md\n"
        )

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _index(self) -> dict:
        r = run_cli("-C", str(self.tmpdir), "status", "--json")
        return json.loads(r.stdout)["missions"]

    def test_sets_canonical_state(self):
        r = run_cli("-C", str(self.tmpdir), "mission", "status", "MISSION-001-auth", "review")
        self.assertEqual(r.returncode, 0, msg=r.stderr)
        self.assertEqual(self._index()["MISSION-001-auth"]["status"], "review")

    def test_rejects_non_canonical_state(self):
        r = run_cli("-C", str(self.tmpdir), "mission", "status", "MISSION-001-auth", "bogus")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("canonical", r.stderr.lower())
        # Unchanged on rejection.
        self.assertEqual(self._index()["MISSION-001-auth"]["status"], "in-progress")

    def test_errors_when_mission_unknown(self):
        r = run_cli("-C", str(self.tmpdir), "mission", "status", "MISSION-ghost", "complete")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no mission", r.stderr.lower())


class TestApprove(unittest.TestCase):
    """`harness approve <id> --allow|--deny` is the SINGLE writer of decided
    files. It copies the pending request's commandHash (replay-proofing) and
    writes a schema-valid approval-decision."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="harness-test-"))
        make_minimal_project(self.tmpdir)
        self.pending_dir = self.tmpdir / ".harness/approvals/pending"
        self.decided_dir = self.tmpdir / ".harness/approvals/decided"
        self.pending_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _write_pending(self, request_id: str, command_hash: str = "abc123"):
        (self.pending_dir / f"{request_id}.json").write_text(
            json.dumps(
                {
                    "id": request_id,
                    "schemaVersion": 2,
                    "projectPath": str(self.tmpdir),
                    "tool": "Bash",
                    "command": "git push --force",
                    "matchedPattern": "force-push",
                    "riskLevel": "DESTRUCTIVE",
                    "commandHash": command_hash,
                    "requestedAt": "2026-06-04T12:00:00+00:00",
                }
            )
        )

    def _assert_schema_valid_decision(self, doc: dict):
        # Mirror the required fields + enum of approval-decision.schema.json.
        for field in ("id", "schemaVersion", "decision", "approver", "commandHash", "decidedAt"):
            self.assertIn(field, doc, f"decision missing required field {field}")
        self.assertIn(doc["decision"], ("allow", "deny"))
        self.assertIsInstance(doc["schemaVersion"], int)

    def test_approve_allow_writes_schema_valid_decision_with_matching_hash(self):
        self._write_pending("req-allow", command_hash="HASH-ALLOW")
        r = run_cli("-C", str(self.tmpdir), "approve", "req-allow", "--allow")
        self.assertEqual(r.returncode, 0, msg=r.stderr)
        decided = json.loads((self.decided_dir / "req-allow.json").read_text())
        self._assert_schema_valid_decision(decided)
        self.assertEqual(decided["id"], "req-allow")
        self.assertEqual(decided["decision"], "allow")
        self.assertEqual(decided["commandHash"], "HASH-ALLOW")
        self.assertEqual(decided["approver"], "cockpit-fleet")

    def test_approve_deny_writes_schema_valid_decision_with_matching_hash(self):
        self._write_pending("req-deny", command_hash="HASH-DENY")
        r = run_cli(
            "-C", str(self.tmpdir), "approve", "req-deny", "--deny", "--approver", "alice"
        )
        self.assertEqual(r.returncode, 0, msg=r.stderr)
        decided = json.loads((self.decided_dir / "req-deny.json").read_text())
        self._assert_schema_valid_decision(decided)
        self.assertEqual(decided["decision"], "deny")
        self.assertEqual(decided["commandHash"], "HASH-DENY")
        self.assertEqual(decided["approver"], "alice")

    def test_approve_missing_pending_errors(self):
        r = run_cli("-C", str(self.tmpdir), "approve", "req-ghost", "--allow")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no pending approval", r.stderr.lower())
        self.assertFalse((self.decided_dir / "req-ghost.json").exists())

    def test_approve_already_decided_errors(self):
        self._write_pending("req-twice")
        r = run_cli("-C", str(self.tmpdir), "approve", "req-twice", "--allow")
        self.assertEqual(r.returncode, 0, msg=r.stderr)
        r2 = run_cli("-C", str(self.tmpdir), "approve", "req-twice", "--deny")
        self.assertNotEqual(r2.returncode, 0)
        self.assertIn("already decided", r2.stderr.lower())
        # The original allow decision is untouched (not flipped to deny).
        decided = json.loads((self.decided_dir / "req-twice.json").read_text())
        self.assertEqual(decided["decision"], "allow")

    def test_approve_requires_a_decision_flag(self):
        self._write_pending("req-noflag")
        r = run_cli("-C", str(self.tmpdir), "approve", "req-noflag")
        self.assertNotEqual(r.returncode, 0)


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
