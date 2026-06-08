"""Parity test: the pure-Node hooks (.mjs) must behave identically to the shell
hooks (.sh) across a shared fixture corpus.

This is the executable definition of "IDENTICAL behavior" for the Phase 3 (L2)
pure-Node hook port. It runs each case through BOTH the .sh hook (bash + jq) and
the .mjs hook (node), then compares:
  - exit code (exact)
  - stdout: structural JSON equality when both emit JSON, else
            trimmed-trailing-whitespace text equality (handles bash printf vs
            node stdout.write newline differences)
  - stderr: trimmed text equality

It SKIPS cleanly when bash, jq, or node is absent (e.g. the author's Windows box
has no jq), so it never blocks local runs; CI installs all three.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HOOK_DIR = Path(__file__).resolve().parent.parent / "adapters" / "claude-code" / ".claude" / "hooks"

HAVE_BASH = shutil.which("bash") is not None
HAVE_JQ = shutil.which("jq") is not None
HAVE_NODE = shutil.which("node") is not None
SKIP_REASON = "hook parity needs bash + jq + node all present"


def _norm_text(s: str) -> str:
    """Strip trailing whitespace per line and drop trailing blank lines."""
    lines = [ln.rstrip() for ln in (s or "").splitlines()]
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines)


def _run(cmd, *, stdin: str, cwd: Path, env_extra: dict[str, str]):
    import os

    env = os.environ.copy()
    env["CLAUDE_PROJECT_DIR"] = str(cwd)
    env.update(env_extra)
    proc = subprocess.run(
        cmd,
        input=stdin,
        capture_output=True,
        text=True,
        cwd=str(cwd),
        env=env,
    )
    return proc.returncode, proc.stdout, proc.stderr


def _maybe_json(s: str):
    s = (s or "").strip()
    if not s.startswith("{"):
        return None
    try:
        return json.loads(s)
    except Exception:
        return None


@unittest.skipUnless(HAVE_BASH and HAVE_JQ and HAVE_NODE, SKIP_REASON)
class TestHookParity(unittest.TestCase):
    def _assert_parity(self, hook_base: str, *, stdin: str, project: Path, env_extra=None):
        env_extra = env_extra or {}
        sh = HOOK_DIR / f"{hook_base}.sh"
        mjs = HOOK_DIR / f"{hook_base}.mjs"
        self.assertTrue(sh.is_file(), f"missing {sh}")
        self.assertTrue(mjs.is_file(), f"missing {mjs}")

        rc_sh, out_sh, err_sh = _run(["bash", str(sh)], stdin=stdin, cwd=project, env_extra=env_extra)
        rc_mjs, out_mjs, err_mjs = _run(["node", str(mjs)], stdin=stdin, cwd=project, env_extra=env_extra)

        ctx = f"hook={hook_base} stdin={stdin!r} env={env_extra}"
        self.assertEqual(rc_sh, rc_mjs, f"exit code differs ({ctx})\nsh={out_sh!r}/{err_sh!r}\nmjs={out_mjs!r}/{err_mjs!r}")

        j_sh, j_mjs = _maybe_json(out_sh), _maybe_json(out_mjs)
        if j_sh is not None or j_mjs is not None:
            self.assertEqual(j_sh, j_mjs, f"JSON stdout differs ({ctx})")
        else:
            self.assertEqual(_norm_text(out_sh), _norm_text(out_mjs), f"text stdout differs ({ctx})")

        self.assertEqual(_norm_text(err_sh), _norm_text(err_mjs), f"stderr differs ({ctx})")

    # ---- block-danger (fallback patterns, no .harness needed) ----
    def test_block_danger_corpus(self):
        proj = Path(self.mkproject())
        bash_in = lambda c: json.dumps({"tool_input": {"command": c}})
        for cmd in [
            "rm -rf /tmp/x",
            "ls -la",
            "DROP TABLE users",
            "rm --recursive --force build",
            "rm -fr node_modules",
            "find . -name x -delete",
            "git clean -fdx",
            "dd if=/dev/zero of=/dev/sda",
            "mkfs.ext4 /dev/sdb",
            "chmod -R 777 /",
            "npm run format",
            "git status",
        ]:
            self._assert_parity("block-danger", stdin=bash_in(cmd), project=proj)
        # fail-closed + absent-field
        self._assert_parity("block-danger", stdin="garbage{", project=proj)
        self._assert_parity("block-danger", stdin=json.dumps({"tool_input": {}}), project=proj)

    def test_block_danger_yaml_source(self):
        proj = Path(self.mkproject())
        (proj / ".harness").mkdir(parents=True, exist_ok=True)
        (proj / ".harness" / "danger-zone.yml").write_text(
            'blocked_command_patterns:\n  - "deploy to prod"\n', encoding="utf-8"
        )
        bash_in = json.dumps({"tool_input": {"command": "./deploy to prod"}})
        self._assert_parity("block-danger", stdin=bash_in, project=proj)

    # ---- require-mission ----
    def test_require_mission_corpus(self):
        proj = Path(self.mkproject())
        (proj / ".harness").mkdir(parents=True, exist_ok=True)
        (proj / ".harness" / "project-state.yml").write_text(
            "project:\n  mode: build\ncurrent:\n  mission: MISSION-001\n", encoding="utf-8"
        )
        (proj / ".harness" / "mission-index.yml").write_text(
            "MISSION-001:\n  file: runs/missions/MISSION-001-x.md\n", encoding="utf-8"
        )
        (proj / "runs" / "missions").mkdir(parents=True, exist_ok=True)
        (proj / "runs" / "missions" / "MISSION-001-x.md").write_text(
            "# MISSION-001\n\n## Allowed Files\n- src/**\n\n## Forbidden Files\n- src/secret.ts\n",
            encoding="utf-8",
        )
        edit_in = lambda p: json.dumps({"tool_input": {"file_path": str(proj / p)}})
        for rel in ["src/a.ts", "lib/b.ts", "src/secret.ts", "docs/x.md"]:
            self._assert_parity("require-mission", stdin=edit_in(rel), project=proj)
        # traversal + no-path
        self._assert_parity("require-mission", stdin=edit_in("src/../secret.ts"), project=proj)
        self._assert_parity("require-mission", stdin=json.dumps({"tool_input": {}}), project=proj)

    def test_require_mission_bootstrap_and_no_mission(self):
        boot = Path(self.mkproject())
        (boot / ".harness").mkdir(parents=True, exist_ok=True)
        (boot / ".harness" / "project-state.yml").write_text(
            "project:\n  mode: idea-to-mvp\ncurrent:\n  mission: null\n", encoding="utf-8"
        )
        edit_in = json.dumps({"tool_input": {"file_path": str(boot / "src" / "a.ts")}})
        self._assert_parity("require-mission", stdin=edit_in, project=boot)
        harness_in = json.dumps({"tool_input": {"file_path": str(boot / "docs" / "x.md")}})
        self._assert_parity("require-mission", stdin=harness_in, project=boot)

    # ---- session-start ----
    def test_session_start(self):
        empty = Path(self.mkproject())
        self._assert_parity("session-start-load-state", stdin="", project=empty)
        proj = Path(self.mkproject())
        (proj / ".harness").mkdir(parents=True, exist_ok=True)
        (proj / ".harness" / "project-state.yml").write_text("project:\n  mode: build\n", encoding="utf-8")
        (proj / ".harness" / "mission-index.yml").write_text("MISSION-001: {}\n", encoding="utf-8")
        self._assert_parity("session-start-load-state", stdin="", project=proj)

    # ---- stop-note ----
    def test_stop_note(self):
        proj = Path(self.mkproject())
        (proj / ".harness").mkdir(parents=True, exist_ok=True)
        (proj / ".harness" / "project-state.yml").write_text("current:\n  mission: MISSION-007\n", encoding="utf-8")
        self._assert_parity("stop-session-note-reminder", stdin="", project=proj)
        self._assert_parity(
            "stop-session-note-reminder", stdin="", project=proj, env_extra={"HARNESS_ENFORCE_SESSION_NOTE": "1"}
        )
        # no mission → advisory only even under enforce
        empty = Path(self.mkproject())
        self._assert_parity(
            "stop-session-note-reminder", stdin="", project=empty, env_extra={"HARNESS_ENFORCE_SESSION_NOTE": "1"}
        )

    # ---- per-test tmp dirs ----
    def mkproject(self) -> str:
        import tempfile

        d = tempfile.mkdtemp(prefix="hookparity-")
        self.addCleanup(lambda: shutil.rmtree(d, ignore_errors=True))
        return d


if __name__ == "__main__":
    unittest.main()
