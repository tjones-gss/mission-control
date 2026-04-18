"""Aggregate one or more eval result JSONs into a single comparable score.

Lower is better. Extended score formula (score_v2):

    score =  10000 * hard_gate_failures
          +   1000 * soft_gate_regressions
          +    100 * vitest_failures_total
          +    100 * playwright_failures_total
          +     50 * test_only_count
          +     50 * max(0, dangerous_api_count - baseline)     # regression penalty
          -     50 * max(0, baseline - dangerous_api_count)     # improvement reward
          +     10 * max(0, uncovered_routes   - baseline)
          -     10 * max(0, baseline - uncovered_routes)
          +     10 * max(0, test_skip_count    - baseline)
          -     10 * max(0, baseline - test_skip_count)
          +      5 * max(0, console_leak_count - baseline)
          -      5 * max(0, baseline - console_leak_count)
          +      1 * max(0, e2e_flake_signals  - baseline)
          -      1 * max(0, baseline - e2e_flake_signals)
          +      2 * todo_density_kloc
          +      1 * prettier_failures_total
          -     20 * coverage_line_pct
          -     10 * coverage_branch_pct

Hard-gate triggers (each adds 1 hard_gate_failure):
    - secret_findings > 0
    - env_leak_count  > 0
    - test_only_count > 0
    - dangerous_api_count grew above baseline
    - any input doc has ok:false

Soft-gate regressions (each adds 1 soft_gate_regression) are counted for:
    - coverage_line_pct dropped vs baseline
    - coverage_branch_pct dropped vs baseline
    - test_skip_count, console_leak_count, uncovered_routes,
      e2e_flake_signals each grew above baseline

Usage:
  python .oversight/scripts/aggregate_score.py path/to/result.json [...]
  python .oversight/scripts/aggregate_score.py --glob ".oversight/state/scores/*.json"
  python .oversight/scripts/aggregate_score.py --latest           # score all latest files
  python .oversight/scripts/aggregate_score.py --emit-verdict path.json
"""

from __future__ import annotations

import argparse
import glob as _glob
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # type: ignore
    OVERSIGHT,
    extract_signals,
    load_baselines,
    load_gate_policy,
    read_json,
    write_json,
    now_stamp,
)


# Canonical signal names that ratchet — increase is bad unless at/below baseline.
RATCHET_INCREASING = [
    "test_skip_count",
    "console_leak_count",
    "uncovered_routes",
    "e2e_flake_signals",
    "dangerous_api_count",
]
# Signals that ratchet — decrease is bad (percent-style coverage).
RATCHET_PCT = ["coverage_line_pct", "coverage_branch_pct"]


def _load_doc(p: str) -> dict:
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        print(f"WARN: could not read {p}: {e}", file=sys.stderr)
        return {}


def combine_signals(docs: list[dict]) -> dict:
    """Merge signals from many docs.

    For counters that are summed across docs (vitest/prettier/playwright totals),
    do actual addition. Everything else is last-writer-wins, but since each
    eval script writes its own signal namespace there's no real collision.
    """
    combined: dict = {}
    sum_keys = {
        "vitest_failures_total",
        "playwright_failures_total",
        "prettier_failures_total",
    }
    for doc in docs:
        sigs = extract_signals(doc)
        for k, v in sigs.items():
            if k in sum_keys:
                combined[k] = combined.get(k, 0) + (v or 0)
            else:
                combined[k] = v
    # If a doc carries raw vitest_failures (not _total), fold it too.
    return combined


def score_verdict(docs: list[dict], baselines: dict | None = None) -> dict:
    baselines = baselines or load_baselines()
    signals = combine_signals(docs)

    def base(name: str, default: float = 0) -> float:
        val = baselines.get(name)
        if val is None:
            return float(default)
        try:
            return float(val)
        except (TypeError, ValueError):
            return float(default)

    def sig(name: str, default: float = 0) -> float:
        val = signals.get(name)
        if val is None:
            return float(default)
        try:
            return float(val)
        except (TypeError, ValueError):
            return float(default)

    hard_failures: list[str] = []
    soft_regressions: list[str] = []

    # Hard gates (each is one failure)
    if sig("secret_findings") > 0:
        hard_failures.append(f"secret_findings={int(sig('secret_findings'))}")
    if sig("env_leak_count") > 0:
        hard_failures.append(f"env_leak_count={int(sig('env_leak_count'))}")
    if sig("test_only_count") > 0:
        hard_failures.append(f"test_only_count={int(sig('test_only_count'))}")
    if sig("dangerous_api_count") > base("dangerous_api_count"):
        hard_failures.append(
            f"dangerous_api grew {int(base('dangerous_api_count'))}->{int(sig('dangerous_api_count'))}"
        )
    # Any doc that reported ok:false counts as a hard failure
    for doc in docs:
        if doc.get("ok") is False:
            label = doc.get("label") or doc.get("name") or "anonymous_eval"
            hard_failures.append(f"ok=false:{label}")

    # Soft regressions (ratchet)
    for key in RATCHET_INCREASING:
        if sig(key) > base(key):
            soft_regressions.append(f"{key}: {int(base(key))}->{int(sig(key))}")
    for key in RATCHET_PCT:
        if key in signals and key in baselines and sig(key) < base(key):
            soft_regressions.append(f"{key}: {base(key)}->{sig(key)}")

    # Contribution table
    contrib: dict[str, float] = {}
    contrib["hard_gate_failures"] = 10000 * len(hard_failures)
    contrib["soft_gate_regressions"] = 1000 * len(soft_regressions)
    contrib["vitest_failures_total"] = 100 * sig("vitest_failures_total")
    contrib["playwright_failures_total"] = 100 * sig("playwright_failures_total")
    contrib["test_only_count"] = 50 * sig("test_only_count")
    contrib["dangerous_api_delta"] = 50 * max(0.0, sig("dangerous_api_count") - base("dangerous_api_count"))
    # Penalties for ratchet regression (higher than baseline = bad).
    contrib["uncovered_routes_delta"] = 10 * max(0.0, sig("uncovered_routes") - base("uncovered_routes"))
    contrib["test_skip_delta"] = 10 * max(0.0, sig("test_skip_count") - base("test_skip_count"))
    contrib["console_leak_delta"] = 5 * max(0.0, sig("console_leak_count") - base("console_leak_count"))

    # Symmetric rewards for ratchet improvement (lower than baseline = good).
    # These ONLY apply when the candidate actually measured the signal.
    # (Without the `key in signals` guard, the absence of a signal would look
    # like a 100% improvement and inflate the score artificially.)
    def _reward(key: str, weight: float) -> float:
        if key not in signals:
            return 0.0
        return -weight * max(0.0, base(key) - sig(key))

    contrib["uncovered_routes_reward"] = _reward("uncovered_routes", 10)
    contrib["test_skip_reward"] = _reward("test_skip_count", 10)
    contrib["console_leak_reward"] = _reward("console_leak_count", 5)
    contrib["e2e_flake_reward"] = _reward("e2e_flake_signals", 1)
    contrib["dangerous_api_reward"] = _reward("dangerous_api_count", 50)
    contrib["todo_density_kloc"] = 2 * sig("todo_density_kloc")
    contrib["prettier_failures_total"] = 1 * sig("prettier_failures_total")
    contrib["e2e_flake_signals_delta"] = 1 * max(0.0, sig("e2e_flake_signals") - base("e2e_flake_signals"))
    contrib["coverage_line_pct"] = -20 * sig("coverage_line_pct")
    contrib["coverage_branch_pct"] = -10 * sig("coverage_branch_pct")

    score = sum(contrib.values())
    return {
        "score": round(score, 3),
        "hard_gate_failures": hard_failures,
        "soft_gate_regressions": soft_regressions,
        "signals": signals,
        "baselines_used": {
            k: baselines.get(k)
            for k in list(RATCHET_INCREASING) + list(RATCHET_PCT) + ["dangerous_api_count"]
            if k in baselines
        },
        "contributions": {k: round(v, 3) for k, v in contrib.items()},
        "gate_policy": load_gate_policy(),
        "timestamp": now_stamp(),
    }


def _latest_score_files() -> list[str]:
    """Return one most-recent score file per eval name."""
    scores = Path(OVERSIGHT) / "state" / "scores"
    if not scores.exists():
        return []
    seen: dict[str, Path] = {}
    for p in scores.glob("*.json"):
        # filename like eval_coverage__20260417T120000.json
        stem = p.stem.split("__")[0]
        prev = seen.get(stem)
        if prev is None or p.stat().st_mtime > prev.stat().st_mtime:
            seen[stem] = p
    return [str(p) for p in seen.values()]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="*", help="Result JSON paths.")
    parser.add_argument("--glob", dest="glob_pattern", help="Glob pattern of result files.")
    parser.add_argument("--latest", action="store_true", help="Use latest score file per eval.")
    parser.add_argument("--emit-verdict", default=None, help="Write the verdict JSON to this path.")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    paths: list[str] = list(args.paths)
    if args.glob_pattern:
        paths.extend(_glob.glob(args.glob_pattern))
    if args.latest:
        paths.extend(_latest_score_files())
    paths = [p for p in dict.fromkeys(paths) if p]
    if not paths:
        print("No input files. Pass paths, --glob, or --latest.", file=sys.stderr)
        return 2

    docs = [_load_doc(p) for p in paths]
    verdict = score_verdict(docs)

    if not args.quiet:
        print(f"Inputs: {len(paths)}")
        for p in paths:
            print(f"  {p}")
        print()
        print(f"SCORE: {verdict['score']}  (lower is better)")
        if verdict["hard_gate_failures"]:
            print(f"  HARD GATE FAILURES ({len(verdict['hard_gate_failures'])}):")
            for f in verdict["hard_gate_failures"]:
                print(f"    - {f}")
        if verdict["soft_gate_regressions"]:
            print(f"  soft regressions ({len(verdict['soft_gate_regressions'])}):")
            for f in verdict["soft_gate_regressions"]:
                print(f"    - {f}")
        print("  contributions:")
        for k, v in sorted(verdict["contributions"].items(), key=lambda x: -abs(x[1])):
            if v != 0:
                print(f"    {k:<32} {v:>+12.3f}")

    if args.emit_verdict:
        write_json(Path(args.emit_verdict), verdict)
        if not args.quiet:
            print(f"Wrote verdict: {args.emit_verdict}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
