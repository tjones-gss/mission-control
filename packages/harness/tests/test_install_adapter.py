"""Tests for the --hooks {shell|node|auto} selection in install-claude-adapter.py.

Phase 3 / L2: the cockpit one-click path uses the pure-Node hooks; the CLI gains
the same choice so a no-bash/no-jq machine can wire enforcing rails.
"""

from __future__ import annotations

import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parent.parent
INSTALLER = HARNESS_ROOT / "tools" / "install-claude-adapter.py"
ADAPTER_SRC = HARNESS_ROOT / "adapters" / "claude-code"


def _load_installer():
    spec = importlib.util.spec_from_file_location("install_claude_adapter_mod", INSTALLER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _make_root() -> Path:
    """A tmp project root with the real adapter copied under adapters/claude-code."""
    root = Path(tempfile.mkdtemp(prefix="installadapter-"))
    shutil.copytree(ADAPTER_SRC, root / "adapters" / "claude-code")
    return root


class TestHooksFlag(unittest.TestCase):
    def setUp(self):
        self.mod = _load_installer()
        self.root = _make_root()
        self.addCleanup(lambda: shutil.rmtree(self.root, ignore_errors=True))

    def test_node_wires_mjs_and_drops_test_file(self):
        rc = self.mod.install_claude_adapter(self.root, run_check=False, quiet=True, hooks="node")
        self.assertEqual(rc, 0)
        settings = (self.root / ".claude" / "settings.json").read_text(encoding="utf-8")
        self.assertIn("block-danger.mjs", settings)
        self.assertNotIn("block-danger.sh", settings)
        # The hooks' own test file must not ship into the project.
        self.assertFalse((self.root / ".claude" / "hooks" / "hooks.test.mjs").exists())
        # The .mjs hooks are present.
        self.assertTrue((self.root / ".claude" / "hooks" / "_lib.mjs").exists())

    def test_shell_keeps_sh_commands(self):
        rc = self.mod.install_claude_adapter(self.root, run_check=False, quiet=True, hooks="shell")
        self.assertEqual(rc, 0)
        settings = (self.root / ".claude" / "settings.json").read_text(encoding="utf-8")
        self.assertIn("block-danger.sh", settings)

    def test_auto_picks_node_when_jq_absent(self):
        original_which = shutil.which
        try:
            # Pretend jq is missing (the common Windows gap) → auto should pick node.
            shutil.which = lambda name: None if name == "jq" else original_which(name)
            self.assertEqual(self.mod._resolve_hooks_mode("auto"), "node")
            # And with both present, auto picks shell.
            shutil.which = lambda name: "/usr/bin/" + name
            self.assertEqual(self.mod._resolve_hooks_mode("auto"), "shell")
        finally:
            shutil.which = original_which


if __name__ == "__main__":
    unittest.main()
