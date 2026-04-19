#!/usr/bin/env python3
"""Verify manifest gate_policy covers every signal used by aggregate_score.score_verdict.

Exit 0 if aligned; exit 1 if a required key is missing from gate_policy.

Usage:
  python .oversight/scripts/check_gate_policy.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import load_manifest  # type: ignore


# Keys read inside score_verdict() in aggregate_score.py — keep in sync when editing the scorer.
REQUIRED_GATE_POLICY_KEYS = frozenset(
    {
        "secret_findings",
        "env_leak_count",
        "test_only_count",
        "dangerous_api_count",
        "test_skip_count",
        "console_leak_count",
        "uncovered_routes",
        "e2e_flake_signals",
        "coverage_line_pct",
        "coverage_branch_pct",
        "vitest_failures_total",
        "playwright_failures_total",
        "prettier_failures_total",
        "todo_density_kloc",
    }
)


def main() -> int:
    m = load_manifest()
    gp = m.get("gate_policy") or {}
    if not isinstance(gp, dict):
        print("gate_policy must be a mapping in manifest.yaml", file=sys.stderr)
        return 1

    keys = {str(k) for k in gp.keys()}
    missing = sorted(REQUIRED_GATE_POLICY_KEYS - keys)
    if missing:
        print("gate_policy is missing keys required by aggregate_score.score_verdict:", file=sys.stderr)
        for k in missing:
            print(f"  - {k}", file=sys.stderr)
        print("\nAdd each under gate_policy: in manifest.yaml (hard|soft|advisory).", file=sys.stderr)
        return 1

    # Optional: unknown keys are fine (documentation / future use)
    print(f"OK: gate_policy defines all {len(REQUIRED_GATE_POLICY_KEYS)} scorer-referenced signals.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
