"""Test marker evaluator.

Counts test state markers in all test files:
  - `.only` variants (test.only, it.only, describe.only, fit(, fdescribe() — CATASTROPHIC
  - `.skip` variants (test.skip, it.skip, describe.skip, xit(, xdescribe()
  - `.fixme` / `.todo`

Hard-fails (exit 1) if any `.only` marker is found, because a single `.only`
in a test file causes CI to silently skip every other test in that file.

Usage:
  python .oversight/scripts/eval_test_markers.py [--write-baseline] [--out file.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import OVERSIGHT, REPO_ROOT, now_stamp, write_json  # type: ignore

TEST_ROOTS = [
    "server/tests",
    "client/src/tests",
    "e2e",
]

PATTERNS = {
    "only": re.compile(
        r"(?:^|[\s;])(?:test|it|describe|suite)\.only\s*\(|"
        r"(?:^|[\s;])f(?:it|describe)\s*\(",
    ),
    "skip": re.compile(
        r"(?:^|[\s;])(?:test|it|describe|suite)\.skip\s*\(|"
        r"(?:^|[\s;])x(?:it|describe)\s*\(",
    ),
    "fixme": re.compile(r"(?:^|[\s;])(?:test|it)\.(?:fixme|todo)\s*\("),
}


def _iter_tests() -> list[Path]:
    out: list[Path] = []
    for root in TEST_ROOTS:
        d = REPO_ROOT / root
        if not d.exists():
            continue
        for p in d.rglob("*"):
            if not p.is_file():
                continue
            if "node_modules" in p.parts:
                continue
            if p.suffix in (".js", ".jsx", ".mjs", ".ts", ".tsx"):
                out.append(p)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=None)
    parser.add_argument("--write-baseline", action="store_true")
    args = parser.parse_args()

    files = _iter_tests()
    hits: dict[str, list[tuple[str, int, str]]] = {k: [] for k in PATTERNS}
    totals = {k: 0 for k in PATTERNS}

    for p in files:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for name, rx in PATTERNS.items():
            for m in rx.finditer(text):
                line_no = text.count("\n", 0, m.start()) + 1
                snippet = text.splitlines()[line_no - 1][:120] if line_no - 1 < len(text.splitlines()) else ""
                hits[name].append((str(p.relative_to(REPO_ROOT)).replace("\\", "/"), line_no, snippet))
                totals[name] += 1

    only_count = totals["only"]
    skip_count = totals["skip"]
    fixme_count = totals["fixme"]

    ok = only_count == 0
    signals = {
        "test_only_count": only_count,
        "test_skip_count": skip_count,
        "test_fixme_count": fixme_count,
        "test_files_scanned": len(files),
    }

    print(f"[eval_test_markers] scanned {len(files)} test file(s)")
    print(f"  test_only_count  : {only_count}  (hard fail if > 0)")
    print(f"  test_skip_count  : {skip_count}")
    print(f"  test_fixme_count : {fixme_count}")
    if only_count:
        print("  .only hits:")
        for path, ln, snip in hits["only"][:20]:
            print(f"    {path}:{ln}  {snip}")

    payload = {
        "name": "eval_test_markers",
        "ok": ok,
        "exit_code": 0 if ok else 1,
        "duration_s": 0,
        "signals": signals,
        "hits": {k: [{"path": p, "line": l, "snippet": s} for p, l, s in v] for k, v in hits.items()},
        "timestamp": now_stamp(),
    }
    out = Path(args.out) if args.out else OVERSIGHT / "state" / "scores" / f"eval_test_markers__{payload['timestamp']}.json"
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

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
