"""Table-driven tests for aggregate_score.score_verdict (stdlib unittest).

Run:
  python .oversight/scripts/test_aggregate_score.py
  python -m unittest .oversight.scripts.test_aggregate_score  # from repo root with PYTHONPATH
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aggregate_score import score_verdict  # type: ignore


class ScoreVerdictTests(unittest.TestCase):
    def test_hard_gate_secret_findings_adds_10000_weight(self) -> None:
        docs = [{"signals": {"secret_findings": 1}, "ok": True}]
        baselines = {}
        v = score_verdict(docs, baselines=baselines)
        self.assertGreaterEqual(v["score"], 10000)
        self.assertTrue(any("secret" in x.lower() for x in v["hard_gate_failures"]))

    def test_ok_false_is_hard_failure(self) -> None:
        docs = [{"label": "eval_x", "ok": False, "signals": {}}]
        v = score_verdict(docs, baselines={})
        self.assertGreaterEqual(v["score"], 10000)

    def test_symmetric_console_leak_reward(self) -> None:
        baselines = {"console_leak_count": 5.0}
        before = score_verdict(
            [{"signals": {"console_leak_count": 5}}],
            baselines=baselines,
        )["score"]
        after = score_verdict(
            [{"signals": {"console_leak_count": 0}}],
            baselines=baselines,
        )["score"]
        self.assertLess(after, before)

    def test_coverage_lowers_score(self) -> None:
        v0 = score_verdict([{"signals": {"coverage_line_pct": 0, "coverage_branch_pct": 0}}], baselines={})
        v1 = score_verdict([{"signals": {"coverage_line_pct": 50, "coverage_branch_pct": 40}}], baselines={})
        self.assertLess(v1["score"], v0["score"])

    def test_spawn_env_cache_hot_improvement_lowers_score(self) -> None:
        """RATCHET_DECREASING: improvement (0 -> 1, baseline 0) produces negative delta."""
        baselines = {"spawn_env_cache_hot": 0.0}
        before = score_verdict(
            [{"signals": {"spawn_env_cache_hot": 0}}],
            baselines=baselines,
        )["score"]
        after = score_verdict(
            [{"signals": {"spawn_env_cache_hot": 1}}],
            baselines=baselines,
        )["score"]
        self.assertLess(after, before)

    def test_spawn_sites_missing_stderr_regression_raises_score(self) -> None:
        """RATCHET_INCREASING: regression (0 -> 2, baseline 0) produces positive delta."""
        baselines = {"spawn_sites_missing_stderr": 0.0}
        before = score_verdict(
            [{"signals": {"spawn_sites_missing_stderr": 0}}],
            baselines=baselines,
        )["score"]
        after = score_verdict(
            [{"signals": {"spawn_sites_missing_stderr": 2}}],
            baselines=baselines,
        )["score"]
        self.assertGreater(after, before)

    def test_sse_server_has_heartbeat_improvement_lowers_score(self) -> None:
        """RATCHET_DECREASING: improvement (0 -> 1, baseline 0) produces negative delta."""
        baselines = {"sse_server_has_heartbeat": 0.0}
        before = score_verdict(
            [{"signals": {"sse_server_has_heartbeat": 0}}],
            baselines=baselines,
        )["score"]
        after = score_verdict(
            [{"signals": {"sse_server_has_heartbeat": 1}}],
            baselines=baselines,
        )["score"]
        self.assertLess(after, before)


if __name__ == "__main__":
    unittest.main()
