"""Capture baseline values for every ratchet signal.

Runs each cheap evaluator once and writes `.oversight/state/baselines.json`.
Future improvement loops compare current signal values against these
baselines to decide whether a regression has occurred.

Coverage is expensive (spawns vitest); `--skip-coverage` exits without it.
Route parity and secret scanning are cheap; always run.

Usage:
  python .oversight/scripts/establish_baselines.py
  python .oversight/scripts/establish_baselines.py --skip-coverage
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import OVERSIGHT, REPO_ROOT, now_stamp, run, write_json  # type: ignore


EVAL_SEQUENCE = [
    ("code_health",         "python .oversight/scripts/eval_code_health.py",         True),
    ("test_markers",        "python .oversight/scripts/eval_test_markers.py",        True),
    ("e2e_flake",           "python .oversight/scripts/eval_e2e_flake.py",           True),
    ("route_parity",        "python .oversight/scripts/eval_route_parity.py",        True),
    ("security",            "python .oversight/scripts/eval_security.py",            True),
    ("connection_quality",  "python .oversight/scripts/eval_connection_quality.py",  True),
    ("coverage",            "python .oversight/scripts/eval_coverage.py",            False),  # slow
]


def _latest(prefix: str) -> Path | None:
    scores = OVERSIGHT / "state" / "scores"
    if not scores.exists():
        return None
    matches = sorted(scores.glob(f"{prefix}__*.json"), key=lambda p: p.stat().st_mtime)
    return matches[-1] if matches else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-coverage", action="store_true")
    parser.add_argument("--force", action="store_true", help="Overwrite baselines.json even if non-empty.")
    args = parser.parse_args()

    baselines_path = OVERSIGHT / "state" / "baselines.json"
    if baselines_path.exists() and not args.force:
        existing = json.loads(baselines_path.read_text(encoding="utf-8") or "{}")
        if existing:
            print(
                f"WARNING: {baselines_path} already has {len(existing)} keys. "
                "Pass --force to overwrite.",
                file=sys.stderr,
            )

    print("=== Establishing baselines ===")
    print(f"cwd: {REPO_ROOT}")

    collected: dict[str, object] = {}
    ran: list[dict] = []
    for name, cmd, cheap in EVAL_SEQUENCE:
        if name == "coverage" and args.skip_coverage:
            print(f"\n[{name}] skipped (--skip-coverage)")
            continue
        if not cheap:
            print(f"\n[{name}] WARNING: this one is slow (may take a minute or two)")
        print(f"\n[{name}] $ {cmd}")
        start = time.time()
        r = run(cmd, cwd=REPO_ROOT, timeout=1800)
        dur = round(time.time() - start, 1)
        print(f"  exit={r['exit_code']}  duration={dur}s")
        ran.append({"name": name, "exit_code": r["exit_code"], "duration_s": dur})

        # Pick up the score file the evaluator just wrote.
        latest_score = _latest(f"eval_{name}")
        if latest_score is None and name == "e2e_flake":
            latest_score = _latest("eval_e2e_flake")
        if latest_score is None:
            # some eval labels differ — try the more specific name.
            latest_score = _latest(name)
        if latest_score is None:
            print(f"  WARN: no score file found for {name} under state/scores/")
            continue
        try:
            doc = json.loads(latest_score.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"  WARN: could not parse {latest_score}")
            continue
        sigs = doc.get("signals") or {}
        for k, v in sigs.items():
            collected[k] = v
        print(f"  captured {len(sigs)} signal(s) from {latest_score.name}")

    collected["__meta__"] = {
        "timestamp": now_stamp(),
        "ran": ran,
        "note": (
            "Baselines for ratchet signals. aggregate_score.py subtracts these "
            "from current values to compute delta-penalties. Do not edit by hand."
        ),
    }

    write_json(baselines_path, collected)

    print("\n=== Baselines written ===")
    print(f"Path: {baselines_path}")
    print("Signals captured (excluding __meta__):")
    for k in sorted(collected):
        if k == "__meta__":
            continue
        print(f"  {k:<30} {collected[k]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
