"""Run `node --check` on every .js / .mjs / .cjs file under one or more paths.

Used by the `scripts` domain as a fast local evaluator. Does not import or
execute the code — only parses it.

Usage:
  python .oversight/scripts/check_node_syntax.py <dir-or-file> [more...]
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def _iter_js(target: Path):
    if target.is_file():
        if target.suffix in (".js", ".mjs", ".cjs"):
            yield target
        return
    for p in target.rglob("*"):
        if not p.is_file():
            continue
        if "node_modules" in p.parts:
            continue
        if p.suffix in (".js", ".mjs", ".cjs"):
            yield p


def main(argv: list[str]) -> int:
    if not argv:
        print("Usage: check_node_syntax.py <path> [...]", file=sys.stderr)
        return 2
    fail = 0
    checked = 0
    for arg in argv:
        t = Path(arg)
        if not t.exists():
            print(f"MISS {arg}")
            fail += 1
            continue
        for f in _iter_js(t):
            checked += 1
            cp = subprocess.run(
                ["node", "--check", str(f)],
                capture_output=True,
                text=True,
            )
            if cp.returncode != 0:
                print(f"FAIL {f}")
                if cp.stderr:
                    print("  " + cp.stderr.strip().splitlines()[0])
                fail += 1
    print(f"\nChecked {checked} file(s), {fail} failure(s).")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
