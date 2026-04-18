r"""Code-health evaluator.

Scans product source (server/**, client/src/**) for:

  * console_leak      — `console.log` / `console.debug` calls (pino is the
                        server logger of record; client UI code shouldn't
                        log to console either).
  * todo_count        — `TODO|FIXME|HACK|XXX` tokens in code or comments.
  * todo_density_kloc — todo_count per 1000 lines of scanned source.
  * loc_total         — total non-blank lines scanned.
  * loc_outlier_count — number of files over 500 LOC.
  * loc_outliers      — list of (path, lines) for files over 500 LOC.
  * dangerous_api_count — count of `eval(`, `new Function(`,
                         `dangerouslySetInnerHTML`, `innerHTML\s*=`,
                         `document.write(`. Ignores test files.

Usage:
  python .oversight/scripts/eval_code_health.py [--write-baseline] [--out file.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import OVERSIGHT, REPO_ROOT, now_stamp, write_json  # type: ignore

SOURCE_ROOTS = [
    "server",
    "client/src",
]
# Exclude test files from counts where it makes sense.
EXCLUDE_DIRS = {"tests", "__tests__", "node_modules"}
SOURCE_SUFFIXES = (".js", ".jsx", ".mjs", ".ts", ".tsx")

CONSOLE_RX = re.compile(r"\bconsole\.(?:log|debug)\s*\(")
TODO_RX = re.compile(r"\b(?:TODO|FIXME|HACK|XXX)\b")
DANGEROUS_RX = re.compile(
    r"\beval\s*\(|"
    r"\bnew\s+Function\s*\(|"
    r"dangerouslySetInnerHTML|"
    r"\binnerHTML\s*=|"
    r"\bdocument\.write\s*\("
)


def _iter_source() -> list[Path]:
    files: list[Path] = []
    for root in SOURCE_ROOTS:
        base = REPO_ROOT / root
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if not p.is_file():
                continue
            if p.suffix not in SOURCE_SUFFIXES:
                continue
            if any(part in EXCLUDE_DIRS for part in p.parts):
                continue
            files.append(p)
    return files


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=None)
    parser.add_argument("--write-baseline", action="store_true")
    parser.add_argument("--loc-outlier-threshold", type=int, default=500)
    args = parser.parse_args()

    files = _iter_source()

    console_hits: list[tuple[str, int]] = []
    todo_hits: list[tuple[str, int]] = []
    dangerous_hits: list[tuple[str, int, str]] = []
    loc_total = 0
    loc_outliers: list[tuple[str, int]] = []

    for p in files:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        lines = text.splitlines()
        non_blank = sum(1 for ln in lines if ln.strip())
        loc_total += non_blank
        rel = str(p.relative_to(REPO_ROOT)).replace("\\", "/")
        if non_blank > args.loc_outlier_threshold:
            loc_outliers.append((rel, non_blank))
        for m in CONSOLE_RX.finditer(text):
            ln = text.count("\n", 0, m.start()) + 1
            console_hits.append((rel, ln))
        for m in TODO_RX.finditer(text):
            ln = text.count("\n", 0, m.start()) + 1
            todo_hits.append((rel, ln))
        for m in DANGEROUS_RX.finditer(text):
            ln = text.count("\n", 0, m.start()) + 1
            snippet = lines[ln - 1][:120] if ln - 1 < len(lines) else ""
            dangerous_hits.append((rel, ln, snippet))

    todo_density_kloc = round((len(todo_hits) / loc_total) * 1000, 3) if loc_total else 0.0
    loc_outliers.sort(key=lambda x: -x[1])

    signals = {
        "console_leak_count": len(console_hits),
        "todo_count": len(todo_hits),
        "todo_density_kloc": todo_density_kloc,
        "loc_total": loc_total,
        "loc_outlier_count": len(loc_outliers),
        "dangerous_api_count": len(dangerous_hits),
        "source_files_scanned": len(files),
    }

    print(f"[eval_code_health] scanned {len(files)} source file(s), {loc_total} LOC")
    for k, v in signals.items():
        print(f"  {k:<26} {v}")
    if dangerous_hits:
        print("  DANGEROUS API hits:")
        for path, ln, snip in dangerous_hits[:20]:
            print(f"    {path}:{ln}  {snip}")
    if loc_outliers[:5]:
        print(f"  Top LOC outliers (>{args.loc_outlier_threshold} lines):")
        for path, n in loc_outliers[:5]:
            print(f"    {n:>5}  {path}")

    payload = {
        "name": "eval_code_health",
        "ok": True,
        "exit_code": 0,
        "duration_s": 0,
        "signals": signals,
        "hits": {
            "console_leak": [{"path": p, "line": l} for p, l in console_hits[:100]],
            "todo": [{"path": p, "line": l} for p, l in todo_hits[:100]],
            "dangerous_api": [{"path": p, "line": l, "snippet": s} for p, l, s in dangerous_hits[:100]],
            "loc_outliers": [{"path": p, "lines": n} for p, n in loc_outliers[:50]],
        },
        "timestamp": now_stamp(),
    }
    out = Path(args.out) if args.out else OVERSIGHT / "state" / "scores" / f"eval_code_health__{payload['timestamp']}.json"
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
