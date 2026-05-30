"""Deterministic fixer used by job 004-e2e-flake-layout.

Strips `await page.waitForTimeout(...)` lines from e2e/layout.spec.js.
Playwright auto-waits for visibility on the next action, so fixed sleeps are
almost always redundant and a common flake source.

Idempotent: running it again on a clean file is a no-op.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

TARGET = Path("e2e/layout.spec.js")
RX = re.compile(r"^\s*await\s+page\.waitForTimeout\([^)]+\)\s*\n", re.M)


def main() -> int:
    if not TARGET.exists():
        print(f"{TARGET} not found", file=sys.stderr)
        return 1
    original = TARGET.read_text(encoding="utf-8")
    updated = RX.sub("", original)
    if original == updated:
        print(f"{TARGET}: no page.waitForTimeout calls to strip (already clean)")
        return 0
    before = len(RX.findall(original))
    TARGET.write_text(updated, encoding="utf-8")
    print(f"{TARGET}: stripped {before} page.waitForTimeout(...) line(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
