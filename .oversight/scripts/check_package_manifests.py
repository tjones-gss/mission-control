"""Sanity-check every package.json in the repo.

Exit 0 if all parse and declare a name+version.
Exit 1 otherwise.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO_ROOT  # type: ignore


def main() -> int:
    paths = [
        REPO_ROOT / "package.json",
        REPO_ROOT / "client" / "package.json",
        REPO_ROOT / "server" / "package.json",
    ]
    bad = 0
    for p in paths:
        if not p.exists():
            print(f"MISS {p}")
            bad += 1
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"FAIL {p}: {e}")
            bad += 1
            continue
        if not data.get("name"):
            print(f"FAIL {p}: missing 'name'")
            bad += 1
        if not data.get("version"):
            print(f"FAIL {p}: missing 'version'")
            bad += 1
        else:
            print(f"OK   {p.relative_to(REPO_ROOT)}  {data['name']}@{data['version']}")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
