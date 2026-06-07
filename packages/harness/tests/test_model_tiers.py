#!/usr/bin/env python3
"""
tests/test_model_tiers.py — Tests for per-phase model-tier resolution.

Covers the precedence in harness_core.model_tiers.resolve_model:
  phase.model -> role default (role_tiers) -> default_tier -> cfg_default -> None
and alias-vs-literal handling.

Run:
    python3 tests/test_model_tiers.py
or, from the harness package root:
    python3 -m unittest tests.test_model_tiers
"""

import shutil
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from harness_core.model_tiers import resolve_model  # noqa: E402


def write_tiers(root: Path, body: str) -> None:
    (root / ".harness").mkdir(parents=True, exist_ok=True)
    (root / ".harness/model-tiers.yml").write_text(textwrap.dedent(body).strip() + "\n")


def write_registry(root: Path, body: str) -> None:
    (root / ".harness").mkdir(parents=True, exist_ok=True)
    (root / ".harness/agent-registry.yml").write_text(textwrap.dedent(body).strip() + "\n")


class TestResolveModel(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="harness-tiers-"))
        write_tiers(
            self.tmp,
            """
            tiers:
              heavy: model-big
              standard: model-mid
              light: model-small
            default_tier: null
            """,
        )
        write_registry(
            self.tmp,
            """
            aliases: {}
            role_tiers:
              orchestrator: heavy
              repo-analyzer: light
            """,
        )

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_all_unset_returns_cfg_default(self):
        self.assertEqual(resolve_model(self.tmp, {}, cfg_default="composer-2.5"), "composer-2.5")

    def test_all_unset_returns_none_without_cfg_default(self):
        self.assertIsNone(resolve_model(self.tmp, {}))

    def test_phase_alias_maps_to_concrete(self):
        self.assertEqual(resolve_model(self.tmp, {"model": "heavy"}), "model-big")

    def test_phase_literal_passthrough(self):
        self.assertEqual(resolve_model(self.tmp, {"model": "gpt-whatever"}), "gpt-whatever")

    def test_role_default_used_when_phase_has_none(self):
        self.assertEqual(resolve_model(self.tmp, {}, agent="repo-analyzer"), "model-small")

    def test_phase_beats_role(self):
        self.assertEqual(
            resolve_model(self.tmp, {"model": "light"}, agent="orchestrator"),
            "model-small",
        )

    def test_role_beats_default_tier(self):
        write_tiers(
            self.tmp,
            """
            tiers:
              heavy: model-big
              standard: model-mid
              light: model-small
            default_tier: standard
            """,
        )
        # orchestrator -> heavy beats default_tier standard
        self.assertEqual(resolve_model(self.tmp, {}, agent="orchestrator"), "model-big")

    def test_default_tier_used_when_phase_and_role_none(self):
        write_tiers(
            self.tmp,
            """
            tiers:
              heavy: model-big
              standard: model-mid
            default_tier: standard
            """,
        )
        self.assertEqual(resolve_model(self.tmp, {}, agent="unlisted-role"), "model-mid")

    def test_missing_file_degrades_to_cfg_default(self):
        empty = Path(tempfile.mkdtemp(prefix="harness-tiers-empty-"))
        try:
            self.assertEqual(resolve_model(empty, {}, cfg_default="composer-2.5"), "composer-2.5")
            # an alias with no tiers file is treated as a literal (no mapping available)
            self.assertEqual(resolve_model(empty, {"model": "heavy"}), "heavy")
        finally:
            shutil.rmtree(empty, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
