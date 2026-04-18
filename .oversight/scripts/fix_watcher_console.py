"""Deterministic fixer used by job 003-console-leak.

Strips `console.log(...)` and `console.debug(...)` lines from server/watcher.js.
Idempotent: running it again on a clean file is a no-op.

This exists as a tiny helper script rather than an inline `python -c` one-liner
because the minimal-YAML parser in _yaml.py does not support block scalars.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

TARGET = Path("server/watcher.js")
RX = re.compile(r"^\s*console\.(?:log|debug)\([^)]*\)\s*\n", re.M)


def main() -> int:
    if not TARGET.exists():
        print(f"{TARGET} not found", file=sys.stderr)
        return 1
    original = TARGET.read_text(encoding="utf-8")
    updated = RX.sub("", original)
    if original == updated:
        print(f"{TARGET}: no console.log/debug lines to strip (already clean)")
        return 0
    TARGET.write_text(updated, encoding="utf-8")
    before = len(RX.findall(original))
    print(f"{TARGET}: stripped {before} console.(log|debug) line(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
