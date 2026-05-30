#!/usr/bin/env python3
"""Run Oversight framework self-tests (no third-party deps).

  - YAML golden snippets (_yaml.py)
  - aggregate_score table tests (unittest)

Usage:
  python .oversight/scripts/run_selftest.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import _yaml  # type: ignore  # noqa: E402


def _test_yaml_goldens() -> None:
    # Block scalar folded to quoted string with newlines
    sample = """\
key: |
  line1
  line2
"""
    d = _yaml.load(sample)
    assert d.get("key") == "line1\nline2\n", d

    # Simple mapping
    d2 = _yaml.load("a: 1\nb: [x, y]\n")
    assert d2["a"] == 1
    assert d2["b"] == ["x", "y"]


def main() -> int:
    import importlib.util

    spec = importlib.util.spec_from_file_location("oversight_test_aggregate_score", HERE / "test_aggregate_score.py")
    if spec is None or spec.loader is None:
        print("Could not load test_aggregate_score.py", file=sys.stderr)
        return 1
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(mod)

    runner = unittest.TextTestRunner(verbosity=1)
    result = runner.run(suite)
    if not result.wasSuccessful():
        return 1
    print()

    _test_yaml_goldens()
    print("YAML golden self-check: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
