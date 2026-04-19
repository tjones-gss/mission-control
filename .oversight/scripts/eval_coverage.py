"""Client-side test coverage evaluator.

Requires the Vitest v8 coverage provider (not installed by default here):

  cd client && npm i -D @vitest/coverage-v8

Without it, `vitest --coverage` fails and this evaluator returns `ok: false`
(hard gate) so missing coverage cannot be mistaken for zero-percent coverage.

Runs `vitest run --coverage --reporter=json-summary` in client/, parses
the generated `client/coverage/coverage-summary.json`, and emits signals:

  - coverage_line_pct
  - coverage_branch_pct
  - coverage_function_pct
  - coverage_statement_pct

Usage:
  python .oversight/scripts/eval_coverage.py [--write-baseline]
  python .oversight/scripts/eval_coverage.py --out path/to/result.json

Exit codes:
  0 = ran successfully (coverage-summary.json parsed)
  1 = coverage run failed (no summary)
  2 = invalid invocation
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import OVERSIGHT, REPO_ROOT, now_stamp, run, write_json  # type: ignore


def _parse_summary(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    total = data.get("total") or {}
    return {
        "coverage_line_pct": float(total.get("lines", {}).get("pct") or 0),
        "coverage_branch_pct": float(total.get("branches", {}).get("pct") or 0),
        "coverage_function_pct": float(total.get("functions", {}).get("pct") or 0),
        "coverage_statement_pct": float(total.get("statements", {}).get("pct") or 0),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=None)
    parser.add_argument("--write-baseline", action="store_true")
    parser.add_argument("--target", default="client", choices=["client"])
    args = parser.parse_args()

    # Vitest 4 separates test reporters (`--reporter=...`) from coverage
    # reporters (`--coverage.reporter=...`). Passing json-summary to the test
    # reporter pipeline fails with "cannot load json-summary module". The
    # summary must be requested via the coverage-specific flag.
    cmd = (
        "npx vitest run --coverage"
        " --coverage.reporter=json-summary"
        " --coverage.reporter=text"
        " --reporter=default"
    )
    cwd = REPO_ROOT / args.target
    if not cwd.exists():
        print(f"Target directory missing: {cwd}", file=sys.stderr)
        return 2

    print(f"[eval_coverage] cwd={cwd.name}  $ {cmd}")
    res = run(cmd, cwd=cwd, timeout=900)

    summary_path = cwd / "coverage" / "coverage-summary.json"
    signals = _parse_summary(summary_path)
    ok = bool(signals) and res["exit_code"] == 0

    if not signals:
        print(
            f"  WARN: no coverage summary found at {summary_path}. "
            "Is @vitest/coverage-v8 installed? Did vitest fail?",
            file=sys.stderr,
        )

    payload = {
        "name": "eval_coverage",
        "target": args.target,
        "cmd": cmd,
        "ok": ok,
        "exit_code": res["exit_code"],
        "duration_s": res["duration_s"],
        "signals": signals,
        "stdout_tail": (res["stdout"] or "")[-1500:],
        "stderr_tail": (res["stderr"] or "")[-1500:],
        "timestamp": now_stamp(),
    }

    for k, v in signals.items():
        print(f"  {k:<26} {v}")

    out = Path(args.out) if args.out else OVERSIGHT / "state" / "scores" / f"eval_coverage__{payload['timestamp']}.json"
    write_json(out, payload)
    print(f"Wrote: {out}")

    if args.write_baseline and signals:
        baselines_path = OVERSIGHT / "state" / "baselines.json"
        baselines = {}
        if baselines_path.exists():
            try:
                baselines = json.loads(baselines_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                baselines = {}
        baselines.update(signals)
        write_json(baselines_path, baselines)
        print(f"Updated baselines: {baselines_path}")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
