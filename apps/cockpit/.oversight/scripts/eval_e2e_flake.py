"""E2E flake-signals evaluator.

Scans Playwright spec files under `e2e/` for flake-correlated patterns:

  * page.waitForTimeout(N)  — hard-coded wait for a duration
  * setTimeout(            — raw setTimeout in a spec (test-polluting timer)
  * page.waitFor(          — legacy generic waitFor
  * test.slow()            — tests marked slow don't fail flake but hint at it

Emits signals:
  e2e_waitForTimeout_count
  e2e_setTimeout_count
  e2e_waitFor_count
  e2e_slow_count
  e2e_flake_signals         (sum; used by scorer)
  specs_scanned

Usage:
  python .oversight/scripts/eval_e2e_flake.py [--write-baseline] [--out file.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import OVERSIGHT, REPO_ROOT, now_stamp, write_json  # type: ignore


PATTERNS = {
    "waitForTimeout": re.compile(r"\bpage\.waitForTimeout\s*\("),
    "setTimeout": re.compile(r"\bsetTimeout\s*\("),
    "waitFor_generic": re.compile(r"\bpage\.waitFor\s*\("),
    "slow": re.compile(r"\btest\.slow\s*\("),
}

SIGNAL_KEYS = {
    "waitForTimeout": "e2e_waitForTimeout_count",
    "setTimeout": "e2e_setTimeout_count",
    "waitFor_generic": "e2e_waitFor_count",
    "slow": "e2e_slow_count",
}


def _iter_specs() -> list[Path]:
    base = REPO_ROOT / "e2e"
    if not base.exists():
        return []
    out: list[Path] = []
    for p in base.rglob("*"):
        if not p.is_file():
            continue
        if "node_modules" in p.parts:
            continue
        if p.suffix in (".js", ".mjs", ".ts"):
            out.append(p)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=None)
    parser.add_argument("--write-baseline", action="store_true")
    args = parser.parse_args()

    specs = _iter_specs()
    per_file: dict[str, dict[str, int]] = {}
    hits_by_pattern: dict[str, list[dict]] = {k: [] for k in PATTERNS}

    for p in specs:
        rel = str(p.relative_to(REPO_ROOT)).replace("\\", "/")
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        per_file[rel] = {}
        for name, rx in PATTERNS.items():
            count = 0
            for m in rx.finditer(text):
                count += 1
                ln = text.count("\n", 0, m.start()) + 1
                snippet = text.splitlines()[ln - 1][:120] if ln - 1 < len(text.splitlines()) else ""
                hits_by_pattern[name].append({"path": rel, "line": ln, "snippet": snippet})
            per_file[rel][name] = count

    totals = {SIGNAL_KEYS[name]: sum(v[name] for v in per_file.values()) for name in PATTERNS}
    flake_signals_total = sum(totals.values())
    signals = {
        **totals,
        "e2e_flake_signals": flake_signals_total,
        "specs_scanned": len(specs),
    }

    print(f"[eval_e2e_flake] scanned {len(specs)} spec(s)")
    for k, v in signals.items():
        print(f"  {k:<26} {v}")
    for name in ("waitForTimeout", "setTimeout"):
        hits = hits_by_pattern[name]
        if hits[:5]:
            print(f"  {name} samples:")
            for h in hits[:5]:
                print(f"    {h['path']}:{h['line']}  {h['snippet']}")

    payload = {
        "name": "eval_e2e_flake",
        "ok": True,
        "exit_code": 0,
        "duration_s": 0,
        "signals": signals,
        "per_file": per_file,
        "hits": {k: v[:200] for k, v in hits_by_pattern.items()},
        "timestamp": now_stamp(),
    }
    out = Path(args.out) if args.out else OVERSIGHT / "state" / "scores" / f"eval_e2e_flake__{payload['timestamp']}.json"
    write_json(out, payload)
    print(f"Wrote: {out}")

    if args.write_baseline:
        baselines_path = OVERSIGHT / "state" / "baselines.json"
        baselines = {}
        if baselines_path.exists():
            try:
                baselines = json.loads(baselines_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                baselines = {}
        for k, v in signals.items():
            baselines[k] = v
        write_json(baselines_path, baselines)
        print(f"Updated baselines: {baselines_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
